import assert from "node:assert/strict";
import test from "node:test";
import { chain, gpuiHost, load, nodes } from "./helpers.mjs";

const treeWith = (block) => ({ id: "root", children: [{ id: "side" }, block] });

test("A page is hidden when its block is hidden, or its stack shows another child", async () => {
  const { hiddenInLayout } = await load("kanso-guard/page.js", ["hiddenInLayout"], gpuiHost());
  const withLayout = (tree) => ({ ...gpuiHost(), layout: () => tree });

  const shown = await load("kanso-guard/page.js", ["hiddenInLayout"], withLayout(treeWith({ id: "guard", content: { mod: "kanso-guard" } })));
  assert.equal(shown.hiddenInLayout("kanso-guard"), false);

  const { hiddenInLayout: hiddenCase } = await load("kanso-guard/page.js", ["hiddenInLayout"],
    withLayout(treeWith({ id: "guard", hidden: true, content: { mod: "kanso-guard" } })));
  assert.equal(hiddenCase("kanso-guard"), true, "a hidden block stays mounted but off screen");

  const { hiddenInLayout: stacked } = await load("kanso-guard/page.js", ["hiddenInLayout"], withLayout({
    id: "root",
    children: [{ id: "stack", type: "stack", active: "other", children: [{ id: "other" }, { id: "guard", content: { mod: "kanso-guard" } }] }],
  }));
  assert.equal(stacked("kanso-guard"), true, "a stack showing another child hides this one");

  const { hiddenInLayout: active } = await load("kanso-guard/page.js", ["hiddenInLayout"], withLayout({
    id: "root",
    children: [{ id: "stack", type: "stack", active: "guard", children: [{ id: "other" }, { id: "guard", content: { mod: "kanso-guard" } }] }],
  }));
  assert.equal(active("kanso-guard"), false);

  assert.equal(hiddenInLayout("kanso-guard"), false, "no layout at all (a pane or overlay copy) is never hidden");
  const missing = await load("kanso-guard/page.js", ["hiddenInLayout"], withLayout(treeWith({ id: "other" })));
  assert.equal(missing.hiddenInLayout("kanso-guard"), false, "a mod not in the tree is not hidden by it");
});

test("The page frame centers one column that never outgrows 1080, narrower padded by the tokens", async () => {
  const host = gpuiHost();
  const { pageFrame } = await load("kanso-guard/page.js", ["pageFrame"], { ...host, layout: () => null });
  const { G } = await load("kanso-guard/ui.js", ["G"], host);

  const wide = pageFrame(false, 44, (column) => column.child(chain("body")));
  assert.deepEqual(wide.calls.filter(([name]) => name === "px"), [["px", 32]]);
  assert.deepEqual(wide.calls.filter(([name]) => name === "py"), [["py", 28]]);
  const column = wide.kids[0];
  assert.deepEqual(column.calls.filter(([name]) => name === "max_w"), [["max_w", 1080]]);
  assert.deepEqual(column.calls.filter(([name]) => name === "gap"), [["gap", 44]]);
  assert.equal(column.kids[0].tag, "body", "what build() puts in the column is drawn in it");

  const tight = pageFrame(true, 32, (column) => column);
  assert.deepEqual(tight.calls.filter(([name]) => name === "px"), [["px", G.lg]]);
});

test("Help and settings draw one window: keys, head, page tabs, and the page's own scroll", async () => {
  const { pagedDialog } = await load("kanso-settings/pages.js", ["pagedDialog"], gpuiHost());
  const head = chain("head");
  const page = chain("page");
  const onKey = () => {};
  const drawn = pagedDialog({
    name: "help", handle: "the-handle", onKey, head,
    tabs: [{ key: "keys", label: "Keyboard" }], tab: "keys", page, onTab: () => {},
    t: { popover: "#111", foreground: "#eee" }, c: {},
  });
  const calls = drawn.calls.map(([name, value]) => [name, value]);
  assert.deepEqual(calls.filter(([name]) => name === "id"), [["id", "kanso-help"]]);
  assert.deepEqual(calls.filter(([name]) => name === "track_focus"), [["track_focus", "the-handle"]]);
  assert.deepEqual(calls.filter(([name]) => name === "on_key_down"), [["on_key_down", onKey]]);
  assert.equal(drawn.kids[0], head, "the mod's own head is drawn as it was given");
  const scroll = nodes(drawn).find((node) => node.calls.some(([name, value]) => name === "id" && value === "help-scroll-keys"));
  assert.ok(scroll, "the scroll takes the page's name, so a page change reads as a new place");
  assert.ok(nodes(scroll).includes(page), "the page is drawn inside the scroll");
});
