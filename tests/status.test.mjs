// What the status bar says, and where each click goes.
import { loadSpaces, loadWorkspaceStatus, loadQuestionOf } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { clone, load, tape, repoText } from "./helpers.mjs";

const now = 1_700_000_000_000;
const row = (address, status, extra = {}) => ({ address, status, pane: `pane-${address}`, name: address, project: "kanso", ...extra });
const reading = (free, at = now, extra = {}) => JSON.stringify({ v: 1, at, machine: { freePct: free }, limits: { lowFreePct: 20 }, ...extra });

test("A question is what the agent said, or a title that says more than its name", async () => {
  const { questionOf } = await loadQuestionOf();
  const ask = (msg, title, name = "Fury") => questionOf({ msg, title, name, program: { key: "claude", name: "Claude" } });
  assert.equal(ask("Which file?\n\n  the rest", "Other"), "Which file?");
  assert.equal(ask("  a   long   line  ", null), "a long line");
  assert.equal(ask("Fury", "Other"), "Fury");
  assert.equal(ask("", "Add the countdown?"), "Add the countdown?");
  assert.equal(ask("   ", "Add the countdown?"), "Add the countdown?");
  assert.equal(ask("", "Fury!"), null);
  assert.equal(ask("", "fury"), null);
  assert.equal(ask("", "~/code"), null);
  assert.equal(ask("", "/Users/person"), null);
  assert.equal(ask("", "C:\\Users\\person"), null);
  assert.equal(ask("", "person@devbox"), null);
  assert.equal(ask("", "Claude"), null);
  assert.equal(ask("", "claude"), null);
  assert.equal(questionOf({ msg: "", title: "Add the countdown?" }), null);
  assert.equal(questionOf({}), null);
  const long = "x".repeat(250);
  assert.equal(ask(long, "Other"), `${"x".repeat(199)}\u2026`);
});

test("Needs you names the oldest blocked agent, and nothing when nobody waits", async () => {
  const { waitingItem, NEEDS_COMMAND } = await load("kanso-status/model.js", ["waitingItem", "NEEDS_COMMAND"]);
  assert.equal(waitingItem(null), null);
  assert.equal(waitingItem([]), null);
  assert.equal(waitingItem([row("a", "done")]), null);
  assert.equal(waitingItem([row("a", "blocked", { pane: null })]), null);
  assert.equal(waitingItem([row("a", "blocked", { address: "" })]), null);
  const one = waitingItem([row("later", "blocked"), row("done", "done")], { later: "Add the countdown?" });
  assert.equal(one.name, "later");
  assert.equal(one.question, "Add the countdown?");
  assert.equal(one.more, 0);
  assert.equal(one.command, NEEDS_COMMAND);
  assert.equal(one.tooltip, "later · kanso · Add the countdown?");
  const queued = [row("new", "blocked"), row("old", "blocked", { project: "site" }), row("done", "done", { name: "Finished" })];
  const two = waitingItem(queued, { new: null, old: "Ship it" });
  assert.equal(two.name, "new");
  assert.equal(two.question, null);
  assert.equal(two.more, 1);
  assert.equal(two.tooltip, "new · kanso\nold · site · Ship it");
  assert.equal(waitingItem([row("a", "blocked"), row("b", "blocked"), row("c", "blocked")]).more, 2);
  assert.equal(waitingItem([{ address: "a", status: "blocked", pane: "p", project: "kanso" }]).name, "Agent");
});

