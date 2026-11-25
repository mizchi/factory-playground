import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

test("a killed supervisor resumes the pending review once and cannot run twice", { timeout: 25_000 }, async t => {
  const tmp = mkdtempSync(join(tmpdir(), "factory-crash-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const calls = join(tmp, "calls");
  const release = join(tmp, "release");
  writeFileSync(join(tmp, "codex"), `#!/usr/bin/env node
const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
const schema = JSON.parse(fs.readFileSync("schema.json"));
const role = schema.properties.action ? "supervisor" : prompt.startsWith("正しさ") ? "correctness" : "implementation";
fs.appendFileSync(process.env.CALLS, role + "\\n");
if (role === "implementation" && !fs.existsSync(process.env.RELEASE)) {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) process.exit(1); }, 50);
} else {
  fs.writeFileSync("answer.json", JSON.stringify(role === "supervisor" ?
    {action:"finish",reason:"確認済み"} : {assessment:"確認済み",findings:[]}));
}
`, { mode: 0o755 });
  function launch(args: string[]) {
    const child = spawn(process.execPath, [join(import.meta.dirname, "supervise.ts"), ...args], {
      env: { ...process.env, PATH: tmp + ":" + process.env.PATH, CALLS: calls, RELEASE: release },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL"); });
    return { child, output: () => output, ended: once(child, "exit") };
  }
  const first = launch(["--supervise", "", "1", join(import.meta.dirname, "solve.ts")]);
  while (!existsSync(calls) || !readFileSync(calls, "utf8").includes("implementation")) {
    assert.equal(first.child.exitCode, null, first.output());
    await sleep(25);
  }
  const run = first.output().match(/^factory: (.+)$/m)![1];
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const duplicate = launch(["--resume", run]);
  assert.equal((await duplicate.ended)[0], 2, duplicate.output());
  assert.match(duplicate.output(), /監督が実行中/);
  assert.equal(existsSync(join(run, "result.json")), false);
  const firstSupervisor = Number(first.output().match(/supervisor pid=(\d+)/)![1]);
  process.kill(firstSupervisor, "SIGKILL");
  // Stop the whole watchdog intentionally during the replay. It must not restart until requested.
  while (readFileSync(calls, "utf8").trim().split("\n").length < 3) {
    assert.equal(first.child.exitCode, null, first.output());
    await sleep(25);
  }
  first.child.kill("SIGINT");
  assert.equal((await first.ended)[0], 130, first.output());
  assert.equal(existsSync(join(run, "result.json")), false);
  assert.match(first.output(), /同じ実行を 1 秒後に再開/);
  assert.equal((first.output().match(/supervisor pid=/g) ?? []).length, 2);
  writeFileSync(release, "");
  const manual = launch(["--resume", run]);
  assert.equal((await manual.ended)[0], 0, manual.output());
  assert.equal(JSON.parse(readFileSync(join(run, "result.json"), "utf8")).status, "DELIVERED");
  const again = launch(["--resume", run]);
  assert.equal((await again.ended)[0], 0, again.output());
  writeFileSync(join(run, "solve.ts"), "changed after delivery");
  const modified = launch(["--resume", run]);
  assert.equal((await modified.ended)[0], 2, modified.output());
  assert.match(modified.output(), /ハッシュが一致しません/);
  assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), ["correctness", "implementation", "implementation", "implementation", "supervisor"]);
});
