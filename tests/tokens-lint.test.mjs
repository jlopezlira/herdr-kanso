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
    "kanso/mods/x/main.js:2: 0.45 is a literal opacity: use OPACITY, BEAT or BREATH from ui.js",
    "kanso/mods/x/main.js:2: 0.75 is a literal opacity: use OPACITY, BEAT or BREATH from ui.js",
    "kanso/mods/x/main.js:3: 220 is a literal duration: use EASE or GLIDE from ui.js",
  ]);
});

test("A wash, an opacity or a duration split over lines, or with a space before its colon, still fails", () => {
  const file = "kanso/mods/x/main.js";
  const text = "div().opacity(\n  0.75\n)\n  .opacity(2)\n  .bg(t.accent +\n    \"40\")\n  .transition(\"left\", { duration : 220 })";
  assert.deepEqual(looks([{ file, text }]).map(({ number, value }) => [number, value]), [[1, "0.75"], [4, "2"], [5, "\"40\""], [7, "220"]]);
});

test("Every tint is the hex alpha it replaced, so nothing on screen changes", () => {
  const ui = read(UI);
  const TINT = JSON.parse(/export const TINT = (\{.*\});/.exec(ui)[1].replace(/(\w+):/g, "\"$1\":"));
  const bytes = Object.fromEntries(Object.entries(TINT).map(([name, share]) => [name, Math.round(share * 255).toString(16).padStart(2, "0")]));
  assert.deepEqual(bytes, {
    board: "05", chip: "06", cell: "08", hover: "0a", row: "0c", card: "10", tab: "12", pill: "14", diff: "18", faint: "1a",
    key: "1c", control: "1f", goal: "22", bound: "24", soft: "26", strong: "40", frame: "50", boundLine: "70", ring: "80", line: "8c",
  });
});

test("The baseline can only shrink: a listed violation that is gone fails", () => {
  const file = "kanso/mods/x/main.js";
  const found = violations([{ file, text: "div().gap(10)" }], tokens);
  assert.deepEqual(compare(found, [{ file, line: "div().gap(10)", value: 10 }]), []);
  const [error] = compare([], [{ file, line: "div().gap(10)", value: 10 }]);
  assert.match(error, /kanso\/tokens-baseline\.json lists kanso\/mods\/x\/main\.js: 10 in "div\(\)\.gap\(10\)", which is gone/);
});
