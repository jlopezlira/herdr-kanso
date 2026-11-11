// Unchanged sidebar inputs reuse sleeping and needs-you rows across redraws.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

async function drawHost() {
  const state = { sleeps: [], away: null, rows: 0, needs: 0, terms: [{ address: "a", state: "live" }], list: [{ address: "a", pane: "p", status: "blocked", name: "A" }], layouts: [] };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    home: () => "/home", shared: (key) => clone(key === "kanso.asleep" ? state.sleeps : key === "kanso.sleep.away" ? state.away : null),
    agents: () => clone(state.list), terminals: () => clone(state.terms), machines: () => clone(state.layouts),
    sleepingNow: () => { state.rows += 1; return { rows: [], dozing: new Set() }; },
    waitingQueue: () => { state.needs += 1; return []; },
  });
  const view = new Spaces();
  const spaces = [{ id: "s", folder: "/a", name: "A", tabs: [{ id: "tab" }] }];
  const draw = () => view.refreshNeeds(clone(spaces), clone(state.terms), view.sleepingNow(clone(spaces), clone(state.terms)));
  return { state, view, spaces, draw };
}

test("unchanged sidebar draws build zero sleeping or needs-you rows", async () => {
  const { state, draw } = await drawHost();
  const first = draw();
  for (const i of Array.from({ length: 120 }, (_, i) => i)) assert.equal(draw(), first, `draw ${i}`);
  assert.equal(state.rows, 1);
  assert.equal(state.needs, 1);
  state.layouts = [{ layout: "unavailable" }];
  draw();
  assert.equal(state.rows, 1);
  assert.equal(state.needs, 1, "availability only changes the queue state");
  state.list[0].status = "idle";
  draw();
  assert.equal(state.needs, 2);
});

test("sleeping rows rebuild when a space, terminal, sleep or optimistic sleep changes", async () => {
  const { state, spaces, draw } = await drawHost();
  draw();
  const changes = [
    () => { spaces[0].folder = "/b"; },
    () => { spaces[0].tabs.push({ id: "other" }); },
    () => { state.terms.push({ address: "b" }); },
    () => { state.sleeps.push({ id: "sleep", state: "asleep", agents: [{ resume: "c", name: "Name" }] }); },
    () => { state.sleeps[0].agents[0].name = "Renamed"; },
    () => { state.sleeps[0].state = "undoing"; },
    () => { state.away = { rows: [{ id: "pending", going: true, agents: [] }] }; },
  ];
  for (const change of changes) { change(); draw(); }
  assert.equal(state.rows, changes.length + 1);
  draw();
  assert.equal(state.rows, changes.length + 1);
});
