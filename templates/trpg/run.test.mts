import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {playtest,readTable,tableFromWish} from "./run.mts";

test("three PCs see only public play, choose after the twist, and revise on grounded evidence", async t => {
  const run=mkdtempSync(join(tmpdir(),"trpg-test-"));
  t.after(()=>rmSync(run,{recursive:true,force:true}));
  const table=readTable(join(import.meta.dirname,"table.json"));
  table.players.push({name:"三人目", desire:"調べる"});
  table.complications=["時計が止まる"];
  let drafts=0, playerCalls=0, finalReplies=0;
  const final=await playtest(table,run,async (role,prompt,keys)=>{
    const r: Record<string,string>=Object.fromEntries(keys.map(k=>[k,"感想"]));
    if(role==="author"){
      if(drafts++) assert.match(prompt,/選択を残す/);
      return {...r,win1:"映写",win2:"記帳",win3:"回収",handout1:"封筒甲",handout2:"封筒乙",handout3:"封筒丙",secret:"秘密の正解",opening:"映画が始まる"};
    }
    if(role==="player"){
      playerCalls++;
      const seat = ["映写係","商店街の配達人","三人目"].findIndex(name => prompt.startsWith("あなたはPC「"+name+"」"));
      assert.notEqual(seat,-1);
      for (const [j,token] of ["甲","乙","丙"].entries()) {
        assert.equal(prompt.includes("封筒"+token),j===seat);
        assert.equal(prompt.includes("秘密の予想"+token),j===seat && prompt.includes('"id": "S1"'));
      }
      assert.doesNotMatch(prompt,/秘密の正解/);
      if(prompt.includes('"id": "S1"')) {
        assert.match(prompt,/時計は止まった/);
        assert.match(prompt,/誰に渡すか/);
      }
      return {...r,prediction:"秘密の予想"+["甲","乙","丙"][seat],action:"扉を開ける"};
    }
    if(role==="reply"){
      finalReplies++;
      assert.match(prompt,/"A2.1"/);
      assert.match(prompt,/"A2.2"/);
      assert.match(prompt,/"A2.3"/);
      assert.equal([...prompt.matchAll(/封筒[甲乙丙]/g)].length,1);
      return {...r,action:"先ほどの案に応じる"};
    }
    if(role==="npc") assert.doesNotMatch(prompt,/封筒[甲乙丙]|秘密の正解|秘密の予想/);
    if(role==="continuity") return {...r,choice:"OK"};
    if(role==="gm"){
      assert.match(prompt,/秘密の正解/);
      assert.doesNotMatch(prompt,/秘密の予想/);
      return {...r,decision:"誰に渡すか",narration:prompt.includes("時計が止まる")?"時計は止まった":"朝が来た"};
    }
    if(role==="survey") assert.doesNotMatch(prompt,/秘密の正解/);
    if(role==="judge"){
      assert.doesNotMatch(prompt,/秘密の正解/);
      return {...r,clarity:"PASS|D1|選択を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",emergence:"OBSERVED",proposal:"A1.1",response:"A1.2",consequence:"S1",status:drafts===1?"REVISE":"READY",evidenceId:"S2",quote:"朝が来た",change:"選択を残す"};
    }
    return r;
  });
  assert.equal(playerCalls,12);
  assert.equal(finalReplies,4);
  assert.equal(final.status,"READY_FOR_HUMAN");
  assert.equal(final.draft,2);
  const saved=JSON.parse(readFileSync(join(run,"draft-2/scenario.json"),"utf8"));
  const replay=mkdtempSync(join(tmpdir(),"trpg-replay-"));t.after(()=>rmSync(replay,{recursive:true,force:true}));
  const second=await playtest({...table,seed:0,maxRevisions:0},replay,async(role,prompt,keys)=>{
    assert.notEqual(role,"author");
    if(role==="gm") assert.doesNotMatch(prompt,/時計が止まる/);
    const r=Object.fromEntries(keys.map(k=>[k,"記録"]));
    return {...r,choice:"OK",clarity:"PASS|S0|目的を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",status:"READY",evidenceId:"S2",quote:"ログにない引用"};
  },saved);
  assert.equal(second.status,"CHECK_ASSESSMENT");
});

test("a free-form wish creates its own promise and cast",async()=>{
  const original=readTable(join(import.meta.dirname,"table.json"));
  const table=await tableFromWish("宇宙の料理大会",original,async()=>({promise:"味を選ぶ",openQuestion:"料理の名前",name1:"料理人",desire1:"挑戦",name2:"審査員",desire2:"発見",lens:"風味"}));
  assert.equal(table.wish,"宇宙の料理大会");
  assert.deepEqual(table.players.map(p=>p.name),["料理人","審査員"]);
  assert.notEqual(table.promise,original.promise);
});

