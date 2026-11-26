import {schedule, type Minutes} from "./session.mts";

export type World = {name:string; facts:string[]; open:string};
export const harbor:World = {
  name:"潮継港", facts:["渡し橋は日没に上がり、夜明けまでこの橋は通れない。","公の記録を訂正する時は原文を残し、訂正した者の名を添える。"],
  open:"誰を信じ、何を犠牲にしても守りたいかはプレイヤーが決める。"
};
export const patterns = {
  clues:"別々の手がかりを持つ二人で、潮継港の消えた朝市を調べたい。相手の読みを聞いて初めて、自分の証拠の使い方が変わる謎がいい。",
  pressure:"二人で日没前の潮継港を駆け回り、調べたい三か所のうち一つを諦めたい。何を諦め、誰とどこで落ち合うかを自分たちで決めたい。",
  reversal:"潮継港で、最初は守りたいと思った形見の意味が途中で変わる話を遊びたい。新しい事情を知った後、元の約束を守るか選び直したい。",
  routes:"潮継港の古い倉庫から二つの帰路を探りたい。行きにどちらをどう通ったかが、帰りに使える手を変える冒険にしたい。",
  relationships:"潮継港の仮面祭で、誰に頼り、誰をひいきするかで味方が変わる話を遊びたい。山場は仮面の踊り場。書類や署名は登場させず、人前で誰の手を取るか、思わぬ申し出にどう返すかを演じたい。"
} as const;
export type Pattern = keyof typeof patterns;
export function patternId(value?:string):Pattern {
  if (!value || !Object.hasOwn(patterns,value)) throw new Error("パターンを選んでください: "+Object.keys(patterns).join(" / "));
  return value as Pattern;
}

export type Focus = {source:string; draft:number; criterion:string; instruction:string};

// Each pattern changes the purpose of a scene. The duration and the players' decisions stay open.
const sceneAims:Record<Pattern,[string,string,string,string]> = {
  clues:["断片を得て相手の読みを聞く","別の場所で証言に触れる","異なる解釈を試す","どの証拠をどう使うか選び、結果を見る"],
  pressure:["期限と残りの手数の下で、行き先と実行できる複数の合流先を提示し、どれを取るか委ねる","選んだ現場で材料を得る","残り時間を見て合流先を決める","諦めた用事を残したまま、何を間に合わせるか決める"],
  reversal:["最初の約束を選べる状況を作り、その意味を揺らす事情を見せる","初めの解釈を別の視点で確かめる","判明した事情を相手にどう伝えるか選ぶ","新しい意味を知った上で約束の扱いを選び直す"],
  routes:["戻り道に響く違いを見せ、往路を選ぶ","選んだ経路を試す","来た道で起きた変化を確かめる","往路に残した変化を使い、帰り方と代償を選ぶ"],
  relationships:["人物の望みを見せ、誰に働きかけるか選ぶ","相手の反応から関係の変化を知る","別の相手の提案で立場を問い直す","変わった関係から誰の頼みをどう扱うか決める"]
};
export function playSchedule(minutes:Minutes, scenes:number, pattern?:Pattern) {
  const pace = schedule(minutes,scenes);
  if (!pattern) return pace;
  const aims = sceneAims[pattern];
  const selected = scenes===2 ? [aims[0],aims[3]] : scenes===3 ? [aims[0],aims[2],aims[3]] : aims;
  return {...pace,scenes:pace.scenes.map((scene,i)=>({...scene,aim:selected[i]}))};
}
