// Unchanged sidebar inputs reuse sleeping and needs-you rows across redraws.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

async function drawHost() {
  const state = { panes: [{ terminal: "a", tab: "tab" }], rows: 0, needs: 0, terms: [{ address: "a", state: "live", labels: {} }], list: [{ address: "a", pane: "p", status: "blocked", name: "A" }], layouts: [] };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    home: () => "/home", shared: () => null,
    agents: () => clone(state.list), terminals: () => clone(state.terms), panes: () => clone(state.panes), machines: () => clone(state.layouts),
    sleepingNow: () => { state.rows += 1; return { rows: [], dozing: new Set() }; },
    waitingQueue: () => { state.needs += 1; return []; },
  });
  const view = new Spaces();
  view.panel = { agents: new Map() };
  const spaces = [{ id: "s", folder: "/a", name: "A", tabs: [{ id: "tab" }] }];
  const draw = () => view.refreshNeeds(clone(spaces), clone(state.terms), view.sleepingNow(clone(spaces), clone(state.terms), clone(state.panes)));
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

test("sleeping rows rebuild when a tab, a pane, a terminal or a kept name changes", async () => {
  const { state, view, spaces, draw } = await drawHost();
  draw();
  const changes = [
    () => { spaces[0].tabs.push({ id: "other" }); },
    () => { spaces[0].tabs[0].settled = true; },
    () => { state.terms.push({ address: "b", labels: {} }); },
    () => { state.terms[0].labels = { "kanso.resume": "c" }; },
    () => { state.terms[0].program = { shell: true }; },
    () => { state.panes.push({ terminal: "b", tab: "other" }); },
    () => { view.panel.agents.set("c", { name: "Renamed" }); },
  ];
  for (const change of changes) { change(); draw(); }
  assert.equal(state.rows, changes.length + 1);
  draw();
  assert.equal(state.rows, changes.length + 1);
});
