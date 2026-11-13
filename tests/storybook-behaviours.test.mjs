import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cssBlocks } from '../scripts/storybook-css.mjs';
import { selectorClasses } from '../scripts/import-proto.mjs';
import { expand } from '../scripts/storybook-catalog.mjs';
import { markupElements } from '../scripts/storybook-markup.mjs';
import { ARM_MS, behaviours, matchingState, mountBehaviours } from '../stories/kit/behaviours.js';
import { dom } from './storybook-dom.mjs';
import { content, statesFor } from '../stories/kit/catalog.js';
import { componentStory } from '../stories/kit/story.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const catalog = expand(JSON.parse(read('stories/catalog.json')));
const kinds = new Set(['select', 'toggle', 'field', 'action', 'armed', 'surface', 'row', 'fold', 'drag', 'replay', 'annotate', 'animate']);

const controlClasses = (css) => cssBlocks(css).flatMap((rule) => {
  const brace = rule.indexOf('{'), selector = rule.slice(0, brace), body = rule.slice(brace + 1, -1);
  if (selector.startsWith('@')) return /@(?:media|supports|layer)/.test(selector) ? controlClasses(body) : [];
  if (!/cursor\s*:\s*(?:pointer|crosshair|grab|[\w-]*resize)/.test(body)) return [];
  return selectorClasses(selector).filter((name) => !['kanso-simulator__screen'].includes(name));
});
const missingClasses = (css) => [...new Set(controlClasses(css))].filter((name) => !behaviours[name]);

test('every CSS control class has a delegated behaviour in the shared table', () => {
  assert.deepEqual(missingClasses(read('stories/proto.css') + read('stories/frame.css')), []);
  for (const [name, kind] of Object.entries(behaviours)) {
    assert.match(name, /^kanso-[a-z0-9-]+(?:__[a-z0-9-]+)?$/);
    assert.ok(kinds.has(kind), `${name}: ${kind}`);
  }
  assert.equal(ARM_MS, 4000);
});

test('new CSS controls fail coverage until a behaviour is registered', () => {
  assert.deepEqual(missingClasses('.kanso-new-control:hover{cursor:pointer}'), ['kanso-new-control']);
  assert.deepEqual(missingClasses('@media (width > 1px){.kanso-new-control{cursor:pointer}}'), ['kanso-new-control']);
});

