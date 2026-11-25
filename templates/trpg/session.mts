export type Call = (role: string, prompt: string, keys: readonly string[]) => Promise<Record<string, string>>;
export type Entry = { id: string; text: string; move?: string };
export type Minutes = 30 | 60;

export function duration(value: unknown): Minutes {
  if (value === 30 || value === 60) return value;
  throw new Error("minutes は30または60を指定してください");
}

export function schedule(minutes: Minutes, scenes: number) {
  const beats = scenes === 2 ? ["一つの場所で依頼と手がかりを共有", "交渉して代償を選び決着"] :
    scenes === 3 ? ["依頼を受ける", "食い違う証言を突き合わせる", "取引と決着"] :
    ["依頼と最初の現場", "別の現場で偏った証言を得る", "証言を持ち寄り条件を交渉", "取引の代償と決着"];
  const available = minutes - 10;
  const perScene = Math.floor(available / scenes);
  return { minutes, briefing: 5, debrief: 5, scenes: beats.map((aim, i) => ({
    aim, minutes: i === scenes - 1 ? available - i * perScene : perScene
  })) };
}

export function designKeys(players: number, scenes: number) {
  return ["npc", ...Array.from({length: players}, (_, i) => [`handout${i+1}`, `win${i+1}`]).flat(),
    ...Array.from({length: scenes}, (_, i) => `beat${i+1}`)];
}

export const roleplayInstructions = `次の一手は、この人物が欲しいものと、相手にどんな選択を渡せるかで選ぶ。善良さの模範解答を探す必要はない。
見栄で先に約束する、情報を懐に置いて取引する、大切な人だけをひいきする、といった身勝手さも演じてよい。協力するなら何を賭けるか、拒むなら何に応じる余地があるかを台詞か行動に出す。理由のない妨害や毎回の逆張りは要らない。`;

export const designInstructions = `npc=NPCの名前・偏った価値判断・譲歩できる条件。handout1等=その席だけが知る手がかりと、損をしてでも通したい個人的なこだわり。
win1等=席順ごとに異なる、達成を観測できる秘密の勝利条件。同じ資源の配分などで交渉を誘い、強制や唯一解を避ける。
beat1等=時間配分に収まる具体的な場所・小道具・打ち切り時にも次へ進める手がかり。短い卓は場所を絞り、長い卓は証言を突き合わせる余地を作る。`;

export const emergenceKeys = ["emergence", "proposal", "response", "consequence", "interaction"] as const;
export const emergenceInstructions = `emergence は OBSERVED または ABSENT。別PCが先行PCの具体的な提案を受けて変更・取引・反転し、
それが世界の帰結に効いた場合のみ OBSERVED。proposal と response はその順の異なるPCの行動ID（AまたはR）、consequence は後のGM描写ID。
interaction は何を拾ってどう変え、何が面白くなったかを1文で。善行・裏切り・仲直り自体には加点せず、相手に生じた選択と実際の応答を根拠にする。単なる同意、同じ手の並行宣言、GMやNPCが示した案の復唱は ABSENT とし、該当しないID欄は NONE。`;

export function emergenceVerified(a: Record<string,string>, log: Entry[]): boolean {
  if (a.emergence === "ABSENT") return true;
  if (a.emergence !== "OBSERVED") return false;
  const seat = (id: string) => /^[AR]\d+\.(\d+)$/.exec(id)?.[1];
  const ids = [a.proposal, a.response, a.consequence];
  const [p,r,c] = ids.map(id => log.findIndex(e => e.id === id));
  return !!seat(a.proposal) && !!seat(a.response) && seat(a.proposal) !== seat(a.response) &&
    /^S\d+$/.test(a.consequence) && p >= 0 && p < r && r < c;
}
