import type { Option, Rules, Seat } from "./game.mts";

export const surgeMoves = ["surge-a", "surge-b", "surge-c"] as const;
const shots = ["a", "b", "c", ...surgeMoves] as const;
type Shot = typeof shots[number];
type Lane = 0 | 1 | 2;
type Row = [number, number, number];
const lanes = [0, 1, 2] as const;
export const thresholds = [3, 2, 2] as const;
export const resonanceRounds = [2, 3, 6, 7];
export type Pulse = { from: number | null; to: number; before: number; after: number; burst: boolean };
export type Discharge = { pulses: Pulse[]; points: number; towers: number; seat: Seat; move: Shot; lane: Lane; amount: number };
export type Resonance = { charges: [Row, Row, Row]; surges: [number, number]; last: Discharge | null };

export function startResonance(rules: Rules, seed: number): Resonance {
  const rotate = (row: Row): Row => {
    const offset = rules.variation ? seed % 3 : 0;
    return [row[offset], row[(offset + 1) % 3], row[(offset + 2) % 3]];
  };
  return { charges: [rotate([2, 1, 0]), rotate([1, 1, 0]), rotate([0, 0, 1])], surges: [2, 2], last: null };
}

const followers = (lane: Lane): [Lane, Lane] => [lane, lanes[(lane + 1) % lanes.length]];

export const wires = lanes.flatMap(lane => [
  ...followers(lane).map(next => ({ from: lane, to: 3 + next })),
  { from: 3 + lane, to: 6 + lane },
]);

export function charge(rules: Rules, state: Resonance, seat: Seat, move: Shot): Resonance & { last: Discharge } {
  const index = shots.indexOf(move);
  const lane = lanes[index % lanes.length];
  const surges: [number, number] = [...state.surges];
  if (index >= 3) {
    if (!surges[seat]) throw new Error("増幅を使い切りました");
    surges[seat]--;
  }
  const charges: Resonance["charges"] = [[...state.charges[0]], [...state.charges[1]], [...state.charges[2]]];
  const pulses: Pulse[] = [];
  const send = (row: Lane, target: Lane, amount: number, from: number | null) => {
    const before = charges[row][target];
    const total = before + amount;
    const burst = total >= thresholds[row];
    const after = burst ? total - thresholds[row] : total;
    charges[row][target] = after;
    pulses.push({ from, to: row * 3 + target, before, after, burst });
    return burst;
  };
  const amount = index >= 3 ? 2 : 1;
  const gateBursts = send(0, lane, amount, null);
  const relays = gateBursts ? followers(lane).filter(next => send(1, next, 1, lane)) : [];
  const towers = relays.filter(relay => send(2, relay, 1, 3 + relay));
  const points = towers.reduce<number>((sum, tower) => sum + rules.values[tower], 0) + (towers.length === 2 ? rules.bonus : 0);
  return { charges, surges, last: { pulses, points, towers: towers.length, seat, move, lane, amount } };
}

export function resonancePreviews(rules: Rules, state: Resonance, seat: Seat) {
  const opponent: Seat = seat === 0 ? 1 : 0;
  return shots.flatMap((move, index) => {
    if (index >= 3 && !state.surges[seat]) return [];
    const next = charge(rules, state, seat, move);
    const rival = Math.max(...shots
      .filter((_, index) => index < 3 || next.surges[opponent] > 0)
      .map(id => charge(rules, next, opponent, id).last.points));
    return [{ rival, ...next.last }];
  });
}

export function resonanceOptions(rules: Rules, state: Resonance, seat: Seat): Option[] {
  return resonancePreviews(rules, state, seat).map(preview => ({
    id: preview.move, label: `${rules.labels[preview.lane]} · ${preview.amount === 2 ? "増幅" : "送電"}`,
    detail: `${preview.points}点 · 得点塔${preview.towers}基 · 相手に残る最大${preview.rival}点`,
  }));
}

export function resonanceRules(rules: Rules) {
  return [
    `全${rules.rounds}ラウンド。各ラウンドに1手ずつ。毎ラウンド先手交代。最終得点が高い方が勝ち。`,
    "入口に通常で＋1、増幅で＋2。増幅は各自2回まで。充電は両者で共有する。",
    "入口は3で放電し、線でつながる二つの中継器に＋1。中継器は2で放電し、直下の得点塔に＋1。",
    `得点塔は2で放電。3基の得点は順に${rules.values.join("・")}点。同じ手で2基放電すると追加＋${rules.bonus}点。放電すると満タン分だけ減り、余りは残る。`,
    `第${resonanceRounds.join("・")}ラウンドの開始時には、中継器と塔をすべて1まで充電する。`,
  ];
}
