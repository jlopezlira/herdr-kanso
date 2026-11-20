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

test("A mod file that imports a sibling's export under another name runs with that name", async () => {
  const { runInNewContext } = await import("node:vm");
  const { modScript } = await import("../scripts/mod-source.mjs");
  const script = modScript("import { row as drawRow, mark } from \"./ui-row.js\";\nexport const row = () => drawRow() + mark;\nrow();\n", () => "export const row = () => 2;\nexport const mark = 1;\n");
  assert.equal(runInNewContext(script), 3);
});
