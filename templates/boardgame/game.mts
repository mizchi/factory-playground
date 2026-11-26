import { applyIsland, charter, islandDescription, islandFacilities, islandMoves, islandOptions, nextIslandRound,
  shipping, startIslands, type IslandMove, type IslandState } from "./islands.mts";

import { charge, resonanceOptions, resonancePreviews, resonanceRounds, resonanceRules, startResonance, surgeMoves,
  type Resonance } from "./resonance.mts";

export const patterns = ["claim", "duel", "invest", "auction", "mine", "islands", "resonance"] as const;
export type Pattern = typeof patterns[number];
export type Seat = 0 | 1;
export const moves = ["a", "b", "c"] as const;
export const allMoves = [...moves, ...islandMoves, ...surgeMoves] as const;
export type Move = typeof allMoves[number];
export function moveIndex(move: Move) {
  return moves.findIndex(id => id === move);
}
type Triple<T> = [T, T, T];
type Pair<T> = [T, T];

export type Rules = {
  pattern: Pattern;
  title: string;
  premise: string;
  hypothesis: string;
  labels: Triple<string>;
  values: Triple<number>;
  rounds: number;
  bonus: number;
  variation: 0 | 1;
};

export const patternInfo = {
  claim: {
    label: "共有枠の先取り",
    hypothesis: "目先の得点を譲ってでも、相手に価値の高い枠を先に取る。",
    parameters: "values は3枠の基本点（1〜4）。1点差を含める。bonus は秘密の得意枠を取った時の加点（1〜2）。rounds は2〜10（推奨8）。6以上では見送った枠に毎回1点、最大2点がたまる。相手の得点差と自分の損失を比べられるようにする。",
  },
  duel: {
    label: "伏せた手の同時公開",
    hypothesis: "相手が残した手に応じて、自分の出す手を切り替える。",
    parameters: "values は3手それぞれの勝利点（1〜4）。a は b に、b は c に、c は a に勝つ。bonus は0。rounds は2〜6（推奨6）。3までは各手1枚、4以上では各手2枚。",
  },
  invest: {
    label: "投資と得点の競争",
    hypothesis: "先に払った投資で収入を増やし、得点枠が空くうちに換金する。",
    parameters: "labels は投資、資金獲得、換金の順。values は投資費（1〜2）、資金獲得量（1〜3）、換金費（4〜6）。bonus は秘密の得意な時期で換金した時の加点（1〜2）。rounds は3〜8（推奨8）。投資が資金獲得より有利になる余地を残すため、6ラウンド以上・資金獲得量1〜2を検討する。",
  },
  auction: {
    label: "封印入札",
    hypothesis: "安い品を見送って資金を残し、大きな品で相手を上回る。",
    parameters: "labels は見送り、小口、大口。values は初期資金（6〜12）、小口入札額（1〜2）、大口入札額（3〜4）。bonus は大きな品の得点（4〜6）。各回の品は2点、bonus-1点、bonus点の順で循環。入札は同時公開で双方支払い、同額は得点なし。次の回に資金1を補充。rounds は6〜9。variation は0。",
  },
  mine: {
    label: "採掘と撤退",
    hypothesis: "相手も掘りそうなとき、落盤の前に手元の鉱石を持ち帰る。",
    parameters: "labels は浅掘り、深掘り、帰還。values は浅掘りの鉱石（1〜2）、深掘りの鉱石（3〜4）、落盤する負荷（4〜7）。浅掘りは負荷+1、深掘りは+2。帰還は落盤判定より前に手持ち鉱石を得点にする。両者帰還または落盤で負荷を0にする。終了時の未回収鉱石は0点。rounds は6〜9、bonus と variation は0。",
  },
  islands: {
    label: "群島の産業と交易",
    hypothesis: "早めに造船所を建て、共有の外洋便を高い得点のラウンドで取る。",
    parameters: "タイトルと世界観を作る。labelsは必須の3項目だがこの形式の行動名は固定。valuesは採取量（2〜3）、近海便の得点（3〜4）、外洋便の得点（5〜7）。bonusは秘密の委託達成点（3〜5）。rounds は8、variation は0。",
  },
  resonance: {
    label: "送電と連鎖",
    hypothesis: "共有回路を読み、増幅を使って2基の塔を同じ手で放電させる。",
    parameters: "labels は3つの入口の名前。values は3基の得点塔の点（3〜6）。bonus は同じ手で2基放電する追加点（1〜3）。rounds は8〜10。variation は公開初期盤面を回転させる0か1。",
  },
} as const;

