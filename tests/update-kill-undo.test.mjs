import assert from "node:assert/strict";
import { test, small, sweep } from "./update-harness.mjs";

// kanso-chrome cannot go in: 12 steps forward, then back in reverse, each slot's renames and its
// line out of the journal (19), then the journal gone.
test("Killed after any of the first 16 steps of an undone swap, recovery ends at the whole old install", { timeout: 170_000 }, async (t) => {
  const s = await small(t);
  const back = await sweep(s, { sabotage: true, last: 16 });
  assert.deepEqual(back.kills, Array(16).fill("old"));
  assert.equal(back.end, null, "the undoing is still under way at step 16");
});
