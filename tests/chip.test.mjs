// The chip: a count on a wash, or quiet as dim text, and a tone that colours either.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, numberArguments, calls, one, themed, boxOf } from "./helpers.mjs";

const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "toneColor", "G", "H", "R", "T"], gpuiHost()),
  ...await load("kanso-panel/ui-chip.js", ["chip"], gpuiHost()),
}, night);

const night = { foreground: "#d8d4cb", background: "#1b1b19", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f" };
const day = { foreground: "#2a2723", background: "#ebe8e2", dim: "#9a958c", muted: "#7a756c", blocked: "#9a6e68", working: "#8f7d52", done: "#6d7d62" };

test("A chip is one compact box from the tokens: 24 high, 8 inside, radius 6, on the 7% wash, in the meta size", async () => {
  const { chip, tokens, G, H, R, T } = await kit();
  for (const c of [night, day].map(tokens)) {
    const el = chip(c, { label: "3 files" });
    assert.deepEqual(boxOf(el, "h", "px", "rounded"), [H.compact, G.sm, R.control]);
    assert.equal(one(el, "bg"), c.w7);
    assert.equal(one(el, "text_size"), T.body);
    assert.equal(one(el, "text_color"), c.text);
    assert.equal(one(el, "child"), "3 files");
    assert.equal(calls(el, "whitespace_nowrap").length, 1);
  }
});

test("A quiet chip is dim text alone: no box, no wash", async () => {
  const { chip, T, c } = await kit();
  const el = chip(c, { label: 12, quiet: true });
  for (const name of ["h", "px", "rounded", "bg"]) assert.equal(calls(el, name).length, 0, name);
  assert.equal(one(el, "text_size"), T.body);
  assert.equal(one(el, "text_color"), c.dim);
  assert.equal(one(el, "child"), "12");
});

test("A tone colours the label, quiet or not", async () => {
  const { chip, toneColor, c } = await kit();
  for (const tone of ["blocked", "working", "done", "muted"]) {
    for (const quiet of [false, true]) assert.equal(one(chip(c, { label: 2, quiet, tone }), "text_color"), toneColor(c, tone), `${tone} ${quiet}`);
  }
  assert.equal(one(chip(c, { label: 2, tone: "blocked" }), "bg"), c.w7, "a tone keeps the wash");
});

test("The chip's code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-chip.js"), []);
});
