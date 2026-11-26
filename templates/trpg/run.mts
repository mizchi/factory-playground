import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentName, askTextFields, type Agent } from "../factory/agent.mts";

import { designInstructions, designKeys, duration, emergenceInstructions, emergenceKeys, emergenceVerified, roleplayInstructions, transcript, type Call, type Entry, type Minutes } from "./session.mts";
import { checkContinuity, cliDecision, jevDecision, type Decide } from "./continuity.mts";

import { contextWith, defaultContext, gmView, loadBranch, loggedCall, saveCheckpoint, type Context, type Checkpoint } from "./checkpoint.mts";

import { modules, design, rulesFrom, initial, choices, resolveMove, ruleSheet, type Module } from "./rpg.mts";

import { cueKeys, makeGuide, principles, selectSources } from "./design-guide.mts";

import { seatNumber, type HumanSeat, type SeatView } from "./human.mts";
import { PlayInterrupted, terminalSeat } from "./tui.mts";

import { designTargets, judgeMetricKeys, reviewInstructions, reviewMetrics } from "./quality.mts";

import { experienceEvidenceKeys, rubricVersion, type MetricReading } from "./experience.mts";
import { terminalInput, type TerminalInput } from "./terminal-input.mts";
import { interview } from "./interview.mts";

import { harbor, patternId, patterns, playSchedule, type Focus, type Pattern, type World } from "./patterns.mts";
import { previousFocus, runPatternSeries } from "./pattern-focus.mts";
import { seatCriteria, seatKeys, seatMetrics, seatSurveyInstructions, trialSummary } from "./seat-review.mts";

type Player = { name: string; desire: string };
export type Table = { wish: string; promise: string; openQuestion: string; lens?: string; players: Player[];
  world?:World; pattern?:Pattern; focus?:Focus[]; designSources?: string[]; mechanics?: Module[]; minutes?: Minutes; complications: string[]; scenes: number; seed: number; maxRevisions: number };
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
  if (t.world !== undefined && (!t.world || !nonempty(t.world.name) || !Array.isArray(t.world.facts) || !t.world.facts.every(nonempty) || !nonempty(t.world.open))) throw new Error("world の name・facts・open を確認してください");
  if (t.pattern !== undefined) patternId(t.pattern);
  if (t.focus !== undefined && (!Array.isArray(t.focus) || !t.focus.every((f:Focus)=>f && nonempty(f.source) && Number.isInteger(f.draft) && f.draft>0 && nonempty(f.criterion) && nonempty(f.instruction)))) throw new Error("focus の元の卓・稿・項目・指針を確認してください");
  modules(t.mechanics);
  selectSources(t.designSources);
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


