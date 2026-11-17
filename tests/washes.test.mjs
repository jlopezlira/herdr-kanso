// The kit's washes: the foreground, see-through, at the shares of the Colour page in each theme.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, gpuiHost as host } from "./helpers.mjs";
import { ROOT, loadTokens, colour, contrast, THEME_FILES as THEMES } from "../scripts/tokens.mjs";

const kit = () => load("kanso-panel/ui.js", ["tokens", "washes", "WASHES"], host());
const tokens = loadTokens();
const NAMES = ["w4", "w7", "w12", "w14"];
const share = (theme, name) => Number(/var\(--fg\) ([\d.]+)%, transparent\)$/.exec(tokens.colour[theme].find((x) => x.name === name).value)[1]) / 100;
const hex2 = (p) => Math.round(p * 255).toString(16).padStart(2, "0");
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (fg, bg, p) => `#${rgb(fg).map((v, i) => Math.round(v * p + rgb(bg)[i] * (1 - p)).toString(16).padStart(2, "0")).join("")}`;

test("The washes are the foreground at the Colour page's shares, in the dark and the light theme", async () => {
  const { tokens: kitTokens } = await kit();
  for (const [theme, path] of Object.entries(THEMES)) {
    const { foreground, background, colors } = JSON.parse(readFileSync(ROOT + path, "utf8"));
    const c = kitTokens({ ...colors, foreground, background });
    assert.deepEqual(NAMES.map((name) => c[name]), NAMES.map((name) => `${foreground}${hex2(share(theme, name))}`), theme);
  }
});

test("The dark theme's washes are 4, 7, 12 and 14 percent and the light theme's 5, 9.5, 18 and 21", async () => {
  const { WASHES, washes } = await kit();
  assert.deepEqual(JSON.parse(JSON.stringify(WASHES)), { dark: { w4: 0.04, w7: 0.07, w12: 0.12, w14: 0.14 }, light: { w4: 0.05, w7: 0.095, w12: 0.18, w14: 0.21 } });
  assert.equal(washes({ foreground: "#d8d4cb", background: "#161615" }).w7, "#d8d4cb12");
  assert.equal(washes({ foreground: "#2a2723", background: "#ebe8e2" }).w12, "#2a27232e");
});

test("A wash is never the opaque foreground: without a #rrggbb foreground the opaque hover and selected colours stay", async () => {
  const { washes, tokens: kitTokens } = await kit();
  for (const foreground of [undefined, "#fff", "red", "#2a2723zz"]) {
    assert.equal(washes({ foreground, background: "#ebe8e2" }), null, String(foreground));
    const c = kitTokens({ foreground, background: "#ebe8e2", hover: "#dddad5", selected: "#d4d1cb" });
    assert.deepEqual([c.w4, c.w7, c.w12, c.w14], ["#dddad5", "#dddad5", "#d4d1cb", "#d4d1cb"], String(foreground));
  }
  assert.equal(washes({ foreground: "#2a2723ff", background: "#ebe8e2" }).w7, "#2a272318", "a foreground with alpha takes the wash's own");
});

test("Without a background the washes read the canvas to tell a light theme from a dark one", async () => {
  const { washes } = await kit();
  assert.equal(washes({ foreground: "#2a2723", canvas: "#e2ded6" }).w12, "#2a27232e");
  assert.equal(washes({ foreground: "#d8d4cb", canvas: "#161615" }).w12, "#d8d4cb1f");
});

test("In the light theme the strip's tiles and the tree guides stand out from the sidebar's ground by at least 1.19:1", () => {
  const fg = colour(tokens, "light", "fg"), chrome = colour(tokens, "light", "chrome");
  const short = ["w7", "w12"].map((name) => ({ name, ratio: contrast(over(fg, chrome, share("light", name)), chrome) }))
    .filter(({ ratio }) => Number(ratio.toFixed(2)) < 1.19).map(({ name, ratio }) => `${name} on chrome: ${ratio.toFixed(3)}:1`);
  assert.deepEqual(short, []);
});
