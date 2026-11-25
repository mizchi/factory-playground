import samples from "./samples.json" with { type: "json" };
import type { Job } from "./solve.ts";

export type TestCase = { name: string; jobs: Job[]; optimum: number };

function job(id: string, start: number, end: number, reward: number): Job {
  return { id, start, end, reward };
}

// Enumerate feasible subsets for small cases, independently of the submitted DP.
function exhaustiveReward(jobs: Job[]) {
  const ordered = jobs.toSorted((a, b) => a.start - b.start);
  function visit(index: number, freeAt: number): number {
    if (index === ordered.length) return 0;
    const next = ordered[index];
    const skip = visit(index + 1, freeAt);
    if (next.start < freeAt) return skip;
    return Math.max(skip, next.reward + visit(index + 1, next.end));
  }
  return visit(0, 0);
}

export function* cases(): Generator<TestCase> {
  const examples: [string, Job[]][] = [
    ["empty", []],
    ["greedy-trap", [job("long", 0, 4, 9), job("am", 0, 2, 5), job("pm", 2, 4, 5), job("quick", 0, 1, 1)]],
    ["equal-optima", [job("both", 0, 4, 10), job("b", 2, 4, 5), job("a", 0, 2, 5)]],
    ["negative-only", [job("loss", 0, 1, -5)]],
    ["large-rewards", Array.from({ length: 4 }, (_, i) => job(String(i), i, i + 1, 1e9))],
  ];
  // Fixed vectors preserve the seeded inputs and order from the first task release.
  for (const [n, sample] of samples.small.entries()) {
    const jobs = sample.map(([start, end, reward], i) => job(String(i), start, end, reward));
    examples.push([`random-${String(n).padStart(2, "0")}`, jobs]);
  }
  for (const [name, jobs] of examples) yield { name, jobs, optimum: exhaustiveReward(jobs) };

  // Independent blocks. Each pair of half slots earns 10 vs. 9 for the whole.
  const jobs: Job[] = [];
  for (let i = 0; i < 1000; i++) {
    const start = i * 2;
    jobs.push(job(`whole-${i}`, start, start + 2, 9),
      job(`left-${i}`, start, start + 1, 5), job(`right-${i}`, start + 1, start + 2, 5));
  }
  yield { name: "3000-jobs", jobs: samples.largeOrder.map(index => jobs[index]), optimum: 10000 };
}
