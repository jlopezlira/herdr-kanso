import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expand, generate, pack, replaceSource } from '../scripts/storybook-catalog.mjs';
import { gapDocument, overlapFor } from '../scripts/storybook-coverage.mjs';
import { withoutRepeats } from '../scripts/import-panels.mjs';
import { storyFiles, structureErrors } from '../scripts/lint-storybook.mjs';
import { featuresFor, statesFor } from '../stories/kit/catalog.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('stories/catalog.json'));
const records = expand(catalog), byId = new Map(records.map((record) => [record.id, record]));

test('every overlapping coverage feature has one designed reference or one source-linked design task', () => {
  const coverage = records.filter((record) => record.source === 'coverage');
  assert.equal(coverage.length, 621);
  for (const feature of coverage.filter(overlapFor)) {
    assert.equal(feature.html, undefined, feature.id);
    assert.notEqual(Boolean(feature.design), Boolean(feature.gap), feature.id);
    if (feature.design) {
      const design = byId.get(feature.design);
      assert.ok(['panels', 'proto'].includes(design.source), feature.id);
      assert.ok(design.html, feature.id);
      assert.equal(design.page, feature.page, feature.id);
      assert.ok(statesFor(feature.page).some((state) => state.coverage.some((item) => item.id === feature.id)), feature.id);
    } else assert.ok(featuresFor(feature.page).some((item) => item.id === feature.id && item.gap), feature.id);
    const [file, line] = feature.location.split(':');
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), feature.id);
    assert.ok(Number(line) > 0 && Number(line) <= read(file).split('\n').length, feature.id);
  }
});

test('Spend only draws designed states and lists its filter, plans and breakdown features for redesign', () => {
  const states = statesFor('Panels/Spend');
  assert.ok(states.length > 0);
  assert.ok(states.every((state) => ['proto', 'panels', 'kit'].includes(state.source)));
  assert.equal(states[0].id, 'panels/spend/SpendAtRestNow/Default');
  for (const id of ['Spend/Filter picker', 'SpendSettings/Plans', 'SpendSettings/Plan added', 'SpendBreakdown/Projects', 'SpendBreakdown/Models', 'SpendBreakdown/Sessions', 'SpendBreakdown/Tasks']) {
    assert.equal(byId.get(`coverage/spend/${id}`).gap, true, id);
  }
  for (const file of ['arrange', 'chrome', 'menu', 'tabs', 'toast']) {
    const remaining = records.filter((record) => record.id.startsWith(`coverage/${file}/`));
    assert.ok(remaining.length > 0, file);
    assert.ok(remaining.every((record) => record.html !== undefined && !record.design && !record.gap), file);
  }
});

test('Features to redesign matches the plain component lists and preserves existing feature language', () => {
  const markdown = read('stories/GAPS.md');
  assert.equal(markdown, gapDocument(records));
  assert.ok(markdown.startsWith('# Features to redesign\n'));
  assert.match(markdown, /features exist in the code/);
  const gaps = records.filter((record) => record.gap);
  assert.equal(markdown.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Module') && !line.startsWith('| ---')).length, gaps.length);
  for (const gap of gaps) assert.ok(markdown.includes(gap.location), gap.id);
  for (const record of records) assert.doesNotMatch([record.label, record.caption, record.context, ...(record.notes ?? [])].join(' '), /\b(?:removed|subtracted)\b/i, record.id);
});

test('regeneration never stores an old panel stub for matched or undesigned coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-coverage-design-'));
  try {
    const design = byId.get('panels/spend/SpendAtRestNow/Default');
    replaceSource('panels', [design], dir);
    const incoming = ['Period', 'Filter picker'].map((state) => ({ ...byId.get(`coverage/spend/Spend/${state}`), html: '<div class="kanso-panel">Legacy stub sentinel</div>' }));
    replaceSource('coverage', incoming, dir);
    const file = join(dir, 'stories/catalog.json');
    const first = readFileSync(file, 'utf8');
    const output = expand(JSON.parse(first));
    assert.doesNotMatch(first, /Legacy stub sentinel/);
    assert.equal(output.find((record) => record.id.endsWith('/Period')).design, design.id);
    assert.equal(output.find((record) => record.id.endsWith('/Filter picker')).gap, true);
    generate(dir);
    assert.equal(readFileSync(file, 'utf8'), first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('panel imports draw each frame once while preserving distinct frames and repeated content', () => {
  const first = '<div class="kanso-story__theme"><div class="kanso-row">Same</div><div class="kanso-row">Same</div></div>';
  const other = '<div class="kanso-story__theme">Other</div>';
  const wrap = (content) => `<div class="kanso-story">${content}</div>`;
  assert.equal(withoutRepeats(wrap(first + first)), wrap(first));
  assert.equal(withoutRepeats(wrap(first + other + first)), wrap(first + other));
  assert.equal(withoutRepeats(wrap(first + other)), wrap(first + other));
  assert.equal(withoutRepeats('<p>Keep text</p>'), '<p>Keep text</p>');
  assert.equal(withoutRepeats(wrap('Caption' + first + first)), wrap('Caption' + first + first));
});

test('structure lint rejects overlapping drawings, missing design targets and missing feature lists', () => {
  const feature = records.find((record) => record.gap), files = storyFiles(), template = read('stories/kit/ComponentPage.jsx');
  const raw = { ...feature, html: '<div class="kanso-panel">Legacy stub</div>' };
  assert.ok(structureErrors(files, pack([raw]), template).some((error) => /overlapping coverage/.test(error)));
  assert.ok(structureErrors(files, pack([{ ...feature, gap: undefined, design: 'missing' }]), template).some((error) => /missing designed drawing/.test(error)));
  assert.ok(structureErrors(files, pack([{ ...feature, location: '' }]), template).some((error) => /source location/.test(error)));
  assert.ok(structureErrors(files, catalog, template.replace('<h3>{FEATURE_LABEL}</h3>', '')).some((error) => /plain feature list/.test(error)));
});
