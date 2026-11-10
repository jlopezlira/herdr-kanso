import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { waitingQueue, nextWaiting, queueState, waitingReason, queueMessage, NEEDS_YOU } from "../kanso/mods/kanso-spaces/needs-you.js";
import { modScript } from "../scripts/mod-source.mjs";
import { load, clone, singleUse } from "./helpers.mjs";

const agent = (address, status = "blocked", extra = {}) => ({ address, status, pane: `pane-${address}`, space: "project", space_name: "Project", tab: "tab", title: address, seq: 1, ...extra });
const terminal = (address, status_ms = 1, extra = {}) => ({ address, status_ms, state: "live", ...extra });
const addresses = (rows) => rows.map((row) => row.address);

test("Waiting agents come before finished turns, oldest first across projects", () => {
  const rows = waitingQueue([agent("new"), agent("finished", "done"), agent("old", "blocked", { space_name: "Other" })],
    [terminal("new", 30), terminal("finished", 1), terminal("old", 10)]);
  assert.deepEqual(addresses(rows), ["old", "new", "finished"]);
  assert.equal(rows[0].project, "Other");
  assert.equal(waitingReason(rows[0]), "Waiting for you");
  assert.equal(waitingReason(rows[2]), "Finished");
});

test("Repeated jumps cycle through the whole queue and survive the seen row leaving", () => {
  const rows = waitingQueue([agent("a"), agent("b"), agent("c", "done")], [terminal("a", 1), terminal("b", 2), terminal("c", 3)]);
  const selected = [0, 1, 2, 3].reduce((all) => [...all, nextWaiting(rows, all.at(-1))], []);
  assert.deepEqual(addresses(selected), ["a", "b", "c", "a"]);
  assert.equal(nextWaiting(rows.filter((r) => r.address !== "b"), rows[1]).address, "c");
  assert.equal(nextWaiting([rows[0]], rows[0]).address, "a");
});

test("Looking keeps a blocked agent until answered and removes a finished turn when seen", () => {
  const list = [agent("blocked"), agent("done", "done")];
  const first = waitingQueue(list, [terminal("blocked", 10), terminal("done", 20)]);
  const focused = waitingQueue(list.map((a) => ({ ...a, focused: true })), [], new Set(), first, 100);
  assert.deepEqual(addresses(focused), ["blocked", "done"], "focus alone never acknowledges a prompt");
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
  assert.equal(waitingQueue([agent("z", "done")], [], new Set(), first, 300)[0].at, 300);
});

test("The queue has empty, loading and unavailable states without inventing agents", () => {
  assert.equal(nextWaiting([]), null);
  assert.equal(queueMessage(queueState([], []).state), "Nobody is waiting");
  assert.equal(queueState([], [{ layout: "loading" }]).state, "loading");
  assert.equal(queueMessage(queueState([], [{ layout: "unavailable" }]).state), "Queue unavailable");
});

function tape() {
  const texts = [], handlers = new Map();
  const node = (initial = null) => {
    let id = initial;
    const el = new Proxy({}, { get(_target, key) {
      if (key === "then") return undefined;
      if (key === "id") return (value) => { id = value; return el; };
      if (key === "child") return (value) => { if (typeof value === "string") texts.push(value); return el; };
      if (key === "when") return (on, apply) => on ? apply(el) : el;
      if (key === "on_click") return (fn) => { handlers.set(id, fn); return el; };
      return () => el;
    } });
    return el;
  };
  return { texts, handlers, host: { div: node, svg: node, h_flex: node, v_flex: node, Button: { new: node } } };
}

async function controller() {
  const state = { list: [agent("a"), agent("b", "done")], terms: [terminal("a", 1), terminal("b", 2)], runs: [], timers: [], writes: 0 };
  const sharedState = new Map(), ui = tape();
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { ...ui.host,
    agents: () => state.list, terminals: () => state.terms, spaces: () => [], machines: () => [],
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
  state.list = [agent("a"), agent("b", "idle")];
  view.command("needs-you.next", cx);
  assert.equal(sharedState.get(NEEDS_YOU).rows.length, 1);
  assert.equal(state.runs.at(-1)[1].terminal, "a");
  state.list = [];
  view.jumpNeeds({ address: "a", pane: "pane-a" }, cx);
  assert.equal(state.runs.length, 3, "a stale click cannot wake or open a closed agent");
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
  assert.ok(ui.texts.includes("Finished"));
  assert.ok(ui.texts.includes("1m"));
  view.listKeyDown({ key: "down" }, cx);
  assert.deepEqual(scrolled, [1]);
  view.listKeyDown({ key: "enter" }, cx);
  ui.handlers.get("needs-you-a")({}, cx);
  assert.deepEqual(clone(state.runs), [["agent.focus", { terminal: "b" }], ["agent.focus", { terminal: "a" }]]);
});

test("An empty jump stays in the sidebar briefly and never posts a notification or changes focus", async () => {
  const { state, view, cx } = await controller();
  state.list = [];
  view.nextNeeds(cx);
  assert.equal(view.needsEmpty, true);
  assert.equal(state.runs.length, 0);
  assert.equal(state.timers[0].ms, 1800);
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
    theme: () => ({}), spaces: () => [], agents: () => [], props: () => ({ side: "right" }),
    window: () => ({ platform: "windows" }), shared: (key) => key === NEEDS_YOU ? { rows } : [],
    stateMark: () => null,
  });
  new WorkspaceStatus().render();
  assert.ok(ui.texts.includes("2 agents need you"));
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
});

test("Windows and macOS bindings share the command and source loading accepts CRLF", async () => {
  const keys = JSON.parse(await readFile(new URL("../kanso/keys.json", import.meta.url), "utf8"));
  const bindings = keys["layout:kanso"];
  assert.equal(bindings["ctrl-j"], "kanso-spaces.needs-you.next");
  assert.equal(bindings["cmd-j"], bindings["ctrl-j"]);
  const source = 'import { value } from "./model.js";\r\nexport const result = value;\r\n';
  const script = modScript(source, () => "export const value = 1;\r\n");
  assert.doesNotMatch(script, /\bimport\b|\bexport\b/);
  assert.match(script, /const result = value/);
});