test("The computer says where you are, Can't reach with Refresh only when that computer is unreachable, and pending while it connects", async () => {
  const { computerOf } = await load("kanso-status/model.js", ["computerOf"]);
  const shown = (space, layouts, alias = "") => clone(computerOf(space, layouts, alias));
  const here = { name: "This computer", remote: false, state: "on", detail: null, command: null };
  const devbox = { name: "devbox", remote: true, state: "on", detail: null, command: null };
  assert.deepEqual(shown(null, []), here);
  assert.deepEqual(shown({ machine: "" }, [{ name: "devbox", layout: "unavailable" }]), here);
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "ready" }]), devbox);
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "loading" }]), { ...devbox, state: "pending" });
  assert.deepEqual(shown({ machine: "devbox" }, []), devbox);
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "other", layout: "unavailable" }]), devbox);
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "unavailable" }]), {
    name: "devbox", remote: true, state: "unreachable", detail: "Can't reach devbox", command: "kanso-spaces.retry-machine:devbox",
  });
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "unavailable" }], "Night"), {
    name: "Night", remote: true, state: "unreachable", detail: "Can't reach Night", command: "kanso-spaces.retry-machine:devbox",
  });
  assert.deepEqual(shown(null, [], "Studio"), { ...here, name: "Studio" });
});

test("The computer stands in for its sidebar row: only while the sidebar is folded, or while it can't be reached", async () => {
  const { computerOf, computerShown } = await load("kanso-status/model.js", ["computerOf", "computerShown"]);
  const ready = computerOf({ machine: "devbox" }, [{ name: "devbox", layout: "ready" }]);
  const unreachable = computerOf({ machine: "devbox" }, [{ name: "devbox", layout: "unavailable" }]);
  assert.equal(computerShown(ready, false), false);
  assert.equal(computerShown(ready, undefined), false);
  assert.equal(computerShown(ready, true), true);
  assert.equal(computerShown(unreachable, false), true);
  assert.equal(computerShown(null, true), false);
});

test("The working count is the working mark and how many work, and its click opens Status", async () => {
  const { workingItem, STATUS_COMMAND } = await load("kanso-status/model.js", ["workingItem", "STATUS_COMMAND"]);
  assert.equal(STATUS_COMMAND, "kanso-spaces.view-agents");
  assert.deepEqual(clone(workingItem([{ status: "working" }, { status: "working" }, { status: "idle" }])),
    { count: 2, mark: "working", words: "2", command: STATUS_COMMAND, tooltip: "2 agents working" });
  assert.equal(workingItem([{ status: "working" }]).tooltip, "1 agent working");
  assert.deepEqual(clone(workingItem([{ status: "done" }])), { count: 0, mark: "idle", words: "0", command: STATUS_COMMAND, tooltip: "0 agents working" });
  assert.equal(workingItem(null).count, 0);
});

test("Low memory uses the guard's words, and a stale or fine reading says nothing", async () => {
  const { memoryLow, MEMORY_STALE_MS, MEMORY_COMMAND } = await load("kanso-status/model.js", ["memoryLow", "MEMORY_STALE_MS", "MEMORY_COMMAND"]);
  const low = clone(memoryLow(reading(8), now));
  assert.deepEqual(low, { words: "Memory 8% free", tone: "blocked", command: MEMORY_COMMAND, tooltip: "Memory 8% free" });
  assert.equal(MEMORY_COMMAND, "kanso-tabs.memory");
  assert.equal(memoryLow(reading(8.4), now).words, "Memory 8% free");
  assert.equal(memoryLow(reading(8.5), now).words, "Memory 9% free");
  assert.equal(memoryLow(reading(19.6), now).words, "Memory 20% free");
  assert.equal(memoryLow(reading(20), now), null);
  assert.equal(memoryLow(reading(21), now), null);
  assert.equal(memoryLow(reading(50, now, { machine: { freePct: 50, swapMB: 9000 } }), now), null);
  assert.equal(memoryLow(reading(8, now - MEMORY_STALE_MS), now).words, "Memory 8% free");
  assert.equal(memoryLow(reading(8, now - MEMORY_STALE_MS - 1), now), null);
  assert.equal(memoryLow("{", now), null);
  assert.equal(memoryLow(JSON.stringify({ v: 2, at: now, machine: { freePct: 8 }, limits: { lowFreePct: 20 } }), now), null);
  assert.equal(memoryLow(JSON.stringify({ v: 1, machine: { freePct: 8 }, limits: { lowFreePct: 20 } }), now), null);
  assert.equal(memoryLow({ v: 1, at: now, machine: { freePct: 8 }, limits: { lowFreePct: 20 } }, now).words, "Memory 8% free");
  assert.equal(memoryLow(null, now), null);
  assert.equal(memoryLow("", now), null);
});

