import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runFactory } from "./factory.ts";
import { startHeartbeat } from "./heartbeat.ts";
import type { Decision } from "./model.ts";

const correct = readFileSync(join(import.meta.dirname, "solve.ts"), "utf8");
const finish: Decision = { action: "finish", reason: "終了条件を満たした" };

test("ten minutes of working heartbeats cost zero calls and a pending decision costs one", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const dir = mkdtempSync(join(tmpdir(), "heartbeat-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "log");
  let answer!: (value: Decision) => void;
  const pending = new Promise<Decision>(resolve => { answer = resolve; });
  let calls = 0;
  const heartbeat = startHeartbeat({ model: "fixture", intervalMs: 10_000, decide() {
    calls++;
    return pending;
  } }, "task", log);
  t.after(() => heartbeat.close());
  for (let i = 0; i < 60; i++) t.mock.timers.tick(10_000);
  const events = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.event === "heartbeat").length, 60);
  assert.equal(calls, 0);
  const assessed = heartbeat.assess({ state: "verified", round: 1, evidence: "audit", findings: [] });
  for (let i = 0; i < 6; i++) t.mock.timers.tick(10_000);
  assert.equal(calls, 1);
  answer(finish);
  assert.deepEqual(await assessed, finish);
});

test("failed and deferred decisions retry on backoff independently of heartbeat", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const dir = mkdtempSync(join(tmpdir(), "heartbeat-retry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const heartbeat = startHeartbeat({ model: "fixture", intervalMs: 10_000, async decide() {
    calls++;
    if (calls === 1) throw new Error("supervisor unavailable");
    if (calls === 2) return { action: "wait", reason: "保留" };
    return finish;
  } }, "task", join(dir, "log"));
  t.after(() => heartbeat.close());
  const result = heartbeat.assess({ state: "verified", round: 1, evidence: "audit", findings: [] });
  await Promise.resolve();
  t.mock.timers.tick(59_999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  t.mock.timers.tick(119_999);
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  assert.deepEqual(await result, finish);
  assert.equal(calls, 3);
});

test("supervised factory retries interruptions, rejects premature finish and delivers beyond three rounds", async t => {
  const runs = mkdtempSync(join(tmpdir(), "supervised-test-"));
  t.after(() => rmSync(runs, { recursive: true, force: true }));
  const prompts: string[] = [];
  let reviews = 0;
  const { run, status } = await runFactory({ runs, model: {
    async implement(prompt) {
      prompts.push(prompt);
      if (prompts.length === 1) throw new Error("worker unavailable");
      return prompts.length === 2 ? "console.log(JSON.stringify({reward:0,ids:[]}))" : correct;
    },
    async review() {
      if (++reviews === 2) throw new Error("review interrupted");
      return { assessment: "確認済み", findings: [] };
    },
  }, supervisor: { model: "fixture", intervalMs: 100, async decide(prompt) {
    if (prompt.includes('"state":"interrupted"')) return { action: "resume", reason: "前回の状態から再開" };
    return finish;
  } } });
  assert.equal(status, "DELIVERED");
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /前回の状態から再開/);
  assert.match(prompts[2], /greedy-trap/);
  assert.equal(readFileSync(join(run, "solve.ts"), "utf8"), correct);
  const result = JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
  assert.equal(result.round, 4);
  assert.equal(reviews, 3); // Only retry the interrupted second review.
  assert.ok(existsSync(join(run, "round-3/interruption.json")));
  assert.equal(readFileSync(join(run, "round-4/solve.ts"), "utf8"), readFileSync(join(run, "round-3/solve.ts"), "utf8"));
  const events = readFileSync(join(run, "heartbeat.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.event === "supervisor-call").length, 4);
  assert.ok(events.some(e => e.state === "incomplete" && e.action === "finish" && e.applied === "resume"));
  assert.equal(events.at(-1).applied, "finish");
});

test("context overflow starts a fresh draft and verifies it before delivery", async t => {
  const runs = mkdtempSync(join(tmpdir(), "supervised-overflow-"));
  t.after(() => rmSync(runs, { recursive: true, force: true }));
  const prompts: string[] = [], decisions: string[] = [];
  let reviews = 0;
  const { run, status } = await runFactory({ runs, model: {
    async implement(prompt) {
      prompts.push(prompt);
      return prompts.length === 1 ? correct + "\n// previous-draft-marker" : correct;
    },
    async review() {
      if (++reviews === 2) throw new Error("context_length_exceeded " + "x".repeat(30_000));
      return { assessment: "確認済み", findings: [] };
    },
  }, supervisor: { model: "fixture", intervalMs: 10_000, async decide(prompt) {
    decisions.push(prompt);
    return finish;
  } } });
  assert.equal(status, "DELIVERED");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /仕様から簡潔に再実装/);
  assert.doesNotMatch(prompts[1], /previous-draft-marker/);
  assert.match(decisions[0], /context_length_exceeded/);
  assert.ok(decisions[0].length < 1000);
  assert.equal(reviews, 4);
  const context = readFileSync(join(run, "context.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(context.filter(e => e.role === "supervisor").map(e => e.inputBytes), decisions.map(p => Buffer.byteLength(p)));
  assert.equal(JSON.parse(readFileSync(join(run, "round-2/audit.json"), "utf8")).verdict, "PASS");
});
