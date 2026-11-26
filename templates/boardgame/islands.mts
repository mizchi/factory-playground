import type { Option, Rules, Seat } from "./game.mts";

export const islandMoves = ["forest", "quarry", "mill", "yard", "coast", "ocean", "supply"] as const;
export type IslandMove = typeof islandMoves[number];
type Resources = { wood: number; stone: number };
type Port = Resources & { mill: boolean; yard: boolean; coast: number; ocean: number };
export type IslandState = { step: number; ports: [Port, Port]; occupied: Partial<Record<IslandMove, Seat>> };

export const actionInfo: Record<IslandMove, { label: string; cost?: Resources; kind: "採取" | "建設" | "出荷" }> = {
  forest: { label: "製材所", kind: "採取" },
  quarry: { label: "採石場", kind: "採取" },
  mill: { label: "木材工房", kind: "建設", cost: { wood: 2, stone: 1 } },
  yard: { label: "造船所", kind: "建設", cost: { wood: 1, stone: 2 } },
  coast: { label: "近海便", kind: "出荷", cost: { wood: 1, stone: 1 } },
  ocean: { label: "外洋便", kind: "出荷", cost: { wood: 2, stone: 2 } },
  supply: { label: "補給", kind: "採取" },
};

const stockCap = 6;
export function startIslands(): IslandState {
  const port = (): Port => ({ wood: 2, stone: 1, mill: false, yard: false, coast: 0, ocean: 0 });
  return { step: 0, ports: [port(), port()], occupied: {} };
}

export function shipping(rules: Rules, round: number) {
  return {
    coast: rules.values[1] + Number(round % 4 === 2) * 2,
    ocean: rules.values[2] + Number(round % 4 === 0) * 2,
    coastCost: round === 3 ? { wood: 2, stone: 0 } : round === 7 ? { wood: 0, stone: 2 } : { wood: 1, stone: 1 },
    oceanCost: round === 4 ? { wood: 3, stone: 1 } : round === 8 ? { wood: 1, stone: 3 } : { wood: 2, stone: 2 },
  };
}

function costFor(id: IslandMove, reward: ReturnType<typeof shipping>) {
  if (id === "coast") return reward.coastCost;
  if (id === "ocean") return reward.oceanCost;
  return actionInfo[id].cost;
}

export function resourceCost(cost: Resources) {
  return [cost.wood ? `木材${cost.wood}` : "", cost.stone ? `石材${cost.stone}` : ""].filter(Boolean).join("・");
}

function canPay(port: Port, cost: Resources) {
  return port.wood >= cost.wood && port.stone >= cost.stone;
}

export function islandFacilities(rules: Rules, state: IslandState, seat: Seat, round: number) {
  const port = state.ports[seat];
  const reward = shipping(rules, round);
  const gather = rules.values[0];
  const details: Record<IslandMove, string> = {
    forest: `木材＋${gather}`, quarry: `石材＋${gather}`,
    mill: "木材2・石材1を払い、次のラウンドから毎回木材＋1",
    yard: "木材1・石材2を払い、外洋便を解禁。次のラウンドから毎回石材＋1",
    coast: `${resourceCost(reward.coastCost)} → ${reward.coast}点`,
    ocean: `造船所が必要 · ${resourceCost(reward.oceanCost)} → ${reward.ocean}点`,
    supply: "木材＋1・石材＋1。何人でも利用可",
  };
  return islandMoves.map(id => {
    const { label, kind } = actionInfo[id];
    const cost = costFor(id, reward);
    const owner = state.occupied[id];
    const reason = owner !== undefined ? `${owner === seat ? "自分" : "相手"}が使用済み` :
      (id === "mill" && port.mill) || (id === "yard" && port.yard) ? "建設済み" :
      id === "ocean" && !port.yard ? "造船所が必要" : cost && !canPay(port, cost) ? "資源不足" : null;
    return { id, label, kind, detail: details[id], owner: owner ?? null, reason };
  });
}

export function islandOptions(rules: Rules, state: IslandState, seat: Seat, round: number): Option[] {
  return islandFacilities(rules, state, seat, round).filter(facility => !facility.reason)
    .map(({ id, label, detail }) => ({ id, label, detail }));
}

export function charter(port: Port, secret: number) {
  return secret === 0 ? { label: "沿岸組合", building: port.mill, shipments: port.coast, route: "近海便", needs: "木材工房" } :
    { label: "外洋船団", building: port.yard, shipments: port.ocean, route: "外洋便", needs: "造船所" };
}

export function islandDescription(rules: Rules): string[] {
  return [
    `全${rules.rounds}ラウンド、1人2手ずつ交互に行動。毎ラウンド先手交代。施設の利用は補給を除き、2人合わせて各1回。`,
    "各自が木材2・石材1で開始。木材と石材はそれぞれ上限6。設備の生産は翌ラウンド開始から。",
    `製材所・採石場は一度に${rules.values[0]}個。補給では木材と石材を1個ずつ得られる。`,
    `近海便は基礎${rules.values[1]}点、外洋便は基礎${rules.values[2]}点。第2・6ラウンドは近海便に、第4・8ラウンドは外洋便に＋2点。`,
    "近海便は第3ラウンドに木材2、第7ラウンドに石材2。外洋便は第4ラウンドに木材3・石材1、第8ラウンドに木材1・石材3。ほかは近海便が木材・石材各1、外洋便が各2。",
    `各自に秘密の委託が1つ。指定の設備と出荷2回を揃えると、終局時＋${rules.bonus}点。`,
  ];
}

function stock(port: Port, wood: number, stone: number) {
  port.wood = Math.min(stockCap, port.wood + wood);
  port.stone = Math.min(stockCap, port.stone + stone);
}

export function applyIsland(rules: Rules, state: IslandState, seat: Seat, round: number, id: IslandMove) {
  const port = state.ports[seat];
  const { label } = actionInfo[id];
  const reward = shipping(rules, round);
  const cost = costFor(id, reward);
  if (id !== "supply") state.occupied[id] = seat;
  if (cost) stock(port, -cost.wood, -cost.stone);
  let points = 0;
  if (id === "forest") stock(port, rules.values[0], 0);
  if (id === "quarry") stock(port, 0, rules.values[0]);
  if (id === "supply") stock(port, 1, 1);
  if (id === "mill" || id === "yard") port[id] = true;
  if (id === "coast" || id === "ocean") {
    port[id]++;
    points = reward[id];
  }
  state.step++;
  return { label, points };
}

export function nextIslandRound(state: IslandState) {
  state.occupied = {};
  state.step = 0;
  for (const port of state.ports) stock(port, Number(port.mill), Number(port.yard));
}
