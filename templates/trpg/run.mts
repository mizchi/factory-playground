import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentName, askTextFields, type Agent } from "../factory/agent.mts";

import { designInstructions, designKeys, duration, emergenceInstructions, emergenceKeys, emergenceVerified, roleplayInstructions, schedule, type Call, type Entry, type Minutes } from "./session.mts";
import { checkContinuity, cliDecision, jevDecision, type Decide } from "./continuity.mts";

import { contextWith, defaultContext, gmView, loadBranch, loggedCall, saveCheckpoint, type Context, type Checkpoint } from "./checkpoint.mts";

import { modules, design, rulesFrom, initial, choices, resolveMove, ruleSheet, type Module } from "./rpg.mts";

type Player = { name: string; desire: string };
export type Table = { wish: string; promise: string; openQuestion: string; lens?: string; players: Player[];
  mechanics?: Module[]; minutes?: Minutes; complications: string[]; scenes: number; seed: number; maxRevisions: number };
const nonempty = (v: unknown): v is string => typeof v === "string" && !!v.trim();
export function readTable(file: string): Table {
  const t = JSON.parse(readFileSync(file, "utf8"));
  if (t?.minutes !== undefined) {
    t.minutes = duration(t.minutes);
    t.scenes = t.minutes === 30 ? 2 : 4;
  }
  if (!t || ![t.wish, t.promise, t.openQuestion].every(nonempty) ||
      (t.lens !== undefined && !nonempty(t.lens)) || !Array.isArray(t.players) || ![2, 3].includes(t.players.length) ||
      !t.players.every((p: Player) => p && nonempty(p.name) && nonempty(p.desire)) ||
      new Set(t.players.map((p: Player) => p.name)).size !== t.players.length ||
      !Array.isArray(t.complications) || !t.complications.length || !t.complications.every(nonempty) ||
      !Number.isSafeInteger(t.seed) || t.seed < 0 || ![2, 3, 4].includes(t.scenes) || ![0, 1, 2].includes(t.maxRevisions))
    throw new Error("table.json の必須項目、人数（2〜3）、場面数（2〜4）、改稿上限（0〜2）、seed を確認してください");
  modules(t.mechanics);
  return t;
}