const castKeys = ["promise","openQuestion","name1","desire1","name2","desire2","lens"];
const castInstructions = "promise は守る体験、openQuestion は遊ぶ人に委ねる問い。name1/desire1、name2/desire2 は席順にPC名と望み。lens はこの依頼独自の評価観点。";
function castTable(wish:string, defaults:Table, b:Record<string,string>):Table {
  if (!castKeys.every(k=>nonempty(b[k])) || b.name1 === b.name2) throw new Error("PC名・望み・卓の約束を確認してください");
  return {...defaults,wish,promise:b.promise,openQuestion:b.openQuestion,lens:b.lens,
    players:[{name:b.name1,desire:b.desire1},{name:b.name2,desire:b.desire2}]};
}
export async function tableFromWish(wish:string, defaults:Table, call:Call) {
  const b=await call("brief",`人間のプレイ時間は${defaults.minutes ?? (defaults.scenes===2 ? 30 : 60)}分。遊びたい卓: ${wish}。
${castInstructions}`,castKeys);
  return castTable(wish,defaults,b);
}
const scenarioKeys = ["title", "opening", "secret", "clues", "routes", "ending"] as const;
export async function playtest(t: Table, run: string, call: Call, savedScenario?: Record<string, string>, decide: Decide = cliDecision(call),
    context: Context = defaultContext, checkpoint?: Checkpoint, human?:HumanSeat, freshWish?:string) {
  if (human) {
    seatNumber(String(human.seat), t.players.length);
    t = {...t,maxRevisions:0};
  }
  const minutes = duration(t.minutes ?? (t.scenes === 2 ? 30 : 60));
  const pace = playSchedule(minutes, t.minutes === undefined ? t.scenes : minutes === 30 ? 2 : 4, t.pattern);
  const sources = selectSources(t.designSources);
  const extras = designKeys(t.players.length, pace.scenes.length);
  const active = modules(t.mechanics);
  const parameters = design(active,pace.scenes.length);
  const mechanicsBrief = active.length ? "\n次の公開ルールを本文・ハンドアウトにも適用する。PCは各場面で1手。交渉・待機は無料で位置は変わらない。地図使用時は順路を1手で1区間歩ける。障害突破（地図では入口⇄目的地の近道）はHPか共有品の支払いでのみ成立する。使うルール: "+active.join(",")+"。消耗品は移動せず本来の用途に使っても1回分減る。追加の資源・共有手数・個別の判定や料金を作らない。設定欄: "+json(parameters) : "";
  save(run, "context.json", context);
  const history = [];
  const mode = human ? "human" : checkpoint ? "resume" : savedScenario ? (t.maxRevisions ? "refine" : "replay") : freshWish ? "fresh" : "preset";
  let revision = "";
  for (let draft = 1; draft <= 1 + t.maxRevisions; draft++) {
    const replay = draft === 1 ? savedScenario : undefined;
    const dir = join(run, `draft-${draft}`);
    mkdirSync(dir);
    console.log(`第${draft}稿: ${replay ? "保存したシナリオで再試遊" : "シナリオ作成"}`);
    const newCast = draft === 1 && !!freshWish && !replay;
    const authorBrief = newCast ? {wish:freshWish,world:t.world,pace} : {wish:t.wish,promise:t.promise,openQuestion:t.openQuestion,players:t.players,world:t.world,pace};
    const casting = newCast ? castInstructions+" twist はこの物語固有の揺らぎカードを1枚。ハンドアウトと各席の勝利条件も同時に設計する。" : "";
    let scenario = replay ?? await call("author", `日本語で短い${active.length ? "補助ルール付きの" : "システム不要の"}1話TRPGを書く。各欄は簡潔に。${casting}
シナリオ設計の参照資料（卓に合う原則を適用する）:
${principles(sources)}
試遊後の共通評価項目（本文に採点を書かず、遊ぶ人が判断できる状況を用意する）:
${designTargets}
${designInstructions}${mechanicsBrief}\n${json(authorBrief)}
${t.focus?.length ? "前の試遊から今回も点検すること："+t.focus.map(f=>f.instruction).join(" ") : ""}
worldNotes=この卓で使う既存設定、今回だけ補う公開事実、プレイヤーに委ねる未定事項を各一言。GMの真相や個別手札は含めない。30分なら、追加する制度や例外を増やす前に、いまある設定で二人が違う手を選べるか確かめる。決断に使う制度・習慣は行動前に具体物で見せる。時刻や量が途中で変わるなら、変化前の見込みを導入でPCに知らせる。説明だけの沿革は削る。world指定時は既知の事実を保ち、openの答えを決めない。今回、行動に関係する既存設定だけを前景に置き、使わない慣習は背景に残す。たとえば帰路を探る依頼なら、橋の規則が道を変えるだけでよい。結末で何をするかはお題から決める。
title=題名、opening=卓で読む導入（手がかりを1つ見せる）、secret=GMだけが知る意外な真相、clues=真相を推測できる別々の手がかりを用意する。${sources.some(s => s.id === "clues") ? "進行に必須の推理には独立した手がかりを3つ以上置く。" : ""}、routes=人物の望みと少なくとも2通りの選択・代償、ending=異なる結末の条件とGMの進行メモ。作者の余白 openQuestion の答えを代筆しない。\n${revision}`,
      [...scenarioKeys, "worldNotes", ...extras, ...Object.keys(parameters), ...(newCast ? [...castKeys,"twist"] : [])]);
    if (newCast && freshWish) {
      t={...castTable(freshWish,t,scenario),complications:[scenario.twist]};
      scenario=Object.fromEntries(Object.entries(scenario).filter(([k])=>!castKeys.includes(k) && k!=="twist"));
    }
    if (draft===1) save(run,"table.json",t);
    const cast=t.players.map(p=>p.name);
    const brief={wish:t.wish,promise:t.promise,openQuestion:t.openQuestion,cast,world:t.world,worldNotes:scenario.worldNotes,pace};
    const twist=t.seed===0 ? "" : t.complications[(t.seed-1)%t.complications.length];
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
    const cues = cueKeys(pace.scenes.length);
    const scripted = context.gm.direction === "scripted" || (context.gm.direction === undefined && cues.every(k=>nonempty(scenario[k])));
    const missingCues = scripted && cues.some(k=>!nonempty(scenario[k])) ? cues : [];
    const guideSources = replay ? [] : sources;
    if (guideSources.length || missingCues.length) {
      const guide = await makeGuide(call,guideSources,{...brief,title:scenario.title,opening:scenario.opening,publicRules:sheet},missingCues);
      scenario = {...scenario,...guide};
    }
    const stagePage = scripted ? "\n\n## GMの演出台本\n\n"+cues.map((k,i)=>`### 場面${i+1}\n\n${scenario[k]}`).join("\n\n") : "";
    const worldPage = scenario.worldNotes ? "\n\n## 今回使う世界設定\n\n"+scenario.worldNotes : "";
    const guidePage = scenario.gmReferences ? "\n\n## GMの進行ガイドライン\n\n"+(scenario.gmGuidelines || "選択した資料から、この卓に適用する追加指針はありません。")+"\n\n### 設計資料\n\n"+scenario.gmReferences : "";
    const publicRules = () => rules ? "\n公開ルール（席順 "+cast.join("、")+"、位置は入口を0とする）: "+sheet+"\n現在値: "+json(state) : "";
    const packets = t.players.map((player,i) => ({ ...player, clue: scenario[`handout${i+1}`], win: scenario[`win${i+1}`] }));
    if (new Set(packets.map(p => p.win.trim())).size !== packets.length) throw new Error("PCの勝利条件が重複しています");
    mkdirSync(join(dir, "handouts"));
    packets.forEach((packet,i) => save(join(dir, "handouts"), `pc-${i+1}.json`, packet));
    const agenda = pace.scenes.map((beat,i) => `- ${beat.minutes}分　${beat.aim}。
  ${scenario[`beat${i+1}`]}`);
    save(dir, "scenario.json", scenario);
    writeFileSync(join(dir, "scenario.md"), `# ${scenario.title}\n\n## 配役と約束\n\n${t.promise}\n\n${t.players.map(p => "- **" + p.name + "**　" + p.desire).join("\n")}\n\n## 卓で読む導入\n\n${scenario.opening}\n\n${rules ? "## 公開ルール\n\n"+sheet+"\n\n" : ""}## GM用\n\n${scenario.secret}\n\n${scenario.clues}\n\n${scenario.routes}\n\n${scenario.ending}\n\nNPCの演じ方　${scenario.npc}${worldPage}${guidePage}${stagePage}\n\n## ${minutes}分卓の進行\n\n導入5分、感想5分。\n${agenda.join("\n")}\n\nPCが行動を宣言し、GMが結果を伝える。${twist ? "最初の場面の末に公開するカード: " + twist : "今回は揺らぎカードを使わない。"} 最終場面の前に代償の違う案を問い、第三案を含め、全員の最終案を聞く。先に話した席には一度ずつ相手の案に応答する機会を渡してから、結末を描く。\n\n## 卓に残す問い\n\n${t.openQuestion}\n`);
    const actionBrief = human ? " brief にはその公開行動だけを、誰が何をしたか、話し言葉の短い1文で書く（目安40字）。「同行を要請」なら「一緒に来てほしいと頼んだ」のように動詞で伝える。手札や予想を含めない。" : "";
    const actionKeys = human ? ["action","brief"] : ["action"];
    const checkpointDir = join(dir,"checkpoints");
    mkdirSync(checkpointDir);
    const publicLog: Entry[] = checkpoint ? [...checkpoint.publicLog] : [{ id: "S0", text: scenario.opening }];
    if (rules && state && checkpoint) {
      for (const event of publicLog) {
        const action = /^A\d+\.(\d+)$/.exec(event.id);
        if (action) resolveMove(rules,state,Number(action[1])-1,event.move ?? "");
      }
    }
    const predictions: (string|null)[][] = checkpoint ? checkpoint.predictions.map(p => [...p]) : t.players.map(() => []);
    function seatView(i:number,turn:number):SeatView {
      return structuredClone({draft,turn,seat:i+1,title:scenario.title,promise:t.promise,question:t.openQuestion,
        cast,handout:packets[i],events:publicLog,rules,state});
    }
    function publish(turn:number,event:Entry) {
      publicLog.push(event);
      if (human?.observe) human.observe(seatView(human.seat-1,turn));
    }
    if (human?.observe) human.observe(seatView(human.seat-1,checkpoint?.turn ?? 1));
    for (let turn = checkpoint?.turn ?? 1; turn <= pace.scenes.length; turn++) {
      console.log(`第${draft}稿: 場面 ${turn}/${pace.scenes.length}`);
      const ending = turn === pace.scenes.length;
      const offerChoice = turn === pace.scenes.length - 1;
      if (turn !== checkpoint?.turn) {
        const npc = await call("npc", `次の人物を日本語で演じる。人物メモ: ${scenario.npc}。${publicRules()}公開ログ: ${json(transcript(publicLog))}。卓の約束: ${t.promise}。${roleplayInstructions} 台詞または行動を一つ。偏りが出てもPCの反応や世界の結果を決めない。${actionBrief}`, actionKeys);
        publish(turn,{id: `N${turn}`, text: npc.action, ...(npc.brief && {brief:npc.brief})});
        for (let offset = 0; offset < packets.length; offset++) {
          const i = (turn - 1 + offset) % packets.length;
          const player = packets[i];
          const menu = rules && state ? choices(rules,state,i) : [];
          const movePrompt = menu.length ? publicRules()+"\n選べる行動: "+json(menu.map(({code,label})=>({code,label})))+"。move に code を一つそのまま書き、action はその行動に沿って宣言する。" : "";
          const humanTurn = human?.seat === i+1;
          const reply = humanTurn ? await human.act(seatView(i,turn),menu.map(({code,label})=>({code,label}))) : await call("player", `あなたはPC「${player.name}」。自分のハンドアウト: ${json(player)}。自分の過去の予想: ${json(predictions[i])}。ほかのPC: ${cast.filter(n => n !== player.name).join("、")}。\n遊びたい体験: ${t.wish}\n約束: ${t.promise}\n卓に残された問い: ${t.openQuestion}\n公開ログ: ${json(transcript(publicLog))}
  ${roleplayInstructions}${movePrompt}${actionBrief}
  日本語で prediction に次に起こると思うことを1文、action に自分の台詞か行動を1つ書く。GMの結果を決めない。${ending ? "直前に示された決断への自分の答えを action に書く。別案や保留も選べる。" : ""}`, ["prediction",...actionKeys,...(menu.length ? ["move"] : [])]);
          if (!nonempty(reply.action)) throw new Error("行動を入力してください");
          const prediction = "prediction" in reply ? reply.prediction : null;
          if (!humanTurn && !nonempty(prediction)) throw new Error("PCモデルの予想が空です");
          predictions[i].push(humanTurn ? null : prediction);
          const effect = rules && state ? resolveMove(rules,state,i,reply.move ?? "") : "";
          publish(turn,{ id: `A${turn}.${i+1}`, text: player.name + "「" + reply.action + "」" + (effect ? " ルール結果: "+effect : ""), ...("brief" in reply && typeof reply.brief === "string" && {brief:reply.brief}), ...(effect && {move:reply.move}), ...(humanTurn && {controller:"human" as const}) });
        }
        if (ending) {
          // The last speaker has heard every proposal. Give the earlier seats one reply each.
          for (let offset = 0; offset < packets.length - 1; offset++) {
            const i = (turn - 1 + offset) % packets.length;
            const humanTurn = human?.seat === i+1;
            const reply = humanTurn ? {action:await human.reply(seatView(i,turn))} : await call("reply", `あなたはPC「${packets[i].name}」。自分のハンドアウト: ${json(packets[i])}。自分の過去の予想: ${json(predictions[i])}。公開ログ: ${json(transcript(publicLog))}
  卓の約束: ${t.promise}。${roleplayInstructions}
  ${rules ? publicRules()+"この応答は会話のみで、追加の移動や支払いは行わない。" : ""}全員の案を聞いた後の最後の応答を一つ。どの提案を受け入れるか、修正するか、自案を維持するかはあなたが決める。他のPCの同意を代筆しない。${actionBrief}`, actionKeys);
            if (!nonempty(reply.action)) throw new Error("応答を入力してください");
            publish(turn,{ ...(humanTurn && {controller:"human" as const}), id: `R${turn}.${i+1}`, ...("brief" in reply && typeof reply.brief === "string" && {brief:reply.brief}), text: packets[i].name + "「" + reply.action + "」" });
          }
        }
      }
      save(dir, "predictions.json", predictions);
      saveCheckpoint(checkpointDir,{version:1,turn,publicLog,predictions});
      const view = gmView(scenario,publicLog,turn,context);
      const shortScene = human ? " brief は今回公開する描写の要点だけ。何が起きて今どうなったかを、目に浮かぶ簡単な言葉で1文にする（目安45字）。名詞の羅列を避ける。"+(offerChoice ? " questionBrief は今決める選択と代償が分かる短い問いを1文で。" : "") : "";
      const scene = await call("gm", `あなたはこの卓のGM。この場面の進行: ${json(pace.scenes[turn-1])}。\n創作依頼: ${json(brief)}\nGM用シナリオ: ${json(view.scenario)}\n${scenario.gmGuidelines ? "この卓で従うGMガイドライン:\n"+scenario.gmGuidelines+"\n" : ""}${scripted ? "この場面の演出台本（GM専用）。例文は今の行動に合わせて変える。確定した事実と食い違う箇所は使わない。\n"+scenario[cues[turn-1]]+"\n" : ""}GMに渡されたメタ情報: ${json(view.metadata)}\nGM向けメモ: ${view.notes}${rules ? publicRules()+"。行動のルール結果と現在値は確定済み。use / use-here が支払い済みの行動。stay・会話・最後の応答で新たに道具を消費したことにしない。残った物と失った物が伝わるように裁定する。" : ""}\n公開ログ: ${json(transcript(view.events))}
${turn === 1 && twist ? "この場面の末尾で次の変化を公開し、次の手をPCが選べるようにする: " + twist : ""} 各PCの行動の結果を、世界の事情と相手の利害から具体化する。善行へのご褒美や身勝手さへのお仕置きを自動的に足さない。PCの台詞や選択を代筆しない。\n${ending ? "今回が最終場面。最後の各PCの明示した決断から結果を描く。両立しない提案が出たら、誰のどの案に世界やNPCがどう応じたかを、双方の席から追えるようにする。意見が分かれたら分かれたままの帰結を示し、語り手が多数決や合意を捏造しない。" : "世界の反応と手がかりを示し、次に何をするかPCに尋ねる。"} 公開する描写を narration に日本語3文以内で。${shortScene}${offerChoice ? "別欄 decision に、約束に直結する最後の決断を今ここで全PCに問う。各案が残り1手で実行できる位置・代償を確かめ、選び方とともに明示する。作者の約束にある選択とPCの別案を残す。作者が空けた答えを先取りしない。" : ""}`, ["narration",...(offerChoice ? ["decision"] : []),...(human ? ["brief"] : []),...(human && offerChoice ? ["questionBrief"] : [])]);
      publish(turn,{ id: `S${turn}`, text: scene.narration, ...(scene.brief && {brief:scene.brief}) });
      if (offerChoice) publish(turn,{ id: `D${turn}`, text: scene.decision, ...(scene.questionBrief && {brief:scene.questionBrief}) });
      save(dir, "session.json", publicLog);
    }
    if (rules) save(dir,"mechanics.json",{rules,state});
    const survey = await Promise.all(t.players.map(async (p, i) => ({
      name: p.name, controller:human?.seat === i+1 ? "human" : "model", ...(human?.seat === i+1 ? { ...await human.survey(seatView(i,pace.scenes.length))} : await call("survey", `あなたは${p.name}。自分のハンドアウト: ${json(packets[i])}。victoryに自分の勝利条件がどうなったかを書く。自分の事前予想: ${json(predictions[i])}。\n公開ログ: ${json(transcript(publicLog))}\n約束: ${t.promise}。この席を担当したプレイヤーとして遊んだ感想を独立に答える。役の勝ち負けと遊んだ体験を区別する。surprise=事前予想がどこで外れたか（当たった場合も正直に）、agency=どの選択が効いたか。
${seatSurveyInstructions}
各1文。迎合せず、具体的な場面IDを挙げる。`,
        ["satisfaction", "surprise", "fairness", "agency", "victory", "tension", "challenge"]))
    })));
    save(dir, "survey.json", survey);
    const checks = await checkContinuity([...(t.world?.facts ?? []),scenario.secret].join("\n"), publicLog, decide);
    save(dir, "continuity.json", checks);
    const stockAudit = rules?.item ? " stockConflict に、共有品を使った描写と実際の消費が食い違う最初のGM描写ID（S番号）を返す。全場面で一致すれば NONE。use と use-here はどちらも1回消費する。PCの希望とGMが描いた結果を区別し、食い違えば change に内容を書く。" : "";
    const assessment = await call("judge", `独立した試遊編集者として日本語で評価。人間の満足度は推測しない。設定の設計意図はworldNotes、既存設定はworldにある。採点は試遊の公開発言で確かめる。作者の約束: ${json(brief)}\n公開ログ: ${json(transcript(publicLog))}\n各PCの事前予想（null は未収集）: ${json(predictions)}\n個別感想: ${json(survey)}${rules ? publicRules()+"。agencyには、制約を前に誰が何を諦めたか公開ログの行動IDで挙げる。選択に影響しなければそう書く。" : ""}
${emergenceInstructions}${stockAudit}
${reviewInstructions}
人間席に表示した短文: ${json(publicLog.filter(e=>e.brief).map(e=>[e.id,e.brief]))}
promise=約束と作者の余白が実際に守られたか、payoff=意外性が先に出た手がかりで説明できたか、agency=選択で結末が変わった具体例、satisfaction=感想の一致と食い違い。各1文。payoff に前後2場面のIDを挙げ、予想どおりでも満足した場合と約束を外した場合を区別する。${t.lens ? "追加の観点も講評に反映する: " + t.lens : ""} 結末に驚いただけでは高評価にしない。evidenceId と quote に最も判定を左右した公開ログ1件のIDと、その text からの連続した原文を入れる。status は READY または REVISE。READY は人間の試遊に回せるという意味。約束を破った・選択が効かなかった・結末を説明できないときは REVISE、change に次稿で変える1点を書く。`,
      ["promise", "payoff", "agency", "satisfaction", "evidenceId", "quote", "status", "change", ...emergenceKeys, ...judgeMetricKeys, ...experienceEvidenceKeys, ...(stockAudit ? ["stockConflict"] : [])]);
    const cited = publicLog.some(e => e.id === assessment.evidenceId && nonempty(assessment.quote) && e.text.includes(assessment.quote));
    const interactionVerified = emergenceVerified(assessment, publicLog);
    const conflicts = checks.filter(check => check.conflict);
    const unresolved = checks.some(check => check.choice === "UNKNOWN");
    const stockConsistent = !stockAudit || assessment.stockConflict === "NONE";
    const stockCited = stockConsistent || publicLog.some(e => /^S\d+$/.test(e.id) && e.id === assessment.stockConflict);
    const metrics:Record<string,MetricReading> = {...reviewMetrics(assessment,publicLog), ...seatMetrics(survey,publicLog)};
    const readings=Object.values(metrics);
    const grounded = readings.every(m=>m.status!=="UNVERIFIED") && stockCited && cited && interactionVerified && !unresolved && ["READY", "REVISE"].includes(assessment.status);
    const ready = grounded && readings.every(m=>m.status==="PASS") && stockConsistent && assessment.status === "READY" && assessment.emergence === "OBSERVED" && conflicts.length === 0;
    const status=!grounded ? "CHECK_ASSESSMENT" : ready ? "READY_FOR_HUMAN" : "NEEDS_EDIT";
    history.push({draft,status,metrics,emergence:assessment.emergence,stockConflict:assessment.stockConflict,
      continuity:checks.map(c=>({id:c.current.id,choice:c.choice})),editor:assessment.status});
    save(run,"quality.json",{rubricVersion,wish:t.wish,pattern:t.pattern,mode,history});
    save(dir, "assessment.json", { ...assessment, citationVerified: cited, interactionVerified, unresolved, conflicts });
    console.log(trialSummary(metrics));
    console.log(`体験の判定 ${metrics.playExperience.status}　${metrics.playExperience.note}`);
    console.log(`第${draft}稿: ${!grounded ? "講評を要確認" : ready ? "人間の試遊へ" : "要改稿"} (${assessment.evidenceId})`);
    if (status === "NEEDS_EDIT") {
      const failures = Object.entries(metrics).filter(([,m]) => m.status === "FAIL").map(([metric,m]) => ({
        metric, note:m.note, ...(m.responses && {responses:m.responses}), evidence:m.trace ?? publicLog.find(e=>e.id===m.evidence)
      }));
      if (assessment.emergence === "ABSENT") {
        const finalTurn = pace.scenes.length;
        const declarations = publicLog.filter(e => e.id.startsWith(`A${finalTurn}.`) || e.id.startsWith(`R${finalTurn}.`));
        failures.push({metric:"emergence", note:"相手の提案を受けて自分の手を選び直せる材料や取引条件を、最終決定の前に渡す。PCの返事は台本に書かない。",
          evidence:declarations.map(e => ({id:e.id,quote:e.text}))});
      }
      for (const check of conflicts) {
        failures.push({metric:"continuity", note:`${check.current.id} の描写を先行する ${check.choice} の事実と両立させる。`, evidence:check.current});
      }
      if (!stockConsistent) failures.push({metric:"stockConflict",note:"共有品の消費とGMの描写を一致させる。",
        evidence:publicLog.find(e=>e.id===assessment.stockConflict)});
      const feedback = {failures, twist, ...(metrics.playExperience.status === "PASS" && {preserveExperience: metrics.playExperience}),
        conflicts, interaction:assessment.interaction,
        change:assessment.status === "READY" && failures.length ? failures[0].note : assessment.change,
        editorialEvidence:{id:assessment.evidenceId,quote:assessment.quote}};
      save(dir, "revision.json", feedback);
      const previousScenario = Object.fromEntries(Object.entries(scenario).filter(([k])=>!["gmGuidelines","gmReferences",...cues].includes(k)));
      revision = `前稿の約束・配役・成功した選択を保ち、次の未達に効く箇所を改稿する。別の物語に差し替えない。
前稿: ${json(previousScenario)}
試遊結果: ${json(feedback)}`;
    }
    if (status !== "NEEDS_EDIT" || draft > t.maxRevisions) {
      const result = { status, draft, scenario: `draft-${draft}/scenario.md`, complication: twist,
        ...(status === "NEEDS_EDIT" && {nextEdit:`draft-${draft}/revision.json`}) };
      save(run, "result.json", result);
      return result;
    }

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
    const tablePath = join(dirname(resolve(file)), "table.json");
    const facts = existsSync(tablePath) ? readTable(tablePath).world?.facts : undefined;
    const checks = await checkContinuity([...(facts ?? []), scenario.secret].join("\n"), log, decide);
    console.log(json(checks));
    process.exitCode = Number(checks.some(c => c.choice !== "OK"));
  } else if (wish === "--ratings") {
    if (!file) throw new Error("感想を確認する draft ディレクトリを指定してください");
    const read = (name:string) => JSON.parse(readFileSync(join(file,name),"utf8"));
    const log = read("session.json");
    const {settingDepth} = reviewMetrics(read("assessment.json"),log);
    const metrics = {settingDepth,...seatMetrics(read("survey.json"),log)};
    console.log(trialSummary(metrics));
    console.log("設定量　"+settingDepth.note);
    for (const key of seatKeys) console.log(seatCriteria[key].label+"　"+metrics[key].note);
  } else if (wish === "--series") {
    const rows = await runPatternSeries(async (id, previous) => {
      const dir = await runPattern(id, file || "30", previous);
      const {draft,status} = JSON.parse(readFileSync(join(dir,"result.json"),"utf8"));
      return {run:relative(process.cwd(),dir),draft,status};
    });
    console.table(rows);
  } else if (wish === "--pattern") {
    await runPattern(patternId(file), durationOrSeed, contextFile);
  } else {
    await runTable(wish, file, durationOrSeed, contextFile);
  }
}

