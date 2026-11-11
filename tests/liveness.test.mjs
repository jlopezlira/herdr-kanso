// Whether each conversation's process still runs: how many `ps` the sidebar takes to know, on a fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const T1 = { address: "t1", state: "live", status: "working", pid: 50, foreground: { pid: 101 } };

// A fake Herdr whose `ps` answers `latency` ms after it is asked, and counts every one.
// `plan(n)` makes the n-th `ps` "reject" or "hang" (kept in h.hung, answered only when a test says so).
async function sidebar({ latency = 0, active = true, collapsed = false, view = "spaces", terms = [T1], rows = [], plan = () => null, host = {} } = {}) {
  const h = { clock: 0, active, collapsed, live: new Set([101, 202]), ps: [], inFlight: 0, most: 0, waiting: [], hung: [] };
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
    terminals: () => terms, spaces: () => [], panes: () => [], agents: () => [], machines: () => [],
    ...host,
  });
  const v = Object.assign(new Spaces(), {
    view, tasks: {}, shown: new Set(), born: {},
    threads: { t1: { pid: 101, file: "/a.jsonl" }, t2: { pid: 202, file: "/b.jsonl" } },
  });
  // Only the liveness part of checkNew runs here; the rest has its own tests.
  for (const name of ["takeMoves", "trackAgents", "trackReturn", "refreshThreads", "keepSeen", "prune"]) v[name] = () => {};
  v.due = () => new Set();
  const cx = { notify() {}, spawn(fn) { fn(cx); } };
  const settle = async () => {
    for (const w of h.waiting.filter((x) => x.due <= h.clock)) { h.waiting.splice(h.waiting.indexOf(w), 1); w.done(); }
    await new Promise((r) => setImmediate(r));
  };
  // The two timers of init(): checkNew every 500 ms, checkTasks every 5 s.
  h.run = async (until, each = () => {}) => {
    for (; h.clock <= until; h.clock += 500) {
      each(h.clock);
      v.checkNew(cx);
      if (h.clock % 5000 === 0) v.checkTasks(cx);
      await settle();
    }
  };
  return { h, v };
}

const own = (h) => h.ps.filter((x) => !x.whole);

test("in front, checkTasks' one `ps` every 5 s answers for the conversations too: none of their own after the first (it was two a second)", async () => {
  const { h, v } = await sidebar();
  await h.run(60000);
  assert.deepEqual(own(h).map((x) => x.at), [0], "only the first, before checkTasks ever answered");
  assert.equal(h.ps.length, 13, "and checkTasks' twelve: a `ps` every 5 s in all");
  assert.deepEqual([...v.alive].toSorted(), [101, 202]);
});

test("in Threads (no checkTasks) in front, a `ps` of their own every 10 s; behind other windows, every minute", async () => {
  const front = await sidebar({ view: "threads" });
  await front.h.run(60000);
  assert.deepEqual(own(front.h).map((x) => x.at), [0, 10000, 20000, 30000, 40000, 50000, 60000]);
  const behind = await sidebar({ view: "threads", active: false });
  await behind.h.run(120000);
  assert.deepEqual(own(behind.h).map((x) => x.at), [5000, 65000], "checkNew itself looks every 5 s there");
});

test("with the sidebar collapsed, a minute between looks when nothing else asks", async () => {
  const { h } = await sidebar({ collapsed: true, terms: [] });
  await h.run(120000);
  assert.deepEqual(own(h).map((x) => x.at), [0, 60000, 120000], "it was two a second");
});

test("a new set of processes is asked at once, whatever the cadence", async () => {
  const { h, v } = await sidebar({ view: "threads" });
  h.live.add(303);
  await h.run(15000, (t) => { if (t === 2500) v.threads = { ...v.threads, t3: { pid: 303, file: "/c.jsonl" } }; });
  assert.deepEqual(own(h).map((x) => x.at), [0, 2500, 12500], "at once, then 10 s on from there");
  assert.ok(v.alive.has(303));
});

test("an agent that exits is seen gone within the cadence, by either `ps`", async () => {
  const spacesView = await sidebar();
  await spacesView.h.run(20000, (t) => { if (t === 7000) spacesView.h.live.delete(202); });
  assert.deepEqual([...spacesView.v.alive], [101], "checkTasks' table at 10 s no longer lists it");
  const threads = await sidebar({ view: "threads" });
  await threads.h.run(9500, (t) => { if (t === 3000) threads.h.live.delete(202); });
  assert.ok(threads.v.alive.has(202), "not yet: the next look is at 10 s");
  await threads.h.run(10000);
  assert.deepEqual([...threads.v.alive], [101]);
  await threads.h.run(30000, (t) => { if (t === 15000) threads.h.live.delete(101); });
  assert.deepEqual([...threads.v.alive], [], "`ps -p` finding none is every one gone, not a failed look");
});

