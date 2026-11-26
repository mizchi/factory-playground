import { moveIndex, type Move, type Rules, type TableView, type View } from "../game.mts";
import { element } from "./dom.mts";

export const decisionTitles = {
  claim: "点を稼ぐか、相手の先を取るか",
  duel: "勝てる札を今切るか、次に残すか",
  invest: "今日の売り場か、明日からの収入か",
  auction: "今回の品を取るか、次の目玉に資金を残すか",
  mine: "もう一掘りするか、落盤の前に戻るか",
  islands: "潮に合わせて出荷するか、次のために設備を建てるか",
  resonance: "狙うのは一基の放電か、二基の連鎖か",
};

export function decisionText(rules: Rules, view: View, table: TableView) {
  if (table.kind === "claim") {
    const raised = table.cards.filter(card => card.carry && card.owner === null)
      .map(card => `${card.label} ＋${card.carry}点`).join("、");
    if (view.first !== 0) {
      return `今ラウンドは相手が先手。${raised ? `持越しは${raised}。` : ""}空いた枠から選び、次の先手で何を取りたいか考えよう。`;
    }
    return `先手のあなたが取ると、その枠は相手に残らない。${raised ? `取り合いが変わった枠は${raised}。` :
      rules.rounds >= 6 ? "見送った枠は次に＋1点。いつ取りに行くかで価値が変わる。" : "得意枠で稼ぐか、相手が前に取った枠を先に閉じるか。"}`;
  }
  if (table.kind === "duel") {
    const exhausted = rules.labels.filter((_, index) => !table.remaining[1][index]).join("、");
    return exhausted ? `相手は「${exhausted}」を使い切った。残り札と相性を比べて次を選ぼう。` :
      "相手が出せる札は盤面の残り枚数で分かる。今使った札は減るので、勝ちやすい組み合わせを後に残す手もある。";
  }
  if (table.kind === "auction") {
    const future = table.lots.slice(view.round);
    const next = future.length ? `後の品には最大${Math.max(...future)}点が残る。` : "今回が最後の品。";
    return `相手の資金は${table.funds[1]}。負けても入札額を支払う。${next}`;
  }
  if (table.kind === "mine") {
    const room = table.limit - table.pressure;
    if (view.round === view.rounds) return "最終ラウンド。帰還すれば手持ちが得点になる。未回収の鉱石は0点。";
    return `あと負荷${room}で落盤。相手も掘れば負荷が1〜2増える。いま帰れば手元の${table.cargo[0]}個を確保できる。`;
  }
  if (table.kind === "islands") {
    const opponent = table.ports[1];
    const prize = table.shipping[view.round - 1];
    const openOcean = table.facilities.find(facility => facility.id === "ocean")?.owner === null;
    if (opponent.yard && opponent.wood >= prize.oceanCost.wood && opponent.stone >= prize.oceanCost.stone && openOcean)
      return `相手も外洋便を出せる。今ラウンドの外洋便は${prize.ocean}点で、使えるのは先に取った1人だけ。`;
    if (view.round >= view.rounds - 1) return "残りわずか。資源を出荷に回し、秘密の委託に足りない便を確認しよう。";
    return `近海便は${prize.coast}点、外洋便は${prize.ocean}点。今出すか、設備の生産を増やして先の高得点便を狙うか。`;
  }
  if (table.kind === "resonance") {
    const double = table.previews.find(preview => preview.towers === 2);
    if (double) return `${rules.labels[double.lane]}への${double.amount === 2 ? "増幅" : "送電"}で2基が連鎖し、${double.points}点。増幅を使う価値と、相手に残す充電を比べよう。`;
    return "光の線をたどると次に充電される場所が分かる。得点がない手でも、相手に高得点を渡さない入口を選べる。";
  }
  if (table.owner !== null) return "今の換金枠は確保された。資金を貯めるか、残りの収入を設備で増やすか。";
  const remaining = view.rounds - view.round;
  if (remaining === 0) return "最終ラウンド。設備の次回収入はもう発生しない。空いている換金枠が最後の得点機会。";
  if (view.first === 0 && table.players[1].funds >= table.cost) return "相手も換金できる資金がある。いま換金すれば枠を確保でき、待つと先に取られる可能性がある。";
  return `設備1つで以後の収入が計＋${remaining}。設備に使う手番と、必要な資金をいつ揃えるかを比べよう。`;
}

