// A scroll area keeps its position only under a name of its own: an unnamed one is
// identified by where it sits, so a redraw can place it anew and send it back to the top.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["kanso/mods", "markdown-panel/mods"];
const SCROLL = /\.overflow_(?:x_|y_)?scroll(?:bar)?\(\)/g;
const START = /\b(?:v_flex|h_flex|div)\(\)/g;

async function sources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? sources(join(dir, e.name)) : Promise.resolve(e.name.endsWith(".js") ? [join(dir, e.name)] : []))));
  return nested.flat();
}

// The builder chain a scroll call belongs to: from the last element made before it.
export function unnamedScrolls(text) {
  return [...text.matchAll(SCROLL)].flatMap((m) => {
    const before = text.slice(0, m.index);
    const start = [...before.matchAll(START)].at(-1)?.index ?? 0;
    const chain = before.slice(start);
    return /\.id\(/.test(chain) ? [] : [before.split("\n").length];
  });
}

test("a named scroll area passes, an unnamed one is found", () => {
  assert.deepEqual(unnamedScrolls('v_flex().id("list").flex_1().overflow_y_scrollbar()'), []);
  assert.deepEqual(unnamedScrolls('x\nv_flex().flex_1()\n  .overflow_y_scrollbar()'), [3]);
  assert.deepEqual(unnamedScrolls('div().id(`${id}-grid`).w_full().overflow_x_scrollbar()'), []);
});

test("every scroll area in Kanso has a name, so it keeps its place", async () => {
  const files = (await Promise.all(ROOTS.map(sources))).flat();
  const found = (await Promise.all(files.map(async (f) => unnamedScrolls(await readFile(f, "utf8")).map((line) => `${f}:${line}`)))).flat();
  assert.deepEqual(found, []);
});
