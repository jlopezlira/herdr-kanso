import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expand, pack, recordsFrom, replaceSource } from '../scripts/storybook-catalog.mjs';
import { explainButton, explainErrors, normalizeExplain, normalizeFailureActions, normalizeFactHomes } from '../scripts/storybook-components.mjs';
import { cssBlocks } from '../scripts/storybook-css.mjs';
import { actionElements, elements, explainActions, markupElements, textOf } from '../scripts/storybook-markup.mjs';
import { storyFiles, structureErrors } from '../scripts/lint-storybook.mjs';
import { matches, storyTree } from './storybook-selectors.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('stories/catalog.json'));
const records = expand(catalog);

test('Pane headers leave branch and agent state in their sidebar homes', () => {
  for (const record of records.filter((record) => record.html)) assert.equal(normalizeFactHomes(record.html), record.html, record.id);
  const window = records.find((record) => record.id === 'proto/layouts-window-at-rest/WindowAtRest/Default').html;
  assert.ok(textOf(window).includes('main'));
  assert.ok(window.includes('title="Sleep this agent"'));
  assert.ok(window.includes('title="Send to another agent"'));
});

test('Fact normalization keeps PR verdicts, device status and every available action', () => {
  const header = '<div class="kanso-header"><span class="kanso-header__branch">main</span><svg class="kanso-mark"><use href="#e-work"/></svg><span class="kanso-header__segment"><svg class="kanso-mark"><use href="#e-done"/></svg>#166 · ready</span><button>Sleep</button></div>';
  const device = '<div class="kanso-row"><span class="kanso-row__directory">Off</span><button>Start</button></div>';
  const output = normalizeFactHomes(header + device);
  assert.equal(output, header.replace('<span class="kanso-header__branch">main</span>', '').replace('<svg class="kanso-mark"><use href="#e-work"/></svg>', '') + device);
  assert.equal(normalizeFactHomes(output), output);
});

test('A failed panel gives its repair the solid action and keeps Explain tonal', () => {
  let checked = 0;
  for (const record of records.filter((record) => record.html)) {
    const html = record.html;
    for (const group of markupElements(html).filter((node) => node.classes.includes('kanso-state-block__actions'))) {
      let block = group.parent;
      while (block && !block.classes.includes('kanso-state-block')) block = block.parent;
      if (!block || !html.slice(block.open, block.close).includes('kanso-mark--blocked')) continue;
      const first = actionElements(html).find((node) => node.start >= group.open && node.end <= group.close);
      if (!first || first.classes.includes('kanso-explain')) continue;
      assert.ok(first.classes.includes('kanso-button'), `${record.id}: ${textOf(html.slice(first.open, first.close))}`);
      assert.ok(!first.classes.includes('kanso-button--tonal'), record.id);
      assert.deepEqual(explainErrors(html), [], record.id);
      checked++;
    }
  }
  assert.ok(checked > 40);
});

test('Repair styling preserves disabled state, destination and independent actions', () => {
  const explain = explainButton('review');
  const input = `<div class="kanso-state-block"><svg class="kanso-mark--blocked"></svg><div class="kanso-state-block__actions"><button class="kanso-button--tonal kanso-control--focus" disabled data-action="save">Save draft</button>${explain}</div></div><button class="kanso-button--quiet">Discard</button>`;
  const output = normalizeFailureActions(input);
  assert.equal(output, input.replace('kanso-button--tonal kanso-control--focus', 'kanso-button kanso-control--focus'));
  assert.equal(normalizeFailureActions(output), output);
  const onlyExplain = `<div class="kanso-state-block"><svg class="kanso-mark--blocked"></svg><div class="kanso-state-block__actions">${explain}</div></div>`;
  assert.equal(normalizeFailureActions(onlyExplain), onlyExplain);
});