export function turnLimit(rules: Rules) {
  return rules.rounds * (rules.pattern === "islands" ? 4 : 2);
}

export function parseRules(source: unknown): Rules {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("ルールはJSONオブジェクトで指定してください");
  const data = source as Record<string, unknown>;
  const pattern = patterns.find(pattern => pattern === data.pattern);
  if (!pattern) throw new Error("未知のゲーム形式です");
  function line(value: unknown, field: string, max: number) {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} は1〜${max}文字で指定してください`);
    return value.trim();
  }
  function number(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
      throw new Error(`${field} は${min}〜${max}の整数で指定してください`);
    return value;
  }
  if (!Array.isArray(data.labels) || data.labels.length !== 3 || !Array.isArray(data.values) || data.values.length !== 3)
    throw new Error("labels と values は3項目ずつ指定してください");
  const labels = data.labels.map(value => line(value, "labels", 30)) as Triple<string>;
  if (new Set(labels).size !== 3) throw new Error("手の名前を3種類用意してください");
  const bounds = {
    claim: { values: [[1, 4], [1, 4], [1, 4]], rounds: [2, 10], bonus: [1, 2], variation: 1 },
    duel: { values: [[1, 4], [1, 4], [1, 4]], rounds: [2, 6], bonus: [0, 0], variation: 1 },
    invest: { values: [[1, 2], [1, 3], [4, 6]], rounds: [3, 8], bonus: [1, 2], variation: 1 },
    auction: { values: [[6, 12], [1, 2], [3, 4]], rounds: [6, 9], bonus: [4, 6], variation: 0 },
    mine: { values: [[1, 2], [3, 4], [4, 7]], rounds: [6, 9], bonus: [0, 0], variation: 0 },
    resonance: { values: [[3, 6], [3, 6], [3, 6]], rounds: [8, 10], bonus: [1, 3], variation: 1 },
    islands: { values: [[2, 3], [3, 4], [5, 7]], rounds: [8, 8], bonus: [3, 5], variation: 0 },
  }[pattern];
  const ranges = bounds.values;
  const values = data.values.map((value, index) => number(value, "values", ranges[index][0], ranges[index][1])) as Triple<number>;
  return {
    pattern, labels, values,
    title: line(data.title, "title", 60),
    premise: line(data.premise, "premise", 220),
    hypothesis: line(data.hypothesis, "hypothesis", 220),
    rounds: number(data.rounds, "rounds", bounds.rounds[0], bounds.rounds[1]),
    bonus: number(data.bonus, "bonus", bounds.bonus[0], bounds.bonus[1]),
    variation: number(data.variation, "variation", 0, bounds.variation) as 0 | 1,
  };
}

export type Option = { id: Move; label: string; detail: string };
type Player = { points: number; funds: number; level: number; netInvest: number; cargo: number; used: Move[] };
export type PublicEvent = { round: number; text: string };
export type State = {
  round: number;
  first: Seat;
  turn: Seat;
  phase: 0 | 1;
  players: Pair<Player>;
  secrets: Pair<number>;
  featured: number[];
  carry: Triple<number>;
  pressure: number;
  reveal: Pair<Move> | null;
  island: IslandState | null;
  resonance: Resonance | null;
  pending: Move | null;
  history: PublicEvent[];
};
export type View = {
  title: string;
  pattern: Pattern;
  rules: string[];
  round: number;
  rounds: number;
  seat: Seat;
  turn: Seat;
  first: Seat;
  scores: Pair<number>;
  board: string[];
  secret: string | null;
  options: Option[];
  history: PublicEvent[];
  done: boolean;
};
export type Cue = { kind: Pattern; text: string };
export type TableView = { schedule: string[] } & (
  | { kind: "claim"; cards: { id: Move; label: string; points: number; carry: number; favored: boolean; owner: Seat | null }[] }
  | { kind: "duel"; committed: { seat: Seat; card: Move | null } | null; lastReveal: Pair<Move> | null; remaining: Pair<Triple<number>> }
  | { kind: "invest"; players: Pair<{ funds: number; equipment: number }>; owner: Seat | null; cost: number; points: number }
  | { kind: "auction"; committed: Seat | null; bids: Triple<number>; funds: Pair<number>; lots: number[]; lastReveal: Pair<Move> | null }
  | { kind: "resonance"; network: Resonance; previews: ReturnType<typeof resonancePreviews> }
  | { kind: "islands"; ports: IslandState["ports"]; step: number;
    ownCharter: ReturnType<typeof charter>; facilities: ReturnType<typeof islandFacilities>;
    shipping: ReturnType<typeof shipping>[] }
  | { kind: "mine"; committed: Seat | null; pressure: number; limit: number; cargo: Pair<number>; lastReveal: Pair<Move> | null });

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function random(seed: number, salt: number) {
  let word = Math.imul((seed >>> 0) ^ salt, 0x9e3779b1);
  word = Math.imul(word ^ (word >>> 16), 0x85ebca6b);
  return (word ^ (word >>> 13)) >>> 0;
}

export function start(rules: Rules, seed: number, first: Seat = 0, rivalLead = 0): State {
  const player = (points: number): Player => ({ points, funds: rules.pattern === "auction" ? rules.values[0] : 2, level: 0, netInvest: 0, cargo: 0, used: [] });
  const count = rules.pattern === "claim" ? 3 : 2;
  const secret1 = random(seed, 0xb123) % count;
  const draw = random(seed, 0xc569);
  const secret2 = rules.pattern === "claim" ? (secret1 + 1 + draw % 2) % 3 : draw % count;
  return {
    round: 1, first, turn: first, phase: 0, players: [player(0), player(rivalLead)],
    secrets: [secret1, secret2],
    featured: Array.from({ length: rules.rounds }, (_, index) => rules.variation ? random(seed, 0xd3c7 + index) % 3 : -1),
    carry: [0, 0, 0], pressure: 0, reveal: null, island: rules.pattern === "islands" ? startIslands() : null, resonance: rules.pattern === "resonance" ? startResonance(rules, seed) : null, pending: null, history: [],
  };
}

export function description(rules: Rules): string[] {
  if (rules.pattern === "islands") return islandDescription(rules);
  if (rules.pattern === "resonance") return resonanceRules(rules);
  const labels = rules.labels.join("・");
  const endings = `全${rules.rounds}ラウンド。毎ラウンド先手交代。終了時の得点が高い方の勝ち。`;
  const variable = rules.variation
    ? [rules.pattern === "invest" ? "開始時に公開された注目ラウンドの換金は＋1点。"
      : "各ラウンドの注目枠・注目手は開始時に公開され、得点時に＋1点。"]
    : [];
  if (rules.pattern === "claim") return [
    endings, `${labels}から順に一つずつ取る。取られた枠は次ラウンドまで使えない。`,
    `基本点は順に${rules.values.join("・")}点。自分の得意枠では毎回+${rules.bonus}点。両者の得意枠は異なる。`,
    ...(rules.rounds >= 6 ? ["誰も取らなかった枠は次に＋1点（最大＋2点）。取ると持越しを受け取り、次は基本点に戻る。"] : []), ...variable,
  ];
  if (rules.pattern === "duel") return [
    endings, `各自は一手を伏せ、双方が決めた後に公開する。各手は1試合に${duelCopies(rules)}回まで出せる。`,
    `${rules.labels[0]} → ${rules.labels[1]} → ${rules.labels[2]} → ${rules.labels[0]} の順に直後の手に勝つ。`,
    `勝利点は順に${rules.values.join("・")}点。同じ手なら双方0点。`, ...variable,
  ];
  if (rules.pattern === "auction") return [
    endings, `各自の初期資金は${rules.values[0]}。次のラウンド開始時に資金＋1。締切まで相手の入札額は伏せる。`,
    `入札額は0・${rules.values[1]}・${rules.values[2]}。双方が入札額を支払い、高い方が品の得点を得る。同額なら双方0点。`,
    `品の得点は2・${rules.bonus - 1}・${rules.bonus}の順で繰り返す。`,
  ];
  if (rules.pattern === "mine") return [
    endings, `浅掘りは鉱石＋${rules.values[0]}、負荷＋1。深掘りは鉱石＋${rules.values[1]}、負荷＋2。`,
    `同時に公開し、帰還を先に処理して鉱石を得点に変える。負荷${rules.values[2]}以上で落盤し、持ち帰っていない鉱石を失う。`,
    "両者の帰還か落盤で負荷が0に戻る。最終ラウンド終了時の持ち帰っていない鉱石は0点。",
  ];
  const [cost, gain, cash] = rules.values;
  return [
    endings, "初期資金2。第2ラウンド以降、開始時に各自が資金1＋設備の数を受け取る。",
    `${rules.labels[0]}は資金${cost}を払い設備+1（最大2）。${rules.labels[1]}は資金+${gain}。`,
    `${rules.labels[2]}は資金${cash}を払い3点。各ラウンド先着1人。自分だけの得意な時期なら+${rules.bonus}点。`, ...variable,
  ];
}

const indexOf = moveIndex;
const auctionBid = (rules: Rules, id: Move) => id === "a" ? 0 : rules.values[indexOf(id)];
const lotPoints = (rules: Rules, round: number) => [2, rules.bonus - 1, rules.bonus][(round - 1) % 3];
const duelCopies = (rules: Rules) => rules.rounds > 3 ? 2 : 1;
const copiesLeft = (rules: Rules, player: Player, id: Move) =>
  duelCopies(rules) - player.used.filter(move => move === id).length;
const publicClaimPoints = (rules: Rules, state: State, move: Move) =>
  rules.values[indexOf(move)] + state.carry[indexOf(move)] + highlight(state, move);
const highlight = (state: State, move: Move) => Number(state.featured[state.round - 1] === indexOf(move));
const claimPoints = (rules: Rules, state: State, seat: Seat, move: Move) =>
  publicClaimPoints(rules, state, move) + (state.secrets[seat] === indexOf(move) ? rules.bonus : 0);
const cashPoints = (rules: Rules, state: State, seat: Seat) =>
  3 + highlight(state, "c") + (state.secrets[seat] === Number(state.round > Math.ceil(rules.rounds / 2)) ? rules.bonus : 0);
const featuredSchedule = (rules: Rules, state: State) => rules.variation
  ? state.featured.map(index => rules.pattern === "invest" && index !== 2 ? "加点なし" : rules.labels[index])
  : [];

export function observeTable(rules: Rules, state: State, seat: Seat): TableView {
  const schedule = state.resonance ? [] : featuredSchedule(rules, state);
  if (state.resonance) return { kind: "resonance", schedule, network: structuredClone(state.resonance),
    previews: resonancePreviews(rules, state.resonance, seat) };
  if (state.island) return {
    kind: "islands", schedule, step: state.island.step,
    ports: state.island.ports.map(port => ({ ...port })) as IslandState["ports"],
    ownCharter: charter(state.island.ports[seat], state.secrets[seat]),
    facilities: islandFacilities(rules, state.island, seat, state.round),
    shipping: Array.from({ length: rules.rounds }, (_, index) => shipping(rules, index + 1)),
  };
  if (rules.pattern === "claim") return {
    kind: "claim", schedule,
    cards: moves.map((id, index) => ({ id, label: rules.labels[index],
      points: claimPoints(rules, state, seat, id), carry: state.carry[index], favored: state.secrets[seat] === index,
      owner: state.pending === id ? state.first : null,
    })),
  };
  if (rules.pattern === "duel") {
    const remaining = (owner: Seat): Triple<number> => moves.map(id => copiesLeft(rules, state.players[owner], id)) as Triple<number>;
    const [mine, theirs] = [state.players[0].used.at(-1), state.players[1].used.at(-1)];
    return {
      kind: "duel", schedule, remaining: [remaining(0), remaining(1)],
      committed: state.pending ? { seat: state.first, card: state.first === seat ? state.pending : null } : null,
      lastReveal: mine && theirs ? [mine, theirs] : null,
    };
  }
  if (rules.pattern === "auction") return {
    kind: "auction", schedule, committed: state.pending === null ? null : state.first,
    bids: [0, rules.values[1], rules.values[2]], funds: [state.players[0].funds, state.players[1].funds],
    lots: Array.from({ length: rules.rounds }, (_, index) => lotPoints(rules, index + 1)),
    lastReveal: state.reveal ? [...state.reveal] : null,
  };
  if (rules.pattern === "mine") return {
    kind: "mine", schedule, committed: state.pending === null ? null : state.first,
    pressure: state.pressure, limit: rules.values[2], cargo: [state.players[0].cargo, state.players[1].cargo],
    lastReveal: state.reveal ? [...state.reveal] : null,
  };
  return {
    kind: "invest", schedule,
    players: [{ funds: state.players[0].funds, equipment: state.players[0].level },
      { funds: state.players[1].funds, equipment: state.players[1].level }],
    owner: state.pending === "c" ? state.first : null, cost: rules.values[2], points: cashPoints(rules, state, seat),
  };
}

function options(rules: Rules, state: State, seat: Seat): Option[] {
  if (state.resonance) return resonanceOptions(rules, state.resonance, seat);
  if (state.island) return islandOptions(rules, state.island, seat, state.round);
  const player = state.players[seat];
  const [cost, gain, cash] = rules.values;
  return moves.flatMap((id, index) => {
    const label = rules.labels[index];
    if (rules.pattern === "claim") {
      if (id === state.pending) return [];
      return [{ id, label, detail: `${claimPoints(rules, state, seat, id)}点を得る` }];
    }
    if (rules.pattern === "duel") {
      if (!copiesLeft(rules, player, id)) return [];
      return [{ id, label, detail: `${rules.labels[(index + 1) % 3]}に勝つ・勝利時${rules.values[index] + highlight(state, id)}点` }];
    }
    if (rules.pattern === "auction") {
      const amount = auctionBid(rules, id);
      return amount > player.funds ? [] : [{ id, label, detail: `入札 ${amount} · 競り勝つと${lotPoints(rules, state.round)}点` }];
    }
    if (rules.pattern === "mine") return [{ id, label, detail: id === "c"
      ? `落盤前に${player.cargo}点を確定` : `鉱石＋${rules.values[index]}（未回収） · 負荷＋${index + 1}` }];
    if (id === "a") return player.funds >= cost && player.level < 2
      ? [{ id, label, detail: `資金−${cost}、以後の毎ラウンド収入＋1` }] : [];
    if (id === "b") return [{ id, label, detail: `資金＋${gain}` }];
    return state.pending !== "c" && player.funds >= cash
      ? [{ id, label, detail: `資金−${cash}、${cashPoints(rules, state, seat)}点を得る` }] : [];
  });
}

export function observe(rules: Rules, state: State, seat: Seat): View {
  const done = state.round > rules.rounds;
  const ownCharter = state.island ? charter(state.island.ports[seat], state.secrets[seat]) : null;
  const secret = ownCharter ? `${ownCharter.label} · ${ownCharter.needs}と${ownCharter.route}2回で終局時＋${rules.bonus}点` : rules.pattern === "claim" ? `得意枠は「${rules.labels[state.secrets[seat]]}」`
    : rules.pattern === "invest" ? `得意な時期は${state.secrets[seat] ? "後半" : "前半"}` : null;
  const island = state.island;
  const board = state.resonance ? [
    `入口の充電 ${state.resonance.charges[0].join("・")} / 各3。入口は同じ列と次列（右端は左端）に送電`,
    `中継器の充電 ${state.resonance.charges[1].join("・")} / 各2。各中継器は同じ列の塔に送電`,
    `得点塔の充電 ${state.resonance.charges[2].join("・")} / 各2`,
    `増幅の残り · 席1 ${state.resonance.surges[0]}回、席2 ${state.resonance.surges[1]}回`,
  ] : island ? [
    `今ラウンドの残り手番 ${4 - island.step} / 4`,
    `出荷の得点は近海${shipping(rules, state.round).coast}、外洋${shipping(rules, state.round).ocean}`,
    ...island.ports.map((port, index) => `席${index + 1} · 木材${port.wood} / 石材${port.stone} · 木材工房${port.mill ? "あり" : "なし"}・造船所${port.yard ? "あり" : "なし"} · 近海${port.coast}回・外洋${port.ocean}回`),
    ...islandFacilities(rules, island, seat, state.round).filter(facility => facility.owner !== null)
      .map(facility => `${facility.label}は席${facility.owner! + 1}が使用済み`),
  ] : rules.pattern === "auction" ? [
    `品の得点順: ${Array.from({ length: rules.rounds }, (_, i) => lotPoints(rules, i + 1)).join("、")}`,
    ...state.players.map((player, i) => `席${i + 1} · 資金${player.funds}`),
  ] : rules.pattern === "mine" ? [
    `現在の負荷 ${state.pressure} / ${rules.values[2]}`,
    ...state.players.map((player, i) => `席${i + 1} · 未回収鉱石${player.cargo}`),
  ] : rules.pattern === "invest"
    ? state.players.map((player, i) => `席${i + 1} · 資金${player.funds} / 設備${player.level}`)
    : rules.pattern === "duel" ? state.players.map((player, i) =>
      `席${i + 1} · 残り ${moves.map((move, index) => `${rules.labels[index]} ${copiesLeft(rules, player, move)}枚`).join("・")}`)
      : moves.map((move, index) => `${rules.labels[index]} · 公開${publicClaimPoints(rules, state, move)}点${state.pending === move ? "（取得済み）" : ""}`);
  if (rules.pattern === "invest" && state.pending === "c") board.push("このラウンドの換金枠は取得済み");
  const featured = state.featured[state.round - 1];
  if (!done && ((rules.pattern === "duel" && featured >= 0) || (rules.pattern === "invest" && featured === 2)))
    board.push(`このラウンドの注目 · ${rules.labels[featured]}`);
  if (!done && rules.variation && !state.resonance) {
    board.push(`ラウンドごとの加点 · ${featuredSchedule(rules, state).join(" / ")}`);
  }
  return {
    title: rules.title, pattern: rules.pattern, rules: description(rules),
    round: Math.min(state.round, rules.rounds), rounds: rules.rounds, seat, turn: state.turn, first: state.first,
    scores: [state.players[0].points, state.players[1].points], board, secret,
    options: !done && state.turn === seat ? options(rules, state, seat) : [],
    history: state.history.map(event => ({ ...event })), done,
  };
}

function duelDelta(rules: Rules, state: State, mine: Move, theirs: Move) {
  if (mine === theirs) return 0;
  return (indexOf(mine) + 1) % 3 === indexOf(theirs)
    ? rules.values[indexOf(mine)] + highlight(state, mine)
    : -(rules.values[indexOf(theirs)] + highlight(state, theirs));
}

export function play(rules: Rules, state: State, id: Move): { state: State; cue: Cue | null } {
  const seat = state.turn;
  if (state.round > rules.rounds || !options(rules, state, seat).some(choice => choice.id === id)) throw new Error(`席${seat + 1}の合法手ではありません: ${id}`);
  if (state.island) return playIslands(rules, state, id as IslandMove);
  const next = structuredClone(state);
  const rival = other(seat);
  const player = next.players[seat];
  const label = rules.labels[indexOf(id)];
  const say = (text: string) => next.history.push({ round: next.round, text });
  let cue: Cue | null = null;
  if (state.resonance) {
    const resolved = charge(rules, state.resonance, seat, id as NonNullable<Resonance["last"]>["move"]);
    next.resonance = resolved;
    const { points, towers, lane, amount } = resolved.last;
    player.points += points;
    const route = rules.labels[lane];
    say(`席${seat + 1}が「${route}」へ${amount === 2 ? "増幅" : "送電"}し、得点塔${towers}基に到達。＋${points}点。`);
    if (towers === 2) cue = { kind: "resonance", text: `1手で2基を放電させ、連鎖加点込みで${points}点を獲得した。` };
  } else if (rules.pattern === "claim") {
    const points = claimPoints(rules, state, seat, id);
    player.points += points;
    if (!state.phase) {
      const rivalBest = (blocked: Move) => Math.max(...moves.filter(move => move !== blocked).map(move => claimPoints(rules, state, rival, move)));
      const alternate = moves.find(move => claimPoints(rules, state, seat, move) > points && rivalBest(move) > rivalBest(id));
      if (alternate) cue = { kind: "claim", text: `「${label}」は自分の即時得点を${claimPoints(rules, state, seat, alternate) - points}点譲り、相手の最高得点を${rivalBest(alternate) - rivalBest(id)}点下げた。` };
    }
    say(`席${seat + 1}が「${label}」を取り、${points}点。`);
  } else if (rules.pattern === "duel") {
    if (state.phase && state.pending) {
      const opened = state.pending;
      const delta = duelDelta(rules, state, id, opened);
      player.points += Math.max(delta, 0);
      next.players[rival].points += Math.max(-delta, 0);
      player.used.push(id);
      next.players[rival].used.push(opened);
      for (const [actor, mine, theirs] of [[seat, id, opened], [rival, opened, id]] as const) {
        const counter = other(actor);
        const available = (owner: Seat) => moves.filter(move => copiesLeft(rules, state.players[owner], move) > 0);
        if (state.round > 1 && available(actor).length > 1 && available(counter).some(alternative =>
          Math.sign(duelDelta(rules, state, mine, alternative)) !== Math.sign(duelDelta(rules, state, mine, theirs)))) {
          cue = { kind: "duel", text: `席${actor + 1}の「${rules.labels[indexOf(mine)]}」は、相手が残していた別の手で結果が変わる伏せ手だった。` };
          break;
        }
      }
      say(`席${rival + 1}「${rules.labels[indexOf(opened)]}」と席${seat + 1}「${label}」を公開。${delta ? `席${delta > 0 ? seat + 1 : rival + 1}に${Math.abs(delta)}点。` : "引き分け。"}`);
    }
  } else if (rules.pattern === "auction" || rules.pattern === "mine") {
    if (state.pending !== null) {
      const choices: Pair<Move> = seat === 0 ? [id, state.pending] : [state.pending, id];
      next.reveal = choices;
      cue = rules.pattern === "auction" ? resolveAuction(rules, next, choices, say) : resolveMine(rules, next, choices, say);
    }
  } else {
    const [cost, gain, cash] = rules.values;
    if (id === "a") {
      player.funds -= cost;
      player.netInvest -= cost + gain;
      player.level++;
      say(`席${seat + 1}が「${label}」。資金−${cost}、設備＋1。`);
    } else if (id === "b") {
      player.funds += gain;
      say(`席${seat + 1}が「${label}」。資金＋${gain}。`);
    } else {
      if (player.funds - player.netInvest < cash)
        cue = { kind: "invest", text: `席${seat + 1}の資金は${player.funds}。投資した手を資金獲得に置き換えると${player.funds - player.netInvest}になり、換金に必要な${cash}に届かない。` };
      player.funds -= cash;
      const points = cashPoints(rules, state, seat);
      player.points += points;
      say(`席${seat + 1}が「${label}」。資金−${cash}、${points}点。`);
    }
  }

  if (!state.phase) {
    next.phase = 1;
    next.turn = rival;
    next.pending = id;
  } else {
    next.round++;
    next.phase = 0;
    next.turn = next.first = other(state.first);
    next.pending = null;
    if (rules.pattern === "claim" && rules.rounds >= 6 && next.round <= rules.rounds) {
      moves.forEach((move, index) => {
        next.carry[index] = move === id || move === state.pending ? 0 : Math.min(2, state.carry[index] + 1);
      });
    }
    if (rules.pattern === "auction" && next.round <= rules.rounds) {
      for (const owner of next.players) owner.funds++;
    }
    if (next.resonance && resonanceRounds.includes(next.round)) {
      next.resonance.charges[1] = [1, 1, 1];
      next.resonance.charges[2] = [1, 1, 1];
      next.history.push({ round: next.round, text: "共鳴ラウンド。中継器と塔すべてに予備充電。" });
    }
    if (rules.pattern === "invest" && next.round <= rules.rounds) {
      for (const owner of next.players) {
        owner.funds += 1 + owner.level;
        owner.netInvest += owner.level;
      }
    }
  }
  return { state: next, cue };
}

function playIslands(rules: Rules, state: State, move: IslandMove): { state: State; cue: Cue | null } {
  const next = structuredClone(state);
  const island = next.island!;
  const seat = state.turn;
  const { label, points } = applyIsland(rules, island, seat, state.round, move);
  next.players[seat].points += points;
  next.history.push({ round: state.round, text: `席${seat + 1}が「${label}」を利用${points ? `し、${points}点` : ""}。` });
  next.turn = other(seat);
  if (island.step === 4) {
    next.round++;
    next.turn = next.first = other(state.first);
    if (next.round <= rules.rounds) {
      nextIslandRound(island);
    } else {
      for (const [owner, port] of island.ports.entries()) {
        const goal = charter(port, state.secrets[owner]);
        if (goal.building && goal.shipments >= 2) {
          next.players[owner].points += rules.bonus;
          next.history.push({ round: state.round, text: `席${owner + 1}が委託「${goal.label}」を達成し、${rules.bonus}点。` });
        }
      }
    }
  }
  const cue = move === "ocean" ? {
    kind: "islands" as const, text: `席${seat + 1}は建てた造船所で外洋便を解禁し、資材を使って${points}点を得た。`,
  } : null;
  return { state: next, cue };
}

function resolveAuction(rules: Rules, next: State, choices: Pair<Move>, say: (text: string) => void): Cue | null {
  const first = auctionBid(rules, choices[0]);
  const second = auctionBid(rules, choices[1]);
  next.players[0].funds -= first;
  next.players[1].funds -= second;
  say(`公開入札 · 席1は${first}、席2は${second}を支払う。`);
  if (first === second) {
    say("同額で品は流れた。");
    return null;
  }
  const winner = first > second ? 0 : 1;
  const points = lotPoints(rules, next.round);
  next.players[winner].points += points;
  say(`席${winner + 1}が品を落札し、${points}点。`);
  return choices[winner] === "c" && choices[other(winner)] === "b"
    ? { kind: "auction", text: `席${winner + 1}は小口なら同額で流れる品を、大口で${points}点にした。` } : null;
}

function resolveMine(rules: Rules, next: State, choices: Pair<Move>, say: (text: string) => void): Cue | null {
  const [shallow, deep, limit] = rules.values;
  const banked: Pair<number> = [0, 0];
  for (const seat of [0, 1] as const) {
    const player = next.players[seat];
    const move = choices[seat];
    if (move === "c") {
      banked[seat] = player.cargo;
      player.points += player.cargo;
      player.cargo = 0;
      say(`席${seat + 1}が帰還し、鉱石${banked[seat]}を得点にした。`);
    } else {
      const found = move === "a" ? shallow : deep;
      player.cargo += found;
      next.pressure += move === "a" ? 1 : 2;
      say(`席${seat + 1}「${rules.labels[indexOf(move)]}」で鉱石＋${found}、負荷＋${move === "a" ? 1 : 2}。`);
    }
  }
  if (choices.every(move => move === "c")) {
    next.pressure = 0;
    say("両者が帰還し、負荷が0に戻った。");
  }
  if (next.pressure < limit) return null;
  const losses = next.players.map(player => player.cargo);
  for (const player of next.players) player.cargo = 0;
  next.pressure = 0;
  say(`落盤。未回収鉱石を席1は${losses[0]}、席2は${losses[1]}失った。負荷は0に戻った。`);
  return banked.some((amount, seat) => amount > 0 && losses[1 - seat] > 0)
    ? { kind: "mine", text: "持ち帰った鉱石は得点になり、掘り続けた側の未回収鉱石は落盤で失われた。" } : null;
}

export function quickMove(view: View): Move {
  const options = [...view.options];
  if (!options.length) throw new Error("この席に選べる手がありません");
  if (view.pattern === "invest") {
    return (options.find(option => option.id === "c") ??
      options.find(option => option.id === "a" && view.round < view.rounds - 1) ??
      options.find(option => option.id === "b")!).id;
  }
  if (view.pattern === "islands") {
    const opening = view.round < 4 ? ["yard", "mill"] : [];
    const priorities = [...opening, "ocean", "coast"];
    return (priorities.find(id => options.some(option => option.id === id)) ?? "supply") as Move;
  }
  if (view.pattern === "resonance" || view.pattern === "claim") return options.sort((a, b) => parseInt(b.detail) - parseInt(a.detail))[0].id;
  return options[(view.round + view.seat) % options.length].id;
}
