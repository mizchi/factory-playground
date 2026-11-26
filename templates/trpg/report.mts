import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {summarize,type QualityReport} from "./quality.mts";

const root=resolve(process.argv[2] || "runs");
const reports:QualityReport[]=[];
for (const e of readdirSync(root,{withFileTypes:true})) {
  if (!e.isDirectory()) continue;
  const dir=join(root,e.name);
  if (!existsSync(join(dir,"quality.json")) || !existsSync(join(dir,"result.json"))) continue;
  const result=JSON.parse(readFileSync(join(dir,"result.json"),"utf8"));
  if (!["READY_FOR_HUMAN","NEEDS_EDIT","CHECK_ASSESSMENT"].includes(result.status)) continue;
  reports.push(JSON.parse(readFileSync(join(dir,"quality.json"),"utf8")));
}
console.log(JSON.stringify(summarize(reports),null,2));