test("a 60-minute playtest records four distinct beats and a cited GM contradiction blocks release", async t => {
  const run = mkdtempSync(join(tmpdir(),"trpg-60-"));
  t.after(() => rmSync(run,{recursive:true,force:true}));
  const table = readTable(join(import.meta.dirname,"table.json"));
  const result = await playtest({...table, minutes:60, maxRevisions:0, designSources:[]},run,async (role,prompt,keys) => {
    const fields = Object.fromEntries(keys.map(k => [k,k]));
    assert.notEqual(role,"director");
    if (role === "author") assert.match(prompt,/別の現場/);
    if (role === "gm" && prompt.includes("今回が最終場面")) return { ...fields, narration:"鐘は二つ" };
    if (role === "judge") return {...fields, clarity:"PASS|S0|目的を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",status:"READY", evidenceId:"S4", quote:"鐘は二つ", emergence:"OBSERVED",
      proposal:"A1.1", response:"A1.2", consequence:"S1"};
    return fields;
  },undefined, async state => ({ model:"test", choice:JSON.parse(state).current.id === "S4" ? "CANON" : "OK" }));
  assert.equal(result.status,"NEEDS_EDIT");
  const notes = readFileSync(join(run,"draft-1/scenario.md"),"utf8");
  assert.doesNotMatch(notes,/GMの進行ガイドライン/);
  assert.match(notes,/60分卓/);
  assert.match(notes,/beat4/);
  const audit = JSON.parse(readFileSync(join(run,"draft-1/continuity.json"),"utf8"));
  assert.deepEqual(audit.map((a: {current:{id:string}}) => a.current.id),["S0","S1","S2","S3","D3","S4"]);
  assert.equal(audit.at(-1).conflict.id,"CANON");
});

test("an old draft receives private handouts without rewriting its scenario; unknown goes to review", async t => {
  const run = mkdtempSync(join(tmpdir(),"trpg-legacy-"));
  t.after(() => rmSync(run,{recursive:true,force:true}));
  const path = join(import.meta.dirname,"examples/moon");
  const scenario = JSON.parse(readFileSync(join(path,"draft-1/scenario.json"),"utf8"));
  let supplements = 0;
  const result = await playtest(readTable(join(path,"table.json")),run,async (role,_prompt,keys) => {
    assert.notEqual(role,"author");
    if (role === "supplement") supplements++;
    const fields = Object.fromEntries(keys.map(k => [k,k]));
    return {...fields, clarity:"PASS|S0|目的を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",status:"READY", evidenceId:"S0", quote:scenario.opening, emergence:"OBSERVED",
      proposal:"A1.1", response:"A1.2", consequence:"S1"};
  },scenario,async () => ({model:"test",choice:"UNKNOWN"}));
  assert.equal(supplements,1);
  assert.equal(result.status,"CHECK_ASSESSMENT");
  const saved = JSON.parse(readFileSync(join(run,"draft-1/scenario.json"),"utf8"));
  assert.equal(saved.secret,scenario.secret);
  assert.equal(saved.win2,"win2");
});

test("one author call creates the complete first draft; a rubric failure alone triggers a fresh playtest",async t=>{
  const run=mkdtempSync(join(tmpdir(),"trpg-fresh-"));
  t.after(()=>rmSync(run,{recursive:true,force:true}));
  const defaults={...readTable(join(import.meta.dirname,"table.json")),designSources:[]};
  const wish="氷原の料理対決";
  const authors:string[]=[];
  let reviews=0;
  const result=await playtest(defaults,run,async(role,prompt,keys)=>{
    const fields=Object.fromEntries(keys.map(k=>[k,k]));
    assert.notEqual(role,"brief");
    if(role==="author"){
      authors.push(prompt);
      assert.match(prompt,/氷原の料理対決/);
      assert.doesNotMatch(prompt,/映画館|エンドロール|映写係/);
      if(authors.length===2){
        assert.match(prompt,/皿の所有者が譲った理由を置く/);
        assert.match(prompt,/氷皿を分けた/);
        assert.doesNotMatch(prompt,/別のお題/);
      }
      return {...fields,title:"氷皿",name1:"職人",name2:"味見役",twist:"氷が薄くなる"};
    }
    if(role==="gm")return {...fields,narration:"氷皿を分けた"};
    if(role==="judge"){
      reviews++;
      return {...fields,status:"READY",change:"NONE",clarity:"PASS|D1|代償を提示",feasibility:"PASS|D1|どちらも実行可能",
        resolutionQuality:reviews===1?"FAIL|S2|皿の所有者が譲った理由を置く":"PASS|S2|譲歩の条件が満たされた",
        emergence:"OBSERVED",proposal:"A1.1",response:"A1.2",consequence:"S1",evidenceId:"S2",quote:"氷皿"};
    }
    return {...fields,choice:"OK"};
  },undefined,undefined,undefined,undefined,undefined,wish);
  assert.equal(result.status,"READY_FOR_HUMAN");
  assert.equal(authors.length,2);
  const read=(f:string)=>JSON.parse(readFileSync(join(run,f),"utf8"));
  assert.deepEqual(read("table.json").complications,["氷が薄くなる"]);
  assert.equal(read("quality.json").mode,"fresh");
  assert.deepEqual(read("quality.json").history.map((h:{status:string})=>h.status),["NEEDS_EDIT","READY_FOR_HUMAN"]);
  assert.equal(read("draft-2/session.json")[0].id,"S0");
});
