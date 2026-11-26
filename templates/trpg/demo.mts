import { readFileSync } from "node:fs";

// The projector uses only the reviewed, bundled session, even when live runs exist.
const file = new URL("./examples/moon/draft-1/session.json", import.meta.url);
const events: { id: string; text: string }[] = JSON.parse(readFileSync(file, "utf8"));
const scenes = {
  opening: ["S0"],
  choice: ["S1", "D1"],
  ending: ["A2.1", "A2.2", "S2"]
} as const;
const scene = process.argv[2] ?? "opening";
if (scene !== "opening" && scene !== "choice" && scene !== "ending") {
  console.error("場面を opening、choice、ending から選んでください。");
  process.exitCode = 1;
} else {
  console.log("月面図書館｜収録した試遊");
  for (const id of scenes[scene]) {
    const event = events.find(event => event.id === id);
    if (!event) throw new Error(`見本に場面 ${id} がありません`);
    console.log(`\n[${id}] ${event.text}`);
  }
}
