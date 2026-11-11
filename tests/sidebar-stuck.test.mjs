// The sidebar's first look, its machine list and its keys keep going when one answer never arrives.
import assert from "node:assert/strict";
import test from "node:test";
import { load, temporary } from "./helpers.mjs";
import { fixture, loadMod } from "./perf-harness.mjs";

test("a machine read that never settles releases the guard and the next tick reads", async () => {
  const { runRead, LATE } = await load("kanso-spaces/pure.js", ["runRead", "LATE"]);
  const timer = { queued: [], after(ms, fn) { this.queued.push([ms, fn]); } };
  let reads = 0;
  const read = () => { reads += 1; return reads === 1 ? new Promise(() => {}) : Promise.resolve("list"); };
  const first = runRead({ busy: false }, timer, 20_000, read);
  assert.equal(first.state.busy, true);
  assert.equal(runRead(first.state, timer, 20_000, read), null);
  assert.equal(reads, 1);
  assert.equal(timer.queued[0][0], 20_000);
  timer.queued[0][1]();
  const released = await first.job;
  assert.equal(released.busy, false);
  assert.equal(released.value, LATE);
  const second = runRead(released, timer, 20_000, read);
  const listed = await second.job;
  assert.equal(listed.busy, false);
  assert.equal(listed.value, "list");
  assert.equal(reads, 2);
});

test("one thrown command leaves the keys listening, and a replaced build ends them", async () => {
  const { commandLoop } = await load("kanso-spaces/pure.js", ["commandLoop"]);
  const seen = [];
  const steps = ["reject", "space-1", "view-spaces", "replaced"];
  let at = 0;
  let replaced = false;
  await commandLoop(
    async () => {
      const step = steps[at];
      at += 1;
      if (step === "reject") throw new Error("rejected");
      if (step === "replaced") replaced = true;
      return step;
    },
    () => { if (replaced) throw new Error("replaced"); },
    (command) => {
      seen.push(command);
      if (command === "view-spaces") throw new Error("handler");
    },
  );
  assert.deepEqual(seen, ["space-1", "view-spaces"]);
});

test("the sidebar's first machine and sleep reads are not started by init", async (t) => {
  const f = fixture({ dir: await temporary(t), blocked: true });
  const { Spaces } = await loadMod("kanso-spaces/main.js", ["Spaces"], f.host);
  const view = new Spaces();
  view.init({}, f.cx);
  const listed = () => f.state.processes.filter((p) => p.command === "hc" && p.args[0] === "machine" && p.args[1] === "ls");
  assert.equal(listed().length, 0);
  assert.equal(view.workPolledAt, undefined);
  await f.advance(0);
  assert.equal(listed().length, 1);
  assert.equal(typeof view.workPolledAt, "number");
});
