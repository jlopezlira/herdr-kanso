import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expand, generate, pack, pagesOf, recordsFrom, replaceSource } from '../scripts/storybook-catalog.mjs';
import { importCoverage } from '../scripts/import-coverage.mjs';
import { componentStory } from '../stories/kit/story.js';
import { content, statesFor } from '../stories/kit/catalog.js';
import { normalizeCss } from '../scripts/storybook-css.mjs';
import { lint, storyFiles, structureErrors } from '../scripts/lint-storybook.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('stories/catalog.json'));
const records = expand(catalog);
const template = read('stories/kit/ComponentPage.jsx');
const files = storyFiles();

test('all pages follow the six sections, component grouping and shared prompt contract', () => {
  assert.deepEqual(lint(), []);
});

test('the structure lint rejects each prohibited structure', () => {
  const path = 'stories/components/primitives-button.stories.js';
  for (const [title, message] of [['Coverage/Button', /outside the six/], ['Primitives/Hover', /state page/], ['Primitives/Field', /duplicate title/]]) {
    assert.ok(structureErrors({ ...files, [path]: files[path].replace('Primitives/Button', title) }, catalog, template).some((error) => message.test(error)), title);
  }
  assert.ok(structureErrors({ ...files, 'stories/outside.stories.ts': 'export default { title: "Coverage/Outside" };' }, catalog, template).some((error) => /outside the six/.test(error)));
  assert.ok(structureErrors({ ...files, 'stories/repeated.json': '{"html":"<button>Repeated</button>"}' }, catalog, template).some((error) => /repeated story markup/.test(error)));
  const mdx = 'stories/components/primitives-button.mdx';
  assert.ok(structureErrors({ ...files, [mdx]: files[mdx].replace(/<ComponentPage[^>]*\/>/, '') }, catalog, template).some((error) => /missing prompt/.test(error)));
  assert.ok(structureErrors(files, { ...catalog, parts: [...catalog.parts, catalog.parts[0]] }, template).some((error) => /repeated story markup/.test(error)));
  assert.ok(structureErrors({ ...files, [path]: files[path] + '\nconst html = "<button>Repeated</button>";' }, catalog, template).some((error) => /repeated story markup/.test(error)));
});

test('all 490 original stories and 1026 states survive, with only documented component revisions', () => {
  const before = JSON.parse(read('tests/fixtures/storybook-inventory.json'));
  const byId = new Map(records.map((record) => [record.id, record]));
  assert.equal(before.stories, new Set(before.records.map((record) => record.id.split('/').slice(0, 3).join('/'))).size);
  assert.equal(before.states, before.records.length);
  for (const old of before.records) {
    const state = byId.get(old.id);
    assert.ok(state, `Missing original state: ${old.id}`);
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    if (state.design || state.gap) {
      assert.equal(state.html, undefined, old.id);
      assert.ok(state.location, old.id);
      if (state.design) assert.ok(byId.get(state.design)?.html, old.id);
    } else {
      if (old.revisedHash) assert.ok(['Explain component', 'Worktree row layout', 'Single panel frame', 'Visual match'].includes(old.revision), old.id);
      assert.equal(hash(state.html), old.revisedHash ?? old.hash, old.id);
    }
    assert.equal(hash(state.caption), old.revisedCaptionHash ?? old.captionHash, `${old.id}: caption`);
    if (old.contextHash) assert.equal(hash(state.context), old.revisedContextHash ?? old.contextHash, `${old.id}: usage context`);
    if (old.specHash) assert.equal(hash(JSON.stringify(state.spec)), old.revisedSpecHash ?? old.specHash, `${old.id}: specification`);
  }
});

test('catalog packing preserves markup and reuses fragments across components', () => {
  assert.deepEqual(expand(pack(records)), records);
  const shared = new Map();
  const visit = (id, page) => {
    if (!shared.has(id)) shared.set(id, new Set());
    shared.get(id).add(page);
    if (Array.isArray(catalog.parts[id])) for (const child of catalog.parts[id]) visit(child, page);
  };
  for (const record of catalog.records) if (record.markup !== undefined) visit(record.markup, record.page);
  assert.ok([...shared].some(([id, pages]) => Array.isArray(catalog.parts[id]) && pages.has('Primitives/Button') && pages.has('Compositions/Header')));
});

