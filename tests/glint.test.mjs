// The glint: a working name lit by windows that cross it, the dots counting after it, and on battery the dots alone.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, numberArguments, nodes, themed, KIT_NIGHT } from "./helpers.mjs";

const host = (battery = false) => ({ ...gpuiHost(), div: () => chain("div"), shared: (key) => (key === "kanso.battery" ? battery : null) });
const kit = async (battery) => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "GLINT", "GLINT_MS", "GLINT_STAGGER", "DOTS_MS", "OPACITY"], host(battery)),
  ...await load("kanso-panel/ui-glint.js", ["glint"], host(battery)),
}, KIT_NIGHT);
const calls = (el, name) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === name));

test("A working name glints with three windows at the kit's widths, strengths and pace, and its dots count after it", async () => {
  const { glint, G, GLINT, GLINT_MS, GLINT_STAGGER, DOTS_MS, OPACITY, c } = await kit(false);
  const el = glint("Atlas", c, "a");
  const loops = calls(el, "loop");
  assert.equal(loops.length, 6, "each window and its copy of the text move");
  const periods = new Set(loops.map(([, , policy]) => policy.period));
  assert.equal(periods.size, 1);
  const period = [...periods][0];
  assert.ok(period >= GLINT_MS && (period - GLINT_MS) % GLINT_STAGGER === 0, String(period));
  assert.deepEqual(calls(el, "opacity").map(([, share]) => share), [OPACITY.glintFaint, OPACITY.glintMid, 1]);
  assert.deepEqual(calls(el, "w").map(([, width]) => width), [GLINT.wide, GLINT.mid, GLINT.narrow, G.lg]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls(el, "frames"))), [["frames", ["", ".", "..", "..."], DOTS_MS]]);
  const paces = new Set(["a", "b", "c", "d", "e", "f", "g"].map((seed) => calls(glint("x", c, seed), "loop")[0][2].period));
  assert.ok(paces.size > 1, "names side by side do not glint in step");
});

test("On battery a working name stands still in full ink and only the dots step", async () => {
  const { glint, DOTS_MS, c } = await kit(true);
  const el = glint("Atlas", c, "a");
  assert.equal(calls(el, "loop").length, 0);
  assert.ok(calls(el, "text_color").some(([, ink]) => ink === c.text));
  assert.deepEqual(calls(el, "frames").map(([, , ms]) => ms), [DOTS_MS]);
});

test("The glint takes every size and pace from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-glint.js"), []);
});
