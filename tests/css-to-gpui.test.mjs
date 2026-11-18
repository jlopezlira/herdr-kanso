// The status bar's tree is the Storybook's markup, and its gpui ops come from that CSS.
import test from "node:test";
import assert from "node:assert/strict";
import { compile, indexed, kansoTheme, reachable, read, SHEETS } from "../scripts/css-to-gpui.mjs";
import { viewOf, stylesFor, changed } from "../kanso/mods/kanso-panel/ui-match.js";
import { toHtml } from "../stories/kit/tree.js";
import { statusItem, needsItem, stepper, failureLine } from "../stories/kit/pieces.js";
import { computerItem, paletteDoor, layoutPaused, statusBar } from "../stories/kit/status-bar.js";
import { statusItemTree, needsItemTree, stepperTree, failureLineTree, computerItemTree, paletteDoorTree, layoutPausedTree, statusBarTree } from "../stories/kit/status-bar-tree.js";
import { gpuiHost, load } from "./helpers.mjs";

const compiled = compile(SHEETS.map(read).join("\n"));
const rules = indexed(reachable(compiled.rules));

test("The status bar tree is the Storybook's markup", () => {
  const same = (tree, story) => assert.equal(toHtml(tree), story);
  same(statusItemTree({ icon: "lu-monitor", text: "devbox" }), statusItem({ icon: "lu-monitor", text: "devbox" }));
  same(statusItemTree({ mark: "working", text: "2", pending: true }), statusItem({ mark: "working", text: "2", pending: true }));
  same(needsItemTree({ name: "cart-ui", question: "Which layout?", more: 1 }), needsItem({ name: "cart-ui", question: "Which layout?", more: 1 }));
  same(stepperTree({ value: 2, hover: true }), stepper({ value: 2, hover: true }));
  same(stepperTree({ value: 2, columns: [{ width: 15, panes: ["seen", "current"] }] }), stepper({ value: 2, columns: [{ width: 15, panes: ["seen", "current"] }] }));
  same(failureLineTree({ text: "Layout paused", fix: "Resume", detail: "layout write refused 3 times" }), failureLine({ text: "Layout paused", fix: "Resume", detail: "layout write refused 3 times" }));
  same(computerItemTree({ name: "devbox", state: "unreachable" }), computerItem({ name: "devbox", state: "unreachable" }));
  same(computerItemTree({ name: "This computer", remote: false, folded: true }), computerItem({ name: "This computer", remote: false, folded: true }));
  same(paletteDoorTree(), paletteDoor({ tip: "Command palette ⌘⇧P" }));
  same(layoutPausedTree(), layoutPaused());
  same(statusBarTree({ left: [statusItemTree({ icon: "lu-monitor", text: "devbox" })], middle: stepperTree({ value: 2 }), right: [paletteDoorTree()] }), statusBar({ left: [statusItem({ icon: "lu-monitor", text: "devbox" })], middle: stepper({ value: 2 }), right: [paletteDoor({ tip: "Command palette ⌘⇧P" })] }));
});

test("The compiler turns the bar's alignment, width and hairline into gpui, and leaves its columns and the stepper's ch", () => {
  const ops = (selector) => compiled.rules.filter((rule) => rule.selector === selector).flatMap((rule) => rule.ops);
  assert.ok(ops(".kanso-status-bar__value").some(([op]) => op === "text_center"));
  assert.ok(ops(".kanso-status-bar.kanso-status-bar--grid").some(([op]) => op === "w_auto"));
  assert.ok(ops(".kanso-status-bar__slot").some(([op]) => op === "ring"));
  const missed = (selector) => compiled.skipped.filter((rule) => rule.selector === selector).map((rule) => rule.reason);
  assert.ok(missed(".kanso-status-bar--grid").some((reason) => reason.includes("grid-template-columns")));
  assert.ok(missed(".kanso-status-bar__value").some((reason) => reason.includes("1ch")));
  assert.ok(missed(".kanso-status-bar__popup").some((reason) => reason.includes("anchor")));
  assert.equal(missed(".kanso-mark--working").length, 0);
});

test("A status colour marked important keeps its ink under the item's hover", () => {
  const bar = { tag: "div", attrs: {}, classes: ["kanso-status-bar", "kanso-status-bar--grid"], parent: null, children: [] };
  const toned = { tag: "span", attrs: {}, classes: ["kanso-status-bar__item", "kanso-text--blocked", "kanso-row--hover"], parent: bar, children: [] };
  const plain = { tag: "span", attrs: {}, classes: ["kanso-status-bar__item", "kanso-row--hover"], parent: bar, children: [] };
  const colour = (node) => stylesFor(node, rules).filter(([op]) => op === "text_color").pop();
  assert.deepEqual(colour(toned), ["text_color", { colour: "blocked" }]);
  assert.deepEqual(colour(plain), ["text_color", { colour: "text" }]);
  const rest = { ...toned, classes: ["kanso-status-bar__item", "kanso-text--blocked"] };
  assert.equal(changed(stylesFor(rest, rules), stylesFor(toned, rules)).some(([op]) => op === "text_color"), false);
});

test("Who needs you is drawn from the compiled rules", async () => {
  const { draw } = await load("kanso-panel/ui-draw.js", ["draw"], gpuiHost());
  const theme = kansoTheme();
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const tree = needsItemTree({ name: "cart-ui", question: "Which layout?", more: 1 });
  const [drawn] = draw(tree, tokens({ ...theme, ...theme.colors }), { id: "needs", rules });
  const node = viewOf(tree)[0];
  for (const [op] of stylesFor(node, rules)) {
    if (op === "ring") continue;
    assert.ok(drawn.calls.some(([name]) => name === op), op);
  }
  assert.ok(drawn.kids[1].calls.some(([name, value]) => name === "font_weight" && value === 500));
});

test("A node's styles are the same remembered or worked out again, whichever node is hovered", async () => {
  const { stylesFor, hovering } = await import("../kanso/mods/kanso-panel/ui-match.js");
  const own = indexed(compile(".a:hover + .b { width: 10px; } .b:hover { height: 4px; }").rules);
  const parent = { tag: "div", attrs: {}, classes: [], parent: null };
  const a = { tag: "span", attrs: {}, classes: ["a"], parent }, b = { tag: "span", attrs: {}, classes: ["b"], parent }, c = { tag: "span", attrs: {}, classes: ["c"], parent };
  parent.children = [a, b, c];
  const fresh = (node, target) => { const state = hovering(target); return stylesFor(node, own, (n, name) => state(n, name)); };
  for (const target of [a, c, b, a, c]) assert.deepEqual(stylesFor(b, own, hovering(target)), fresh(b, target), `hovering ${target.classes[0]}`);
  assert.deepEqual(stylesFor(b, own, hovering(a)), [["w", 10]]);
  assert.deepEqual(stylesFor(b, own, hovering(c)), []);
  assert.deepEqual(stylesFor(b, own, hovering(b)), [["h", 4]]);
});