test("a slow `ps` is never asked again before it answers, from either check", async () => {
  const { h, v } = await sidebar({ latency: 7000 });
  await h.run(60000, (t) => {
    if (t === 1000) v.threads = { ...v.threads, t3: { pid: 303, file: "/c.jsonl" } };
    if (t === 21000) { v.view = "threads"; v.threads = { t1: v.threads.t1 }; }
  });
  assert.equal(h.most, 1, "one in flight at a time");
  // 303 came while the first was out: asked once it answered. The table at 15 s was asked for three, so one goes again for the one left.
  assert.deepEqual(h.ps.map((x) => [x.at, x.whole]), [[0, false], [7500, false], [15000, true], [22500, false], [32500, false], [42500, false], [52500, false]]);
});

test("one table for every terminal: each `ps -axo` is parsed once, and tasksOf walks its index", async () => {
  const real = { ...await load("kanso-spaces/platform-processes.js", ["unixProcesses"]), ...await load("kanso-spaces/agents.js", ["tasksOf"]) };
  const given = [], tables = [];
  const terms = [101, 202, 303, 404].map((pid, i) => ({ address: `t${i + 1}`, state: "live", status: "working", pid: 50 + i, foreground: { pid } }));
  const rows = [303, 404].flatMap((pid) => [`${pid} 1 00:10 claude`, `${pid}1 ${pid} 00:05 npm test`]);
  const { h, v } = await sidebar({
    terms, rows: [...rows, "1011 101 00:05 npm run dev", "1012 101 00:05 caffeinate -i"],
    host: {
      tasksOf: (table, ...rest) => { given.push(typeof table); tables.push(table); return real.tasksOf(table, ...rest); },
    },
  });
  await h.run(15000);
  const whole = h.ps.filter((x) => x.whole).map((x) => x.at);
  assert.equal(new Set(tables).size, whole.length, "one table shared by all terminals per read");
  assert.deepEqual([...new Set(given)], ["object"], "never the text again");
  assert.equal(given.length, whole.length * terms.length, "and each terminal asked of it");
  assert.deepEqual(clone(Object.fromEntries(Object.entries(v.tasks).map(([a, l]) => [a, l.map((x) => x.command)]))),
    { t1: ["npm run dev"], t3: ["npm test"], t4: ["npm test"] });
});

test("a `ps` that fails lets both checks go on at their next turn", async () => {
  const threads = await sidebar({ view: "threads", plan: (n) => (n === 0 ? "reject" : null) });
  await threads.h.run(10000);
  assert.deepEqual(own(threads.h).map((x) => x.at), [0, 10000], "liveness: the failed look waits its cadence, then asks again");
  assert.deepEqual([...threads.v.alive].toSorted(), [101, 202]);
  // In front: the first `ps` is liveness' at 0, then checkTasks' table every 5 s; the one at 5 s fails,
  // so liveness, unanswered since 0, asks on its own at 10 s and the table comes again at 15 s.
  const tasks = await sidebar({ rows: ["1011 101 00:05 npm run dev"], plan: (n) => (n === 1 ? "reject" : null) });
  await tasks.h.run(15000);
  assert.deepEqual(tasks.h.ps.map((x) => [x.at, x.whole]), [[0, false], [5000, true], [10000, false], [15000, true]]);
  assert.deepEqual(Object.keys(tasks.v.tasks), ["t1"], "checkTasks finds what runs");
});

test("a `ps` that never answers is given up on, and a late answer changes nothing", async () => {
  const threads = await sidebar({ view: "threads", plan: (n) => (n === 0 ? "hang" : null) });
  await threads.h.run(10000);
  assert.deepEqual(own(threads.h).map((x) => x.at), [0, 10000], "the next look is still at 10 s");
  assert.deepEqual([...threads.v.alive].toSorted(), [101, 202]);
  threads.h.live.delete(202);
  threads.h.hung[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...threads.v.alive].toSorted(), [101, 202], "the abandoned look's answer is dropped");
  // checkTasks' table at 5 s hangs: liveness asks on its own at 15 s, the table again at 20 s.
  const tasks = await sidebar({ rows: ["1011 101 00:05 npm run dev"], plan: (n) => (n === 1 ? "hang" : null) });
  await tasks.h.run(20000);
  assert.deepEqual(tasks.h.ps.map((x) => [x.at, x.whole]), [[0, false], [5000, true], [15000, false], [20000, true]]);
  assert.deepEqual(Object.keys(tasks.v.tasks), ["t1"]);
});

test("an answer past the give-up time is dropped even before another `ps` starts", async () => {
  // Behind other windows in Threads, the next look is a minute away: the one at 65 s hangs past 75 s, its answer comes at 80 s.
  const { h, v } = await sidebar({ view: "threads", active: false, plan: (n) => (n === 1 ? "hang" : null) });
  await h.run(79500);
  assert.deepEqual(own(h).map((x) => x.at), [5000, 65000], "nothing has replaced it");
  h.live.delete(202);
  h.hung[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...v.alive].toSorted(), [101, 202], "its late answer changes nothing");
  await h.run(125000);
  assert.deepEqual(own(h).map((x) => x.at), [5000, 65000, 125000]);
  assert.deepEqual([...v.alive], [101], "the next look, on time, does");
});
