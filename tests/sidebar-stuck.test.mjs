// The sidebar's first look, its machine list and its keys keep going when one answer never arrives.
import assert from "node:assert/strict";
import test from "node:test";
import { load, temporary } from "./helpers.mjs";
import { fixture, loadMod } from "./perf-harness.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));

const untilQueued = async (timer) => {
  for (const _ of [1, 2, 3, 4, 5, 6, 7, 8]) {
    if (timer.queued.length) return;
    await settled();
  }
  assert.fail("the loop did not wait");
};

test("a machine read that never settles releases the guard and the next tick reads", async () => {
  const { MachineRead } = await load("kanso-spaces/sidebar.js", ["MachineRead"]);
  const timer = { queued: [], after(ms, fn) { this.queued.push([ms, fn]); } };
  const guard = new MachineRead();
  let reads = 0;
  const read = () => { reads += 1; return reads === 1 ? new Promise(() => {}) : Promise.resolve("list"); };
  const first = guard.start(timer, 20_000, read);
  assert.equal(guard.busy, true);
  assert.equal(guard.start(timer, 20_000, read), null);
  await settled();
  assert.equal(reads, 1);
  assert.equal(timer.queued[0][0], 20_000);
  timer.queued[0][1]();
  const released = await first;
  assert.equal(released.late, true);
  assert.equal(released.stderr, "timed out");
  assert.equal(guard.busy, false);
  const second = guard.start(timer, 20_000, read);
  assert.equal(await second, "list");
  assert.equal(reads, 2);
  assert.equal(guard.busy, false);
});

test("a throw between two good commands keeps the keys, and a replaced build ends them", async () => {
  const { commandLoop, KEY_WAIT_MS } = await load("kanso-spaces/sidebar.js", ["commandLoop", "KEY_WAIT_MS"]);
  const seen = [];
  const steps = ["space-1", "reject", "view-spaces", "replaced"];
  let at = 0;
  let replaced = false;
  const timer = { queued: [], after(ms, fn) { this.queued.push([ms, fn]); } };
  const done = commandLoop(
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
    timer,
  );
  await untilQueued(timer);
  assert.equal(timer.queued[0][0], KEY_WAIT_MS);
  assert.deepEqual(seen, ["space-1"]);
  timer.queued[0][1]();
  await done;
  assert.deepEqual(seen, ["space-1", "view-spaces"]);
  assert.equal(timer.queued.length, 1);
});

test("a read that always rejects ends the loop after the limit and never busy-loops", async () => {
  const { commandLoop, KEY_MISSES, KEY_WAIT_MS } = await load("kanso-spaces/sidebar.js", ["commandLoop", "KEY_MISSES", "KEY_WAIT_MS"]);
  const timer = { queued: [], after(ms, fn) { this.queued.push([ms, fn]); } };
  let reads = 0;
  const done = commandLoop(
    () => { reads += 1; return Promise.reject(new Error("rejected")); },
    () => {},
    () => {},
    timer,
  );
  for (const n of Array.from({ length: KEY_MISSES - 1 }, (_, i) => i + 1)) {
    await untilQueued(timer);
    assert.equal(reads, n);
    assert.equal(timer.queued.length, 1);
    assert.equal(timer.queued[0][0], KEY_WAIT_MS);
    const fire = timer.queued.pop();
    fire[1]();
  }
  await done;
  assert.equal(reads, KEY_MISSES);
  assert.equal(timer.queued.length, 0);
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
