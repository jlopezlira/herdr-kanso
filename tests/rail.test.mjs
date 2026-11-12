// The collapsed sidebar's rail: one mark per group, its popup, and Hide sidebar.
import assert from "node:assert/strict";
import test from "node:test";
import { clone, load } from "./helpers.mjs";

// Elements that keep the handlers given to them, by the id they were built with.
function recorder() {
  const handlers = {};
  const node = () => {
    let id = null;
    const proxy = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return undefined;
        if (prop === "id") return (x) => { id = x; return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        if (prop.startsWith("on_")) return (...args) => { handlers[`${id}:${prop}`] = args.at(-1); return proxy; };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return { node, handlers };
}

async function spaces(host = {}) {
  const { node, handlers } = recorder();
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Popover: { new: node }, Scrollbar: { vertical: node },
    v_virtual_list: (...args) => { host.listed?.(args); return node(); },
    terminals: () => [], spaces: () => [], panes: () => [], agents: () => [], shared: () => null, setShared: () => {},
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", accent: "#09f", border: "#333", popover: "#111", selected: "#222", hover: "#222" }),
    ...host,
  });
  return { view: new Spaces(), handlers };
}

test("an unread or woken conversation keeps its call in the collapsed rail: on the group's mark and on its row in the list", async () => {
  const { view } = await spaces();
  const now = 10_000;
  const unread = view.railRow({ address: "t1", status: "idle", labels: { "kanso.unread": "1" } }, null, now);
  const up = view.railRow({ address: "t2", status: "idle", labels: { "kanso.snooze": "9000" } }, null, now);
  const read = view.railRow({ address: "t3", status: "idle", labels: {} }, null, now);
  assert.deepEqual([unread.strong, unread.badge], [true, "Unread"]);
  assert.deepEqual([up.strong, up.badge], [true, "Woke"]);
  assert.deepEqual([read.strong, read.badge], [false, null]);
  // Serialized for the popup's props: the call survives the trip.
  assert.deepEqual(clone(unread).badge, "Unread");
});

test("the rail's list scrolls to the row the keyboard picks, past the ten that show", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ address: `t${i}`, pane: `p${i}`, name: `Agent ${i}`, status: "idle", hint: null, asleep: null, strong: false, badge: null }));
  const lists = [];
  const { view, handlers } = await spaces({ props: () => ({ railMenu: { title: "kanso", rows, space: null }, overlay: 1 }), listed: (args) => lists.push(args) });
  const scrolled = [];
  Object.assign(view, { menuAt: -1, handle: {}, convScroll: { scroll_to_item: (i) => scrolled.push(i) } });
  view.railMenuView({ foreground: "#fff", muted: "#888", dim: "#666", accent: "#09f", border: "#333", popover: "#111", selected: "#222", hover: "#222" });
  assert.equal(lists[0][1], 12, "every row is in the list, ten drawn at a time");
  const key = handlers["spaces-menu:on_key_down"];
  const cx = { stop_propagation() {}, notify() {} };
  for (let i = 0; i < 12; i += 1) key({ key: "down", modifiers: {} }, cx);
  assert.equal(view.menuAt, 11);
  assert.equal(scrolled.at(-1), 11, "the twelfth row is brought into view");
});

test("dragging the sidebar edge changes its width and never folds it or changes what it remembers", async () => {
  const state = { "sidebar.collapsed": false, "sidebar.width": 256 }, runs = [];
  const { view } = await spaces({
    shared: (k) => clone(state[k] ?? null), setShared: (k, v) => { state[k] = clone(v); }, run: (cmd, args) => runs.push([cmd, args]),
  });
  const cx = { notify() {} };
  for (const w of [256, 220, 180, 160, 140, 120, 120, 300, 385]) view.sized(w, cx);
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], runs.length, view.width], [false, 256, 0, 385]);
});

test("kanso-spaces.sidebar folds an open sidebar to the rail and opens a folded one", async () => {
  const state = { "sidebar.width": 300 }, sizes = [];
  let tree = { id: "root", resizable: true, children: [{ id: "sidebar", min: 120 }, { id: "strip-map" }] };
  const { view } = await spaces({
    shared: (key) => clone(state[key] ?? null), setShared: (key, value) => { state[key] = clone(value); },
    layout: () => clone(tree), window: () => ({ platform: "macos" }),
    run: (command, args) => { if (command === "layout.set") tree = clone(args.layout); if (command === "layout.resize") sizes.push(args.px); },
  });
  view.width = 280;
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.at(-1)], [true, 280, 76]);
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], sizes.at(-1)], [false, 280]);
});
