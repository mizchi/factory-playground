import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestOf, loadCheckpoint, lockRun, save, type Settings } from "./checkpoint.ts";
import { executeFactory, type RunOptions } from "./factory-run.ts";
import { agentName, agentSupervisor, type Agent } from "./model.ts";
import { parsePipeline } from "./pipeline.ts";

const here = import.meta.dirname;
const defaultRuns = resolve(here, "../../runs");
type FactoryOptions = RunOptions | { resume: string };

function supervision(agent: Agent, model: string | undefined, intervalMs: number) {
  return { model: model || agent + "-default", intervalMs, decide: agentSupervisor(agent, model) };
}

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

export async function runFactory(options: FactoryOptions) {
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
      const model = settings.model === agent + "-default" ? undefined : settings.model;
      return await executeFactory(run, task, {
        agent, pipeline: settings.pipeline && parsePipeline(settings.pipeline),
        supervisor: supervision(agent, model, settings.intervalMs),
      }, loadCheckpoint(run));
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

function commandOptions([mode, ...args]: string[]): FactoryOptions {
  switch (mode) {
    case "--resume": {
      const [resume] = args;
      if (!resume) throw new Error("再開する実行ディレクトリを指定してください");
      return { resume };
    }
    case "--pipeline": {
      const [path, seconds = "30", seed] = args;
      if (!path) throw new Error("工程の設定ファイルを指定してください");
      const pipeline = parsePipeline(JSON.parse(readFileSync(path, "utf8")));
      return { pipeline, agent: pipeline.agent, seed,
        supervisor: supervision(pipeline.agent, pipeline.model, Number(seconds) * 1000) };
    }
    case "--supervise": {
      const [model, seconds = "30", seed, selected] = args;
      const agent = agentName(selected);
      return { agent, seed, supervisor: supervision(agent, model, Number(seconds) * 1000) };
    }
    default: {
      const [seed, selected] = args;
      return { rounds: Number(mode ?? 3), seed, agent: agentName(selected) };
    }
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (process.send && process.env.FACTORY_WATCHDOG === "1") {
    // The watchdog starts us as process-group leader. Release the lock and stop our children if it disappears.
    process.once("disconnect", () => process.kill(-process.pid, "SIGTERM"));
    process.channel?.unref();
  }
  try {
    const options = commandOptions(process.argv.slice(2));
    const { status } = await runFactory(options);
    process.exitCode = status === "DELIVERED" ? 0 : status === "EXHAUSTED" ? 1 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
