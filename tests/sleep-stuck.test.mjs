// A sleep step that never answers ends in one sentence, and the tab comes back.
import test from "node:test";
import assert from "node:assert/strict";
import { load, context } from "./helpers.mjs";

const space = { id: "sp", name: "Agile", folder: "/Users/jj/Documents/Agile", active: true, tabs: [{ id: "tb", active: true }] };
const shown = [{ name: "Tab 1", tab: { id: "tb" }, blocker: null, error: null, fronts: new Map(),
  capture: { per: null, cols: [{ w: 1, panes: [{ terminal: "t1", argv: ["claude"], pid: 1, resume: "c", name: "Ada" }] }] } }];
const hang = () => new Promise(() => {});

function host({ calls = [], closed = [], hc, panes, terminals, shared, setShared, readTextFile } = {}) {
  return {
    spaces: () => [space],
    panes: panes ?? (() => [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/jj/Documents/Agile" }]),
    terminals: terminals ?? (() => []),
    shared: shared ?? (() => null),
    setShared: setShared ?? (() => {}),
    run: (cmd, args) => calls.push([cmd, args]),
    hc: hc ?? (async () => ({ code: 1, stdout: "" })),
    home: () => "/Users/jj",
    readTextFile: readTextFile ?? (async () => { throw new Error("no"); }),
    props: () => ({}),
    theme: () => ({}),
    closeOverlay: () => closed.push("close"),
    exec: async () => ({ code: 1, stdout: "" }),
  };
}

function stepClock() {
  const pending = [];
  const waits = [];
  const cx = {
    notify() {},
    spawn(fn) { const task = fn(cx); pending.push(task); return task; },
    timer: { after(ms, fn) { waits.push({ ms, fn }); } },
  };
  return {
    cx,
    waits,
    async until(n) {
      for (let i = 0; i < 80 && waits.length < n; i += 1) await Promise.resolve();
    },
    fireLast() { waits.at(-1).fn(cx); },
    async drain() { while (pending.length) await pending.shift(); },
  };
}

async function open(prepare) {
  const calls = [];
  const closed = [];
  const { Sleep, sleepRefusal } = await load("kanso-sleep/main.js", ["Sleep", "sleepRefusal"], host({ calls, closed }));
  const s = new Sleep();
  s.space = space;
  s.readTabs = async () => shown;
  s.refresh = async () => {};
  s.store = { asleep: async () => [], sleep: async () => "id1" };
  prepare(s);
  const clock = stepClock();
  s.startSleep(clock.cx, false, "tb", null);
  return { s, calls, closed, clock, sleepRefusal };
}

async function late(n, prepare) {
  const opened = await open(prepare);
  await opened.clock.until(n);
  assert.equal(opened.clock.waits.length, n, `step ${n} never armed its timer`);
  assert.equal(opened.clock.waits.at(-1).ms, 15_000);
  assert.equal(opened.s.busy, "Going to sleep");
  opened.clock.fireLast();
  await opened.clock.drain();
  assert.equal(opened.s.busy, null);
  assert.equal(opened.s.ordering, false);
  return opened;
}

const back = (calls) => calls.some(([cmd, args]) => cmd === "tab.unsettle" && args.id === "tb");

test("a tab read that never answers says so and brings the tab back", { timeout: 5_000 }, async () => {
  const { s, calls, closed } = await late(1, (row) => { row.readTabs = hang; });
  assert.equal(s.error, "This tab did not answer.");
  assert.equal(back(calls), true);
  assert.deepEqual(closed, []);
});

test("a confirm read that never answers says so and brings the tab back", { timeout: 5_000 }, async () => {
  let reads = 0;
  const { s, calls } = await late(2, (row) => {
    row.readTabs = () => { reads += 1; return reads === 1 ? shown : hang(); };
  });
  assert.equal(reads, 2);
  assert.equal(s.error, "This tab did not answer.");
  assert.equal(back(calls), true);
});

test("a computer that never answers says so and brings the tab back", { timeout: 5_000 }, async () => {
  const { s, calls } = await late(3, (row) => { row.storeFor = hang; });
  assert.equal(s.error, "That computer did not answer.");
  assert.equal(back(calls), true);
});

test("asleep rows that never answer say so and bring the tab back", { timeout: 5_000 }, async () => {
  const { s, calls } = await late(4, (row) => { row.store = { asleep: hang, sleep: async () => "id1" }; });
  assert.equal(s.error, "What's asleep did not answer.");
  assert.equal(back(calls), true);
});

test("a save that never answers says so and brings the tab back", { timeout: 5_000 }, async () => {
  const { s, calls, closed } = await late(5, (row) => { row.store = { asleep: async () => [], sleep: hang }; });
  assert.equal(s.error, "It can't sleep: saving it did not answer.");
  assert.equal(back(calls), true);
  assert.deepEqual(closed, []);
});

test("a stored sleep closes even when the list never answers", { timeout: 5_000 }, async () => {
  const { s, calls, closed } = await late(6, (row) => { row.refresh = hang; });
  assert.equal(s.error, null);
  assert.equal(back(calls), false);
  assert.deepEqual(closed, ["close"]);
});

test("a list that never answers, with nothing stored, brings the tab back", { timeout: 5_000 }, async () => {
  const calls = [];
  const closed = [];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host({ calls, closed }));
  const s = new Sleep();
  s.space = space;
  s.view = "sleep";
  s.sleepers = [];
  s.sleepTabs = [];
  s.readTabs = async () => [];
  s.refresh = hang;
  s.store = { asleep: async () => [], sleep: async () => "id1" };
  s.conceal("tab", "tb", null);
  const clock = stepClock();
  const task = s.finishSleep(clock.cx);
  await clock.until(4);
  assert.equal(clock.waits.length, 4);
  clock.fireLast();
  await task;
  assert.equal(s.error, "The list did not answer.");
  assert.equal(back(calls), true);
  assert.deepEqual(closed, []);
});

test("Cancel during a read that never answers puts the tab back and does not save", { timeout: 5_000 }, async () => {
  const wrote = [];
  const { s, calls, closed, clock } = await open((row) => {
    row.readTabs = hang;
    row.store = { asleep: async () => [], sleep: async () => { wrote.push("sleep"); return "id1"; } };
  });
  assert.equal(s.busy, "Going to sleep");
  s.leaveSleep(false);
  assert.equal(back(calls), true);
  assert.deepEqual(closed, ["close"]);
  clock.fireLast();
  await clock.drain();
  assert.deepEqual(wrote, []);
  assert.equal(s.error, null);
});

test("a silent refusal says why and does not start another write", async () => {
  const { s, clock, sleepRefusal } = await open(() => {});
  clock.fireLast();
  await clock.drain();
  assert.equal(sleepRefusal({ view: "list", busy: null, ordering: false, shown }), "Sleep is not open.");
  assert.equal(sleepRefusal({ view: "sleep", busy: null, ordering: true, shown }), "Going to sleep");
  assert.equal(sleepRefusal({ view: "sleep", busy: null, ordering: false, shown: [] }), "Nothing runs here to put to sleep.");
  assert.match(sleepRefusal({ view: "sleep", busy: null, ordering: false, shown: [{ blocker: "Ada is working" }] }), /Ada is working/);
  assert.equal(sleepRefusal({ view: "sleep", busy: null, ordering: false, shown }), null);
  s.view = "sleep";
  s.busy = null;
  s.ordering = true;
  s.error = null;
  s.sleepers = shown;
  const again = stepClock();
  s.sleep(again.cx);
  assert.equal(s.busy, "Going to sleep");
  assert.equal(again.waits.length, 0);
});

test("a wake already coming back says so", async () => {
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host());
  const s = new Sleep();
  s.wake({ id: "s1", state: "undoing", name: "Ada" }, { notify() {}, spawn() { throw new Error("spawned"); } });
  assert.equal(s.error, "Coming back");
});

