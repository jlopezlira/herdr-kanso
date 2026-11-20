// A covered panel reads once, on the next turn, when it is in front again.
import { loadFront } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const host = (state) => ({ window: () => ({ active: state.active }) });

const fronted = async (state) => ({ ...await loadFront(host(state)), timers: [] });
const restThenWake = (front, cx, reads) => {
  front.rest();
  front.wake(cx, (next) => reads.push(next));
};

test("a panel behind the window rests, then reads once when it is in front", async () => {
  const state = { active: false };
  const { Front, timers } = await fronted(state);
  const cx = { timer: { after: (_ms, fn) => { timers.push(fn); return { cancel() {} }; } } };
  const front = new Front();
  const reads = [];
  assert.equal(front.behind(), true);
  restThenWake(front, cx, reads);
  assert.equal(timers.length, 0, "still behind: no read");
  state.active = true;
  assert.equal(front.woke(), true, "a timer takes the skip once");
  assert.equal(front.woke(), false);
  restThenWake(front, cx, reads);
  front.wake(cx, () => { throw new Error("a second wake"); });
  assert.equal(timers.length, 1);
  state.active = false;
  timers[0](cx);
  assert.deepEqual(reads, [], "behind again before the turn: the read waits");
  state.active = true;
  front.wake(cx, (next) => reads.push(next));
  assert.equal(timers.length, 2);
  timers[1](cx);
  assert.deepEqual(reads, [cx]);
});

test("in front can mean shown as well as the window", async () => {
  const state = { active: true, hidden: true };
  const { Front, timers } = await fronted(state);
  const cx = { timer: { after: (_ms, fn) => { timers.push(fn); } } };
  const front = new Front(() => state.active && !state.hidden);
  const reads = [];
  assert.equal(front.behind(), false, "a hidden panel can still be the front window");
  restThenWake(front, cx, reads);
  assert.equal(timers.length, 0);
  state.hidden = false;
  front.wake(cx, (next) => reads.push(next));
  assert.equal(timers.length, 1);
  timers[0](cx);
  assert.deepEqual(reads, [cx]);
});
