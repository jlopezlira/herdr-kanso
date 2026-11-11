// What the status bar says, and where each click goes.
import test from "node:test";
import assert from "node:assert/strict";
import { clone, load } from "./helpers.mjs";

const now = 1_700_000_000_000;
const row = (address, status, extra = {}) => ({ address, status, pane: `pane-${address}`, name: address, project: "kanso", ...extra });
const reading = (free, at = now, extra = {}) => JSON.stringify({ v: 1, at, machine: { freePct: free }, limits: { lowFreePct: 20 }, ...extra });

test("A question is what the agent said, or a title that says more than its name", async () => {
  const { questionOf } = await load("kanso-status/model.js", ["questionOf"]);
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
  assert.equal(ask(long, "Other"), long);
});

test("Needs you names the oldest blocked agent, and nothing when nobody waits", async () => {
  const { needsItem, QUESTION_W, NEEDS_COMMAND } = await load("kanso-status/model.js", ["needsItem", "QUESTION_W", "NEEDS_COMMAND"]);
  assert.equal(needsItem(null), null);
  assert.equal(needsItem([]), null);
  assert.equal(needsItem([row("a", "done")]), null);
  assert.equal(needsItem([row("a", "blocked", { pane: null })]), null);
  assert.equal(needsItem([row("a", "blocked", { address: "" })]), null);
  const one = needsItem([row("later", "blocked"), row("done", "done")], { later: "Add the countdown?" });
  assert.equal(one.name, "later");
  assert.equal(one.question, "Add the countdown?");
  assert.equal(one.more, null);
  assert.equal(one.mark, "blocked");
  assert.equal(one.nameTone, "foreground");
  assert.equal(one.questionTone, "muted");
  assert.equal(one.moreTone, "dim");
  assert.equal(one.questionWidth, QUESTION_W);
  assert.equal(QUESTION_W, 260);
  assert.equal(one.command, NEEDS_COMMAND);
  assert.equal(one.tooltip, "later · kanso · Add the countdown?");
  const queued = [row("new", "blocked"), row("old", "blocked", { project: "site" }), row("done", "done", { name: "Finished" })];
  const two = needsItem(queued, { new: null, old: "Ship it" });
  assert.equal(two.name, "new");
  assert.equal(two.question, null);
  assert.equal(two.more, "+1");
  assert.equal(two.tooltip, "new · kanso\nold · site · Ship it");
  assert.equal(needsItem([row("a", "blocked"), row("b", "blocked"), row("c", "blocked")]).more, "+2");
  assert.equal(needsItem([{ address: "a", status: "blocked", pane: "p", project: "kanso" }]).name, "Agent");
});

test("The computer says where you are, and Retry only when that computer is unreachable", async () => {
  const { computerOf } = await load("kanso-status/model.js", ["computerOf"]);
  const shown = (space, layouts) => clone(computerOf(space, layouts));
  assert.deepEqual(shown(null, []), { icon: "monitor", words: "This computer", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "" }, [{ name: "devbox", layout: "unavailable" }]), { icon: "monitor", words: "This computer", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "ready" }]), { icon: "server", words: "devbox", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "loading" }]), { icon: "server", words: "devbox", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "devbox" }, []), { icon: "server", words: "devbox", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "other", layout: "unavailable" }]), { icon: "server", words: "devbox", tone: "muted", command: null, tooltip: null });
  assert.deepEqual(shown({ machine: "devbox" }, [{ name: "devbox", layout: "unavailable" }]), {
    icon: "server", words: "devbox · unreachable", tone: "blocked", command: "kanso-spaces.retry-machine:devbox", tooltip: "devbox · unreachable",
  });
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
  const texts = [], colors = [], handlers = new Map(), tips = new Map(), runs = [], marks = [];
  const node = () => {
    let id = null;
    const el = new Proxy({}, { get(_target, key) {
      if (key === "then") return undefined;
      if (key === "id") return (value) => { id = value; return el; };
      if (key === "tooltip") return (value) => { tips.set(id, value); return el; };
      if (key === "text_color") return (value) => { colors.push(value); return el; };
      if (key === "child") return (value) => { if (typeof value === "string") texts.push(value); return el; };
      if (key === "when") return (on, apply) => on ? apply(el) : el;
      if (key === "on_click") return (fn) => { handlers.set(id, fn); return el; };
      return () => el;
    } });
    return el;
  };
  const state = { spaces: [], agents: [], terminals: [], machines: [], props: { side: "right" }, platform: "macos", shared: {}, file: null, reads: [] };
  const host = {
    div: node, svg: node, h_flex: node, v_flex: node,
    theme: () => new Proxy({ chrome: "chrome" }, { get: (obj, key) => (key in obj ? obj[key] : String(key)) }),
    spaces: () => state.spaces, agents: () => state.agents, terminals: () => state.terminals, machines: () => state.machines,
    props: () => state.props, window: () => ({ platform: state.platform }),
    shared: (key) => state.shared[key], run: (command) => { runs.push(command); },
    appHome: () => "/Users/person/Library/Application Support/herdr",
    readTextFile: async (path) => { state.reads.push(path); return state.file; },
    stateMark: (t, status, size) => { marks.push([status, size, t.blocked]); return node().child(status === "blocked" ? "!" : ""); },
  };
  return { texts, colors, handlers, tips, runs, marks, state, host };
}

const at = (texts, word) => texts.indexOf(word);

