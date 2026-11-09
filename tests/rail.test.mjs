// The collapsed sidebar's rail: one mark per group, its popup, and the drag that folds the sidebar.
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

test("a drag that folds the sidebar remembers the width you had, not an older one", async () => {
  const state = { "sidebar.collapsed": false, "sidebar.width": 256 };
  const tree = { id: "root", resizable: true, children: [{ id: "sidebar", min: 120 }, { id: "strip-map" }] };
  const runs = [];
  const { view } = await spaces({
    shared: (k) => clone(state[k] ?? null), setShared: (k, v) => { state[k] = clone(v); },
    layout: () => clone(tree), window: () => ({ platform: "macos" }), run: (cmd, args) => runs.push([cmd, clone(args)]),
  });
  const cx = { notify() {} };
  view.sized(256, cx, 0);
  view.sized(220, cx, 1000); // narrowed to 220 and left there
  view.foldRail(view.width); // Hide sidebar
  assert.equal(state["sidebar.width"], 220);
  view.openRail(); // Show sidebar: it opens at 220
  view.sized(76, cx, 5000);
  view.sized(220, cx, 5016);
  // Later, a drag down past 160.
  view.sized(200, cx, 9000);
  view.sized(180, cx, 9016);
  view.sized(159, cx, 9032);
  assert.equal(state["sidebar.collapsed"], true, "folded to the rail");
  assert.equal(state["sidebar.width"], 220, "it opens again at 220, not the 256 it had before");
  // And a drag from a width held a while remembers that width.
  view.openRail();
  view.sized(220, cx, 20000);
  view.sized(300, cx, 20016); // dragged out to 300 and held
  view.sized(250, cx, 30000);
  view.sized(159, cx, 30016);
  assert.equal(state["sidebar.width"], 300);
});
