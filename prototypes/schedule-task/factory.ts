import { spawn } from "node:child_process";
import { digestOf, loadCheckpoint, lockRun, save, type Checkpoint, type Settings } from "./checkpoint.ts";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCandidate } from "./audit.ts";
import { startHeartbeat, type Supervision } from "./heartbeat.ts";
import { contextOverflow, feedbackExcerpt } from "./context.ts";
import { openPipeline, parsePipeline, type Member } from "./pipeline.ts";
import { agentName, agentSupervisor, factoryModel, teamImplement, type Agent, type FactoryModel, type Review } from "./model.ts";

const here = import.meta.dirname;
const defaultRuns = resolve(here, "../../runs");
const perspectives = [
  ["correctness", "正しさ。境界が接する区間、同点、負の報酬、ID 復元を含め、具体例から実装の不変条件を点検する。"],
  ["implementation", "実装品質。最悪時の時間・空間、入出力、型と可読性をコードに即して点検する。"],
] as const;

async function typecheck(source: string): Promise<string> {
  const compiler = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const child = spawn(process.execPath, [compiler, "--noEmit", "--strict", "--skipLibCheck",
    "--target", "ES2023", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--erasableSyntaxOnly", "--types", "node", "--typeRoots", join(here, "node_modules/@types"), source],
    { cwd: here, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  return new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", code => {
      if (code === 0) done("");
      else if (code !== null && stdout.trim()) done(stdout.trim());
      else fail(new Error(stderr || "型検査の中断"));
    });
  });
}

type Mode = { rounds: number; supervisor?: never } | { supervisor: Supervision; rounds?: never };
type Options = Mode & { pipeline?: Member; seed?: string; agent?: Agent; model?: FactoryModel; runs?: string };
type ResumeOptions = { resume: string };
function deliveredResult(run: string) {
  const path = join(run, "result.json");
  if (!existsSync(path)) return;
  const result = JSON.parse(readFileSync(path, "utf8"));
  if (result.status !== "DELIVERED") return;
  if (result.sha256 !== digestOf(readFileSync(join(run, "solve.ts"), "utf8")))
    throw new Error("納品物のハッシュが一致しません");
  console.log(`DELIVERED: ${run}`);
  return { status: "DELIVERED", run };
}

export async function runFactory(options: Options | ResumeOptions) {
  const resuming = "resume" in options;
  let run: string;
  if (resuming) {
    run = resolve(options.resume);
    if (!existsSync(join(run, "supervisor.json"))) {
      const completed = deliveredResult(run);
      if (completed) return completed;
      throw new Error("この実行には再開用の supervisor.json がありません");
    }
  } else {
    const runs = options.runs ?? defaultRuns;
    if (!options.supervisor && (!Number.isSafeInteger(options.rounds) || options.rounds! < 1))
      throw new Error("試行上限には正の整数を指定してください");
    mkdirSync(runs, { recursive: true });
    run = mkdtempSync(join(runs, "schedule-factory-"));
  }
  const lock = (resuming || options.supervisor) ? await lockRun(run) : undefined;
  try {
    if (resuming) {
      const settings: Settings = JSON.parse(readFileSync(join(run, "supervisor.json"), "utf8"));
      const task = readFileSync(join(run, "task.md"), "utf8");
      if (digestOf(task) !== settings.taskHash) throw new Error("保存した依頼書のハッシュが一致しません");
      const completed = deliveredResult(run);
      if (completed) return completed;
      const agent = agentName(settings.agent);
      return await executeFactory(run, task, { agent, pipeline: settings.pipeline && parsePipeline(settings.pipeline), supervisor: {
        ...settings, decide: agentSupervisor(agent, settings.model === agent + "-default" ? undefined : settings.model),
      } }, loadCheckpoint(run));
    }
    const task = readFileSync(join(here, "task.md"), "utf8");
    writeFileSync(join(run, "task.md"), task);
    if (options.supervisor) {
      const { model, intervalMs } = options.supervisor;
      save(join(run, "supervisor.json"), { model, intervalMs, pipeline: options.pipeline, agent: options.agent ?? "codex", taskHash: digestOf(task) } satisfies Settings);
    }
    return await executeFactory(run, task, options);
  } finally {
    lock?.close();
  }
}

