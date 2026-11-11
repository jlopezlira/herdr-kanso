// The wait the tests share for what real processes and files bring.
import assert from "node:assert/strict";
import test from "node:test";
import { until } from "./helpers.mjs";

test("A wait ends as soon as its state comes, and one that never comes fails naming it", async () => {
  let n = 0;
  await until(() => ++n === 3);
  assert.equal(n, 3);
  await assert.rejects(until(() => false, 50), /Still not true after 50 ms: \(\) => false/);
});
