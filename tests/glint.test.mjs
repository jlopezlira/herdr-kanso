import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, numberArguments, nodes, themed, KIT_NIGHT } from "./helpers.mjs";

const host = (battery = false) => ({ ...gpuiHost(), div: () => chain("div"), shared: (key) => (key === "kanso.battery" ? battery : null) });
const kit = async (battery) => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "GLINT", "GLINT_MS", "GLINT_STAGGER", "OPACITY"], host(battery)),
  ...await load("kanso-panel/ui-glint.js", ["glint"], host(battery)),
}, KIT_NIGHT);
const calls = (el, name) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === name));

test("A working name glints with three windows at the kit's widths, strengths and pace", async () => {
  const { glint, GLINT, GLINT_MS, GLINT_STAGGER, OPACITY, c } = await kit(false);
  const el = glint("Atlas", c, "a");
  const loops = calls(el, "loop");
  assert.equal(loops.length, 6, "each window and its copy of the text move");
  const periods = new Set(loops.map(([, , policy]) => policy.period));
  assert.equal(periods.size, 1);
  const period = [...periods][0];
  assert.ok(period >= GLINT_MS && (period - GLINT_MS) % GLINT_STAGGER === 0, String(period));
  assert.deepEqual(calls(el, "opacity").map(([, share]) => share), [OPACITY.glintFaint, OPACITY.glintMid, 1]);
  assert.deepEqual(calls(el, "w").map(([, width]) => width), [GLINT.wide, GLINT.mid, GLINT.narrow]);
  const paces = new Set(["a", "b", "c", "d", "e", "f", "g"].map((seed) => calls(glint("x", c, seed), "loop")[0][2].period));
  assert.ok(paces.size > 1, "names side by side do not glint in step");
});

test("On battery a working name glints as it does on mains", async () => {
  const mains = await kit(false), battery = await kit(true);
  const loops = ({ glint, c }) => JSON.stringify(calls(glint("Atlas", c, "a"), "loop"));
  assert.equal(calls(battery.glint("Atlas", battery.c, "a"), "loop").length, 6);
  assert.equal(loops(battery), loops(mains));
});

test("A working name draws no dots after it, glinting or still on battery", async () => {
  for (const battery of [false, true]) {
    const { glint, c } = await kit(battery);
    const el = glint("Atlas", c, "a");
    assert.deepEqual(calls(el, "frames"), [], "no dots step");
    assert.equal(el.kids.length, 1, "no room is kept for them");
  }
});

test("The glint takes every size and pace from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-glint.js"), []);
});
