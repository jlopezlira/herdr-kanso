import { loadStrip, loadTabs, loadTabPanels } from "./mod-fixtures.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { clone, load, layoutHost } from "./helpers.mjs";

// The strip's one column, a block per terminal.
const column = (...terminals) => [{ id: "strip-col-a", type: "column", size: { weight: 1 }, children: terminals.map((terminal) => (
  { id: `strip-${terminal}`, type: "block", size: { weight: 1 }, content: { terminal } }
)) }];
const keepWrites = (writes) => (command, args) => { if (command === "layout.set") writes.push(clone(args.layout)); };

async function layoutFixture() {
  const nodes = column("a", "b");
  let tree = { id: "root", children: [
    { id: "sidebar", min: 200 },
    { id: "work-body", children: [...clone(nodes), { id: "panel-body", type: "stack", hidden: true, children: [] }] },
    { id: "strip-map", type: "block", content: { mod: "kanso-strip" } },
  ] };
  const writes = [];
  const host = { ...layoutHost({}, () => tree, keepWrites(writes)), theme: () => ({ accent: "#000000", background: "#ffffff" }) };
  const { Strip } = await loadStrip(host);
  const strip = new Strip(); strip.sets = [];
  const flush = () => { while (writes.length) tree = writes.shift(); };
  strip.apply(clone(nodes)); flush();
  const body = () => tree.children[1];
  return { nodes, host, strip, flush, body, panel: () => body().children.find((node) => node.id === "panel-body") };
}

// A fixture whose first column a person dragged to 350 px.
const resizedFixture = async () => {
  const f = await layoutFixture();
  f.body().children[0].size = { px: 350 };
  return f;
};
const tabsIn = async (f) => new (await loadTabs(f.host)).Tabs();
const withTabs = async () => {
  const f = await layoutFixture();
  return { f, tabs: await tabsIn(f) };
};
const pressSim = (tabs, f) => {
  tabs.command("sim");
  f.flush();
  return f.panel().children;
};
// Tabs whose every mount is kept instead of drawn.
const watchedTabs = async () => {
  const { Tabs } = await loadTabs({ shared: () => undefined });
  const tabs = new Tabs();
  const mounted = [];
  tabs.mount = (id) => mounted.push(id);
  return { tabs, mounted };
};

const writers = [
  ["kanso-tabs/main.js", "Tabs", (x) => new x.Tabs().mount("pr")],
  ["kanso-panel/lib.js", "showPanel", (x) => x.showPanel("pr", { mod: "kanso-panel" })],
  ["open-with/main.js", "showPreview", (x) => x.showPreview("/repo/readme.md", null)],
  ["kanso-spaces/layout.js", "setRail", (x) => x.setRail(false, 76)],
];
for (const [file, name, write] of writers) {
  test(`${file} preserves native column and stack resizing`, async () => {
    const f = await resizedFixture();
    f.body().children[0].children[0].size = { px: 73 };
    write(await load(file, [name], f.host)); f.flush();
    assert.equal(f.body().children[0].size.px, 350);
    assert.equal(f.body().children[0].children[0].size.px, 73);
    f.strip.tab = () => "tab";
    f.strip.state = { tab: { cols: [] } };
    f.strip.adopt();
    assert.ok(f.strip.drift, "The resize must remain visible to adopt()");
  });

  test(`${file} preserves a pending strip width command`, async () => {
    const f = await resizedFixture();
    const next = clone(f.nodes); next[0].size = { weight: 2 };
    f.strip.sets = []; f.strip.apply(next); // Still queued: layout() returns the old px size.
    write(await load(file, [name], f.host)); f.flush();
    assert.deepEqual(f.body().children[0].size, { weight: 2 });
  });

  test(`a strip write preserves the pending change from ${file}`, async () => {
    const f = await layoutFixture();
    write(await load(file, [name], f.host)); // The other writer has not landed yet.
    const intent = f.host.shared("kanso.layout");
    const next = clone(f.nodes); next[0].size = { weight: 2 };
    f.strip.sets = []; f.strip.apply(next); f.flush();
    assert.deepEqual(f.body().children[0].size, { weight: 2 });
    if (intent.panel) {
      assert.deepEqual(f.panel().children, [intent.panel]);
    } else {
      assert.equal(f.host.layout().resizable, true);
      assert.equal(f.host.layout().children[0].min, intent.rail.min);
    }
  });
}

