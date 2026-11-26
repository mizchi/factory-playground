/// <reference types="vite/client" />
import "./style.css";
import { examples } from "../examples.mts";
import { observe, observeTable, parseRules, patternInfo, play, quickMove, start, turnLimit, type Move, type Rules, type Seat } from "../game.mts";
import { renderBoard } from "./board.mts";
import { element } from "./dom.mts";
import { signalDuration, type Playback } from "./resonance-board.mts";
import { decisionText, decisionTitles, describeOutcome, optionHint, renderOutcome, type Outcome } from "./insights.mts";
import { acceptCircuitTable, circuitLength, circuitOffers, circuitStatus, healCircuit, healCost,
  maxLives, readCircuit, settleCircuit, startCircuit, type CircuitMove } from "./circuit.mts";

const get = (id: string) => document.getElementById(id)!;
const input = get("file") as HTMLInputElement;
const opponent = get("opponent") as HTMLSelectElement;
const notes = get("notes") as HTMLTextAreaElement;
const parameters = new URLSearchParams(location.search);
const requestedOpponent = parameters.get("opponent");
if (requestedOpponent === "jev" || requestedOpponent === "llm") opponent.value = requestedOpponent;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
let rules: Rules = examples.find(example => example.pattern === parameters.get("game")) ?? examples[0];
let seed = newSeed();
let first: Seat = 0;
let rivalLead = 0;
let state = start(rules, seed, first);
let actions: Move[] = [];
let controllers: string[] = [];
let generation = 0;
let pending = false;
let failure = "";
let lastOwn: Outcome | null = null;
let lastReveal: Outcome | null = null;
let playback: Playback | null = null;
const storageKey = "boardgame-circuit-v1";
let mode = parameters.get("mode") === "run" ? "circuit" : "single";
let circuit = startCircuit(newSeed());
try { circuit = readCircuit(localStorage.getItem(storageKey)) ?? circuit; } catch { /* browser storage can be disabled */ }
let showEndTable = false;

function saveCircuit() {
  try { localStorage.setItem(storageKey, JSON.stringify(circuit)); } catch { /* proceed without local saves */ }
}

function renderCircuit() {
  const isCircuit = mode === "circuit";
  const inMatch = Boolean(isCircuit && (circuit.active || showEndTable));
  const picker = isCircuit && !inMatch;
  get("mode-single").setAttribute("aria-pressed", String(!isCircuit));
  get("mode-circuit").setAttribute("aria-pressed", String(isCircuit));
  get("table-heading").hidden = picker;
  get("table-layout").hidden = picker;
  get("catalog").hidden = isCircuit;
  get("single-tools").hidden = isCircuit;
  get("circuit").hidden = !picker;
  get("circuit-match").hidden = !inMatch;
  get("circuit-next-row").hidden = !(inMatch && showEndTable);
  const stage = Math.min(circuitLength, circuit.trail.length + 1);
  const stats = `ライフ ${circuit.lives}/${maxLives} · 巡回点 ${circuit.points}`;
  if (inMatch) {
    const offer = circuit.active ? circuitOffers(circuit)[circuit.active.slot] : null;
    const result = showEndTable ? circuit.trail.at(-1) : null;
    get("circuit-match").textContent = offer
      ? `第${stage}/${circuitLength}卓 · ${offer.label} · ${stats} · 勝利＋${offer.reward}点／敗北ライフ−${offer.stake}`
      : result ? `第${circuit.trail.length}卓終了 · ${result.result === "win" ? `巡回点＋${result.points}` : result.result === "loss" ? `ライフ−${result.lives}` : "引き分け"} · ${stats}` : stats;
    get("circuit-next").textContent = circuitStatus(circuit) === "playing" ? "次の3卓へ" : "巡回結果を見る";
  }
  if (!picker) return false;
  const status = circuitStatus(circuit);
  get("circuit-title").textContent = status === "clear" ? "5卓を踏破" : status === "lost" ? "ライフが尽きた" : `第${stage}卓を選ぶ`;
  get("circuit-stats").textContent = stats;
  get("circuit-summary").textContent = status === "playing"
    ? `3卓から1つ選び、${circuitLength}卓を巡る。引き分けはライフも巡回点もそのまま。`
    : `${circuit.trail.length}卓を完了 · 勝利 ${circuit.trail.filter(result => result.result === "win").length}回。`;
  get("circuit-offers").replaceChildren(...circuitOffers(circuit).map(offer => {
    const card = element("button", "", "circuit-offer");
    card.type = "button";
    card.dataset.risk = String(offer.slot);
    card.append(element("span", offer.label, "circuit-tier"), element("strong", offer.rules.title),
      element("span", `${patternInfo[offer.rules.pattern].label} · ${offer.rules.rounds}ラウンド · 各${turnLimit(offer.rules) / 2}手`, "circuit-kind"),
      element("span", offer.rules.hypothesis, "circuit-pitch"),
      element("span", `相手の先行 ${offer.lead}点`, "circuit-lead"),
      element("span", `勝利 ＋${offer.reward}点 ／ 敗北 ライフ−${offer.stake}`, "circuit-stakes"));
    card.onclick = () => {
      circuit = acceptCircuitTable(circuit, offer.slot);
      saveCircuit();
      openCircuit();
    };
    return card;
  }));
  get("circuit-trail").replaceChildren(...circuit.trail.map(result => {
    const title = examples.find(example => example.pattern === result.pattern)?.title;
    const outcome = result.result === "win" ? `勝利 ＋${result.points}点` :
      result.result === "loss" ? `敗北 ライフ−${result.lives}` : "引き分け";
    return element("li", `${title} · ${outcome}`);
  }));
  get("circuit-heal").hidden = !(status === "playing" && circuit.points >= healCost && circuit.lives < maxLives);
  get("circuit-restart").hidden = status === "playing";
  return true;
}