test("a tab with an agent and two child terminals sleeps the panes only", async () => {
  const asked = [];
  const saved = [];
  const closed = [];
  const state = new Map();
  const panes = () => [
    { pane: "pNacho", tab: "tb", terminal: "t7q", cwd: "/Users/jj/Documents/Agile" },
    { pane: "pShell", tab: "tb", terminal: "tsh", cwd: "/Users/jj/Documents/Agile" },
  ];
  const terminals = () => [
    { address: "t7q" },
    { address: "tsh" },
    { address: "cx1", parent: "t7q" },
    { address: "cx2", parent: "t7q" },
  ];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host({
    closed,
    panes,
    terminals,
    shared: (key) => (key === "strip.state" ? { tb: { n: 2, cols: [{ w: 1, panes: ["pNacho"] }, { w: 1, panes: ["pShell"] }] } } : state.get(key) ?? null),
    setShared: (key, value) => state.set(key, value),
    hc: async (args) => {
      asked.push(args[1]);
      const body = args[1] === "t7q"
        ? { foreground: { pid: 10, argv: ["claude"], cwd: "/Users/jj/Documents/Agile" }, labels: { "kanso.name": "Nacho" } }
        : { foreground: { pid: 11, argv: ["zsh"], cwd: "/Users/jj/Documents/Agile" } };
      return { code: 0, stdout: JSON.stringify(body) };
    },
    readTextFile: async (path) => (String(path).endsWith(`${10}.json`) ? JSON.stringify({ sessionId: "ses-1", pid: 10 }) : Promise.reject(new Error("no"))),
  }));
  const s = new Sleep();
  s.space = space;
  s.refresh = async () => {};
  s.store = { asleep: async () => [], sleep: async (_project, intent) => { saved.push(intent); return "as1"; } };
  const { cx, drain } = context();
  s.startSleep(cx, false, "tb", null);
  await drain();
  assert.deepEqual(closed, ["close"]);
  assert.equal(s.error, null);
  const panesOf = saved[0].cols.flatMap((c) => c.panes);
  assert.deepEqual(panesOf.map((p) => p.terminal), ["t7q", "tsh"]);
  assert.equal(panesOf[0].name, "Nacho");
  assert.equal(panesOf[0].pid, 10);
  assert.equal(panesOf[1].argv, null);
  assert.equal(asked.includes("cx1"), false);
  assert.equal(asked.includes("cx2"), false);
  assert.equal(asked.includes("t7q"), true);
  assert.equal(asked.includes("tsh"), true);
});