function bar() {
  const drawn = tape();
  const runs = [], marks = [];
  const node = drawn.host.div;
  const state = { spaces: [], agents: [], terminals: [], machines: [], props: { side: "right" }, platform: "macos", shared: {}, file: null, reads: [] };
  const host = {
    ...drawn.host, Button: { new: (id) => node().id(id) },
    theme: () => new Proxy({ chrome: "chrome" }, { get: (obj, key) => (key in obj ? obj[key] : String(key)) }),
    spaces: () => state.spaces, agents: () => state.agents, terminals: () => state.terminals, machines: () => state.machines,
    props: () => state.props, window: () => ({ platform: state.platform }),
    // Herdr's own key table for this platform, as keys() gives it: the palette's chord is read from it.
    keys: () => Object.entries(JSON.parse(repoText(`tests/herdr-keys${state.platform === "macos" ? ".macos" : ""}.json`))).flatMap(([section, bound]) => Object.entries(bound).map(([chord, action]) => ({ section, keys: chord, action }))),
    shared: (key) => state.shared[key], run: (command) => { runs.push(command); },
    appHome: () => "/Users/person/Library/Application Support/herdr",
    readTextFile: async (path) => { state.reads.push(path); return state.file; },
    mark: (c, { status, size = "md" }) => { marks.push([status, size, c.blocked]); return node().child(status === "blocked" ? "!" : ""); },
  };
  const { texts, colors, handlers, tips, ids, opacities, hovers } = drawn;
  return { texts, colors, handlers, tips, runs, marks, ids, opacities, hovers, state, host };
}

// The status bar's view, on a host whose state starts with `state`.
const statusBar = async (state = {}) => {
  const ui = bar();
  Object.assign(ui.state, state);
  const { WorkspaceStatus } = await loadWorkspaceStatus(ui.host);
  return { ui, WorkspaceStatus };
};
const DEVBOX = { active: true, machine: "devbox", branch: "feat/status-attention" };
// A view drawn while 8% of memory is free.
const lowMemory = (WorkspaceStatus) => {
  const view = new WorkspaceStatus();
  view.memoryText = reading(8, Date.now());
  view.render();
  return view;
};

const at = (texts, word) => texts.indexOf(word);
const right = (n) => `status-right-${n}`;
const left = (n) => `status-left-${n}`;