// Right after layout.switch, layout() can still return the tree of the layout
// that was shown before. A writer that edits that tree and sets it saves it
// into kanso.json, and Kanso is gone until the file is restored by hand.
function foreignLayout() {
  const tree = { id: "root", children: [
    { id: "sidebar", min: 180, children: [{ id: "spaces", type: "block", content: { mod: "spaces" } }] },
    { id: "work", type: "column", children: [{ id: "work-body", type: "row", children: [
      { id: "main", type: "block", content: { tab: "active" } },
      { id: "panel-body", type: "stack", hidden: true, children: [] },
    ] }] },
  ] };
  const writes = [];
  return { host: layoutHost({}, () => tree, keepWrites(writes)), writes };
}

for (const [file, name, write] of writers) {
  test(`${file} never writes another layout's tree`, async () => {
    const f = foreignLayout();
    write(await load(file, [name], f.host));
    assert.equal(f.writes.length, 0);
  });
}

test("kanso-strip/main.js never writes another layout's tree", async () => {
  const f = foreignLayout();
  const { Strip } = await loadStrip(f.host);
  const strip = new Strip(); strip.sets = [];
  const nodes = column("a");
  strip.apply(nodes);
  assert.equal(f.writes.length, 0);
  assert.notEqual(strip.applied, JSON.stringify(nodes), "A skipped write must not count as applied, or it is never retried");
});

// Herdr's divider moves only the two nodes beside it: nothing fixed may stand
// just before the side panel, or its border cannot be dragged. One file for
// every writer (layout.js, copied into each mod).
const helpers = ["kanso-tabs/layout.js", "kanso-strip/layout.js", "kanso-panel/layout.js", "open-with/layout.js", "kanso-spaces/layout.js"];
for (const file of helpers) {
  test(`${file} puts the strip's right edge rail after a shown panel`, async () => {
    const { edgeBesidePanel } = await load(file, ["edgeBesidePanel"], {});
    const tree = (hidden) => ({ id: "root", children: [{ id: "work-body", children: [
      { id: "strip-a" }, { id: "strip-edge-right" }, { id: "panel-body", hidden, children: [] }] }] });
    const order = (t) => t.children[0].children.map((n) => n.id);
    const given = tree(false), shown = edgeBesidePanel(given);
    assert.deepEqual(order(shown), ["strip-a", "panel-body", "strip-edge-right"]);
    assert.deepEqual(order(given), ["strip-a", "strip-edge-right", "panel-body"], "the tree it is given stays as it was");
    assert.deepEqual(order(edgeBesidePanel(shown)), ["strip-a", "panel-body", "strip-edge-right"], "idempotent");
    const hidden = edgeBesidePanel(tree(true));
    assert.deepEqual(order(hidden), ["strip-a", "strip-edge-right", "panel-body"], "a closed panel leaves it in place");
  });
}

// Herdr draws a resize handle between any two nodes of the row, so a pane has a left handle only when a node stands before it.
test("The first pane has no left resize handle beside the sidebar's edge, and every pane after it keeps one", async () => {
  const f = await layoutFixture();
  const { Strip } = await loadStrip(f.host);
  const strip = new Strip();
  strip.row = (st) => st.cols.map((_c, ci) => ({ ci }));
  strip.shownCols = (st) => st.cols.map((_c, ci) => ci);
  const st = { cols: [{ panes: ["a"], w: 0.4 }, { panes: ["b"], w: 0.3 }, { panes: ["c"], w: 0.3 }] };
  const ids = strip.build(st, ["a", "b", "c"].map((pane) => ({ pane, terminal: `t${pane}` }))).map((n) => n.id);
  assert.equal(ids.indexOf("strip-a"), 0, "nothing stands before the first pane");
  assert.ok(ids.indexOf("strip-b") > 0 && ids.indexOf("strip-c") > 0, "the panes after it have a node to their left");
});

