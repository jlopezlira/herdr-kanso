// Both app themes meet every text and edge ratio on the design's contrast page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOT, contrast } from "../scripts/tokens.mjs";

const THEMES = { dark: "kanso/themes/kanso.json", light: "kanso/themes/kanso-day.json" };
const SURFACES = ["canvas", "chrome", "surface", "raised", "popover", "hover", "selected"];
// The focus ring is drawn in the accent colour.
const PAIRS = [
  ...["foreground", "muted", "dim"].flatMap((text) => SURFACES.map((surface) => [text, surface, 4.5])),
  ...["input", "accent", "working", "blocked", "done", "idle"].map((edge) => [edge, "surface", 3]),
];

for (const [theme, path] of Object.entries(THEMES)) {
  test(`Every text and edge in the ${theme} theme meets its contrast on each surface it sits on`, () => {
    const { colors } = JSON.parse(readFileSync(ROOT + path, "utf8"));
    const short = PAIRS.map(([fore, back, min]) => ({ fore, back, min, ratio: contrast(colors[fore], colors[back]) }))
      .filter(({ ratio, min }) => ratio < min)
      .map(({ fore, back, min, ratio }) => `${fore} on ${back}: ${ratio.toFixed(2)}:1, needs ${min}:1`);
    assert.deepEqual(short, []);
  });
}
