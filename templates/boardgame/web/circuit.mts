import { examples } from "../examples.mts";
import { allMoves, type Move, type Pattern } from "../game.mts";

export const circuitLength = 5;
export const maxLives = 3;
export const healCost = 3;
const risks = [
  { label: "平場", lead: 0, stake: 1, reward: 1 },
  { label: "強敵", lead: 1, stake: 1, reward: 3 },
  { label: "大勝負", lead: 2, stake: 2, reward: 5 },
] as const;
export type CircuitMove = { move: Move; controller: "human" | "cpu" | "jev" | "llm" };
type Result = { pattern: Pattern; result: "win" | "loss" | "draw"; points: number; lives: number };
export type Circuit = {
  seed: number;
  poolSize?: number;
  lives: number;
  points: number;
  trail: Result[];
  active: { slot: number; actions: CircuitMove[] } | null;
};

export function startCircuit(seed: number): Circuit {
  return { seed, poolSize: examples.length, lives: maxLives, points: 0, trail: [], active: null };
}

export function circuitStatus(run: Circuit) {
  return run.lives === 0 ? "lost" : run.trail.length === circuitLength ? "clear" : "playing";
}

function mix(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function circuitOffers(run: Circuit) {
  if (circuitStatus(run) !== "playing") return [];
  const last = run.trail.at(-1)?.pattern;
  const stage = run.trail.length;
  const seed = mix(run.seed ^ Math.imul(stage + 1, 0x9e3779b9));
  const available = examples.slice(0, run.poolSize ?? 5).filter(example => example.pattern !== last)
    .map((rules, index) => ({ rules, order: mix(seed ^ (index + 1)) }))
    .sort((a, b) => a.order - b.order);
  return risks.map((risk, slot) => ({
    ...risk, slot, rules: available[slot].rules, seed: mix(seed ^ (slot + 21)),
  }));
}

export function acceptCircuitTable(run: Circuit, slot: number): Circuit {
  if (run.active || !circuitOffers(run)[slot]) throw new Error("選べる卓がありません");
  return { ...run, active: { slot, actions: [] } };
}

export function settleCircuit(run: Circuit, scores: readonly [number, number]): Circuit {
  if (!run.active) throw new Error("進行中の卓がありません");
  const selected = circuitOffers(run)[run.active.slot];
  const result = scores[0] > scores[1] ? "win" : scores[0] < scores[1] ? "loss" : "draw";
  const points = result === "win" ? selected.reward : 0;
  const lives = result === "loss" ? Math.min(run.lives, selected.stake) : 0;
  return { ...run, lives: run.lives - lives, points: run.points + points, active: null,
    trail: [...run.trail, { pattern: selected.rules.pattern, result, points, lives }] };
}

export function healCircuit(run: Circuit): Circuit {
  if (run.active || circuitStatus(run) !== "playing" || run.lives >= maxLives || run.points < healCost) return run;
  return { ...run, lives: run.lives + 1, points: run.points - healCost };
}

export function readCircuit(source: string | null): Circuit | null {
  if (!source) return null;
  try {
    const value = JSON.parse(source) as Circuit;
    if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff ||
        (value.poolSize !== undefined && (!Number.isInteger(value.poolSize) || value.poolSize < 5 || value.poolSize > examples.length)) ||
        !Number.isInteger(value.lives) || value.lives < 0 || value.lives > maxLives ||
        !Number.isInteger(value.points) || value.points < 0 || !Array.isArray(value.trail) || value.trail.length > circuitLength ||
        !value.trail.every(entry => examples.some(example => example.pattern === entry?.pattern) &&
          ["win", "loss", "draw"].includes(entry.result) && Number.isInteger(entry.points) && Number.isInteger(entry.lives))) return null;
    if (value.active !== null) {
      if (!value.active || !Number.isInteger(value.active.slot) || !circuitOffers(value)[value.active.slot] || !Array.isArray(value.active.actions) ||
          !value.active.actions.every(action => action && allMoves.includes(action.move) &&
            ["human", "cpu", "jev", "llm"].includes(action.controller))) return null;
    }
    return value;
  } catch {
    return null;
  }
}
