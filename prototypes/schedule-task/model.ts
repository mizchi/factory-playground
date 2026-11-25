import { ask, type Agent } from "../../templates/factory/agent.mts";
export { agentName, claudeReply, piReply, type Agent } from "../../templates/factory/agent.mts";

export type Review = { assessment: string; findings: string[] };
export type FactoryModel = {
  implement(prompt: string): Promise<string>;
  review(prompt: string): Promise<Review>;
};
export type Decision = { action: "wait" | "resume" | "finish"; reason: string };

const string = { type: "string" };
export function factoryModel(agent: Agent, model?: string): FactoryModel {
  return {
    async implement(prompt) {
      const { source } = await ask(agent, prompt, { source: string }, model);
      if (typeof source !== "string" || !source.trim()) throw new Error("実装応答にソースがありません");
      return source;
    },
    async review(prompt) {
      const { assessment, findings } = await ask(agent, prompt, { assessment: string, findings: { type: "array", items: string } }, model);
      if (typeof assessment !== "string" || !assessment.trim() || !Array.isArray(findings) ||
          !findings.every(f => typeof f === "string" && f.trim())) throw new Error("レビュー応答が不正です");
      return { assessment, findings };
    },
  };
}

export function agentSupervisor(agent: Agent, model?: string) {
  return async (prompt: string): Promise<Decision> => {
    const { action, reason } = await ask(agent, prompt, {
      action: { type: "string", enum: ["wait", "resume", "finish"] }, reason: string,
    }, model);
    if ((action !== "wait" && action !== "resume" && action !== "finish") ||
        typeof reason !== "string" || !reason.trim()) throw new Error("監督応答が不正です");
    return { action, reason };
  };
}

export async function teamBrief(agent: Agent, model: string | undefined, prompt: string, lead: boolean) {
  const properties: Record<string, object> = { memo: string };
  if (lead) properties.broadcast = string;
  const answer = await ask(agent, prompt, properties, model);
  if (typeof answer.memo !== "string" || !answer.memo.trim() ||
      (lead && (typeof answer.broadcast !== "string" || !answer.broadcast.trim()))) throw new Error("チームへの引き継ぎが空です");
  return { memo: answer.memo, broadcast: lead ? String(answer.broadcast) : undefined };
}

export async function teamImplement(agent: Agent, model: string | undefined, prompt: string) {
  const { source, memo } = await ask(agent, prompt, { source: string, memo: string }, model);
  if (typeof source !== "string" || !source.trim() || typeof memo !== "string" || !memo.trim())
    throw new Error("実装または引き継ぎが空です");
  return { source, memo };
}
