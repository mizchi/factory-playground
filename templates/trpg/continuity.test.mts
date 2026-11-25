import assert from "node:assert/strict";
import test from "node:test";
import { checkContinuity, jevDecision } from "./continuity.mts";
import { duration, emergenceVerified, schedule } from "./session.mts";

test("Jev Choice sends only the story so far and records the cited contradiction and probabilities", async () => {
  const log = [{id:"S0",text:"町の鐘は鋳造以来、ひとつだけ。"}, {id:"N1",text:"鐘は三つあるはずだ。"}, {id:"S1",text:"昔から町には鐘が二つある。"}];
  const decide = jevDecision("test-key","jev-test", async (url, options) => {
    assert.equal(url,"https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer test-key");
    const {model,state,questions} = JSON.parse(String(options?.body));
    assert.equal(model,"jev-test");
    const {current} = JSON.parse(state);
    const q = questions.continuity;
    assert.equal(q.type,"choice");
    assert.ok(!Object.hasOwn(q.criteria,"N1"));
    if (current.id === "S0") assert.ok(!state.includes(log[2].text));
    const choice = current.id === "S0" ? "OK" : "S0";
    const probabilities = Object.fromEntries(Object.keys(q.criteria).map(k => [k, Number(k === choice)]));
    return Response.json({ model:"jev-test",answers:{continuity:{type:"choice",choice,confidence:1,probabilities}} });
  });
  const checks = await checkContinuity("町は鐘を守っている。",log,decide);
  assert.equal(checks.length,2);
  assert.deepEqual(checks[1].conflict,log[0]);
  assert.equal(checks[1].probabilities?.S0,1);
  assert.throws(() => jevDecision(""));
  await assert.rejects(checkContinuity("設定",log,async () => ({choice:"N1",model:"example"})),/選択肢/);
});

test("the interaction must cross seats and cause a later GM outcome", () => {
  const log = ["A1.1","S1","A2.1","A2.2","R2.1","N2","S2"].map(id => ({id,text:id}));
  const a = { emergence:"OBSERVED",proposal:"A1.1",response:"A2.2",consequence:"S2" };
  assert.ok(emergenceVerified(a,log));
  assert.ok(emergenceVerified({...a,proposal:"A2.2",response:"R2.1"},log));
  for (const change of [{response:"A2.1"},{consequence:"S1"},{response:"N2"},{proposal:"fake"}]) {
    assert.ok(!emergenceVerified({...a,...change},log));
  }
});

test("the 60 minute table budgets additional investigation and negotiation scenes", () => {
  for (const minutes of [30,60] as const) {
    const plan = schedule(minutes,minutes === 30 ? 2 : 4);
    assert.equal(plan.briefing + plan.debrief + plan.scenes.reduce((sum,s) => sum+s.minutes,0),minutes);
    assert.equal(plan.scenes.some(s => s.aim.includes("別の現場")),minutes === 60);
  }
  assert.throws(() => duration(45));
});

test("a failed or malformed Jev decision is never reported as a consistent scene", async () => {
  const criteria = { OK:"両立する", UNKNOWN:"情報不足" };
  const denied = jevDecision("test","test",async () => new Response(null,{status:401}));
  await assert.rejects(denied("test",criteria),/401/);
  const incomplete = jevDecision("test","test",async () => Response.json({
    model:"test",answers:{continuity:{type:"choice",choice:"OK",confidence:1,probabilities:{OK:1}}}
  }));
  await assert.rejects(incomplete("test",criteria),/応答/);
});