async function executeFactory(run: string, task: string, { rounds, supervisor, seed, pipeline, agent = "codex", model = factoryModel(agent) }: Options, saved?: Checkpoint) {
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
  function broadcast(decision: { action: string; reason: string }) {
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
    const candidate = join(dir, "solve.ts");
    writeFileSync(candidate, source);
    const digest = digestOf(source);
    // All votes and mechanical checks belong to this exact source revision.
    findings = [];
    heartbeat?.working(round, "型検査");
    const diagnostics = await typecheck(candidate);
    save(join(dir, "types.json"), { sha256: digest, passed: !diagnostics, diagnostics });
    if (diagnostics) findings.push(diagnostics);
    heartbeat?.working(round, "独立監査");
    const audit = await inspectCandidate(candidate, false, true);
    save(join(dir, "audit.json"), audit);
    if (audit.submission_sha256 !== digest) throw new Error("監査中に候補が変更されました");
    const failure = audit.checks.find(check => check.error);
    if (failure) {
      findings.push(`監査: ${failure.error}\n` + JSON.stringify({
        case: failure.case, jobs: failure.jobs.slice(0, 12), count: failure.jobs.length,
        optimum: failure.optimum, answer: failure.answer, stderr: failure.stderr?.slice(-1500),
      }).slice(0, 4500));
    }
    if (findings.length || audit.verdict !== "PASS") {
      save(join(dir, "feedback.json"), { sha256: digest, findings, reviews: "skipped" });
      return { passed: false, digest, checks: audit.checks.length };
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
    return { passed: !findings.length && audit.verdict === "PASS", digest, checks: audit.checks.length };
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
        broadcast(decision);
        instruction = decision.reason;
        checkpoint(round + 1);
        continue;
      }
      if (heartbeat) {
        const decision = await heartbeat.assess({
          round, state: checked.passed ? "verified" : "incomplete",
          evidence: `${evidence}: sha256=${checked.digest}, audit cases=${checked.checks}`, findings,
        });
        broadcast(decision);
        instruction = decision.reason;
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

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (process.send && process.env.FACTORY_WATCHDOG === "1") {
    // The watchdog starts us as process-group leader. Release the lock and stop our children if it disappears.
    process.once("disconnect", () => process.kill(-process.pid, "SIGTERM"));
    process.channel?.unref();
  }
  const [, , mode, model, seconds, seed, selected] = process.argv;
  try {
    let options: Options | ResumeOptions;
    if (mode === "--resume") {
      if (!model) throw new Error("再開する実行ディレクトリを指定してください");
      options = { resume: model };
    } else if (mode === "--pipeline") {
      if (!model) throw new Error("工程の設定ファイルを指定してください");
      const pipeline = parsePipeline(JSON.parse(readFileSync(model, "utf8")));
      options = { pipeline, agent: pipeline.agent, seed, supervisor: {
        model: pipeline.model ?? pipeline.agent + "-default", intervalMs: Number(seconds ?? 30) * 1000,
        decide: agentSupervisor(pipeline.agent, pipeline.model),
      } };
    } else if (mode === "--supervise") {
      const agent = agentName(selected);
      options = { agent, supervisor: { model: model || agent + "-default", decide: agentSupervisor(agent, model),
        intervalMs: Number(seconds ?? 30) * 1000 }, seed };
    } else {
      options = { rounds: Number(mode ?? 3), seed: model, agent: agentName(seconds) };
    }
    const { status } = await runFactory(options);
    process.exitCode = status === "DELIVERED" ? 0 : status === "EXHAUSTED" ? 1 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
