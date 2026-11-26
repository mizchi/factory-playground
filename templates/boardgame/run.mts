import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask, agentName, type AgentRoute } from "../factory/agent.mts";
import { observe, parseRules, patternInfo, patterns, play, start,
  type Pattern, type Rules, type Seat, type View, type Cue } from "./game.mts";
import { choose, playerRoute, type Decision } from "./llm.mts";
import { possibleEffect } from "./evaluate.mts";

const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const route = (agent: string | undefined, model: string | undefined): AgentRoute => ({ agent: agentName(agent), model });
const author = route(process.env.BOARDGAME_AUTHOR_AGENT, process.env.BOARDGAME_AUTHOR_MODEL);
const reviewer = route(process.env.BOARDGAME_REVIEWER_AGENT, process.env.BOARDGAME_REVIEWER_MODEL);
const seats = [
  playerRoute(process.env.BOARDGAME_PLAYER1_AGENT, process.env.BOARDGAME_PLAYER1_MODEL),
  playerRoute(process.env.BOARDGAME_PLAYER2_AGENT, process.env.BOARDGAME_PLAYER2_MODEL),
] as const;

const fields = {
  title: { type: "string" }, premise: { type: "string" }, hypothesis: { type: "string" },
  labels: { type: "array", items: { type: "string" } }, values: { type: "array", items: { type: "integer" } },
  rounds: { type: "integer" }, bonus: { type: "integer" }, variation: { type: "integer", enum: [0, 1] },
};

async function generate(brief: string, pattern: Pattern, feedback: unknown) {
  const info = patternInfo[pattern];
  const data = await ask(author.agent, [
    "お題から短い独自の対戦ゲームを設計する。システムのルールは固定。舞台と数値で、お題ならではの判断を生み出す。",
    "勝敗は点数。公開情報と自分の秘密だけで考えられる。タイトルは60文字、前提と仮説は各220文字、手の名前は各30文字以内。説明文に新しい規則を作らない。",
    `形式 ${info.label}。狙い ${info.hypothesis}`, info.parameters,
    "駆け引きの手掛かりが出た後に複数回試せる長さを選ぶ。秘密を読めることを優先し、variation は原則0。変化が必要なら開始前に公開される+1点を選択する1。",
    "仮説にはどんな局面で行動が変わるかを書く。",
    JSON.stringify({ brief, feedback }),
  ].join("\n"), fields, author.model);
  return { ...data, pattern };
}

type Turn = { id: string; view: View; decision: Decision; cue: Cue | null };
const match = async (rules: Rules, seed: number, first: Seat, file: string) => {
  let state = start(rules, seed, first);
  const trace: Turn[] = [];
  const persist = () => write(file, { seed, first, scores: observe(rules, state, 0).scores, done: state.round > rules.rounds, trace });
  persist();
  try {
    while (state.round <= rules.rounds) {
      const view = observe(rules, state, state.turn);
      const decision = view.options.length === 1
        ? { move: view.options[0].id, reason: "残る合法手が一つ。" }
        : await choose(seats[state.turn], view);
      const result = play(rules, state, decision.move);
      trace.push({ id: `S${first + 1}-T${trace.length + 1}`, view, decision, cue: result.cue });
      state = result.state;
      persist();
    }
  } catch (error) {
    write(file, { seed, first, done: false, error: String(error), trace });
    throw error;
  }
  return trace;
};

async function assess(rules: Rules, trace: Turn[]) {
  const witnesses = trace.filter(turn => turn.cue !== null);
  const decisions = trace.map(turn => ({
    id: turn.id, round: turn.view.round, seat: turn.view.seat + 1,
    board: turn.view.board, scores: turn.view.scores, lastPublic: turn.view.history.at(-1)?.text,
    options: turn.view.options, choice: turn.decision, proof: turn.cue?.text,
  }));
  if (!witnesses.length) return {
    accepted: false, evidence: "", finding: "狙った仕組みが選択や得点に効いた局面が機械検査で見つからなかった。",
    witnesses: [], decisions,
  };
  const response = await ask(reviewer.agent, [
    "あなたはゲーム設計の独立した編集者。プレイヤーの理由は自己申告として扱い、実際の合法手・盤面・結果で裏付ける。",
    `形式の狙い: ${patternInfo[rules.pattern].hypothesis}`, `作者仮説: ${rules.hypothesis}`,
    "狙った判断を裏付ける一連の手がある時だけ pass を true にする。偶然の一致や、合法手が一つしかないことだけを根拠にしない。",
    "Jev は理由の代わりに選んだ手と確率を返す。確率を理由として扱わず、盤面と実際の手で確認できることだけを述べる。",
    "claim では相手の公開履歴からの推測、duel では相手の残り手と実際の選択の関係、invest では投資と換金の期限、auction では入札額と残り予算、mine では落盤前の帰還と回収量、islands では造船所への投資、resonance では回路を読み2基を連鎖させた選択を検討する。",
    "証拠は proof がある行の id 一つを evidence に入れ、finding に日本語で観測と改善点を簡潔に書く。",
    JSON.stringify(decisions),
  ].join("\n"), {
    pass: { type: "boolean" }, evidence: { type: "string" }, finding: { type: "string" },
  }, reviewer.model);
  const evidence = typeof response.evidence === "string" ? response.evidence.trim() : "";
  const finding = typeof response.finding === "string" ? response.finding.trim() : "";
  const grounded = witnesses.some(turn => turn.id === evidence);
  return { accepted: response.pass === true && grounded && Boolean(finding), evidence, finding, grounded,
    witnesses: witnesses.map(turn => ({ id: turn.id, ...turn.cue })), decisions };
}