function showList(id: string, lines: string[]) {
  get(id).replaceChildren(...lines.map(line => element("li", line)));
}

function render() {
  if (renderCircuit()) return;
  const view = observe(rules, state, 0);
  const table = observeTable(rules, state, 0);
  get("app").dataset.pattern = rules.pattern;
  get("catalog").replaceChildren(...examples.map(example => {
    const tab = element("button", patternInfo[example.pattern].label);
    tab.type = "button";
    tab.setAttribute("aria-pressed", String(example === rules));
    tab.onclick = () => begin(example, newSeed(), 0);
    return tab;
  }));
  get("title").textContent = rules.title;
  get("premise").textContent = rules.premise;
  const currentRound = playback?.round ?? view.round;
  get("round").textContent = `ラウンド ${currentRound} / ${view.rounds}${table.kind === "islands" && !view.done ? ` · 手番 ${table.step + 1}/4` : ""}`;
  get("progress").replaceChildren(...Array.from({ length: view.rounds }, (_, index) => {
    const round = index + 1;
    const complete = (!playback && view.done) || round < currentRound;
    const step = element("li", String(round), complete ? "complete" : "");
    if ((playback || !view.done) && round === currentRound) step.setAttribute("aria-current", "step");
    const bonus = table.schedule[index];
    const label = `第${round}ラウンド${complete ? " 完了" : ""}${bonus ? ` · ${bonus}` : ""}`;
    step.title = label;
    step.setAttribute("aria-label", label);
    return step;
  }));
  get("score").replaceChildren(...view.scores.map((value, seat) => {
    const card = element("div", "", seat === 0 ? "score-card yours" : "score-card");
    const shown = playback?.discharge.seat === seat ? value - playback.discharge.points : value;
    card.append(element("span", seat === 0 ? "あなた" : "対戦相手"), element("strong", String(shown)));
    return card;
  }));
  get("secret").hidden = !view.secret;
  get("secret").textContent = view.secret ? `非公開 · ${view.secret}` : "";
  get("decision").hidden = view.done;
  get("decision-title").textContent = decisionTitles[rules.pattern];
  get("decision-text").textContent = playback ? "光が中継器から塔へ届くと、放電した塔の点が入る。" : decisionText(rules, view, table);
  get("compare").hidden = !view.options.length || Boolean(playback);
  get("compare-options").replaceChildren(...view.options.flatMap(option => [
    element("dt", option.label), element("dd", optionHint(rules, view, table, option.id)),
  ]));
  const schedule = get("schedule");
  schedule.hidden = !table.schedule.length || view.done;
  schedule.textContent = table.schedule.length ? `加点の予定 · ${table.schedule.join(" / ")}` : "";
  showList("rules", view.rules);
  const shownEvents = view.history.slice(0, playback?.publicEvents);
  showList("history", shownEvents.length ? shownEvents.reverse().map(event => `R${event.round}  ${event.text}`) : ["まだ手は公開されていません。"]);
  get("turn").textContent = failure || (playback ? "回路を伝播中…" : view.done
    ? view.scores[0] === view.scores[1] ? "引き分け" : view.scores[0] > view.scores[1] ? "あなたの勝ち" : "対戦相手の勝ち"
    : view.turn === 0 ? "あなたの番です" : "対戦相手が考えています…");
  get("feedback").hidden = !view.done || Boolean(playback);
  get("recovery").hidden = !failure;
  opponent.disabled = pending;
  renderBoard(get("board"), get("choices"), rules, view, table, move => {
    commit(move, "human");
    void advance();
  }, playback);
}

