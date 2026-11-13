// The sidebar's rows and its Projects, Status and Threads views draw what the Storybook drawings show.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const NOW = Date.now();
const local = (extra = {}) => ({ id: "sp1", name: "app", folder: "/work/app", machine: null, active: true, tabs: [{ id: "tab1" }], ...extra });
const agent = (address, extra = {}) => ({ address, pane: `p-${address}`, tab: "tab1", space: "sp1", space_name: "app", status: null, program: { agent: true, name: "Claude Code" }, title: address, seq: 1, ...extra });

async function sidebar(state) {
  const ids = [], texts = [], tips = [], icons = [], calls = [], handlers = {};
  const node = () => {
    let id = null;
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (prop === "id") return (x) => { id = x; ids.push(x); return proxy; };
        if (prop === "child") return (value) => { if (typeof value === "string") texts.push(value); return proxy; };
        if (prop === "tooltip") return (value) => { if (typeof value === "string") tips.push(value); return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        if (prop === "on_click" || prop === "on_mouse_up" || prop === "on_mouse_down") return (...a) => { if (id) handlers[`${prop}:${id}`] = a.at(-1); return proxy; };
        return () => proxy;
      },
    });
    return proxy;
  };
  const field = { on() {}, value: () => state.typed ?? "", set_value() {}, focus() {}, release() {} };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, image: node, h_flex: node, v_flex: node,
    svg: (path) => { icons.push(path); return node(); },
    Popover: { new: node }, Toggle: { new: node }, Button: { new: (x) => { ids.push(x); return node(); } },
    InputState: { new: () => field }, Input: { new: node },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", chrome: "#111", hover: "#222", input: "#333", ansi2: "#0f0", blocked: "#c44", border: "#333", raised: "#222", accent: "#09f" }),
    shared: (key) => (key === "kanso.registry" ? state.registry ?? [] : null), setShared: () => {},
    spaces: () => state.spaces ?? [local()], panes: () => [], agents: () => state.agents ?? [], terminals: () => state.terminals ?? [],
    machines: () => state.layouts ?? [{ name: null, layout: "ready" }], run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
    home: () => "/Users/me", props: () => ({}), window: () => ({ platform: "macos", active: true }),
  });
  const view = Object.assign(new Spaces(), {
    git: state.git ?? {}, shown: new Set((state.spaces ?? [local()]).map((s) => s.id)), born: {}, custom: {},
    order: "updated", statusOrder: "latest", threadOrder: "said", threadGroup: false,
    machines: [], parked: [], folded: new Set(), agentsFolded: state.agentsFolded ?? new Set(),
    sectionsFolded: state.sectionsFolded ?? new Set(), shelvesOpen: state.shelvesOpen ?? new Set(),
    waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(), hints: {},
    hoverSpace: state.hoverSpace ?? null, hoverRow: state.hoverRow ?? null,
    handle: { is_focused: () => false, focus() {} }, hostName: "macbook", sync: { config: {}, status: {} },
    panel: { set() {}, agents: new Map() }, threads: state.threads ?? null, view: state.view ?? "spaces",
    tasks: {}, steps: {},
    ...state.own,
  });
  if (state.before) state.before(view);
  view.render();
  return { view, ids, texts, tips, icons, calls, handlers };
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

test("a project's name edits in place: Enter keeps the new name, Esc leaves it", async () => {
  const drawn = await sidebar({ typed: "kansō", before: (view) => view.startRename(local()) });
  assert.equal(drawn.ids.includes("space-rename-field"), true);
  drawn.view.endRename(true);
  assert.deepEqual(drawn.calls.filter(([c]) => c === "space.rename"), [["space.rename", { id: "sp1", name: "kansō" }]]);
  const left = await sidebar({ typed: "other", before: (view) => view.startRename(local()) });
  left.view.endRename(false);
  assert.deepEqual(left.calls.filter(([c]) => c === "space.rename"), []);
  assert.equal(left.view.renaming, null);
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
  const { agentRowH } = await load("kanso-spaces/agents.js", ["agentRowH"], { div: () => ({}), svg: () => ({}) });
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
  const spaces = [local(), { id: "sp2", name: "ops", folder: "/srv/ops", machine: "dark", active: false, tabs: [{ id: "tab2" }] }];
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
  const cases = [
    ["spaces", { order: "attention" }, "Sort: Needs you first", "order", "updated"],
    ["agents", { statusOrder: "longest" }, "Sort: Longest in its state", "statusOrder", "latest"],
    ["threads", { threadOrder: "started" }, "Sort: When it started", "threadOrder", "said"],
  ];
  for (const [view, own, tip, key, rest] of cases) {
    const drawn = await sidebar({ view, own, agents: [agent("t1", { status: "working" })], threads: {} });
    assert.equal(drawn.ids.includes("spaces-order"), true, view);
    assert.equal(drawn.tips.includes(tip), true, view);
    const cx = { notify() {} };
    const back = drawn.handlers[`on_click:spaces-order-${rest}`];
    assert.ok(back, `${view}: its default is one press away`);
    back({}, cx);
    assert.equal(drawn.view[key], rest);
  }
});

test("a computer folded shows its most urgent mark and how many projects; connected with none, the kit empty", async () => {
  const spaces = [local(), { id: "sp2", name: "ops", folder: "/srv/ops", machine: "dark", active: false, tabs: [{ id: "tab2" }] }];
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
