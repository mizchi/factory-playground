import assert from "node:assert/strict";
import test from "node:test";
import { selectWatchPane } from "./rex-pane.ts";

const window = (id: string, focus: string, ...blocks: string[]) => ({
  window_id: id, focused_block_id: focus,
  layers: [{ blocks: blocks.map(block_id => ({ block_id })) }],
});
const view = { active_window_id: "other", windows: [
  window("project", "editor", "editor", "watch"), window("other", "shell", "shell"),
] };
const saved = [{ anchor: "editor", block: "watch" }];

test("a stale inherited block still controls the project's existing watcher", () => {
  assert.deepEqual(selectWatchPane(view, "closed", saved), { anchor: "editor", block: "watch" });
});
test("a valid origin in another tab starts its own watcher", () => {
  assert.deepEqual(selectWatchPane(view, "shell", saved), { anchor: "shell" });
});
test("an absent origin and no registered watcher use the focused pane", () => {
  assert.deepEqual(selectWatchPane(view, undefined, []), { anchor: "shell" });
});
test("after the watcher closes, use its surviving editor to recreate the split", () => {
  const closed = { ...view, windows: [window("project", "editor", "editor"), view.windows[1]] };
  assert.deepEqual(selectWatchPane(closed, "stale", saved), { anchor: "editor" });
});
