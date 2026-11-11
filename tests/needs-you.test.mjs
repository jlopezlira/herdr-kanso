import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { waitingQueue, nextWaiting, queueState, waitingSignature, sameQueue, waitingReason, queueMessage, NEEDS_YOU, EMPTY_NOTICE_MS } from "../kanso/mods/kanso-spaces/needs-you.js";
import { modScript } from "../scripts/mod-source.mjs";
import { load, clone, singleUse, tape } from "./helpers.mjs";

const agent = (address, status = "blocked", extra = {}) => ({ address, status, pane: `pane-${address}`, space: "project", space_name: "Project", tab: "tab", title: address, seq: 1, ...extra });
const terminal = (address, status_ms = 1, extra = {}) => ({ address, status_ms, state: "live", ...extra });
const addresses = (rows) => rows.map((row) => row.address);

test("Only an agent waiting on you is listed, oldest first across projects", () => {
  const rows = waitingQueue([agent("new"), agent("finished", "done"), agent("old", "blocked", { space_name: "Other" })],
    [terminal("new", 30), terminal("finished", 1), terminal("old", 10)]);
  assert.deepEqual(addresses(rows), ["old", "new"]);
  assert.equal(rows[0].project, "Other");
  assert.equal(waitingReason(), "Waiting for you");
  assert.equal(rows.some((row) => row.status === "done"), false);
});

test("Repeated jumps cycle through the whole queue and survive the seen row leaving", () => {
  const rows = waitingQueue([agent("a"), agent("b"), agent("c")], [terminal("a", 1), terminal("b", 2), terminal("c", 3)]);
  const selected = [0, 1, 2, 3].reduce((all) => [...all, nextWaiting(rows, all.at(-1))], []);
  assert.deepEqual(addresses(selected), ["a", "b", "c", "a"]);
  assert.equal(nextWaiting(rows.filter((r) => r.address !== "b"), rows[1]).address, "c");
  assert.equal(nextWaiting([rows[0]], rows[0]).address, "a");
});

test("Looking keeps a blocked agent until answered, and a finished agent never enters", () => {
  const list = [agent("blocked"), agent("done", "done")];
  const first = waitingQueue(list, [terminal("blocked", 10), terminal("done", 20)]);
  assert.deepEqual(addresses(first), ["blocked"]);
  const focused = waitingQueue(list.map((a) => ({ ...a, focused: true })), [], new Set(), first, 100);
  assert.deepEqual(addresses(focused), ["blocked"], "focus alone never acknowledges a prompt");
  assert.equal(focused[0].at, 10);
  const seen = waitingQueue([agent("blocked", "blocked", { focused: true }), agent("done", "idle")], [], new Set(), focused, 200);
  assert.deepEqual(addresses(seen), ["blocked"]);
  assert.equal(seen[0].at, 10, "redraws and focus preserve waiting age");
  assert.deepEqual(waitingQueue([agent("blocked", "working"), agent("done", "idle")], [], new Set(), seen), []);
  assert.equal(waitingQueue([agent("blocked")], [terminal("blocked", 300)], new Set(), [], 400)[0].at, 300);
});

test("Sleeping, dozing, closed and unfocusable agents never enter the queue", () => {
  const list = [agent("sleep", "blocked", { asleep: {} }), agent("dozing", "done", { dozing: true }), agent("pending"),
    agent("closed"), agent("no-pane", "done", { pane: null }), agent("working", "working"), agent("idle", "idle"), agent("live")];
  assert.deepEqual(addresses(waitingQueue(list, [terminal("closed", 1, { state: "finished" })], new Set(["pending"]))), ["live"]);
});

test("Missing times have a stable first observation and equal times use sequence then address", () => {
  const list = [agent("z", "blocked", { seq: 2 }), agent("b"), agent("a")];
  const first = waitingQueue(list, [], new Set(), [], 100);
  assert.deepEqual(addresses(first), ["a", "b", "z"]);
  assert.deepEqual(waitingQueue(list, [], new Set(), first, 200), first);
  assert.deepEqual(waitingQueue([agent("z", "done")], [], new Set(), first, 300), []);
});

test("The queue has empty, loading and unavailable states without inventing agents", () => {
  assert.equal(nextWaiting([]), null);
  assert.equal(queueMessage(queueState([], []).state), "Nobody is waiting");
  assert.equal(queueState([], [{ layout: "loading" }]).state, "loading");
  assert.equal(queueMessage(queueState([], [{ layout: "unavailable" }]).state), "Queue unavailable");
});