test("Dragging the divider between two stacked panes keeps the heights they were dragged to", async () => {
  const f = await layoutFixture();
  f.strip.tab = () => "tab";
  f.strip.state = { tab: { cols: [{ panes: ["a", "b"], w: 1 }] } };
  f.host.setShared("strip.px", { a: 800 });
  const [top, bottom] = f.body().children[0].children;
  top.size = { weight: 1.5 }; bottom.size = { weight: 0.5 };
  assert.equal(f.strip.adopt(), false, "a drag is read back only once it rests");
  f.strip.drift.at -= 1000;
  assert.equal(f.strip.adopt(), true);
  assert.deepEqual(clone(f.strip.state.tab.cols[0].hs), { a: 0.75, b: 0.25 });
});

test("kanso-tabs opens and closes a custom panel from kanso.panels through commitLayout", async () => {
  const f = await layoutFixture();
  f.host.setShared("kanso.panels", [
    { id: "workflow", label: "Workflow", icon: "mods/herdr-workflow/icon.svg", mod: "herdr-workflow", props: { tab: "state" } },
  ]);
  const tabs = await tabsIn(f);
  tabs.mount("workflow"); f.flush();
  const panelBody = f.panel;
  assert.equal(panelBody().hidden, false);
  assert.deepEqual(panelBody().children, [
    { id: "workflow", type: "block", content: { mod: "herdr-workflow", props: { tab: "state" } } },
  ]);
  tabs.mount(null); f.flush();
  assert.equal(panelBody().hidden, true);
  assert.deepEqual(panelBody().children, []);
});

test("kanso-tabs.look opens Look on the path its name carries, since Herdr gives a mod command no arguments", async () => {
  const { f, tabs } = await withTabs();
  const shown = () => f.panel().children;
  tabs.command("look /repo/shots/home page.png"); f.flush();
  const [look] = shown();
  assert.equal(look.id, "look");
  assert.equal(look.content.mod, "kanso-panel");
  assert.deepEqual({ ...look.content.props, at: 0 }, { panel: "look", path: "/repo/shots/home page.png", at: 0 }, "spaces in the path kept");
  tabs.command("look:~/a.pdf"); f.flush();
  assert.equal(shown()[0].content.props.path, "~/a.pdf", "the keys.json way, look:<path>, too");
  tabs.command("look"); f.flush();
  assert.deepEqual(shown()[0].content.props, { panel: "look" }, "no path: Look on the agent in focus");
  tabs.command("lookout"); f.flush();
  assert.deepEqual(shown()[0].content.props, { panel: "look" }, "another command is not Look's");
});

test("kanso-tabs shows its panels in the order you drag them, without the ones you turned off", async () => {
  const store = { "kanso.sim.tools": { ios: true } };
  const host = { shared: (k) => store[k], setShared: (k, v) => { store[k] = v; } };
  const { panelList, movePanel, setPanelOn } = await load("kanso-tabs/main.js", ["panelList", "movePanel", "setPanelOn"], host);
  const ids = () => clone(panelList().filter((p) => p.on).map((p) => p.id));
  assert.deepEqual(ids(), ["files", "insights", "pr", "shipped", "worktrees", "ports", "containers", "memory", "look", "sim"], "Spend, Worktrees, Ports, Containers, Memory, Look and Simulator ship with Kanso; no Specs");
  movePanel("shipped", "files");
  assert.deepEqual(ids(), ["shipped", "files", "insights", "pr", "worktrees", "ports", "containers", "memory", "look", "sim"], "dropped on Files: takes its place");
  movePanel("files", "pr");
  assert.deepEqual(ids(), ["shipped", "insights", "pr", "files", "worktrees", "ports", "containers", "memory", "look", "sim"], "dragged right");
  setPanelOn("pr", false);
  assert.deepEqual(ids(), ["shipped", "insights", "files", "worktrees", "ports", "containers", "memory", "look", "sim"]);
  assert.equal(panelList().find((p) => p.id === "pr").on, false, "still listed in the popup, off");
  setPanelOn("pr", true);
  assert.deepEqual(ids(), ["shipped", "insights", "pr", "files", "worktrees", "ports", "containers", "memory", "look", "sim"], "back where it was");
  store["kanso.panels.order"] = ["files", "insights", "pr", "shipped"];
  assert.deepEqual(clone(ids().slice(-6)), ["worktrees", "ports", "containers", "memory", "look", "sim"], "panels added after you placed yours come after them");
  store["kanso.panels"] = [{ id: "workflow", label: "Workflow", mod: "herdr-workflow" }];
  assert.equal(ids().at(-1), "workflow", "a custom panel you never placed comes last");
});