async function runPattern(id:Pattern, minutes?:string, previous?:string) {
  const focus = previous ? previousFocus(previous) : [];
  console.log(`パターン ${id}　${focus.length ? "前の卓から点検する項目 "+focus.map(f=>f.criterion).join("、") : "共通の基準で開始"}`);
  return runTable(patterns[id], "", minutes, undefined, {id,focus});
}

async function runTable(wish?: string, file = "", durationOrSeed?: string, contextFile?: string, experiment?: {id:Pattern; focus:Focus[]}) {
  const liveDemo = wish === "--live-demo";
  const resuming = wish === "--resume";
  const refining = wish === "--refine";
  const replaying = resuming || refining || wish === "--replay";
  if (replaying && !file) throw new Error("再試遊する draft ディレクトリを指定してください");
  const preset = replaying ? join(dirname(resolve(file)), "table.json") : file || join(import.meta.dirname, "table.json");
  let table = readTable(preset);
  if (experiment) table = {...table, pattern:experiment.id, world:harbor, focus:experiment.focus};
  if (!replaying && process.env.TRPG_MECHANICS !== undefined)
    table.mechanics = modules(process.env.TRPG_MECHANICS.split(",").map(s=>s.trim()).filter(Boolean));
  if (!replaying && durationOrSeed) {
    table.minutes = duration(Number(durationOrSeed));
    table.scenes = table.minutes === 30 ? 2 : 4;
  }
  let replay: Record<string, string> | undefined;
  const branch = resuming ? loadBranch(file, Number(durationOrSeed), table.players.length, table.scenes) : undefined;
  const savedContext = join(dirname(resolve(file)), "context.json");
  let baseContext = branch?.context ?? defaultContext;
  if (!resuming && replaying && existsSync(savedContext)) {
    const priorContext = contextWith(defaultContext,JSON.parse(readFileSync(savedContext,"utf8")));
    baseContext = refining ? priorContext : contextWith(defaultContext,{gm:{direction:priorContext.gm.direction}});
  }
  const context = contextWith(baseContext, contextFile ? JSON.parse(readFileSync(contextFile,"utf8")) : {});
  if (replaying) {
    if (!resuming && !refining) table.seed = Number(durationOrSeed ?? 0);
    if (!Number.isSafeInteger(table.seed) || table.seed < 0) throw new Error("seed は0以上の整数です");
    table.maxRevisions = refining ? Number(durationOrSeed ?? 1) : 0;
    if (refining && ![1, 2].includes(table.maxRevisions)) throw new Error("改稿上限は1か2を指定してください");
    const saved = JSON.parse(readFileSync(join(file, "scenario.json"), "utf8"));
    if (!saved || !scenarioKeys.every(key => nonempty(saved[key]))) throw new Error("シナリオの形式が不正です");
    replay = saved;
  }
  const runs = resolve("runs");
  mkdirSync(runs, { recursive: true });
  const run = mkdtempSync(join(runs, "trpg-"));
  console.log(`卓の記録: ${liveDemo ? relative(process.cwd(), run) : run}`);
  const modelPath = join(dirname(file),"models.json");
  const prior = resuming && existsSync(modelPath) ? JSON.parse(readFileSync(modelPath,"utf8")) : {};
  const agent = agentName(process.env.TRPG_AGENT ?? prior.agent);
  const judge = agentName(process.env.TRPG_JUDGE_AGENT ?? prior.judge ?? agent);
  const gm = agentName(process.env.TRPG_GM_AGENT ?? prior.gm ?? agent);
  const gmModel = process.env.TRPG_GM_MODEL ?? (prior.gm === gm ? prior.gmModel : undefined);
  let input: TerminalInput | undefined;
  let human: ReturnType<typeof terminalSeat> | undefined;
  try {
    const humanSetting = (refining || experiment) ? undefined : liveDemo ? "1" : process.env.TRPG_HUMAN_SEAT;
    const selectedSeat = humanSetting === undefined ? undefined : seatNumber(humanSetting, file ? table.players.length : 2);
    const guided = liveDemo || wish === "--interview" || (process.stdin.isTTY && !wish?.trim() && !file);
    if (guided || selectedSeat) input = terminalInput();
    if (guided && input) {
      console.log("遊びたい卓について教えてください。途中でやめるには /quit を入力してください。");
      if (liveDemo) console.log("生成が終わると物語が始まります。会場のみんなで一人の登場人物を動かします。");
      const answers = await interview(input.readLine, durationOrSeed ? table.minutes : undefined, liveDemo ? "live-demo" : "standard");
      wish = answers.wish;
      table = { ...table, minutes: answers.minutes, scenes: answers.minutes === 30 ? 2 : 4 };
      save(run, "interview.json", answers);
      console.log(`\n${answers.genre}・${answers.minutes}分の卓を生成します。`);
    }
    const freshWish = !file ? wish?.trim() || table.wish : undefined;
    if (selectedSeat && input) human = terminalSeat(selectedSeat, input, process.stdout, liveDemo ? "audience" : "player");
    const call = loggedCall(run,cli(agent, judge, gm, gmModel));
    const { backend, decide } = continuityBackend(call, prior.continuity);
    if (!replaying && file && wish?.trim()) table = {...table,wish};
    save(run, "models.json", { agent, judge, gm, gmModel, ...(human && { humanSeat:human.seat }), continuity: backend, ...(branch && { branch:branch.source }), ...(replaying && { replayOf: resolve(file) }) });
    const result = await playtest(table, run, call, replay, decide, context, branch?.point, human, freshWish);
    if (result.status !== "READY_FOR_HUMAN") process.exitCode = 1;
  } catch (error) {
    if (error instanceof PlayInterrupted) {
      save(run,"result.json",{status:"INTERRUPTED",message:error.message});
      console.log(human ? "試遊を中断しました。保存済みのチェックポイントがあれば再開できます。" : "質問を終了しました。シナリオの生成前に中断しました。");
      process.exitCode=130;
      return run;
    }
    save(run, "result.json", {status: "ERROR", message: String(error)});
    if (liveDemo) {
      console.error("ライブデモが停止しました。進行役は非共有の端末で卓の result.json を確認してください。収録卓は just trpg-demo で開けます。");
      process.exitCode = 1;
      return run;
    }
    throw error;
  } finally {
    input?.close();
  }
  return run;
}
