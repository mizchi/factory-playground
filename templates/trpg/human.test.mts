import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Readable, PassThrough} from "node:stream";
import {playtest,readTable} from "./run.mts";
import {terminalSeat, PlayInterrupted} from "./tui.mts";
import {seatNumber} from "./human.mts";
import {loadBranch} from "./checkpoint.mts";
import type {Call} from "./session.mts";

test("one human seat takes both actions, final reply and debrief without receiving another seat's secrets",async t=>{
  const run=mkdtempSync(join(tmpdir(),"trpg-human-"));
  t.after(()=>rmSync(run,{recursive:true,force:true}));
  const table=readTable(join(import.meta.dirname,"table-dungeon.json"));
  const output=new PassThrough(); let screen="";
  output.on("data",d=>{screen+=d.toString()});
  const answers=["","99","3","自分で逆流を抜ける","1","鐘を止める","音を分けて残そう","満足","驚き","納得","交渉","達成"];
  const human=terminalSeat(2,Readable.from([answers.join("\n")+"\n"]),output);
  t.after(()=>human.close());
  const roles:string[]=[];
  const call:Call=async(role,_prompt,keys)=>{
    roles.push(role);
    const fields=Object.fromEntries(keys.map(k=>[k,k]));
    if(role==="author")return {...fields,opening:"公開導入",secret:"GM限定",handout1:"別席限定",win1:"別席の勝利条件",
      handout2:"自席限定",win2:"自席の勝利条件",maxHp:"2",damage:"1",stock:"1",room1:"浜",room2:"堤防",room3:"灯台"};
    if(role==="player")return {...fields,prediction:"別席の予想",move:"stay"};
    return {...fields,choice:"OK"};
  };
  await playtest({...table,maxRevisions:1},run,call,undefined,undefined,undefined,undefined,human);
  assert.equal(roles.filter(r=>r==="player").length,2);
  assert.equal(roles.filter(r=>r==="survey").length,1);
  assert.ok(!roles.includes("reply"));
  assert.match(screen,/自席限定/);assert.match(screen,/1〜5を選んで/);
  assert.doesNotMatch(screen,/GM限定|別席限定|別席の予想|別席の勝利条件/);
  const read=(name:string)=>JSON.parse(readFileSync(join(run,"draft-1",name),"utf8"));
  const log=read("session.json");
  assert.deepEqual(log.filter((e:{controller?:string})=>e.controller==="human").map((e:{id:string})=>e.id),["A1.2","A2.2","R2.2"]);
  assert.doesNotMatch(JSON.stringify(log),/予想甲|予想乙/);
  assert.deepEqual(read("predictions.json")[1],[null,null]);
  assert.deepEqual(loadBranch(join(run,"draft-1"),2,2,2).point.predictions,[["別席の予想","別席の予想"],[null,null]]);
  assert.deepEqual(read("mechanics.json").state.hp,[2,1]);
  assert.equal(read("survey.json")[1].satisfaction,"満足");
  assert.equal(read("survey.json")[1].controller,"human");
});

test("end of input interrupts the playtest and invalid seats fail explicitly",async()=>{
  assert.throws(()=>seatNumber("3",2));
  for(const data of [[],["/quit\n"]]){
    const human=terminalSeat(1,Readable.from(data),new PassThrough());
    try {
      await assert.rejects(human.reply({draft:1,seat:1,turn:1,title:"",promise:"",question:"",cast:["a"],handout:{name:"a",desire:"",clue:"",win:""},events:[]}),PlayInterrupted);
    } finally {human.close()}
  }
});

test("each prompt puts the relevant scene, decision, choice or outcome directly next to the input",async()=>{
  const output=new PassThrough(); let screen="";
  output.on("data",chunk=>{screen+=chunk.toString()});
  const input=Readable.from(["9\n2\n提案\n賛成\nはい\n驚いた\n納得\n提案\n達成\n"]);
  const ui=terminalSeat(1,input,output);
  const view={draft:1,turn:2,seat:1,title:"港",promise:"約束",question:"問い",cast:["司書","船長"],
    handout:{name:"司書",desire:"望み",clue:"秘密",win:"本を守る"},
    events:[{id:"S1",text:"水が迫る。長い描写。",brief:"水が迫る。"},
      {id:"D1",text:"最後の選択の詳しい説明。",brief:"本を運ぶか、鐘を守るか？"},
      {id:"A2.2",text:"船長「本は私に預けて。」"}]};
  try {
    await ui.act(view,[{code:"stay",label:"待つ"},{code:"walk",label:"船に乗る"}]);
    await ui.reply(view);
    await ui.survey({...view,events:[...view.events,{id:"S2",text:"船が岸に着いた。"}]});
    assert.match(screen,/本を運ぶか、鐘を守るか？ 別案も出せます。[^>]*番号[^>]*>/);
    assert.equal((screen.match(/2\. 船に乗る\n[^\n]*番号[^\n]*>/g)??[]).length,2);
    assert.match(screen,/選んだ行動　船に乗る\n[^\n]*台詞/);
    assert.match(screen,/船長「本は私に預けて。」\n[^\n]*返/);
    assert.match(screen,/船が岸に着いた。\n[^\n]*もう一度/);
    assert.doesNotMatch(screen,/予想/);
    assert.match(screen,/本を守る\n[^\n]*勝利条件/);
    assert.doesNotMatch(screen,/長い描写|最後の選択の詳しい説明/);
  } finally {ui.close()}
});

test("a narrative turn accepts the first line as the PC's action",async()=>{
  const output=new PassThrough();let screen="";
  output.on("data",chunk=>{screen+=chunk});
  const ui=terminalSeat(1,Readable.from(["鐘を鳴らす。\n"]),output);
  try {
    const answer=await ui.act({draft:1,seat:1,turn:1,title:"鐘楼",promise:"",question:"",cast:["時計師"],
      handout:{name:"時計師",desire:"",clue:"",win:""},events:[{id:"S0",text:"潮が迫る。"}]},[]);
    assert.equal(answer.action,"鐘を鳴らす。");
    assert.doesNotMatch(screen,/予想/);
  } finally {ui.close()}
});
