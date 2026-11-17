// The dot: a tone's colour at the kit's two sizes, and the only round fill a mod draws.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { load, gpuiHost, calls, KIT_NIGHT } from "./helpers.mjs";
import { sharedFile } from "../scripts/sync-share.mjs";

const MODS = new URL("../kanso/mods/", import.meta.url);
// A sized, round, filled shape with nothing inside it: a dot drawn by hand.
const HAND_DOT = /\.size\([^()]*\)(?:\.flex_none\(\))?\.rounded_full\(\)(?:\.flex_none\(\))?\.bg\((?:[^()]|\([^()]*\))*\)(?!\s*\.(?:flex|child|text))/g;

const arg = (el, name) => calls(el, name)[0]?.[1];

test("A dot takes a kit tone or a colour, at the medium size unless it is a small one", async () => {
  const { dot, DOT_SIZES } = await load("kanso-panel/ui-dot.js", ["dot", "DOT_SIZES"], gpuiHost());
  const { tokens, G } = await load("kanso-panel/ui.js", ["tokens", "G"], gpuiHost());
  const c = tokens(KIT_NIGHT);
  assert.deepEqual({ ...DOT_SIZES }, { sm: G.xs, md: G.sm });
  assert.equal(arg(dot(c, "blocked"), "bg"), c.blocked);
  assert.equal(arg(dot(c, "accent"), "bg"), c.accent, "a toast's information dot");
  assert.equal(arg(dot(c, "#1f6feb"), "bg"), "#1f6feb", "a label's own colour");
  assert.equal(arg(dot(c, "dim"), "size"), G.sm);
  assert.equal(arg(dot(c, "dim", "sm"), "size"), G.xs);
});

test("No mod draws a dot by hand: every one outside the kit is the kit's dot or mark", () => {
  const found = readdirSync(MODS, { recursive: true }).filter((path) => path.endsWith(".js") && !sharedFile(path.split("/").at(-1)))
    .flatMap((path) => readFileSync(new URL(path, MODS), "utf8").split("\n").flatMap((line, i) => (line.match(HAND_DOT) ? [`${path}:${i + 1}`] : [])));
  assert.deepEqual(found, []);
});
