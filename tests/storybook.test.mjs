// Check the Storybook's structure, tokens, public copy, names and icons.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expand } from "../scripts/storybook-catalog.mjs";
import { compositionErrors, lint, storyFiles, structureErrors } from "../scripts/lint-storybook.mjs";
import { statusOf, statusTags } from "../stories/kit/status.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const json = (file) => JSON.parse(read(file));
const records = expand(json("stories/catalog.json"));
const references = json("stories/references.json");
const files = storyFiles("stories");

test("Every page follows the structure lint", () => {
  assert.deepEqual(lint(), []);
});

test("A composition that draws its own markup fails the lint", () => {
  const source = read("stories/kit/compositions.js");
  const added = (line) => compositionErrors(`${source}${line}\n`);
  assert.deepEqual(compositionErrors(source), []);
  assert.deepEqual(added("export const extra = () => stack({ variant: 'rows' }).replace('div', '<div>');"), ["stories/kit/compositions.js: markup tag in a composition"]);
  assert.deepEqual(added("export const extra = () => stack({ variant: 'rows' }).replace('div', 'div class=x');"), ["stories/kit/compositions.js: class attribute in a composition"]);
  assert.deepEqual(added("export const extra = () => 'kanso-row';"), ["stories/kit/compositions.js: class string in a composition"]);
  const root = mkdtempSync(join(tmpdir(), "kanso-lint-"));
  try {
    for (const dir of ["stories", ".storybook"]) cpSync(dir, join(root, dir), { recursive: true });
    writeFileSync(join(root, "stories/kit/compositions.js"), `${source}export const extra = () => '<span class="kanso-row">';\n`);
    assert.deepEqual(lint(root).filter((error) => error.startsWith("stories/kit/compositions.js")), [
      "stories/kit/compositions.js: markup tag in a composition",
      "stories/kit/compositions.js: class attribute in a composition",
      "stories/kit/compositions.js: class string in a composition",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A composition that treats pieces as strings fails the lint", () => {
  const source = read("stories/kit/compositions.js");
  const added = (line) => compositionErrors(`${source}${line}\n`);
  assert.deepEqual(added("export const extra = ({ name }) => row({ name: `Wake ${name}` });"), ["stories/kit/compositions.js: template literal in a composition"]);
  assert.deepEqual(added("export const extra = ({ names }) => names.map((name) => row({ name })).join();"), ["stories/kit/compositions.js: join in a composition"]);
  assert.deepEqual(added("export const extra = ({ open }) => list(row({ name: 'Asleep' }), open ? grow() : '');"), ["stories/kit/compositions.js: empty string as nothing in a composition"]);
  for (const line of [
    "export const extra = () => row({ name: 'a' }) + row({ name: 'b' });",
    "const a = row({ name: 'a' }), b = row({ name: 'b' });\nexport const extra = () => a + b;",
    "export const extra = () => { let rows = grow(); rows += row({ name: 'a' }); return rows; };",
    "export const extra = () => row({ name: 'a' }).concat(row({ name: 'b' }));",
    "export const extra = () => String(row({ name: 'a' }));",
    "export const extra = () => row({ name: 'a' }).toString();",
    "export const extra = (rows) => rows.reduce((all, one) => all + one);",
    "export const extra = ({ name }) => row({ name: 'Wake ' + name });",
  ]) assert.deepEqual(added(line), ["stories/kit/compositions.js: pieces added as strings in a composition"], line);
  assert.deepEqual(added("export const extra = () => row({ name: 'C++ build' });"), []);
});

test("A composition that imports anything but the pieces fails the lint", () => {
  const source = read("stories/kit/compositions.js");
  for (const line of ["import { badge } from './helpers.js';", "import './helpers.js';", "export const extra = () => import('./helpers.js');", "export { badge } from './helpers.js';"]) {
    assert.deepEqual(compositionErrors(`${source}${line}\n`), ["stories/kit/compositions.js: import from outside the pieces in a composition"], line);
  }
});

test("A stack with an unknown variant or state says which one", async () => {
  const { stack } = await import("../stories/kit/pieces.js");
  assert.equal(stack({ variant: "toolbar", column: true }, "x"), '<div class="kanso-toolbar kanso-toolbar--column">x</div>');
  assert.throws(() => stack({ variant: "row grop" }), { message: 'stack: unknown variant "row grop"' });
  assert.throws(() => stack({ variant: "rows", open: true }), { message: 'stack: variant "rows" has no state "open"' });
});

test("Storybook styles use only token values beyond the reviewed literals", () => {
  const tokens = new Set(Object.values(json("kanso/tokens.json")).flat().filter((token) => token?.value).map((token) => String(token.value).toLowerCase()));
  const allowed = new Set(json("tests/fixtures/storybook-literals.json"));
  for (const file of ["stories/primitives.css", "stories/compositions.css", "stories/proto.css", "stories/frame.css", "stories/utilities.css"]) {
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

test("An approved page is ready with no tag, and every other page is in review", () => {
  assert.deepEqual(["Start/Philosophy", "Panels/Current"].map((page) => [statusOf(page), statusTags(page)]), [["Ready", []], ["In review", ["In review"]]]);
});

test("A page without its status tag, or with a code in its title, fails the lint", () => {
  const catalog = json("stories/catalog.json"), template = read("stories/kit/ComponentPage.jsx");
  const untagged = { ...files, "stories/components/compositions-pane-header.stories.js": files["stories/components/compositions-pane-header.stories.js"].replace(/, tags: \[[^\]]*\]/, "") };
  assert.ok(structureErrors(untagged, catalog, template).includes("stories/components/compositions-pane-header.stories.js: needs exactly one status tag"));
  const coded = { ...files, "stories/start/extra.mdx": '<Meta title="Start/S12 notes" tags={["Ready"]} />\n\n## Prompt for agents\n\n```text\nRead.\n```\n' };
  assert.ok(structureErrors(coded, catalog, template).includes("stories/start/extra.mdx: code in title Start/S12 notes"));
});
