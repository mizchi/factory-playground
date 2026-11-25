import { readFileSync } from "node:fs";

export type Job = { id: string; start: number; end: number; reward: number };

function solve(input: Job[]) {
  const jobs = input.toSorted((a, b) => a.end - b.end);
  const best = [0]; // best[i] is the maximum reward using the first i jobs.
  const previous: number[] = [];
  for (const [i, job] of jobs.entries()) {
    let lo = 0;
    let hi = i;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (jobs[mid].end <= job.start) lo = mid + 1;
      else hi = mid;
    }
    previous.push(lo);
    const take = best[lo] + job.reward;
    best.push(Math.max(best[i], take));
    if (process.env.SCHEDULE_TRACE === "1") {
      console.error(`  ${job.id}: 採用 ${take} / 見送り ${best[i]} → 最良 ${best[i + 1]}`);
    }
  }
  const ids: string[] = [];
  for (let i = jobs.length; i > 0;) {
    if (best[i] === best[i - 1]) i--;
    else {
      ids.push(jobs[i - 1].id);
      i = previous[i - 1];
    }
  }
  return { reward: best[jobs.length], ids: ids.reverse() };
}

console.log(JSON.stringify(solve(JSON.parse(readFileSync(0, "utf8")))));
