import type { Entry } from "./session.mts";
import { citedEntries, type MetricReading } from "./experience.mts";

export const seatCriteria = {
  credibility: {label:"納得感", field:"fairness", question:"結末は、前に知った事情から納得できましたか？", options:["納得", "一部に疑問", "腑に落ちない"], fix:"決断の前に、その結果を予想できる世界の事実を見せる。"},
  enjoyment: {label:"楽しさ", field:"satisfaction", question:"遊んでいて楽しかったですか？", options:["楽しかった", "一部だけ楽しい", "退屈だった"], fix:"退屈だった場面で、本人が試したかった働きかけに応答できる余地を作る。"},
  tension: {label:"緊張感", field:"tension", question:"決断するときの緊張はどのくらいでしたか？", options:["ちょうどよい", "弱すぎる", "強すぎる"], fix:"弱すぎる席には失うものを、強すぎる席には見通しと立て直す手を用意する。"},
  gameFeel: {label:"手応え", field:"challenge", question:"自分の工夫を試す手応えはありましたか？", options:["手応えあり", "容易すぎる", "難しすぎる"], fix:"手段と代償を動かし、自分の工夫の結果を観察して次の一手を選べるようにする。"}
} as const;
export type SeatMetric = keyof typeof seatCriteria;
export const seatKeys = Object.keys(seatCriteria) as SeatMetric[];
export const seatSurveyInstructions = seatKeys.map(key => {
  const c = seatCriteria[key];
  return `${c.field}: ${c.question} 判定語は ${c.options.join(" / ")}。`;
}).join("\n") + "\nこの4欄は「判定語|公開ログID|自分がそう感じた具体的な理由」の形式。IDが複数なら半角カンマで区切る。自席で実際に試した手・退屈や理不尽を感じた瞬間を短く書く。穏やかさを望む卓では小さな迷いでも適度。敗北や強い不安を自動的に低評価にせず、勝利や再遊希望だけで高評価にしない。根拠がなければ未評価|NONE|理由。";

const adjustments:Record<string,string> = {
  "一部に疑問":"疑問が残った因果関係を、決断の前に確かめられるようにする。",
  "腑に落ちない":"結末を決めた条件を予告し、行動と結果の間にある理由を示す。",
  "一部だけ楽しい":"盛り上がった働きかけを残し、待っていた席にも応答の手を返す。",
  "退屈だった":"その席の望みが相手の提案を変えられる場面を早めに置く。",
  "弱すぎる":"先延ばしすると何を失うかを、選べる段階で一つ見せる。",
  "強すぎる":"決断前に猶予か回復手段を明かし、捨てるものを本人に選ばせる。",
  "容易すぎる":"最初の一案では両立しない要求を置き、工夫した結果が返るようにする。",
  "難しすぎる":"小さく試せる一手と、その成否を読める反応を先に用意する。"
};
export function seatAdvice(key:SeatMetric, responses:MetricReading["responses"]) {
  const suggestions = responses?.filter(r=>r.supported).map(r=>adjustments[r.rating]).filter(Boolean);
  return suggestions?.length ? [...new Set(suggestions)].join(" ") : seatCriteria[key].fix;
}

type Respondent = {name?:string; controller?:string; fairness?:string; satisfaction?:string; tension?:string; challenge?:string};
export function seatMetrics(seats:Respondent[], log:Entry[]):Record<SeatMetric,MetricReading> {
  const metrics = {} as Record<SeatMetric,MetricReading>;
  for (const key of seatKeys) {
    const c = seatCriteria[key];
    const responses = seats.map((seat,i) => {
      const [rating, event, ...words] = (seat[c.field] ?? "").split("|").map(s=>s.trim());
      const reason = words.join("|");
      const human = seat.controller === "human";
      const supported = (c.options as readonly string[]).includes(rating) && !!reason &&
        ((human && event === "本人申告") || (!!event && citedEntries(event,log).length > 0));
      return {seat:i+1,controller:human ? "human" as const : "model" as const,rating,event,reason,supported};
    });
    const failed = responses.filter(r=>r.supported && r.rating !== c.options[0]);
    const status = !responses.length || responses.some(r=>!r.supported) ? "UNVERIFIED" : failed.length ? "FAIL" : "PASS";
    const note = responses.map(r => {
      const source = r.controller==="human" ? "人間" : "モデル";
      const evidence = [r.event,r.reason].filter(Boolean).join(" ");
      return `席${r.seat}（${source}）${r.supported ? r.rating : "未確認"} ${evidence || r.rating || "未回答"}`;
    }).join(" / ");
    metrics[key] = {status, responses, note:status==="FAIL" ? note+" "+seatAdvice(key,responses) : note};
  }
  return metrics;
}

export function trialSummary(metrics:Record<string,MetricReading>):string {
  const marks = {PASS:"○",FAIL:"×",UNVERIFIED:"未確認"};
  const rows = [`設定量 ${marks[metrics.settingDepth.status]}`];
  for (const key of seatKeys) {
    const metric=metrics[key];
    const issues=metric.responses?.filter(r=>r.supported && r.rating!==seatCriteria[key].options[0])
      .map(r=>`席${r.seat}「${r.rating}」`);
    rows.push(`${seatCriteria[key].label} ${marks[metric.status]}${issues?.length ? " "+issues.join("・") : ""}`);
  }
  return rows.join("　");
}
