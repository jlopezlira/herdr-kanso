// Sleep on Herdr's own state: a label keeps the conversation, the tab settles; Wake reads them back.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, drawingHost, texts, KIT_NIGHT } from "./helpers.mjs";

const sleepMod = (host = {}) => load("kanso-sleep/main.js", ["Sleep", "sleepPlan", "hideCommands", "wakePlan", "exitStep", "labelArgs", "atPrompt", "CLEAR_MS", "EXIT_MS", "RESEND_MS"], { home: () => "/home/me", ...host });
const space = (over = {}) => ({ id: "sp1", active: true, tabs: [{ id: "a", active: true }, { id: "b" }], ...over });
const reads = [
  { terminal: "t1", name: "Rey", resume: "00000000-0000-4000-8000-000000000001", running: true },
  { terminal: "t2", name: "npm", resume: null, running: true },
  { terminal: "t3", name: "zsh", resume: null, running: false },
];

test("a tab sleeps: each Claude exits on its label, the rest is interrupted, the tab settles and another is shown", async () => {
  const { sleepPlan } = await sleepMod();
  const plan = clone(sleepPlan("tab", space(), ["a"], reads, [space()]));
  assert.deepEqual(plan.exits.map((r) => r.terminal), ["t1"]);
  assert.deepEqual(plan.interrupts, ["t2"], "a shell at rest is left alone");
  assert.deepEqual(plan.after, [["tab.settle", { id: "a" }], ["tab.select", { id: "b" }]]);
});

test("an agent sleeps alone: no interrupt, no settle", async () => {
  const { sleepPlan } = await sleepMod();
  assert.deepEqual(clone(sleepPlan("agent", space(), ["a"], [reads[0]], [space()])), { exits: [reads[0]], interrupts: [], after: [] });
});

test("a project sleeps: every tab settles and the project beside is shown", async () => {
  const { sleepPlan } = await sleepMod();
  const all = [space(), { id: "sp2", tabs: [] }];
  assert.deepEqual(clone(sleepPlan("project", space(), ["a", "b"], reads, all).after),
    [["tab.settle", { id: "a" }], ["tab.settle", { id: "b" }], ["space.select", { id: "sp2" }]]);
});

test("a tab not shown settles without moving you", async () => {
  const { hideCommands } = await sleepMod();
  assert.deepEqual(clone(hideCommands(space(), ["b"], [space()])), [["tab.settle", { id: "b" }]]);
  assert.deepEqual(clone(hideCommands(space({ active: false }), ["a"], [space()])), [["tab.settle", { id: "a" }]]);
});

test("one look at a Claude on its way out: clear, /exit, yes, again, or why not", async () => {
  const { exitStep, CLEAR_MS, EXIT_MS, RESEND_MS } = await sleepMod();
  const st = { pid: 9, name: "Rey", at: 0, sent: null, last: null };
  const claude = { pid: 1, foreground: { pid: 9 } };
  const box = (line) => ["─".repeat(20), line, "─".repeat(20)].join("\n");
  assert.deepEqual(clone(exitStep(st, { pid: 1, foreground: { pid: 1 } }, "", 10)), { done: true }, "its shell is back");
  assert.deepEqual(clone(exitStep(st, { pid: 1, foreground: { pid: 7 } }, "", 10)), { fail: "Rey's terminal changed" });
  assert.deepEqual(clone(exitStep(st, claude, box("❯ "), 10)), { act: "exit", st: { ...st, sent: 10, last: 10 } });
  assert.deepEqual(clone(exitStep(st, claude, box("❯ draft"), CLEAR_MS + 1)), { fail: "Rey's prompt could not be cleared" });
  const sent = { ...st, sent: 10, last: 10 };
  assert.equal(exitStep(sent, claude, "Exit and stop tasks?", 20).act, "enter");
  assert.equal(exitStep(sent, claude, box("❯ "), 10 + RESEND_MS + 1).act, "exit", "an /exit that did not land goes again");
  assert.deepEqual(clone(exitStep(sent, claude, box("working"), 10 + EXIT_MS + 1)), { fail: "Rey did not exit" });
});

