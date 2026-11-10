// A project or tab that is asleep is one quiet row until a click; waking it opens the usual group.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const theme = { foreground: "#fff", muted: "#888", dim: "#666", blocked: "#c44", input: "#222", accent: "#09f", chrome: "#111", hover: "#222", ansi2: "#0f0", border: "#333", popover: "#111", selected: "#222" };

function recorder() {
  const handlers = {}, ids = new Set();
  const node = () => {
    let id = null;
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return undefined;
        if (prop === "id") return (x) => { id = x; ids.add(x); return proxy; };
        if (prop === "on_click" || prop === "on_mouse_up" || prop === "on_mouse_down") return (...a) => { if (id) handlers[`${prop}:${id}`] = a.at(-1); return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        return () => proxy;
      },
    });
    return proxy;
  };
  const clear = () => { for (const k of Object.keys(handlers)) delete handlers[k]; ids.clear(); };
  return { node, handlers, ids, clear };
}

const agent = (resume, name) => ({ name, resume, terminal: null, title: null, said: null, spaceId: null, at: null, program: null });

function sleepOf(over = {}) {
  return { id: "sl1", from: ":/Users/me/fury", name: "Notes", saved: 1, space: "fury", spaceId: null, into: null, busy: false, pending: false, stuck: null,
    agents: [agent("c1", "Ada"), agent("c2", "Bea")], ...over };
}

const registry = [{ id: "p-fury", name: "fury", folder: "/Users/me/fury", machine: "", missing: false }];

function ready(view, extra = {}) {
  return Object.assign(view, {
    view: "spaces", git: {}, shown: new Set(extra.shown ?? []), born: {}, custom: {}, order: "updated", machines: [],
    folded: new Set(), agentsFolded: new Set(), tasks: {}, steps: {}, since: {}, foldH: {}, folding: null,
    pressed: null, over: null, hoverRow: null, hoverSpace: null, sectionsFolded: new Set(), shelvesOpen: new Set(),
    threadGroup: true, threadOrder: "said", statusOrder: "latest", threads: null, alive: null, ...extra,
  });
}

async function draw({ asleep = [], spaces = () => [], agents = () => [], panes = () => [], terminals = () => [], collapsed = false, registry: reg = registry } = {}) {
  const { node, handlers, ids, clear } = recorder();
  const shared = (k) => (k === "kanso.asleep" ? asleep : k === "kanso.registry" ? reg : k === "sidebar.collapsed" ? collapsed : null);
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Popover: { new: node },
    theme: () => theme, shared, setShared: () => {}, spaces, panes, agents, terminals, machines: () => [],
    run: () => {}, home: () => "/Users/me", openOverlay: () => {}, props: () => ({}),
  });
  const view = ready(new Spaces(), { shown: new Set(spaces().map((w) => w.id)) });
  const render = () => { clear(); view.render(); };
  render();
  return { view, handlers, ids, render };
}

const cx = { stop_propagation() {}, notify() {} };
const has = (ids, id) => ids.has(id);

test("a project with nothing awake is one group, and a sleeping tab beside a live agent is its own", async () => {
  const { asleepGroups } = await load("kanso-spaces/roster.js", ["asleepGroups"], {});
  const row = (id, asleep) => ({ address: id, asleep });
  const z = (id, tab, stuck = null) => ({ id, from: ":/f", tab, stuck });
  const whole = asleepGroups([row("zz:a", z("s1", "Notes")), row("zz:b", z("s1", "Notes", "left"))], { key: ":/f" });
  assert.equal(whole.groups.length, 1);
  assert.equal(whole.groups[0].whole, true);
  assert.deepEqual(clone(whole.groups[0].rows.map((r) => r.address)), ["zz:a", "zz:b"]);
  assert.deepEqual(clone(whole.groups[0].stuck), ["s1"]);
  const mixed = asleepGroups([row("t1", null), row("zz:a", z("s1", "Notes")), row("zz:b", z("s2", "Plan"))], { key: "sp1" });
  assert.deepEqual(clone(mixed.live.map((r) => r.address)), ["t1"]);
  assert.deepEqual(clone(mixed.groups.map((g) => [g.id, g.name, g.whole, g.rows.length])), [["sleep:s1", "Notes", false, 1], ["sleep:s2", "Plan", false, 1]]);
});

test("an asleep project renders collapsed, a click shows its agents, and waking restores the usual group", async () => {
  const asleep = [sleepOf()];
  const { view, handlers, ids, render } = await draw({ asleep });
  const row = "closed-project-:/Users/me/fury";
  assert.equal(has(ids, row), true, "the project keeps its row");
  assert.equal(has(ids, "asleep-n-project::/Users/me/fury"), true, "the row carries how many agents sleep");
  assert.equal(has(ids, "space-agent-zz:c1"), false, "its agents are hidden while it sleeps");
  assert.equal(has(ids, "space-agent-zz:c2"), false);
  assert.equal(handlers[`on_click:asleep-retry-sl1`], undefined, "a sleep that finished has no Retry");
  handlers[`on_click:${row}`]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:c1"), true, "a click shows the agents");
  assert.equal(has(ids, "space-agent-zz:c2"), true);
  handlers[`on_click:${row}`]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:c1"), false, "a second click hides them again");

  const space = [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs: [{ id: "tb", name: "Main", active: true }] }];
  const live = [{ address: "t1", pane: "p1", tab: "tb", space: "sp1", space_name: "fury", status: "idle", name: "Ada", seq: 1 }];
  const woke = await draw({
    asleep: [], spaces: () => space, agents: () => live,
    panes: () => [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" }],
    terminals: () => [{ address: "t1", state: "live", labels: {} }],
  });
  assert.equal(has(woke.ids, "space-agent-t1"), true, "awake, the usual agent row is back");
  assert.equal([...woke.ids].some((id) => id.startsWith("asleep-group-")), false, "the quiet row is gone");
  assert.equal(view.asleepOpen.has("project::/Users/me/fury"), false);
});

