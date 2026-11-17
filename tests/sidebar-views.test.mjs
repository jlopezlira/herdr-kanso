// The sidebar's rows and its Projects, Status and Threads views draw what the Storybook drawings show.
import { loadAgentRowH } from "./mod-fixtures.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const NOW = Date.now();
const local = (extra = {}) => ({ id: "sp1", name: "app", folder: "/work/app", machine: null, active: true, tabs: [{ id: "tab1" }], ...extra });
const agent = (address, extra = {}) => ({ address, pane: `p-${address}`, tab: "tab1", space: "sp1", space_name: "app", status: null, program: { agent: true, name: "Claude Code" }, title: address, seq: 1, ...extra });

const ops = { id: "sp2", name: "ops", folder: "/srv/ops", machine: "dark", active: false, tabs: [{ id: "tab2" }] };
// The sidebar after a double click on the project's name.
const nameDoubleClicked = async () => {
  const drawn = await sidebar({});
  drawn.handlers["on_mouse_down:left:space-sp1"]({ click_count: 2 }, { notify() {}, stop_propagation() {} });
  return drawn;
};

async function sidebar(state) {
  const calls = [], focused = [];
  const drawn = recorder();
  const field = { on() {}, value: () => state.typed ?? "", set_value() {}, focus() { focused.push(true); }, release() {} };
  const spaces = state.spaces ?? [local()];
  const { Spaces } = await loadSidebar(drawn.host, {
    InputState: { new: () => field },
    shared: (key) => (key === "kanso.registry" ? state.registry ?? [] : state.shared?.(key) ?? null),
    spaces: () => spaces, agents: () => state.agents ?? [], terminals: () => state.terminals ?? [],
    machines: () => state.layouts ?? [{ name: null, layout: "ready" }], run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
    window: () => ({ platform: "macos", active: true }),
  });
  const view = Object.assign(new Spaces(), mountedState({
    git: state.git ?? {}, shown: new Set(spaces.map((s) => s.id)),
    agentsFolded: state.agentsFolded ?? new Set(), sectionsFolded: state.sectionsFolded ?? new Set(), shelvesOpen: state.shelvesOpen ?? new Set(),
    hoverSpace: state.hoverSpace ?? null, hoverRow: state.hoverRow ?? null, threads: state.threads ?? null, view: state.view ?? "spaces",
    ...state.own,
  }));
  if (state.before) state.before(view);
  view.render();
  const { ids, texts, tips, icons, handlers } = drawn;
  return { view, ids, texts, tips, icons, calls, handlers, focused };
}

test("an open project draws no chevron, and folded it shows the most urgent mark and how many", async () => {
  const agents = [agent("t1", { status: "blocked" }), agent("t2", { status: "working" })];
  const open = await sidebar({ agents });
  assert.equal(open.icons.some((p) => p.includes("chevron")), false);
  assert.equal(open.ids.includes("agents-fold-sp1"), false);
  const folded = await sidebar({ agents, agentsFolded: new Set(["sp1"]) });
  assert.equal(folded.ids.includes("agents-fold-sp1"), true);
  assert.equal(folded.texts.includes("2"), true);
  assert.equal(folded.icons.some((p) => p.includes("chevron")), false);
  assert.equal(folded.ids.includes("space-agent-t1"), false, "its sessions are folded away");
});

test("a project under the pointer shows + and the menu, and its counts say what a press does", async () => {
  const git = { [JSON.stringify([null, "/work/app"])]: { name: "herdr-kanso", branch: "main", ahead: 0, behind: 12, upstream: "origin/main", repo: "[null,\"/r\"]", linked: false } };
  const drawn = await sidebar({ git, hoverSpace: "sp1", spaces: [local({ active: false })] });
  assert.equal(drawn.ids.includes("space-plus-sp1"), true);
  assert.equal(drawn.tips.includes("New agent in app"), true);
  assert.equal(drawn.ids.includes("space-dots-sp1"), true);
  assert.equal(drawn.icons.includes("mods/kanso-chrome/icons/ellipsis.svg"), true);
  assert.equal(drawn.texts.includes("herdr-kanso"), true);
  assert.equal(drawn.texts.includes("main"), true);
  assert.equal(drawn.texts.includes("↓12"), true);
  assert.equal(drawn.tips.includes("Pull 12 from origin/main"), true);
  const rest = await sidebar({ git, spaces: [local({ active: false })] });
  assert.equal(rest.ids.includes("space-plus-sp1"), false);
  assert.equal(rest.ids.includes("space-dots-sp1"), false);
});

