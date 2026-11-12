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

// Asleep is Herdr's state: a settled tab, and terminals at their prompt that keep a conversation.
const shell = (address, resume, name) => ({ address, state: "live", program: { shell: true }, labels: { "kanso.resume": resume, "kanso.name": name } });
const fury = (tabs) => [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: false, tabs }];
const asleepTab = { id: "tb", name: "Notes", index: 0, settled: true, settled_at: 1 };
const sleepers = [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" }, { pane: "p2", tab: "tb", terminal: "t2", cwd: "/Users/me/fury" }];
const sleeperTerms = [shell("t1", "00000000-0000-4000-8000-000000000001", "Ada"), shell("t2", "00000000-0000-4000-8000-000000000002", "Bea")];
const registry = [{ id: "p-fury", name: "fury", folder: "/Users/me/fury", machine: "", missing: false }];

function ready(view, extra = {}) {
  return Object.assign(view, {
    view: "spaces", git: {}, shown: new Set(extra.shown ?? []), born: {}, custom: {}, order: "updated", machines: [],
    folded: new Set(), agentsFolded: new Set(), tasks: {}, steps: {}, since: {}, foldH: {}, folding: null,
    pressed: null, over: null, hoverRow: null, hoverSpace: null, sectionsFolded: new Set(), shelvesOpen: new Set(),
    threadGroup: true, threadOrder: "said", statusOrder: "latest", threads: null, alive: null, ...extra,
  });
}

async function draw({ spaces = () => [], agents = () => [], panes = () => [], terminals = () => [], collapsed = false } = {}) {
  const { node, handlers, ids, clear } = recorder();
  const shared = (k) => (k === "kanso.registry" ? registry : k === "sidebar.collapsed" ? collapsed : null);
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Button: { new: node }, Popover: { new: node },
    theme: () => theme, shared, setShared: () => {}, spaces, panes, agents, terminals, machines: () => [],
    run: () => {}, home: () => "/Users/me", openOverlay: () => {}, props: () => ({}),
  });
  const view = ready(new Spaces(), { shown: new Set(spaces().map((w) => w.id)) });
  const render = () => { clear(); view.render(); };
  render();
  return { view, handlers, ids, render };
}
const asleepProject = () => draw({ spaces: () => fury([asleepTab]), panes: () => sleepers, terminals: () => sleeperTerms });

const cx = { stop_propagation() {}, notify() {} };
const has = (ids, id) => ids.has(id);

test("a project with nothing awake is one group, and a sleeping tab beside a live agent is its own", async () => {
  const { asleepGroups } = await load("kanso-spaces/roster.js", ["asleepGroups"], {});
  const row = (id, asleep) => ({ address: id, asleep });
  const z = (id, tab) => ({ id, tab });
  const whole = asleepGroups([row("zz:a", z("s1", "Notes")), row("zz:b", z("s1", "Notes"))], { key: "sp1" });
  assert.deepEqual(clone(whole.groups.map((g) => [g.id, g.whole, g.rows.map((r) => r.address)])), [["project:sp1", true, ["zz:a", "zz:b"]]]);
  const mixed = asleepGroups([row("t1", null), row("zz:a", z("s1", "Notes")), row("zz:b", z("s2", "Plan"))], { key: "sp1" });
  assert.deepEqual(clone(mixed.live.map((r) => r.address)), ["t1"]);
  assert.deepEqual(clone(mixed.groups.map((g) => [g.id, g.name, g.whole, g.rows.length])), [["sleep:s1", "Notes", false, 1], ["sleep:s2", "Plan", false, 1]]);
});

test("an asleep project renders collapsed, a click shows its agents without showing the project, and waking restores the usual group", async () => {
  const { view, handlers, ids, render } = await asleepProject();
  const row = "space-sp1";
  assert.equal(has(ids, row), true, "the project keeps its row");
  assert.equal(has(ids, "asleep-n-project:sp1"), true, "the row carries how many agents sleep");
  assert.equal(has(ids, "space-agent-zz:t1"), false, "its agents are hidden while it sleeps");
  handlers[`on_mouse_up:${row}`]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), true, "a click shows the agents");
  assert.equal(has(ids, "space-agent-zz:t2"), true);
  handlers[`on_mouse_up:${row}`]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), false, "a second click hides them again");

  const live = [{ address: "t1", pane: "p1", tab: "tb", space: "sp1", space_name: "fury", status: "idle", name: "Ada", seq: 1 }];
  const woke = await draw({
    spaces: () => fury([{ ...asleepTab, settled: false, active: true }]), agents: () => live,
    panes: () => sleepers, terminals: () => [{ address: "t1", state: "live", program: { agent: true }, labels: {} }, { address: "t2", state: "live", program: { shell: true }, labels: {} }],
  });
  assert.equal(has(woke.ids, "space-agent-t1"), true, "awake, the usual agent row is back");
  assert.equal([...woke.ids].some((id) => id.startsWith("asleep-group-")), false, "the quiet row is gone");
  assert.equal(view.asleepOpen.has("project:sp1"), false);
});

test("a sleeping tab inside a live project is one row, and a click shows its agents", async () => {
  const tabs = [{ id: "tb0", name: "Main", index: 0, active: true }, asleepTab];
  const live = [{ address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "fury", status: "idle", name: "Live", seq: 1 }];
  const { handlers, ids, render } = await draw({
    spaces: () => fury(tabs), agents: () => live,
    panes: () => [{ pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/fury" }, ...sleepers],
    terminals: () => [{ address: "t0", state: "live", program: { agent: true }, labels: {} }, ...sleeperTerms],
  });
  assert.equal(has(ids, "space-agent-t0"), true, "the agent still awake keeps its row");
  assert.equal(has(ids, "asleep-group-sleep:tb"), true, "the sleeping tab is one row");
  assert.equal(has(ids, "space-agent-zz:t1"), false);
  assert.equal(typeof handlers["on_mouse_up:space-sp1"], "function", "the project row is still the project row");
  handlers["on_click:asleep-group-sleep:tb"]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), true, "a click shows who sleeps in that tab");
  assert.equal(has(ids, "space-agent-zz:t2"), true);
});

test("Status and Threads start an asleep project collapsed", async () => {
  const status = await asleepProject();
  status.view.view = "agents";
  status.render();
  assert.equal(has(status.ids, "section-asleep"), true);
  assert.equal(has(status.ids, "asleep-group-project:sp1"), true);
  assert.equal(has(status.ids, "space-agent-zz:t1"), false);
  status.handlers["on_click:asleep-group-project:sp1"]({}, cx);
  status.render();
  assert.equal(has(status.ids, "space-agent-zz:t1"), true);

  const threads = await asleepProject();
  threads.view.view = "threads";
  threads.view.threads = {};
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:t1"), false, "a project asleep is closed in Threads too");
  const head = [...threads.ids].find((id) => id.startsWith("thread-project-"));
  assert.ok(head, "the project still heads its conversations");
  threads.handlers[`on_click:${head}`]({}, cx);
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:t1"), true);
});