async function runPattern(root: string, brief: string, pattern: Pattern, attempts: number, seed: number) {
  const dir = join(root, pattern);
  mkdirSync(dir);
  let feedback: unknown = null;
  for (let revision = 1; revision <= attempts; revision++) {
    const draft = join(dir, `draft-${revision}`);
    mkdirSync(draft);
    const candidate = await generate(brief, pattern, feedback);
    let rules: Rules;
    try {
      rules = parseRules(candidate);
    } catch (error) {
      feedback = { candidate, issue: String(error) };
      write(join(draft, "assessment.json"), feedback);
      continue;
    }
    write(join(draft, "rules.json"), rules);
    const potential = possibleEffect(rules, seed);
    if (!potential) {
      const assessment = { accepted: false, stage: "preflight", rules,
        finding: "両方の先手で合法手を全列挙したが、この初期条件では狙いに対応する局面が作れなかった。",
        direction: "効果が起こりうる局面を数値で説明し、その局面に到達できる費用・得点・長さを指定する。" };
      feedback = assessment;
      write(join(draft, "assessment.json"), assessment);
      process.stderr.write(`[${pattern}] 第${revision}稿は狙いに対応する到達可能な局面なし\n`);
      continue;
    }
    write(join(draft, "potential.json"), potential);
    process.stderr.write(`[${pattern}] 第${revision}稿「${rules.title}」を2席で試遊\n`);
    const matches = await Promise.allSettled(([0, 1] as const).map(first => match(rules, seed, first, join(draft, `match-${first + 1}.json`))));
    const failed = matches.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const trace = matches.flatMap(result => result.status === "fulfilled" ? result.value : []);
    const assessment = await assess(rules, trace);
    write(join(draft, "assessment.json"), assessment);
    if (assessment.accepted) {
      write(join(dir, "rules.json"), rules);
      return { pattern, status: "READY_FOR_HUMAN", revision, evidence: assessment.evidence };
    }
    feedback = {
      rules, finding: assessment.finding, grounded: assessment.grounded,
      witnesses: assessment.witnesses,
      turns: assessment.decisions.slice(-6),
      direction: "狙った選択が自然に必要になるよう、既存の点数・費用・期間のうち一つを見直す。",
    };
  }
  return { pattern, status: "NEEDS_EDIT" };
}

async function main() {
  const [brief, selection = "all", rawAttempts = "2", rawSeed = "23"] = process.argv.slice(2);
  const attempts = Number(rawAttempts);
  const seed = Number(rawSeed);
  const selected = selection === "all" ? patterns : patterns.filter(pattern => pattern === selection);
  if (!brief?.trim() || !selected.length || !Number.isInteger(attempts) || attempts < 1 || attempts > 10 ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('使い方: just boardgame "お題" [all|claim|duel|invest|auction|mine|islands|resonance] [稿数1〜10] [seed 0〜4294967295]');
  }
  mkdirSync("runs", { recursive: true });
  const root = mkdtempSync(join("runs", "boardgame-"));
  write(join(root, "manifest.json"), { brief, patterns: selected, attempts, seed, author, seats, reviewer });
  process.stderr.write(`${root}\n`);
  // 同一機構の2対局は並行。機構間はローカルCLIの並列数を増やさないよう順に進める。
  const results = [];
  for (const pattern of selected) {
    try {
      results.push(await runPattern(root, brief, pattern, attempts, seed));
    } catch (error) {
      results.push({ pattern, status: "ERROR", error: String(error) });
    }
    write(join(root, "result.json"), results);
  }
  console.log(JSON.stringify({ root, results }, null, 2));
  process.exitCode = results.some(result => result.status === "ERROR") ? 2
    : results.every(result => result.status === "READY_FOR_HUMAN") ? 0 : 1;
}

main().catch(error => { console.error(String(error)); process.exitCode = 2; });