test("a detached project shows its commit's short id, and one with no repository its name alone", async () => {
  const git = { [JSON.stringify([null, "/work/app"])]: { name: "app", branch: "(detached)", oid: "a1b2c3d4e5f6", ahead: 0, behind: 0, repo: "[null,\"/r\"]", linked: false } };
  const detached = await sidebar({ git });
  assert.equal(detached.texts.includes("a1b2c3d"), true);
  assert.equal(detached.texts.includes("(detached)"), false);
  const none = await sidebar({ git: { [JSON.stringify([null, "/work/app"])]: null } });
  assert.deepEqual(none.texts.filter((x) => x === "app"), ["app"]);
});

test("a kept project whose folder is gone says Not found and offers Locate", async () => {
  const registry = [{ id: "p-gone", name: "search", folder: "/Users/me/search", machine: "", missing: true }];
  const drawn = await sidebar({ registry });
  assert.equal(drawn.texts.includes("Not found"), true);
  assert.equal(drawn.ids.includes("closed-locate-:/Users/me/search"), true);
  assert.equal(drawn.tips.includes("Locate"), true);
  assert.equal(drawn.ids.includes("closed-plus-:/Users/me/search"), false);
});

test("double-clicking a project's name opens the rename dialog, not a field in the row", async () => {
  const drawn = await nameDoubleClicked();
  assert.deepEqual(drawn.calls, [["space.rename", { id: "sp1" }]], "no name: Herdr asks for one in its dialog");
  drawn.ids.length = 0;
  drawn.view.render();
  assert.equal(drawn.ids.includes("space-rename-field"), false);
  assert.equal(drawn.ids.includes("space-sp1"), true);
});

test("Esc while renaming a project sends nothing to the focused agent: the sidebar takes no keys", async () => {
  const drawn = await nameDoubleClicked();
  drawn.view.render();
  assert.deepEqual(drawn.focused, [], "no field in the sidebar holds the keyboard while the dialog asks");
  assert.deepEqual(drawn.calls.filter(([c]) => c !== "space.rename"), [], "nothing reaches a terminal");
});

test("each session row has its own mark and words: a terminal's icon, the time after what it is on, a pin before the mark", async () => {
  const terminals = [{ address: "t3", labels: { "kanso.pin": "1" } }];
  const agents = [
    agent("t1", { status: "working" }),
    agent("t2", { program: { shell: true, name: "zsh" }, title: "zsh" }),
    agent("t3", { status: "done" }),
  ];
  const drawn = await sidebar({ agents, terminals });
  assert.equal(drawn.icons.includes("mods/kanso-chrome/icons/terminal.svg"), true, "a terminal leads with the terminal icon");
  assert.equal(drawn.icons.filter((p) => p.endsWith("pin.svg")).length, 1, "the pinned row keeps its pin");
  const hovered = await sidebar({ agents, terminals, hoverRow: "t1" });
  assert.equal(hovered.tips.includes("Pin to the top"), true);
  assert.equal(hovered.tips.includes("More"), true);
});

test("a sub-session that needs you gets its own line; the others stay on one", async () => {
  const { agentRowH } = await loadAgentRowH({ div: () => ({}), svg: () => ({}) });
  assert.equal(agentRowH({ sub: true }, {}), 28);
  assert.equal(agentRowH({}, { activity: "Allow network access?" }), 50);
  assert.equal(agentRowH({}, { activity: null }), 32, "finished with nothing to say: one line");
});

