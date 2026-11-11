// A panel starts nothing in its init's own turn, and never stays on its skeleton behind a lost read.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary } from "./helpers.mjs";
import { fixture, loadMod } from "./perf-harness.mjs";

const never = () => new Promise(() => {});
const fakeTimer = () => {
  const timers = [];
  return { timers, after: (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; } };
};

async function mounted(t, options = {}) {
  const f = fixture({ dir: await temporary(t), ...options });
  const { Panel } = await loadMod("kanso-panel/main.js", ["Panel"], f.host);
  f.state.props = { panel: "files" };
  const panel = new Panel();
  panel.init({}, f.cx);
  const abandoned = [];
  panel.db.abandon = () => abandoned.push(f.state.now);
  return { f, panel, abandoned };
}

test("afterMount starts its work on the next timer turn, not in the caller's", async () => {
  const { afterMount } = await load("kanso-spaces/pure.js", ["afterMount"]);
  const timer = fakeTimer(), started = [];
  afterMount({ timer }, (cx) => started.push(cx));
  assert.deepEqual(started, []);
  assert.equal(timer.timers[0][0], 0);
  timer.timers[0][1]("next");
  assert.deepEqual(started, ["next"]);
});

test("a panel's first read starts on the timer turn after init, and one in time leaves the deadline nothing to do", async (t) => {
  const { f, panel, abandoned } = await mounted(t);
  await f.settle();
  assert.deepEqual(f.state.processes, [], "nothing runs in init's own turn");
  await f.advance(0);
  assert.ok(f.state.processes.some((p) => p.command === "sqlite3"));
  assert.equal(panel.ready, true);
  await f.advance(2000);
  assert.deepEqual(abandoned, []);
});

test("a read that never settles opens the panel empty at the deadline", async (t) => {
  const { f, panel, abandoned } = await mounted(t, { blocked: true });
  await f.advance(0);
  await f.advance(1499);
  assert.equal(panel.ready, false);
  await f.advance(1);
  assert.equal(panel.ready, true);
  assert.equal(abandoned.length, 1);
});

test("the state read races its deadline on the view's timer", async () => {
  const { stateWithin, LATE, STATE_MS } = await load("kanso-panel/panel-state.js", ["stateWithin", "LATE", "STATE_MS"]);
  const inTime = fakeTimer();
  assert.deepEqual(clone(await stateWithin(Promise.resolve({ cwd: "/a" }), inTime)), { cwd: "/a" });
  assert.equal(inTime.timers[0][0], STATE_MS);
  const lost = fakeTimer(), late = stateWithin(never(), lost);
  lost.timers[0][1]();
  assert.equal(await late, LATE);
});
