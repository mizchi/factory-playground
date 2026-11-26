import type { Entry } from "./session.mts";

const rubric = {
  clarity: "決断する前に、選べること・代償・別案を出す余地が参加者に伝わったか。要約がある場合は全文との差も見る。",
  feasibility: "約束に関わる選択が、残り時間・既知の事実・使える手段で実行可能だったか。",
  resolutionQuality: "実際に選んだ行動や交渉から結末を説明できるか。人物の譲歩が唐突だったり、選択が帰結に効かなければFAIL。"
};
export const metricKeys=Object.keys(rubric);
export const designTargets=Object.entries(rubric).map(([key,question])=>key+"="+question).join("\n");
export const reviewInstructions=designTargets+
  "\n各欄は PASS|公開ログID|理由 または FAIL|公開ログID|次稿で直す具体的な点 の形式。1行、区切りは半角 |。比較していない別結末や人間の感情を推測しない。";

export function reviewMetrics(a:Record<string,string>, log:Entry[]) {
  return Object.fromEntries(metricKeys.map(key=>{
    const match=/^(PASS|FAIL)\s*\|\s*([^|\s]+)\s*\|\s*(.+)$/u.exec(a[key]?.trim() ?? "");
    const evidence=match && log.find(e=>e.id===match[2]);
    return [key,match && evidence && match[3].trim()
      ? {status:match[1], evidence:evidence.id, note:match[3].trim()}
      : {status:"UNVERIFIED",note:a[key] ?? ""}];
  }));
}

// A baseline consists only of completed, first-time, automated generations on the same rubric.
export type QualityReport = {
  rubricVersion:number; mode:string; wish:string;
  history:{draft:number; status:string; metrics:ReturnType<typeof reviewMetrics>}[];
};
export function summarize(reports:QualityReport[]) {
  const fresh=reports.filter(r=>r.mode==="fresh" && r.rubricVersion===1 && r.history.length);
  return {evaluated:fresh.length,
    firstDraftReady:fresh.filter(r=>r.history[0].status==="READY_FOR_HUMAN").length,
    finalDraftReady:fresh.filter(r=>r.history.at(-1)?.status==="READY_FOR_HUMAN").length,
    firstDraftFailures:Object.fromEntries(metricKeys.map(k=>[k,fresh.filter(r=>r.history[0].metrics[k]?.status==="FAIL").length])),
    runs:fresh.map(r=>({wish:r.wish,first:r.history[0].status,last:r.history.at(-1)!.status,drafts:r.history.length}))};
}
