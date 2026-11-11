// Whether each conversation's process still runs: how many `ps` the sidebar takes to know, on a fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const T1 = { address: "t1", state: "live", status: "working", pid: 50, foreground: { pid: 101 } };

// A fake Herdr whose `ps` answers `latency` ms after it is asked, and counts every one.
// `plan(n)` makes the n-th `ps` "reject" or "hang" (kept in h.hung, answered only when a test says so).
async function sidebar({ latency = 0, active = true, collapsed = false, view = "spaces", terms = [T1], rows = [], plan = () => null, host = {} } = {}) {
  const h = { clock: 0, active, collapsed, terms: clone(terms), live: new Set([101, 202]), ps: [], inFlight: 0, most: 0, waiting: [], hung: [] };
  const table = () => [...[...h.live].map((pid) => `${pid} 1 00:10 claude`), ...rows].join("\n");
  const answer = (args) => {
    if (args[0] === "-axo") return { code: 0, stdout: `${table()}\n` };
    const asked = args.at(-1).split(",").map(Number).filter((p) => h.live.has(p));
    return { code: asked.length ? 0 : 1, stdout: asked.map((p) => `${p}\n`).join("") };
  };
  const exec = (cmd, args) => {
    if (cmd !== "ps") return Promise.resolve({ code: 1, stdout: "" });
    const mode = plan(h.ps.length);
    h.ps.push({ at: h.clock, whole: args[0] === "-axo" });
    if (mode === "reject") return Promise.reject(new Error("ps: no such process table"));
    if (mode === "hang") return new Promise((resolve) => h.hung.push(() => resolve(answer(args))));
    h.inFlight += 1;
    h.most = Math.max(h.most, h.inFlight);
    return new Promise((resolve) => h.waiting.push({ due: h.clock + latency, done: () => { h.inFlight -= 1; resolve(answer(args)); } }));
  };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: { now: () => h.clock }, exec,
    window: () => ({ active: h.active, platform: "macos" }),
    shared: (k) => (k === "sidebar.collapsed" ? h.collapsed : null), setShared: () => {},
    terminals: () => h.terms, spaces: () => [], panes: () => [], agents: () => [], machines: () => [],
    ...host,
  });
  const v = Object.assign(new Spaces(), {
    view, tasks: {}, shown: new Set(), born: {},
    threads: { t1: { pid: 101, file: "/a.jsonl" }, t2: { pid: 202, file: "/b.jsonl" } },
  });
  // Only the liveness part of checkNew runs here; the rest has its own tests.
  for (const name of ["takeMoves", "trackFocus", "trackAgents", "trackReturn", "refreshThreads", "keepSeen", "prune"]) v[name] = () => {};
  v.due = () => new Set();
  const cx = { notify() {}, spawn(fn) { fn(cx); } };
  const settle = async () => {
    for (const w of h.waiting.filter((x) => x.due <= h.clock)) { h.waiting.splice(h.waiting.indexOf(w), 1); w.done(); }
    await new Promise((r) => setImmediate(r));
  };
  // The sidebar tick and process timer share one reader.
  h.run = async (until, each = () => {}) => {
    for (; h.clock <= until; h.clock += 500) {
      each(h.clock);
      v.checkNew(cx);
      if (h.clock % 10000 === 0) v.checkTasks(cx);
      await settle();
    }
  };
  return { h, v };
}

test("one full process table serves tasks and liveness every ten seconds in front", async () => {
  const { h, v } = await sidebar();
  await h.run(60000);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000, 20000, 30000, 40000, 50000, 60000]);
  assert.ok(h.ps.every((x) => x.whole), "no separate ps -p reader");
  assert.deepEqual([...v.alive].toSorted(), [101, 202]);
});

test("Threads and a collapsed sidebar use the same table and the foreground/background cadence", async () => {
  for (const options of [{ view: "threads" }, { collapsed: true, terms: [] }]) {
    const { h } = await sidebar(options);
    await h.run(60000);
    assert.equal(h.ps.length, 7);
    assert.ok(h.ps.every((x) => x.whole));
  }
  const { h } = await sidebar({ view: "threads", active: false });
  await h.run(120000);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 30000, 60000, 90000, 120000]);
});

test("idle agents without conversations never ask for a process table", async () => {
  const { h, v } = await sidebar({ terms: [{ ...T1, status: "idle" }] });
  v.threads = {};
  await h.run(60000);
  assert.equal(h.ps.length, 0);
});

test("idle conversations with live foreground pids need no process table", async () => {
  const { h, v } = await sidebar({ terms: [{ ...T1, status: "idle" }] });
  v.threads = { t1: v.threads.t1 };
  h.live.clear();
  await h.run(60000);
  assert.equal(h.ps.length, 0);
  assert.deepEqual([...v.alive], [101]);
});

