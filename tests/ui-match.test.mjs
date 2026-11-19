import test from "node:test";
import assert from "node:assert/strict";
import { stylesFor, changed, hovering, viewOf } from "../kanso/mods/kanso-panel/ui-match.js";
import { RULES, TAB_LOOKS } from "../kanso/mods/kanso-panel/ui-css.js";
import { drawnTabs, tabParts, tabKey, TAB_PARTS as PARTS } from "../kanso/mods/kanso-panel/ui-tab-shapes.js";
import { gpuiHost, load, repoText } from "./helpers.mjs";

const drawKit = () => load("kanso-panel/ui-draw.js", ["lookOf", "draw"], gpuiHost());
const kansoTheme = () => JSON.parse(repoText("kanso/themes/kanso.json"));
const byClass = (list) => ({ list: list.map(([classes, ops], order) => ({ steps: [{ classes: [classes] }], ops, weight: 100, order })),
  index: Object.fromEntries([["*", []], ...list.map(([classes], i) => [classes, [i]])]) });

test("A status colour marked important keeps its ink under the item's hover", () => {
  const bar = { tag: "div", attrs: {}, classes: ["kanso-status-bar", "kanso-status-bar--grid"], parent: null, children: [] };
  const toned = { tag: "span", attrs: {}, classes: ["kanso-status-bar__item", "kanso-text--blocked", "kanso-row--hover"], parent: bar, children: [] };
  const plain = { tag: "span", attrs: {}, classes: ["kanso-status-bar__item", "kanso-row--hover"], parent: bar, children: [] };
  const colour = (node) => stylesFor(node, RULES).filter(([op]) => op === "text_color").pop();
  assert.deepEqual(colour(toned), ["text_color", { colour: "blocked" }]);
  assert.deepEqual(colour(plain), ["text_color", { colour: "text" }]);
  const rest = { ...toned, classes: ["kanso-status-bar__item", "kanso-text--blocked"] };
  assert.equal(changed(stylesFor(rest, RULES), stylesFor(toned, RULES)).some(([op]) => op === "text_color"), false);
});

test("A node's styles are the same remembered or worked out again, whichever node is hovered", () => {
  const own = {
    list: [{ steps: [{ classes: ["a"], states: ["hover"] }, { relation: "next", classes: ["b"] }], ops: [["w", 10]], weight: 300, order: 0 },
      { steps: [{ classes: ["b"], states: ["hover"] }], ops: [["h", 4]], weight: 200, order: 1 }],
    index: { "*": [], b: [0, 1] },
  };
  const parent = { tag: "div", attrs: {}, classes: [], parent: null };
  const a = { tag: "span", attrs: {}, classes: ["a"], parent }, b = { tag: "span", attrs: {}, classes: ["b"], parent }, c = { tag: "span", attrs: {}, classes: ["c"], parent };
  parent.children = [a, b, c];
  const fresh = (node, target) => { const state = hovering(target); return stylesFor(node, own, (n, name) => state(n, name)); };
  for (const target of [a, c, b, a, c]) assert.deepEqual(stylesFor(b, own, hovering(target)), fresh(b, target), `hovering ${target.classes[0]}`);
  assert.deepEqual(stylesFor(b, own, hovering(a)), [["w", 10]]);
  assert.deepEqual(stylesFor(b, own, hovering(c)), []);
  assert.deepEqual(stylesFor(b, own, hovering(b)), [["h", 4]]);
});

test("box-shadow is one property: none clears a ring or an inset line an earlier rule drew, as the browser does", async () => {
  const { draw } = await drawKit();
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const own = byClass([["a", [["shadow", { kind: "ring", width: 2, colour: "accent" }]]], ["b", [["shadow", { kind: "top", width: 2, colour: "accent" }]]], ["off", [["shadow", null]]]]);
  const node = (classes) => ({ tag: "span", attrs: {}, classes, parent: null, children: [] });
  const shadow = (classes) => stylesFor(node(classes), own).filter(([op]) => op === "shadow").at(-1);
  assert.deepEqual(shadow(["a"]), ["shadow", { kind: "ring", width: 2, colour: "accent" }]);
  assert.deepEqual(shadow(["b"]), ["shadow", { kind: "top", width: 2, colour: "accent" }]);
  for (const on of ["a", "b"]) assert.deepEqual(shadow([on, "off"]), ["shadow", null], `${on} then none`);
  const c = tokens(kansoTheme().colors);
  const drawn = (cls) => draw([{ tag: "span", attrs: { class: cls }, children: [] }], c, { id: cls, rules: own })[0];
  assert.equal(drawn("a").kids.length, 1, "the ring drawn");
  assert.equal(drawn("a off").kids.length, 0, "no ring");
  assert.ok(drawn("b").calls.some(([op]) => op === "border_t"), "the inset line drawn");
  assert.equal(drawn("b off").calls.some(([op]) => op === "border_t" || op === "border_color"), false, "no line");
});

