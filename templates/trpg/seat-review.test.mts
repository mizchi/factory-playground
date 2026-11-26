import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {seatMetrics,trialSummary} from "./seat-review.mts";
import {previousFocus,runPatternSeries} from "./pattern-focus.mts";
import {playSchedule} from "./patterns.mts";
import {rubricVersion} from "./experience.mts";

test("a negative seat is audible; a human need not invent an event ID and a model must cite one", () => {
  const log=[{id:"S1",text:"潮が変わる。"}];
  const bot={satisfaction:"楽しかった|S1|待てた",tension:"強すぎる|S1|考える猶予がない"};
  const human={controller:"human",satisfaction:"退屈だった|本人申告|黙って待った",tension:"ちょうどよい|本人申告|迷えた"};
  const metrics=seatMetrics([bot,human],log);
  assert.equal(metrics.enjoyment.status,"FAIL");
  assert.equal(metrics.enjoyment.responses?.[1].controller,"human");
  assert.equal(metrics.tension.status,"FAIL");
  const summary=trialSummary({...metrics,settingDepth:{status:"PASS",note:"潮で判断が変わった"}});
  assert.match(summary,/楽しさ × 席2「退屈だった」/);
  assert.match(summary,/緊張感 × 席1「強すぎる」/);
  assert.equal(metrics.credibility.status,"UNVERIFIED");
  assert.equal(seatMetrics([{...bot,satisfaction:"楽しかった|S999|あった"}],log).enjoyment.status,"UNVERIFIED");
  assert.equal(seatMetrics([{satisfaction:"楽しかった|A1.2,S1|提案が後で効いた"}],[{id:"A1.2",text:"相談"},...log]).enjoyment.status,"PASS");
  assert.equal(seatMetrics([{satisfaction:"楽しかった|A9.2,S1|提案が後で効いた"}],log).enjoyment.status,"UNVERIFIED");
  assert.equal(seatMetrics([{...bot,satisfaction:human.satisfaction}],log).enjoyment.status,"UNVERIFIED");
});
test("the next pattern inherits a grounded criterion, without copying the previous plot or a seat's handout", t=>{
  const dir=mkdtempSync(join(tmpdir(),"trpg-focus-"));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  const write=(file:string,v:unknown)=>writeFileSync(join(dir,file),JSON.stringify(v));
  const draft={draft:1,status:"NEEDS_EDIT",emergence:"ABSENT",continuity:[],metrics:{tension:{status:"FAIL",note:"古い卓の秘密"}}};
  write("quality.json",{rubricVersion,history:[draft,{...draft,draft:2,status:"READY_FOR_HUMAN"}]});
  write("result.json",{status:"READY_FOR_HUMAN"});
  const focus=previousFocus(dir);
  assert.deepEqual(focus.map(f=>[f.draft,f.criterion]),[[1,"tension"],[1,"emergence"]]);
  assert.doesNotMatch(JSON.stringify(focus),/古い卓の秘密/);
  write("result.json",{status:"CHECK_ASSESSMENT"});
  assert.throws(()=>previousFocus(dir));
});

test("a series finishes each pattern before starting the next and skips unverified feedback", async () => {
  const seen:string[] = [];
  const rows = await runPatternSeries(async (id, previous) => {
    seen.push(`start ${id} ${previous ?? "-"}`);
    await new Promise<void>(done=>setImmediate(done));
    seen.push(`end ${id}`);
    return {run:id, draft:1, status:id==="pressure" ? "CHECK_ASSESSMENT" : id==="routes" ? "NEEDS_EDIT" : "READY_FOR_HUMAN"};
  });
  assert.deepEqual(seen,["start clues -","end clues","start pressure clues","end pressure","start reversal -","end reversal",
    "start routes reversal","end routes","start relationships routes","end relationships"]);
  assert.equal(rows.length,5);
});

test("the route adventure reserves a return decision at both table lengths", () => {
  for (const [minutes,scenes] of [[30,2],[60,4]] as const) {
    const plan=playSchedule(minutes,scenes,"routes");
    assert.equal(plan.scenes.length,scenes);
    assert.equal(plan.scenes.reduce((n,s)=>n+s.minutes,plan.briefing+plan.debrief),minutes);
    assert.match(plan.scenes[0].aim,/往路/);
    assert.match(plan.scenes.at(-1)!.aim,/帰り方/);
  }
});

test("the short pressure game keeps a choice of rendezvous before the deadline", () => {
  const first=playSchedule(30,2,"pressure").scenes[0];
  assert.match(first.aim,/複数の合流先/);
});