test("The queue signature follows agent state, names and sleep, excluding unrelated terminals", () => {
  const list = [agent("a")], terms = [terminal("a"), terminal("unrelated")];
  const signature = (agents = list, terminals = terms, excluded = new Set()) => waitingSignature(agents, terminals, excluded, "name");
  const original = signature();
  assert.equal(signature(list.map((a) => ({ ...a, focused: true }))), original);
  assert.equal(signature(list, [terms[0], terminal("unrelated", 5)]), original);
  assert.notEqual(signature([agent("a", "done")]), original);
  assert.notEqual(signature(list, [terminal("a", 5)]), original);
  assert.notEqual(signature(list, [terminal("a", 1, { labels: { name: "Renamed" } })]), original);
  assert.notEqual(signature(list, terms, new Set(["a"])), original);
  assert.notEqual(signature([agent("a", "blocked", { pane: "moved" })]), original);
});

test("Only changed queue rows or availability need to be published", () => {
  const queue = queueState(waitingQueue([agent("a")], [terminal("a")]), []);
  assert.equal(sameQueue(queue, clone(queue)), true);
  assert.equal(sameQueue(queue, null), false);
  assert.equal(sameQueue({ ...queue, rows: [] }, queue), false);
  assert.equal(sameQueue({ ...queue, state: "unavailable" }, queue), false);
  assert.equal(sameQueue({ ...queue, rows: [{ ...queue.rows[0], name: "Renamed" }] }, queue), false);
});

async function controller() {
  const state = { list: [agent("a"), agent("b")], terms: [terminal("a", 1), terminal("b", 2)], spaces: [], layouts: [], runs: [], timers: [], writes: 0, builds: 0 };
  const sharedState = new Map(), ui = tape();
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { ...ui.host,
    agents: () => state.list, terminals: () => state.terms, spaces: () => state.spaces, machines: () => state.layouts,
    panes: () => [], props: () => ({}), theme: () => ({}), image: ui.host.div,
    waitingQueue: (...args) => { state.builds++; return waitingQueue(...args); },
    shared: (key) => sharedState.get(key), setShared: (key, value) => { sharedState.set(key, value); state.writes++; },
    run: (...args) => state.runs.push(args), focused: () => ({ pane: "original" }), home: () => "C:\\Users\\person",
  });
  const view = new Spaces();
  Object.assign(view, { nameOf: (a) => a.name || a.title, handle: { focus() {} }, navNext: [] });
  const cx = { notify() {}, stop_propagation() {}, timer: { after: (ms, fn) => state.timers.push({ ms, fn }) } };
  return { state, view, cx, ui, sharedState };
}

test("The command only focuses live agents and publishes the same queue used by the count", async () => {
  const { state, view, cx, sharedState } = await controller();
  view.command("needs-you.next", cx);
  view.command("needs-you.next", cx);
  assert.deepEqual(clone(state.runs), [["agent.focus", { terminal: "a" }], ["agent.focus", { terminal: "b" }]]);
  assert.equal(sharedState.get(NEEDS_YOU).rows.length, 2);
  const writes = state.writes;
  view.refreshNeeds();
  assert.equal(state.writes, writes, "unchanged queues are not republished");
  state.list = [agent("a"), agent("b", "done")];
  assert.deepEqual(view.refreshNeeds().rows.map((row) => row.address), ["a"]);
  state.list = [agent("a"), agent("b", "idle")];
  view.command("needs-you.next", cx);
  assert.equal(sharedState.get(NEEDS_YOU).rows.length, 1);
  assert.equal(state.runs.at(-1)[1].terminal, "a");
  state.list = [];
  view.jumpNeeds({ address: "a", pane: "pane-a" }, cx);
  assert.equal(state.runs.length, 3, "a stale click cannot wake or open a closed agent");
});