test('regeneration is deterministic, and replacing one import preserves the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-structure-'));
  try {
    replaceSource('proto', records.filter((record) => record.source === 'proto'), dir);
    replaceSource('panels', records.filter((record) => record.source === 'panels'), dir);
    replaceSource('coverage', records.filter((record) => record.source === 'coverage'), dir);
    const first = readFileSync(join(dir, 'stories/catalog.json'), 'utf8');
    const output = JSON.stringify(storyFiles(join(dir, 'stories/components')));
    generate(dir);
    assert.equal(readFileSync(join(dir, 'stories/catalog.json'), 'utf8'), first);
    assert.equal(JSON.stringify(storyFiles(join(dir, 'stories/components'))), output);
    const count = expand(JSON.parse(first)).filter((record) => record.source === 'coverage').length;
    assert.equal(count, 621);
    const incoming = recordsFrom('proto', 'compositions-controls.json', { Field: { html: '<div class="kanso-field">Name</div>', caption: 'A field.' } });
    replaceSource('proto', incoming, dir);
    const next = expand(JSON.parse(readFileSync(join(dir, 'stories/catalog.json'), 'utf8')));
    assert.equal(next.filter((record) => record.source === 'proto').length, 1);
    assert.equal(next.filter((record) => record.source === 'coverage').length, 621);
    assert.equal(next.filter((record) => record.source === 'panels').length, 290);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the kit CSS contains no repeated rules and shares forced and live state styling', () => {
  const css = read('stories/proto.css');
  assert.equal(normalizeCss(css), css);
  assert.match(css, /:is\(:hover,\.kanso-control--hover\)/);
  assert.match(css, /:is\(:focus-visible,\.kanso-control--focus\)/);
  assert.match(css, /:is\(:active,\.kanso-control--active\)/);
});

test('every required primitive and navigation variant has a discoverable home', () => {
  const pages = new Map(pagesOf(records));
  for (const name of ['Button', 'Field', 'Segmented', 'Switch', 'Mark', 'Chip', 'Row', 'Tab', 'Menu', 'Dialog', 'Skeleton', 'Drag handle', 'Key hint']) assert.ok(pages.has(`Primitives/${name}`), name);
  for (const name of ['Header', 'Sidebar', 'Rail']) for (const label of ['Open', 'Collapsed', 'Dawn']) assert.ok(pages.get(`Compositions/${name}`).some((state) => state.label === label), `${name}: ${label}`);
  for (const name of ['Colour', 'Type', 'Spacing', 'Radius', 'Motion', 'Icons']) assert.ok(pages.get(`Tokens/${name}`).some((state) => state.source === 'tokens'), name);
});

test('coverage regeneration maps classes, keeps variants and rejects unknown markup before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-coverage-'));
  try {
    const source = join(dir, 'input');
    mkdirSync(source);
    const data = { PaneMenu: { caption: 'Contextual actions; Seijaku keeps this component and its states in the shared kit.', variants: { Rest: { when: 'A pane is selected.', html: '<div class="menu"><span class="mi">Split</span></div>' } } } };
    const input = join(source, 'menu.json');
    writeFileSync(input, JSON.stringify(data));
    assert.equal(importCoverage(source, dir), 1);
    const file = join(dir, 'stories/catalog.json');
    const before = readFileSync(file, 'utf8');
    const state = expand(JSON.parse(before)).find((record) => record.source === 'coverage');
    assert.equal(state.page, 'Primitives/Menu');
    assert.equal(state.context, 'Contextual actions.');
    assert.equal(state.html, '<div class="kanso-menu"><span class="kanso-menu-item">Split</span></div>');
    importCoverage(source, dir);
    assert.equal(readFileSync(file, 'utf8'), before);
    data.PaneMenu.variants.Rest.html = '<div class="unknown">No</div>';
    writeFileSync(input, JSON.stringify(data));
    assert.throws(() => importCoverage(source, dir), /unmapped coverage class/);
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('state controls have unique URL-safe values and open on the current component', () => {
  for (const [page] of pagesOf(records)) {
    const states = statesFor(page);
    assert.equal(new Set(states.map((state) => state.value)).size, states.length, page);
    assert.ok(states.every((state) => /^[a-z0-9-]+$/.test(state.value)), page);
  }
  assert.equal(statesFor('Primitives/Button')[0].label, 'Default');
  assert.equal(statesFor('Panels/Files')[0].label, 'At rest, Now');
});

test('all built-in module panels have one panel page under their interface name', () => {
  const tabs = read('kanso/mods/kanso-tabs/main.js').split('const BUILTIN = [')[1].split('];')[0];
  const labels = new Map([...tabs.matchAll(/id: "([^"]+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]));
  const ids = [...read('kanso/mods/kanso-panel/main.js').split('const PANELS = {')[1].split('};')[0].matchAll(/(\w+):/g)].map((match) => match[1]);
  const pages = new Map(pagesOf(records));
  for (const id of new Set([...labels.keys(), ...ids])) {
    const name = labels.get(id) ?? id[0].toUpperCase() + id.slice(1);
    assert.ok(pages.has(`Panels/${name}`), `${id}: Panels/${name}`);
  }
});

test('every retained state is selectable and renders through its published component story', () => {
  let rendered = 0;
  for (const [page] of pagesOf(records)) {
    const story = componentStory(page);
    const states = statesFor(page);
    assert.equal(story.argTypes.state.options.length, states.length, page);
    for (const state of states) {
      assert.ok(story.argTypes.state.options.includes(state.value), state.id);
      assert.equal(story.render({ state: state.value }), content(state.markup), state.id);
      rendered++;
    }
  }
  assert.equal(rendered, records.filter((record) => record.html !== undefined).length);
});
