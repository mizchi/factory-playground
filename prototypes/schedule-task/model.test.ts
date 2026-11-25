import assert from "node:assert/strict";
import test from "node:test";
import { claudeReply, piReply } from "./model.ts";

test("Claude quota responses never count as structured output", () => {
  const review = { assessment: "ok", findings: [] };
  assert.deepEqual(claudeReply(JSON.stringify({ subtype: "success", is_error: false, structured_output: review })), review);
  assert.throws(() => claudeReply(JSON.stringify({ subtype: "success", is_error: true, result: "weekly limit" })), /weekly limit/);
});

test("Pi uses the terminal assistant reply and rejects a later failure", () => {
  const end = (stopReason: string) => JSON.stringify({ type: "message_end", message: {
    role: "assistant", stopReason, content: [{ type: "text", text: '{"action":"finish"}' }],
  } });
  assert.deepEqual(piReply(end("stop") + '\n{"type":"agent_settled"}'), { action: "finish" });
  assert.throws(() => piReply(end("stop") + "\n" + end("error")), /error/);
});
