// Divider sampling is slow at rest and responsive during a held pane drag.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

test("strip adopt polls at most once a second at rest and every 150 ms during a drag", async () => {
  const state = { now: 0, drag: null, reads: 0, notices: 0 };
  class Clock extends Date { static now() { return state.now; } }
  const { Strip } = await load("kanso-strip/main.js", ["Strip"], {
    Date: Clock, shared: () => state.drag, setShared: (key, value) => { if (key === "strip.drag") state.drag = value; },
  });
  const view = new Strip();
  view.seq = 0;
  view.adopt = () => { state.reads += 1; return true; };
  const cx = { notify() { state.notices += 1; } };
  for (const now of Array.from({ length: 400 }, (_, i) => i * 150)) { state.now = now; view.pollAdopt(cx); }
  assert.ok(state.reads <= 60, `strip adopt read ${state.reads} times at rest in a minute; budget 60`);
  state.reads = 0;
  state.drag = { pane: "p", at: state.now };
  for (const step of [150, 300, 450, 600]) { state.now = state.drag.at + step; view.pollAdopt(cx); }
  assert.equal(state.reads, 4);
  state.now = state.drag.at + 12_001;
  view.pollAdopt(cx);
  assert.equal(state.drag, null, "a drag dropped over a gutter still expires");
  assert.equal(state.notices, view.seq);
});