function cli(agent: Agent, judge: Agent, gm = agent, gmModel?: string): Call {
  return (role, prompt, keys) => {
    const route = role === "gm" ? {agent:gm, model:gmModel} : {agent:["judge","continuity"].includes(role) ? judge : agent};
    return askTextFields(route, prompt, keys);
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
function save(dir: string, name: string, value: unknown) { writeFileSync(join(dir, name), json(value) + "\n"); }


// With just a wish, infer the table's creative brief once. A supplied preset is authoritative.
export async function tableFromWish(wish: string, defaults: Table, call: Call): Promise<Table> {
  const b = await call("brief", `人間のプレイ時間は${defaults.minutes ?? (defaults.scenes === 2 ? 30 : 60)}分。遊びたい卓の依頼: ${wish}。この依頼に合う短編TRPGの卓を日本語で用意する。
promise は守るべき体験、openQuestion は結末で人間に残す問い、name1/desire1 と name2/desire2 は異なる立場のPC名と望み、lens はこのジャンル特有の試遊後の問い。どれも短い1文。`,
    ["promise", "openQuestion", "name1", "desire1", "name2", "desire2", "lens"]);
  if (b.name1 === b.name2) throw new Error("PC名が重複しています");
  return { ...defaults, wish, promise: b.promise, openQuestion: b.openQuestion, lens: b.lens,
    players: [{name: b.name1, desire: b.desire1}, {name: b.name2, desire: b.desire2}] };
}
const scenarioKeys = ["title", "opening", "secret", "clues", "routes", "ending"] as const;
export async function playtest(t: Table, run: string, call: Call, replay?: Record<string, string>, decide: Decide = cliDecision(call),
    context: Context = defaultContext, checkpoint?: Checkpoint) {
  const minutes = duration(t.minutes ?? (t.scenes === 2 ? 30 : 60));
  const pace = schedule(minutes, t.minutes === undefined ? t.scenes : minutes === 30 ? 2 : 4);
  const extras = designKeys(t.players.length, pace.scenes.length);
  const active = modules(t.mechanics);
  const parameters = design(active,pace.scenes.length);
  const mechanicsBrief = active.length ? "\n次の公開ルールを本文・ハンドアウトにも適用する。PCは各場面で1手。交渉・待機は無料で位置は変わらない。地図使用時は順路を1手で1区間歩ける。障害突破（地図では入口⇄目的地の近道）はHPか共有品の支払いでのみ成立する。使うルール: "+active.join(",")+"。追加の資源・共有手数・個別の判定や料金を作らない。設定欄: "+json(parameters) : "";
  const cast = t.players.map(p => p.name);
  const brief = { wish: t.wish, promise: t.promise, openQuestion: t.openQuestion, cast, pace };
  const twist = t.seed === 0 ? "" : t.complications[(t.seed - 1) % t.complications.length];
  save(run, "table.json", t);
  save(run, "context.json", context);
  let revision = "";
  for (let draft = 1; draft <= 1 + t.maxRevisions; draft++) {
    const dir = join(run, `draft-${draft}`);
    mkdirSync(dir);
    console.log(`第${draft}稿: ${replay ? "保存したシナリオで再試遊" : "シナリオ作成"}`);
    let scenario = replay ?? await call("author", `日本語で短い${active.length ? "補助ルール付きの" : "システム不要の"}1話TRPGを書く。各欄は簡潔に。配役と望み: ${json(t.players)}。
${designInstructions}${mechanicsBrief}\n${json(brief)}
title=題名、opening=卓で読む導入（手がかりを1つ見せる）、secret=GMだけが知る意外な真相、clues=真相を推測できる別々の手がかりを2つ、routes=人物の望みと少なくとも2通りの選択・代償、ending=異なる結末の条件とGMの進行メモ。作者の余白 openQuestion の答えを代筆しない。\n${revision}`,
      [...scenarioKeys, ...extras, ...Object.keys(parameters)]);
    if (replay && extras.some(key => !nonempty(replay[key]))) {
      if (checkpoint) throw new Error("旧稿に当時のハンドアウト・場面設定がありません。trpg-replay で試遊した稿から再開してください");
      const supplement = await call("supplement", `保存稿と配役を保ち、不足する試遊用設定を補う。
${json(replay)}
${json(t.players)}
${json(pace)}
${designInstructions}`, extras);
      scenario = { ...supplement, ...replay };
    }
    let rules: ReturnType<typeof rulesFrom>;
    try {
      rules = rulesFrom(scenario,active,pace.scenes.length);
    } catch (error) {
      if (replay) throw error;
      const corrected = await call("rules", `RPGの公開設定だけを訂正する。エラー: ${String(error)}。数値は全席共通で半角数字1文字だけ。仕様: ${json(parameters)}。シナリオ: ${json(scenario)}`, Object.keys(parameters));
      scenario = {...scenario,...corrected};
      rules = rulesFrom(scenario,active,pace.scenes.length);
    }
    const state = rules && initial(rules,t.players.length);
    const sheet = rules ? ruleSheet(rules) : "";
    const publicRules = () => rules ? "\n公開ルール（席順 "+cast.join("、")+"、位置は入口を0とする）: "+sheet+"\n現在値: "+json(state) : "";
    const packets = t.players.map((player,i) => ({ ...player, clue: scenario[`handout${i+1}`], win: scenario[`win${i+1}`] }));
    if (new Set(packets.map(p => p.win.trim())).size !== packets.length) throw new Error("PCの勝利条件が重複しています");
    mkdirSync(join(dir, "handouts"));
    packets.forEach((packet,i) => save(join(dir, "handouts"), `pc-${i+1}.json`, packet));
    const agenda = pace.scenes.map((beat,i) => `- ${beat.minutes}分　${beat.aim}。
  ${scenario[`beat${i+1}`]}`);
    save(dir, "scenario.json", scenario);
    writeFileSync(join(dir, "scenario.md"), `# ${scenario.title}\n\n## 配役と約束\n\n${t.promise}\n\n${t.players.map(p => "- **" + p.name + "**　" + p.desire).join("\n")}\n\n## 卓で読む導入\n\n${scenario.opening}\n\n${rules ? "## 公開ルール\n\n"+sheet+"\n\n" : ""}## GM用\n\n${scenario.secret}\n\n${scenario.clues}\n\n${scenario.routes}\n\n${scenario.ending}\n\nNPCの演じ方　${scenario.npc}\n\n## ${minutes}分卓の進行\n\n導入5分、感想5分。\n${agenda.join("\n")}\n\nPCが行動を宣言し、GMが結果を伝える。${twist ? "最初の場面の末に公開するカード: " + twist : "今回は揺らぎカードを使わない。"} 最終場面の前に代償の違う案を問い、第三案を含め、全員の最終案を聞く。先に話した席には一度ずつ相手の案に応答する機会を渡してから、結末を描く。\n\n## 卓に残す問い\n\n${t.openQuestion}\n`);
    const checkpointDir = join(dir,"checkpoints");
    mkdirSync(checkpointDir);
    const publicLog: Entry[] = checkpoint ? [...checkpoint.publicLog] : [{ id: "S0", text: scenario.opening }];
    if (rules && state && checkpoint) {
      for (const event of publicLog) {
        const action = /^A\d+\.(\d+)$/.exec(event.id);
        if (action) resolveMove(rules,state,Number(action[1])-1,event.move ?? "");
      }
    }
    const predictions: string[][] = checkpoint ? checkpoint.predictions.map(p => [...p]) : t.players.map(() => []);
    for (let turn = checkpoint?.turn ?? 1; turn <= pace.scenes.length; turn++) {
      console.log(`第${draft}稿: 場面 ${turn}/${pace.scenes.length}`);
      const ending = turn === pace.scenes.length;
      const offerChoice = turn === pace.scenes.length - 1;
      if (turn !== checkpoint?.turn) {
        const npc = await call("npc", `次の人物を日本語で演じる。人物メモ: ${scenario.npc}。${publicRules()}公開ログ: ${json(publicLog)}。卓の約束: ${t.promise}。${roleplayInstructions} 台詞または行動を一つ。偏りが出てもPCの反応や世界の結果を決めない。`, ["action"]);
        publicLog.push({id: `N${turn}`, text: npc.action});
        for (let offset = 0; offset < packets.length; offset++) {
          const i = (turn - 1 + offset) % packets.length;
          const player = packets[i];
          const menu = rules && state ? choices(rules,state,i) : [];
          const movePrompt = menu.length ? publicRules()+"\n選べる行動: "+json(menu.map(({code,label})=>({code,label})))+"。move に code を一つそのまま書き、action はその行動に沿って宣言する。" : "";
          const reply = await call("player", `あなたはPC「${player.name}」。自分のハンドアウト: ${json(player)}。自分の過去の予想: ${json(predictions[i])}。ほかのPC: ${cast.filter(n => n !== player.name).join("、")}。\n遊びたい体験: ${t.wish}\n約束: ${t.promise}\n卓に残された問い: ${t.openQuestion}\n公開ログ: ${json(publicLog)}
  ${roleplayInstructions}${movePrompt}
  日本語で prediction に次に起こると思うことを1文、action に自分の台詞か行動を1つ書く。GMの結果を決めない。${ending ? "直前に示された決断への自分の答えを action に書く。別案や保留も選べる。" : ""}`, menu.length ? ["prediction","action","move"] : ["prediction", "action"]);
          predictions[i].push(reply.prediction);
          const effect = rules && state ? resolveMove(rules,state,i,reply.move) : "";
          publicLog.push({ id: `A${turn}.${i+1}`, text: player.name + "「" + reply.action + "」" + (effect ? " ルール結果: "+effect : ""), ...(effect && {move:reply.move}) });
        }
        if (ending) {
          // The last speaker has heard every proposal. Give the earlier seats one reply each.
          for (let offset = 0; offset < packets.length - 1; offset++) {
            const i = (turn - 1 + offset) % packets.length;
            const reply = await call("reply", `あなたはPC「${packets[i].name}」。自分のハンドアウト: ${json(packets[i])}。自分の過去の予想: ${json(predictions[i])}。公開ログ: ${json(publicLog)}
  卓の約束: ${t.promise}。${roleplayInstructions}
  ${rules ? publicRules()+"この応答は会話のみで、追加の移動や支払いは行わない。" : ""}全員の案を聞いた後の最後の応答を一つ。どの提案を受け入れるか、修正するか、自案を維持するかはあなたが決める。他のPCの同意を代筆しない。`, ["action"]);
            publicLog.push({ id: `R${turn}.${i+1}`, text: packets[i].name + "「" + reply.action + "」" });
          }
        }
      }
      save(dir, "predictions.json", predictions);
      saveCheckpoint(checkpointDir,{version:1,turn,publicLog,predictions});
      const view = gmView(scenario,publicLog,turn,context);
      const scene = await call("gm", `あなたはこの卓のGM。この場面の進行: ${json(pace.scenes[turn-1])}。\n創作依頼: ${json(brief)}\nGM用シナリオ: ${json(view.scenario)}\nGMに渡されたメタ情報: ${json(view.metadata)}\nGM向けメモ: ${view.notes}${rules ? publicRules()+"。行動のルール結果と現在値は確定済み。描写はその結果を守る。" : ""}\n公開ログ: ${json(view.events)}
${turn === 1 && twist ? "この場面の末尾で次の変化を公開し、次の手をPCが選べるようにする: " + twist : ""} 各PCの行動の結果を、世界の事情と相手の利害から具体化する。善行へのご褒美や身勝手さへのお仕置きを自動的に足さない。PCの台詞や選択を代筆しない。\n${ending ? "今回が最終場面。最後の各PCの明示した決断から結果を描く。意見が分かれたら分かれたままの帰結を示し、語り手が多数決や合意を捏造しない。" : "世界の反応と手がかりを示し、次に何をするかPCに尋ねる。"} 公開する描写を narration に日本語3文以内で。${offerChoice ? "別欄 decision に、約束に直結する最後の決断を今ここで全PCに問う。代償の異なる案を2つ明示し、第三案を許す。作者が空けた答えを先取りしない。" : ""}`, offerChoice ? ["narration", "decision"] : ["narration"]);
      publicLog.push({ id: `S${turn}`, text: scene.narration });
      if (offerChoice) publicLog.push({ id: `D${turn}`, text: scene.decision });
      save(dir, "session.json", publicLog);
    }
    if (rules) save(dir,"mechanics.json",{rules,state});
    const survey = await Promise.all(t.players.map(async (p, i) => ({
      name: p.name, ...await call("survey", `あなたは${p.name}。自分のハンドアウト: ${json(packets[i])}。victoryに自分の勝利条件がどうなったかを書く。自分の事前予想: ${json(predictions[i])}。\n公開ログ: ${json(publicLog)}\n約束: ${t.promise}。このPCの一人称で独立に感想を書く。satisfaction=もう一度遊びたいかと理由、surprise=事前予想がどこで外れたか（当たった場合も正直に）、fairness=結末に納得できるか、agency=どの選択が効いたか。各1文。迎合せず、具体的な場面IDを挙げる。`,
        ["satisfaction", "surprise", "fairness", "agency", "victory"])
    })));
    save(dir, "survey.json", survey);
    const checks = await checkContinuity(scenario.secret, publicLog, decide);
    save(dir, "continuity.json", checks);
    const assessment = await call("judge", `独立した試遊編集者として日本語で評価。人間の満足度は推測しない。作者の約束: ${json(brief)}\n公開ログ: ${json(publicLog)}\n各PCの事前予想: ${json(predictions)}\n個別感想: ${json(survey)}${rules ? publicRules()+"。agencyには、制約を前に誰が何を諦めたか公開ログの行動IDで挙げる。選択に影響しなければそう書く。" : ""}
${emergenceInstructions}
promise=約束と作者の余白が実際に守られたか、payoff=意外性が先に出た手がかりで説明できたか、agency=選択で結末が変わった具体例、satisfaction=感想の一致と食い違い。各1文。payoff に前後2場面のIDを挙げ、予想どおりでも満足した場合と約束を外した場合を区別する。${t.lens ? "追加の観点も講評に反映する: " + t.lens : ""} 結末に驚いただけでは高評価にしない。evidenceId と quote に最も判定を左右した公開ログ1件のIDと、その text からの連続した原文を入れる。status は READY または REVISE。READY は人間の試遊に回せるという意味。約束を破った・選択が効かなかった・結末を説明できないときは REVISE、change に次稿で変える1点を書く。`,
      ["promise", "payoff", "agency", "satisfaction", "evidenceId", "quote", "status", "change", ...emergenceKeys]);
    const cited = publicLog.some(e => e.id === assessment.evidenceId && nonempty(assessment.quote) && e.text.includes(assessment.quote));
    const interactionVerified = emergenceVerified(assessment, publicLog);
    const conflicts = checks.filter(check => check.conflict);
    const unresolved = checks.some(check => check.choice === "UNKNOWN");
    const grounded = cited && interactionVerified && !unresolved && ["READY", "REVISE"].includes(assessment.status);
    const ready = grounded && assessment.status === "READY" && assessment.emergence === "OBSERVED" && conflicts.length === 0;
    save(dir, "assessment.json", { ...assessment, citationVerified: cited, interactionVerified, unresolved, conflicts });
    console.log(`第${draft}稿: ${!grounded ? "講評を要確認" : ready ? "人間の試遊へ" : "要改稿"} (${assessment.evidenceId})`);
    if (!grounded || ready || draft > t.maxRevisions) {
      const result = { status: !grounded ? "CHECK_ASSESSMENT" : ready ? "READY_FOR_HUMAN" : "NEEDS_EDIT", draft, scenario: `draft-${draft}/scenario.md`, complication: twist };
      save(run, "result.json", result);
      return result;
    }
    revision = `GMの矛盾: ${json(conflicts)}。創発がABSENTなら相手の提案を変えられる接点を作る。前稿と試遊で見えた問題から1点を改稿する。元の約束と余白を保つ。\n前稿: ${json(scenario)}\n講評: ${json(assessment)}\n引用照合: ${cited}。\n参加者の感想: ${json(survey)}`;
  }
  throw new Error("改稿上限が不正です");
}

function continuityBackend(call: Call, previous = "cli") {
  const backend = process.env.TRPG_CONTINUITY_BACKEND ?? previous;
  if (!["cli", "jev"].includes(backend)) throw new Error("TRPG_CONTINUITY_BACKEND は cli または jev です");
  const decide = backend === "jev" ? jevDecision(process.env.TYPESAFE_API_KEY ?? "", process.env.TRPG_JEV_MODEL) : cliDecision(call);
  return { backend, decide };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const [wish, file, durationOrSeed, contextFile] = process.argv.slice(2);
  if (wish === "--audit") {
    if (!file) throw new Error("監査する draft ディレクトリを指定してください");
    const agent = agentName(process.env.TRPG_JUDGE_AGENT ?? process.env.TRPG_AGENT);
    const { decide } = continuityBackend(cli(agent, agent));
    const scenario = JSON.parse(readFileSync(join(file, "scenario.json"), "utf8"));
    const log = JSON.parse(readFileSync(join(file, "session.json"), "utf8"));
    if (!nonempty(scenario.secret) || !Array.isArray(log) || log[0]?.id !== "S0" ||
        !log.every(e => e && nonempty(e.id) && nonempty(e.text))) throw new Error("シナリオまたは公開ログの形式が不正です");
    const checks = await checkContinuity(scenario.secret, log, decide);
    console.log(json(checks));
    process.exitCode = Number(checks.some(c => c.choice !== "OK"));
  } else {
    await runTable(wish, file, durationOrSeed, contextFile);
  }
}

async function runTable(wish?: string, file = "", durationOrSeed?: string, contextFile?: string) {
  const resuming = wish === "--resume";
  const replaying = resuming || wish === "--replay";
  if (replaying && !file) throw new Error("再試遊する draft ディレクトリを指定してください");
  const preset = replaying ? join(dirname(resolve(file)), "table.json") : file || join(import.meta.dirname, "table.json");
  let table = readTable(preset);
  if (!replaying && process.env.TRPG_MECHANICS !== undefined)
    table.mechanics = modules(process.env.TRPG_MECHANICS.split(",").map(s=>s.trim()).filter(Boolean));
  if (!replaying && durationOrSeed) {
    table.minutes = duration(Number(durationOrSeed));
    table.scenes = table.minutes === 30 ? 2 : 4;
  }
  let replay: Record<string, string> | undefined;
  const branch = resuming ? loadBranch(file, Number(durationOrSeed), table.players.length, table.scenes) : undefined;
  const context = contextWith(branch?.context ?? defaultContext, contextFile ? JSON.parse(readFileSync(contextFile,"utf8")) : {});
  if (replaying) {
    if (!resuming) table.seed = Number(durationOrSeed ?? 0);
    if (!Number.isSafeInteger(table.seed) || table.seed < 0) throw new Error("seed は0以上の整数です");
    table.maxRevisions = 0;
    const saved = JSON.parse(readFileSync(join(file, "scenario.json"), "utf8"));
    if (!saved || !scenarioKeys.every(key => nonempty(saved[key]))) throw new Error("シナリオの形式が不正です");
    replay = saved;
  }
  const runs = resolve("runs");
  mkdirSync(runs, { recursive: true });
  const run = mkdtempSync(join(runs, "trpg-"));
  console.log(`卓の記録: ${run}`);
  const modelPath = join(dirname(file),"models.json");
  const prior = resuming && existsSync(modelPath) ? JSON.parse(readFileSync(modelPath,"utf8")) : {};
  const agent = agentName(process.env.TRPG_AGENT ?? prior.agent);
  const judge = agentName(process.env.TRPG_JUDGE_AGENT ?? prior.judge ?? agent);
  const gm = agentName(process.env.TRPG_GM_AGENT ?? prior.gm ?? agent);
  const gmModel = process.env.TRPG_GM_MODEL ?? (prior.gm === gm ? prior.gmModel : undefined);
  try {
    const call = loggedCall(run,cli(agent, judge, gm, gmModel));
    const { backend, decide } = continuityBackend(call, prior.continuity);
    if (!replaying && wish?.trim()) table = file ? { ...table, wish } : await tableFromWish(wish, table, call);
    save(run, "models.json", { agent, judge, gm, gmModel, continuity: backend, ...(branch && { branch:branch.source }), ...(replaying && { replayOf: resolve(file) }) });
    const result = await playtest(table, run, call, replay, decide, context, branch?.point);
    if (result.status !== "READY_FOR_HUMAN") process.exitCode = 1;
  } catch (error) {
    save(run, "result.json", {status: "ERROR", message: String(error)});
    throw error;
  }
}
