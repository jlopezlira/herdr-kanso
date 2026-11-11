import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const RULE = "─".repeat(40);
const EMPTY = `Agent\n${RULE}\n❯ \n${RULE}\n`;
const ASK = "Background work is running\n1. Exit and stop tasks\n2. Cancel";
const cx = { sleep: async () => {}, spawn: (fn) => fn(cx) };

async function workerFixture(verb = "send", arg = "/exit", step = "clearing") {
  const calls = [], gone = new Set();
  const rows = [1, 2].map((n) => ({
    id: `s${n}`, state: "sleeping", pending: "owner", pending_at: Date.now(),
    agents: [{ id: `c${n}`, name: `Agent ${n}`, step: n === 1 ? step : "requested", step_at: Date.now(), sent_at: step === "exiting" ? Date.now() : null }],
    layout: JSON.stringify({ tab: `tb${n}`, cols: [{ panes: [{ resume: `c${n}`, terminal: `t${n}`, pid: n, front: n, wake: ["agent", "--resume", `c${n}`] }] }] }),
  }));
  const screens = { t1: step === "exiting" ? ASK : EMPTY, t2: EMPTY };
  let reject;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  const kdb = {
    sleeps: async () => clone(rows.filter((r) => ["sleeping", "undoing"].includes(r.state))),
    holdWork: async () => true,
    stillMine: async () => true,
    stepAgent: async (id, _owner, state, conversation, before, patch) => {
      const row = rows.find((r) => r.id === id), a = row.agents.find((a) => a.id === conversation);
      if (row.state !== state || a.step !== before) return false;
      Object.assign(a, patch);
      return true;
    },
    finishSleep: async (id) => { rows.find((r) => r.id === id).state = "asleep"; return true; },
    setWorkState: async (id, _owner, _before, state) => { rows.find((r) => r.id === id).state = state; return true; },
  };
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], {
    processApi: () => ({ exists: async (pid) => !gone.has(pid), runningSession: async () => null }),
    terminals: () => [1, 2].map((n) => ({ address: `t${n}` })),
    panes: () => [1, 2].map((n) => ({ tab: `tb${n}`, terminal: `t${n}` })),
    home: () => "/home",
    readTextFile: async (path) => { const pid = Number(/(\d+)\.json$/.exec(path)[1]); return JSON.stringify({ pid, sessionId: `c${pid}` }); },
    run: () => {},
    hc: async (args) => {
      const [action, terminal, text] = args, n = Number(terminal.slice(1));
      if (action === "get") return { code: 0, stdout: JSON.stringify({ pid: n + 10, foreground: { pid: gone.has(n) ? n + 10 : n, argv: ["agent"] } }) };
      if (action === "read") return { code: 0, stdout: screens[terminal] };
      calls.push(args);
      if (terminal === "t1" && action === verb && (arg == null || text === arg)) return pending;
      if (action === "send") gone.add(n);
      return { code: 0 };
    },
  });
  return { w: new SleepWork(kdb, () => {}, "owner"), rows, calls, gone, screens, reject };
}

test("a send that never settles permits later ticks and another sleep, suppresses repeat exit, and finishes when the agent leaves", { timeout: 2000 }, async () => {
  const { w, rows, calls, gone } = await workerFixture();
  await w.tick(cx);
  assert.equal(rows[0].agents[0].step, "exiting");
  rows[0].agents[0].step_at -= 6000;
  for (let n = 0; n < 8; n++) await w.tick(cx);
  assert.equal(calls.filter(([v, t]) => v === "send" && t === "t1").length, 1);
  assert.equal(rows[1].state, "asleep", "the other row finishes while the first send remains pending");
  gone.add(1);
  await w.tick(cx);
  await w.tick(cx);
  assert.equal(rows[0].state, "asleep");
  assert.equal(w.pending.size, 1, "no send completion was needed");
});

for (const [key, step] of [["ctrl+c", "saving"], ["enter", "exiting"]]) {
  test(`a pending ${key} does not block ticks or repeat while its agent can still leave`, { timeout: 2000 }, async () => {
    const { w, calls, gone, rows } = await workerFixture("keys", key, step);
    for (let n = 0; n < 4; n++) await w.tick(cx);
    assert.equal(calls.filter(([v, t, k]) => v === "keys" && t === "t1" && k === key).length, 1);
    gone.add(1);
    await w.tick(cx);
    await w.tick(cx);
    assert.equal(rows[0].state, "asleep");
  });
}

