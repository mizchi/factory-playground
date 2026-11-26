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

export const cueKeys = (count:number) => Array.from({length:count},(_,i)=>`gmCue${i+1}`);

// The director can use public material even when the GM has a restricted view.
export async function makeGuide(call: Call, selected: Source[], publicBrief: object, cues:string[] = []) {
  const sourcePrompt = selected.length ? `設計資料の要約:
${principles(selected)}
資料IDごとに、この卓でいつ介入し、GMが何を提示し、何をPCに委ねるかを短く書く。適用場面がない資料は SKIP。` : "";
  const stagePrompt = cues.length ? `各 gmCue は対応する場面のGM裁定用。GMが読む時点では、NPCと各PCはすでに一手を宣言している。冒頭を再演しない。読み上げ例一文＋進行指示一文、合わせて120字を目安にする。
素材は既出の物・動作・音から一つ。役の気持ちは遊ぶ側に預ける。読み上げ例に人名入りの行動予定を書かず、実際の宣言に差し替えられる形にする。
途中の場面では、宣言で変わったものを見せ、次の一手を迷わせる代償をひとつ具体化してPCに渡す。最終場面では問いを重ねない。両席の提案が受理・拒否されたかと理由を先に伝え、その結果が残った物か人物のしぐさで閉じる。雰囲気のために成否をぼかさない。
例文は差し替え可。新しい条件・障害・定員を足さず、元の制約の範囲や時刻を変えない。` : "";
  const result = await call("director", `この卓を回すGM向けの手引きを日本語で書く。
公開設定: ${JSON.stringify(publicBrief)}
${sourcePrompt}
${stagePrompt}
公開設定にある場所・物・対立を使う。新しい真相、資源、PCの意志、予定した結末を作らない。卓の約束と確定したルールを守る。`, [...selected.map(s => s.id),...cues]);
  const used = selected.filter(s => result[s.id] !== "SKIP");
  return {
    ...(selected.length > 0 && {
      gmGuidelines: used.map(s => `- [${s.id}] ${result[s.id]}`).join("\n"),
      gmReferences: selected.map(s => `- [${s.id}] ${s.author}『${s.title}』 ${s.url}\n  ${s.principle}`).join("\n")
    }),
    ...Object.fromEntries(cues.map(k=>[k,result[k]]))
  };
}
