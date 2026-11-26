import { jevChoice } from "../factory/jev.mts";
import { transcript, type Call, type Entry } from "./session.mts";

type Choice = { choice: string; model: string; confidence?: number; probabilities?: Record<string, number> };
export type Decide = (state: string, criteria: Record<string,string>) => Promise<Choice>;
const instructions = "今回のGMが確定事項として述べたことと両立しない、先行する事実のIDを一つ選ぶ。時の経過、明示された状態変化、NPCの虚言・主観、未確定の選択肢は矛盾に数えない。両立すれば OK、判定材料が足りなければ UNKNOWN。";

export function cliDecision(call: Call): Decide {
  return async (state, criteria) => {
    const {choice} = await call("continuity", [instructions, JSON.stringify(criteria), state].join("\n"), ["choice"]);
    return { choice, model: "cli-judge" };
  };
}

export function jevDecision(key: string, model = "jev-latest", request = fetch): Decide {
  return jevChoice(key, "continuity", instructions, model, request);
}

export async function checkContinuity(secret: string, log: Entry[], decide: Decide) {
  const facts: Entry[] = [{id:"CANON",text:secret}];
  const history: Entry[] = [];
  const checks = [];
  for (const current of transcript(log)) {
    if (/^[SD]\d+$/.test(current.id)) {
      const criteria: Record<string,string> = Object.fromEntries(facts.map(f => [f.id,
        f.id === "CANON" ? "シナリオの真相と矛盾" : `公開ログの ${f.id} と矛盾`]));
      Object.assign(criteria, {OK:"両立する", UNKNOWN:"情報不足"});
      const decision = await decide(JSON.stringify({ canon: secret, publicHistory: history, current }), criteria);
      if (!Object.hasOwn(criteria, decision.choice)) throw new Error("矛盾監査の判定が選択肢にありません: " + decision.choice);
      const conflict = facts.find(f => f.id === decision.choice);
      checks.push({ current, ...decision, conflict });
      facts.push(current);
    }
    history.push(current);
  }
  return checks;
}
