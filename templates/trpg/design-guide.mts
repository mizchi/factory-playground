import { readFileSync } from "node:fs";
import type { Call } from "./session.mts";

type Source = {id:string; author:string; title:string; url:string; principle:string};
const sources: Source[] = JSON.parse(readFileSync(new URL("./design-sources.json",import.meta.url),"utf8"));

export function selectSources(ids: unknown): Source[] {
  if (ids === undefined) return sources;
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error("designSources は重複のない資料IDの配列です");
  return ids.map(id => {
    const source = sources.find(s => s.id === id);
    if (!source) throw new Error("未知の設計資料: "+id);
    return source;
  });
}

export function principles(selected: Source[]) {
  return selected.map(s => `[${s.id}] ${s.principle}`).join("\n");
}

// This role sees only the public brief. Its directions can safely follow a GM into a restricted view.
export async function makeGuide(call: Call, selected: Source[], publicBrief: object) {
  const result = await call("director", `この公開設定の卓を回すGM向けの手引きを日本語で書く。
${JSON.stringify(publicBrief)}
設計資料の要約:
${principles(selected)}
資料IDごとに、この卓でいつ介入し、GMが具体的に何を提示または裁定し、何をPCに委ねるかを短く1項目にする。適用場面がない資料の値は SKIP。
公開設定にある場所・物・対立を使う。新しい真相、資源、PCの意志、予定した結末を作らない。卓の約束と確定したルールを守る。`, selected.map(s => s.id));
  const used = selected.filter(s => result[s.id] !== "SKIP");
  return {
    gmGuidelines: used.map(s => `- [${s.id}] ${result[s.id]}`).join("\n"),
    gmReferences: selected.map(s => `- [${s.id}] ${s.author}『${s.title}』 ${s.url}\n  ${s.principle}`).join("\n")
  };
}
