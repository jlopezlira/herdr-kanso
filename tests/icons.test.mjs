// Check that every app icon is Lucide's own drawing, and that only the ensō marks are drawn by kansō.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { repoText as read, svgShapes } from "./helpers.mjs";

const { icons } = JSON.parse(read("tests/fixtures/lucide-icons.json"));
const MARKS = ["enso-idle", "enso", "working"];
const FOLDERS = ["kanso/mods/kanso-chrome/icons/", "markdown-panel/mods/markdown-panel/icons/"];
const GRID = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
const rootOf = (markup) => Object.fromEntries([...markup.match(/<svg\b([^>]*)>/)[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));

test("Every app icon is the Lucide icon of its name, unchanged, and the ensō marks are the only drawings of kansō's own", () => {
  const files = FOLDERS.flatMap((folder) => readdirSync(new URL(`../${folder}`, import.meta.url)).filter((name) => name.endsWith(".svg")).map((name) => folder + name));
  const marks = files.filter((file) => MARKS.some((mark) => file.endsWith(`/${mark}.svg`)));
  assert.deepEqual(marks.map((file) => file.split("/").at(-1)).toSorted(), MARKS.map((mark) => `${mark}.svg`));
  for (const file of files.filter((name) => !marks.includes(name))) {
    const markup = read(file), root = rootOf(markup);
    assert.deepEqual(Object.fromEntries(Object.keys(GRID).map((name) => [name, root[name]])), GRID, file);
    assert.deepEqual(svgShapes(markup), icons[file.split("/").at(-1).slice(0, -4)], file);
  }
});
