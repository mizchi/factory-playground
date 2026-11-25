import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCandidate } from "./audit.ts";
import { digestOf, save } from "./checkpoint.ts";

const here = import.meta.dirname;

async function typecheck(source: string): Promise<string> {
  const compiler = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const child = spawn(process.execPath, [compiler, "--noEmit", "--strict", "--skipLibCheck",
    "--target", "ES2023", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--erasableSyntaxOnly", "--types", "node", "--typeRoots", join(here, "node_modules/@types"), source],
    { cwd: here, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  return new Promise<string>((done, fail) => {
    child.once("error", fail);
    child.once("close", code => {
      if (code === 0) done("");
      else if (code !== null && stdout.trim()) done(stdout.trim());
      else fail(new Error(stderr || "型検査の中断"));
    });
  });
}

// Both checks and subsequent model reviews refer to this exact revision.
type Candidate = { dir: string; path: string; digest: string };

export function saveCandidate(dir: string, source: string): Candidate {
  const path = join(dir, "solve.ts");
  writeFileSync(path, source);
  return { dir, path, digest: digestOf(source) };
}

export async function checkTypes({ dir, path, digest }: Candidate) {
  const diagnostics = await typecheck(path);
  save(join(dir, "types.json"), { sha256: digest, passed: !diagnostics, diagnostics });
  return diagnostics;
}

export async function checkSchedule({ dir, path, digest }: Candidate) {
  const audit = await inspectCandidate(path, false, true);
  save(join(dir, "audit.json"), audit);
  if (audit.submission_sha256 !== digest) throw new Error("監査中に候補が変更されました");
  const failure = audit.checks.find(check => check.error);
  const finding = failure ? `監査: ${failure.error}\n` + JSON.stringify({
    case: failure.case, jobs: failure.jobs.slice(0, 12), count: failure.jobs.length,
    optimum: failure.optimum, answer: failure.answer, stderr: failure.stderr?.slice(-1500),
  }).slice(0, 4500) : undefined;
  return { passed: audit.verdict === "PASS", checks: audit.checks.length, finding };
}