function commit(move: Move, controller: CircuitMove["controller"]) {
  const before = observe(rules, state, 0);
  const oldTable = observeTable(rules, state, 0);
  state = play(rules, state, move).state;
  const discharge = state.resonance?.last;
  const after = observe(rules, state, 0);
  const outcome = describeOutcome(rules, before, after, oldTable, observeTable(rules, state, 0), move);
  if (discharge && oldTable.kind === "resonance" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const current = generation;
    const scene = { discharge, chargesBefore: oldTable.network.charges, round: before.round, publicEvents: before.history.length,
      start: performance.now(), duration: signalDuration(discharge.pulses) };
    playback = scene;
    setTimeout(() => {
      if (current !== generation || playback !== scene) return;
      playback = null;
      renderOutcome(get("outcome"), outcome);
      render();
      void advance();
    }, scene.duration);
  }
  actions.push(move);
  controllers.push(controller);
  if (mode === "circuit" && circuit.active) {
    circuit.active.actions.push({ move, controller });
    if (after.done) {
      circuit = settleCircuit(circuit, after.scores);
      showEndTable = true;
    }
    saveCircuit();
  }
  if (!playback) {
    if (rules.pattern === "duel" || rules.pattern === "auction" || rules.pattern === "mine") {
      if (!outcome.sealed) lastReveal = outcome;
      if (!outcome.sealed || !lastReveal) renderOutcome(get("outcome"), outcome);
    } else {
      if (before.turn === 0) lastOwn = outcome;
      renderOutcome(get("outcome"), outcome, lastOwn !== outcome && lastOwn && lastOwn.round >= outcome.round - 1 ? lastOwn : null);
    }
  }
  render();
}

async function advance() {
  if (playback || (mode === "circuit" && !circuit.active) || state.turn !== 1 || state.round > rules.rounds || pending) return;
  const current = generation;
  const controller = opponent.value as "cpu" | "llm" | "jev";
  failure = "";
  pending = true;
  render();
  try {
    if (controller === "cpu") {
      await new Promise(resolve => setTimeout(resolve, 180));
      if (current === generation) commit(quickMove(observe(rules, state, 1)), controller);
    } else {
      const response = await fetch("/api/move", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, seed, first, rivalLead, actions, opponent: controller }),
      });
      if (current !== generation) return;
      if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("LLM・JevにはローカルのVite開発サーバーが必要です。");
      const payload = await response.json();
      if (current !== generation) return;
      if (!response.ok) throw new Error(payload.error ?? "対戦相手に接続できません");
      commit(payload.move, controller);
    }
  } catch (error) {
    if (current === generation) failure = error instanceof Error ? error.message : "対戦相手に接続できません";
  } finally {
    if (current === generation) {
      pending = false;
      render();
      if (!failure) void advance();
    }
  }
}

function begin(next: Rules, nextSeed: number, starter: Seat, lead = 0, replay: CircuitMove[] = []) {
  let resumed = start(next, nextSeed, starter, lead);
  for (const action of replay) resumed = play(next, resumed, action.move).state;
  generation++;
  rules = next;
  seed = nextSeed;
  first = starter;
  rivalLead = lead;
  state = resumed;
  actions = replay.map(action => action.move);
  controllers = replay.map(action => action.controller);
  notes.value = "";
  lastOwn = null;
  lastReveal = null;
  playback = null;
  renderOutcome(get("outcome"), null);
  pending = false;
  failure = "";
  get("import-error").hidden = true;
  render();
  void advance();
}

function openCircuit() {
  mode = "circuit";
  showEndTable = false;
  generation++;
  pending = false;
  if (circuit.active) {
    const offer = circuitOffers(circuit)[circuit.active.slot];
    try {
      begin(offer.rules, offer.seed, 0, offer.lead, circuit.active.actions);
      return;
    } catch {
      circuit = { ...circuit, active: null };
    }
  }
  saveCircuit();
  render();
}

input.onchange = async () => {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > 12_000) throw new Error("ルールJSONのサイズが大きすぎます");
    const imported = parseRules(JSON.parse(await file.text()));
    mode = "single";
    begin(imported, newSeed(), 0);
  } catch (error) {
    get("import-error").textContent = error instanceof Error ? error.message : "ルールを開けませんでした";
    get("import-error").hidden = false;
  }
};

get("reset").onclick = () => begin(rules, seed, first);
get("new").onclick = () => begin(rules, newSeed(), first === 0 ? 1 : 0);
get("mode-single").onclick = () => {
  if (mode === "single") return;
  mode = "single";
  begin(examples[0], newSeed(), 0);
};
get("mode-circuit").onclick = () => { if (mode !== "circuit") openCircuit(); };
get("circuit-next").onclick = () => openCircuit();
get("circuit-heal").onclick = () => {
  circuit = healCircuit(circuit);
  saveCircuit();
  render();
};
get("circuit-restart").onclick = () => {
  circuit = startCircuit(newSeed());
  openCircuit();
};
get("retry").onclick = () => void advance();
get("use-cpu").onclick = () => { opponent.value = "cpu"; void advance(); };
opponent.onchange = () => void advance();
get("save").onclick = () => {
  const data = { rules, seed, first, rivalLead, actions, controllers, scores: observe(rules, state, 0).scores,
    history: state.history, comment: notes.value };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = element("a", "");
  link.href = url;
  link.download = "boardgame-playtest.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

if (mode === "circuit") openCircuit();
else render();
