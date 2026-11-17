// The status bar's kit pieces: an item with its mark or icon and words, and the item of an agent waiting for you.
import { loadPendingState } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, chain, numberArguments, calls } from "./helpers.mjs";

const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "toneColor", "G", "R", "W", "ICON_INLINE"], gpuiHost()),
  ...await loadPendingState(gpuiHost()),
  ...await load("kanso-panel/ui-status.js", ["statusItem", "needsItem"], gpuiHost()),
});

const first = (el, name) => calls(el, name)[0]?.slice(1);
const kids = (el) => el.kids;
const hoverOf = (el) => {
  const style = chain();
  first(el, "hover")[0](style);
  return style.calls;
};

const night = { foreground: "#d8d4cb", background: "#1b1b19", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f", ansi1: "#ca938b" };

test("An item is its icon or mark at the inline size, 8 to its words", async () => {
  const { statusItem, tokens, G, ICON_INLINE } = await kit();
  const c = tokens(night);
  const icon = statusItem("computer", c, { icon: "server", text: "devbox" });
  assert.deepEqual(first(icon, "id"), ["computer"]);
  assert.deepEqual(first(icon, "gap"), [G.sm]);
  assert.deepEqual(first(kids(icon)[0], "size"), [ICON_INLINE]);
  assert.deepEqual(first(kids(icon)[1], "child"), ["devbox"]);
  assert.equal(calls(icon, "flex_none").length, 0, "a long name shrinks and trims");
  assert.equal(calls(icon, "flex_initial").length, 1);
  assert.deepEqual(first(icon, "min_w"), [0]);
  assert.equal(calls(kids(icon)[1], "truncate").length, 1);
  assert.equal(calls(icon, "on_click").length, 0, "no click without somewhere to go");
  const counted = statusItem("working", c, { mark: "working", text: 2 });
  assert.deepEqual(first(kids(counted)[0], "size"), [ICON_INLINE]);
  assert.ok(calls(kids(counted)[0], "spin").length, "the working mark turns");
  assert.deepEqual(first(kids(counted)[1], "child"), ["2"]);
});

test("A clickable item gets the wash under the pointer; one in a state keeps its colour there", async () => {
  const { statusItem, tokens, toneColor, R } = await kit();
  const c = tokens(night);
  const ran = [];
  const plain = statusItem("working", c, { mark: "working", text: 1, tip: "1 agent working", onClick: () => ran.push("status") });
  assert.equal(calls(plain, "cursor_pointer").length, 1);
  assert.deepEqual(first(plain, "rounded"), [R.sm]);
  assert.deepEqual(first(plain, "tooltip"), ["1 agent working"]);
  assert.deepEqual(hoverOf(plain), [["bg", c.w7], ["text_color", c.text]]);
  first(plain, "on_click")[0]({}, {});
  assert.deepEqual(ran, ["status"]);
  const low = statusItem("memory", c, { text: "Memory 8% free", tone: "blocked", onClick: () => {} });
  assert.deepEqual(first(low, "text_color"), [toneColor(c, "blocked")]);
  assert.deepEqual(hoverOf(low), [["bg", c.w7]]);
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
  const { needsItem, tokens, W } = await kit();
  const c = tokens(night);
  const el = needsItem("needs-you", c, { name: "cart-ui", question: "Run pnpm add?", more: 1, tip: "cart-ui · shop", onClick: () => {} });
  const [mark, name, question, more] = kids(el);
  assert.equal(mark.calls.some(([call, value]) => call === "child" && value === "!"), true);
  assert.deepEqual(first(name, "child"), ["cart-ui"]);
  assert.equal(calls(name, "font_medium").length, 1);
  assert.equal(calls(name, "flex_none").length, 1);
  assert.deepEqual(first(question, "max_w"), [W.question]);
  assert.equal(W.question, 260);
  assert.equal(calls(question, "truncate").length, 1);
  assert.deepEqual(first(more, "child"), ["+1"]);
  assert.deepEqual(first(more, "text_color"), [c.dim]);
  assert.equal(calls(more, "flex_none").length, 1);
  assert.equal(calls(question, "text_color").length, 0, "the question follows the item: muted at rest");
  assert.deepEqual(hoverOf(el), [["bg", c.w7], ["text_color", c.text]], "and foreground under the pointer");
  const alone = needsItem("needs-you", c, { name: "cart-ui" });
  assert.equal(kids(alone).length, 2, "no question and nobody else: mark and name");
});

test("The status pieces' code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-status.js"), []);
});