test("Status draws its sections with only Needs you marked, a count once folded, and its empty state", async () => {
  const agents = [agent("t1", { status: "blocked" }), agent("t2", { status: "working" }), agent("t3", { status: "idle" })];
  const drawn = await sidebar({ view: "agents", agents, sectionsFolded: new Set(["idle"]) });
  for (const name of ["Needs you", "Working", "Idle"]) assert.equal(drawn.texts.includes(name), true, name);
  assert.equal(drawn.icons.some((p) => p.includes("chevron")), false);
  assert.equal(drawn.ids.includes("space-agent-t3"), false, "Idle is folded");
  assert.equal(drawn.texts.includes("1"), true, "the folded count");
  const empty = await sidebar({ view: "agents", agents: [] });
  assert.equal(empty.texts.includes("No agents running"), true);
  assert.equal(empty.ids.includes("agents-empty-action"), false, "no action: + is right above");
  const reading = await sidebar({ view: "agents", agents: [], layouts: [{ name: null, layout: "loading" }] });
  assert.equal(reading.ids.includes("kanso-skeleton"), true);
});

test("Status puts the project after a session's name, and the computer when it is not this one", async () => {
  const agents = [agent("t1", { status: "working" }), agent("dark/t2", { status: "working", space: "sp2", space_name: "ops" })];
  const spaces = [local(), ops];
  const drawn = await sidebar({ view: "agents", agents, spaces, layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }] });
  assert.equal(drawn.texts.includes("app"), true);
  assert.equal(drawn.texts.includes("ops · dark"), true);
});

test("Threads lists active, finished, snoozed and settled conversations, and one that cannot be read says so", async () => {
  const thursday = new Date(NOW + 6 * 86400000);
  thursday.setHours(9, 0, 0, 0);
  const terminals = [
    { address: "snz", labels: { "kanso.snooze": String(thursday.getTime()) } },
    { address: "stl", labels: { "kanso.settled": `${NOW - 1000}:0` }, turn: 0 },
  ];
  const agents = [
    agent("act", { status: "working" }),
    agent("fin", { status: "done" }),
    agent("snz", { status: "idle" }),
    agent("stl", { status: "done" }),
    agent("bad", { status: "idle" }),
  ];
  const threads = { bad: { pid: 9, unavailable: "Conversation files of other processes require a Herdr API on Windows" } };
  const folded = await sidebar({ view: "threads", agents, terminals, threads });
  for (const id of ["act", "fin", "bad"]) assert.equal(folded.ids.includes(`space-agent-${id}`), true, id);
  assert.equal(folded.texts.includes("Snoozed"), true);
  assert.equal(folded.texts.includes("Settled"), true);
  assert.equal(folded.ids.includes("space-agent-snz"), false, "Snoozed folds by default");
  assert.equal(folded.texts.includes("Can't read"), true);
  assert.equal(folded.tips.includes(threads.bad.unavailable), true, "the why stays in its tooltip");
  assert.equal(folded.ids.includes("refresh-bad"), true);
  assert.equal(folded.tips.includes("Refresh"), true);
  const open = await sidebar({ view: "threads", agents, terminals, threads, shelvesOpen: new Set(["snoozed", "settled"]) });
  assert.equal(open.ids.includes("space-agent-snz"), true);
  assert.equal(open.ids.includes("space-agent-stl"), true);
  assert.equal(open.texts.includes(`${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][thursday.getDay()]} 9:00`), true, "until when");
  assert.equal(open.icons.some((p) => /(pin|clock|check)\.svg$/.test(p)), false, "the shelves carry no icon");
  const hovered = await sidebar({ view: "threads", agents, terminals, threads, hoverRow: "fin" });
  assert.equal(hovered.tips.includes("Settle"), true);
  assert.equal(hovered.tips.includes("More"), true);
  const empty = await sidebar({ view: "threads", agents: [], threads: {} });
  assert.equal(empty.texts.includes("No conversations yet"), true);
  const reading = await sidebar({ view: "threads", agents });
  assert.equal(reading.ids.includes("kanso-skeleton"), true);
});

