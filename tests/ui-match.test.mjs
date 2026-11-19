import test from "node:test";
import assert from "node:assert/strict";
import { stylesFor, changed, hovering } from "../kanso/mods/kanso-panel/ui-match.js";
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
