import type { Entry } from "./session.mts";

import { citedEntries, designExamples, experienceInstructions, experienceTarget, readExperience, rubricVersion, type MetricReading } from "./experience.mts";

import { seatKeys } from "./seat-review.mts";

export const settingQuestion = "設定の量は遊ぶ時間とお題に合ったか。既存設定を守ったか。使われた事実、足りない前提、過剰な説明のいずれかを発言IDとともに特定する。不足・過剰・矛盾ならFAIL。固有名詞や歴史の量には加点しない。";
const rubric = {
  settingDepth: settingQuestion,
  clarity: "決断する前に、選べること・代償・別案を出す余地が参加者に伝わったか。要約がある場合は全文との差も見る。",
  feasibility: "約束に関わる選択が、残り時間・既知の事実・使える手段で実行可能だったか。",
  resolutionQuality: "実際に選んだ行動や交渉から結末を説明できるか。人物の譲歩が唐突だったり、選択が帰結に効かなければFAIL。"
};
const basicKeys = Object.keys(rubric);
export const judgeMetricKeys = [...basicKeys, "playExperience"];
export const metricKeys = [...judgeMetricKeys, ...seatKeys];
const basicTargets=Object.entries(rubric).map(([key,question])=>key+"="+question).join("\n");
export const designTargets = basicTargets + "\n" + experienceTarget + designExamples + "\n各席に、その役だから試したい手と、試す前に分かる代償を用意する。失敗しても何が効いたかを描けるようにする。緊張の強さは依頼に合わせ、勝利や難しさを楽しさの代わりにしない。";
export const reviewInstructions=basicTargets+
  "\n各欄は PASS|公開ログID|理由 または FAIL|公開ログID|次稿で直す具体的な点 の形式。1行、欄の区切りは半角 |、複数のIDは半角カンマで並べる。比較していない別結末や人間の感情を推測しない。\n" + experienceInstructions;

export function reviewMetrics(a:Record<string,string>, log:Entry[]):Record<string,MetricReading> {
  const metrics: Record<string,MetricReading> = {};
  for (const key of basicKeys) {
    const match=/^(PASS|FAIL)\s*\|\s*([^|]+)\s*\|\s*(.+)$/u.exec(a[key]?.trim() ?? "");
    const cited = match && citedEntries(match[2],log);
    metrics[key] = match && cited?.length && match[3].trim()
      ? {status:match[1] === "PASS" ? "PASS" : "FAIL", evidence:cited[0].id, ...(cited.length>1 && {trace:cited.map(e=>({id:e.id,quote:e.text}))}), note:match[3].trim()}
      : {status:"UNVERIFIED",note:a[key] ?? ""};
  }
  metrics.playExperience = readExperience(a, log);
  return metrics;
}

// A baseline consists only of completed, first-time, automated generations on the same rubric.
export type QualityReport = {
  rubricVersion:number; mode:string; wish:string; pattern?:string;
  history:{draft:number; status:string; metrics:ReturnType<typeof reviewMetrics>}[];
};
export function summarize(reports:QualityReport[]) {
  const fresh=reports.filter(r=>r.mode==="fresh" && r.rubricVersion===rubricVersion && r.history.length);
  return {rubricVersion,evaluated:fresh.length,
    firstDraftReady:fresh.filter(r=>r.history[0].status==="READY_FOR_HUMAN").length,
    finalDraftReady:fresh.filter(r=>r.history.at(-1)?.status==="READY_FOR_HUMAN").length,
    firstDraftFailures:Object.fromEntries(metricKeys.map(k=>[k,fresh.filter(r=>r.history[0].metrics[k]?.status==="FAIL").length])),
    finalDraftFailures:Object.fromEntries(metricKeys.map(k=>[k,fresh.filter(r=>r.history.at(-1)!.metrics[k]?.status==="FAIL").length])),
    runs:fresh.map(r=>({wish:r.wish, ...(r.pattern && {pattern:r.pattern, final:Object.fromEntries(["settingDepth",...seatKeys].map(k=>[k,r.history.at(-1)!.metrics[k]?.status]))}),first:r.history[0].status,last:r.history.at(-1)!.status,drafts:r.history.length}))};
}
