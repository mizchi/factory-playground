import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Agent = "codex" | "claude" | "pi";
export function agentName(value: unknown = "codex"): Agent {
  if (value === "codex" || value === "claude" || value === "pi") return value;
  throw new Error("agent は codex、claude、pi のいずれかを指定してください");
}
export type Review = { assessment: string; findings: string[] };
export type FactoryModel = {
  implement(prompt: string): Promise<string>;
  review(prompt: string): Promise<Review>;
};
export type Decision = { action: "wait" | "resume" | "finish"; reason: string };

function invoke(agent: Agent, args: string[], cwd: string, prompt: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = execFile(agent, args, { cwd, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          let detail = stderr.trim();
          if (agent === "claude" && stdout.trim()) {
            try { detail = JSON.parse(stdout).result || detail; } catch { /* use CLI diagnostics */ }
          }
          fail(new Error(`${agent}: ${error.signal ?? error.code} ${String(detail).slice(-2000)}`));
        } else done(stdout);
      });
    child.stdin?.on("error", () => {}); // The exit callback reports premature termination.
    child.stdin?.end(prompt);
  });
}

export function claudeReply(stdout: string) {
  const result = JSON.parse(stdout);
  if (result.is_error || result.subtype !== "success") throw new Error(`claude: ${String(result.result ?? result.subtype).slice(-1000)}`);
  return result.structured_output;
}

export function piReply(stdout: string) {
  const events = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const message = events.findLast(event => event.type === "message_end" && event.message?.role === "assistant")?.message;
  if (message?.stopReason !== "stop") throw new Error(`pi: ${message?.errorMessage ?? message?.stopReason ?? "応答未完了"}`);
  const answer = message.content.filter((part: { type: string }) => part.type === "text")
    .map((part: { text: string }) => part.text).join("").trim();
  return JSON.parse(answer.replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i, "$1"));
}

const string = { type: "string" };
async function ask(agent: Agent, prompt: string, properties: Record<string, object>, model?: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "factory-model-"));
  const schema = JSON.stringify({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const selection = model ? ["--model", model] : [];
  try {
    let answer: unknown;
    if (agent === "codex") {
      writeFileSync(join(dir, "schema.json"), schema);
      await invoke(agent, ["-a", "never", "exec", "--ignore-user-config", "--disable", "shell_tool",
        "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
        ...selection, "--output-schema", "schema.json", "-o", "answer.json", "-"], dir, prompt);
      answer = JSON.parse(readFileSync(join(dir, "answer.json"), "utf8"));
    } else if (agent === "claude") {
      answer = claudeReply(await invoke(agent, ["-p", "--restricted", "--tools", "", "--strict-mcp-config",
        "--disable-slash-commands", "--permission-mode", "dontAsk", "--no-session-persistence",
        ...selection, "--output-format", "json", "--json-schema", schema], dir, prompt));
    } else {
      answer = piReply(await invoke(agent, ["--print", "--mode", "json", "--no-session", "--no-tools",
        "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", ...selection],
        dir, `${prompt}\nこのスキーマの JSON オブジェクトだけを返す: ${schema}`));
    }
    if (typeof answer !== "object" || !answer || Array.isArray(answer)) throw new Error(`${agent}: JSON オブジェクトの応答がありません`);
    return answer as Record<string, unknown>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
