import test from "node:test";
import assert from "node:assert/strict";
import { onceMore } from "../kanso/mods/kanso-spaces/pure.js";

test("a lost step is abandoned and retried exactly once", async () => {
  const waits = [], calls = [];
  const timer = { after(ms, fn) { waits.push({ ms, fn }); } };
  const pending = onceMore(() => { calls.push("work"); return calls.length === 1 ? new Promise(() => {}) : 42; }, timer, 100, () => false, () => calls.push("abandon"));
  assert.equal(waits[0].ms, 100);
  waits[0].fn();
  assert.deepEqual(await pending, { ok: true, value: 42 });
  assert.deepEqual(calls, ["work", "abandon", "work"]);
});

test("a store that stays dead ends after the second deadline", async () => {
  const waits = [];
  let tries = 0, abandoned = 0;
  const pending = onceMore(() => { tries += 1; return new Promise(() => {}); }, { after(_ms, fn) { waits.push(fn); } }, 100, () => false, () => { abandoned += 1; });
  waits[0]();
  for (let n = 0; n < 20 && waits.length < 2; n += 1) await Promise.resolve();
  waits[1]();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.late, true);
  assert.equal(result.error.message, "did not answer");
  assert.equal(tries, 2);
  assert.equal(abandoned, 1);
});

test("a database deadline rejection retries without an outer step deadline", async () => {
  let tries = 0;
  const result = await onceMore(() => {
    tries += 1;
    if (tries === 1) throw Object.assign(new Error("did not answer"), { late: true });
    return "back";
  }, null, null);
  assert.deepEqual(result, { ok: true, value: "back" });
  assert.equal(tries, 2);
});

test("an ordinary error and a cancelled step are never retried", async () => {
  for (const cancelled of [false, true]) {
    let tries = 0;
    const error = Object.assign(new Error("failed"), { late: cancelled });
    const result = await onceMore(() => { tries += 1; throw error; }, null, null, () => cancelled, () => assert.fail("abandoned"));
    assert.equal(result.error, error);
    assert.equal(tries, 1);
  }
});
