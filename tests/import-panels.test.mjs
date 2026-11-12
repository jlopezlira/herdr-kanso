import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { clean, closeOf, cssBlocks, drawing, entriesOf } from "../scripts/import-panels.mjs";

test("Panel extraction keeps nested drawings and separates specifications from folded markup", () => {
  const html = '<div class="st-ex"><div class="k k-dark"><div class="panel"><div class="prow">One</div></div></div></div>';
  const spec = '<div class="st-doc"><div><h4>Anatomy</h4><p>Panel</p></div></div>';
  const source = `<h3>Panel · Files</h3><div class="story pend"><div class="st-h"><b>At rest</b><span>Board P01: At rest.</span></div><div class="st-body">${html}${spec}<details><pre>&lt;div&gt;folded&lt;/div&gt;</pre></details></div></div>`;
  assert.deepEqual(entriesOf(source), [{ group: "Files", title: "At rest", code: "P01", html, spec }]);
  assert.equal(drawing(html), html.replace("k k-dark", "k"));
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
      assert.doesNotMatch(state.name + state.caption + state.spec.flat().join(' '), /\b(?:boards?|prototype|[A-Z]\d{1,2}[a-z]?)\b/);
      const local = new Set([...state.html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      for (const [, id] of state.html.matchAll(/href="#([^"]+)"/g)) assert.ok(symbols.has(id) || local.has(id), `Missing symbol ${id}`);
      if (state.name.endsWith(', Before')) assert.match(state.caption, /previous design/);
    }
  }
  assert.equal(count, 280);
});