test("a failed exit takes its label back and settles nothing; the dialog says why", async () => {
  const calls = [], runs = [];
  const hc = async (args) => {
    calls.push(args);
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 99 } }) };
    return { code: 0, stdout: "" };
  };
  const { Sleep } = await sleepMod({ hc, spaces: () => [space()], run: (...a) => runs.push(a), props: () => ({}), closeOverlay: () => runs.push(["close"]) });
  const view = Object.assign(new Sleep(), { order: { scope: "tab", tab: "a" }, space: space(), reads: [{ ...reads[0], pid: 9 }, reads[1]], busy: null, error: null });
  await view.sleep({ notify() {}, sleep: async () => {} });
  assert.deepEqual(clone(calls.filter((a) => a[0] === "label")), [["label", "t1", "kanso.resume=00000000-0000-4000-8000-000000000001"], ["label", "t1", "kanso.resume="]]);
  assert.equal(calls.some((a) => a[0] === "interrupt"), false, "nothing else stops");
  assert.deepEqual(runs, [], "no tab settles, the dialog stays");
  assert.equal(view.error, "It can't sleep: Rey's terminal changed.");
});

test("a tab wakes: it comes back and is shown, then each asleep terminal resumes before its asleep mark is cleared", async () => {
  const { wakePlan } = await sleepMod();
  const sp = space({ active: false, tabs: [{ id: "a", settled: true }, { id: "b" }] });
  const ps = [{ terminal: "t1", tab: "a" }, { terminal: "t2", tab: "a" }, { terminal: "t3", tab: "b" }];
  const shell = (address, resume) => ({ address, state: "live", program: { shell: true }, labels: resume ? { "kanso.resume": resume } : {} });
  const terms = [shell("t1", "00000000-0000-4000-8000-000000000001"), shell("t2", null), shell("t3", "00000000-0000-4000-8000-000000000003")];
  const plan = clone(wakePlan(sp, ["a"], null, ps, terms));
  assert.deepEqual(plan.commands, [["tab.unsettle", { id: "a" }], ["space.select", { id: "sp1" }], ["tab.select", { id: "a" }]]);
  assert.deepEqual(plan.sessions, [{
    name: "t1",
    resume: ["send", "t1", "claude --resume 00000000-0000-4000-8000-000000000001"],
    clear: ["label", "t1", "kanso.resume="],
  }], "t3's tab was not asked");
  const one = clone(wakePlan(space(), ["b"], "t3", ps, terms));
  assert.deepEqual(one.commands, [["tab.select", { id: "b" }]], "an agent asleep alone: its tab was never settled");
  assert.deepEqual(one.sessions, [{
    name: "t3",
    resume: ["send", "t3", "claude --resume 00000000-0000-4000-8000-000000000003"],
    clear: ["label", "t3", "kanso.resume="],
  }]);
  const running = [{ ...shell("t1", "00000000-0000-4000-8000-000000000001"), program: { agent: true } }];
  assert.deepEqual(clone(wakePlan(sp, ["a"], null, ps, running)).sessions, [], "a terminal that runs something is not sent the line");
});

test("only a real session id is kept or typed: a label can never carry shell text", async () => {
  const { wakePlan, labelArgs } = await sleepMod();
  const { resumeLine, isSessionId } = await load("kanso-sleep/resume.js", ["resumeLine", "isSessionId"]);
  const id = "00000000-0000-4000-8000-000000000001", bad = "x; rm -rf ~";
  assert.equal(isSessionId(id), true);
  assert.equal(isSessionId(bad), false);
  assert.equal(resumeLine(id), `claude --resume ${id}`);
  assert.equal(resumeLine(bad), null);
  assert.deepEqual(clone(labelArgs("t1", bad)), ["label", "t1", "kanso.resume="]);
  const sp = space({ tabs: [{ id: "a", settled: true }] });
  const terms = [{ address: "t1", state: "live", program: { shell: true }, labels: { "kanso.resume": bad } }];
  assert.deepEqual(clone(wakePlan(sp, ["a"], null, [{ terminal: "t1", tab: "a" }], terms)).sessions, [], "a forged label is not asleep and is never sent");
});

const REY = "00000000-0000-4000-8000-000000000001";
const FINN = "00000000-0000-4000-8000-000000000002";
const asleepShell = (address, resume, title) => ({
  address, state: "live", title, program: { shell: true }, labels: { "kanso.resume": resume },
});
const awakeSpace = { id: "sp1", active: true, name: "App", tabs: [{ id: "a", active: true }] };

async function openWake({ hc, panes, terminals }) {
  const closed = [];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], {
    ...drawingHost(),
    home: () => "/home/me",
    theme: () => KIT_NIGHT,
    props: () => ({ overlay: "wake" }),
    closeOverlay: (id) => closed.push(id),
    spaces: () => [awakeSpace],
    panes,
    terminals,
    hc,
    run: () => {},
  });
  const view = Object.assign(new Sleep(), { handle: {}, order: null, space: awakeSpace, reads: null, busy: null, error: null });
  const task = { notify() {}, spawn(fn) { this.pending = Promise.resolve(fn(this)); return this.pending; } };
  return { view, closed, wake: async (ask) => { view.wake(task, ask); await task.pending; }, shown: () => texts(view.render()) };
}

