import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, calls, one, nodes, drawingHost, themed, KIT_NIGHT } from "./helpers.mjs";

const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "glyphOf", "ICON", "ICON_ROW", "ICON_INLINE", "ICON_CHROME", "SPIN"], drawingHost()),
  ...await load("kanso-panel/ui-button.js", ["button"], drawingHost()),
  ...await load("kanso-panel/ui-row.js", ["row"], drawingHost()),
}, KIT_NIGHT);

const glyph = (el) => nodes(el).find((kid) => calls(kid, "svg").length);
const pathOf = (el) => one(glyph(el), "svg");
const sideOf = (el) => one(glyph(el), "size");

const turnsInsteadOfIcon = (busy, mark, spin) => {
  assert.deepEqual(calls(mark, "spin").map((call) => call[1]), [spin]);
  assert.equal(nodes(busy).some((kid) => calls(kid, "svg").some((call) => String(call[1]).includes("refresh-cw"))), false);
};

test("A spinning button draws the working ensō at the icon's size, and the icon itself stays still", async () => {
  const { button, glyphOf, SPIN, c } = await kit();
  const working = glyphOf("working");
  const cases = [
    { kind: "icon", size: "sm" },
    { kind: "icon", size: "lg" },
    { kind: "icon", small: true },
    { kind: "icon" },
    { kind: "solid" },
  ];
  for (const options of cases) {
    const still = button("b", "Refresh", () => {}, c, { ...options, icon: "refresh-cw" });
    const busy = button("b", "Refresh", () => {}, c, { ...options, icon: "refresh-cw", spin: true });
    const mark = glyph(busy);
    assert.equal(pathOf(busy), working, JSON.stringify(options));
    assert.equal(sideOf(busy), sideOf(still), JSON.stringify(options));
    turnsInsteadOfIcon(busy, mark, SPIN);
    assert.equal(nodes(busy).filter((kid) => calls(kid, "spin").length).length, 1);
  }
});

test("A busy row leads with the working ensō at the row icon's size", async () => {
  const { row, glyphOf, ICON_ROW, SPIN, c } = await kit();
  const busy = row("r", c, { icon: "refresh-cw", name: "Updating", busy: true });
  const mark = glyph(busy);
  assert.equal(pathOf(busy), glyphOf("working"));
  assert.equal(sideOf(busy), ICON_ROW);
  turnsInsteadOfIcon(busy, mark, SPIN);
});

test("Only the working ensō spins in the kit", () => {
  const root = fileURLToPath(new URL("../kanso/mods/", import.meta.url));
  const spun = [];
  for (const dir of readdirSync(root)) {
    const folder = join(root, dir);
    let names = [];
    try { names = readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.startsWith("ui-") || !name.endsWith(".js")) continue;
      const lines = readFileSync(join(folder, name), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes(".spin(")) spun.push(dir + "/" + name + ":" + (i + 1) + ":" + line.trim());
      });
    }
  }
  assert.ok(spun.length > 0);
  assert.deepEqual(spun.filter((line) => !line.includes('art("working"')), []);
});
