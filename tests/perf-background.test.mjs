// Only awake projects on available machines may start background work.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

const model = () => load("kanso-spaces/background.js", ["pollable", "activePlaces"]);
const spaces = [{ id: "a", folder: "/a", tabs: [{ id: "tab" }] }];
const panes = [{ terminal: "t1", tab: "tab" }];
const sleeps = [{ from: ":/a", state: "asleep", agents: [{ terminal: "t1", resume: "01234567-1234-1234-1234-0123456789ab" }] }];

test("a sleep excludes its terminal and conversation until undo returns them", async () => {
  const { pollable, activePlaces } = await model();
  assert.equal(pollable("t1", sleeps, []), false);
  assert.equal(pollable("t2", sleeps, [], { file: "/session/01234567-1234-1234-1234-0123456789ab.jsonl" }), false);
  assert.equal(activePlaces(spaces, panes, sleeps, [], "").size, 0);
  assert.equal(activePlaces(spaces, [...panes, { terminal: "t2", tab: "tab" }], sleeps, [], "").size, 1, "a sleeping tab leaves other tabs working");
  const undo = sleeps.map((s) => ({ ...s, state: "undoing" }));
  assert.equal(pollable("t1", undo, []), true);
  assert.equal(activePlaces(spaces, panes, undo, [], "").size, 1);
});

test("off and loading machines are excluded and ready machines resume polling", async () => {
  const { pollable, activePlaces } = await model();
  for (const layout of ["unavailable", "loading", "ready"]) {
    const layouts = [{ name: "remote", layout }];
    assert.equal(pollable("remote/t1", [], layouts), layout === "ready");
    assert.equal(activePlaces(spaces.map((s) => ({ ...s, machine: "remote" })), panes, [], layouts, "").size, layout === "ready" ? 1 : 0);
    assert.equal(pollable("t1", [], layouts), true);
  }
});