const quiet = { code: 0, stdout: "", stderr: "" };
const gone = { code: 1, stdout: "", stderr: "gone" };
const onePane = () => [{ terminal: "t1", tab: "a" }];
const rey = () => [asleepShell("t1", REY, "Rey")];
const commandsFor = (calls, terminal) => calls.filter((args) => args[1] === terminal).map((args) => args[0]);

async function driveWake(hc, terminals, panes = onePane) {
  const calls = [];
  const answer = async (args) => {
    calls.push(args);
    return hc(args);
  };
  const opened = await openWake({ hc: answer, panes, terminals });
  await opened.wake({ tab: "a" });
  return { ...opened, calls };
}

function stayed(opened, terminal, commands, note) {
  assert.deepEqual(commandsFor(opened.calls, terminal), commands);
  assert.equal(opened.view.error, note);
  assert.ok(opened.shown().includes(note));
  assert.deepEqual(opened.closed, []);
}

async function resumeMiss(hc) {
  const opened = await driveWake(hc, rey);
  stayed(opened, "t1", ["send"], "Rey did not come back.");
  return opened;
}

test("Wake keeps the asleep conversation when resume fails, shows that failure, and can try again", async () => {
  let fail = true;
  const opened = await resumeMiss(async (args) => (args[0] === "send" && fail ? gone : quiet));
  fail = false;
  await opened.wake({ tab: "a" });
  assert.deepEqual(commandsFor(opened.calls, "t1"), ["send", "send", "label"]);
  assert.deepEqual(opened.closed, ["wake"]);
});

test("Wake keeps the asleep conversation when resume is rejected, and shows that failure", async () => {
  await resumeMiss(async (args) => {
    if (args[0] === "send") throw new Error("gone");
    return quiet;
  });
});

test("Wake shows that the asleep mark stayed after the conversation came back", async () => {
  let live = rey();
  const hc = async (args) => {
    if (args[0] !== "send") return { code: 1, stdout: "", stderr: "kept" };
    live = [{ address: "t1", state: "live", title: "Rey", program: { agent: true }, labels: { "kanso.resume": REY } }];
    return quiet;
  };
  const opened = await driveWake(hc, () => live);
  stayed(opened, "t1", ["send", "label"], "Rey is awake, but still looks asleep.");
  const sent = opened.calls.filter((args) => args[0] === "send").length;
  await opened.wake({ tab: "a" });
  assert.equal(opened.calls.filter((args) => args[0] === "send").length, sent);
});

test("Waking two conversations names only the one that did not come back", async () => {
  const terms = () => [asleepShell("t1", REY, "Rey"), asleepShell("t2", FINN, "Finn")];
  const panes = () => [{ terminal: "t1", tab: "a" }, { terminal: "t2", tab: "a" }];
  const hc = async (args) => (args[0] === "send" && args[1] === "t1" ? gone : quiet);
  const opened = await driveWake(hc, terms, panes);
  stayed(opened, "t1", ["send"], "Rey did not come back.");
  assert.deepEqual(commandsFor(opened.calls, "t2"), ["send", "label"]);
  assert.equal(opened.shown().includes("Finn"), false);
});

test("Sleep does not put the tab away when something in it could not be stopped", async () => {
  const runs = [];
  const seen = [];
  const hc = async (args) => {
    seen.push(args);
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 1 } }) };
    if (args[0] === "interrupt") return gone;
    return { code: 0, stdout: "" };
  };
  const host = {
    hc, spaces: () => [space()], run: (...args) => runs.push(args), props: () => ({}), closeOverlay: () => runs.push(["close"]),
  };
  const { Sleep } = await sleepMod(host);
  const view = Object.assign(new Sleep(), {
    order: { scope: "tab", tab: "a" },
    space: space(),
    reads: [{ ...reads[0], pid: 9 }, reads[1]],
    busy: null,
    error: null,
  });
  await view.sleep({ notify() {}, sleep: async () => {} });
  assert.equal(seen.some((args) => args[0] === "interrupt"), true);
  assert.equal(view.error, "It can't sleep: npm could not be stopped.");
  assert.deepEqual(runs, []);
});
