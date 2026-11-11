import assert from "node:assert/strict";
import { test, small, sweep } from "./update-harness.mjs";

test("Killed after any later step of an undone swap, recovery ends at the whole old install, and the undoing ends in full", { timeout: 170_000 }, async (t) => {
  const s = await small(t);
  const back = await sweep(s, { sabotage: true, first: 17 });
  assert.deepEqual(back.kills, Array(16).fill("old"));
  assert.deepEqual(back.end, s.before, "a failed swap undone in full");
});
