// Only awake projects on available machines may start background work.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

const model = () => load("kanso-spaces/background.js", ["pollable", "activePlaces"]);
const spaces = [{ id: "a", folder: "/a", tabs: [{ id: "tab" }] }];
const panes = [{ terminal: "t1", tab: "tab" }];
const dozing = new Set(["t1"]);

test("a terminal asleep starts no background work, and a project whose every terminal sleeps none either", async () => {
  const { pollable, activePlaces } = await model();
  assert.equal(pollable("t1", dozing, []), false);
  assert.equal(pollable("t2", dozing, []), true);
  assert.equal(activePlaces(spaces, panes, dozing, []).size, 0);
  assert.equal(activePlaces(spaces, [...panes, { terminal: "t2", tab: "tab" }], dozing, []).size, 1, "a sleeping tab leaves other tabs working");
  assert.equal(activePlaces(spaces, panes, new Set(), []).size, 1, "woken: polled again");
});

test("off and loading machines are excluded and ready machines resume polling", async () => {
  const { pollable, activePlaces } = await model();
  for (const layout of ["unavailable", "loading", "ready"]) {
    const layouts = [{ name: "remote", layout }];
    assert.equal(pollable("remote/t1", new Set(), layouts), layout === "ready");
    assert.equal(activePlaces(spaces.map((s) => ({ ...s, machine: "remote" })), panes, new Set(), layouts).size, layout === "ready" ? 1 : 0);
    assert.equal(pollable("t1", new Set(), layouts), true);
  }
});
