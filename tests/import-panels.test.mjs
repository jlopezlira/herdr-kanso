import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { clean, closeOf, cssBlocks, drawing, entriesOf, panelCss, sourceEntries, withoutRepeats } from "../scripts/import-panels.mjs";
import { markupClasses } from "../scripts/import-proto.mjs";

test("Panel extraction keeps nested drawings and separates specifications from folded markup", () => {
  const html = '<div class="st-ex"><div class="k k-dark"><div class="panel"><div class="prow">One</div></div></div></div>';
  const spec = '<div class="st-doc"><div><h4>Anatomy</h4><p>Panel</p></div></div>';
  const source = `<h3>Panel · Files</h3><div class="story pend"><div class="st-h"><b>At rest</b><span>Board P01: At rest.</span></div><div class="st-body">${html}${spec}<details><pre>&lt;div&gt;folded&lt;/div&gt;</pre></details></div></div>`;
  assert.deepEqual(entriesOf(source), [{ group: "Files", title: "At rest", code: "P01", html, spec }]);
  assert.equal(drawing(html), '<div class="kanso-story"><div class="kanso-story__theme"><div class="kanso-panel"><div class="kanso-row">One</div></div></div></div>');
  assert.throws(() => drawing('<div class="unknown"></div>'), /unmapped prototype class: unknown/);
  assert.equal(sourceEntries([source], '- At rest').length, 1);
  assert.equal(sourceEntries([source, source.replace('<b>At rest</b>', '<b>New state</b>')], '- At rest').length, 2);
  assert.throws(() => sourceEntries([source], '- Missing'), /Missing listed story: Missing/);
  assert.throws(() => sourceEntries([source], '- At rest', [2]), /expected at least 2 stories, found 1/);
  assert.throws(() => sourceEntries([source.replace(html, `<div class="story">${html}</div>`)], '- At rest'), /found 2, extracted 1/);
  assert.throws(() => closeOf('<div><div></div>', 0), /Unbalanced div/);
});

test("Panel notes remove source references without changing dimensions, dates or code text", () => {
  const result = clean('At rest (board S4, subtract.html): 11.5 meta, 10 rows, 4.5:1, 2014. From Q4.');
  assert.doesNotMatch(result, /board|S4|Q4|subtract\.html/);
  assert.match(result, /11\.5 meta, 10 rows, 4\.5:1, 2014/);
  assert.equal(clean('`--k-sp-4` and `Refresh`'), '`--k-sp-4` and `Refresh`');
});

test("CSS extraction balances nested media, comments and quoted braces", () => {
  const css = '/* { ignored } */ .one{content:"}"} @media (width < 600px){.two{color:red}/* nested } */}';
  assert.deepEqual(cssBlocks(css), ['.one{content:"}"}', '@media (width < 600px){.two{color:red}/* nested } */}']);
  assert.throws(() => cssBlocks('.one{color:red'), /Unbalanced CSS/);
  assert.throws(() => panelCss(['<style>.btn,.unknown{color:red}</style>'], '<div class="btn"></div>'), /unmapped prototype class: unknown/);
  const mapped = panelCss(['<style>.sim-notes{margin-top:16px}</style>'], '<div class="sim-notes"></div>');
  assert.match(mapped.content, /\.kanso-simulator__notes\{margin-top:16px\}/);
  assert.doesNotMatch(mapped.content, /\.sim-notes\{/);
});

test("Every imported panel state has a canvas, specification and usable symbol references", () => {
  const root = new URL('../stories/panels/', import.meta.url);
  const sprite = readFileSync(new URL('../stories/proto-sprite.svg', import.meta.url), 'utf8');
  const symbols = new Set([...sprite.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  let count = 0;
  for (const file of readdirSync(root).filter((f) => f.endsWith('.json'))) {
    const states = JSON.parse(readFileSync(new URL(file, root), 'utf8'));
    const docs = readFileSync(new URL(file.replace('.json', '.mdx'), root), 'utf8');
    const exports = readFileSync(new URL(file.replace('.json', '.stories.js'), root), 'utf8');
    assert.match(docs, /## Prompt for agents/);
    for (const [key, state] of Object.entries(states)) {
      count++;
      assert.ok(exports.includes(`export const ${key} =`));
      assert.ok(docs.includes(`<Canvas of={stories.${key}} />`));
      assert.deepEqual(state.spec.map(([label]) => label), ['Anatomy', 'Values', 'States', 'Behaviour', 'Principle']);
      assert.ok(markupClasses(state.html).every((name) => /^kanso-[a-z0-9-]+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$/.test(name)), `${key}: BEM classes`);
      assert.doesNotMatch(state.name + state.caption + state.spec.flat().join(' '), /\b(?:boards?|prototype|[A-Z]\d{1,2}[a-z]?)\b/);
      const local = new Set([...state.html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      for (const [, id] of state.html.matchAll(/href="#([^"]+)"/g)) assert.ok(symbols.has(id) || local.has(id), `Missing symbol ${id}`);
      assert.equal(withoutRepeats(state.html), state.html, `${key}: a frame is drawn twice`);
      if (state.name.endsWith(', Before')) assert.match(state.caption, /previous design/);
    }
  }
  assert.ok(count >= 280, `Expected the complete initial set and later states, found ${count}`);
});