test("One waiting off screen: the bar names who waits and what they ask, then low memory, the working count and the palette", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  ui.state.agents = [
    { address: "a", status: "blocked", title: "ignored title", program: { key: "claude", name: "Claude" } },
    { address: "c", status: "working", title: "Busy" },
  ];
  ui.state.terminals = [
    { address: "a", report: { msg: "Which approach?" } },
    { address: "b", report: { msg: "Ship the site" } },
  ];
  ui.state.shared["kanso.needs-you"] = { rows: [
    { address: "a", pane: "p", status: "blocked", name: "Fury", project: "kanso" },
    { address: "b", pane: "p2", status: "blocked", name: "Rey", project: "site" },
    { address: "d", pane: "p3", status: "done", name: "Done", project: "old" },
  ] };
  const view = lowMemory(WorkspaceStatus);
  assert.ok(at(ui.texts, "Fury") < at(ui.texts, "Which approach?"));
  assert.ok(at(ui.texts, "Which approach?") < at(ui.texts, "+1"));
  assert.ok(at(ui.texts, "+1") < at(ui.texts, "Memory 8% free"));
  assert.ok(at(ui.texts, "Memory 8% free") < at(ui.texts, "1"));
  assert.deepEqual([...ui.handlers.keys()], [right(0), right(1), right(2), right(3)]);
  assert.equal(ui.texts.includes("Rey"), false);
  assert.equal(ui.texts.includes("Done"), false);
  assert.equal(ui.texts.includes("Ship the site"), false);
  assert.equal(ui.texts.includes("This computer"), false);
  assert.equal(ui.texts.includes("⌘⇧P"), false, "the palette key lives in its tooltip");
  assert.ok(ui.colors.includes("foreground"));
  assert.ok(ui.colors.includes("muted"));
  assert.ok(ui.colors.includes("dim"));
  assert.ok(ui.colors.includes("blocked"));
  assert.deepEqual(ui.marks[0], ["blocked", "sm", "blocked"]);
  assert.equal(ui.tips.get(right(0)), "Fury · kanso · Which approach?\nRey · site · Ship the site");
  assert.equal(ui.tips.get(right(1)), "Memory 8% free");
  assert.equal(ui.tips.get(right(2)), "1 agent working");
  assert.equal(ui.tips.get(right(3)), "Command palette ⇧⌘P", "the chord comes from the key table, in the order the computer writes it");
  ui.handlers.get(right(0))();
  ui.handlers.get(right(1))();
  ui.handlers.get(right(2))();
  ui.handlers.get(right(3))();
  assert.deepEqual(ui.runs, ["kanso-spaces.needs-you.next", "kanso-tabs.memory", "kanso-spaces.view-agents", "app.palette"]);
  assert.equal(ui.ids.includes(left(0)), false, "the computer's half is the other block");
});

test("Several waiting: the bar names the oldest and how many more wait", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  ui.state.shared["kanso.needs-you"] = { rows: ["a", "b", "c"].map((address) => row(address, "blocked")) };
  new WorkspaceStatus().render();
  assert.deepEqual(["a", "+2", "b"].map((word) => ui.texts.includes(word)), [true, true, false], "the oldest and how many more, not the next");
  assert.equal(ui.tips.get(right(0)), "a · kanso\nb · kanso\nc · kanso");
});

test("A title stands in for an empty question, and a quiet bar keeps only the palette", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  ui.state.agents = [{ address: "a", status: "blocked", title: "Add the countdown?", program: { key: "claude", name: "Claude" } }];
  ui.state.terminals = [{ address: "a", report: { msg: "" } }];
  ui.state.shared["kanso.needs-you"] = { rows: [{ address: "a", pane: "p", status: "blocked", name: "Fury", project: "kanso" }] };
  const view = new WorkspaceStatus();
  view.render();
  assert.ok(ui.texts.includes("Add the countdown?"));
  assert.equal(ui.texts.includes("+1"), false);
  assert.equal([...ui.tips.values()].includes("Memory 8% free"), false);
  ui.texts.length = 0;
  ui.handlers.clear();
  ui.state.shared["kanso.needs-you"] = { rows: [{ address: "a", pane: "p", status: "done", name: "Finished", project: "kanso" }] };
  ui.state.agents = [{ address: "a", status: "done", title: "Finished" }, { address: "b", status: "idle" }];
  view.memoryText = reading(40);
  view.render();
  assert.deepEqual(ui.texts, []);
  assert.deepEqual([...ui.handlers.keys()], [right(0)]);
});

