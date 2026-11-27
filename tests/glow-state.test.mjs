import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

test("A finishing agent keeps its sweep for the fade, unless it starts working again", async () => {
  const { glowState, glowDeadline } = await load("kanso-spaces/glow-state.js", ["glowState", "glowDeadline"]);
  const { EASE } = await load("kanso-spaces/ui.js", ["EASE"]);
  const agent = (status) => [{ address: "t1", status }];
  const state = (previous, status, at) => glowState(previous, agent(status), at);
  const start = state({ working: new Set(), leaving: new Map() }, "working", 0);
  assert.equal(glowDeadline(start), Infinity);
  const stop = state(start, "done", 1);
  const end = 1 + EASE.duration;
  assert.equal(glowDeadline(stop), end);
  assert.equal(glowDeadline(state(stop, "done", end - 1)), end);
  assert.equal(glowDeadline(state(stop, "done", end)), Infinity);
  assert.equal(glowDeadline(state(stop, "working", end - 1)), Infinity);
  assert.equal(glowDeadline(glowState(stop, [], end - 1)), Infinity);
});