test("idle conversations not confirmed by a terminal still check the process table", async () => {
  const { h, v } = await sidebar({ terms: [{ ...T1, status: "idle" }] });
  await h.run(20000);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000, 20000]);
  assert.deepEqual([...v.alive].toSorted(), [101, 202]);
});

test("a replaced foreground pid stops confirming the previous conversation", async () => {
  const { h, v } = await sidebar({ terms: [{ ...T1, status: "idle" }] });
  v.threads = { t1: v.threads.t1 };
  await h.run(20000, (t) => {
    if (t === 1000) {
      h.terms = [{ ...T1, status: "idle", foreground: { pid: 303 } }];
      h.live.delete(101);
    }
  });
  assert.deepEqual(h.ps.map((x) => x.at), [10000, 20000]);
  assert.deepEqual([...v.alive], []);
});

test("a new conversation is included in the next shared table", async () => {
  const { h, v } = await sidebar({ view: "threads" });
  h.live.add(303);
  await h.run(15000, (t) => { if (t === 2500) v.threads = { ...v.threads, t3: { pid: 303, file: "/c.jsonl" } }; });
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000]);
  assert.ok(v.alive.has(303));
});

test("a conversation that exits is removed by the next shared table, including an empty table", async () => {
  const { h, v } = await sidebar();
  await h.run(20000, (t) => { if (t === 7000) h.live.delete(202); });
  assert.deepEqual([...v.alive], [101]);
  await h.run(30000, (t) => {
    if (t === 25000) {
      h.live.delete(101);
      h.terms = [{ ...T1, state: "exited" }];
    }
  });
  assert.deepEqual([...v.alive], []);
});

test("a slow process table never overlaps another reader", async () => {
  const { h, v } = await sidebar({ latency: 7000 });
  await h.run(60000, (t) => {
    if (t === 1000) v.threads = { ...v.threads, t3: { pid: 303, file: "/c.jsonl" } };
    if (t === 21000) v.view = "threads";
  });
  assert.equal(h.most, 1);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000, 20000, 30000, 40000, 50000, 60000]);
});

test("the shared table is parsed once for all terminals and preserves child task starts", async () => {
  const real = { ...await load("kanso-spaces/procs.js", ["parseProcesses"]), ...await load("kanso-spaces/agents.js", ["tasksOf"]) };
  const parsed = [], given = [];
  const terms = [101, 202, 303, 404].map((pid, i) => ({ address: `t${i + 1}`, state: "live", status: "working", pid: 50 + i, foreground: { pid } }));
  const rows = [303, 404].flatMap((pid) => [`${pid} 1 00:10 claude`, `${pid}1 ${pid} 00:05 npm test`]);
  const { h, v } = await sidebar({
    terms, rows: [...rows, "1011 101 00:05 npm run dev", "1012 101 00:05 caffeinate -i"],
    host: {
      parseProcesses: (text) => { parsed.push(h.clock); return real.parseProcesses(text); },
      tasksOf: (table, ...rest) => { given.push(typeof table); return real.tasksOf(table, ...rest); },
    },
  });
  await h.run(15000);
  assert.deepEqual(parsed, [0, 10000]);
  assert.deepEqual([...new Set(given)], ["object"]);
  assert.equal(given.length, parsed.length * terms.length);
  assert.deepEqual(clone(Object.fromEntries(Object.entries(v.tasks).map(([a, l]) => [a, l.map((x) => x.command)]))),
    { t1: ["npm run dev"], t3: ["npm test"], t4: ["npm test"] });
  assert.equal(v.tasks.t1[0].start, -5000);
});

test("a failed process table retains the previous state and retries at its cadence", async () => {
  const { h, v } = await sidebar({ rows: ["1011 101 00:05 npm run dev"], plan: (n) => n === 1 ? "reject" : null });
  await h.run(10000, (t) => { if (t === 7000) h.live.delete(202); });
  assert.deepEqual([...v.alive], [101, 202]);
  assert.deepEqual(Object.keys(v.tasks), ["t1"]);
  await h.run(20000);
  assert.deepEqual([...v.alive], [101]);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000, 20000]);
});

test("a hung table is abandoned and a late answer cannot replace a newer table", async () => {
  const { h, v } = await sidebar({ plan: (n) => n === 0 ? "hang" : null });
  await h.run(10000);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 10000]);
  h.live.delete(202);
  h.hung[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...v.alive], [101, 202]);
});

test("a late background table is dropped even before its replacement starts", async () => {
  const { h, v } = await sidebar({ active: false, plan: (n) => n === 1 ? "hang" : null });
  await h.run(39500);
  assert.deepEqual(h.ps.map((x) => x.at), [0, 30000]);
  h.live.delete(202);
  h.hung[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...v.alive], [101, 202]);
  await h.run(60000);
  assert.deepEqual([...v.alive], [101]);
});
