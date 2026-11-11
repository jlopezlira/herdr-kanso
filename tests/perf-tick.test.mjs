// The sidebar keeps focus responsive while tracking agents only every two seconds.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

async function tickHost() {
  const state = { now: 0, focus: null, tracking: 0, panes: 0, reads: 0, notices: 0 };
  class Clock extends Date { static now() { return state.now; } }
  const projects = [{ id: "a", folder: "/a", machine: "", name: "A" }];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: Clock, props: () => ({}), window: () => ({ active: true }), shared: () => projects,
    spaces: () => [{ id: "new", tabs: [] }], panes: () => { state.panes += 1; return []; },
    focused: () => ({ terminal: state.focus }), agents: () => { state.reads += 1; return [{ address: "a", focused: true, status: "idle" }]; },
  });
  const view = new Spaces();
  Object.assign(view, {
    shown: new Set(), born: {}, lastSeen: { a: "done" },
    takeMoves() {}, trackAgents() { state.tracking += 1; }, trackReturn() {}, refreshThreads() {},
    checkAlive() {}, keepSeen() {}, due: () => new Set(), prune() {},
  });
  return { state, view, cx: { notify() { state.notices += 1; } } };
}

test("checkNew runs tracking at most every 2 seconds, with cheap new-space and focus checks at 500 ms", async () => {
  const { state, view, cx } = await tickHost();
  for (const now of [0, 500, 1000, 1500, 2000, 2500, 3000, 3500]) {
    state.now = now;
    if (now === 500) state.focus = "a";
    view.checkNew(cx);
    if (now === 500) assert.equal(view.held.done, true, "focus keeps a finished agent in Done immediately");
  }
  assert.equal(state.tracking, 2, `checkNew tracked ${state.tracking} times in 4 seconds; budget 2`);
  assert.equal(state.panes, 2);
  assert.equal(state.reads, 1, "unchanged focus never copies the agent list");
  assert.equal(view.born.new, 0);
});

test("registry comparisons detect every published field and order without serialization", async () => {
  const { sameProjects } = await load("kanso-spaces/projects.js", ["sameProjects"]);
  const row = { id: "a", name: "A", folder: "/a", machine: "", agent: "shell", missing: false };
  assert.equal(sameProjects([row], [{ ...row }]), true);
  assert.equal(sameProjects([row], undefined), false);
  assert.equal(sameProjects([row], []), false);
  for (const field of Object.keys(row)) assert.equal(sameProjects([row], [{ ...row, [field]: "changed" }]), false, field);
  const other = { ...row, id: "b" };
  assert.equal(sameProjects([row, other], [other, row]), false);
});
