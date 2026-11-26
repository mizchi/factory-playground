import type { Entry } from "./session.mts";

export type Citation = { id: string; quote: string };
export type MetricReading = {
  status: "PASS" | "FAIL" | "UNVERIFIED";
  evidence?: string;
  responses?: {seat:number; controller:"model"|"human"; rating:string; event:string; reason:string; supported:boolean}[];
  trace?: Citation[];
  note: string;
};

export function citedEntries(ids:string, log:Entry[]):Entry[] {
  const entries = ids.split(/[,、，・→]/u).map(id=>log.find(e=>e.id===id.trim()));
  return entries.every((e):e is Entry=>e !== undefined) ? entries : [];
}

export const rubricVersion = 3;
export const experienceTarget = "お題で望んだ体験について、判断材料がPCの具体的な一手を引き出し、その一手が世界や人物関係に結果を残す場面を作る。";
export const designExamples = "手がかりの持ち寄り、情報で変わる品の価値、限られた機会、人物間の取引や役割の変化など、依頼に合う手段を選ぶ。全部を入れる必要はない。PCの答えは先に決めない。";
export const experienceEvidenceKeys = ["setupEvidence", "choiceEvidence", "outcomeEvidence"] as const;
export const experienceKeys = ["playExperience", ...experienceEvidenceKeys] as const;
export const experienceInstructions = `${experienceTarget}
判断材料の例は、二人でつなぐ断片、途中で意味が変わる品、残り時間と同行者の事情、他人からの取引や意外な応答。仕掛けの種類や数は採点しない。
playExperience は「PASS|理由」または「FAIL|弱かったところと次稿の具体的な変更」。お題のどの期待に関わり、PCが何を理由にどう行動し、何が変わったかを述べる。
別案を採っても筋書きどおり、GMの指示をそのまま実行、振っただけの乱数、結末だけで明かされる後付けは、それだけでは根拠不足。予想どおりでもPC自身の工夫や交渉が結果を生めばよい。感想や予想と食い違えば理由を述べ、モデルの好意的な感想だけでPASSにしない。
setupEvidence=判断前に卓で出た材料、choiceEvidence=それを使ったPCの行動または応答、outcomeEvidence=その後のGMによる具体的な帰結。各欄は「ID|その発言のtextから連続した原文」。PASSには時間順の異なる3件が必須。FAILでは弱さの見える発言を最低1件引用し、該当しない欄はNONE。原因や未プレイの分岐を創作しない。`;

export function readExperience(fields: Record<string, string>, log: Entry[]): MetricReading {
  const verdict = /^(PASS|FAIL)\s*\|\s*([^|]+)$/u.exec(fields.playExperience?.trim() ?? "");
  const invalid: MetricReading = {status: "UNVERIFIED", note: "体験の判定・引用・発言順を照合できません。"};
  if (!verdict || !verdict[2].trim()) return invalid;

  const slots = [
    ["setupEvidence", /^(?:[SND]\d+|[AR]\d+\.\d+)$/],
    ["choiceEvidence", /^[AR]\d+\.\d+$/],
    ["outcomeEvidence", /^S[1-9]\d*$/]
  ] as const;
  const trace: Citation[] = [];
  let previous = -1;
  for (const [key, allowed] of slots) {
    const field = fields[key]?.trim();
    if (verdict[1] === "FAIL" && field === "NONE") continue;
    const match = /^([^|\s]+)\s*\|\s*([\s\S]+)$/u.exec(field ?? "");
    if (!match || !allowed.test(match[1])) return invalid;
    const quote = match[2].trim();
    const index = log.findIndex(event => event.id === match[1]);
    if (index <= previous || !quote || !log[index].text.includes(quote)) return invalid;
    trace.push({id: match[1], quote});
    previous = index;
  }
  if (!trace.length) return invalid;
  return {status: verdict[1] === "PASS" ? "PASS" : "FAIL", evidence: trace.at(-1)!.id, trace, note: verdict[2].trim()};
}
