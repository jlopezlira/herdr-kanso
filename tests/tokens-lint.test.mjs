import test from "node:test";
import assert from "node:assert/strict";
import { loadTokens, read } from "../scripts/tokens.mjs";
import { UI, withTokens } from "../scripts/build-ui-tokens.mjs";
import { check, compare, violations } from "../scripts/check-tokens.mjs";

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

test("The baseline can only shrink: a listed violation that is gone fails", () => {
  const file = "kanso/mods/x/main.js";
  const found = violations([{ file, text: "div().gap(10)" }], tokens);
  assert.deepEqual(compare(found, [{ file, line: "div().gap(10)", value: 10 }]), []);
  const [error] = compare([], [{ file, line: "div().gap(10)", value: 10 }]);
  assert.match(error, /kanso\/tokens-baseline\.json lists kanso\/mods\/x\/main\.js: 10 in "div\(\)\.gap\(10\)", which is gone/);
});
