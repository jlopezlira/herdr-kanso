// The collapsed sidebar's rail: one mark per group, its popup, and Hide sidebar.
import { loadSidebar, mountedState, withParts, recorder, SIDEBAR_THEME } from "./sidebar-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { clone, layoutHost, watchPopups } from "./helpers.mjs";

const laidOut = (state, min, sizes = []) => {
  let tree = { id: "root", resizable: true, children: [{ id: "sidebar", min }, { id: "strip-map" }] };
  return layoutHost(state, () => tree, (command, args) => { if (command === "layout.set") tree = clone(args.layout); if (command === "layout.resize") sizes.push(args.px); });
};

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

test("dragging the sidebar edge changes its width, folds it to the rail past the minimum, and opens the rail dragged wide enough", async () => {
  const state = { "sidebar.collapsed": false, "sidebar.width": 256 }, sizes = [];
  const { view } = await spaces(laidOut(state, 76, sizes));
  const cx = { notify() {} };
  view.settleUntil = 0;
  for (const w of [256, 220, 180, 160, 140, 120, 120, 300, 385]) view.sized(w, cx);
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.length, view.width], [false, 256, 0, 385], "wide enough, a drag changes the width and nothing else");
  view.sized(100, cx);
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.at(-1)], [true, 256, 76], "past the minimum it folds, remembering the width it had");
  view.sized(200, cx);
  assert.equal(state["sidebar.collapsed"], true, "the sizes while the fold lands are not a drag");
  view.settleUntil = 0;
  view.sized(90, cx);
  assert.equal(state["sidebar.collapsed"], true, "the rail dragged a little stays the rail");
  view.sized(200, cx);
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.at(-1)], [false, 200, 200], "dragged to the minimum or wider it opens there");
});

test("kanso-spaces.sidebar folds an open sidebar to the rail and opens a folded one", async () => {
  const state = { "sidebar.width": 300 }, sizes = [];
  const { view } = await spaces(laidOut(state, 120, sizes));
  view.width = 280;
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], state["sidebar.width"], sizes.at(-1)], [true, 280, 76]);
  view.command("sidebar");
  assert.deepEqual([state["sidebar.collapsed"], sizes.at(-1)], [false, 280]);
});

test("collapsed on Status or Threads, the rail draws that view's tiles", async () => {
  const { host, ids, clear } = recorder();
  const spaces = [{ id: "sp1", name: "app", folder: "/w", machine: null, active: true, tabs: [{ id: "tab1" }] }];
  const agent = (address, status, seq) => ({ address, pane: `p${seq}`, tab: "tab1", space: "sp1", space_name: "app", status, program: { agent: true, name: "Claude Code" }, title: address, seq });
  const { Spaces } = await loadSidebar(host, { shared: (key) => (key === "sidebar.collapsed" ? true : null), spaces: () => spaces, agents: () => [agent("t1", "blocked", 1), agent("t2", "working", 2)] });
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), threads: {}, threadGroup: true })));
  const tiles = (shown) => { view.view = shown; view.redraw(); clear(); view.render(); return ids.filter((id) => /^(space-sp1|rail-section-|rail-thread-)/.test(id)); };
  assert.deepEqual(tiles("agents"), ["rail-section-blocked", "rail-section-working"]);
  assert.deepEqual(tiles("threads"), ["rail-thread-project-sp1"]);
});

test("expanded then collapsed, the rail keeps the view, the project you are in and what was folded", async () => {
  const spaces = [{ id: "sp1", name: "app", folder: "/w", machine: null, active: true, tabs: [{ id: "tab1" }] }, { id: "sp2", name: "web", folder: "/v", machine: null, active: false, tabs: [{ id: "tab2" }] }];
  const agent = (address, space, status, seq) => ({ address, pane: `p${seq}`, tab: `tab${seq}`, space, space_name: space, status, program: { agent: true, name: "Claude Code" }, title: address, seq });
  const cases = [
    { view: "spaces", folds: { agentsFolded: new Set(["sp2"]) }, rail: ["space-sp1", "space-sp2"], chosen: ["space-sp1"] },
    { view: "agents", folds: { sectionsFolded: new Set(["working"]) }, rail: ["rail-section-blocked", "rail-section-working"], chosen: [] },
  ];
  for (const { view: shown, folds, rail, chosen } of cases) {
    const state = { "sidebar.collapsed": false, "sidebar.width": 280 };
    const { host, ids, chosen: picked, clear } = recorder();
    const { Spaces } = await loadSidebar(host, { ...laidOut(state, 76), spaces: () => spaces, agents: () => [agent("t1", "sp1", "blocked", 1), agent("t3", "sp2", "working", 2)] });
    const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1", "sp2"]), view: shown, ...folds })));
    const draw = () => { view.redraw(); clear(); view.render(); return ids.filter((id) => /^space-agent-|^space-sp|^rail-section-/.test(id)); };
    const open = draw();
    assert.deepEqual([open.includes("space-agent-t1"), open.includes("space-agent-t3")], [true, false], `${shown}: open, the folded group hides its row`);
    view.width = 280;
    view.command("sidebar");
    assert.equal(state["sidebar.collapsed"], true);
    assert.deepEqual(draw(), rail, `${shown}: collapsed, the rail draws the view you were on`);
    assert.deepEqual(picked.filter((id) => rail.includes(id)), chosen, `${shown}: the project you are in is the one on`);
    view.command("sidebar");
    assert.deepEqual(draw(), open, `${shown}: open again, the same rows and the same fold`);
  }
});
