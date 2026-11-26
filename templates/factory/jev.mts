export function jevChoice(key: string, question: string, instructions: string, model = "jev-latest", request = fetch) {
  if (!key.trim()) throw new Error("Jev の利用には TYPESAFE_API_KEY が必要です");
  return async (state: string, criteria: Record<string, string>) => {
    const response = await request("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions: { [question]: { type: "choice", instructions, criteria } } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
    const data = await response.json();
    const answer = data.answers?.[question];
    const probability = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1;
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" ||
        !Object.hasOwn(criteria, answer.choice) || !probability(answer.confidence) || !answer.probabilities ||
        !Object.keys(criteria).every(id => probability(answer.probabilities[id])) || typeof data.model !== "string")
      throw new Error("Jev Choice 応答の形式が不正です");
    return {
      model: data.model as string,
      choice: answer.choice as string,
      confidence: answer.confidence as number,
      probabilities: Object.fromEntries(Object.keys(criteria).map(id => [id, answer.probabilities[id] as number])),
    };
  };
}
