// The collapsed sidebar's rail: one mark per group, its popup, and Hide sidebar.
import { loadSidebar, recorder, SIDEBAR_THEME } from "./sidebar-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { clone, layoutHost, watchPopups } from "./helpers.mjs";

async function spaces(host = {}) {
  const { host: drawn, handlers } = recorder();
  const { Spaces } = await loadSidebar(drawn, host);
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
  const { view, handlers } = await spaces({ props: () => ({ railMenu: { title: "kanso", rows, space: null }, overlay: 1 }) });
  const scrolled = [];
  Object.assign(view, { menuAt: -1, handle: {}, convScroll: { scroll_to_item: (i) => scrolled.push(i) } });
  const shown = watchPopups(view);
  view.railMenuView(SIDEBAR_THEME);
  assert.deepEqual([shown[0][0].scroll.length, shown[0][0].rows], [12, 10], "every row is in the run, ten shown at a time");
  const key = handlers["on_key_down:spaces-menu"];
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
  const { view } = await spaces(layoutHost(state, () => tree, (command, args) => { if (command === "layout.set") tree = clone(args.layout); if (command === "layout.resize") sizes.push(args.px); }));
  view.width = 280;
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.at(-1)], [true, 280, 76]);
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], sizes.at(-1)], [false, 280]);
});