test("Redraws and focus reuse the queue, while agent changes rebuild it and availability keeps its rows", async () => {
  const { state, view, sharedState } = await controller();
  const first = view.refreshNeeds();
  assert.equal(view.refreshNeeds(), first);
  state.list = state.list.map((a) => ({ ...a, focused: true }));
  view.refreshNeeds();
  assert.equal(state.builds, 1);
  assert.equal(state.writes, 1);
  state.layouts = [{ layout: "unavailable" }];
  const unavailable = view.refreshNeeds();
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.rows, first.rows);
  assert.equal(state.builds, 1);
  state.terms = state.terms.map((t) => ({ ...t, status_ms: 10 }));
  view.refreshNeeds();
  assert.equal(state.builds, 2);
  assert.equal(state.writes, 2, "a rebuilt but equal queue is not published");
  state.list = [agent("a"), agent("b", "idle")];
  assert.equal(view.refreshNeeds().rows.length, 1);
  assert.equal(state.builds, 3);
  sharedState.set("kanso.sleep.away", { rows: [{ going: true, state: "sleeping", agents: [{ terminal: "a" }] }] });
  assert.equal(view.refreshNeeds().rows.length, 0, "a sleep hides its agent without a status change");
  assert.equal(state.builds, 4);
});

test("The sidebar list supports click and Enter, with project, name, reason and age", async () => {
  const { state, view, cx, ui } = await controller();
  const scrolled = [];
  view.needsScroll = { scroll_to_item: (index) => scrolled.push(index) };
  view.toggleNeeds(cx);
  view.needsList({}, view.refreshNeeds(), 120000);
  view.nav = view.navNext;
  assert.ok(ui.texts.includes("Project"));
  assert.ok(ui.texts.includes("a"));
  assert.ok(ui.texts.includes("Waiting for you"));
  assert.equal(ui.texts.includes("Finished"), false);
  assert.ok(ui.texts.includes("1m"));
  view.listKeyDown({ key: "down" }, cx);
  assert.deepEqual(scrolled, [1]);
  view.listKeyDown({ key: "enter" }, cx);
  ui.handlers.get("needs-you-a")({}, cx);
  assert.deepEqual(clone(state.runs), [["agent.focus", { terminal: "b" }], ["agent.focus", { terminal: "a" }]]);
});

test("Projects, Status and Threads keep the return digest when Needs you is hidden, and a stored choice stays", async () => {
  const { state, view, ui, sharedState } = await controller();
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], ui.host);
  state.spaces = [{ id: "project", active: true, folder: "C:\\work\\project", tabs: [] }];
  const returned = new SinceLeft(null);
  Object.assign(returned, { project: `:${state.spaces[0].folder}`, rows: [{ id: 7, target: "agent:a", text: "Finished while you were away" }] });
  Object.assign(view, {
    sinceLeft: returned, returnPlaces: new Map([["agent:a", "a"]]), custom: {}, order: "updated", assignColors() {}, projectOf: () => null,
    listed: () => [], seen: () => new Map(), orderPicker: ui.host.div, viewSwitch: ui.host.div,
    agentsView: () => [], threadsView: () => [], grouped: () => [],
  });
  for (const mode of ["spaces", "agents", "threads"]) {
    view.view = mode;
    view.needsOpen = false;
    ui.texts.length = 0;
    view.render();
    assert.equal(ui.texts.includes("Needs you · 2"), false);
    assert.ok(ui.texts.includes("While you were away"));
    assert.ok(ui.texts.includes(returned.rows[0].text));
    assert.equal(returned.showing, true);
    view.needsOpen = true;
    ui.texts.length = 0;
    view.render();
    assert.equal(ui.texts.includes("Waiting for you"), false);
    assert.ok(ui.texts.includes(returned.rows[0].text));
    assert.equal(returned.showing, true);
  }
  for (const choice of ["show", "needed"]) {
    sharedState.set("kanso.pieces", { "sidebar.needs": choice });
    for (const mode of ["spaces", "agents", "threads"]) {
      view.view = mode;
      view.needsOpen = false;
      ui.texts.length = 0;
      view.render();
      assert.ok(ui.texts.includes("Needs you · 2"), choice);
      assert.ok(ui.texts.includes("While you were away"));
      assert.equal(returned.showing, true);
      view.needsOpen = true;
      ui.texts.length = 0;
      view.render();
      assert.ok(ui.texts.includes("Waiting for you"));
      assert.equal(ui.texts.includes("Finished"), false);
      assert.equal(returned.showing, false, "a hidden digest is not acknowledged");
      assert.ok(!view.nav.some((row) => row.key === "since-7"));
      view.needsOpen = false;
      view.render();
      assert.equal(returned.rows.length, 1);
      assert.equal(returned.showing, true);
    }
  }
});

