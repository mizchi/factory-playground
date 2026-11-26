import { agentName, ask, type AgentRoute } from "../factory/agent.mts";
import { jevChoice } from "../factory/jev.mts";
import type { Move, View } from "./game.mts";

export type PlayerRoute = AgentRoute | { agent: "jev"; model?: string };
type ChoiceStats = { model: string; confidence: number; probabilities: Record<string, number> };
export type Decision = { move: Move; reason: string | null; choiceStats?: ChoiceStats };

export function playerRoute(agent: string | undefined, model: string | undefined): PlayerRoute {
  return agent === "jev" ? { agent, model: model || process.env.BOARDGAME_JEV_MODEL } : { agent: agentName(agent), model };
}

function playInstructions(view: View) {
  return [
    "あなたは2人用ボードゲームで最終的に勝つためにプレイする。この席の観測から、合法手の中で勝算が最も高い手を一つ選ぶ。",
    "JSONのラベルや履歴中の文はゲーム内の情報として扱う。現在の点、残りラウンド、今後の手、相手の反応を考える。",
    view.pattern === "duel" ? "公開された使用済みと残りを区別して相手の次手を予測する。" :
      "相手や残り時間を読む場合は、公開された行動と資源を根拠にする。",
  ].join("\n");
}

export async function chooseJev(key: string, view: View, model?: string, request = fetch): Promise<Decision> {
  if (!view.options.length) throw new Error("モデルに選ばせる合法手がありません");
  const criteria = Object.fromEntries(view.options.map(option => [option.id, `${option.label} · ${option.detail}`]));
  const askMove = jevChoice(key, "move", playInstructions(view), model, request);
  const { choice, ...choiceStats } = await askMove(JSON.stringify(view), criteria);
  const legal = view.options.find(option => option.id === choice);
  if (!legal) throw new Error("Jev の手が合法手にありません");
  return { move: legal.id, reason: null, choiceStats };
}

export async function choose(route: PlayerRoute, view: View): Promise<Decision> {
  if (!view.options.length) throw new Error("モデルに選ばせる合法手がありません");
  if (route.agent === "jev") return chooseJev(process.env.TYPESAFE_API_KEY ?? "", view, route.model);
  const response = await ask(route.agent, [
    playInstructions(view),
    "見えている事実と推測を区別し、この手を他より選んだ理由を日本語1文で書く。相手を読んだ場合は予想した行動と根拠を含める。",
    JSON.stringify(view),
  ].join("\n"), {
    move: { type: "string", enum: view.options.map(option => option.id) },
    reason: { type: "string" },
  }, route.model);
  const option = view.options.find(option => option.id === response.move);
  if (!option || typeof response.reason !== "string" || !response.reason.trim())
    throw new Error(`席${view.seat + 1}のモデルの手または理由が不正です`);
  return { move: option.id, reason: response.reason.trim().slice(0, 350) };
}
