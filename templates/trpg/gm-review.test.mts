import assert from "node:assert/strict";
import test from "node:test";
import {axes,groundedReview} from "./gm-review.mts";

test("both sides of a directing judgment cite that GM's own public words after branching",()=>{
  const a=[{id:"S1",text:"鐘が鳴る。"}], b=[{id:"S1",text:"橋が上がる。"}];
  const fields = Object.fromEntries(axes.flatMap(k=>[[k,"互角"],[k+"Reason","互いに時刻を示した"],[k+"A","S1|鐘が鳴る"],[k+"B","S1|橋が上がる"]]));
  assert.equal(groundedReview(fields,a,b).handoff.preference,"互角");
  for (const citation of ["S0|以前の描写","S1|橋が上がる","A1.2|鐘が鳴る","S1| "])
    assert.throws(()=>groundedReview({...fields,handoffA:citation},a,b));
});
