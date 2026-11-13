// Check the Storybook's structure, tokens, public copy, names and icons.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expand } from "../scripts/storybook-catalog.mjs";
import { lint, storyFiles } from "../scripts/lint-storybook.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const json = (file) => JSON.parse(read(file));
const records = expand(json("stories/catalog.json"));
const references = json("stories/references.json");
const files = storyFiles("stories");

test("Every page follows the structure lint", () => {
  assert.deepEqual(lint(), []);
});

test("Storybook styles use only token values beyond the reviewed literals", () => {
  const tokens = new Set(Object.values(json("kanso/tokens.json")).flat().filter((token) => token?.value).map((token) => String(token.value).toLowerCase()));
  const allowed = new Set(json("tests/fixtures/storybook-literals.json"));
  for (const file of ["stories/proto.css", "stories/frame.css"]) {
    const literals = [...read(file).replace(/\/\*[^]*?\*\//g, "").matchAll(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|-?\d*\.?\d+(?:px|rem|em)\b/gi)].map((match) => match[0].toLowerCase());
    assert.deepEqual([...new Set(literals.filter((literal) => !tokens.has(literal) && !allowed.has(literal)))], [], file);
  }
});

test("Public copy describes roles, not named sessions or people", () => {
  const prose = [
    ...references.pages.flatMap((page) => page.guidelines ?? []),
    ...records.flatMap((record) => [record.caption ?? "", ...(record.notes ?? [])]),
    ...Object.entries(files).filter(([path]) => path.endsWith(".mdx")).map(([, text]) => text),
  ].join("\n");
  for (const pattern of [
    /\b[\w-]+'s \+ and [\w-]+'s ⋯ are not drawn at rest/,
    /\([^(),]+, after the unified menu\)/,
    /Drawn at Only when needed: [^.]+ works and [^.]+ waits/,
    /(?:Tab bar|app\.settings) \([A-Z][a-z]+\)|no \?, [A-Z][a-z]+\)|\b[A-Z][a-z]+'s (?:pax-|markup)/,
    /\b(?:approved|designed|requested) by\b/i,
  ]) assert.doesNotMatch(prose, pattern);
});

test("Every approved page and every earlier state stays reachable by name", () => {
  const { pages, ids } = json("tests/fixtures/storybook-names.json");
  const titles = new Set(Object.values(files).flatMap((text) => [...text.matchAll(/(?:export default\s*\{\s*title:\s*|<Meta title=)"([^"]+)"/g)].map((match) => match[1])));
  const byId = new Map(records.map((record) => [record.id, record]));
  assert.deepEqual(pages.filter((page) => !titles.has(page) || !references.pages.some((reference) => reference.page === page)), []);
  assert.deepEqual(ids.filter((id) => !titles.has(byId.get(id)?.page)), []);
});

test("Drawings use only sprite symbols, and every icon is the exact Lucide shape", () => {
  const { icons } = json("tests/fixtures/lucide-icons.json");
  const shapes = (inner) => [...inner.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/?>/g)]
    .map(([, tag, attrs]) => [tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))]);
  const symbols = new Map([...read("stories/proto-sprite.svg").matchAll(/<symbol id="([^"]+)"[^>]*>([^]*?)<\/symbol>/g)].map(([, id, inner]) => [id, inner]));
  for (const [id, inner] of symbols) if (id.startsWith("lu-")) assert.deepEqual(shapes(inner), icons[id.slice(3)], id);
  const used = new Set(records.flatMap((record) => [...(record.html ?? "").matchAll(/href="#([^"]+)"/g)].map((match) => match[1])));
  assert.deepEqual([...used].filter((id) => !symbols.has(id)), []);
  assert.deepEqual([...used].filter((id) => !/^(?:lu|e|p)-/.test(id) && id !== "i-ptr"), []);
});
