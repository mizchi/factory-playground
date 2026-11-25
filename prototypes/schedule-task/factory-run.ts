import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkSchedule, checkTypes, saveCandidate } from "./candidate.ts";
import { digestOf, save, type Checkpoint } from "./checkpoint.ts";
import { contextOverflow, feedbackExcerpt } from "./context.ts";
import { startHeartbeat, type Supervision } from "./heartbeat.ts";
import { factoryModel, teamImplement, type Agent, type Decision, type FactoryModel, type Review } from "./model.ts";
import { openPipeline, type Member } from "./pipeline.ts";

const perspectives = [
  ["correctness", "正しさ。境界が接する区間、同点、負の報酬、ID 復元を含め、具体例から実装の不変条件を点検する。"],
  ["implementation", "実装品質。最悪時の時間・空間、入出力、型と可読性をコードに即して点検する。"],
] as const;

type Mode = { rounds: number; supervisor?: never } | { supervisor: Supervision; rounds?: never };
export type RunOptions = Mode & { pipeline?: Member; seed?: string; agent?: Agent; model?: FactoryModel; runs?: string };

export async function executeFactory(run: string, task: string, { rounds, supervisor, seed, pipeline, agent = "codex", model = factoryModel(agent) }: RunOptions, saved?: Checkpoint) {
  let source = saved?.source ?? "";
  let findings: string[] = saved?.findings ?? [];
  let round = saved?.round ?? 1;
  let reuse = saved?.reuse ?? Boolean(seed);
  let instruction = saved?.instruction ?? "";
  let freshDraft = saved?.freshDraft ?? false;
  const [contract] = task.split("\n## 実行例");
  const title = contract.split("\n", 1)[0];
  const team = pipeline && openPipeline(pipeline, run);
  function record(detail: object) {
    appendFileSync(join(run, "context.jsonl"), JSON.stringify(detail) + "\n");
  }
  function input(role: string, prompt: string) {
    record({ round, role, inputBytes: Buffer.byteLength(prompt) });
    return prompt;
  }
  const heartbeat = supervisor && startHeartbeat({
    ...supervisor, decide: prompt => supervisor.decide(team ? team.input(team.root, prompt, round, record, "decision") : input("supervisor", prompt)),
  }, title, join(run, "heartbeat.jsonl"));
  function working(phase: string) {
    heartbeat?.working(round, phase);
    console.log(`[${round}] ${phase}`);
  }
  function applyDecision(decision: Decision) {
    instruction = decision.reason;
    if (team && decision.action === "resume") team.publish({ author: team.root.member.id, role: "decision", round,
      memo: "", broadcast: decision.reason.slice(0, 500) });
  }
  // Only retain completed reviews while retrying an interrupted check of the same source.
  const partialReviews = new Map<string, Review>(saved?.reviews);
  function checkpoint(nextRound = round) {
    if (supervisor) save(join(run, "checkpoint.json"), {
      round: nextRound, reuse, source, findings, instruction, freshDraft, reviews: [...partialReviews],
    } satisfies Checkpoint);
  }
  function finish(status: "DELIVERED" | "EXHAUSTED" | "ERROR", detail: object) {
    save(join(run, "result.json"), { status, round, agent, maxRounds: rounds ?? null, ...(supervisor && { supervisor: supervisor.model }), ...detail });
    console.log(`${status}: ${run}`);
    return { status, run };
  }
  async function checkRound(dir: string, label: string) {
    const candidate = saveCandidate(dir, source);
    const { digest } = candidate;
    findings = [];
    heartbeat?.working(round, "型検査");
    const diagnostics = await checkTypes(candidate);
    if (diagnostics) findings.push(diagnostics);
    heartbeat?.working(round, "独立監査");
    const audit = await checkSchedule(candidate);
    if (audit.finding) findings.push(audit.finding);
    if (findings.length || !audit.passed) {
      save(join(dir, "feedback.json"), { sha256: digest, findings, reviews: "skipped" });
      return { passed: false, digest, checks: audit.checks };
    }
    for (const [name, focus] of perspectives) {
      const role = `review-${name}` as const;
      await team?.prepare(role, contract, round, record, working);
      const stage = team?.stageFor(role);
      heartbeat?.working(round, `セルフレビュー: ${name}`);
      console.log(`[${label}] セルフレビュー: ${name}`);
      const key = `${digest}:${name}`;
      let review = partialReviews.get(key);
      if (!review) {
        const prompt = `${focus}\n${contract}\n提出:\n${source}\n` +
          "型検査・独立監査は合格。assessment に根拠を1文、findings に実質的な問題と修正要求を簡潔に記す。問題がなければ空配列。";
        review = stage && team
          ? await factoryModel(stage.member.agent, stage.member.model).review(team.input(stage, prompt, round, record))
          : await model.review(input(role, prompt));
        partialReviews.set(key, review);
        checkpoint();
      }
      if (team && stage) team.publish({ author: stage.member.id, role, round, sha256: digest,
        memo: feedbackExcerpt([...review.findings, review.assessment], 800) });
      save(join(dir, `review-${name}.json`), { sha256: digest, ...review });
      console.log(`  指摘 ${review.findings.length}件: ${review.assessment}`);
      findings.push(...review.findings.map(text => `${name}: ${text}`));
    }
    save(join(dir, "feedback.json"), { sha256: digest, findings });
    return { passed: !findings.length, digest, checks: audit.checks };
  }

  try {
    // Read the optional seed once. On interruption a materialized candidate can be checked again.
    if (seed) source = readFileSync(seed, "utf8");
    checkpoint();
    process.send?.({ run });
    console.log(`factory: ${run}`);
    if (saved) console.log(`第${round}稿から再開`);
    for (;; round++) {
      const evidence = `round-${round}`;
      const dir = join(run, evidence);
      mkdirSync(dir, { recursive: true });
      const label = rounds ? `${round}/${rounds}` : String(round);
      const phase = reuse ? "候補を検査" : source ? "指摘をもとに修正" : "仕様から実装";
      console.log(`[${label}] ${phase}`);
      heartbeat?.working(round, phase);
      let checked: Awaited<ReturnType<typeof checkRound>>;
      try {
        await team?.prepare("implement", contract, round, record, working);
        heartbeat?.working(round, phase);
        if (!reuse) {
          partialReviews.clear();
          const prior = !freshDraft && source.length <= 16_000 ? source : "";
          const feedback = feedbackExcerpt(findings, 2400);
          const prompt = `外部ツールを使わず strict TypeScript の全文を source に返す。\n${contract}` +
            (prior ? `\n前稿:\n${prior}` : "") + (feedback ? `\n修正要求:\n${feedback}` : "") +
            (instruction ? `\n監督の指示:\n${instruction.slice(0, 500)}` : "") +
            (freshDraft ? "\n前回は文脈上限を超えた。仕様から簡潔に再実装する。" : "");
          if (team) {
            const stage = team.stageFor("implement");
            const reply = await teamImplement(stage.member.agent, stage.member.model,
              team.input(stage, prompt + "\n実装の引き継ぎを memo に1文で記す。", round, record));
            source = reply.source;
            team.publish({ author: stage.member.id, role: "implement", round, sha256: digestOf(source), memo: reply.memo.slice(0, 800) });
          } else {
            source = await model.implement(input("implement", prompt));
          }
          freshDraft = false;
        }
        reuse = true;
        checkpoint();
        checked = await checkRound(dir, label);
      } catch (error) {
        if (!heartbeat) throw error;
        const message = String(error);
        save(join(dir, "interruption.json"), { message });
        if (contextOverflow(error)) {
          reuse = false;
          freshDraft = true;
        }
        const decision = await heartbeat.assess({ round, state: "interrupted", evidence, findings: [message, ...findings] });
        applyDecision(decision);
        checkpoint(round + 1);
        continue;
      }
      if (heartbeat) {
        const decision = await heartbeat.assess({
          round, state: checked.passed ? "verified" : "incomplete",
          evidence: `${evidence}: sha256=${checked.digest}, audit cases=${checked.checks}`, findings,
        });
        applyDecision(decision);
        if (decision.action === "resume") {
          reuse = false;
          checkpoint(round + 1);
          continue;
        }
      }
      if (checked.passed) {
        writeFileSync(join(run, "solve.ts.tmp"), source);
        renameSync(join(run, "solve.ts.tmp"), join(run, "solve.ts"));
        return finish("DELIVERED", { sha256: checked.digest, artifact: "solve.ts", evidence });
      }
      if (round === rounds) return finish("EXHAUSTED", { findings });
      reuse = false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return finish("ERROR", { message });
  } finally {
    heartbeat?.close();
  }
}
