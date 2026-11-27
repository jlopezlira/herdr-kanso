import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, numberArguments, nodes, calls, one, same, themed, KIT_NIGHT } from "./helpers.mjs";

const host = (battery = false) => ({ ...gpuiHost(), shared: (key) => (key === "kanso.battery" ? battery : null) });
const kit = async (battery) => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "GLINT", "GLINT_MS", "GLINT_EASE", "OPACITY"], host(battery)),
  ...await load("kanso-panel/ui-glint.js", ["glint", "SWEEP_MS"], host(battery)),
}, KIT_NIGHT);
const callsIn = (el, name) => nodes(el).flatMap((kid) => calls(kid, name));

test("A working name glints with three windows at the kit's widths, strengths and pace", async () => {
  const { glint, GLINT, GLINT_MS, GLINT_EASE, OPACITY, SWEEP_MS, c } = await kit(false);
  assert.equal(SWEEP_MS, GLINT_MS / 2);
  const windows = [[GLINT.wide, OPACITY.glintFaint], [GLINT.mid, OPACITY.glintMid], [GLINT.narrow, 1]];
  const slide = (el, id, left) => {
    assert.deepEqual(calls(el, "id"), [["id", id]]);
    assert.deepEqual(calls(el, "left"), [["left", left]]);
    same(calls(el, "transition"), [["transition", "left", { duration: SWEEP_MS, easing: GLINT_EASE }]]);
  };
  for (const stage of ["start", "run"]) {
    const el = glint("Atlas", c, "a", stage);
    const drawn = nodes(el).filter((kid) => calls(kid, "opacity").length);
    assert.equal(drawn.length, windows.length);
    windows.forEach(([width, opacity], k) => {
      const window = drawn[k], id = `a-sweep-${k}`;
      const left = stage === "start" ? -width : GLINT.run;
      assert.equal(one(window, "w"), width);
      assert.equal(one(window, "opacity"), opacity);
      slide(window, id, left);
      assert.equal(window.kids.length, 1);
      const [copy] = window.kids;
      slide(copy, `${id}-text`, -left);
      assert.equal(one(copy, "child"), "Atlas");
    });
    assert.equal(callsIn(el, "transition").length, windows.length * 2);
    assert.deepEqual(callsIn(el, "loop"), []);
  }
});

test("On battery a working name sweeps once too", async () => {
  const mains = await kit(false), battery = await kit(true);
  for (const stage of ["start", "run"]) {
    const drawn = ({ glint, c }) => JSON.stringify(["transition", "left", "loop"].map((method) => callsIn(glint("Atlas", c, "a", stage), method)));
    assert.equal(drawn(battery), drawn(mains), stage);
  }
  assert.equal(callsIn(battery.glint("Atlas", battery.c, "a", "run"), "transition").length, 6);
});

test("A working name draws no dots after it, glinting or still on battery", async () => {
  for (const battery of [false, true]) {
    const { glint, c } = await kit(battery);
    const el = glint("Atlas", c, "a", "start");
    assert.deepEqual(callsIn(el, "frames"), [], "no dots step");
    assert.equal(el.kids.length, 1, "no room is kept for them");
  }
});

test("The glint takes every size and pace from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-glint.js"), []);
});