test("The right side names who waits, then low memory, then the working count and the palette", async () => {
  const ui = bar();
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], ui.host);
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
  const view = new WorkspaceStatus();
  view.memoryText = reading(8, Date.now());
  view.render();
  assert.ok(at(ui.texts, "Fury") < at(ui.texts, "Which approach?"));
  assert.ok(at(ui.texts, "Which approach?") < at(ui.texts, "+1"));
  assert.ok(at(ui.texts, "+1") < at(ui.texts, "Memory 8% free"));
  assert.ok(at(ui.texts, "Memory 8% free") < at(ui.texts, "1 of 2 working"));
  assert.ok(at(ui.texts, "1 of 2 working") < at(ui.texts, "⌘⇧P"));
  assert.equal(ui.texts.includes("Rey"), false);
  assert.equal(ui.texts.includes("Done"), false);
  assert.equal(ui.texts.includes("Ship the site"), false);
  assert.equal(ui.texts.includes("This computer"), false);
  assert.ok(ui.colors.includes("foreground"));
  assert.ok(ui.colors.includes("muted"));
  assert.ok(ui.colors.includes("dim"));
  assert.ok(ui.colors.includes("blocked"));
  assert.deepEqual(ui.marks[0], ["blocked", 12, "blocked"]);
  assert.equal(ui.tips.get("needs-you"), "Fury · kanso · Which approach?\nRey · site · Ship the site");
  assert.equal(ui.tips.get("status-memory"), "Memory 8% free");
  assert.equal(ui.tips.get("palette"), "Command palette");
  ui.handlers.get("needs-you")();
  ui.handlers.get("status-memory")();
  ui.handlers.get("palette")();
  assert.deepEqual(ui.runs, ["kanso-spaces.needs-you.next", "kanso-tabs.memory", "app.palette"]);
  assert.equal(ui.handlers.has("status-computer"), false);
});

test("A title stands in for an empty question, and a quiet bar paints no waiting item", async () => {
  const ui = bar();
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], ui.host);
  ui.state.agents = [{ address: "a", status: "blocked", title: "Add the countdown?", program: { key: "claude", name: "Claude" } }];
  ui.state.terminals = [{ address: "a", report: { msg: "" } }];
  ui.state.shared["kanso.needs-you"] = { rows: [{ address: "a", pane: "p", status: "blocked", name: "Fury", project: "kanso" }] };
  const view = new WorkspaceStatus();
  view.render();
  assert.ok(ui.texts.includes("Add the countdown?"));
  assert.equal(ui.texts.includes("+1"), false);
  assert.equal(ui.handlers.has("status-memory"), false);
  ui.texts.length = 0;
  ui.handlers.clear();
  ui.state.shared["kanso.needs-you"] = { rows: [{ address: "a", pane: "p", status: "done", name: "Finished", project: "kanso" }] };
  ui.state.agents = [{ address: "a", status: "done", title: "Finished" }];
  view.memoryText = reading(40);
  view.render();
  assert.equal(ui.texts.includes("Finished"), false);
  assert.equal(ui.texts.includes("Memory"), false);
  assert.equal(ui.handlers.has("needs-you"), false);
  assert.equal(ui.handlers.has("status-memory"), false);
  assert.deepEqual([...ui.handlers.keys()], ["palette"]);
});

test("The left side names this computer, and an unreachable one is the only computer button", async () => {
  const ui = bar();
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], ui.host);
  ui.state.props = { side: "left" };
  ui.state.spaces = [{ active: true, branch: "develop" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.ok(ui.texts.includes("This computer"));
  assert.ok(ui.texts.includes("develop"));
  assert.equal(ui.handlers.has("status-computer"), false);
  assert.equal(ui.handlers.has("needs-you"), false);
  assert.equal(ui.handlers.has("palette"), false);
  ui.texts.length = 0;
  ui.state.spaces = [{ active: true, machine: "devbox", branch: "feat/status-attention" }];
  ui.state.machines = [{ name: "devbox", layout: "ready" }];
  view.render();
  assert.ok(ui.texts.includes("devbox"));
  assert.equal(ui.texts.includes("devbox · unreachable"), false);
  assert.equal(ui.handlers.has("status-computer"), false);
  ui.texts.length = 0;
  ui.state.machines = [{ name: "devbox", layout: "unavailable" }];
  view.render();
  assert.ok(ui.texts.includes("devbox · unreachable"));
  assert.ok(ui.texts.includes("feat/status-attention"));
  assert.ok(ui.colors.includes("blocked"));
  assert.equal(ui.tips.get("status-computer"), "devbox · unreachable");
  ui.handlers.get("status-computer")();
  assert.deepEqual(ui.runs, ["kanso-spaces.retry-machine:devbox"]);
});

test("Hidden working count and palette stay hidden, and Windows names its palette chord", async () => {
  const ui = bar();
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], ui.host);
  ui.state.platform = "windows";
  ui.state.shared["kanso.pieces"] = { "status.agents": "hide", "status.palette": "hide" };
  ui.state.agents = [{ address: "a", status: "working" }];
  const view = new WorkspaceStatus();
  view.render();
  assert.equal(ui.texts.includes("1 of 1 working"), false);
  assert.equal(ui.texts.includes("Ctrl+Shift+P"), false);
  assert.equal(ui.handlers.has("palette"), false);
});

test("The right side reads the guard file on a timer and does not start a process", async () => {
  const ui = bar();
  const { MEMORY_MS } = await load("kanso-status/model.js", ["MEMORY_MS"]);
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], ui.host);
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

test("An unreachable computer's click is the sidebar's Retry", async () => {
  const called = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
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
