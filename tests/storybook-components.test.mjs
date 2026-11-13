import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expand, pack, recordsFrom, replaceSource } from '../scripts/storybook-catalog.mjs';
import { explainButton, explainErrors, normalizeExplain } from '../scripts/storybook-components.mjs';
import { cssBlocks } from '../scripts/storybook-css.mjs';
import { actionElements, elements, explainActions, textOf } from '../scripts/storybook-markup.mjs';
import { storyFiles, structureErrors } from '../scripts/lint-storybook.mjs';
import { matches, storyTree } from './storybook-selectors.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const catalog = JSON.parse(read('stories/catalog.json'));
const records = expand(catalog);

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
