import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "../..");
const runs = join(root, "runs");
const database = join(runs, ".rex-watch.sqlite");
type RexWindow = {
  window_id: string; focused_block_id: string;
  layers: { blocks: { block_id: string }[] }[];
};
type SessionView = { active_window_id: string; windows: RexWindow[] };
type SavedPane = { anchor: string; block: string };

export function selectWatchPane(view: SessionView, hint: string | undefined, saved: SavedPane[])
  : { anchor: string; block?: string } {
  const windows = new Map<string, string>();
  for (const window of view.windows) {
    for (const layer of window.layers) {
      for (const block of layer.blocks) windows.set(block.block_id, window.window_id);
    }
  }
  const live = saved.filter(({ anchor, block }) => windows.has(block) &&
    (!windows.has(anchor) || windows.get(anchor) === windows.get(block)));
  const targetFor = (anchor: string) =>
    live.find(p => p.anchor === anchor || p.block === anchor) ?? { anchor };

  if (hint && windows.has(hint)) return targetFor(hint);
  if (live.length === 1) return live[0];
  const focused = view.windows.find(w => w.window_id === view.active_window_id)?.focused_block_id;
  const inActive = live.filter(p => windows.get(p.block) === view.active_window_id);
  if (inActive.length === 1) return inActive[0];
  const editors = saved.filter(p => windows.has(p.anchor));
  if (!live.length && editors.length === 1) return { anchor: editors[0].anchor };
  if (focused && windows.has(focused)) return targetFor(focused);
  throw new Error("この Rex セッションに実況を表示できるペインがありません");
}

export function openPane(session: string, hint: string | undefined, submission: string): string {
  mkdirSync(runs, { recursive: true });
  const db = new DatabaseSync(database);
  try {
    // Serialize lookup and split when two launchers run at the same time.
    db.exec(`PRAGMA busy_timeout = 15000;
      CREATE TABLE IF NOT EXISTS watches (
        owner TEXT PRIMARY KEY, block TEXT NOT NULL, token TEXT UNIQUE NOT NULL, target TEXT NOT NULL
      );
      BEGIN IMMEDIATE;`);
    const snapshot = execFileSync("rex", ["session", "inspect", session, "--json"], { encoding: "utf8" });
    const rows = db.prepare("SELECT owner, block FROM watches WHERE owner LIKE ?").all(session + "/%");
    const saved = rows.map(row => ({ anchor: String(row.owner).slice(session.length + 1), block: String(row.block) }));
    const { anchor, block } = selectWatchPane(JSON.parse(snapshot), hint, saved);
    const owner = `${session}/${anchor}`;
    let id: string;
    if (block) {
      id = block;
      db.prepare("UPDATE watches SET target = ? WHERE owner = ?").run(submission, owner);
    } else {
      const token = randomUUID();
      id = execFileSync("rex", ["split", "-s", session, "-b", anchor, "--split=right",
        "--focus=false", "--label", "受注計画の実況", "-c", root, "--shell=none", "--",
        process.execPath, join(import.meta.dirname, "audit.ts"), "--pane-watch", token, submission,
      ], { encoding: "utf8" }).trim();
      db.prepare("INSERT OR REPLACE INTO watches (owner, block, token, target) VALUES (?, ?, ?, ?)")
        .run(owner, id, token, submission);
    }
    db.exec("COMMIT");
    return id;
  } finally {
    db.close();
  }
}

export function targetReader(token: string, initial: string): () => string {
  const db = new DatabaseSync(database, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 15000");
  const query = db.prepare("SELECT target FROM watches WHERE token = ?");
  let target = initial;
  return () => {
    const row = query.get(token);
    if (typeof row?.target === "string") target = row.target;
    return target;
  };
}
