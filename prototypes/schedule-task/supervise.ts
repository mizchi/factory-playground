// Foreground watchdog. Only this process restarts the supervisor. It never calls a model.
import { fork } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
let run = args[0] === "--resume" ? args[1] : undefined;
let group: number | undefined;
let restarts = 0;
const stopping = new AbortController();

function signalGroup(signal: NodeJS.Signals) {
  if (group === undefined) return;
  try { process.kill(-group, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
function stop(signal: NodeJS.Signals) {
  stopping.abort();
  signalGroup(signal);
  process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(signal));

while (!stopping.signal.aborted) {
  const child = fork(join(import.meta.dirname, "factory.ts"), run ? ["--resume", run] : args, {
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
    env: { ...process.env, FACTORY_WATCHDOG: "1" },
  });
  group = child.pid;
  console.log(`supervisor pid=${group}`);
  child.on("message", message => {
    if (typeof message === "object" && message && "run" in message && typeof message.run === "string")
      run = message.run;
  });
  const [code, signal] = await once(child, "exit");
  // A model or a compiler may still be alive after its supervisor crashed.
  signalGroup("SIGKILL");
  group = undefined;
  if (stopping.signal.aborted) break;
  if (!run || code === 0 || code === 2 || ["SIGTERM", "SIGINT", "SIGHUP"].includes(signal)) {
    process.exitCode = code ?? 1;
    break;
  }
  const delay = Math.min(1000 * 2 ** restarts++, 60_000);
  console.error(`監督が異常終了 (${signal ?? code})。同じ実行を ${delay / 1000} 秒後に再開: ${run}`);
  try { await sleep(delay, undefined, { signal: stopping.signal }); }
  catch (error) { if (!stopping.signal.aborted) throw error; }
}
