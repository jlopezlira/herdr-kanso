import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CLASSES, STORYBOOK_CLASSES, cssSelectors, markupClasses, renameCss, renameMarkup, selectorClasses } from "../scripts/import-proto.mjs";
import { matches, selectorCoverage, storyTree } from "./storybook-selectors.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const BEM = /^kanso-[a-z0-9]+(?:-[a-z0-9]+)*(__[a-z0-9-]+)?(--[a-z0-9-]+)?$/;
const stories = Object.fromEntries(readdirSync(join(root, "stories/proto")).filter((file) => file.endsWith(".json"))
  .flatMap((file) => Object.entries(json(`stories/proto/${file}`)).map(([name, story]) => [`${file}:${name}`, story.html])));
const valid = (names, source) => assert.deepEqual(names.filter((name) => !BEM.test(name) && !STORYBOOK_CLASSES.has(name)), [], source);

// Compound blocks include state-block, menu-item, tab-bar and status-bar.
test("kit, frame, preview and story classes use kanso BEM", () => {
  for (const file of ["stories/proto.css", "stories/frame.css", ".storybook/preview-head.html"]) {
    valid(cssSelectors(read(file)).flatMap(selectorClasses), file);
  }
  for (const [id, html] of Object.entries(stories)) valid(markupClasses(html), id);
  for (const dir of ["stories", "stories/proto"]) {
    for (const file of readdirSync(join(root, dir)).filter((name) => name.endsWith(".mdx"))) valid(markupClasses(read(`${dir}/${file}`)), `${dir}/${file}`);
  }
  const preview = read(".storybook/preview.js");
  const [, canvas, docs] = /frame\.className = [^?]+\? '([^']+)' : '([^']+)'/.exec(preview);
  valid(`${canvas} ${docs}`.split(/\s+/), ".storybook/preview.js");
  assert.deepEqual([...STORYBOOK_CLASSES], ["sb-show-main", "sbdocs", "sbdocs-wrapper", "sbdocs-content", "docs-story", "docblock-source"]);
});

test("the mapping covers the complete export class inventory without collisions", () => {
  const exported = json("tests/fixtures/storybook-export-classes.json");
  assert.deepEqual(exported.filter((name) => !Object.hasOwn(CLASSES, name)), []);
  valid(Object.values(CLASSES), "CLASSES");
  assert.equal(new Set(Object.values(CLASSES)).size, Object.keys(CLASSES).length);
  for (const name of exported) {
    assert.equal(renameCss(`.${name}{}`), `.${CLASSES[name]}{}`);
    assert.equal(renameMarkup(`<span class="${name}"></span>`), `<span class="${CLASSES[name]}"></span>`);
  }
});

test("renaming preserves selector structure, declarations, ids and theme attributes", () => {
  const css = '/* .unknown */ @media (width > 1px){:root[data-theme="dark"] .btn.arm>.i:hover,.ql:is(.off,.sm){background:url("a.btn.svg");content:".btn"}}';
  assert.equal(renameCss(css), '/* .unknown */ @media (width > 1px){:root[data-theme="dark"] .kanso-button.kanso-button--armed>.kanso-icon:hover,.kanso-button--quiet:is(.kanso-control--off,.kanso-button--small){background:url("a.btn.svg");content:".btn"}}');
  assert.equal(renameMarkup('<svg class="i i14"><use href="#lu-check"/></svg><span data-theme="dark" className=\'btn arm\'>btn</span>'), '<svg class="kanso-icon kanso-icon--row"><use href="#lu-check"/></svg><span data-theme="dark" className=\'kanso-button kanso-button--armed\'>btn</span>');
  assert.equal(renameCss(".sbdocs .docs-story,.sb-show-main .docblock-source{}"), ".sbdocs .docs-story,.sb-show-main .docblock-source{}");
  assert.throws(() => renameCss(".unknown{}"), /unmapped prototype class: unknown/);
  assert.throws(() => renameMarkup('<div class="btn unknown"></div>'), /unmapped prototype class: unknown/);
});

test("generation renames output and rejects unmapped classes before replacing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-bem-"));
  try {
    mkdirSync(join(dir, "site"));
    writeFileSync(join(dir, "site/tokens.css"), ":root{--canvas:#000}");
    const source = [{ group: "Compositions", title: "Field", html: '<div class="st-h"><b>Field</b><span>A field</span></div><div class="st-ex"><div class="k st-s free"><div class="kit-field foc">Name</div></div></div>' }];
    const save = () => writeFileSync(join(dir, "sb-atomic-stories.json"), JSON.stringify(source));
    save();
    writeFileSync(join(dir, "sb-atomic.css"), ".kit-field{cursor:pointer;transition:color 80ms}\n.kit-field.foc{color:red}");
    writeFileSync(join(dir, "sb-atomic-sprite.svg"), '<svg><symbol id="lu-check"/></svg>');
    writeFileSync(join(dir, "board-notes.md"), "");
    const run = () => spawnSync(process.execPath, [join(root, "scripts/import-proto.mjs"), dir], { cwd: dir, encoding: "utf8" });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(join(dir, "stories/proto/components-field.json"), "utf8");
    valid(markupClasses(JSON.parse(output).Field.html), "generated HTML");
    assert.match(output, /kanso-field kanso-control--focus/);
    assert.match(output, /tabindex/);
    assert.match(readFileSync(join(dir, "stories/proto/components-field.mdx"), "utf8"), /Reuse these kit classes: kanso-field/);
    assert.match(readFileSync(join(dir, "stories/proto.css"), "utf8"), /\.kanso-field\.kanso-control--focus\{color:red\}/);
    assert.equal(readFileSync(join(dir, "stories/proto-sprite.svg"), "utf8"), '<svg><symbol id="lu-check"/></svg>');
    source.push({ group: "Excluded", html: '<div class="unknown">Excluded from output</div>' });
    save();
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unmapped prototype class: unknown/);
    assert.equal(readFileSync(join(dir, "stories/proto/components-field.json"), "utf8"), output);
    source.pop(); save();
    writeFileSync(join(dir, "sb-atomic.css"), ".page .unknown{color:red}\n.kit-field{cursor:pointer;transition:color 80ms}");
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unmapped prototype class: unknown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("selector coverage respects structure, alternatives, states and both themes", () => {
  const tree = storyTree('<div class="a"><span class="b"></span><span class="c"></span></div>');
  const parent = tree.children[0].children[0].children[0], child = parent.children[0];
  assert.equal(matches(child, ".a > .b:first-child"), true);
  assert.equal(matches(child, ".a.b"), false);
  assert.equal(matches(parent.children[1], ".b + .c:nth-child(2)"), true);
  assert.equal(matches(parent, ".a:has(>.c)"), true);
  assert.equal(matches(child, ".b:has(+.c)"), true);
  assert.equal(matches(child, ".a :is(.b,.c):not(.d):hover::before"), true);
  assert.deepEqual(selectorCoverage(':root[data-theme="light"] .b{color:red}.a.c{}.a>.b:hover{}', { example: '<div class="a"><span class="b"></span><span class="c"></span></div>' }), {
    counts: { example: 2 }, unused: [".a.c"], selectors: 3,
  });
});

test("no additional kit selectors are unused; existing unused selectors are retained", () => {
  const coverage = selectorCoverage(read("stories/proto.css"), stories);
  assert.deepEqual(coverage.unused, json("tests/fixtures/storybook-unused-selectors.json"), "Review unused selectors; do not remove them as part of the naming change.");
});