test("Sessions at work: the bar shows the working mark and how many, and shown always it counts zero", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  ui.state.agents = [{ address: "a", status: "working" }, { address: "b", status: "working" }, { address: "c", status: "idle" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.ok(ui.texts.includes("2"));
  assert.ok(ui.marks.some(([status, size]) => status === "working" && size === "sm"));
  assert.equal(ui.tips.get(right(0)), "2 agents working");
  assert.equal(ui.texts.some((text) => /of \d+ working|idle|No agents/.test(text)), false);
  ui.texts.length = 0;
  ui.handlers.clear();
  ui.state.agents = [{ address: "c", status: "idle" }];
  view.render();
  assert.deepEqual([...ui.handlers.keys()], [right(0)], "idle draws only the palette");
  ui.state.shared["kanso.pieces"] = { "status.agents": "show" };
  view.render();
  assert.ok(ui.texts.includes("0"));
  assert.ok(ui.marks.some(([status]) => status === "idle"));
});

test("Low memory stand-in: the bar says how much is free while it is low, and nothing once it recovers", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  const view = lowMemory(WorkspaceStatus);
  assert.ok(ui.texts.includes("Memory 8% free"));
  assert.ok(ui.colors.includes("blocked"));
  ui.texts.length = 0;
  ui.handlers.clear();
  view.memoryText = reading(40, Date.now());
  view.render();
  assert.equal(ui.texts.includes("Memory 40% free"), false);
  assert.deepEqual([...ui.handlers.keys()], [right(0)]);
  ui.handlers.get(right(0))();
  assert.deepEqual(ui.runs, ["app.palette"]);
});

