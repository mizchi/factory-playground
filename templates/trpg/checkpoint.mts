import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Call, Entry } from "./session.mts";

const sections = ["secret", "clues", "routes", "ending", "npc", "handouts", "beats"] as const;
type Section = typeof sections[number];
export type Context = {
  metadata: Record<string,string>;
  gm: { sections: Section[]; history: "all" | "scene"; notes: string; metadataKeys: string[] };
};
export const defaultContext: Context = { metadata: {}, gm: { sections: [...sections], history: "all", notes: "", metadataKeys: [] } };
const object = (v: unknown): v is Record<string,unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const read = (path: string) => JSON.parse(readFileSync(path,"utf8"));

export function contextWith(base: Context, patch: unknown): Context {
  if (!object(patch) || Object.keys(patch).some(k => k !== "metadata" && k !== "gm"))
    throw new Error("context には metadata と gm を指定できます");
  const meta = patch.metadata === undefined ? {} : patch.metadata;
  const gm = patch.gm === undefined ? {} : patch.gm;
  if (!object(meta) || !Object.values(meta).every(v => typeof v === "string") ||
      !object(gm) || Object.keys(gm).some(k => !["sections","history","notes","metadataKeys"].includes(k)))
    throw new Error("metadata は文字列の辞書、gm は sections / history / notes / metadataKeys です");
  const selected = gm.sections === undefined ? base.gm.sections : gm.sections;
  const history = gm.history === undefined ? base.gm.history : gm.history;
  const notes = gm.notes === undefined ? base.gm.notes : gm.notes;
  const metadataKeys = gm.metadataKeys === undefined ? base.gm.metadataKeys : gm.metadataKeys;
  const metadata = {...base.metadata, ...meta} as Record<string,string>;
  if (!Array.isArray(metadataKeys) || !metadataKeys.every(k => typeof k === "string" && Object.hasOwn(metadata,k)))
    throw new Error("gm.metadataKeys は登録済みの metadata のキーを指定してください");
  if (!Array.isArray(selected) || !selected.every(s => sections.includes(s)) ||
      (history !== "all" && history !== "scene") || typeof notes !== "string")
    throw new Error("gm の設定が不正です");
  return { metadata,
    gm: { sections:[...new Set<Section>(selected)], history, notes, metadataKeys:[...metadataKeys] } };
}

export function gmView(scenario: Record<string,string>, log: Entry[], turn: number, context: Context) {
  const visible = Object.fromEntries(Object.entries(scenario).filter(([key]) => {
    if (key === "title" || key === "opening") return true;
    const group = /^(handout|win)\d+$/.test(key) ? "handouts" : /^beat\d+$/.test(key) ? "beats" : key;
    return context.gm.sections.includes(group as Section);
  }));
  // In scene mode the previous GM's outcome and decision introduce the new scene.
  const start = context.gm.history === "all" ? 0 : log.findIndex(e => e.id === `S${turn-1}`);
  return { scenario:visible, events:log.slice(Math.max(0,start)), notes:context.gm.notes, metadata:Object.fromEntries(context.gm.metadataKeys.map(k => [k,context.metadata[k]])) };
}

export type Checkpoint = { version:1; turn:number; publicLog:Entry[]; predictions:string[][] };
export function saveCheckpoint(dir:string, point:Checkpoint) {
  const path = join(dir,`before-gm-${point.turn}.json`);
  writeFileSync(path+".tmp",JSON.stringify(point,null,2)+"\n",{mode:0o600});
  renameSync(path+".tmp",path);
}

export function loadBranch(draft:string, turn:number, seats:number, scenes:number) {
  if (!Number.isInteger(turn) || turn < 1 || turn > scenes) throw new Error("場面番号が範囲外です");
  const path = join(draft,"checkpoints",`before-gm-${turn}.json`);
  const native = existsSync(path);
  let point: Checkpoint;
  if (native) point = read(path);
  else {
    const log: Entry[] = read(join(draft,"session.json"));
    const boundary = log.findIndex(e => e.id === `S${turn}`);
    if (boundary < 0) throw new Error("そのGM裁定のチェックポイントも完了ログもありません");
    const predictions: string[][] = read(join(draft,"predictions.json"));
    point = {version:1,turn,publicLog:log.slice(0,boundary),predictions:predictions.map(p => p.slice(0,turn))};
  }
  const log = point?.publicLog;
  if (point?.version !== 1 || point.turn !== turn || !Array.isArray(log) || log[0]?.id !== "S0" ||
      !log.every(e => {
        const match = /^(S|D|N|A|R)(\d+)(?:\.(\d+))?$/.exec(e?.id);
        if (!match || typeof e.text !== "string") return false;
        const n = Number(match[2]);
        return n <= turn && !(n === turn && (match[1] === "S" || match[1] === "D"));
      }) || !log.some(e => e.id === `S${turn-1}`) ||
      new Set(log.map(e => e.id)).size !== log.length || log.some(e => e.id === `S${turn}`) ||
      !Array.isArray(point.predictions) || point.predictions.length !== seats ||
      !point.predictions.every((p,i) => Array.isArray(p) && p.length === turn && p.every(s => typeof s === "string") &&
        log.some(e => e.id === `A${turn}.${i+1}`))) throw new Error("チェックポイントのログまたはPCの状態が不正です");
  const profile = join(dirname(draft),"context.json");
  return { point, context:existsSync(profile) ? contextWith(defaultContext,read(profile)) : defaultContext,
    source:{ draft:resolve(draft), turn, origin:native ? "checkpoint" : "session-log" } };
}

// A request and its outcome share an id even when separate seats report concurrently.
export function loggedCall(run:string, inner:Call): Call {
  let id = 0;
  const path = join(run,"calls.jsonl");
  const write = (value: unknown) => appendFileSync(path,JSON.stringify(value)+"\n",{mode:0o600});
  return async (role,prompt,keys) => {
    const callId = ++id;
    write({id:callId,at:new Date().toISOString(),phase:"request",role,prompt,keys});
    try {
      const reply = await inner(role,prompt,keys);
      write({id:callId,at:new Date().toISOString(),phase:"response",role,reply});
      return reply;
    } catch (error) {
      write({id:callId,at:new Date().toISOString(),phase:"error",role,error:String(error)});
      throw error;
    }
  };
}
