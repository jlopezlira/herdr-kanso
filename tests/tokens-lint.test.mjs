import test from "node:test";
import assert from "node:assert/strict";
import { loadTokens, read } from "../scripts/tokens.mjs";
import { UI, withTokens } from "../scripts/build-ui-tokens.mjs";
import { check, compare, looks, violations } from "../scripts/check-tokens.mjs";

const tokens = loadTokens();

test("ui.js carries the sizes of kanso/tokens.json", () => {
  const text = read(UI);
  assert.equal(withTokens(text, tokens), text, "run npm run build:ui-tokens");
});

test("Mods draw no size outside the tokens beyond the baseline", () => {
  assert.deepEqual(check(), []);
});

test("A new literal fails with its file and line; token values and 0 pass", () => {
  const file = "kanso/mods/x/main.js";
  const found = violations([{ file, text: "div()\n  .text_size(T.body).gap(G.sm)\n  .text_size(12.5).gap(8).rounded(6).h(30).min_w(0)\n  .text_size(13).gap(10)" }], tokens);
  assert.deepEqual(compare(found, []), [
    `${file}:4: text_size(13) is not a token value in kanso/tokens.json`,
    `${file}:4: gap(10) is not a token value in kanso/tokens.json`,
  ]);
});

test("A hex-alpha wash, an opacity share or a duration fails outside ui.js; whole opacities and named ones pass", () => {
  const text = "div().bg(c.w4).opacity(OPACITY.away).opacity(on ? 1 : 0)\n  .bg(t.accent + \"40\").opacity(x ? 0.45 : f(0.75))\n  .transition(\"left\", { duration: 220 })";
  const errors = compare(looks([{ file: "kanso/mods/x/main.js", text }, { file: "kanso/mods/x/ui.js", text }]), []);
  assert.deepEqual(errors, [
    "kanso/mods/x/main.js:2: \"40\" is a literal hex-alpha wash: use c.w4, c.w7, c.w12, c.w14, CLEAR or alpha() with TINT from ui.js",
    "kanso/mods/x/main.js:2: 0.45 is a literal opacity: use OPACITY, BREATH or PULSE from ui.js",
    "kanso/mods/x/main.js:2: 0.75 is a literal opacity: use OPACITY, BREATH or PULSE from ui.js",
    "kanso/mods/x/main.js:3: 220 is a literal duration: use EASE or GLIDE from ui.js",
  ]);
});

test("The baseline can only shrink: a listed violation that is gone fails", () => {
  const file = "kanso/mods/x/main.js";
  const found = violations([{ file, text: "div().gap(10)" }], tokens);
  assert.deepEqual(compare(found, [{ file, line: "div().gap(10)", value: 10 }]), []);
  const [error] = compare([], [{ file, line: "div().gap(10)", value: 10 }]);
  assert.match(error, /kanso\/tokens-baseline\.json lists kanso\/mods\/x\/main\.js: 10 in "div\(\)\.gap\(10\)", which is gone/);
});