test("a sleep that is stuck keeps Retry and Undo on the collapsed row", async () => {
  const { ids } = await draw({ asleep: [sleepOf({ stuck: "Bob did not exit", busy: true, state: "stuck" })] });
  assert.equal(has(ids, "asleep-undo-sl1"), true);
  assert.equal(has(ids, "asleep-retry-sl1"), true);
  assert.equal(has(ids, "asleep-why-project::/Users/me/fury"), true, "the failure stays on the row");
  assert.equal(has(ids, "space-agent-zz:c1"), false, "stuck stays collapsed, the buttons are on the row");
});

test("a project going to sleep is one row, with Undo and no Retry, and its awake agent is already gone", async () => {
  const space = [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs: [{ id: "tb", name: "Main", active: true }] }];
  const live = [{ address: "t1", pane: "p1", tab: "tb", space: "sp1", space_name: "fury", status: "idle", name: "Ada", seq: 1 }];
  const asleep = [sleepOf({ spaceId: "sp1", state: "sleeping", pending: true, agents: [{ name: "Ada", resume: "c1", terminal: "t1", title: null, said: null, spaceId: "sp1", at: 0, program: null }] })];
  const { ids } = await draw({
    asleep, spaces: () => space, agents: () => live,
    panes: () => [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" }],
    terminals: () => [{ address: "t1", state: "live", labels: {} }],
  });
  assert.equal(has(ids, "space-sp1"), true);
  assert.equal(has(ids, "asleep-going-project:sp1"), true, "the moon breathes while it goes");
  assert.equal(has(ids, "asleep-undo-sl1"), true);
  assert.equal(has(ids, "asleep-retry-sl1"), false);
  assert.equal(has(ids, "space-agent-t1"), false, "the awake row has already gone");
  assert.equal(has(ids, "space-agent-zz:c1"), false, "a project going to sleep stays one row");
});

test("a project with no space left, going to sleep, is one row", async () => {
  const { ids } = await draw({ asleep: [sleepOf({ state: "sleeping", pending: true })] });
  assert.equal(has(ids, "asleep-going-project::/Users/me/fury"), true);
  assert.equal(has(ids, "asleep-undo-sl1"), true);
  assert.equal(has(ids, "asleep-retry-sl1"), false);
  assert.equal(has(ids, "space-agent-zz:c1"), false);
});

test("a sleeping tab inside a live project is one row, and a click shows its agents", async () => {
  const space = [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs: [{ id: "tb", name: "Main", active: true }, { id: "tb2", name: "Notes" }] }];
  const live = [{ address: "t1", pane: "p1", tab: "tb", space: "sp1", space_name: "fury", status: "idle", name: "Live", seq: 1 }];
  const asleep = [sleepOf({ spaceId: "sp1", agents: [agent("c1", "Ada"), agent("c2", "Bea")].map((a) => ({ ...a, spaceId: "sp1" })) })];
  const { handlers, ids, render } = await draw({
    asleep, spaces: () => space, agents: () => live,
    panes: () => [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" }],
    terminals: () => [{ address: "t1", state: "live", labels: {} }],
  });
  assert.equal(has(ids, "space-agent-t1"), true, "the agent still awake keeps its row");
  assert.equal(has(ids, "asleep-group-sleep:sl1"), true, "the sleeping tab is one row");
  assert.equal(has(ids, "space-agent-zz:c1"), false);
  assert.equal(typeof handlers["on_mouse_up:space-sp1"], "function", "the project row is still the project row");
  handlers["on_click:asleep-group-sleep:sl1"]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:c1"), true, "a click shows who sleeps in that tab");
  assert.equal(has(ids, "space-agent-zz:c2"), true);
});

test("the collapsed rail keeps one mark for a project that sleeps, and Status and Threads start collapsed", async () => {
  const rail = await draw({ asleep: [sleepOf()], collapsed: true });
  assert.equal(has(rail.ids, "rail-closed-:/Users/me/fury"), true);
  assert.equal(has(rail.ids, "space-agent-zz:c1"), false);

  const status = await draw({ asleep: [sleepOf()] });
  status.view.view = "agents";
  status.render();
  assert.equal(has(status.ids, "section-asleep"), true);
  assert.equal(has(status.ids, "asleep-group-project::/Users/me/fury"), true);
  assert.equal(has(status.ids, "space-agent-zz:c1"), false);
  status.handlers["on_click:asleep-group-project::/Users/me/fury"]({}, cx);
  status.render();
  assert.equal(has(status.ids, "space-agent-zz:c1"), true);

  const threads = await draw({ asleep: [sleepOf({ agents: [agent("c1", "Ada"), agent("c2", "Bea")] })] });
  threads.view.view = "threads";
  threads.view.threads = {};
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:c1"), false, "a project asleep is closed in Threads too");
  const head = [...threads.ids].find((id) => id.startsWith("thread-project-"));
  assert.ok(head, "the project still heads its conversations");
  threads.handlers[`on_click:${head}`]({}, cx);
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:c1"), true);
});
