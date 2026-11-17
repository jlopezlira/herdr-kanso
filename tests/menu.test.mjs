// The Menu: a heading, items of a control's height with their icon, a separator, and an item that asks twice.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, numberArguments, texts, calls, arg } from "./helpers.mjs";

const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "T", "W"], gpuiHost()),
  ...await load("kanso-panel/ui-menu.js", ["menu", "menuHeight"], gpuiHost()),
});

const night = { background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", dim: "#6b6860", muted: "#949086", accent: "#7d9cd4", popover: "#222220", border: "#33332f" };

test("A Menu is a popover 252 wide, 4 inside, radius 8, with its heading dim in the meta size", async () => {
  const { menu, tokens, G, R, T, W } = await kit();
  const c = tokens(night);
  const el = menu("m", { title: "checkout", items: [{ icon: "pin", label: "Pin" }] }, c);
  assert.equal(arg(el, "w"), W.menu);
  assert.equal(W.menu, 252);
  assert.equal(arg(el, "p"), G.xs);
  assert.equal(arg(el, "rounded"), R.card);
  assert.equal(arg(el, "bg"), c.popover);
  assert.equal(arg(el, "border_color"), c.border);
  const [heading] = el.kids;
  assert.equal(arg(heading, "text_size"), T.body);
  assert.equal(arg(heading, "text_color"), c.dim);
  assert.equal(arg(heading, "child"), "checkout");
});

test("An item is a control tall, its icon muted, its words in the body size; a click runs it", async () => {
  const { menu, tokens, G, H, R, T } = await kit();
  const c = tokens(night);
  const done = [];
  const el = menu("m", { items: [{ icon: "pin", label: "Pin", onClick: () => done.push("pin") }, { separator: true }, { label: "Hide this" }] }, c);
  const [pin, line, hide] = el.kids;
  assert.equal(pin.tag, "m-0");
  assert.equal(arg(pin, "h"), H.control);
  assert.equal(arg(pin, "px"), G.sm);
  assert.equal(arg(pin, "rounded"), R.control);
  assert.equal(arg(pin, "accessibility_label"), "Pin");
  assert.equal(arg(pin.kids[0], "text_color"), c.muted);
  assert.equal(arg(pin.kids[1], "text_size"), T.value);
  arg(pin, "on_click")({}, {});
  assert.deepEqual(done, ["pin"]);
  assert.equal(calls(line, "border_t_1").length, 1, "a separator is a hairline");
  assert.equal(hide.tag, "m-2", "items keep their place in the list");
});

test("An armed item is filled with the accent and reads Press again", async () => {
  const { menu, tokens } = await kit();
  const c = tokens(night);
  const [close] = menu("m", { items: [{ icon: "close", label: "Close", armed: true, verb: "close checkout" }] }, c).kids;
  assert.equal(arg(close, "bg"), c.accent);
  assert.equal(arg(close, "accessibility_label"), "Press again to close checkout");
  assert.equal(arg(close.kids[1], "text_color"), c.accentText);
});

test("The Menu draws every size from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-menu.js"), []);
  assert.deepEqual(numberArguments("kanso-panel/ui-header.js"), []);
});

const menuOf = async (items, title = null) => {
  const { menu, tokens } = await kit(), c = tokens(night);
  return { c, el: menu("m", { title, items }, c) };
};

test("A scroll run shows its rows and scrolls the rest; the keyboard's handle follows it", async () => {
  const { H } = await kit();
  const handle = { scroll_to_item() {} };
  const { el } = await menuOf([{ scroll: Array.from({ length: 9 }, (_, i) => ({ label: `p${i}` })), rows: 3, handle }]);
  const [run] = el.kids;
  assert.equal(arg(run, "max_h"), 3 * H.control);
  assert.equal(calls(run, "overflow_y_scrollbar").length, 1);
  assert.equal(arg(run, "track_scroll"), handle);
  assert.equal(run.kids.length, 9, "every item is in the run");
});

test("A disabled item is dim, takes no click and says why in its hint", async () => {
  const done = [];
  const { c, el } = await menuOf([{ label: "Zed", hint: "local only", disabled: true, onClick: () => done.push("zed") }]);
  const [zed] = el.kids;
  assert.equal(calls(zed, "on_click").length, 0);
  assert.deepEqual(arg(zed, "disabled"), true);
  assert.equal(arg(zed.kids[1], "text_color"), c.dim);
  assert.ok(texts(zed).includes("local only"));
});

test("An item leads with an app's picture or letter as a tile, a colour dot, or its icon; a second line sits under its label", async () => {
  const { G, H } = await kit();
  const { el } = await menuOf([{ letter: "Z", label: "Zed" }, { dot: "#d73a4a", label: "bug", second: "Something is broken", checked: true }]);
  const [zed, bug] = el.kids;
  assert.equal(calls(zed.kids[0], "rounded_full").length, 0, "a tile is not round");
  assert.ok(texts(zed.kids[0]).includes("Z"));
  assert.equal(arg(bug.kids[0].kids[0], "bg"), "#d73a4a");
  assert.equal(arg(bug, "h"), H.control + G.md);
  assert.ok(texts(bug).includes("Something is broken"));
  assert.equal(calls(bug.kids.at(-1), "size").length, 1, "a checked item ends with its check");
});

test("A heading can carry a mark; armed hides the hint; loading and failure keep the menu's place", async () => {
  const { el } = await menuOf([
    { heading: "New in api", mark: "working" }, { label: "Close", hint: "⌘W", armed: true }, { loading: true },
    { failure: { text: "Can't read editors", source: "permission denied" } }, { label: "Wake", badge: "Woke" },
  ]);
  const [head, close, bones, failed, wake] = el.kids;
  assert.equal(head.kids.length, 1, "the heading's mark");
  assert.ok(!texts(close).includes("⌘W"));
  assert.equal(arg(bones, "id"), "kanso-skeleton", "loading is the shared skeleton");
  assert.ok(texts(failed).includes("Can't read editors"));
  assert.ok(texts(wake).includes("Woke"));
});

test("A popup opens at the height its Menu draws; a run with one-line and two-line items is as tall as the items it shows", async () => {
  const { G, H, menuHeight } = await kit();
  assert.equal(menuHeight({ title: "New conversation in", items: [{ scroll: [{ label: "a" }, { label: "b" }], rows: 11 }, { separator: true }, { label: "Add computer…" }] }),
    2 * G.xs + H.icon + 2 * H.control + 2 * G.xs + 1 + H.control);
  const scroll = [{ label: "bug", second: "Something is broken" }, { label: "chore" }, { label: "docs" }, { label: "feat" }];
  assert.equal(menuHeight({ items: [{ scroll, rows: 3 }] }), 2 * G.xs + (H.control + G.md) + 2 * H.control);
});

test("A right click on an item runs its own answer, and each item says its place to a screen reader", async () => {
  const done = [];
  const { el } = await menuOf([{ heading: "Projects" }, { label: "api", onSecondaryClick: () => done.push("api") }, { label: "web" }]);
  const [, api, web] = el.kids;
  const [, button, press] = calls(api, "on_mouse_down")[0];
  assert.equal(button, "right");
  press({}, { stop_propagation() {} });
  assert.deepEqual(done, ["api"]);
  assert.deepEqual([calls(api, "set_position")[0].slice(1), calls(web, "set_position")[0].slice(1)], [[1, 2], [2, 2]]);
});
