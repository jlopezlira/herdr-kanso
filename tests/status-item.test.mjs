// The status bar's kit pieces: an item with its mark or icon and words, and the item of an agent waiting for you.
import { loadPendingState } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, chain, numberArguments, calls, arg, nodes } from "./helpers.mjs";

const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "toneColor", "G", "R", "W", "ICON_INLINE"], gpuiHost()),
  ...await loadPendingState(gpuiHost()),
  ...await load("kanso-panel/ui-status.js", ["statusItem", "needsItem"], gpuiHost()),
});

const first = (el, name) => calls(el, name)[0]?.slice(1);
const nodesOf = (el, id) => nodes(el).find((kid) => kid.tag === id || kid.calls.some((call) => call[0] === "id" && call[1] === id));
const kids = (el) => el.kids;
const hoverOf = (el) => {
  const style = chain();
  first(el, "hover")[0](style);
  return style.calls;
};

const night = { foreground: "#d8d4cb", background: "#1b1b19", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f", ansi1: "#ca938b" };

const wash = (c, g, r, ink = false) => [
  ["bg", c.w7], ["rounded", r.sm], ["py", g.hair], ["px", g.xs], ["my", 0], ["mx", -g.xs],
  ...(ink ? [["text_color", c.text]] : []),
];

test("An item is its icon or mark at the inline size, 8 to its words", async () => {
  const { statusItem, tokens, G, ICON_INLINE } = await kit();
  const c = tokens(night);
  const icon = statusItem("computer", c, { icon: "server", text: "devbox" });
  const glyph = kids(icon)[0];
  assert.deepEqual(first(icon, "id"), ["computer"]);
  assert.deepEqual(first(icon, "gap"), [G.sm]);
  assert.equal(arg(glyph, "w"), ICON_INLINE);
  assert.equal(arg(glyph, "h"), ICON_INLINE);
  assert.deepEqual(first(kids(icon)[1], "child"), ["devbox"]);
  assert.equal(calls(icon, "flex_initial").length, 0, "a grid item keeps its width");
  assert.ok(calls(icon, "flex_none").length >= 1);
  assert.equal(arg(icon, "min_w"), 0);
  assert.equal(calls(kids(icon)[1], "truncate").length, 0, "the words carry no trim of their own");
  assert.equal(calls(icon, "on_click").length, 0, "no click without somewhere to go");
  const counted = statusItem("working", c, { mark: "working", text: 2 });
  assert.deepEqual(first(kids(counted)[0], "size"), [ICON_INLINE]);
  assert.ok(calls(kids(counted)[0], "spin").length, "the working mark turns");
  assert.deepEqual(first(kids(counted)[1], "child"), ["2"]);
});

test("A clickable item gets the wash under the pointer; one in a state keeps its colour there", async () => {
  const { statusItem, tokens, toneColor, R, G } = await kit();
  const c = tokens(night);
  const ran = [];
  const plain = statusItem("working", c, { mark: "working", text: 1, tip: "1 agent working", onClick: () => ran.push("status") });
  assert.equal(calls(plain, "cursor_pointer").length, 1);
  assert.equal(calls(plain, "rounded").length, 0, "the inset wash is the hover, not the rest");
  assert.deepEqual(first(plain, "tooltip"), ["1 agent working"]);
  assert.deepEqual(hoverOf(plain), wash(c, G, R, true));
  first(plain, "on_click")[0]({}, {});
  assert.deepEqual(ran, ["status"]);
  const low = statusItem("memory", c, { text: "Memory 8% free", tone: "blocked", onClick: () => {} });
  assert.deepEqual(first(low, "text_color"), [toneColor(c, "blocked")]);
  assert.deepEqual(hoverOf(low), wash(c, G, R), "the tone's important colour stays");
});

test("A pending item is drawn at once at the pending opacity with a breathing dot, and an open one on the 12% wash", async () => {
  const { statusItem, tokens, PENDING, R, G } = await kit();
  const c = tokens(night);
  const pending = statusItem("computer", c, { icon: "server", text: "devbox", pending: true });
  assert.deepEqual(first(pending, "opacity"), [PENDING]);
  const dot = kids(pending).at(-1);
  assert.deepEqual(first(dot, "id"), ["computer-pending"]);
  assert.equal(calls(dot, "loop").length, 1);
  assert.equal(calls(statusItem("computer", c, { icon: "server", text: "devbox" }), "opacity").length, 0);
  const open = statusItem("servers", c, { icon: "plug", open: true });
  assert.deepEqual(first(open, "bg"), [c.w12]);
  assert.deepEqual(first(open, "rounded"), [R.sm], "the open wash sits on the same inset ground as the hover");
  assert.deepEqual(first(open, "mx"), [-G.xs]);
  assert.deepEqual(first(open, "px"), [G.xs]);
});

test("Needs you is the blocked mark, the name, the question trimmed to its width and +N; the name and +N never fold", async () => {
  const { needsItem, tokens, W, G, R } = await kit();
  const c = tokens(night);
  const el = needsItem("needs-you", c, { name: "cart-ui", question: "Run pnpm add?", more: 1, tip: "cart-ui · shop", onClick: () => {} });
  const [mark, name, question, more] = kids(el);
  assert.equal(mark.calls.some(([call, value]) => call === "child" && value === "!"), true);
  assert.deepEqual(first(name, "child"), ["cart-ui"]);
  assert.equal(arg(name, "font_weight"), 500);
  assert.equal(calls(name, "flex_none").length, 1);
  assert.deepEqual(first(question, "max_w"), [W.question]);
  assert.equal(W.question, 260);
  assert.equal(calls(question, "text_ellipsis").length, 1);
  assert.equal(calls(question, "overflow_hidden").length, 1);
  assert.deepEqual(first(more, "child"), ["+1"]);
  assert.deepEqual(first(more, "text_color"), [c.dim]);
  assert.equal(calls(more, "flex_none").length, 1);
  assert.equal(calls(question, "text_color").length, 0, "the question follows the item: muted at rest");
  assert.deepEqual(hoverOf(el), wash(c, G, R, true), "and foreground under the pointer");
  assert.equal(el.calls.filter(([name]) => name === "flex_none" || name === "flex_initial").at(-1)[0], "flex_initial");
  const alone = needsItem("needs-you", c, { name: "cart-ui" });
  assert.equal(kids(alone).length, 2, "no question and nobody else: mark and name");
});

test("The status pieces' code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-status.js"), []);
});