test("An empty jump stays in the sidebar briefly and never posts a notification or changes focus", async () => {
  const { state, view, cx } = await controller();
  state.list = [];
  view.nextNeeds(cx);
  assert.equal(view.needsEmpty, true);
  assert.equal(state.runs.length, 0);
  assert.equal(state.timers[0].ms, EMPTY_NOTICE_MS);
  view.nextNeeds(cx);
  state.timers[0].fn(cx);
  assert.equal(view.needsEmpty, true, "an earlier timeout cannot hide the latest empty state");
  state.timers[1].fn(cx);
  assert.equal(view.needsEmpty, false);
});

test("Opening the queue from the collapsed rail expands the list", async () => {
  const { view, cx, sharedState } = await controller();
  sharedState.set("sidebar.collapsed", true);
  let expanded = false;
  view.openRail = () => { expanded = true; };
  view.command("needs-you.list", cx);
  assert.equal(expanded, true);
  assert.equal(view.needsOpen, true);
});

test("The status bar reads the sidebar queue rather than counting a different set", async () => {
  const ui = tape();
  const rows = waitingQueue([agent("a"), agent("b", "done")], []);
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], { ...ui.host,
    theme: () => ({}), spaces: () => [], agents: () => [], terminals: () => [], props: () => ({ side: "right" }),
    window: () => ({ platform: "windows" }), shared: (key) => key === NEEDS_YOU ? { rows } : [],
    stateMark: () => null,
  });
  new WorkspaceStatus().render();
  assert.ok(ui.texts.includes("a"));
  assert.equal(ui.texts.includes("b"), false);
  assert.equal(ui.texts.includes("2 agents need you"), false);
});

test("The kit renders every queue state with single-use elements", async () => {
  const { queueControl, queueList } = await load("kanso-spaces/needs-you-view.js", ["queueControl", "queueList"], singleUse());
  for (const state of ["ready", "loading", "unavailable"]) {
    const empty = { rows: [], state };
    queueControl({}, empty, false, true, () => {});
    queueList({}, empty, () => ({}), () => "");
  }
  queueList({}, { rows: waitingQueue([agent("a")], []), state: "ready" }, () => ({ selected: true, go() {} }), () => "1m");
  const ui = tape();
  const kit = await load("kanso-spaces/needs-you-view.js", ["queueControl", "queueList"], ui.host);
  kit.queueControl({}, { rows: [], state: "ready" }, false, true, () => {});
  kit.queueList({}, { rows: [], state: "unavailable" }, () => ({}), () => "");
  assert.ok(ui.texts.includes("Nobody is waiting"));
  assert.ok(ui.texts.includes("Queue unavailable"));
  ui.texts.length = 0;
  kit.queueControl({}, { rows: [], state: "ready" }, false, false, () => {});
  kit.queueControl({}, { rows: [], state: "ready" }, true, false, () => {});
  assert.equal(ui.texts.includes("Needs you · 0"), false);
  assert.equal(ui.texts.length, 0);
});

test("The count label distinguishes normal, collapsed, empty and unavailable states", async () => {
  const { queueLabel } = await load("kanso-spaces/needs-you-view.js", ["queueLabel"]);
  const queue = queueState(waitingQueue([agent("a")], []), []);
  assert.equal(queueLabel(queue, false, false), "Needs you · 1");
  assert.equal(queueLabel(queue, true, false), "1");
  assert.equal(queueLabel(queue, false, true), "Nobody is waiting");
  assert.equal(queueLabel({ ...queue, state: "unavailable" }, false, true), "Queue unavailable");
});

test("The queue keeps Ctrl+J available to the terminal and source loading accepts CRLF", async () => {
  const keys = JSON.parse(await readFile(new URL("../kanso/keys.json", import.meta.url), "utf8"));
  const bindings = keys["layout:kanso"];
  assert.equal(bindings["cmd-j"], "kanso-spaces.needs-you.next");
  assert.ok(!("ctrl-j" in bindings));
  const source = 'import { value } from "./model.js";\r\nexport const result = value;\r\n';
  const script = modScript(source, () => "export const value = 1;\r\n");
  assert.doesNotMatch(script, /\bimport\b|\bexport\b/);
  assert.match(script, /const result = value/);
});
