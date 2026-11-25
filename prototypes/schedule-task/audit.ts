import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { cases, type TestCase } from "./cases.ts";

const root = resolve(import.meta.dirname, "../..");
const runs = join(root, "runs");
type Result = { exit: number | null; answer?: unknown; stderr?: string; stdout?: string; error?: string };

function checkPlan({ jobs, optimum }: TestCase, answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null || !("reward" in answer) || !Number.isSafeInteger(answer.reward))
    return "reward は整数で指定してください";
  if (!("ids" in answer) || !Array.isArray(answer.ids) || !answer.ids.every(id => typeof id === "string"))
    return "ids は文字列の配列で指定してください";
  const ids: string[] = answer.ids;
  const byId = new Map(jobs.map(job => [job.id, job]));
  if (new Set(ids).size !== ids.length || ids.some(id => !byId.has(id)))
    return "重複または未定義の ID があります";
  const plan = ids.map(id => byId.get(id)!).sort((a, b) => a.start - b.start);
  for (let i = 1; i < plan.length; i++) {
    if (plan[i - 1].end > plan[i].start)
      return `${plan[i - 1].id} と ${plan[i].id} の時間帯が重なっています`;
  }
  if (plan.reduce((sum, job) => sum + job.reward, 0) !== answer.reward)
    return "選んだ依頼の報酬合計が出力値と一致しません";
  if (answer.reward !== optimum) return `得られた報酬 ${answer.reward}、最適値 ${optimum}`;
}

async function evaluate(source: string, test: TestCase, live: boolean, generated: boolean): Promise<Result> {
  const work = mkdtempSync(join(tmpdir(), "schedule-case-"));
  try {
    const legacy = extname(source) === ".py";
    const filename = legacy ? "solve.py" : "solve.ts";
    copyFileSync(source, join(work, filename));
    return await new Promise<Result>(done => {
      const args = legacy ? ["-I", filename] : generated
        ? ["--permission", "--allow-fs-read=/dev/stdin", "--allow-fs-read=/dev/fd/0", filename] : [filename];
      const child = execFile(legacy ? "python3" : process.execPath, args, {
        cwd: work, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 2 ** 20,
        env: { ...(generated ? {} : process.env), SCHEDULE_TRACE: live && test.name === "greedy-trap" ? "1" : "0" },
        encoding: "buffer",
      }, (err, stdout, stderr) => {
        const result: Result = { exit: err ? (typeof err.code === "number" ? err.code : null) : 0 };
        if (stderr.length) result.stderr = stderr.toString();
        if (err) {
          result.error = err.killed ? "5秒でタイムアウト" : `実行失敗: ${err.code ?? err.signal ?? err.message}`;
        } else {
          try {
            result.answer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout));
            result.error = checkPlan(test, result.answer);
          } catch {
            result.error = "出力が UTF-8 の JSON ではありません";
            result.stdout = stdout.toString();
          }
        }
        done(result);
      });
      if (live) child.stderr?.on("data", chunk => process.stderr.write(chunk));
      // A CLI may finish or fail before it reads all of stdin.
      child.stdin?.on("error", () => {});
      child.stdin?.end(JSON.stringify(test.jobs));
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function inspectCandidate(source: string, live: boolean, generated = false) {
  const checks = [];
  let verdict = "PASS";
  for (const test of cases()) {
    if (live) console.log(`採点中 ${test.name} (${test.jobs.length}件)`);
    const result = await evaluate(source, test, live, generated);
    checks.push({ case: test.name, jobs: test.jobs, optimum: test.optimum, ...result });
    if (result.error) {
      verdict = "FAIL";
      console.log(`FAIL ${test.name}: ${result.error}`);
      if (test.jobs.length <= 10) console.log("反例の入力:", JSON.stringify(test.jobs));
      if (result.answer !== undefined) console.log("提出の出力:", JSON.stringify(result.answer));
      break;
    }
    console.log(`PASS ${test.name}: ${test.jobs.length}件、最適報酬 ${test.optimum}`);
  }
  return { verdict, submission_sha256: createHash("sha256").update(readFileSync(source)).digest("hex"), checks };
}

async function audit(submission: string, bytes: Buffer, live: boolean) {
  mkdirSync(runs, { recursive: true });
  const run = mkdtempSync(join(runs, "schedule-audit-"));
  const source = join(run, "solve" + extname(submission));
  writeFileSync(source, bytes);
  copyFileSync(join(import.meta.dirname, "task.md"), join(run, "task.md"));
  console.log(`記録: ${run}`);
  const record = await inspectCandidate(source, live);
  const { verdict } = record;
  writeFileSync(join(run, "audit.json"), JSON.stringify(record) + "\n");
  console.log(`監査: ${verdict}  再実行: just schedule ${relative(root, source)}`);
  return verdict === "PASS" ? 0 : 1;
}

// Snapshot the latest saved contents; saves during a run are picked up after it finishes.
async function watch(target: () => string) {
  let submission: string | undefined;
  let previous: Buffer | undefined;
  let waiting = false;
  for (;;) {
    const current = target();
    if (submission !== current) {
      submission = current;
      previous = undefined;
      waiting = false;
      console.log(`監視中: ${submission}（Ctrl+C で終了）`);
    }
    let bytes: Buffer | undefined;
    try {
      bytes = readFileSync(submission);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!bytes) {
      if (!waiting) console.log("提出ファイルの作成を待っています");
      waiting = true;
      previous = undefined;
    } else if (!previous?.equals(bytes)) {
      waiting = false;
      previous = bytes;
      await audit(submission, bytes, true);
      console.log("次の保存を待っています");
    }
    await sleep(200);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0]?.startsWith("--") ? args.shift() : undefined;
  const token = mode === "--pane-watch" ? args.shift() : undefined;
  const [submission] = args;
  if (args.length !== 1 || ![".ts", ".py"].includes(extname(submission)) ||
      (mode && !["--watch", "--rex-watch", "--pane-watch"].includes(mode))) {
    console.error("usage: audit.ts [--watch] solve.ts");
    process.exitCode = 2;
  } else {
    try {
      const path = resolve(submission);
      if (mode === "--rex-watch") {
        const { openPane } = await import("./rex-pane.ts");
        console.log(openPane(process.env.REX_SESSION!, process.env.REX_BLOCK, path));
      } else if (mode === "--pane-watch" && token) {
        const { targetReader } = await import("./rex-pane.ts");
        await watch(targetReader(token, path));
      } else if (mode === "--watch") await watch(() => path);
      else process.exitCode = await audit(submission, readFileSync(submission), false);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    }
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