test("away from its default, the sort stays on the toolbar and keeps working in each view", async () => {
  const orders = await load("kanso-spaces/agents.js", ["ORDERS", "STATUS_ORDERS", "THREAD_ORDERS"], {});
  const cases = [
    ["spaces", { order: "attention" }, "Sort: Needs you first", "order", "updated", orders.ORDERS],
    ["agents", { statusOrder: "longest" }, "Sort: Longest in its state", "statusOrder", "latest", orders.STATUS_ORDERS],
    ["threads", { threadOrder: "started" }, "Sort: When it started", "threadOrder", "said", orders.THREAD_ORDERS],
  ];
  for (const [view, own, tip, key, rest, list] of cases) {
    const drawn = await sidebar({ view, own: { ...own, orderOpen: "bar" }, agents: [agent("t1", { status: "working" })], threads: {} });
    assert.equal(drawn.ids.includes("spaces-tools-sort"), true, view);
    assert.equal(drawn.tips.includes(tip), true, view);
    const cx = { notify() {} };
    // The menu opens with its heading first, then the view's orders.
    const back = drawn.handlers[`on_click:spaces-order-menu-${Object.keys(list).indexOf(rest) + 1}`];
    assert.ok(back, `${view}: its default is one press away`);
    back({}, cx);
    assert.equal(drawn.view[key], rest);
  }
});

test("the toolbar's Search opens the picker, its sidebar tool folds the sidebar, and the Sort menu's switches and grouping still act", async () => {
  const hits = [];
  const own = {
    toggleRail: () => hits.push(["rail"]), orderOpen: "bar",
    setShown: (key, on) => hits.push(["shown", key, on]), setOrder: (key, value) => hits.push(["order", key, value]),
  };
  const drawn = await sidebar({ view: "threads", own, agents: [], threads: {} });
  const cx = { notify() {}, stop_propagation() {} };
  drawn.handlers["on_click:spaces-tools-search"]({}, cx);
  drawn.handlers["on_click:spaces-tools-sidebar"]({}, cx);
  // Threads: heading, its two orders, Grouped by project, separator, the Show heading, then the three switches.
  [3, 6, 7, 8].forEach((at) => drawn.handlers[`on_click:spaces-order-menu-${at}`]({}, cx));
  assert.deepEqual(drawn.calls, [["mod.open", { name: "picker" }]]);
  assert.deepEqual(hits, [["rail"], ["order", "threadGroup", true], ["shown", "activity", false], ["shown", "away", false], ["shown", "switch", false]]);
});

test("Sort's menu opened in one form of the sidebar does not come back in the other, nor when the caret folds it away", async () => {
  const shared = (collapsed) => (key) => (key === "sidebar.collapsed" ? collapsed : null);
  const open = await sidebar({ own: { orderOpen: "bar" } });
  assert.equal(open.ids.includes("spaces-order-menu"), true);
  const view = open.view;
  const opened = await sidebar({ own: { orderOpen: "rail", toolsOpen: true }, shared: shared(true) });
  assert.equal(opened.ids.includes("spaces-order-menu"), true, "in the rail it opens beside the caret");
  const folded = await sidebar({ own: { orderOpen: "rail", toolsOpen: false }, shared: shared(true) });
  assert.equal(folded.ids.includes("spaces-order-menu"), false);
  assert.equal(folded.view.orderOpen, null, "folded away, it is shut for good");
  const moved = await sidebar({ own: { orderOpen: "bar", toolsOpen: true }, shared: shared(true) });
  assert.equal(moved.ids.includes("spaces-order-menu"), false);
  assert.equal(moved.view.orderOpen, null);
  open.handlers["on_open_change:spaces-tools-sort-menu"](true, { notify() {} });
  assert.equal(view.orderOpen, "bar", "a press on Sort opens it where it is");
});

test("a computer folded shows its most urgent mark and how many projects; connected with none, the kit empty", async () => {
  const spaces = [local(), ops];
  const layouts = [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }];
  const own = { machines: [{ name: "dark", state: "connected", target: "dark" }] };
  const agents = [agent("dark/t2", { status: "blocked", space: "sp2", tab: "tab2" })];
  const folded = await sidebar({ spaces, layouts, agents, own: { ...own, folded: new Set(["dark"]) } });
  assert.equal(folded.ids.includes("machine-count-dark"), true);
  assert.equal(folded.ids.includes("space-sp2"), false);
  assert.equal(folded.icons.some((p) => p.includes("chevron")), false);
  const none = await sidebar({ spaces: [local()], layouts, own });
  assert.equal(none.texts.includes("No projects on dark yet"), true);
  assert.equal(none.ids.includes("machine-new-dark-action"), true);
});