test("kanso-tabs.memory opens Memory and a second call leaves it open", async () => {
  const { f, tabs } = await withTabs();
  for (const call of ["first", "second"]) {
    tabs.command("memory"); f.flush();
    assert.equal(f.panel().children[0].content.mod, "kanso-guard", call);
  }
});

test("kanso-tabs.sim toggles the Simulator panel", async () => {
  const f = await layoutFixture();
  f.host.setShared("kanso.sim.tools", { ios: true });
  const tabs = await tabsIn(f);
  assert.equal(pressSim(tabs, f)[0].content.mod, "kanso-sim");
  assert.deepEqual(pressSim(tabs, f), []);
});

test("Simulator is absent without native tools, present with either, and hidden like any panel", async () => {
  const f = await layoutFixture();
  const { Tabs, panelList } = await loadTabPanels(f.host);
  const tabs = new Tabs();
  const listed = () => panelList().find((panel) => panel.id === "sim");
  f.host.setShared("kanso.sim.tools", { ios: null });
  assert.equal(listed(), undefined);
  assert.deepEqual(pressSim(tabs, f), []);
  for (const tools of [{ ios: true }, { adb: "/sdk/adb" }]) {
    f.host.setShared("kanso.sim.tools", tools);
    assert.equal(listed().on, true);
    f.host.setShared("kanso.pieces", { "panel.sim": "hide" });
    assert.equal(listed().on, false);
    assert.deepEqual(pressSim(tabs, f), []);
    f.host.setShared("kanso.pieces", {});
  }
});

test("kanso-tabs closes a panel Kanso no longer has (Specs)", async () => {
  const { tabs, mounted } = await watchedTabs();
  tabs.reconcile({ id: "s1" }, null, { id: "panel-body", children: [{ id: "specs", type: "block", content: { mod: "sdd-focused" } }] }, "specs");
  assert.deepEqual(mounted, [null]);
  tabs.reconcile({ id: "s1" }, null, { id: "panel-body", children: [{ id: "changes", type: "block", content: { mod: "kanso-panel", props: { panel: "changes" } } }] }, "changes");
  assert.deepEqual(mounted, [null, null], "Changes, left open by an older Kanso, closes");
  mounted.length = 1;
  tabs.reconcile({ id: "s1" }, null, { id: "panel-body", children: [{ id: "preview", type: "block", content: { mod: "kanso-panel", props: { panel: "preview", path: "/repo/PLAN.md" } } }] }, "preview");
  assert.deepEqual(mounted, [null], "a file's preview stays open");
});

// Parse a single PowerShell literal independently of the production escaper.

test("kanso-tabs remounts a panel kept from the separate token-spend mod as Kanso's Spend", async () => {
  const { tabs, mounted } = await watchedTabs();
  const body = (mod) => ({ id: "panel-body", children: [{ id: "insights", type: "block", content: { mod } }] });
  tabs.reconcile({ id: "s1" }, null, body("token-spend"), "insights");
  assert.deepEqual(mounted, ["insights"], "mounted again, now with kanso-spend");
  tabs.reconcile({ id: "s1" }, null, body("kanso-spend"), "insights");
  assert.deepEqual(mounted, ["insights"], "already Kanso's: left alone");
});