test("Visible home stand-in: with the sidebar open the computer is not repeated; folded, the bar names it without a branch", async () => {
  const { ui, WorkspaceStatus } = await statusBar({ props: { side: "left" } });
  ui.state.spaces = [{ active: true, branch: "develop" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.deepEqual(ui.texts, []);
  ui.state.shared["sidebar.collapsed"] = true;
  view.render();
  assert.ok(ui.texts.includes("This computer"));
  assert.equal(ui.texts.includes("develop"), false, "the branch lives in the pane header and the sidebar");
  assert.equal(ui.handlers.has(left(0)), false, "a computer that can be reached has nowhere to go");
  assert.equal(ui.ids.includes(right(0)), false, "this block draws the left half");
  ui.texts.length = 0;
  ui.state.spaces = [DEVBOX];
  ui.state.machines = [{ name: "devbox", layout: "loading" }];
  view.render();
  assert.ok(ui.texts.includes("devbox"));
  assert.equal(ui.handlers.has(`${left(0)}-fix`), false, "Refresh waits until the computer can't be reached");
});

test("A computer that is connecting is drawn at the pending opacity with its breathing dot", async () => {
  const { ui, WorkspaceStatus } = await statusBar({ props: { side: "left" } });
  const { PENDING } = await load("kanso-status/ui-state.js", ["PENDING"], ui.host);
  ui.state.shared["sidebar.collapsed"] = true;
  ui.state.spaces = [{ active: true, machine: "devbox" }];
  ui.state.machines = [{ name: "devbox", layout: "loading" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.equal(ui.opacities.get(left(0)), PENDING);
  assert.equal(PENDING, 0.8);
  assert.ok(ui.ids.includes(`${left(0)}-pending`));
  ui.ids.length = 0;
  ui.opacities.clear();
  ui.state.machines = [{ name: "devbox", layout: "ready" }];
  view.render();
  assert.equal(ui.opacities.has(left(0)), false);
  assert.equal(ui.ids.includes(`${left(0)}-pending`), false);
});

test("Low memory keeps its blocked colour under the pointer; an item without a state turns foreground", async () => {
  const { ui, WorkspaceStatus } = await statusBar({ agents: [{ address: "a", status: "working" }] });
  const view = lowMemory(WorkspaceStatus);
  const memory = ui.hovers.get(right(0));
  assert.ok(memory.some(([name]) => name === "bg"));
  assert.equal(memory.some(([name]) => name === "text_color"), false);
  assert.deepEqual(ui.hovers.get(right(1)).find(([name]) => name === "text_color"), ["text_color", "foreground"]);
});

test("An unreachable computer is a failure line whose Refresh is the only computer button, even with the sidebar open", async () => {
  const { ui, WorkspaceStatus } = await statusBar({ props: { side: "left" } });
  ui.state.spaces = [DEVBOX];
  ui.state.machines = [{ name: "devbox", layout: "unavailable" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.ok(ui.texts.includes("Can't reach devbox"));
  assert.ok(ui.texts.includes("Refresh"));
  assert.equal(ui.texts.includes("feat/status-attention"), false);
  assert.deepEqual(ui.marks.at(-1), ["blocked", "md", "blocked"]);
  assert.equal(ui.colors.includes("blocked"), false, "the blocked colour stays on the mark");
  assert.equal(ui.tips.get(left(0)), "Can't reach devbox");
  ui.handlers.get(`${left(0)}-fix`)();
  assert.deepEqual(ui.runs, ["kanso-spaces.retry-machine:devbox"]);
});

test("Hidden computer, working count and palette stay hidden, and Windows names its palette chord", async () => {
  const { ui, WorkspaceStatus } = await statusBar();
  ui.state.platform = "windows";
  ui.state.agents = [{ address: "a", status: "working" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.equal(ui.tips.get(right(1)), "Command palette Ctrl+Shift+P");
  ui.handlers.clear();
  ui.state.shared["kanso.pieces"] = { "status.agents": "hide", "status.palette": "hide", "status.computer": "hide" };
  ui.state.shared["sidebar.collapsed"] = true;
  ui.state.props = { side: undefined };
  view.render();
  assert.deepEqual([...ui.handlers.keys()], []);
  assert.equal(ui.texts.includes("This computer"), false);
});

test("The right side reads the guard file on a timer and does not start a process", async () => {
  const ui = bar();
  const { MEMORY_MS } = await load("kanso-status/model.js", ["MEMORY_MS"]);
  const { WorkspaceStatus } = await loadWorkspaceStatus(ui.host);
  const pending = [], timers = [];
  let notes = 0;
  const cx = {
    notify() { notes += 1; },
    spawn(fn) { pending.push(fn(cx)); },
    timer: { after(ms, fn) { timers.push({ ms, fn }); }, every(ms, fn) { timers.push({ ms, fn }); } },
  };
  ui.state.file = reading(8.2, Date.now());
  const view = new WorkspaceStatus();
  view.init({}, cx);
  assert.deepEqual(timers.map((timer) => timer.ms), [0, MEMORY_MS]);
  assert.equal(MEMORY_MS, 60_000);
  timers[0].fn(cx);
  await pending.shift();
  assert.deepEqual(ui.state.reads, ["/Users/person/Library/Application Support/herdr/data/kanso-guard/now.json"]);
  view.render();
  assert.ok(ui.texts.includes("Memory 8% free"));
  const noted = notes;
  timers[1].fn(cx);
  await pending.shift();
  assert.equal(notes, noted, "the same reading does not redraw");
  ui.state.file = null;
  timers[1].fn(cx);
  await pending.shift();
  ui.texts.length = 0;
  view.render();
  assert.equal(ui.texts.includes("Memory 8% free"), false);
  const left = new WorkspaceStatus();
  ui.state.props = { side: "left" };
  const before = timers.length;
  left.init({}, cx);
  assert.equal(timers.length, before);
});

test("An unreachable computer's Refresh is the sidebar's", async () => {
  const called = [];
  const { Spaces } = await loadSpaces({
    agents: () => [], terminals: () => [], spaces: () => [], machines: () => [], panes: () => [],
    props: () => ({}), theme: () => ({}), shared: () => undefined, setShared: () => {},
    run: () => {}, home: () => "/Users/person", window: () => ({ platform: "macos" }),
  });
  const view = new Spaces();
  view.retryMachine = (name) => { called.push(name); };
  view.command("retry-machine:devbox", {});
  view.command("retry-machine:", {});
  assert.deepEqual(called, ["devbox"]);
});
