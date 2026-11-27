import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

test("A working row fades on first mount and on moving across folds in either direction", async () => {
  const { glowState } = await load("kanso-spaces/glow-state.js", ["glowState"]);
  const { EASE } = await load("kanso-spaces/ui.js", ["EASE"]);
  const start = glowState(null, "active", true, 0);
  assert.equal(start.pose, "entering");
  const working = glowState(start, "active", true, 1);
  assert.equal(working.next, Infinity);
  const release = glowState(working, "done", false, 2);
  assert.equal(glowState(working, "pinned", true, 2).pose, "working");
  assert.equal(release.pose, "release");
  const exit = glowState(release, "done", false, 3);
  const moved = glowState(exit, "blocked", false, 4);
  assert.ok(moved.fade.opacity < 1 && moved.fade.opacity > 0);
  assert.equal(glowState(moved, "blocked", false, 5).next, exit.next);
  assert.equal(exit.pose, "leaving");
  assert.equal(glowState(exit, "done", false, exit.next - 1).next, exit.next);
  assert.equal(exit.next, 2 + EASE.duration);
  assert.equal(glowState(exit, "done", false, exit.next).pose, "rest");
  assert.equal(glowState(exit, "done", true, 4).pose, "working");
  assert.equal(glowState(exit, "active", true, 4).pose, "entering");
});
