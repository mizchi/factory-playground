import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { save } from "./checkpoint.ts";
import { agentName, teamBrief, type Agent } from "./model.ts";

const jobs = ["implement", "review-correctness", "review-implementation"] as const;
export type Job = typeof jobs[number];
type Role = Job | "lead" | "memo";
export type Member = { id: string; agent: Agent; model?: string; task: string; reads?: string[]; job?: Job; children?: Member[] };
type Stage = { member: Member; role: Role; ancestors: string[] };
type Entry = { author: string; role: Role | "decision"; round: number; memo: string; broadcast?: string; sha256?: string };
type Board = { entries: Entry[] };

function stages(root: Member) {
  const result: Stage[] = [];
  function visit(member: Member, ancestors: string[]) {
    result.push({ member, role: member.children?.length ? "lead" : member.job ?? "memo", ancestors });
    for (const child of member.children ?? []) visit(child, [...ancestors, member.id]);
  }
  visit(root, []);
  return result;
}

export function parsePipeline(value: unknown): Member {
  const ids = new Set<string>();
  function parse(raw: unknown): Member {
    if (!raw || typeof raw !== "object") throw new Error("工程の設定が不正です");
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || !/^[a-z][\w-]*$/.test(node.id) || ids.has(node.id))
      throw new Error("工程には一意の id が必要です");
    if (node.reads !== undefined && (!Array.isArray(node.reads) ||
        !node.reads.every(id => typeof id === "string" && ids.has(id)))) throw new Error(`reads は先行工程の id を指定してください: ${node.id}`);
    ids.add(node.id);
    if (!node.agent || typeof node.task !== "string" || !node.task.trim() ||
        (node.model !== undefined && (typeof node.model !== "string" || !node.model.trim())) ||
        (node.job !== undefined && !jobs.includes(node.job as Job)) ||
        (node.children !== undefined && (!Array.isArray(node.children) || !node.children.length || node.job)))
      throw new Error(`工程の設定が不正です: ${node.id}`);
    return { id: node.id, agent: agentName(node.agent), model: node.model as string | undefined, task: node.task,
      reads: node.reads as string[] | undefined, job: node.job as Job | undefined, children: (node.children as unknown[] | undefined)?.map(parse) };
  }
  const root = parse(value);
  const ordered = stages(root);
  if (!root.children || ordered.flatMap(s => s.member.job ?? []).join() !== jobs.join() ||
      ordered.at(-1)?.role !== "review-implementation")
    throw new Error("実装、正しさレビュー、実装品質レビューをこの順で各1つ置き、最後を実装品質レビューにしてください");
  return root;
}

type Announcement = { id: string; author: string; message: string };

export function announce(run: string, author: string, message: string) {
  const settings = JSON.parse(readFileSync(join(run, "supervisor.json"), "utf8"));
  if (!settings.pipeline) throw new Error("パイプラインの実行を指定してください");
  if (!stages(parsePipeline(settings.pipeline)).some(s => s.member.id === author && s.role === "lead"))
    throw new Error("送信元は子を持つ工程の id を指定してください");
  if (existsSync(join(run, "result.json")) && JSON.parse(readFileSync(join(run, "result.json"), "utf8")).status === "DELIVERED")
    throw new Error("この実行は納品済みです");
  if (!message.trim() || message.length > 500) throw new Error("指示は1〜500文字で指定してください");
  const dir = join(run, "broadcasts");
  mkdirSync(dir, { recursive: true });
  const entry: Announcement = { id: randomUUID(), author, message: message.trim() };
  const pending = join(dir, entry.id + ".tmp");
  writeFileSync(pending, JSON.stringify(entry) + "\n", { flag: "wx" });
  renameSync(pending, join(dir, author + ".json"));
  return entry;
}

export function openPipeline(root: Member, run: string) {
  const ordered = stages(root);
  const path = join(run, "team-board.json");
  const board: Board = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { entries: [] };
  function publish(entry: Entry) {
    // The run owner holds the exclusive factory lock. Replace the snapshot atomically.
    board.entries = board.entries.filter(e => e.author !== entry.author || e.role !== entry.role);
    board.entries.push(entry);
    save(path, board);
  }
  function input(stage: Stage, prompt: string, round: number, record: (detail: object) => void, phase: Role | "decision" = stage.role) {
    const { member, ancestors, role } = stage;
    const visible = board.entries.filter(e => e.author !== member.id && e.role !== "decision" &&
      !(role.startsWith("review-") && e.role.startsWith("review-")));
    const recent = visible.slice(-6);
    const notes = visible.filter(e => member.reads?.includes(e.author) || recent.includes(e));
    const broadcasts = board.entries.filter(e => e.broadcast && ancestors.includes(e.author));
    const announcements: Announcement[] = [];
    for (const ancestor of ancestors) {
      const file = join(run, "broadcasts", ancestor + ".json");
      if (existsSync(file)) announcements.push(JSON.parse(readFileSync(file, "utf8")));
    }
    const format = (e: Entry, text: string) => `[${e.author} / round-${e.round}] ${text}`;
    const message = [prompt, `担当: ${member.id} (${role})。任務: ${member.task}`,
      ...broadcasts.map(e => "親からの一斉指示 " + format(e, e.broadcast!)),
      ...announcements.map(e => `親からの追加指示 [${e.author}] ${e.message}`),
      ...notes.map(e => "共有メモ " + format(e, e.memo.slice(0, 260)))].join("\n");
    record({ round, role: phase, member: member.id, parent: ancestors.at(-1) ?? null, agent: member.agent,
      model: member.model ?? "default", notes: notes.map(e => e.author), broadcasts: broadcasts.map(e => e.author),
      announcements: announcements.map(e => e.id), inputBytes: Buffer.byteLength(message) });
    return message;
  }
  function stageFor(job: Job) { return ordered.find(s => s.role === job)!; }
  async function prepare(job: Job, contract: string, round: number, record: (detail: object) => void, working: (phase: string) => void) {
    const end = ordered.indexOf(stageFor(job));
    let start = end;
    while (start > 0 && !ordered[start - 1].member.job) start--;
    for (const stage of ordered.slice(start, end)) {
      if (board.entries.some(e => e.author === stage.member.id && e.role === stage.role)) continue;
      working(`引き継ぎ: ${stage.member.id}`);
      const lead = stage.role === "lead";
      const prompt = contract + "\n担当工程を実行し、後工程が使う具体的な結論を memo に短く記す。" +
        (lead ? "全子孫に必要な作業指示を broadcast に1文で記す。" : "");
      const reply = await teamBrief(stage.member.agent, stage.member.model, input(stage, prompt, round, record), lead);
      publish({ author: stage.member.id, role: stage.role, round, memo: reply.memo.slice(0, 800), broadcast: reply.broadcast?.slice(0, 500) });
    }
  }
  return { prepare, stageFor, root: ordered[0], input, publish };
}


if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const [run, parent, text] = process.argv.slice(2);
    if (!run || !parent || !text) throw new Error("usage: pipeline.ts RUN PARENT MESSAGE");
    const announcement = announce(run, parent, text);
    console.log(`一斉指示を保存: ${announcement.author} ${announcement.id}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