test("A look is worked out again when a node's classes change", async () => {
  const { lookOf } = await drawKit();
  const own = byClass([["a", [["w", 5]]], ["b", [["w", 7]]]]);
  const node = { tag: "span", attrs: {}, classes: ["a"], parent: null, children: [] };
  assert.equal(JSON.stringify(lookOf(node, own, null, false).own), JSON.stringify([["w", 5]]));
  node.classes = ["b"];
  assert.equal(JSON.stringify(lookOf(node, own, null, false).own), JSON.stringify([["w", 7]]));
});

test("Each tab look ui-css.js keeps is the one matching its rules gives", async () => {
  const { lookOf } = await drawKit();
  for (const [group, states] of drawnTabs()) {
    const parts = tabParts(group, states);
    PARTS.forEach((part, i) => {
      const [node, live] = parts[part];
      assert.equal(JSON.stringify(TAB_LOOKS.looks[TAB_LOOKS.tabs[tabKey(group, states)][i]]), JSON.stringify(lookOf(node, RULES, null, live)), `${tabKey(group, states)} ${part}`);
    });
  }
});

test("Who needs you is drawn from the rules: each op its node matches is a draw call, and the name is at weight 500", async () => {
  const { draw } = await drawKit();
  const theme = kansoTheme();
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const span = (cls, text) => ({ tag: "span", attrs: { class: cls }, children: [{ tag: "#text", text }] });
  const tree = [{ tag: "span", attrs: { class: "kanso-status-bar__item kanso-status-bar__needs" }, children: [
    { tag: "svg", attrs: { class: "kanso-mark kanso-mark--blocked kanso-icon--inline" }, children: [{ tag: "use", attrs: { href: "#e-blk" }, children: [] }] },
    span("kanso-status-bar__name", "cart-ui"), span("kanso-status-bar__question", "Which layout?"), span("kanso-status-bar__more", "+1"),
  ] }];
  assert.deepEqual(stylesFor(viewOf(tree)[0], RULES).map(([op]) => op), ["flex_initial", "min_w"]);
  const [drawn] = draw(tree, tokens({ ...theme, ...theme.colors }), { id: "needs", rules: RULES });
  for (const op of ["flex_initial", "min_w"]) assert.ok(drawn.calls.some(([name]) => name === op), op);
  assert.ok(drawn.kids[1].calls.some(([name, value]) => name === "font_weight" && value === 500));
});

test("Matching and precedence: an attribute, a negation, a zero-weight alternative and nested alternatives", () => {
  const span = (classes, attrs = {}) => ({ tag: "span", attrs, classes, parent: null, children: [] });
  const width = (rules, node) => stylesFor(node, rules).filter(([op]) => op === "w").at(-1)?.[1];
  const titled = { list: [{ steps: [{ attrs: [["title", null]] }], ops: [["w", 1]], weight: 100, order: 0 }, { steps: [{ tag: "span" }], ops: [["w", 2]], weight: 1, order: 1 }],
    index: { "*": [0], "tag:span": [1] } };
  const negated = { list: [{ steps: [{ not: [[[{ classes: ["x"] }], [{ classes: ["y"] }]]] }], ops: [["w", 1]], weight: 100, order: 0 }, { steps: [{ classes: ["a"] }], ops: [["w", 2]], weight: 100, order: 1 }],
    index: { "*": [0], a: [1] } };
  const where = { list: [{ steps: [{ any: [[[{ classes: ["a"] }]]], where: [0] }], ops: [["w", 1]], weight: 0, order: 0 }, { steps: [{ tag: "span" }], ops: [["w", 2]], weight: 1, order: 1 }],
    index: { "*": [], a: [0], "tag:span": [1] } };
  const nested = { list: [{ steps: [{ any: [[[{ any: [[[{ classes: ["a"] }], [{ classes: ["b"] }]]] }], [{ classes: ["c"] }]]] }], ops: [["w", 5]], weight: 100, order: 0 }],
    index: { "*": [], a: [0], b: [0], c: [0] } };
  assert.equal(width(titled, span([], { title: "x" })), 1, "an attribute weighs as a class, over a tag");
  assert.equal(width(negated, span(["a"])), 2, "a negation as heavy as its class: the later rule wins");
  assert.equal(width(where, span(["a"])), 2, "a zero-weight alternative loses to a tag");
  assert.equal(width(nested, span(["a"])), 5, "a nested alternative matches");
  assert.equal(width(nested, span(["c"])), 5, "the outer alternative matches");
});