test('Empty states keep a tonal action while repair and Explain share equal columns', () => {
  const html = `<div class="kanso-state-empty"><button class="kanso-button--tonal">Open folder</button></div><div class="kanso-state-block"><div class="kanso-state-block__actions"><button class="kanso-button">Refresh</button>${explainButton()}</div></div>`;
  const tree = storyTree(html), nodes = [];
  const visit = (node) => { nodes.push(node); node.children.forEach(visit); };
  visit(tree);
  const rules = cssBlocks(read('stories/proto.css')).filter((rule) => !rule.startsWith('@')).map((rule) => {
    const brace = rule.indexOf('{');
    return [rule.slice(0, brace), Object.fromEntries(rule.slice(brace + 1, -1).split(';').map((part) => {
      const colon = part.indexOf(':');
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    }))];
  });
  const buttons = nodes.filter((node) => node.tag === 'button');
  const matching = (node) => rules.filter(([selector]) => matches(node, `:is(${selector})`));
  assert.ok(!matching(buttons[0]).some(([, declarations]) => declarations.background?.includes('var(--solid)')));
  assert.equal(rules.find(([selector]) => selector === '.kanso-button')[1].background, 'var(--solid)');
  assert.equal(rules.find(([selector]) => selector === '.kanso-button--tonal')[1].background, 'var(--w7)');
  const columns = matching(buttons[1]).filter(([, declarations]) => declarations.flex === '1 1 0');
  assert.ok(columns.length > 0);
  assert.ok(columns.some(([selector]) => matches(buttons[2], `:is(${selector})`)));
});

test('Explain is a named, escaped, accessible tonal button with the Lucide bot', () => {
  const target = 'review <draft> & "notes"';
  const html = explainButton(target);
  assert.deepEqual(explainErrors(html), []);
  assert.equal(textOf(html), `Explain to ${target}`);
  assert.equal(actionElements(html).length, 1);
  assert.equal(elements(html, 'kanso-icon').length, 1);
  assert.match(html, /aria-hidden="true"/);
  assert.ok(!html.includes('<draft>'));
});

test('Explain imports converge across old links, buttons and menu items without losing target or state', () => {
  const cases = [
    ['<span class="kanso-button--quiet">Explain it</span>', 'checkout', {}],
    ['<a class="kanso-button--quiet" href="#">Explain to review</a>', 'review', {}],
    ['<button class="kanso-button kanso-control--focus"><svg><use href="#lu-check"/></svg><span>Explain to review &amp; ship</span></button>', 'review & ship', { modifiers: ['kanso-control--focus'] }],
    ["<span role='menuitem' class='kanso-menu-item' aria-disabled='true'>Explain to checkout</span>", 'checkout', { disabled: true, role: 'menuitem' }],
    ['<button disabled>Explain</button>', 'checkout', { disabled: true }],
    ['<button aria-label="Explain to review"></button>', 'review', {}],
  ];
  for (const [html, target, options] of cases) {
    const output = normalizeExplain(html);
    assert.equal(output, explainButton(target, options));
    assert.equal(normalizeExplain(output), output);
    assert.deepEqual(explainErrors(output), []);
  }
  const unrelated = '<button class="kanso-button--quiet">Open in a new tab</button>';
  assert.equal(normalizeExplain(unrelated), unrelated);
});

test('the structure lint rejects Explain without its own bot, tonal style or destination', () => {
  const valid = explainButton('checkout');
  const icon = elements(valid, 'kanso-icon')[0];
  const cases = [
    valid.replace(icon, ''),
    valid.replace('#lu-bot', '#lu-check'),
    valid.replace(icon, '') + icon,
    valid.replace('kanso-button--tonal', 'kanso-button--quiet'),
    valid.replace('kanso-explain', 'kanso-button--quiet'),
    valid.replace('Explain to checkout', '<span>Explain it</span>'),
    valid.replace('Explain to checkout', 'Explain to '),
    valid.replace('kanso-explain', ''),
    '<button aria-label="Explain to checkout"></button>',
    '<button title="Explain to checkout"></button>',
    '<button>Ask: Explain to checkout</button>',
  ];
  const files = storyFiles(), template = read('stories/kit/ComponentPage.jsx');
  for (const html of cases) {
    assert.equal(explainErrors(html).length, 1, html);
    const state = { ...records[0], html };
    const errors = structureErrors(files, pack([state]), template);
    assert.ok(errors.some((error) => /Explain action must be tonal with the bot icon/.test(error)), html);
  }
  assert.deepEqual(explainErrors(valid), []);
});

test('every Explain action in the complete catalog uses the shared component', () => {
  let count = 0;
  for (const record of records.filter((record) => record.html !== undefined)) for (const node of explainActions(record.html)) {
    const target = textOf(record.html.slice(node.open, node.close)).slice('Explain to '.length);
    assert.equal(record.html.slice(node.start, node.end), explainButton(target, {
      modifiers: node.classes.filter((name) => name.startsWith('kanso-control--')),
      disabled: Object.hasOwn(node.attrs, 'disabled'),
      role: node.attrs.role,
    }), record.id);
    count++;
  }
  assert.ok(count > 0);
});

