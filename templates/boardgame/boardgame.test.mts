import assert from "node:assert/strict";
import test from "node:test";
import { examples } from "./examples.mts";
import { possibleEffect } from "./evaluate.mts";
import { chooseJev } from "./llm.mts";
import { acceptCircuitTable, circuitOffers, circuitStatus, healCircuit, readCircuit, settleCircuit, startCircuit } from "./web/circuit.mts";
import { observe, observeTable, parseRules, play, quickMove, start, turnLimit, type Move } from "./game.mts";

test("全サンプルで両先手、複数の公開条件を合法手で終局まで再生できる", () => {
  for (const example of examples) {
    for (const first of [0, 1] as const) {
      for (const seed of [0, 1, 23, 0xffffffff]) {
        const rules = parseRules({ ...example, variation: ["auction", "mine", "islands"].includes(example.pattern) ? 0 : 1 });
        let state = start(rules, seed, first);
        let replay = start(rules, seed, first);
        for (let step = 0; step < turnLimit(rules); step++) {
          const view = observe(rules, state, state.turn);
          const move = quickMove(view);
          state = play(rules, state, move).state;
          replay = play(rules, replay, move).state;
        }
        assert.equal(observe(rules, state, 0).done, true);
        assert.deepEqual(state, replay);
        assert.throws(() => play(rules, state, "a"), /合法手/);
      }
    }
  }
});

test("相手の非公開情報を差し替えても、自席視点からは区別できない", () => {
  const rules = examples[0];
  const state = start(rules, 0);
  const changed = structuredClone(state);
  changed.secrets[1] = [0, 1, 2].find(secret => !state.secrets.includes(secret))!;
  assert.deepEqual(observe(rules, state, 0), observe(rules, changed, 0));
  assert.deepEqual(observeTable(rules, state, 0), observeTable(rules, changed, 0));
  assert.notEqual(observe(rules, state, 1).secret, observe(rules, changed, 1).secret);
});

test("同時公開型の先に選んだ手は相手の観測や合法手に出ない", () => {
  const rules = parseRules({ ...examples[1], rounds: 3 });
  const initial = start(rules, 23);
  const left = play(rules, initial, "a").state;
  const right = play(rules, initial, "b").state;
  assert.deepEqual(observe(rules, left, 1), observe(rules, right, 1));
  assert.deepEqual(observeTable(rules, left, 1), observeTable(rules, right, 1));
  assert.notDeepEqual(observeTable(rules, left, 0), observeTable(rules, right, 0));
  assert.equal(observe(rules, left, 1).history.length, 0);
  const shown = play(rules, left, "b").state;
  assert.match(observe(rules, shown, 1).history[0].text, /灯火.*鏡.*公開/);
  assert.deepEqual(observe(rules, shown, 1).scores, [3, 0]);
  assert.deepEqual(observe(rules, shown, 1).options.map(choice => choice.id), ["a", "c"]);
});

test("先取りが相手の上限を下げるが自分の即時点も譲る局面を記録する", () => {
  const rules = examples[0];
  const state = start(rules, 0);
  state.secrets = [0, 1];
  const result = play(rules, state, "b");
  assert.equal(result.cue?.kind, "claim");
  assert.deepEqual(observe(rules, result.state, 1).options.map(option => option.id), ["a", "c"]);
  assert.throws(() => play(rules, result.state, "b"), /合法手/);
  assert.equal(play(rules, state, "a").cue, null);
});

test("投資の収入がなければ届かない換金を記録し、同ラウンドの換金枠を塞ぐ", () => {
  const rules = parseRules({ ...examples[2], values: [1, 1, 5] });
  let state = start(rules, 23);
  for (const move of ["a", "b", "b", "b", "c", "b", "b", "b"] satisfies Move[]) state = play(rules, state, move).state;
  const result = play(rules, state, "c");
  assert.equal(result.cue?.kind, "invest");
  assert.equal(observe(rules, result.state, 1).options.some(option => option.id === "c"), false);
});

