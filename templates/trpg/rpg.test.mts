import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { choices, initial, modules, resolveMove, rulesFrom } from "./rpg.mts";
import { playtest, readTable } from "./run.mts";
import { loadBranch } from "./checkpoint.mts";
import type { Call } from "./session.mts";

const params = { obstacle:"満潮の水路",maxHp:"2",damage:"2",wound:"疲労",item:"浮き袋",stock:"1",
  room1:"浜",room2:"堤防",room3:"灯台" };

test("selecting modules independently changes available actions and enforces their costs", () => {
  assert.equal(rulesFrom({},modules(undefined),2),undefined);
  assert.throws(()=>modules(["maps"]));
  assert.throws(()=>rulesFrom({...params,damage:"3"},["hp"],2));
  for (const mod of ["hp","items","dungeon"] as const) {
    const r=rulesFrom(params,[mod],2)!, s=initial(r,2);
    const moves=()=>choices(r,s,0).map(m=>m.code);
    if (mod==="hp") {
      assert.deepEqual(moves(),["stay","risk"]);
      assert.match(resolveMove(r,s,0,"risk"),/疲労/);
      assert.deepEqual(s.hp,[0,2]);
      assert.deepEqual(moves(),["stay"]);
    } else if(mod==="items") {
      resolveMove(r,s,0,"use");
      assert.throws(()=>resolveMove(r,s,1,"use"));
      assert.equal(s.stock,0);
    } else {
      assert.throws(()=>resolveMove(r,s,0,"walk-3"));
      resolveMove(r,s,0,"walk-2");
      resolveMove(r,s,0,"walk-3");
      assert.deepEqual(s.positions,[2,0]);
    }
  }
});

test("resume restores HP, route and depleted shared item from logged actions, replay reuses parameters",async t=>{
  const temp=()=>{const p=mkdtempSync(join(tmpdir(),"rpg-"));t.after(()=>rmSync(p,{recursive:true,force:true}));return p};
  const source=temp(), child=temp();
  const table=readTable(join(import.meta.dirname,"table-dungeon.json"));
  const call:Call=async(role,prompt,keys)=>{
    const fields=Object.fromEntries(keys.map(k=>[k,k]));
    if(role==="author")return {...fields,...params,maxHp:"時計師:3、案内人:4"};
    if(role==="rules")return params;
    if(role==="player"){
      const menu=JSON.parse(prompt.split("選べる行動: ")[1].split("。move")[0]) as {code:string}[];
      const move=["use","risk","stay"].find(code=>menu.some(m=>m.code===code))!;
      return {...fields,move};
    }
    if(role==="continuity")return {...fields,choice:"OK"};
    return fields;
  };
  await playtest(table,source,call);
  const draft=join(source,"draft-1");
  const read=(dir:string,file:string)=>JSON.parse(readFileSync(join(dir,file),"utf8"));
  const {point,context}=loadBranch(draft,1,2,2);
  assert.deepEqual(point.publicLog.filter(e=>e.move).map(e=>e.move),["use","risk"]);
  await playtest(table,child,(role,p,k)=>{assert.notEqual(role,"author");return call(role,p,k)},read(draft,"scenario.json"),undefined,context,point);
  const output=read(draft,"mechanics.json");
  assert.deepEqual(output.state,{hp:[0,0],stock:0,positions:[0,2]});
  assert.deepEqual(read(join(child,"draft-1"),"mechanics.json"),output);
});

test("a PC can spend the last charge without moving, including inside the dungeon",()=>{
  const rules=rulesFrom({...params,item:"録音筒"},["items","dungeon"],2)!;
  const state=initial(rules,2);
  resolveMove(rules,state,0,"walk-2");
  assert.match(resolveMove(rules,state,0,"use-here"),/録音筒/);
  assert.deepEqual(state,{positions:[1,0],stock:0});
  assert.throws(()=>resolveMove(rules,state,1,"use"));
  assert.throws(()=>resolveMove(rules,state,0,"use-here"));
});

test("a READY review with a cited item discrepancy still requires an edit",async t=>{
  const run=mkdtempSync(join(tmpdir(),"rpg-quality-"));
  t.after(()=>rmSync(run,{recursive:true,force:true}));
  const table={...readTable(join(import.meta.dirname,"table-dungeon.json")),maxRevisions:0};
  const call:Call=async(role,prompt,keys)=>{
    const fields=Object.fromEntries(keys.map(k=>[k,k]));
    if(role==="survey")return {...fields,satisfaction:"楽しかった|S1|試せた",fairness:"納得|S1|理由",tension:"ちょうどよい|S1|迷えた",challenge:"手応えあり|S1|工夫"};
    if(role==="author")return {...fields,...params};
    if(role==="player")return {...fields,move:"stay"};
    if(role==="gm")return {...fields,narration:"浮き袋を一つ使った。"};
    if(role==="judge"){
      assert.match(prompt,/use-here/);
      return {...fields,
      playExperience:"PASS|共有品を残す手を選んだ",setupEvidence:"S0|opening",choiceEvidence:"A1.1|action",outcomeEvidence:"S2|浮き袋",
      settingDepth:"PASS|S0|舞台を使用",clarity:"PASS|S0|目的を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",status:"READY",emergence:"OBSERVED",proposal:"A1.1",response:"A1.2",consequence:"S2",evidenceId:"S2",quote:"浮き袋",stockConflict:"S2"};
    }
    return {...fields,choice:"OK"};
  };
  const result=await playtest(table,run,call);
  assert.equal(result.status,"NEEDS_EDIT");
  const feedback=JSON.parse(readFileSync(join(run,"draft-1/revision.json"),"utf8"));
  assert.ok(feedback.failures.some((f:{metric:string})=>f.metric==="stockConflict"));
  assert.equal(JSON.parse(readFileSync(join(run,"draft-1/mechanics.json"),"utf8")).state.stock,1);
});
