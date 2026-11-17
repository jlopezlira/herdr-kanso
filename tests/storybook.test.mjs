// Check the Storybook's structure, tokens, public copy, names and icons.
import assert from "node:assert/strict";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { inTemporaryDir, repoText as read, svgShapes } from "./helpers.mjs";
import { expand } from "../scripts/storybook-catalog.mjs";
import { compositionErrors, lint, markupTags, primitiveErrors, rawValueErrors, rawValues, storyFiles, structureErrors } from "../scripts/lint-storybook.mjs";
import { statusOf, statusTags } from "../stories/kit/status.js";
import { rules } from "../stories/kit/rules.js";
import { promptFor } from "../stories/kit/prompt.js";
import { content, statesFor } from "../stories/kit/catalog.js";
import { tokenRecords } from "../scripts/storybook-kit.mjs";

const json = (file) => JSON.parse(read(file));
const records = expand(json("stories/catalog.json"));
const files = storyFiles("stories");

test("Every page follows the structure lint", () => {
  assert.deepEqual(lint(), []);
});

test("An element drawn outside a primitive is listed with its page, element and class", () => {
  const html = '<div class="kanso-story"><span class="kanso-row kanso-text--dim"><b>ok</b></span><div class="kanso-keyboard__row"><i></i></div><p class="kanso-text--dim">raw</p></div>';
  assert.deepEqual(primitiveErrors([{ page: "Panels/Dojo", html }], new Set(["kanso-row"]), new Set(["kanso-text--dim"])), [
    "Panels/Dojo: <div> kanso-keyboard__row is not a primitive",
    "Panels/Dojo: <p> raw markup outside a primitive",
  ]);
});

test("An element is counted once per node, so the same miss on two nodes counts twice", () => {
  const html = '<div class="kanso-story"><p>one</p><p>two</p></div>';
  assert.equal(primitiveErrors([{ page: "Panels/Dojo", html }], new Set(), new Set()).length, 2);
});

// The lint's errors for one file after that file changes, in a copy of the Storybook.
const lintChanged = (file, text) => inTemporaryDir("kanso-lint-", (root) => {
  for (const dir of ["stories", ".storybook", "scripts/storybook-raw-values.json"]) cpSync(dir, join(root, dir), { recursive: true });
  writeFileSync(join(root, file), text);
  return lint(root).filter((error) => error.startsWith(file));
});

test("A primitive given an inline style or a raw px or colour fails the lint", () => {
  const css = "stories/primitives.css";
  const raw = [`${css}: raw width:937px is not a token or a primitive`, `${css}: raw color:#123456 is not a token or a primitive`];
  const html = '<div class="kanso-row" style="width:937px;color:#123456">x</div>';
  assert.deepEqual(rawValueErrors(rawValues("Panels/Dojo", html), []), ['Panels/Dojo: inline style="width:937px;color:#123456" is not a token or a primitive']);
  assert.deepEqual(rawValueErrors(rawValues(css, ".kanso-row{width:937px;color:#123456;gap:var(--k-sp-2)}", true), []), raw);
  assert.deepEqual(lintChanged(css, `${read(css)}.kanso-row{width:937px;color:#123456}\n`), raw);
});

test("A component size passed as geometry data must be a token, while a placed region keeps its board pixels", () => {
  const html = '<span class="kanso-skeleton" data-width="110"></span><i data-left="4" data-top="8" data-width="30"></i><i data-height="40%"></i><i data-height="var(--k-sp-2)"></i>';
  assert.deepEqual(rawValues("Panels/Files", markupTags(html)), [{ source: "Panels/Files", value: 'raw data-width="110"' }]);
});

test("A pull request number a story shows is not a raw colour, while a colour in its markup still is", () => {
  const html = '<div class="kanso-panel__scope" data-tone="#fa0" aria-label="Open PR #142">#142 · src/api</div>';
  assert.deepEqual(rawValues("Panels/PR", markupTags(html)), [{ source: "Panels/PR", value: "raw #fa0" }]);
});