export function optionHint(rules: Rules, view: View, table: TableView, id: Move) {
  const index = moveIndex(id);
  if (table.kind === "claim") {
    const card = table.cards[index];
    const timing = view.first === 0 ? "相手は今ラウンドこの枠を選べない。" :
      rules.rounds >= 6 && view.round < view.rounds ? "選んだ枠の持越しは次に解消する。" : "";
    return `${card.points}点を獲得。${card.carry ? `持越しの＋${card.carry}点込み。` : ""}${timing}`;
  }
  if (table.kind === "duel") {
    const beat = (index + 1) % 3;
    const lose = (index + 2) % 3;
    const winText = table.remaining[1][beat] ? `「${rules.labels[beat]}」に勝つ` : `勝てる相手札「${rules.labels[beat]}」は残り0枚`;
    return `${winText}。${table.remaining[1][lose] ? `「${rules.labels[lose]}」には負ける。` : ""}出すと自分の残りは${table.remaining[0][index] - 1}枚。`;
  }
  if (table.kind === "auction") {
    const amount = table.bids[index];
    return `資金${amount}を支払い、手元に${table.funds[0] - amount}残る。相手より高ければ${table.lots[view.round - 1]}点。同額は流札。`;
  }
  if (table.kind === "mine") {
    if (id === "c") return `落盤判定の前に${table.cargo[0]}点を確定。両者が戻れば負荷は0。`;
    const pressure = table.pressure + index + 1;
    const risk = pressure >= table.limit ? "この手だけで落盤。" : pressure + 2 >= table.limit ? "相手の掘り方次第で落盤。" : "今回は相手が深掘りしても落盤しない。";
    return `未回収鉱石＋${rules.values[index]}。${risk}`;
  }
  if (table.kind === "islands") {
    const facility = table.facilities.find(facility => facility.id === id);
    if (!facility) return "";
    if (id === "mill" || id === "yard") return `${facility.detail}。生産はあと${view.rounds - view.round}回。`;
    return `${facility.detail}。${id === "supply" ? "" : "今取れば相手は同じラウンドに使えない。"}`;
  }
  if (table.kind === "resonance") {
    const shot = table.previews.find(preview => preview.move === id);
    return shot ? `入口を＋${shot.amount}。得点塔${shot.towers}基で＋${shot.points}点。盤面がこのままなら相手は最大${shot.rival}点。` : "";
  }
  const [cost, gain] = rules.values;
  if (id === "a") {
    return `資金−${cost}。残り${view.rounds - view.round}ラウンドの開始時に、今の設備より毎回＋1。`;
  }
  if (id === "b") return `資金＋${gain}。売り場を取るには資金${table.cost}が必要。`;
  return `資金−${table.cost}で${table.points}点。先に確保すると相手は同じラウンドに換金できない。`;
}

type Delta = { text: string; score?: boolean; lasting?: boolean };
export type Outcome = { round: number; title: string; changes: Delta[]; sealed?: boolean };

