// The key hint: a chord on a thin edge, faint when unset, breathing in the accent while it records.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, numberArguments, calls, one, boxOf } from "./helpers.mjs";

const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "BREATH", "G", "H", "R", "T"], gpuiHost()),
  ...await load("kanso-panel/ui-key-hint.js", ["keyHint"], gpuiHost()),
});

const night = { foreground: "#d8d4cb", background: "#1b1b19", border: "#33332f", accent: "#da627d", dim: "#6b6862", muted: "#949086" };

test("A key hint is 24 high, 8 inside, radius 4, the meta size in muted on the border's edge", async () => {
  const { keyHint, tokens, G, H, R, T } = await kit();
  const c = tokens(night);
  const el = keyHint(c, { text: "⌘↵" });
  assert.deepEqual([H.compact, G.sm, R.sm], [24, 8, 4]);
  assert.deepEqual(boxOf(el, "h", "px", "rounded"), [H.compact, G.sm, R.sm]);
  assert.equal(one(el, "border_color"), c.border);
  assert.equal(one(el, "text_size"), T.body);
  assert.equal(one(el, "text_color"), c.muted);
  assert.equal(one(el, "child"), "⌘↵");
  assert.equal(calls(el, "loop").length, 0);
  assert.equal(calls(el, "font_family").length, 0);
});

test("Faint is dim; recording is the accent on edge and text, breathing; a font sets the mono family", async () => {
  const { keyHint, tokens, BREATH } = await kit();
  const c = tokens(night);
  assert.equal(one(keyHint(c, { text: "No key", faint: true }), "text_color"), c.dim);
  const recording = keyHint(c, { text: "⌃⇧1", recording: true });
  assert.equal(one(recording, "border_color"), c.accent);
  assert.equal(one(recording, "text_color"), c.accent);
  assert.deepEqual(JSON.parse(JSON.stringify(calls(recording, "loop"))), [["loop", "opacity", { ...BREATH }]]);
  assert.equal(one(keyHint(c, { text: "⌘K", font: "JetBrains Mono" }), "font_family"), "JetBrains Mono");
});

test("The key hint's code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-key-hint.js"), []);
});