test("未知の仕組み、極端な乱数、矛盾する数値と重複ラベルを拒否する", () => {
  const rules = examples[1];
  assert.throws(() => parseRules({ ...rules, pattern: "arbitrary" }));
  assert.throws(() => parseRules({ ...rules, variation: 30 }));
  assert.throws(() => parseRules({ ...rules, rounds: 7 }));
  assert.throws(() => parseRules({ ...rules, labels: ["同じ", "同じ", "別"] }));
});

test("到達可能な証拠の手順を返し、投資が常に資金獲得に劣る案は棄却する", () => {
  const rules = examples[2];
  const evidence = possibleEffect(rules, 23);
  assert.ok(evidence);
  const initial = start(rules, 23, evidence.first);
  const turns = evidence.actions.map((move, index, sequence) => {
    const state = sequence.slice(0, index).reduce((state, action) => play(rules, state, action).state, initial);
    return play(rules, state, move);
  });
  assert.deepEqual(turns.at(-1)?.cue, evidence.cue);
  assert.equal(possibleEffect(parseRules({ ...rules, rounds: 3, values: [2, 3, 4] }), 23), null);
});

test("Jevには自席の観測と合法手だけを渡し、Choiceの確率を保存する", async () => {
  const rules = examples[1];
  const left = play(rules, start(rules, 5), "a").state;
  const right = play(rules, start(rules, 5), "b").state;
  const payloads: unknown[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    const body = JSON.parse(String(init?.body));
    assert.ok(!Object.hasOwn(body, "key"));
    payloads.push(body);
    assert.deepEqual(Object.keys(body.questions.move.criteria), ["a", "b", "c"]);
    assert.deepEqual(JSON.parse(body.state).history, []);
    return Response.json({ model: "jev-test", answers: {
      move: { type: "choice", choice: "b", confidence: 0.8, probabilities: { a: 0.1, b: 0.8, c: 0.1 } },
    } });
  };
  const results = await Promise.all([left, right].map(state => chooseJev("test-key", observe(rules, state, 1), "jev-test", request)));
  assert.deepEqual(payloads[0], payloads[1]);
  assert.deepEqual(results[0], { move: "b", reason: null, choiceStats: {
    model: "jev-test", confidence: 0.8, probabilities: { a: 0.1, b: 0.8, c: 0.1 },
  } });
});

test("Jevの不正な手やキーなしをエラーにする", async () => {
  const rules = examples[0];
  const view = observe(rules, play(rules, start(rules, 5), "a").state, 1);
  const invalid: typeof fetch = async () => Response.json({ model: "jev-test", answers: {
    move: { type: "choice", choice: "a", confidence: 1, probabilities: { b: 0, c: 0 } },
  } });
  await assert.rejects(chooseJev("test-key", view, "jev-test", invalid), /Choice 応答/);
  await assert.rejects(chooseJev("", view, "jev-test", invalid), /TYPESAFE_API_KEY/);
});

test("長い先取り戦は見送った枠に点がたまり、取ったときに解消する", () => {
  const rules = parseRules({ ...examples[0], rounds: 8 });
  let state = start(rules, 5);
  state = play(rules, play(rules, state, "a").state, "b").state;
  const table = observeTable(rules, state, 1);
  assert.equal(table.kind, "claim");
  assert.equal(table.cards.find(card => card.id === "c")?.carry, 1);
  state = play(rules, play(rules, state, "c").state, "a").state;
  const next = observeTable(rules, state, 0);
  assert.equal(next.kind, "claim");
  assert.equal(next.cards.find(card => card.id === "c")?.carry, 0);
});

test("6ラウンド戦は同じ札を2回まで切れ、3回目は合法手から消える", () => {
  const rules = parseRules({ ...examples[1], rounds: 6 });
  let state = start(rules, 5);
  for (let turn = 0; turn < 4; turn++) {
    assert.ok(observe(rules, state, state.turn).options.some(option => option.id === "a"));
    state = play(rules, state, "a").state;
  }
  assert.equal(observe(rules, state, state.turn).options.some(option => option.id === "a"), false);
  const table = observeTable(rules, state, state.turn);
  assert.equal(table.kind, "duel");
  assert.deepEqual(table.remaining, [[0, 2, 2], [0, 2, 2]]);
});

