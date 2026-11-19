import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { expand } from "../scripts/storybook-catalog.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const blockOf = (name) => name.split("--")[0];
const alone = (names) => names.filter((name) => name.includes("--") && !names.includes(blockOf(name)));
const pairOf = (names) => (name) => [names.filter((own) => !own.includes("--")).sort().join(" "), blockOf(name)].join(" | ");
const pairsIn = (html) => [...new JSDOM(html).window.document.querySelectorAll("[class]")]
  .map((node) => [...node.classList])
  .flatMap((names) => alone(names).map(pairOf(names)));

test("Every kit record mounts with each modifier on its block, except develop's committed pairs, which only shrink", () => {
  const records = expand(read("../stories/catalog.json")).filter(({ source, html }) => source === "kit" && html);
  const found = new Set(records.flatMap(({ html }) => pairsIn(html)));
  const allowed = read("./kit-modifiers.json");
  assert.ok(records.length > 700, `${records.length} kit records mounted`);
  assert.deepEqual([...found].filter((pair) => !allowed.includes(pair)).sort(), [], "a modifier without its block");
  assert.deepEqual(allowed.filter((pair) => !found.has(pair)), [], "no longer drawn: take it off the list");
});

test("A modifier without its block is found, and one beside its block is not", () => {
  assert.deepEqual(pairsIn('<i class="kanso-dot kanso-fill--accent"></i>'), ["kanso-dot | kanso-fill"]);
  assert.deepEqual(pairsIn('<i class="kanso-dot kanso-dot--accent"></i><b class="kanso-row__meta kanso-row__meta--late"></b>'), []);
});