test('every semantic control in every catalog state belongs to a registered behaviour', () => {
  const missing = [];
  for (const record of catalog.filter((item) => item.html !== undefined)) {
    for (const node of markupElements(record.html)) {
      if (!['button', 'a', 'input', 'textarea', 'select'].includes(node.tag) && !['button', 'menuitem', 'textbox', 'switch'].includes(node.attrs.role) && node.attrs.tabindex === undefined) continue;
      let owner = node;
      while (owner && !owner.classes.some((name) => behaviours[name])) owner = owner.parent;
      if (!owner) missing.push(`${record.id}: ${node.tag}.${node.classes.join('.')}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('Spend switches among all five catalog periods, with distinct sample totals', () => {
  const states = statesFor('Panels/Spend');
  const totals = new Set();
  for (const label of ['Today', 'Month', '30 days', 'Year', 'All time']) {
    const state = matchingState(states, label);
    assert.equal(state.label, label);
    const html = content(state.markup);
    assert.ok(html.includes(`<span class="kanso-control--on">${label}</span>`));
    totals.add(/kanso-panel__metric-number">([^<]+)/.exec(html)[1]);
  }
  assert.equal(totals.size, 5);
  assert.equal(matchingState(states, 'All').label, 'All time');
  assert.equal(matchingState(states, 'Unknown'), undefined);
  assert.equal(matchingState(states, 'Settings: sources and plans, detected').label, 'Settings: sources and plans, detected');
});

test('matching variants stay in the active component family', () => {
  const states = [
    { value: 'a', label: 'First · Rest' }, { value: 'b', label: 'First · Pinned' },
    { value: 'c', label: 'Second · Rest' }, { value: 'd', label: 'Second · Pinned' },
  ];
  assert.equal(matchingState(states, 'Pinned', 'c').value, 'd');
  assert.equal(matchingState(states, 'Pinned', 'a').value, 'b');
});

test('every Controls state renders its original fixture after another state', () => {
  for (const page of new Set(catalog.filter((item) => item.html !== undefined).map((item) => item.page))) {
    const story = componentStory(page);
    for (const state of statesFor(page)) {
      assert.ok(story.argTypes.state.options.includes(state.value));
      assert.equal(story.render({ state: state.value }), content(state.markup), `${page}: ${state.label}`);
      story.render(story.args);
      assert.equal(story.render({ state: state.value }), content(state.markup));
    }
  }
  const preview = read('.storybook/preview.js');
  assert.match(preview, /useEffect\(\(\) => mountBehaviours\(frame,/);
  assert.match(preview, /updateArgs/);
});

test('delegated toggle and selection respond to nested clicks and preserve disabled controls', () => {
  const { root, get } = dom('<span class="kanso-switch"><i></i></span><span class="kanso-switch kanso-control--off"><i></i></span><div class="kanso-segmented"><span class="kanso-control--on">Today</span><span>Month</span></div>');
  const updates = [];
  const dispose = mountBehaviours(root, { page: 'Panels/Spend', updateArgs: (args) => updates.push(args) });
  get('.kanso-switch i').emit('click');
  assert.equal(get('.kanso-switch').getAttribute('aria-checked'), 'true');
  get('.kanso-control--off i').emit('click');
  assert.equal(get('.kanso-control--off').getAttribute('aria-checked'), 'false');
  get('.kanso-segmented').children[1].emit('click');
  assert.equal(updates[0].state, matchingState(statesFor('Panels/Spend'), 'Month').value);
  assert.equal(get('.kanso-segmented').children[0].getAttribute('aria-pressed'), 'false');
  dispose();
  get('.kanso-switch i').emit('click');
  assert.equal(get('.kanso-switch').getAttribute('aria-checked'), 'true');
});

test('Armed confirms on the second press, supports Undo, Escape and a fresh four-second timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { root, get, doc } = dom('<div class="kanso-row"><button class="kanso-button">Delete</button></div>');
  const dispose = mountBehaviours(root);
  const button = get('button');
  button.emit('click');
  assert.equal(button.getAttribute('aria-label'), 'Press again to delete');
  t.mock.timers.tick(2000);
  doc.emit('keydown', { key: 'Escape' });
  assert.equal(button.classList.contains('kanso-action--armed'), false);
  button.emit('click');
  t.mock.timers.tick(2001);
  assert.equal(button.classList.contains('kanso-action--armed'), true);
  button.emit('click');
  assert.equal(get('.kanso-row').hidden, true);
  get('.kanso-story__feedback button').emit('click');
  assert.equal(get('.kanso-row').hidden, false);
  button.emit('click');
  t.mock.timers.tick(ARM_MS + 1);
  assert.equal(button.classList.contains('kanso-action--armed'), false);
  assert.equal(button.textContent, 'Delete');
  dispose();
  assert.equal(t.mock.timers.tick(ARM_MS + 1), undefined);
});

test('fields focus, validate and filter sample rows while an empty search restores them', () => {
  const { root, get } = dom('<div class="kanso-field"><span role="textbox" aria-label="Find">retry</span></div><div class="kanso-search__count">1 of 2</div><div class="kanso-search__hit">Retry header</div><div class="kanso-search__hit">Cart total</div>');
  const dispose = mountBehaviours(root, { page: 'Panels/Find' });
  const editor = get('[role="textbox"]');
  editor.focus();
  assert.equal(get('.kanso-field').classList.contains('kanso-control--focus'), true);
  editor.emit('input');
  assert.equal(get('.kanso-search__count').textContent, '1 match');
  assert.equal(root.querySelectorAll('.kanso-search__hit')[1].hidden, true);
  editor.textContent = '';
  editor.emit('input');
  assert.equal(get('.kanso-search__count').textContent, '2 matches');
  assert.equal(editor.getAttribute('aria-invalid'), 'false');
  editor.blur();
  assert.equal(get('.kanso-field').classList.contains('kanso-control--focus'), false);
  dispose();
});

test('menus reopen, skip disabled items with arrows, and close outside or on Escape', () => {
  const { root, get, doc } = dom('<div class="kanso-menu"><div class="kanso-menu-item">First</div><div class="kanso-menu-item" aria-disabled="true">Off</div><div class="kanso-menu-item">Last</div></div>');
  const dispose = mountBehaviours(root);
  const menu = get('.kanso-menu'), items = root.querySelectorAll('.kanso-menu-item'), trigger = get('button');
  items[0].focus();
  items[0].emit('keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, items[2]);
  doc.emit('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, trigger);
  trigger.emit('click');
  assert.equal(menu.hidden, false);
  doc.emit('click');
  assert.equal(menu.hidden, true);
  dispose();
});

test('folds restore their contents and disposal cancels interactions before a new State render', () => {
  const { root, get } = dom('<div class="kanso-section--collapsible">Earlier</div><div class="kanso-row">Sample row</div>');
  const dispose = mountBehaviours(root);
  const heading = get('.kanso-section--collapsible'), row = get('.kanso-row');
  heading.emit('click');
  assert.equal(row.hidden, true);
  assert.equal(heading.getAttribute('aria-expanded'), 'false');
  heading.emit('click');
  assert.equal(row.hidden, false);
  dispose();
  heading.emit('click');
  assert.equal(row.hidden, false);
});

test('triggered dialogs use catalog fields, validate and return focus after Escape', () => {
  const { root, get, doc } = dom('<button class="kanso-button">New project</button>');
  const dispose = mountBehaviours(root);
  const trigger = get('button');
  trigger.emit('click');
  const dialog = get('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-hidden'), 'false');
  assert.ok(dialog.querySelector('[role="textbox"]'));
  doc.emit('keydown', { key: 'Escape' });
  assert.equal(dialog.hidden, true);
  assert.equal(doc.activeElement, trigger);
  trigger.emit('click');
  assert.equal(dialog.hidden, false);
  assert.equal(root.querySelectorAll('[role="dialog"]').length, 1);
  dispose();
});

test('copy feedback reflects the clipboard result', async () => {
  const { root, get, doc } = dom('<button class="kanso-button">Copy</button>');
  const copied = [];
  doc.defaultView.navigator.clipboard = { writeText: async (text) => { copied.push(text); } };
  const dispose = mountBehaviours(root);
  get('button').emit('click');
  await Promise.resolve();
  assert.deepEqual(copied, ['Copy']);
  assert.equal(get('[role="status"]').textContent, 'Copied');
  doc.defaultView.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  get('button').emit('click');
  await Promise.resolve();
  assert.match(get('[role="status"]').textContent, /Copy unavailable/);
  dispose();
});

test('every catalog state mounts and disposes the same delegated layer', () => {
  let count = 0;
  for (const page of new Set(catalog.map((record) => record.page))) for (const state of statesFor(page)) {
    const { root } = dom(content(state.markup));
    const dispose = mountBehaviours(root, { page, state: state.value });
    dispose();
    assert.ok([...root.listeners.values()].every((listeners) => listeners.size === 0), state.id);
    count++;
  }
  assert.equal(count, catalog.filter((record) => record.html !== undefined).length);
});
