import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentName, askTextFields, type AgentRoute } from "./agent.mts";
import { checkArtifact } from "./checks.mts";

type Spec = { task: string; criteria: string[]; requiredHeadings: string[]; maxRevisions: number; author: AgentRoute; reviewer: AgentRoute };
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(text); }

export function loadSpec(path: string): Spec {
  const s = JSON.parse(readFileSync(path, "utf8"));
  if (!s || !text(s.task) || !strings(s.criteria) || !s.criteria.length || !strings(s.requiredHeadings) ||
      !Number.isSafeInteger(s.maxRevisions) || s.maxRevisions < 0) throw new Error("依頼、判定条件、必須見出し、改稿上限を確認してください");
  for (const route of [s.author, s.reviewer]) {
    if (!route || !text(route.agent) || (route.model !== undefined && !text(route.model))) throw new Error("担当の設定が不正です");
    agentName(route.agent);
  }
  return s;
}

export async function produce(spec: Spec, run: string, call = askTextFields) {
  const write = (path: string, value: unknown) => writeFileSync(join(run, path), JSON.stringify(value, null, 2) + "\n");
  write("request.json", spec);
  const brief = JSON.stringify({ task: spec.task, criteria: spec.criteria, requiredHeadings: spec.requiredHeadings });
  let revision = "";
  for (let draft = 1; draft <= spec.maxRevisions + 1; draft++) {
    const dir = `draft-${draft}`;
    mkdirSync(join(run, dir));
    const { artifact } = await call(spec.author, `次の依頼の納品物を Markdown 全文で artifact に返す。requiredHeadings はレベル2見出し。\n${brief}\n${revision}`, ["artifact"]);
    writeFileSync(join(run, dir, "artifact.md"), artifact);
    const findings = checkArtifact(artifact, spec.requiredHeadings);
    write(join(dir, "checks.json"), { findings });
    let status = "NEEDS_EDIT";
    if (!findings.length) {
      const review = await call(spec.reviewer, `独立した編集者として依頼と成果物を照合する。status は ACCEPT または REVISE。quote は判定に関わる成果物からの連続した原文。reason に具体的な判断根拠または修正を1点書く。\n依頼: ${brief}\n成果物:\n${artifact}`, ["status", "quote", "reason"]);
      const grounded = text(review.quote) && artifact.includes(review.quote) && ["ACCEPT", "REVISE"].includes(review.status);
      write(join(dir, "review.json"), { ...review, citationVerified: grounded });
      if (!grounded) status = "CHECK_ASSESSMENT";
      else if (review.status === "ACCEPT") status = "ACCEPTED";
      else findings.push(review.reason);
    }
    console.log(`${dir} ${status}`);
    if (status !== "NEEDS_EDIT" || draft === spec.maxRevisions + 1) {
      if (status === "ACCEPTED") writeFileSync(join(run, "delivery.md"), artifact);
      const result = { status, draft };
      write("result.json", result);
      return result;
    }
    revision = `前稿:\n${artifact}\n今回の修正要求:\n${findings.join("\n")}`;
  }
  throw new Error("改稿上限が不正です");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const spec = loadSpec(process.argv[2] || join(import.meta.dirname, "factory.json"));
  if (process.argv[3]?.trim()) spec.task = process.argv[3];
  const runs = resolve("runs");
  mkdirSync(runs, { recursive: true });
  const run = mkdtempSync(join(runs, "factory-template-"));
  console.log(`実行記録: ${run}`);
  try {
    const result = await produce(spec, run);
    if (result.status !== "ACCEPTED") process.exitCode = 1;
  } catch (error) {
    writeFileSync(join(run, "result.json"), JSON.stringify({ status: "ERROR", message: String(error) }) + "\n");
    throw error;
  }
}