test("kanso-spaces passes an explicit machine to space.new for local, remote, and active spaces", async () => {
  const { node, host, handlers } = recorder();
  const calls = [];
  let activeMachine = "odin";
  const spList = () => [
    { id: "sp-local", name: "local", folder: "/home", machine: null, active: activeMachine === null, tabs: [] },
    { id: "odin/sp1", name: "remote", folder: "/srv", machine: "odin", active: activeMachine === "odin", tabs: [] },
  ];
  const { Spaces } = await loadSidebar(host, {
    spaces: spList, machines: () => [{ name: null, layout: "ready" }, { name: "odin", layout: "ready" }],
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
  });
  const view = Object.assign(new Spaces(), mountedState({
    shown: new Set(["odin/sp1"]), machines: [{ name: "odin", state: "connected", target: "odin.example" }], tools: node,
  }));
  view.hoverMachine = "local";
  view.render();

  const cx = { stop_propagation() {}, notify() {} };
  handlers["on_click:machine-local-tool-0"]({}, cx); // this computer: + alone
  handlers["on_click:machine-new-local-action"]({}, cx);
  view.hoverMachine = "odin";
  view.render();
  handlers["on_click:machine-odin-tool-1"]({}, cx); // Turn off, +, Sync

  // The top + is no longer a bare space: it adds a project (tests/projects.test.mjs).
  assert.deepEqual(calls, [
    ["space.new", { machine: "" }],
    ["space.new", { machine: "" }],
    ["space.new", { machine: "odin" }],
  ]);

  // ⌃1-9 goes through Kanso: a space that isn't there is nothing, not an error.
  calls.length = 0;
  view.command("space-2", cx);
  view.command("space-4", cx);
  assert.deepEqual(calls, [["space.select", { index: 2 }]]);
});

test("an agent moved to another project shows there, and only there, whatever space its terminal is in", async () => {
  const { Spaces } = await loadSidebar(recorder().host);
  const view = new Spaces();
  Object.assign(view, { order: "updated", custom: {}, termBy: new Map([["t1", { address: "t1", labels: { "kanso.id": "t1-5" } }], ["t2", { address: "t2", labels: {} }]]),
    panel: { agents: new Map([["term:t1-5", { project: "sp-kanso", projectAt: 1 }]]) }, inStripOrder: (l) => l });
  const ctx = { all: [{ address: "t1", space: "sp-fluenty" }, { address: "t2", space: "sp-fluenty" }], strip: {}, asleep: { rows: [] }, spaceIds: new Set(["sp-fluenty", "sp-kanso"]) };
  assert.deepEqual(clone(view.spaceRows("sp-kanso", ctx).map((a) => a.address)), ["t1"], "qb2 under herdr-kanso");
  assert.deepEqual(clone(view.spaceRows("sp-fluenty", ctx).map((a) => a.address)), ["t2"], "and no longer under fluenty");
  const gone = { ...ctx, spaceIds: new Set(["sp-fluenty"]) };
  assert.deepEqual(clone(view.spaceRows("sp-fluenty", gone).map((a) => a.address)), ["t1", "t2"], "its project closed: back where it runs, never nowhere");
});