test("a rejected send clears its pending guard and existing resend checks can retry", { timeout: 2000 }, async () => {
  const { w, rows, calls, reject } = await workerFixture();
  await w.tick(cx);
  reject(new Error("send failed"));
  await new Promise(setImmediate);
  assert.equal(w.pending.size, 0);
  rows[0].agents[0].step_at -= 6000;
  await w.tick(cx);
  assert.equal(calls.filter(([v, t]) => v === "send" && t === "t1").length, 2);
});

test("an undo send that never settles does not block other rows or send its resume twice", { timeout: 2000 }, async () => {
  const { w, rows, gone, calls } = await workerFixture("send", null, "left");
  rows[0].state = "undoing";
  gone.add(1);
  for (let n = 0; n < 12; n++) await w.tick(cx);
  assert.equal(rows[0].agents[0].step, "returning");
  assert.equal(rows[1].state, "asleep");
  assert.equal(calls.filter(([v, t]) => v === "send" && t === "t1").length, 1);
  assert.equal(w.pending.size, 1);
});

const tab = (id, active = true) => ({ id, active });
const space = (id, tabs, active = true) => ({ id, tabs, active });

test("a last tab or a whole project selects the neighbouring space and keeps its return in shared hide entries", async () => {
  const m = await load("kanso-spaces/sleepwork.js", ["hidePlan", "hideEntries", "commandsOf"], {});
  for (const scope of ["tab", "project"]) {
    const tabs = [tab("t1")];
    const list = [space("before", [tab("b")], false), space("here", tabs), space("after", [tab("a")], false)];
    const plan = m.hidePlan({ scope, tab: "t1" }, [], tabs, list);
    assert.deepEqual(clone(m.commandsOf(plan)), [["tab.settle", { id: "t1" }], ["space.select", { id: "after" }]]);
    const back = [["tab.unsettle", { id: "t1" }], ["space.select", { id: "here" }]];
    assert.deepEqual(clone(m.commandsOf(plan, { back: true })), back);
    assert.deepEqual(clone(m.commandsOf(m.hideEntries(plan)[0], { back: true })), back);
    assert.equal(m.hidePlan({ scope, tab: "t1" }, [], tabs, list.slice(0, 2)).nextSpace, "before");
  }
});

test("a sole space stays settled without a navigation command, and another tab keeps navigation inside its space", async () => {
  const { hidePlan, commandsOf } = await load("kanso-spaces/sleepwork.js", ["hidePlan", "commandsOf"], {});
  const tabs = [tab("t1")];
  for (const scope of ["tab", "project"]) {
    const plan = hidePlan({ scope, tab: "t1" }, [], tabs, [space("here", tabs)]);
    assert.deepEqual(clone(commandsOf(plan)), [["tab.settle", { id: "t1" }]]);
    assert.deepEqual(clone(commandsOf(plan, { back: true })), [["tab.unsettle", { id: "t1" }]]);
  }
  const two = [...tabs, tab("t2", false)];
  const plan = hidePlan({ scope: "tab", tab: "t1" }, [], two, [space("here", two), space("else", tabs, false)]);
  assert.deepEqual(clone(commandsOf(plan, { active: "t1", next: "t2" })), [["tab.settle", { id: "t1" }], ["tab.select", { id: "t2" }]]);
});

test("Undo uses the saved space after the dialog is gone and clears its hidden entry", async () => {
  const calls = [], state = new Map();
  const m = await load("kanso-spaces/sleepwork.js", ["hidePlan", "hideEntries", "claimHide", "releaseHide"], { run: (cmd, args) => calls.push([cmd, args]) });
  const tabs = [tab("t1")];
  const plan = m.hidePlan({ scope: "tab", tab: "t1" }, [], tabs, [space("here", tabs), space("else", [tab("t2")], false)]);
  state.set("kanso.sleep.hidden", m.claimHide(m.hideEntries(plan), "t1", "sleep-id"));
  assert.equal(m.releaseHide("sleep-id", (key) => state.get(key), (key, value) => state.set(key, value)), true);
  assert.deepEqual(clone(calls), [["tab.unsettle", { id: "t1" }], ["space.select", { id: "here" }]]);
  assert.equal(state.get("kanso.sleep.hidden").length, 0);
});

test("a space absent from the list has no neighbour", async () => {
  const { spaceBeside } = await load("kanso-arrange/tabkit.js", ["spaceBeside"], {});
  assert.equal(spaceBeside("missing", [space("here", [])]), null);
});