test("Panes per view take their row, their number and their columns from the compiled rules", async () => {
  const { stepper, tokens, G, PANE } = {
    ...await load("kanso-panel/ui.js", ["tokens", "G", "PANE"], gpuiHost()),
    ...await load("kanso-panel/ui-status.js", ["stepper"], gpuiHost()),
  };
  const c = tokens({ ...night, hover: "#232321" });
  const rest = stepper("panes", c, { value: 2 });
  const minus = nodesOf(rest, "panes-minus");
  const value = nodesOf(rest, "panes-value");
  assert.equal(arg(rest, "gap"), G.hair);
  assert.equal(calls(rest, "flex_none").length, 1);
  assert.equal(calls(rest, "bg").length, 0);
  assert.equal(calls(minus, "hidden").length, 1);
  assert.equal(calls(minus, "grid").length, 0, "the glyphs stay hidden until hover or open");
  const face = value.kids[0];
  assert.equal(calls(face, "text_center").length, 1, "the number is centred");
  assert.deepEqual(first(face, "text_color"), [c.text]);
  assert.equal(calls(face, "min_w").length, 0, "1ch is not drawn");
  const hot = stepper("panes", c, { value: 2, hover: true });
  assert.equal(calls(nodesOf(hot, "panes-minus"), "grid").length, 1);
  assert.equal(calls(nodesOf(hot, "panes-minus"), "hidden").length, 0);
  assert.deepEqual(first(nodesOf(hot, "panes-pill"), "bg"), [c.subtle]);
  const open = stepper("panes", c, { value: 2, open: true });
  assert.deepEqual(first(nodesOf(open, "panes-pill"), "bg"), [c.w12]);
  const columns = [{ width: 15, panes: ["seen"] }, { width: 9, panes: ["seen", "current"] }];
  const map = stepper("panes", c, { value: 2, columns });
  const slot = nodesOf(map, "panes-columns");
  assert.equal(arg(slot, "max_w"), PANE.pills);
  assert.equal(calls(slot, "overflow_hidden").length, 1);
  assert.equal(arg(slot, "mr"), G.sm);
  const marks = nodes(slot).filter((el) => calls(el, "w").length);
  assert.deepEqual(marks.map((el) => arg(el, "w")), [15, 9, 9]);
  assert.deepEqual(marks[0].calls.filter(([name]) => name === "bg"), [["bg", c.muted]], "only the winning wash is painted");
  assert.deepEqual(marks[2].calls.filter(([name]) => name === "bg").at(-1), ["bg", c.text]);
  assert.equal(arg(marks[2], "h"), G.hair, "a stacked pane is a hair");
  assert.equal(arg(marks[0], "rounded"), 999);
});