test("the latest project choice wins, whichever key it was made under, and a clearing is a choice too", async () => {
  const { Spaces } = await loadSidebar(recorder().host);
  const C = "00000000-0000-4000-8000-0000000000aa";
  const view = new Spaces();
  const th = { file: `/h/.claude/projects/-w/${C}.jsonl`, pid: 7 };
  const at = (agents) => Object.assign(view, { order: "updated", custom: {}, threads: { t1: th }, alive: new Set([7]),
    termBy: new Map([["t1", { address: "t1", labels: { "kanso.id": "t1-5" } }]]), panel: { agents: new Map(agents) }, inStripOrder: (l) => l });
  const ctx = { all: [{ address: "t1", space: "sp-f" }], strip: {}, asleep: { rows: [] }, spaceIds: new Set(["sp-f", "sp-a", "sp-b"]) };
  const where = () => ["sp-f", "sp-a", "sp-b"].find((id) => view.spaceRows(id, ctx).length);
  at([[C, { project: "sp-a", projectAt: 3 }], ["term:t1-5", { project: "sp-b", projectAt: 5 }]]);
  assert.equal(where(), "sp-b", "moved to B after its conversation was put in A: B");
  at([[C, { project: "sp-a", projectAt: 3 }], ["term:t1-5", { project: null, projectAt: 6 }]]);
  assert.equal(where(), "sp-f", "then back to where it runs: there, not A");
});

// Herdr's own sidebar key hides the node, and kanso-spaces with it: Kanso's hidden sidebar is the rail.
const kansoTree = (sidebar) => ({ id: "root", children: [{ id: "sidebar", ...sidebar }, { id: "strip-map" }] });

test("A hidden sidebar comes back as the rail, once per hiding", async () => {
  const { sidebarBack } = await load("kanso-tabs/layout.js", ["sidebarBack"], {});
  const hidden = kansoTree({ hidden: true, min: 120 });
  assert.deepEqual(clone(sidebarBack(hidden, false)), { acted: true, fold: true });
  assert.deepEqual(clone(sidebarBack(hidden, true)), { acted: true, fold: false }, "the same hiding is not acted on twice");
  assert.deepEqual(clone(sidebarBack(kansoTree({ min: 120 }), false)), { acted: false, fold: false }, "shown open");
  assert.deepEqual(clone(sidebarBack(kansoTree({ min: 76 }), true)), { acted: false, fold: false }, "the rail, already folded");
  assert.deepEqual(clone(sidebarBack({ id: "root", children: [{ id: "sidebar", hidden: true }] }, false)), { acted: false, fold: false }, "another layout's sidebar");
});

test("Folding a hidden sidebar shows it at the rail's width, marked collapsed", async () => {
  let tree = kansoTree({ hidden: true, min: 120 });
  tree.resizable = true;
  const state = {}, sent = [];
  const host = layoutHost(state, () => tree, (command, args) => { sent.push(command); if (command === "layout.set") tree = clone(args.layout); else if (command === "layout.resize") tree.children[0].size = { px: args.px }; });
  const { foldSidebar } = await load("kanso-tabs/layout.js", ["foldSidebar"], host);
  foldSidebar();
  assert.equal(state["sidebar.collapsed"], true);
  assert.deepEqual(sent, ["layout.set", "layout.resize"]);
  assert.deepEqual(clone(tree.children[0]), { id: "sidebar", hidden: false, min: 76, size: { px: 76 } });
  assert.equal(tree.resizable, true, "the rail's edge drags too, to open it");
  sent.length = 0;
  foldSidebar();
  assert.deepEqual(sent, ["layout.resize"], "a shown rail is not set again");
});

test("A layout write keeps the sidebar shown", async () => {
  const state = { "kanso.layout": { rail: { open: false, min: 44 } } };
  const { paintLayout } = await load("kanso-tabs/layout.js", ["paintLayout"], { shared: (key) => clone(state[key] ?? null) });
  assert.equal(paintLayout(kansoTree({ hidden: true })).children[0].hidden, false);
});

test("The tab bar brings a hidden sidebar back once, and again after the next hiding", async () => {
  const folds = [];
  const { Tabs } = await loadTabs({ setShared: (key, value) => folds.push([key, value]), shared: () => null, layout: () => null, window: () => ({ platform: "macos" }), run: () => {} });
  const tabs = new Tabs();
  const hidden = kansoTree({ hidden: true }), shown = kansoTree({});
  for (const tree of [hidden, hidden, shown, hidden]) tabs.keepRail(tree);
  assert.equal(folds.filter(([key]) => key === "sidebar.collapsed").length, 2);
});
