import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Member } from "./pipeline.ts";
import type { Agent, Review } from "./model.ts";

export const digestOf = (source: string) => createHash("sha256").update(source).digest("hex");
export function save(path: string, data: unknown) {
  writeFileSync(path + ".tmp", JSON.stringify(data, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}

export type Checkpoint = {
  round: number; reuse: boolean; source: string; findings: string[]; instruction: string;
  freshDraft: boolean; reviews: [string, Review][];
};
export type Settings = { pipeline?: Member; agent?: Agent; model: string; intervalMs: number; taskHash: string };

export function loadCheckpoint(run: string): Checkpoint {
  const value = JSON.parse(readFileSync(join(run, "checkpoint.json"), "utf8"));
  if (!value || !Number.isSafeInteger(value.round) || value.round < 1 ||
      typeof value.source !== "string" || typeof value.instruction !== "string" ||
      typeof value.reuse !== "boolean" || typeof value.freshDraft !== "boolean" ||
      !Array.isArray(value.findings) || !value.findings.every((s: unknown) => typeof s === "string") ||
      !Array.isArray(value.reviews) || !value.reviews.every((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2) return false;
        const [key, review] = entry;
        return typeof key === "string" && typeof review?.assessment === "string" &&
          Array.isArray(review.findings) && review.findings.every((s: unknown) => typeof s === "string");
      })) throw new Error("checkpoint.json を読み取れません");
  return value;
}

export async function lockRun(run: string) {
  // The OS drops this SQLite write lock even on SIGKILL. No stale PID cleanup or expiry race.
  const { DatabaseSync } = await import("node:sqlite");
  const lock = new DatabaseSync(join(run, "owner.sqlite"));
  try {
    lock.exec("BEGIN IMMEDIATE");
    return lock;
  } catch (error) {
    lock.close();
    if ((error as { errcode?: number }).errcode === 5) throw new Error(`この実行は既に監督が実行中です: ${run}`);
    throw error;
  }
}
