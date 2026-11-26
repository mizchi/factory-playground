import { resourceCost } from "../islands.mts";
import { moveIndex, type Move, type Rules, type TableView, type View } from "../game.mts";

import { element } from "./dom.mts";
import { resonanceBoard, type Playback } from "./resonance-board.mts";

const symbols = ["▲", "◆", "●"];
const seatName = (seat: number) => seat === 0 ? "あなた" : "対戦相手";
function ornament(symbol: string, style: string) {
  const icon = element("span", symbol, style);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function action(view: View, id: Move, select: (move: Move) => void, className: string) {
  const option = view.options.find(option => option.id === id);
  const button = element("button", "", className);
  button.type = "button";
  button.disabled = !option;
  if (option) button.onclick = () => select(id);
  return button;
}

function claimCards(table: Extract<TableView, { kind: "claim" }>, view: View, select: (move: Move) => void) {
  const routes = element("div", "", "routes");
  routes.append(...table.cards.map((card, index) => {
    const item = action(view, card.id, select, "route choice");
    const condition = card.owner !== null ? `${seatName(card.owner)}が取得` : card.favored ? "あなたの得意枠" : "";
    item.dataset.route = String(index);
    item.dataset.occupied = String(card.owner !== null);
    if (card.favored) item.classList.add("favored");
    const image = element("div", "", "route-art");
    image.append(ornament(symbols[index], "route-symbol"));
    const points = element("span", `${card.points} 点`, "route-points");
    points.setAttribute("aria-label", `自分が取ると${card.points}点`);
    if (!view.done && card.owner !== 1) image.append(points);
    if (card.carry && card.owner === null && !view.done) image.append(element("span", `持越し ＋${card.carry}`, "route-carry"));
    const info = element("div", "", "route-info");
    info.append(element("strong", card.label), element("span", condition, "route-state"));
    item.append(image, info);
    return item;
  }));
  return routes;
}

function duelMat(rules: Rules, table: Extract<TableView, { kind: "duel" }>) {
  const area = element("div", "", "duel-layout");
  const reveal = element("div", "", "reveal");
  const latest = table.lastReveal;
  reveal.append(element("h2", latest ? "直前に公開した手" : "公開した手", "table-label"));
  const cards = element("div", "", "reveal-cards");
  for (const seat of [0, 1] as const) {
    const duelCard = element("div", "", "duel-card");
    duelCard.append(element("span", seatName(seat), "table-label"));
    const index = latest ? moveIndex(latest[seat]) : -1;
    if (index >= 0) duelCard.append(ornament(symbols[index], "duel-symbol"), element("strong", rules.labels[index]));
    else duelCard.append(element("span", "未公開", "duel-empty"));
    cards.append(duelCard);
  }
  reveal.append(cards);
  area.append(reveal);
  const hands = element("div", "", "hands");
  for (const [seat, remaining] of table.remaining.entries()) {
    const row = element("div", "", "hand");
    row.append(element("div", seatName(seat), "table-label"));
    const chips = element("ul", "", "hand-chips");
    for (const [index, count] of remaining.entries()) {
      const spent = count === 0;
      const chip = element("li", "", spent ? "spent" : "");
      chip.append(ornament(symbols[index], "hand-symbol"), element("span", rules.labels[index]),
        element("span", ` ${count}枚`));
      chips.append(chip);
    }
    row.append(chips);
    hands.append(row);
  }
  if (table.committed) {
    const { card } = table.committed;
    const text = card ? `あなたの伏せ手 · ${rules.labels[moveIndex(card)]}` : "対戦相手は選択済み · 公開待ち";
    const status = element("div", "", "sealed");
    status.append(ornament("◇", "sealed-card"), element("span", text));
    hands.append(status);
  }
  area.append(hands);
  return area;
}

function investMat(rules: Rules, table: Extract<TableView, { kind: "invest" }>, done: boolean) {
  const area = element("div", "", "invest-layout");
  const estates = element("div", "", "estates");
  for (const [seat, data] of table.players.entries()) {
    const estate = element("div", "", "estate");
    estate.append(element("h2", seatName(seat), "table-label"));
    const funds = element("div", "", "funds");
    funds.append(element("span", "資金"), element("strong", String(data.funds)));
    const coins = element("div", "", "coins");
    coins.setAttribute("aria-hidden", "true");
    const visibleCoins = Math.min(data.funds, 12);
    for (let i = 0; i < visibleCoins; i++) coins.append(ornament("", "coin"));
    if (data.funds > visibleCoins) coins.append(element("span", `+${data.funds - visibleCoins}`));
    const equipment = element("div", "", "equipment");
    equipment.append(element("span", `設備 ${data.equipment}/2`));
    for (let i = 0; i < 2; i++) equipment.append(ornament("", i < data.equipment ? "tile built" : "tile"));
    estate.append(funds, coins, equipment, element("div", `毎ラウンド収入 +${data.equipment + 1}`, "income"));
    estates.append(estate);
  }
  area.append(estates);
  const slot = element("div", "", "cash-slot");
  slot.dataset.occupied = String(table.owner !== null);
  const availability = done ? "終了" : table.owner === null ? "空き" : `${seatName(table.owner)}が確保`;
  slot.append(element("strong", `${rules.labels[2]} · ${availability}`));
  if (!done) slot.append(element("span", `資金 ${table.cost} → あなたは ${table.points} 点`));
  area.append(slot);
  return area;
}

function contestMat(table: Extract<TableView, { kind: "auction" | "mine" }>, view: View) {
  const area = element("div", "", "contest-layout");
  const status = element("div", "", "cash-slot contest-status");
  if (table.kind === "auction") {
    const lots = element("ol", "", "lots");
    lots.setAttribute("aria-label", "出品予定");
    for (const [index, points] of table.lots.entries()) {
      const lot = element("li", "", index + 1 < view.round || view.done ? "past-lot" : "");
      if (!view.done && index + 1 === view.round) lot.setAttribute("aria-current", "step");
      lot.append(element("span", `R${index + 1}`), element("strong", `${points}点`));
      lots.append(lot);
    }
    area.append(lots);
    status.append(element("strong", view.done ? "全品の入札終了" : `今回の品 · ${table.lots[view.round - 1]}点`));
  } else {
    const meter = element("meter", "", "pressure-meter");
    meter.value = table.pressure;
    meter.max = table.limit;
    meter.setAttribute("aria-label", "岩盤の負荷");
    status.dataset.danger = String(table.limit - table.pressure <= 2);
    status.append(element("strong", `岩盤の負荷 ${table.pressure} / ${table.limit}`), meter);
  }
  if (table.committed !== null) status.append(element("span", table.committed === 0 ? "あなたは選択済み" : "相手は選択済み · 公開待ち", "sealed"));
  area.append(status);
  const players = element("div", "", "estates");
  const values = table.kind === "auction" ? table.funds : table.cargo;
  for (const [seat, amount] of values.entries()) {
    const player = element("div", "", "estate");
    const funds = element("div", "", "funds");
    funds.append(element("span", table.kind === "auction" ? "資金" : view.done ? "残った鉱石（0点）" : "未回収鉱石"), element("strong", String(amount)));
    player.append(element("h2", seatName(seat), "table-label"), funds);
    const coins = element("div", "", "coins");
    coins.setAttribute("aria-hidden", "true");
    for (let index = 0; index < Math.min(amount, 12); index++) coins.append(ornament("", table.kind === "auction" ? "coin" : "ore"));
    player.append(coins);
    players.append(player);
  }
  area.append(players);
  return area;
}

function islandsMat(table: Extract<TableView, { kind: "islands" }>, view: View, select: (move: Move) => void) {
  const area = element("div", "", "islands-table");
  const ports = element("div", "", "estates");
  for (const [index, port] of table.ports.entries()) {
    const block = element("section", "", "estate");
    block.append(element("h2", `${seatName(index)}の港`, "table-label"));
    const storage = element("div", "", "port-storage");
    for (const [resource, amount, production] of [
      ["木材", port.wood, port.mill], ["石材", port.stone, port.yard],
    ] as const) {
      const line = element("div", "", "port-resource");
      line.append(element("strong", `${resource} ${amount}/6`));
      const meter = element("meter", "");
      meter.max = 6;
      meter.value = amount;
      meter.setAttribute("aria-label", `${seatName(index)}の${resource}`);
      line.append(meter, element("span", production ? "毎回＋1" : "自動生産なし"));
      storage.append(line);
    }
    block.append(storage, element("p", [
      port.mill ? "木材工房あり" : "木材工房なし", port.yard ? "造船所あり" : "造船所なし",
      `近海便 ${port.coast}回`, `外洋便 ${port.ocean}回`,
    ].join(" · "), "port-works"));
    ports.append(block);
  }
  area.append(ports);
  const route = element("section", "", "shipping-board");
  route.append(element("h2", "潮の予定と出荷得点", "table-label"));
  const tides = element("ol", "", "tide-grid");
  for (const [index, reward] of table.shipping.entries()) {
    const cell = element("li", "");
    const label = `第${index + 1}ラウンド · 近海便 ${resourceCost(reward.coastCost)}で${reward.coast}点、外洋便 ${resourceCost(reward.oceanCost)}で${reward.ocean}点`;
    cell.title = label;
    cell.setAttribute("aria-label", label);
    if (view.round === index + 1 && !view.done) cell.setAttribute("aria-current", "step");
    cell.append(element("span", `R${index + 1}`), element("strong", `近 ${reward.coast} · 外 ${reward.ocean}`));
    tides.append(cell);
  }
  route.append(tides);
  const next = table.shipping[view.round];
  if (!view.done && next) route.append(element("p",
    `次の出荷 · 近海 ${resourceCost(next.coastCost)} → ${next.coast}点 ／ 外洋 ${resourceCost(next.oceanCost)} → ${next.ocean}点`, "tide-next"));
  area.append(route);
  const goal = table.ownCharter;
  area.append(element("div",
    `委託の進捗 · ${goal.needs} ${goal.building ? "済" : "未建設"} ／ ${goal.route} ${Math.min(goal.shipments, 2)}/2`, "charter-progress"));
  const facilities = element("div", "", "facility-grid");
  facilities.setAttribute("aria-label", "共有施設");
  for (const facility of table.facilities) {
    const card = action(view, facility.id, select, "choice facility");
    card.dataset.facility = facility.id;
    card.dataset.occupied = String(facility.owner !== null);
    card.append(element("span", facility.kind, "facility-kind"), element("strong", facility.label),
      element("span", facility.detail), element("span", facility.reason ?? "", "facility-status"));
    facilities.append(card);
  }
  area.append(facilities);
  return area;
}

export function renderBoard(root: HTMLElement, options: HTMLElement, rules: Rules, view: View, table: TableView,
  select: (move: Move) => void, playback: Playback | null = null) {
  root.dataset.pattern = table.kind;
  options.replaceChildren();
  if (table.kind === "resonance") {
    root.replaceChildren(resonanceBoard(rules, view, table, select, playback));
    return;
  }
  if (table.kind === "claim") {
    root.replaceChildren(claimCards(table, view, select));
    return;
  }
  if (table.kind === "islands") {
    root.replaceChildren(islandsMat(table, view, select));
    return;
  }
  if (table.kind === "duel") root.replaceChildren(duelMat(rules, table));
  else if (table.kind === "invest") root.replaceChildren(investMat(rules, table, view.done));
  else root.replaceChildren(contestMat(table, view));
  options.replaceChildren(...view.options.map(choice => {
    const button = action(view, choice.id, select, "choice");
    button.append(ornament(symbols[moveIndex(choice.id)], "choice-symbol"),
      element("strong", choice.label), element("span", choice.detail));
    return button;
  }));
}
