import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Agent = "codex" | "claude" | "pi";
export function agentName(value: unknown = "codex"): Agent {
  if (value === "codex" || value === "claude" || value === "pi") return value;
  throw new Error("agent は codex、claude、pi のいずれかを指定してください");
}
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

export async function ask(agent: Agent, prompt: string, properties: Record<string, object>, model?: string): Promise<Record<string, unknown>> {
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

export type AgentRoute = { agent: Agent; model?: string };
export async function askTextFields(route: AgentRoute, prompt: string, keys: readonly string[]): Promise<Record<string, string>> {
  const fields = Object.fromEntries(keys.map(key => [key, { type: "string" }]));
  const reply = await ask(route.agent, prompt, fields, route.model);
  return Object.fromEntries(keys.map(key => {
    const value = reply[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${route.agent}: ${key} が空です`);
    return [key, value];
  }));
}
