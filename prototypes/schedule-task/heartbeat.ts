import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { feedbackExcerpt } from "./context.ts";
import type { Decision } from "./model.ts";

export type Supervision = {
  model: string;
  intervalMs: number;
  decide(prompt: string): Promise<Decision>;
};
type Observation =
  | { state: "working"; round: number; phase: string }
  | { state: "incomplete" | "verified" | "interrupted"; round: number; evidence: string; findings: string[] };

export function startHeartbeat(config: Supervision, task: string, log: string) {
  if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs < 1 || config.intervalMs > 2_147_483_647)
    throw new Error("heartbeat の間隔が不正です");
  let current: Observation = { state: "working", round: 1, phase: "開始" };
  const session = randomUUID();
  let tick = 0;
  let calls = 0;
  let lastInterruptedPhase: string | undefined;
  let repeatedInterruptions = 0;

  function record(event: string, detail: object) {
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), session, event, ...detail }) + "\n");
  }
  // The sampling clock only observes local state. Worker checkpoints request decisions.
  const timer = setInterval(() => {
    record("heartbeat", { id: ++tick, model: config.model, ...current });
    console.log(`heartbeat #${tick} round=${current.round} ${current.state}` +
      (current.state === "working" ? ` ${current.phase}` : ""));
  }, config.intervalMs);

  async function backoff(round: number, retries: number, reason: string) {
    const delayMs = Math.min(60_000 * 2 ** (retries - 1), 900_000);
    record("retry", { round, delayMs, reason });
    console.log(`監督: ${delayMs / 1000}秒後に再試行 (${reason})`);
    await new Promise<void>(resolve => setTimeout(resolve, delayMs));
  }

  return {
    working(round: number, phase: string) { current = { state: "working", round, phase }; },
    async assess(observed: Exclude<Observation, { state: "working" }>): Promise<Decision> {
      const { round, state } = observed;
      const phase = current.state === "working" ? current.phase : undefined;
      current = observed;
      if (state === "interrupted" && phase && lastInterruptedPhase === phase) {
        await backoff(round, ++repeatedInterruptions, "同じ工程が連続して中断");
      } else {
        repeatedInterruptions = 0;
      }
      lastInterruptedPhase = state === "interrupted" ? phase : undefined;
      let retries = 0;
      for (;;) {
        const call = ++calls;
        record("supervisor-call", { call, model: config.model, ...observed });
        let decision: Decision;
        try {
          decision = await config.decide(
            `${task}。incomplete/interrupted は resume、verified は納品可なら finish。理由と次の指示を日本語1文で。\n` +
            JSON.stringify({ round, state, phase, evidence: observed.evidence, findings: feedbackExcerpt(observed.findings, 480) }));
        } catch (error) {
          record("supervisor-error", { call, round, message: String(error) });
          await backoff(round, ++retries, "監督の呼び出しに失敗");
          continue;
        }
        const applied = state === "verified" ? decision.action : "resume";
        record("decision", { call, round, state, ...decision, applied });
        if (applied === "wait") {
          await backoff(round, ++retries, "監督が判断を保留");
          continue;
        }
        console.log(`監督 #${call} ${decision.action} → ${applied}: ${decision.reason}`);
        return { action: applied, reason: decision.action === applied ? decision.reason : "未達の検査結果をもとに再開してください。" };
      }
    },
    close() { clearInterval(timer); },
  };
}
