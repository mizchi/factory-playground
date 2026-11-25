import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runFactory } from "./factory.ts";
import type { FactoryModel } from "./model.ts";

const correct = readFileSync(join(import.meta.dirname, "solve.ts"), "utf8");
const alwaysEmpty = 'console.log(JSON.stringify({reward:0, ids:[]}));';
const approve = () => Promise.resolve({ assessment: "checked", findings: [] });

test("failed audit and review each block delivery and feed the next revision", async t => {
  const runs = mkdtempSync(join(tmpdir(), "factory-test-"));
  t.after(() => rmSync(runs, { recursive: true, force: true }));
  const prompts: string[] = [];
  let reviews = 0;
  const model: FactoryModel = {
    async implement(prompt) {
      prompts.push(prompt);
      return [alwaysEmpty, correct, correct + "\n"][prompts.length - 1];
    },
    async review() {
      reviews++;
      return reviews === 2 ? { assessment: "fixture revision request", findings: ["clarify predecessor invariant"] } : approve();
    },
  };
  const result = await runFactory({ rounds: 3, model, runs });
  assert.equal(result.status, "DELIVERED");
  assert.match(prompts[1], /greedy-trap/);
  assert.match(prompts[2], /clarify predecessor invariant/);
  assert.equal(reviews, 4);
  assert.equal(existsSync(join(result.run, "round-1/review-correctness.json")), false);
  assert.equal(readFileSync(join(result.run, "solve.ts"), "utf8"), correct + "\n");
  const read = (p: string) => JSON.parse(readFileSync(join(result.run, p), "utf8"));
  const digest = read("result.json").sha256;
  assert.equal(read("round-3/review-implementation.json").sha256, digest);
  assert.equal(read("round-3/review-correctness.json").sha256, digest);
  assert.equal(read("round-3/audit.json").submission_sha256, digest);
  assert.equal(read("round-3/audit.json").checks.length, 18);
});

test("type errors exhaust the budget even when all runtime checks and reviews pass", async t => {
  const runs = mkdtempSync(join(tmpdir(), "factory-test-"));
  t.after(() => rmSync(runs, { recursive: true, force: true }));
  const result = await runFactory({ runs, rounds: 1, model: {
    implement: async () => correct + '\nconst invalid: number = "two";', review: approve,
  } });
  assert.equal(result.status, "EXHAUSTED");
  assert.equal(existsSync(join(result.run, "solve.ts")), false);
  assert.match(readFileSync(join(result.run, "round-1/types.json"), "utf8"), /TS2322/);
});

test("interrupted reviews leave evidence and no delivery", async t => {
  const runs = mkdtempSync(join(tmpdir(), "factory-test-"));
  t.after(() => rmSync(runs, { recursive: true, force: true }));
  const result = await runFactory({ runs, rounds: 1, model: {
    implement: async () => correct,
    review: async () => { throw new Error("review unavailable"); },
  } });
  assert.equal(result.status, "ERROR");
  assert.equal(existsSync(join(result.run, "solve.ts")), false);
  assert.equal(existsSync(join(result.run, "round-1/audit.json")), true);
});