// The kit's compositions, and the lint's errors with one more line added.
const compositions = () => {
  const source = read("stories/kit/compositions.js");
  return { source, added: (line) => compositionErrors(`${source}${line}\n`) };
};

test("A composition that draws its own markup fails the lint", () => {
  const file = "stories/kit/compositions.js";
  const { source, added } = compositions();
  assert.deepEqual(compositionErrors(source), []);
  assert.deepEqual(added("export const extra = () => stack({ variant: 'rows' }).replace('div', '<div>');"), [`${file}: markup tag in a composition`]);
  assert.deepEqual(added("export const extra = () => stack({ variant: 'rows' }).replace('div', 'div class=x');"), [`${file}: class attribute in a composition`]);
  assert.deepEqual(added("export const extra = () => 'kanso-row';"), [`${file}: class string in a composition`]);
  assert.deepEqual(lintChanged(file, `${source}export const extra = () => '<span class="kanso-row">';\n`), [
    `${file}: markup tag in a composition`,
    `${file}: class attribute in a composition`,
    `${file}: class string in a composition`,
  ]);
});

test("A composition that treats pieces as strings fails the lint", () => {
  const { source, added } = compositions();
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

test("A composition that imports anything but the shared kit fails the lint", () => {
  const source = read("stories/kit/compositions.js");
  for (const line of ["import { row } from './pieces.js';", "import { badge } from './helpers.js';", "import './helpers.js';", "export const extra = () => import('./helpers.js');", "export { badge } from './helpers.js';"]) {
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
    ...Object.values(rules).flat(),
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

test("Every earlier state stays reachable by name", () => {
  const { ids } = json("tests/fixtures/storybook-names.json");
  const titles = new Set(Object.values(files).flatMap((text) => [...text.matchAll(/(?:export default\s*\{\s*title:\s*|<Meta title=)"([^"]+)"/g)].map((match) => match[1])));
  const byId = new Map(records.map((record) => [record.id, record]));
  assert.deepEqual(ids.filter((id) => !titles.has(byId.get(id)?.page)), []);
});

test("Drawings use only sprite symbols, and every icon is the exact Lucide shape", () => {
  const { icons } = json("tests/fixtures/lucide-icons.json");
  const symbols = new Map([...read("stories/proto-sprite.svg").matchAll(/<symbol id="([^"]+)"[^>]*>([^]*?)<\/symbol>/g)].map(([, id, inner]) => [id, inner]));
  for (const [id, inner] of symbols) if (id.startsWith("lu-")) assert.deepEqual(svgShapes(inner), icons[id.slice(3)], id);
  const used = new Set(records.flatMap((record) => [...(record.html ?? "").matchAll(/href="#([^"]+)"/g)].map((match) => match[1])));
  assert.deepEqual([...used].filter((id) => !symbols.has(id)), []);
  assert.deepEqual([...used].filter((id) => !/^(?:lu|e|p)-/.test(id) && id !== "i-ptr"), []);
});

test("An approved page is ready with no tag, and every other page is in review", () => {
  assert.deepEqual(["Start/Philosophy", "Panels/Current"].map((page) => [statusOf(page), statusTags(page)]), [["Ready", []], ["In review", ["In review"]]]);
});

test("A page without its status tag, or with a code in its title, fails the lint", () => {
  const catalog = json("stories/catalog.json"), template = read("stories/kit/ComponentPage.jsx");
  const untagged = { ...files, "stories/components/panels-later.stories.js": files["stories/components/panels-pr.stories.js"].replaceAll("Panels/PR", "Panels/Later") };
  assert.ok(structureErrors(untagged, catalog, template).includes("stories/components/panels-later.stories.js: needs exactly one status tag"));
  const coded = { ...files, "stories/start/extra.mdx": '<Meta title="Start/S12 notes" tags={["Ready"]} />\n\n## Prompt for agents\n\n```text\nRead.\n```\n' };
  assert.ok(structureErrors(coded, catalog, template).includes("stories/start/extra.mdx: code in title Start/S12 notes"));
});

test("The kit's Mac keyboard matches the app's Help, and every keyboard has the same keys", async () => {
  const { keyboards } = await import("../stories/kit/compositions.js");
  const { ROWS, CAP } = await import("../kanso/mods/kanso-help/keymap.js");
  assert.deepEqual(keyboards.mac.rows, ROWS);
  for (const [key, name] of Object.entries(CAP)) assert.equal(keyboards.mac.caps[key] ?? "", name, key);
  const keysOf = (rows) => [...new Set(rows.flat().map(([key]) => key))].toSorted();
  for (const os of ["windows", "linux"]) assert.deepEqual(keysOf(keyboards[os].rows), keysOf(ROWS), os);
});

test("A notice is a toast only while a kansō window is on screen, and goes to the computer only when you are away", async () => {
  const { notice, systemMessage } = await import("../stories/kit/compositions.js");
  const item = { state: "failed", home: "update", text: "kansō was not updated", act: "Update", detail: "permission denied" };
  assert.equal(notice({ ...item, place: "home in view" }), null);
  assert.equal(notice({ ...item, place: "away" }), null);
  assert.match(notice({ ...item, place: "window on screen" }), /kansō was not updated/);
  assert.equal(systemMessage({ ...item, place: "window on screen" }), null);
  assert.deepEqual(systemMessage({ ...item, place: "away" }), { title: "kansō was not updated", body: "permission denied" });
});

test("Every notice the app sends today is a state and a home the notifications know", async () => {
  const { notice, noticeHomes, noticeStates } = await import("../stories/kit/compositions.js");
  const { appNotices } = await import("../stories/kit/samples.js");
  for (const [name, item] of Object.entries(appNotices)) {
    assert.ok(noticeStates.includes(item.state), name);
    assert.ok(noticeHomes.includes(item.home), name);
    assert.match(notice(item), /kanso-toast/, name);
  }
});

test("The pane header folds its facts in the order the fold list names, and ⋯ takes the tools that fold", async () => {
  const { paneFolds, paneHeader, paneMenu } = await import("../stories/kit/compositions.js");
  const place = { folder: "checkout-v2", branch: "limits-table" };
  const at = (step) => paneHeader({ name: "checkout", place, hover: true, fold: paneFolds.indexOf(step) });
  assert.match(at("nothing"), /checkout-v2/);
  assert.doesNotMatch(at("folder"), /checkout-v2/);
  assert.match(at("folder"), /limits-table/);
  assert.doesNotMatch(at("branch"), /limits-table/);
  assert.match(at("branch"), /Split right/);
  assert.doesNotMatch(at("tools into ⋯"), /Split right/);
  assert.doesNotMatch(paneMenu({ name: "checkout", fold: paneFolds.indexOf("branch") }), /Split right/);
  assert.match(paneMenu({ name: "checkout", fold: paneFolds.indexOf("tools into ⋯") }), /Split right/);
});

test("A shortcut row at rest draws without a taken key", async () => {
  const { shortcutRow } = await import("../stories/kit/compositions.js");
  assert.match(shortcutRow({ name: "Pin the pane", chords: ["⌥⌘P"] }), /⌥⌘P/);
});

test("Every hypothesis fills the whole template, and each job names where it goes", async () => {
  const { hypotheses } = await import("../stories/kit/hypotheses.js");
  const fields = ["change", "today", "why", "question", "believe", "wrong", "try", "back"];
  for (const [page, list] of Object.entries(hypotheses)) for (const item of list) {
    for (const field of fields) assert.ok(typeof item[field] === "string" && item[field].trim(), `${page}: ${item.change ?? "?"} has no ${field}`);
    assert.ok(Array.isArray(item.jobs) && item.jobs.length > 0, `${page}: ${item.change} has no jobs`);
    for (const job of item.jobs) assert.ok(job.length === 2 && job.every((part) => typeof part === "string" && part.trim()), `${page}: ${item.change} has a job without a home`);
  }
});

test("A panel is only a container: the header it is given over the body, each look a width, stale stepping down all but the header", async () => {
  const { panel, panelHeader, panelLooks } = await import("../stories/kit/compositions.js");
  assert.equal(panel({}, "<p>body</p>"), '<div class="kanso-panel"><p>body</p></div>');
  assert.match(panel({ header: panelHeader({ title: "Ports" }) }, "<p>body</p>"), /^<div class="kanso-panel"><div class="kanso-panel-header">[^]*<\/div><p>body<\/p><\/div>$/);
  for (const look of panelLooks) assert.match(panel({ look }), look === "panel" ? /^<div class="kanso-panel">/ : new RegExp(`kanso-panel--${look}`), look);
  assert.match(panel({ stale: true }, "<p>body</p>"), /^<div class="kanso-panel kanso-panel--stale">/);
  assert.throws(() => panel({ look: "wide" }), { message: "panel: unknown look wide" });
});

test("A panel header needs only its title; what goes before it, under it and after it is that panel's own", async () => {
  const { panelHeader, panelHeaderForms } = await import("../stories/kit/compositions.js");
  const bare = panelHeader({ title: "Files" });
  assert.match(bare, /^<div class="kanso-panel-header"><div class="kanso-row kanso-row--title" tabindex="0"><span class="kanso-row__name">Files<\/span><span class="kanso-layout__grow"><\/span><\/div><\/div>$/);
  const full = panelHeader({ title: "limits.md", form: "bar", start: ["<i>back</i>"], second: "~/acme-shop/docs", tools: ["<i>tool</i>"] });
  assert.match(full, /^<div class="kanso-panel-header kanso-panel-header--bar">[^]*<i>back<\/i><span class="kanso-row__name">limits\.md<[^]*<i>tool<\/i>[^]*~\/acme-shop\/docs/);
  assert.deepEqual(panelHeaderForms, ["page", "bar"]);
  assert.throws(() => panelHeader({ title: "Ports", form: "card" }), { message: "panelHeader: unknown form card" });
});

test("The sidebar's + names what it adds in each view, and Sort is quiet at its default", async () => {
  const { addLabels, toolbar, views } = await import("../stories/kit/compositions.js");
  assert.deepEqual(Object.keys(addLabels), views.map((view) => view.key));
  for (const [view, label] of Object.entries(addLabels)) assert.match(toolbar({ view }), new RegExp(`title="${label}"`), view);
  assert.match(toolbar(), /<span class="kanso-toolbar__sort">/);
  assert.match(toolbar({ sorted: true }), /<span class="kanso-toolbar__sort kanso-toolbar__sort--sorted">/);
  assert.match(toolbar({ sortMenu: "<i>menu</i>" }), /kanso-button--active[^]*<span class="kanso-toolbar__menu"><i>menu<\/i><\/span>/);
});

test("A menu can head a group of its items", async () => {
  const { menu } = await import("../stories/kit/pieces.js");
  assert.match(menu({ items: [{ label: "Last update" }, { separator: true }, { heading: "Show" }, { label: "Dawn sky" }] }), /kanso-menu__separator"><\/div><div class="kanso-menu__heading">Show<\/div><div class="kanso-menu__item"/);
});

test("A file opened from a panel keeps the button back to its folder's list before the title", async () => {
  const { statedPages } = await import("../stories/kit/states.js");
  const { args, markup } = statedPages["Compositions/Panel"];
  const back = /kanso-content__primary"><span class="kanso-button kanso-button--icon" tabindex="0" title="Markdown in this folder"><svg[^>]*><use href="#lu-chevron-left"\/><\/svg><\/span><span class="kanso-row__name">/;
  assert.match(markup({ ...args, look: "window" }), back);
  assert.doesNotMatch(markup(args), back);
});

test("Every read of the sample panel draws its own state pattern where the list would start", async () => {
  const { panelReads, statedPages } = await import("../stories/kit/states.js");
  const { args, markup } = statedPages["Compositions/Panel"];
  const marks = { loading: /kanso-skeleton__list/, empty: /kanso-state-empty/, failed: /kanso-state-block/, stale: /kanso-panel--stale/ };
  for (const state of Object.keys(panelReads)) {
    const html = markup({ ...args, state });
    for (const [other, pattern] of Object.entries(marks)) (other === state ? assert.match : assert.doesNotMatch)(html, pattern, `${state} and ${other}`);
  }
});

test("Each named state of a page is a preset of its playground, so the catalog draws it with the playground's markup", async () => {
  const { statedPages } = await import("../stories/kit/states.js");
  for (const [page, { args, markup, states }] of Object.entries(statedPages)) for (const state of states) {
    assert.deepEqual(Object.keys(state.args).filter((name) => !Object.hasOwn(args, name)), [], `${page}: ${state.label}`);
    assert.equal(typeof markup({ ...args, ...state.args }), "string", `${page}: ${state.label}`);
  }
});

test("A bar asked at a width the kit has no frame for fails instead of drawing at another", async () => {
  const { atWidth, barWidths } = await import("../stories/kit/frames.js");
  for (const width of barWidths) assert.match(atWidth(width, ""), new RegExp(`kanso-story--w${width}`));
  assert.throws(() => atWidth(900, ""), { message: "frames: unknown width 900" });
});

test("Icons open with the complete catalog and every current kit icon has its meaning", () => {
  const componentStory = vm.runInNewContext(`${read("stories/kit/story.js").replace(/^import .*;$/gm, "").replace("export function", "function")}\ncomponentStory`, { content, statesFor, playgrounds: {} });
  const story = componentStory("Tokens/Icons");
  const html = story.render(story.args);
  assert.equal([...html.matchAll(/class="kanso-icon__example"/g)].length, 72);
  for (const icon of ["command", "message-square-plus", "maximize-2", "minimize-2"]) {
    assert.match(html, new RegExp(`lu-${icon}</div><div class="kanso-icon__description">[^<]+`));
  }
});

test("Spacing, sizes, colour and motion each show their own tokens with a sample", () => {
  const tokens = json("kanso/tokens.json");
  const pages = tokenRecords(tokens);
  const html = (name) => pages.find((page) => page.page === `Tokens/${name}`).html;
  assert.deepEqual([...html("Spacing").matchAll(/class="kanso-tokens__name">--([^<]+)/g)].map((m) => m[1]), tokens.space.map((t) => t.name));
  for (const token of [...tokens.height, ...tokens.switch]) assert.ok(html("Sizes").includes(`var(--${token.name})`));
  for (const page of pages) {
    assert.doesNotMatch(page.html, /<td[^>]*><\/td>/);
    for (const token of tokens.board) assert.ok(!page.html.includes(`--${token.name}`));
  }
  for (const token of tokens.opacity) {
    assert.ok(html("Colour").includes(`--${token.name}`));
    assert.ok(!html("Motion").includes(`--${token.name}`));
  }
});

test("Motion and contrast samples use the shared action and mark primitives", () => {
  const pages = tokenRecords(json("kanso/tokens.json"));
  const motion = pages.find((page) => page.page === "Tokens/Motion").html;
  assert.match(motion, /kanso-action--armed/);
  assert.match(motion, /Press again to/);
  assert.doesNotMatch(motion, /kanso-tokens__arm"/);
  for (const token of json("kanso/tokens.json").motion) assert.ok(motion.includes(`var(--${token.name})`) || motion.includes(`data-token="${token.name}"`));
  const contrast = pages.find((page) => page.page === "Tokens/Contrast, light and dark").html;
  for (const state of ["working", "blocked", "done", "idle"]) assert.equal([...contrast.matchAll(new RegExp(`kanso-mark--${state}`, "g"))].length, 7);
});

test("Token prompts concern the tokens on their own page", () => {
  for (const page of new Set(records.filter((record) => record.page.startsWith("Tokens/")).map((record) => record.page))) {
    const prompt = promptFor(page, statesFor(page));
    assert.doesNotMatch(prompt, /Build Tokens|one .* component|refresh failure|irreversible actions|four-second Armed/);
    assert.ok(prompt.includes(page));
  }
});
