import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CHARS, compare, duplicateGroups, repeatedWindows, scan, scannedFiles, significantLines } from "../scripts/check-dupes.mjs";
import { SHARED } from "../scripts/sync-share.mjs";

const block = [
  "const rows = await db.read(\"SELECT id, name FROM projects WHERE removed IS NULL;\");",
  "const names = rows.map((row) => row.name).filter(Boolean).toSorted();",
].join("\n");
const unique = (name) => `export const ${name} = () => "${name} has its own code";`;

test("A block repeated in two files is reported with both places", () => {
  const groups = duplicateGroups(scan({ "a.js": `${unique("a")}\n${block}\n`, "b.js": `${block}\n${unique("b")}\n` }));
  assert.deepEqual(groups.map(({ places }) => places), [[{ file: "a.js", start: 2, end: 3 }, { file: "b.js", start: 1, end: 2 }]]);
});

test("Blank lines, comments, imports and lone brackets are not code", () => {
  const text = 'import { a,\n  b } from "./x.js";\n\n// a note\n  });\nconst  kept =  1;';
  assert.deepEqual(significantLines(text), [{ line: 6, text: "const kept = 1;" }]);
});

test("Repeated code shorter than the minimum is not reported", () => {
  const short = "x".repeat(MIN_CHARS - 1);
  assert.deepEqual(duplicateGroups(scan({ "a.js": short, "b.js": short })), []);
});

test("Code the baseline lists passes, even after it moves down the file", () => {
  const baseline = repeatedWindows(scan({ "a.js": block, "b.js": block }).windows);
  assert.deepEqual(compare(scan({ "a.js": `${unique("a")}\n\n${block}`, "b.js": block }).windows, baseline), { added: [], gone: [] });
});

test("A new copy of listed code fails with the file it was added to", () => {
  const baseline = repeatedWindows(scan({ "a.js": block, "b.js": block }).windows);
  const { added } = compare(scan({ "a.js": block, "b.js": block, "c.js": block }).windows, baseline);
  assert.deepEqual([...new Set(added.map(({ file }) => file))], ["c.js"]);
});

test("A listed copy that is gone fails until the baseline is written again", () => {
  const baseline = repeatedWindows(scan({ "a.js": block, "b.js": block }).windows);
  const { added, gone } = compare(scan({ "a.js": block, "b.js": unique("b") }).windows, baseline);
  assert.deepEqual(added, []);
  assert.deepEqual([...new Set(gone.map(({ file }) => file))].sort(), ["a.js", "b.js"]);
});

test("Copies made by the shared-file sync are skipped and their sources scanned", async () => {
  const files = Object.keys(await scannedFiles());
  const copies = SHARED.flatMap(({ copies }) => copies);
  assert.deepEqual(files.filter((file) => copies.includes(file)), []);
  assert.ok(files.includes("kanso/mods/kanso-spaces/marks.js"));
});
