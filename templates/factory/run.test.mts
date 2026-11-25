import assert from "node:assert/strict";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {loadSpec, produce} from "./run.mts";

test("a mechanical failure avoids a reviewer call; a corrected draft can ship", async t => {
  const run=mkdtempSync(join(tmpdir(), "factory-template-"));
  t.after(() => rmSync(run,{recursive:true,force:true}));
  const spec=loadSpec(join(import.meta.dirname,"factory.json"));
  const good=spec.requiredHeadings.map(h => "## "+h).join("\n")+"\n気軽に参加";
  const calls: string[]=[];
  const result=await produce(spec,run,async (_route,prompt,keys): Promise<Record<string,string>> => {
    calls.push(keys[0]);
    if(keys[0]==="artifact"){
      if(calls.length>1) assert.match(prompt,/見出しがありません/);
      return {artifact:calls.length===1?"oops":good};
    }
    return {status:"ACCEPT",quote:"気軽に参加",reason:"確認済み"};
  });
  assert.deepEqual(calls,["artifact","artifact","status"]);
  assert.equal(result.status,"ACCEPTED");
  assert.ok(existsSync(join(run,"delivery.md")));
});
