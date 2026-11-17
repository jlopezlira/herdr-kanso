import test from "node:test";
import assert from "node:assert/strict";
import { loadTokens, read } from "../scripts/tokens.mjs";
import { UI, withTokens } from "../scripts/build-ui-tokens.mjs";
import { check, compare, looks, named, violations } from "../scripts/check-tokens.mjs";

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

test("A module-level number passed whole to a linted call fails with its file and line, an imported one too; token names and counts pass", () => {
  const sizes = { file: "kanso/mods/x/sizes.js", text: "export const VIEW = { title: 17 };\nexport const ROWS = 8;" };
  const main = { file: "kanso/mods/x/main.js", text: [
    "import { VIEW, ROWS } from \"./sizes.js\";",
    "const GAP = 6, EDGE = H.line; // a gap",
    "div().gap(GAP).h(EDGE).max_h(ROWS * H.line)",
    "  .h(on ? GAP : G.sm).text_size(VIEW.title)",
  ].join("\n") };
  assert.deepEqual(compare(named([sizes, main]), []), [
    "kanso/mods/x/main.js:3: gap(GAP) passes a module-level number: name its size in kanso/tokens.json",
    "kanso/mods/x/main.js:4: h(GAP) passes a module-level number: name its size in kanso/tokens.json",
    "kanso/mods/x/main.js:4: text_size(VIEW.title) passes a module-level number: name its size in kanso/tokens.json",
  ]);
});

test("A module-level size split over lines, sharing a line with another statement, in an object with named members, or offset from a name still fails; a count does not", () => {
  const file = "kanso/mods/x/main.js";
  const sizes = (text) => named([{ file, text }]).map(({ number, value }) => [number, value]);
  assert.deepEqual(sizes("const GAP =\n  6;\ndiv().gap(GAP);"), [[3, "GAP"]]);
  assert.deepEqual(sizes("const VIEW = {\n  title: 17, // the title\n  stale: OPACITY.away,\n};\ndiv().text_size(VIEW.title).h(VIEW.stale);"), [[5, "VIEW.title"]]);
  assert.deepEqual(sizes("const GAP = 6;\ndiv().gap(\n  GAP\n);"), [[2, "GAP"]]);
  assert.deepEqual(sizes("const GAP = 6; div().gap(GAP);"), [[1, "GAP"]]);
  assert.deepEqual(sizes("const A = 6; const B = 7;\ndiv().gap(A).gap(B);"), [[2, "A"], [2, "B"]]);
  assert.deepEqual(sizes("const EDGE = H.line,\n  PAD = 4;\ndiv().p(PAD).h(EDGE);"), [[3, "PAD"]]);
  assert.deepEqual(sizes("const PAD = GUIDE.x + ELBOW.w + 6 - 8;\nconst LIST = 8 * H.line;\ndiv().pl(PAD).max_h(LIST);"), [[3, "PAD"]]);
});

test("A hex-alpha wash, an opacity share or a duration fails outside ui.js; whole opacities and named ones pass", () => {
  const text = "div().bg(c.w4).opacity(OPACITY.away).opacity(on ? 1 : 0)\n  .bg(t.accent + \"40\").opacity(x ? 0.45 : f(0.75))\n  .transition(\"left\", { duration: 220 })";
  const errors = compare(looks([{ file: "kanso/mods/x/main.js", text }, { file: "kanso/mods/x/ui.js", text }]), []);
  assert.deepEqual(errors, [
    "kanso/mods/x/main.js:2: \"40\" is a literal hex-alpha wash: use c.w4, c.w7, c.w12, c.w14, CLEAR or alpha() with TINT from ui.js",
    "kanso/mods/x/main.js:2: 0.45 is a literal opacity: use OPACITY, BEAT, BREATH or PULSE from ui.js",
    "kanso/mods/x/main.js:2: 0.75 is a literal opacity: use OPACITY, BEAT, BREATH or PULSE from ui.js",
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