export function describeOutcome(rules: Rules, before: View, after: View, oldTable: TableView, newTable: TableView, move: Move): Outcome {
  const actor = before.turn;
  const label = oldTable.kind === "islands"
    ? oldTable.facilities.find(facility => facility.id === move)?.label : rules.labels[moveIndex(move)];
  const owner = actor === 0 ? "あなた" : "対戦相手";
  const round = before.round;
  const changes: Delta[] = [];
  if (newTable.kind === "resonance" && newTable.network.last) {
    const shot = newTable.network.last;
    const relays = shot.pulses.filter(pulse => pulse.to >= 3 && pulse.to < 6 && pulse.burst).length;
    if (relays) changes.push({ text: `中継${relays}基が放電` });
    if (shot.points) changes.push({ text: `${owner} ＋${shot.points}点`, score: true });
    if (shot.towers === 2) changes.push({ text: `二塔連鎖 · 追加＋${rules.bonus}点` });
    if (!shot.points) changes.push({ text: "回路を充電 · 得点なし" });
    return { round, title: shot.towers === 2 ? "二塔連鎖" : `${owner} · ${rules.labels[shot.lane]}に${shot.amount === 2 ? "増幅" : "送電"}`, changes };
  }
  if (oldTable.kind === "islands" && newTable.kind === "islands") {
    const older = oldTable.ports[actor];
    const newer = newTable.ports[actor];
    if (older.wood !== newer.wood) changes.push({ text: `木材 ${older.wood} → ${newer.wood}` });
    if (older.stone !== newer.stone) changes.push({ text: `石材 ${older.stone} → ${newer.stone}` });
    if (move === "mill" || move === "yard") changes.push({ text: move === "yard" ? "外洋便を解禁 · 翌ラウンドから石材＋1" : "翌ラウンドから木材＋1", lasting: true });
    for (const seat of [0, 1] as const) {
      const points = after.scores[seat] - before.scores[seat];
      if (points) changes.push({ text: `${seat === 0 ? "あなた" : "相手"} ＋${points}点`, score: true });
    }
    if (after.done) changes.push({ text: "終局 · 達成した委託の点を加算" });
    else if (after.round > before.round) changes.push({ text: "施設が再開 · 設備が資源を生産" });
    else if (move !== "supply") changes.push({ text: "今ラウンドの施設を確保" });
    return { round, title: `${owner} · ${label}`, changes };
  }
  if (newTable.kind === "auction" || newTable.kind === "mine") {
    if (after.history.length === before.history.length) return {
      round, title: actor === 0 ? `「${label}」を伏せた` : "相手が手を伏せた", changes, sealed: true,
    };
    const revealed = newTable.lastReveal;
    const collapse = newTable.kind === "mine" && newTable.pressure === 0 && revealed?.some(id => id !== "c");
    const title = collapse ? "落盤" : newTable.kind === "mine" ? "採掘結果を公開" : "入札結果を公開";
    if (revealed) {
      for (const seat of [0, 1] as const) {
        const name = seat === 0 ? "あなた" : "相手";
        const index = moveIndex(revealed[seat]);
        const score = after.scores[seat] - before.scores[seat];
        const action = newTable.kind === "auction" ? `入札 ${newTable.bids[index]}` : rules.labels[index];
        changes.push({ text: `${name} ${action}${score ? ` · ＋${score}点` : ""}`, score: score > 0 });
      }
    }
    if (collapse) changes.push({ text: "未回収鉱石を失い、負荷が0に戻った" });
    if (newTable.kind === "auction" && revealed && revealed[0] === revealed[1]) changes.push({ text: "同額 · 得点なし" });
    return { round, title, changes };
  }
  if (oldTable.kind === "duel" && newTable.kind === "duel") {
    if (after.history.length === before.history.length) return {
      round, title: actor === 0 ? `「${label}」を伏せた` : "相手が札を伏せた", changes: [], sealed: true,
    };
    const cards = newTable.lastReveal?.map(id => rules.labels[moveIndex(id)]);
    for (const seat of [0, 1] as const) {
      const gained = after.scores[seat] - before.scores[seat];
      if (gained) changes.push({ text: `${seat === 0 ? "あなた" : "相手"} ＋${gained}点`, score: true });
    }
    if (!changes.length) changes.push({ text: "同じ札 · 双方0点" });
    else if (cards) {
      const winner = after.scores[0] > before.scores[0] ? 0 : 1;
      changes.push({ text: `「${cards[winner]}」が「${cards[1 - winner]}」に勝つ` });
    }
    return { round, title: cards ? `${cards[0]} vs ${cards[1]}` : "札を公開", changes };
  }
  const gained = after.scores[actor] - before.scores[actor];
  if (gained) changes.push({ text: `${owner} ＋${gained}点`, score: true });
  if (newTable.kind === "claim" && oldTable.kind === "claim") {
    const rising = newTable.cards.filter((card, index) => card.carry > oldTable.cards[index].carry);
    if (!after.done && after.round > before.round) {
      changes.push(...rising.map(card => ({ text: `次の「${card.label}」に＋1点` })));
    } else if (!after.done) {
      changes.push({ text: "残り1手 · この枠は締切" });
    }
    return { round, title: `${owner}が「${label}」を確保`, changes };
  }
  if (newTable.kind === "invest" && oldTable.kind === "invest") {
    const newRound = !after.done && after.round > before.round;
    const equipment = newTable.players[actor].equipment - oldTable.players[actor].equipment;
    const income = newRound ? 1 + newTable.players[actor].equipment : 0;
    const funds = newTable.players[actor].funds - oldTable.players[actor].funds - income;
    if (funds) changes.push({ text: `資金 ${funds > 0 ? "＋" : "−"}${Math.abs(funds)}` });
    if (equipment) changes.push({
      text: before.round < before.rounds ? "設備＋1 · 次回から毎回収入＋1" : "設備＋1 · 次の収入なし",
      lasting: true,
    });
    if (move === "c") changes.push({ text: "このラウンドの換金枠を確保" });
    if (newRound) {
      changes.push({ text: `第${after.round}Rの収入 · あなた＋${1 + newTable.players[0].equipment} / 相手＋${1 + newTable.players[1].equipment}` });
    }
  }
  return { round, title: `${owner} · ${label}`, changes };
}

export function renderOutcome(root: HTMLElement, outcome: Outcome | null, recent: Outcome | null = null) {
  root.hidden = !outcome;
  root.replaceChildren();
  if (!outcome) return;
  const body = element("div", "", "outcome-content");
  const title = element("div", "", "outcome-title");
  title.append(element("span", `R${outcome.round}`, "outcome-round"), element("strong", outcome.title));
  body.append(title);
  if (outcome.changes.length) {
    const changes = element("ul", "", "outcome-changes");
    changes.append(...outcome.changes.map(change => element("li", change.text, change.score ? "scored" : "")));
    body.append(changes);
  }
  root.append(body);
  if (recent) {
    const effects = recent.changes.filter(change => change.score || change.lasting);
    if (effects.length) root.append(element("div", `R${recent.round} ${recent.title} · ${effects.map(change => change.text).join("、")}`, "recent-own"));
  }
}
