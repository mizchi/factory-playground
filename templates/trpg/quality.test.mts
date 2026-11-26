import assert from "node:assert/strict";
import test from "node:test";
import {emergenceKeys} from "./session.mts";
import {metricKeys,reviewMetrics,summarize} from "./quality.mts";

test("missing or invented evidence cannot turn into a pass",()=>{
  assert.equal(new Set([...emergenceKeys,...metricKeys]).size,emergenceKeys.length+metricKeys.length);
  const fields={clarity:"PASS|D1|選べる",feasibility:"PASS|S9|間に合う",resolutionQuality:"感想だけ"};
  const metrics=reviewMetrics(fields,[{id:"D1",text:"次はどうする？"}]);
  assert.equal(metrics.clarity.status,"PASS");
  assert.equal(metrics.feasibility.status,"UNVERIFIED");
  assert.equal(metrics.resolutionQuality.status,"UNVERIFIED");
});

test("first-pass yield excludes replay and is independent of eventual success",()=>{
  const metrics=reviewMetrics(Object.fromEntries(metricKeys.map(key=>[key,"PASS|S1|根拠"])),[{id:"S1",text:"結果"}]);
  const last={draft:2,status:"READY_FOR_HUMAN",metrics};
  const first={draft:1,status:"NEEDS_EDIT",metrics:{...metrics,clarity:{status:"FAIL",note:"選択が不明"}}};
  const run={rubricVersion:1,mode:"fresh",wish:"祭り",history:[first,last]};
  const result=summarize([run,{...run,mode:"replay"},{...run,mode:"human"},{...run,rubricVersion:0}]);
  assert.deepEqual([result.evaluated,result.firstDraftReady,result.finalDraftReady,result.firstDraftFailures.clarity],[1,0,1,1]);
});