test("封印入札は公開まで金額が漏れず、公開後は双方が支払う", () => {
  const rules = examples.find(rules => rules.pattern === "auction")!;
  const state = start(rules, 0);
  const small = play(rules, state, "b").state;
  const big = play(rules, state, "c").state;
  assert.deepEqual(observe(rules, small, 1), observe(rules, big, 1));
  assert.deepEqual(observeTable(rules, small, 1), observeTable(rules, big, 1));
  const result = play(rules, big, "b");
  assert.equal(result.cue?.kind, "auction");
  assert.deepEqual(result.state.players.map(player => [player.points, player.funds]), [[2, 6], [0, 8]]);
  const tie = play(rules, small, "b").state;
  assert.deepEqual(tie.players.map(player => [player.points, player.funds]), [[0, 8], [0, 8]]);
  const poor = start(rules, 0);
  poor.players[0].funds = 0;
  assert.deepEqual(observe(rules, poor, 0).options.map(option => option.id), ["a"]);
});

test("採掘の帰還は落盤より先に確定し、掘り続けた側だけ鉱石を失う", () => {
  const rules = examples.find(rules => rules.pattern === "mine")!;
  let state = start(rules, 0);
  state = play(rules, play(rules, state, "b").state, "b").state;
  assert.equal(state.pressure, 4);
  const hidden = play(rules, state, "a").state;
  const withdrawal = play(rules, state, "c").state;
  assert.deepEqual(observeTable(rules, hidden, 0), observeTable(rules, withdrawal, 0));
  const result = play(rules, withdrawal, "a");
  assert.equal(result.cue?.kind, "mine");
  assert.equal(result.state.pressure, 0);
  assert.deepEqual(result.state.players.map(player => [player.points, player.cargo]), [[0, 0], [4, 0]]);
  assert.match(result.state.history.at(-1)?.text ?? "", /落盤/);
});

test("三卓巡りは異なる3卓から選び、勝敗を持ち越して5卓で踏破する", () => {
  let run = startCircuit(42);
  const firstChoices = circuitOffers(run);
  assert.equal(firstChoices.length, 3);
  assert.equal(new Set(firstChoices.map(offer => offer.rules.pattern)).size, 3);
  assert.deepEqual(circuitOffers(readCircuit(JSON.stringify(run))!), firstChoices);
  for (let stage = 0; stage < 5; stage++) {
    const next = circuitOffers(run)[2];
    assert.notEqual(next.rules.pattern, run.trail.at(-1)?.pattern);
    run = acceptCircuitTable(run, 2);
    assert.throws(() => acceptCircuitTable(run, 0));
    run = settleCircuit(run, [10, 9]);
  }
  assert.equal(run.points, 25);
  assert.equal(circuitStatus(run), "clear");
  assert.deepEqual(circuitOffers(run), []);
});

test("三卓巡りの敗北・引き分け・回復が次の卓に反映される", () => {
  let run = settleCircuit(acceptCircuitTable(startCircuit(0), 1), [5, 1]);
  run = settleCircuit(acceptCircuitTable(run, 2), [1, 2]);
  assert.equal(run.lives, 1);
  run = healCircuit(run);
  assert.equal(run.lives, 2);
  assert.equal(run.points, 0);
  run = settleCircuit(acceptCircuitTable(run, 1), [3, 3]);
  assert.equal(run.lives, 2);
  run = settleCircuit(acceptCircuitTable(run, 2), [3, 4]);
  assert.equal(circuitStatus(run), "lost");
});

