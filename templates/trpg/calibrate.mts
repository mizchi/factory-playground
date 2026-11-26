import { agentName, askTextFields } from "../factory/agent.mts";
import { experienceInstructions, experienceKeys, readExperience } from "./experience.mts";
import { settingQuestion, reviewMetrics } from "./quality.mts";
import { emergenceInstructions, emergenceKeys, emergenceVerified, type Entry } from "./session.mts";

const wish = "二人が別々の手がかりをつなぎ、最後に何を残すかを自分たちで決めたい。";
const opening: Entry[] = [
  {id:"S0", text:"駅の放送は一度だけ。白い切符には駅名が、青い切符には時刻が抜けている。"},
  {id:"A1.1", text:"私は白い切符を持っている。失くした人の名前とあなたの時刻を一緒に放送しよう。"},
  {id:"A1.2", text:"僕の青い切符は六時だ。名前の代わりに、白い切符にある行き先を読もう。"},
  {id:"R1.1", text:"それなら名前を諦める。二枚を重ねて行き先と六時を読み上げる。"}
];
const cases = [
  {label:"二人の交渉で届く", wish, experience:"PASS", emergence:"OBSERVED",
    log:[...opening, {id:"S1", text:"二人が合わせた駅名と六時が放送され、行き先を聞いた乗客がホームを移った。持ち主の名を告げる前に電源が落ちた。"}]},
  {label:"同じ交渉を放送が上書きする", wish, experience:"FAIL", emergence:"ABSENT",
    log:[...opening, {id:"S1", text:"放送卓の電源は入らなかった。六時の自動放送で駅名と乗客名簿が読み上げられ、乗客は指定ホームへ移った。"}]},
  {label:"一人の発見が効き、相手は追認する", wish:"手がかりを自分で読み、失われた音を取り戻したい。", experience:"PASS", emergence:"ABSENT",
    log:[{id:"S0",text:"木箱の側面に三つの音符と、逆さに立つ人形が彫られている。"},
      {id:"A1.1",text:"私は人形に合わせて楽譜を逆さにし、逆順に三音を弾く。"},
      {id:"A1.2",text:"君の考えに賛成だよ。横で聴いている。"},
      {id:"S1",text:"逆順の三音で木箱が開き、途絶えていた母の子守歌が最後まで鳴った。"}]}
];
const agent = agentName(process.env.TRPG_JUDGE_AGENT ?? process.env.TRPG_AGENT);
const suite = process.argv[2] || "experience";
if (!["experience","setting"].includes(suite)) throw new Error("experience または setting を指定してください");
if (suite === "setting") {
  const rule = "渡し舟に載せられる荷は一箱だけ。";
  const arrival = "薬箱と食料箱が一つずつ。舟の荷は日没前に届き、徒歩なら一時間遅れる。";
  const result = "薬は日没前に舟で届く。食料を背負った二人は徒歩で日没の一時間後に着く。";
  const choices = [{id:"A1.1",text:"薬箱を先に舟へ積む。"}, {id:"A1.2",text:"では食料は持って歩く。"}];
  for (const [label,opening,ending,expected] of [
    ["決める前に規則を見た",arrival+rule+"どちらを舟に積む？",result,"PASS"],
    ["決めた後に初めて規則を聞いた",arrival+"どんな順で運ぶ？",result+rule+"上限はここで初めて知らされた。","FAIL"],
    ["沿革を読むあいだに選ぶ時間を失った",arrival+"舟主は歴代六家の紋と寄進の来歴を順に読み上げる。PCが荷の条件を尋ねても、全巻読了まで答えない。","来歴を読む間に舟が出た。一箱という定めも、荷を選び直す時間も二人には届かなかった。","FAIL"]
  ]) {
    const log = [{id:"S0",text:opening},...choices,{id:"S1",text:ending}];
    const prompt = `30分の卓。お題は日没までに何を運べるか選ぶこと。既存設定は「${rule}」。編集者として次の問いに答える。${settingQuestion}
公開ログ: ${JSON.stringify(log)}
settingDepthは「PASS|公開ログID|理由」または「FAIL|公開ログID|直す点」。複数のIDはカンマで区切る。`;
    const fields = await askTextFields({agent},prompt,["settingDepth"]);
    const reading = reviewMetrics(fields, log).settingDepth;
    console.log(JSON.stringify({label,expected,reading}));
    if (reading.status !== expected) process.exitCode=1;
  }
} else for (const sample of cases) {
  const prompt = `試遊編集者としてこの卓の体験とPC同士の創発を評価する。\n${experienceInstructions}\n${emergenceInstructions}\nお題: ${sample.wish}\n公開ログ: ${JSON.stringify(sample.log)}\n個別感想: 両席のモデルが「また遊びたい」と答えた。`;
  const fields = await askTextFields({agent}, prompt, [...experienceKeys, ...emergenceKeys]);
  const reading = readExperience(fields, sample.log);
  const emergence = emergenceVerified(fields, sample.log) ? fields.emergence : "UNVERIFIED";
  console.log(JSON.stringify({label:sample.label, expected:[sample.experience,sample.emergence], experience:reading, emergence}, null, 2));
  if (reading.status !== sample.experience || emergence !== sample.emergence) process.exitCode = 1;
}
