import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { announce, openPipeline, parsePipeline } from "./pipeline.ts";

const plan = JSON.parse(readFileSync(join(import.meta.dirname, "pipeline.json"), "utf8"));
test("reject invalid job order, duplicate IDs and forward memo references", () => {
  assert.throws(() => parsePipeline({ ...plan, children: plan.children.toReversed() }), /順/);
  assert.throws(() => parsePipeline({ ...plan, children: [...plan.children, plan.children[0]] }), /一意/);
  assert.throws(() => parsePipeline({ ...plan, reads: ["builder"] }), /先行工程/);
});

test("a consumer can pin an older memo without receiving the entire run", t => {
  const tmp = mkdtempSync(join(tmpdir(), "pipeline-memory-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const config = structuredClone(plan);
  const notes = Array.from({length: 10}, (_, i) => ({ id: "note" + i, task: "検討", agent: "pi" }));
  config.children.unshift(...notes);
  config.children.at(-1).reads = ["note0"];
  const root = parsePipeline(config);
  const writer = openPipeline(root, tmp);
  for (const node of notes) writer.publish({ author: node.id, role: "memo", round: 1, memo: "memo-" + node.id });
  const reader = openPipeline(root, tmp);
  const prompt = reader.input(reader.stageFor("review-implementation"), "点検", 2, () => {});
  assert.match(prompt, /memo-note0/);
  assert.match(prompt, /memo-note9/);
  assert.doesNotMatch(prompt, /memo-note1/);
});

test("mixed agents resume their hierarchy, share notes and scope broadcasts to descendants", { timeout: 30_000 }, async t => {
  const tmp = mkdtempSync(join(tmpdir(), "pipeline-test-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const calls = join(tmp, "calls");
  const fixture = `#!/usr/bin/env node
const fs = require("node:fs");
const agent = require("node:path").basename(process.argv[1]);
const prompt = fs.readFileSync(0,"utf8");
const id = prompt.match(/担当: ([\\w-]+) \\(/)[1];
fs.appendFileSync(process.env.CALLS, JSON.stringify({agent,id,prompt,args:process.argv.slice(2)}) + "\\n");
let value;
if (id === "builder" && !fs.existsSync(process.env.RELEASE)) {
  setInterval(() => {}, 60000);
} else {
  if (id === "builder") value = {source: prompt.includes("ROUND-TWO") ? fs.readFileSync(process.env.SOLVE,"utf8") : "console.log(JSON.stringify({reward:0,ids:[]}))", memo:"BUILDER-NOTE"};
  else if (id === "supervisor" && prompt.includes("incomplete/interrupted"))
    value = prompt.includes('"state":"verified"') ? {action:"finish",reason:"ok"} : {action:"resume",reason:"ROUND-TWO"};
  else if (id === "quality" || id === "correctness") value = {assessment:"inspected-"+id,findings:[]};
  else value = {memo:"MEMO-"+id,broadcast:"DIRECTIVE-"+id};
  if (agent === "codex") fs.writeFileSync("answer.json",JSON.stringify(value));
  else if (agent === "claude") console.log(JSON.stringify({subtype:"success",is_error:false,structured_output:value}));
  else console.log(JSON.stringify({type:"message_end",message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:JSON.stringify(value)}]}}));
}
`;
  for (const cli of ["claude", "codex", "pi"]) writeFileSync(join(tmp, cli), fixture, { mode: 0o755 });
  const planPath = join(tmp, "plan.json");
  const config = structuredClone(plan);
  config.children[1].agent = "claude";
  config.children[1].model = "sonnet";
  writeFileSync(planPath, JSON.stringify(config));
  const release = join(tmp, "release");
  function launch(args: string[]) {
    const child = spawn(process.execPath, [join(import.meta.dirname, "supervise.ts"), ...args], {
      env: { ...process.env, PATH: tmp + ":" + process.env.PATH, CALLS: calls, RELEASE: release, SOLVE: join(import.meta.dirname, "solve.ts") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill("SIGTERM"); });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    return { child, output: () => output, ended: once(child, "exit") };
  }
  const first = launch(["--pipeline", planPath, "1"]);
  while (!existsSync(calls) || !readFileSync(calls, "utf8").includes('"id":"builder"')) {
    assert.equal(first.child.exitCode, null, first.output());
    await sleep(20);
  }
  const run = first.output().match(/^factory: (.+)$/m)![1];
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const global = announce(run, "supervisor", "GLOBAL-UPDATE");
  execFileSync(process.execPath, [join(import.meta.dirname, "pipeline.ts"), run, "design", "PRIVATE-UPDATE"]);
  assert.throws(() => announce(run, "builder", "invalid"), /子を持つ/);
  first.child.kill("SIGINT");
  assert.equal((await first.ended)[0], 130);
  rmSync(planPath); // The resumed process must use the frozen plan.
  writeFileSync(release, "");
  const resumed = launch(["--resume", run]);
  assert.equal((await resumed.ended)[0], 0, resumed.output());
  const history = readFileSync(calls, "utf8").trim().split("\n").map(s => JSON.parse(s));
  assert.deepEqual(history.map(h => h.id), ["supervisor","design","algorithm","builder","builder","supervisor","builder","boundaries","correctness","quality","supervisor"]);
  assert.deepEqual([...new Set(history.map(h => h.agent))].sort(), ["claude","codex","pi"]);
  const secondDraft = history.filter(h => h.id === "builder").at(-1);
  assert.match(secondDraft.prompt, /DIRECTIVE-supervisor/);
  assert.match(secondDraft.prompt, /DIRECTIVE-design/);
  assert.match(secondDraft.prompt, /MEMO-algorithm/);
  assert.match(secondDraft.prompt, /ROUND-TWO/);
  assert.match(secondDraft.prompt, /PRIVATE-UPDATE/);
  assert.match(secondDraft.prompt, /GLOBAL-UPDATE/);
  const sibling = history.find(h => h.id === "boundaries");
  assert.ok(sibling.args.includes("sonnet"));
  assert.match(sibling.prompt, /BUILDER-NOTE/);
  assert.match(sibling.prompt, /DIRECTIVE-supervisor/);
  assert.match(sibling.prompt, /ROUND-TWO/);
  assert.doesNotMatch(sibling.prompt, /DIRECTIVE-design|PRIVATE-UPDATE/);
  assert.match(sibling.prompt, /GLOBAL-UPDATE/);
  const trace = readFileSync(join(run, "context.jsonl"), "utf8").trim().split("\n").map(s => JSON.parse(s));
  assert.ok(trace.find(e => e.member === "boundaries").announcements.includes(global.id));
  assert.doesNotMatch(history.find(h => h.id === "quality").prompt, /inspected-correctness/);
  assert.match(history.at(-1).prompt, /inspected-quality/);
  assert.equal(JSON.parse(readFileSync(join(run, "result.json"), "utf8")).round, 2);
});
