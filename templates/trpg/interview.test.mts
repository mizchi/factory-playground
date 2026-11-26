import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { interview } from "./interview.mts";
import { PlayInterrupted, terminalInput } from "./terminal-input.mts";
import { terminalSeat } from "./tui.mts";

function scripted(...lines: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    async ask(prompt: string) {
      prompts.push(prompt);
      const next = lines.shift();
      assert.notEqual(next, undefined, "unexpected extra question");
      return next!;
    }
  };
}

test("combines numbered genres with custom genres and preserves the requested scene", async () => {
  const detail = "最後のエレベーターが存在しない階で止まる。";
  const {ask, prompts} = scripted("１、2,3，4、5、6、役所コメディ、１", "3、規則の穴を探す", detail, "６０");
  const answers = await interview(ask);
  assert.equal(answers.genre, "ミステリ、脱出ゲーム、DnD風の冒険、クトゥルフ的なホラー、SCP的ホラー、ダークファンタジー、役所コメディ");
  assert.equal(answers.activity, "仲間と交渉する、規則の穴を探す");
  for (const answer of [answers.genre, answers.activity, detail]) assert.ok(answers.wish.includes(answer));
  assert.equal(answers.minutes, 60);
  assert.equal(prompts.length, 4);
});

test("retries invalid choices, accepts an original genre and defaults optional answers", async () => {
  const {ask, prompts} = scripted("", "2、9", "卓上落語", "", "", "90", "");
  const answers = await interview(ask);
  assert.equal(answers.genre, "卓上落語");
  assert.equal(answers.activity, "");
  assert.equal(answers.detail, "");
  assert.equal(answers.minutes, 30);
  assert.match(prompts.at(-1)!, /30か60/);
});

test("a preset duration skips the time question and buffered input reaches the human player", async t => {
  const output = new PassThrough();
  const input = terminalInput(Readable.from(["2\n\n\n鍵穴をのぞく。\n"]), output);
  t.after(input.close);
  assert.equal((await interview(input.readLine, 60)).minutes, 60);
  const human = terminalSeat(1, input, output);
  const view = {draft: 1, seat: 1, turn: 1, title: "密室", promise: "", question: "", cast: ["探偵"],
    handout: {name: "探偵", desire: "", clue: "", win: ""}, events: [{id: "S0", text: "扉に鍵がかかっている。"}]};
  assert.equal((await human.act(view, [])).action, "鍵穴をのぞく。");
});

test("quit and incomplete input both stop the interview", async t => {
  for (const answers of ["1\n/quit\n", "1\n"]) {
    const reader = terminalInput(Readable.from([answers]), new PassThrough());
    t.after(reader.close);
    await assert.rejects(interview(reader.readLine), PlayInterrupted);
  }
});
