import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, gpuiHost, numberArguments, nodes, calls, themed, KIT_NIGHT, same } from "./helpers.mjs";

const host = (battery = false) => ({ ...gpuiHost(), shared: (key) => (key === "kanso.battery" ? battery : null) });
const kit = async (battery) => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "GLINT", "GLINT_MS", "GLINT_STAGGER", "GLINT_PACES", "OPACITY", "EASE"], host(battery)),
  ...await load("kanso-panel/ui-glint.js", ["glint"], host(battery)),
}, KIT_NIGHT);
const callsIn = (el, name) => nodes(el).flatMap((kid) => calls(kid, name));

test("A working name glints with three windows at the kit's widths, strengths and pace", async () => {
  const { glint, GLINT, GLINT_MS, GLINT_STAGGER, OPACITY, c } = await kit(false);
  const el = glint("Atlas", c, "a");
  const loops = callsIn(el, "loop");
  assert.equal(loops.length, 6, "each window and its copy of the text move");
  const periods = new Set(loops.map(([, , policy]) => policy.period));
  assert.equal(periods.size, 1);
  const period = [...periods][0];
  assert.ok(period >= GLINT_MS && (period - GLINT_MS) % GLINT_STAGGER === 0, String(period));
  assert.deepEqual(callsIn(el.kids[1], "opacity").map(([, share]) => share), [1, OPACITY.glintFaint, OPACITY.glintMid, 1]);
  assert.deepEqual(callsIn(el, "w").map(([, width]) => width), [GLINT.wide, GLINT.mid, GLINT.narrow]);
  const paces = new Set(["a", "b", "c", "d", "e", "f", "g"].map((seed) => callsIn(glint("x", c, seed), "loop")[0][2].period));
  assert.ok(paces.size > 1, "names side by side do not glint in step");
});

test("On battery a working name glints as it does on mains", async () => {
  const mains = await kit(false), battery = await kit(true);
  const loops = ({ glint, c }) => JSON.stringify(callsIn(glint("Atlas", c, "a"), "loop"));
  assert.equal(callsIn(battery.glint("Atlas", battery.c, "a"), "loop").length, 6);
  assert.equal(loops(battery), loops(mains));
});

test("A working name draws no dots after it, glinting or still on battery", async () => {
  for (const battery of [false, true]) {
    const { glint, c } = await kit(battery);
    const el = glint("Atlas", c, "a");
    assert.deepEqual(callsIn(el, "frames"), [], "no dots step");
    assert.equal(el.kids.length, 2, "only the name and its overlay");
  }
});

test("The glow fades on the same layer and sweeps until the exit ends", async () => {
  const { glint, c, EASE } = await kit(false);
  for (const [state, alpha, moving] of [["rest", 0, false], ["working", 1, true], ["leaving", 0, true]]) {
    const el = glint("Atlas", c, "name", c.dim, state);
    const [label, layer] = el.kids;
    same(calls(label, "text_color"), [["text_color", c.dim]]);
    same(calls(layer, "id"), [["id", "name-glow"]]);
    assert.equal(JSON.stringify(calls(layer, "transition")), JSON.stringify([["transition", "opacity", EASE]]));
    same(calls(layer, "opacity"), [["opacity", alpha]]);
    assert.equal(callsIn(layer, "loop").length, moving ? 6 : 0);
  }
});

test("The glint takes every size and pace from the tokens", async () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-glint.js"), []);
  assert.doesNotMatch(readFileSync(new URL("../kanso/mods/kanso-panel/ui-glint.js", import.meta.url), "utf8"), /=\s*\d/, "no number is set in the file");
  const { glint, GLINT_PACES, c } = await kit(false);
  const seeds = Array.from({ length: 40 }, (_, i) => String.fromCharCode(97 + i));
  assert.equal(new Set(seeds.map((seed) => callsIn(glint("x", c, seed), "loop")[0][2].period)).size, GLINT_PACES);
});
