import {randomInt} from "node:crypto";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import {agentName,askTextFields} from "../factory/agent.mts";
import {seatMetrics,seatKeys} from "./seat-review.mts";
import type {Entry} from "./session.mts";

const questions = {
  atmosphere:"同じ状況を卓で想像できる具体的な音・動作・物があるか。描写が長くなって判断を埋もれさせていないか。",
  handoff:"行動する直前に状況と代償が見え、PC自身が別案を出せるところでGMが語りを止めたか。",
  response:"それぞれの席の異なる提案が、GMの具体的な返事や帰結につながったか。"
};
export const axes = Object.keys(questions) as (keyof typeof questions)[];
const fields = axes.flatMap(k=>[k,k+"A",k+"B",k+"Reason"]);

function readRun(dir:string) {
  const read=(f:string)=>JSON.parse(readFileSync(join(dir,f),"utf8"));
  const models=read("models.json");
  if (!models.branch) throw new Error("同じ場面のGM裁定前から trpg-resume した二卓を指定してください");
  const turn:number=models.branch.turn;
  const log:Entry[]=read("draft-1/session.json");
  const index=log.findIndex(e=>e.id===`S${turn}`);
  if (index<0) throw new Error("分岐後のGM裁定がありません");
  const {gm:gmContext,metadata}=read("context.json");
  const {direction,...gm}=gmContext;
  const scenario=read("draft-1/scenario.json");
  const scripted = direction === "scripted" || (direction === undefined && !!scenario.gmCue1);
  const fixed={models,table:read("table.json"),metadata,gm,
    scenario:Object.fromEntries(Object.entries(scenario).filter(([k])=>!/^gmCue\d+$/.test(k))),
    prefix:log.slice(0,index), predictions:read("draft-1/predictions.json").map((p:unknown[])=>p.slice(0,turn))};
  const metrics=seatMetrics(read("draft-1/survey.json"),log);
  return {dir,scripted,fixed,after:log.slice(index),surveys:Object.fromEntries(seatKeys.map(k=>[k,metrics[k].responses]))};
}

export function groundedReview(reply:Record<string,string>, a:Entry[], b:Entry[]) {
  return Object.fromEntries(axes.map(k=>{
    const evidence=[a,b].map((log,i)=>{
      const raw=reply[k+(i===0?"A":"B")] ?? "";
      const at=raw.indexOf("|");
      const id=raw.slice(0,at).trim(), quote=raw.slice(at+1).trim();
      if (at<1 || !quote || !/^[SD][1-9]\d*$/.test(id) || !log.some(e=>e.id===id && e.text.includes(quote)))
        throw new Error(k+" の分岐後のGM発言を照合できません: "+raw);
      return {id,quote};
    });
    if (!["A","B","互角","判定困難"].includes(reply[k]) || !reply[k+"Reason"]?.trim())
      throw new Error(k+" の講評が不正です");
    return [k,{preference:reply[k],evidence,reason:reply[k+"Reason"]}];
  }));
}

async function main() {
  const dirs=process.argv.slice(2);
  if (dirs.length!==2) throw new Error("比較する実行ディレクトリを二つ指定してください");
  if (randomInt(2)) dirs.reverse();
  const [a,b]=dirs.map(readRun);
  if (a.scripted===b.scripted || !isDeepStrictEqual(a.fixed,b.fixed)) throw new Error("GM台本以外の条件、配役、場面、分岐前の発言と予想が一致する二卓を指定してください");
  const prompt=`TRPGのGM演出を匿名の二卓で比較する。どちらの手法かは伏せている。プレイヤーの楽しさを代弁せず、GMが何をして遊ぶ余地を作ったかを評価する。
${axes.map(k=>k+"="+questions[k]).join("\n")}
各項目に A / B / 互角 / 判定困難。各項目の A と B の欄に、対応する卓の分岐後のGM本人の発言から「ID|連続する原文」を一つずつ。引用できるIDはA卓が ${a.after.filter(e=>/^[SD]/.test(e.id)).map(e=>e.id).join(",")}、B卓が ${b.after.filter(e=>/^[SD]/.test(e.id)).map(e=>e.id).join(",")}。NはNPC、A・RはPCの発言であり、それらは理解にだけ用いる。Reasonに比較の理由。PCの選択が異なるため区別できない効果には判定困難を使う。
お題: ${a.fixed.table.wish}
分岐前の公開発言: ${JSON.stringify(a.fixed.prefix)}
Aの続き: ${JSON.stringify(a.after)}
Bの続き: ${JSON.stringify(b.after)}`;
  const agent=agentName(process.env.TRPG_JUDGE_AGENT ?? process.env.TRPG_AGENT);
  const reply=await askTextFields({agent},prompt,fields);
  const findings=groundedReview(reply,a.after,b.after);
  console.log(JSON.stringify({agent,findings,arms:[a,b].map((r,i)=>({label:i?"B":"A",dir:r.dir,scripted:r.scripted,surveys:r.surveys}))},null,2));
}
if (resolve(process.argv[1] ?? "")===fileURLToPath(import.meta.url)) await main();
