import assert from "node:assert/strict";
import test from "node:test";
import {emergenceKeys} from "./session.mts";
import {readExperience, rubricVersion} from "./experience.mts";
import {metricKeys,reviewMetrics,summarize} from "./quality.mts";

test("missing or invented evidence cannot turn into a pass",()=>{
  assert.equal(new Set([...emergenceKeys,...metricKeys]).size,emergenceKeys.length+metricKeys.length);
  const fields={clarity:"PASS|D1|選べる",feasibility:"PASS|S9|間に合う",resolutionQuality:"感想だけ"};
  const metrics=reviewMetrics(fields,[{id:"D1",text:"次はどうする？"}]);
  assert.equal(metrics.clarity.status,"PASS");
  const log=[{id:"S0",text:"日没が迫る"},{id:"D1",text:"誰を呼ぶ？"}];
  assert.equal(reviewMetrics({clarity:"FAIL|S0・D1|署名の条件が不明"},log).clarity.status,"FAIL");
  assert.equal(reviewMetrics({clarity:"PASS|S0・D8|架空の発言"},log).clarity.status,"UNVERIFIED");
  assert.equal(metrics.feasibility.status,"UNVERIFIED");
  assert.equal(metrics.resolutionQuality.status,"UNVERIFIED");
});

test("first-pass yield excludes replay and is independent of eventual success",()=>{
  const log = [{id:"S0",text:"合図"}, {id:"A1.1",text:"一手"}, {id:"S1",text:"結果"}];
  const metrics=reviewMetrics({...Object.fromEntries(metricKeys.map(key=>[key,"PASS|S1|根拠"])),
    playExperience:"PASS|合図が一手を引き出した",setupEvidence:"S0|合図",choiceEvidence:"A1.1|一手",outcomeEvidence:"S1|結果"},log);
  const last={draft:2,status:"READY_FOR_HUMAN",metrics};
  const first={draft:1,status:"NEEDS_EDIT",metrics:{...metrics,clarity:{status:"FAIL" as const,note:"選択が不明"}}};
  const run={rubricVersion,mode:"fresh",wish:"祭り",history:[first,last]};
  const result=summarize([run,{...run,mode:"replay"},{...run,mode:"human"},{...run,mode:"refine"},{...run,rubricVersion:1}]);
  assert.deepEqual([result.evaluated,result.firstDraftReady,result.finalDraftReady,result.firstDraftFailures.clarity,result.finalDraftFailures.clarity],[1,0,1,1,0]);
});

test("experiential evidence identifies an earlier opportunity, a PC decision and a later world response", () => {
  const log = [{id:"S0",text:"名前か宛先のどちらかしか読めない。"}, {id:"A1.1",text:"二枚を重ねて宛先を読もう。"}, {id:"S1",text:"宛先を読んだ乗客が乗り換えた。"}];
  const pass = {playExperience:"PASS|切符を重ねた工夫が乗客に届いた",setupEvidence:"S0|名前か宛先",choiceEvidence:"A1.1|二枚を重ねて",outcomeEvidence:"S1|乗客が乗り換えた"};
  assert.deepEqual(readExperience(pass,log).trace?.map(e=>e.id),["S0","A1.1","S1"]);
  for (const patch of [{setupEvidence:"NONE"},{setupEvidence:"S1|乗客"},{setupEvidence:"A1.1|二枚"},
      {choiceEvidence:"S0|名前"},{choiceEvidence:"A1.1|二人で巻いた"},{outcomeEvidence:"S9|乗客"}]) {
    assert.equal(readExperience({...pass,...patch},log).status,"UNVERIFIED");
  }
  const fail = {...pass,playExperience:"FAIL|切符を重ねても放送が変わらない。届け先をPCに選ばせる", setupEvidence:"NONE",choiceEvidence:"NONE"};
  assert.equal(readExperience(fail,log).status,"FAIL");
  assert.equal(readExperience({...fail,outcomeEvidence:"NONE"},log).status,"UNVERIFIED");
});
