import type { Minutes } from "./session.mts";

type Ask = (prompt: string) => Promise<string>;

export type ScenarioRequest = {
  genre: string;
  activity: string;
  detail: string;
  minutes: Minutes;
  wish: string;
};

const genres = ["ミステリ", "脱出ゲーム", "DnD風の冒険", "クトゥルフ的なホラー", "SCP的ホラー", "ダークファンタジー"];
const activities = ["手がかりをつなぐ", "限られた道具で切り抜ける", "仲間と交渉する", "危険な場所を探索する"];

async function choose(ask: Ask, question: string, options: string[], optional = false): Promise<string> {
  const menu = options.map((name, i) => `${i + 1}. ${name}`).join("\n");
  const help = "番号か自由入力。複数なら「、」で区切る" + (optional ? "（空欄でおまかせ）" : "");
  let prompt = `\n${question}\n${menu}\n${help} > `;
  for (;;) {
    const raw = (await ask(prompt)).trim();
    if (!raw && optional) return "";
    const parts = raw.split(/[,、，]/).map(s => s.trim()).filter(Boolean);
    const values = parts.map(s => {
      const number = s.normalize("NFKC");
      return /^\d+$/.test(number) ? options[Number(number) - 1] : s;
    });
    if (values.length && values.every(Boolean)) return [...new Set(values)].join("、");
    prompt = `1〜${options.length}の番号か、好きな言葉で入力してください。 > `;
  }
}

async function askDuration(ask: Ask): Promise<Minutes> {
  let prompt = "\n何分くらいで遊びますか？　30 / 60（空欄で30分） > ";
  for (;;) {
    const value = (await ask(prompt)).trim().normalize("NFKC");
    if (!value || value === "30") return 30;
    if (value === "60") return 60;
    prompt = "30か60を入力してください（空欄で30分）。 > ";
  }
}

export async function interview(ask: Ask, fixedMinutes?: Minutes): Promise<ScenarioRequest> {
  const genre = await choose(ask, "どんなジャンルで遊びたいですか？", genres);
  const activity = await choose(ask, "卓でやってみたいことは？", activities, true);
  const detail = (await ask("\n登場させたい場所や、やってみたい場面はありますか？\n自由入力（空欄でおまかせ） > ")).trim();
  const minutes = fixedMinutes ?? await askDuration(ask);
  const wish = [`遊びたいジャンルは「${genre}」。`, activity && `やりたいことは「${activity}」。`, detail]
    .filter(Boolean).join("\n");
  return { genre, activity, detail, minutes, wish };
}