test('all three source pipelines normalize Explain on regeneration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-explain-'));
  try {
    const html = '<span class="kanso-button--quiet">Explain it</span>';
    for (const [source, file, key] of [['proto', 'compositions-controls.json', 'Button'], ['panels', 'worktrees.json', 'AtRest'], ['coverage', 'menu.json', 'PaneMenu']]) {
      replaceSource(source, recordsFrom(source, file, { [key]: { html, caption: 'Explain a checkout.' } }), dir);
    }
    const imported = expand(JSON.parse(readFileSync(join(dir, 'stories/catalog.json')))).filter((record) => ['proto', 'panels', 'coverage'].includes(record.source));
    assert.equal(imported.length, 3);
    assert.ok(imported.every((record) => record.html === explainButton('checkout')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the open worktree keeps its facts and uses kit typography, spacing and equal-height actions', () => {
  const record = records.find((record) => record.id.includes('/components-worktree-row-open/'));
  const html = record.html;
  for (const text of ['promo-banner', '380 MB', '2 uncommitted changes', '6d', 'Loses src/web/Banner.tsx and src/web/promo.css, not committed.', '~/.kanso/worktrees/acme-shop/promo-banner']) assert.ok(textOf(html).includes(text), text);
  const actions = actionElements(html);
  assert.equal(actions.length, 3);
  assert.equal(textOf(html.slice(actions[0].open, actions[0].close)), 'Open in a new tab');
  assert.ok(actions[0].classes.includes('kanso-button--quiet'));
  assert.ok(actions[2].classes.includes('kanso-action--armed'));
  assert.deepEqual(elements(html.slice(actions[2].start, actions[2].end), 'kanso-icon'), []);
  assert.match(html.slice(actions[2].start, actions[2].end), /<span>Remove<\/span><span>Press again to remove<\/span>/);
  const tokens = Object.values(JSON.parse(read('kanso/tokens.json'))).flat().filter((token) => token?.name);
  const values = new Map(tokens.map((token) => [`--${token.name}`, token.value]));
  const tree = storyTree(html), nodes = [];
  const visit = (node) => { nodes.push(node); node.children.forEach(visit); };
  visit(tree);
  const rules = cssBlocks(read('stories/proto.css')).filter((rule) => !rule.startsWith('@')).map((rule) => {
    const brace = rule.indexOf('{');
    return [rule.slice(0, brace), Object.fromEntries(rule.slice(brace + 1, -1).split(';').map((declaration) => {
      const colon = declaration.indexOf(':');
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }))];
  });
  const style = (node) => Object.assign({}, ...rules.filter(([selector]) => matches(node, `:is(${selector})`)).map(([, declarations]) => declarations));
  const value = (className, property) => style(nodes.find((node) => (node.attrs.class ?? '').split(' ').includes(className)))[property]?.replace(/var\((--[\w-]+)\)/g, (_, token) => values.get(token) ?? token);
  for (const [className, property, expected] of [
    ['kanso-worktree--open', 'padding', '12px'],
    ['kanso-worktree__name', 'font-size', '13.5px'],
    ['kanso-worktree__name', 'font-weight', '500'],
    ['kanso-worktree__body', 'font-size', '12.5px'],
    ['kanso-worktree__meta', 'font-size', '11.5px'],
    ['kanso-worktree__meta', 'color', '--dim'],
    ['kanso-worktree__actions', 'gap', '8px'],
    ['kanso-worktree__actions', 'margin-top', '8px'],
    ['kanso-action--armed', 'display', 'inline-grid'],
  ]) assert.equal(value(className, property), expected, `${className}: ${property}`);
  for (const node of nodes.filter((node) => node.tag === 'button')) assert.equal(style(node).height, 'var(--k-h-control)');
  assert.equal(values.get('--k-h-control'), '30px');
  assert.deepEqual(explainErrors(html), []);
});

test("Pane headers and status bars leave working state in its one home", () => {
  for (const record of records.filter((record) => record.html)) {
    for (const node of markupElements(record.html)) {
      if (node.classes.some((name) => /^kanso-header(?:--rest)?$/.test(name))) assert.ok(!node.classes.includes("kanso-row--blocked"), record.id);
      if (node.classes.includes("kanso-status-bar__item")) assert.doesNotMatch(textOf(record.html.slice(node.open, node.close)), /^\d+ of \d+ working$/, record.id);
    }
  }
});

test("Panel and layout inline type uses the shared kit roles", () => {
  for (const record of records.filter((record) => record.html && /^(Panels|Layouts)\//.test(record.page))) assert.doesNotMatch(record.html, /font-size:(?:48|20|15|13\.5|12\.5|11\.5)px/, record.id);
});
