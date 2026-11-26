import {readFileSync} from "node:fs";
import {basename,join,resolve} from "node:path";
import {rubricVersion, type MetricReading} from "./experience.mts";
import {seatAdvice,seatCriteria,seatKeys,type SeatMetric} from "./seat-review.mts";
import {patterns, type Focus, type Pattern} from "./patterns.mts";

const instructions:Record<string,string> = {
  settingDepth:"使う前提を選ぶ。説明不足なら判断前に実演し、使わない説明は削る。",
  credibility:seatCriteria.credibility.fix, enjoyment:seatCriteria.enjoyment.fix,
  tension:seatCriteria.tension.fix, gameFeel:seatCriteria.gameFeel.fix,
  clarity:"選ぶ時点で、代償と別案を短く言い直せるようにする。",
  feasibility:"各案を残り手数で実行できるか確認する。",
  resolutionQuality:"結末は人物が引き受けた条件・代償から組み立てる。",
  playExperience:"手がかりを使った本人の一手が次の場面を変えるようにする。",
  emergence:"片方の提案を聞いた相手にしか決められない条件を残し、返答で案を作り替えられるようにする。",
  continuity:"制度の例外を終盤で増やさず、状態が変わるときは原因を先に見せる。"
};
type Draft = {draft:number; status:string; metrics:Record<string,MetricReading>; emergence:string; continuity:{choice:string}[]};

export function previousFocus(dir:string):Focus[] {
  const read = (file:string) => JSON.parse(readFileSync(join(dir,file),"utf8"));
  const report = read("quality.json");
  const result = read("result.json");
  if (report.rubricVersion !== rubricVersion || !["READY_FOR_HUMAN","NEEDS_EDIT"].includes(result.status) ||
      !Array.isArray(report.history) || report.history.at(-1)?.status !== result.status)
    throw new Error("現行基準で根拠を確認できた完了卓を指定してください");
  const focus:Focus[] = [];
  for (const draft of (report.history as Draft[]).slice().reverse()) {
    if (draft.status !== "NEEDS_EDIT") continue;
    const failed = Object.keys(instructions).filter(key=>draft.metrics[key]?.status === "FAIL");
    if (draft.emergence === "ABSENT") failed.push("emergence");
    if (draft.continuity.some(c=>c.choice!=="OK" && c.choice!=="UNKNOWN")) failed.push("continuity");
    for (const criterion of failed) {
      if (focus.some(f=>f.criterion===criterion)) continue;
      const instruction = seatKeys.includes(criterion as SeatMetric) ? seatAdvice(criterion as SeatMetric,draft.metrics[criterion].responses) : instructions[criterion];
      focus.push({source:basename(resolve(dir)),draft:draft.draft,criterion,instruction});
      if (focus.length === 2) return focus;
    }
  }
  return focus;
}

type PatternResult = {run:string; draft:number; status:string};
export async function runPatternSeries(run:(pattern:Pattern, previous?:string)=>Promise<PatternResult>) {
  const rows = [];
  let previous:string | undefined;
  for (const pattern of Object.keys(patterns) as Pattern[]) {
    const result = await run(pattern, previous);
    rows.push({pattern, ...result});
    previous = ["NEEDS_EDIT","READY_FOR_HUMAN"].includes(result.status) ? result.run : undefined;
  }
  return rows;
}
