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