test("先行点は相手にも見え、同じ行動で再生できる", () => {
  const rules = examples[0];
  const initial = start(rules, 23, 0, 2);
  assert.deepEqual(observe(rules, initial, 1).scores, [0, 2]);
  assert.deepEqual(play(rules, initial, "a").state, play(rules, start(rules, 23, 0, 2), "a").state);
});

test("潮路諸島は4手でラウンドを進め、造船所と潮ごとの資材で出荷し委託を達成する", () => {
  const rules = examples.find(example => example.pattern === "islands")!;
  let state = start(rules, 23);
  state.secrets[0] = 1;
  const altered = structuredClone(state);
  altered.secrets[1] = 1 - state.secrets[1];
  assert.deepEqual(observe(rules, state, 0), observe(rules, altered, 0));
  assert.deepEqual(observeTable(rules, state, 0), observeTable(rules, altered, 0));

  const apply = (...actions: Move[]) => {
    for (const id of actions) state = play(rules, state, id).state;
  };
  assert.throws(() => play(rules, state, "ocean"), /合法手/);
  apply("supply", "supply", "yard");
  assert.throws(() => play(rules, state, "yard"), /合法手/);
  assert.equal(state.round, 1);
  apply("supply");
  assert.equal(state.round, 2);
  assert.equal(state.turn, 1);
  assert.equal(state.island?.ports[0].stone, 1);
  apply("supply", "supply", "supply", "ocean");
  assert.equal(state.players[0].points, 6);
  apply("forest", "supply", "supply", "supply", "supply");
  assert.match(observe(rules, state, 0).options.find(option => option.id === "ocean")?.detail ?? "", /木材3・石材1 → 8点/);
  apply("ocean");
  assert.equal(state.players[0].points, 14);
  assert.equal(state.island?.ports[0].wood, 1);
  while (state.round <= rules.rounds) apply("supply");
  assert.equal(state.players[0].points, 18);
  assert.match(state.history.at(-1)?.text ?? "", /委託「外洋船団」/);
  assert.equal(turnLimit(rules), 32);
  assert.equal(possibleEffect(rules, 23)?.cue.kind, "islands");
});

test("前のバージョンで始めた三卓巡りは同じ5形式で再開する", () => {
  const { poolSize, ...legacy } = startCircuit(42);
  assert.equal(poolSize, examples.length);
  let run = readCircuit(JSON.stringify(legacy))!;
  for (let stage = 0; stage < 5; stage++) {
    assert.ok(circuitOffers(run).every(offer => offer.rules.pattern !== "islands"));
    run = settleCircuit(acceptCircuitTable(run, 0), [20, 10]);
  }
});

test("雷奏回廊は入口から二つの中継器と得点塔へ伝播し、余分な得点を加える", () => {
  const rules = examples.find(rule => rule.pattern === "resonance")!;
  const initial = start(rules, 0);
  initial.resonance!.charges = [[1, 0, 0], [1, 1, 0], [1, 1, 0]];
  const options = observe(rules, initial, 0).options;
  assert.match(options.find(option => option.id === "a")!.detail, /^0点/);
  assert.match(options.find(option => option.id === "surge-a")!.detail, /^9点/);
  const table = observeTable(rules, initial, 0);
  assert.equal(table.kind, "resonance");
  const preview = table.previews.find(option => option.move === "surge-a");
  const result = play(rules, initial, "surge-a");
  assert.equal(result.cue?.kind, "resonance");
  assert.deepEqual(result.state.resonance!.last?.pulses.map(({from, to}) => [from, to]), [[null,0],[0,3],[0,4],[3,6],[4,7]]);
  assert.deepEqual(preview?.pulses, result.state.resonance!.last?.pulses);
  assert.equal(result.state.players[0].points, 9);
  assert.deepEqual(result.state.resonance!.surges, [1, 2]);
  assert.deepEqual(initial.resonance!.charges, [[1, 0, 0], [1, 1, 0], [1, 1, 0]]);
  initial.resonance!.surges[0] = 0;
  assert.throws(() => play(rules, initial, "surge-a"), /合法手/);
});
