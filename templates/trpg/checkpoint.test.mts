import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextWith, defaultContext, loadBranch, loggedCall } from "./checkpoint.mts";
import { playtest, readTable } from "./run.mts";
import type { Call } from "./session.mts";

test("resume a failed GM decision with a different view, retaining private states and exact public prefix", async t => {
  function temp() {
    const dir = mkdtempSync(join(tmpdir(),"gm-checkpoint-"));
    t.after(() => rmSync(dir,{recursive:true,force:true}));
    return dir;
  }
  const source = temp(), child = temp();
  const draft = join(source,"draft-1");
  const table = {...readTable(join(import.meta.dirname,"table.json")),maxRevisions:0,designSources:["mda"]};
  const context = contextWith(defaultContext,{metadata:{event:"test",hidden:"HIDDEN_META"},gm:{notes:"original note"}});
  const generated: Call = async (role,prompt,keys) => {
    const fields = Object.fromEntries(keys.map(k => [k,k]));
    if (role === "gm" && prompt.includes("今回が最終場面")) throw new Error("GM stopped");
    if (role === "director") {
      assert.deepEqual(keys,["mda"]);
      assert.doesNotMatch(prompt,/WIN_ONE|GM_CANON|PLANNED_END/);
      return {...fields,mda:"GUIDE_FOR_THIS_TABLE"};
    }
    if (role === "gm") assert.match(prompt,/GUIDE_FOR_THIS_TABLE/);
    else assert.doesNotMatch(prompt,/GUIDE_FOR_THIS_TABLE/);
    if (role === "author") assert.match(prompt,/\[mda\]/);
    if (role === "author") return {...fields,secret:"GM_CANON",win1:"WIN_ONE",win2:"WIN_TWO",beat2:"HIDDEN_BEAT",ending:"PLANNED_END"};
    if (role === "player") return {...fields,prediction:prompt.startsWith("あなたはPC「映写係") ? "PRED_ONE" : "PRED_TWO"};
    if (role === "gm") return {...fields,narration:"EARLIER_GM_OUTCOME",decision:"EARLIER_DECISION"};
    return fields;
  };
  await assert.rejects(playtest(table,source,loggedCall(source,generated),undefined,undefined,context),/GM stopped/);
  const path = join(draft,"checkpoints/before-gm-2.json");
  const original = readFileSync(path,"utf8");
  const branch = loadBranch(draft,2,2,2);
  assert.equal(branch.source.origin,"checkpoint");
  const limited = contextWith(branch.context,{metadata:{variant:"branch"},gm:{history:"scene",sections:["secret"],notes:"NEW_DM_NOTE",metadataKeys:["variant"]}});
  assert.deepEqual(limited.metadata,{event:"test",hidden:"HIDDEN_META",variant:"branch"});
  const scenario = JSON.parse(readFileSync(join(draft,"scenario.json"),"utf8"));
  const booklet=readFileSync(join(draft,"scenario.md"),"utf8");
  assert.match(booklet,/GUIDE_FOR_THIS_TABLE/);
  assert.match(booklet,/MDA\.pdf/);
  assert.doesNotMatch(booklet,/thealexandrian\.net/);
  const roles:string[] = [];
  const resumed: Call = async (role,prompt,keys) => {
    roles.push(role);
    const fields = Object.fromEntries(keys.map(k => [k,k]));
    if (role === "gm") {
      assert.match(prompt,/GUIDE_FOR_THIS_TABLE/);
      assert.match(prompt,/GM_CANON/);
      assert.match(prompt,/NEW_DM_NOTE/);
      assert.match(prompt,/"variant": "branch"/);
      assert.match(prompt,/EARLIER_DECISION/);
      assert.doesNotMatch(prompt,/HIDDEN_META|PRED_|WIN_|HIDDEN_BEAT|PLANNED_END|original note|"id": "A1\.1"/);
      return {...fields,narration:"BRANCHED_OUTCOME"};
    }
    assert.doesNotMatch(prompt,/NEW_DM_NOTE/);
    if (role === "survey") {
      const seat = prompt.startsWith("あなたは映写係") ? "ONE" : "TWO";
      assert.ok(prompt.includes("PRED_"+seat));
      assert.ok(!prompt.includes("PRED_"+(seat==="ONE"?"TWO":"ONE")));
    }
    return {...fields,clarity:"PASS|S0|目的を提示",feasibility:"PASS|S1|帰結を提示",resolutionQuality:"PASS|S2|選択を反映",status:"READY",emergence:"OBSERVED",proposal:"A1.1",response:"A1.2",consequence:"S2",evidenceId:"S2",quote:"BRANCHED_OUTCOME"};
  };
  await playtest(table,child,loggedCall(child,resumed),scenario,async () => ({choice:"OK",model:"test"}),limited,branch.point);
  assert.deepEqual(roles,["gm","survey","survey","judge"]);
  const log = JSON.parse(readFileSync(join(child,"draft-1/session.json"),"utf8"));
  assert.deepEqual(log.slice(0,-1),branch.point.publicLog);
  assert.equal(log.at(-1).text,"BRANCHED_OUTCOME");
  assert.equal(readFileSync(path,"utf8"),original);
  const lines = readFileSync(join(source,"calls.jsonl"),"utf8").trim().split("\n").map(s => JSON.parse(s));
  assert.equal(lines.at(-1).phase,"error");
  assert.equal(lines.at(-1).id,lines.at(-2).id);
});

test("unknown context fields are rejected before showing private information", () => {
  for (const patch of [{gm:{sections:["secter"]}},{gm:{history:"scean"}},{gm:{note:"typo"}},{metadata:{flag:1}}])
    assert.throws(() => contextWith(defaultContext,patch));
});
