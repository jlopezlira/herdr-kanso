// A sleep on another computer: addresses, its database, the worker, a missed answer, and how often it is read.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { load, temporary, clone, exec as realExec } from "./helpers.mjs";

const C1 = "00000000-0000-4000-8000-000000000001";
const PLATFORMS = ["macos", "linux", "windows"];

function hostExec(calls, { down = () => false } = {}) {
  return async (c, a = [], o = {}) => {
    calls.push({ c, a: [...a], on: o.on ?? null, timeout: o.timeout ?? null });
    if (down() && c === "sqlite3") throw new Error("light did not answer");
    if (c === "pwsh" || c === "powershell") return { code: 1, stdout: "", stderr: "" };
    if (c === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
    if (c === "kill") return { code: 0, stdout: "", stderr: "" };
    if (c === "sh" && String(a[1] ?? "").includes("HOME")) return { code: 0, stdout: "/Users/remote\n", stderr: "" };
    return realExec(c, a, o);
  };
}

const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Ada", terminal: "t1", tab: "tb1", front: 11, pid: 11 }] }] };

async function openDb(t, machine) {
  const dir = await temporary(t);
  const calls = [];
  const exec = hostExec(calls);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir, window: () => ({ platform: "macos" }) });
  const kdb = new Kdb(join(dir, "kanso"), machine);
  await kdb.open();
  return { kdb, calls };
}

test("an address turns both ways the same on every system", async () => {
  for (const platform of PLATFORMS) {
    const { seenAddress, localAddress, seenRow, localRow, kansoDir } = await load("kanso-spaces/kdb.js", ["seenAddress", "localAddress", "seenRow", "localRow", "kansoDir"], { window: () => ({ platform }) });
    assert.equal(seenAddress("t90", null), "t90");
    assert.equal(seenAddress("t90", "light"), "light/t90");
    assert.equal(seenAddress(null, "light"), null);
    assert.equal(seenAddress("", "light"), "");
    assert.equal(localAddress("t90", null), "t90");
    assert.equal(localAddress("light/t90", null), null);
    assert.equal(localAddress("light/t90", "light"), "t90");
    assert.equal(localAddress("dark/t90", "light"), null);
    assert.equal(localAddress("light/t90/extra", "light"), "t90/extra");
    assert.equal(localAddress(null, "light"), null);
    const row = { spaceId: "sp1", tab: "tb1", space: "Kanso", from: "light:/w", agents: [{ terminal: "t90", tab: "tb1", spaceId: "sp1", cwd: "/w" }], into: { tab: "Notes", tabId: "tb1" }, cols: [{ panes: [{ terminal: "t90", tab: "tb1", cwd: "/w", argv: ["claude"] }] }] };
    const seen = seenRow(row, "light");
    assert.equal(seen.spaceId, "light/sp1");
    assert.equal(seen.tab, "light/tb1");
    assert.equal(seen.agents[0].terminal, "light/t90");
    assert.equal(seen.into.tab, "Notes");
    assert.equal(seen.into.tabId, "light/tb1");
    assert.equal(seen.cols[0].panes[0].cwd, "/w");
    assert.equal(seen.from, "light:/w");
    assert.deepEqual(clone(localRow(seen, "light")), row);
    assert.equal(kansoDir("/Users/jj", "macos"), "/Users/jj/.config/herdr-app/data/kanso");
    assert.equal(kansoDir("/home/jj", "linux"), "/home/jj/.config/herdr-app/data/kanso");
    assert.equal(kansoDir("C:\\Users\\jj", "windows"), "C:\\Users\\jj\\AppData\\Roaming\\herdr-app\\data\\kanso");
    assert.equal(kansoDir("C:\\Users\\jj", platform).includes("AppData"), platform === "windows");
  }
});

test("a remote database sends every statement to that computer, and two reads leave together", async (t) => {
  const { kdb, calls } = await openDb(t, "light");
  for (const c of calls) assert.equal(c.on, "light", c.c);
  for (const c of calls) if (!["pwsh", "powershell", "uname"].includes(c.c)) assert.equal(c.timeout, 15000, c.c);
  const at = calls.length;
  const [one, two] = await Promise.all([kdb.read("SELECT 1 AS n;"), kdb.read("SELECT 2 AS n;")]);
  const batched = calls.slice(at).filter((c) => c.c === "sqlite3");
  assert.equal(batched.length, 1);
  const argv = batched[0].a.join("\n");
  assert.match(argv, /SELECT 1 AS n/);
  assert.match(argv, /SELECT 2 AS n/);
  assert.equal(one[0].n, 1);
  assert.equal(two[0].n, 2);
});

test("a local database and a local worker never call another computer", async (t) => {
  const dir = await temporary(t);
  const calls = [];
  let asked = 0;
  const host = {
    exec: hostExec(calls), window: () => ({ platform: "macos" }), home: () => "/Users/local", appHome: () => dir,
    terminals: () => [{ address: "t1" }], panes: () => [{ pane: "p1", terminal: "t1", tab: "tb1" }], run() {},
    hc: async () => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 11, argv: ["claude"], cwd: "/w" }, status: { state: "idle" }, title: "on it" }) }),
    readTextFile: async () => JSON.stringify({ pid: 11, sessionId: C1 }),
    serviceOn: () => { asked += 1; throw new Error("serviceOn"); },
  };
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], host);
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], host);
  const kdb = new Kdb(join(dir, "kanso"));
  await kdb.open();
  await kdb.read("SELECT 1 AS n;");
  await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true });
  const cx = { sleep: async () => {}, spawn: (fn) => fn(cx) };
  await new SleepWork(kdb, () => {}, "win-a").tick(cx, 1_000_000);
  assert.equal(asked, 0);
  assert.ok(calls.some((c) => c.c === "sqlite3"));
  for (const c of calls) {
    assert.equal(c.on, null, c.c);
    assert.equal(c.timeout, null, c.c);
  }
});

test("the database folder follows the computer's system, not the shape of its home", async () => {
  const exec = async (c, a = [], o = {}) => {
    assert.equal(o.on ?? null, "light", c);
    if (c !== "uname" && c !== "pwsh" && c !== "powershell") assert.equal(o.timeout, 15000, c);
    if (c === "pwsh" || c === "powershell") return { code: 1, stdout: "", stderr: "" };
    if (c === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
    if (c === "sh") return { code: 0, stdout: "C:\\Users\\jj\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const { homePlace } = await load("kanso-spaces/sleepwork.js", ["homePlace"], { exec, window: () => ({ platform: "linux" }), home: () => "/Users/local" });
  const { kansoDir } = await load("kanso-spaces/kdb.js", ["kansoDir"], { window: () => ({ platform: "linux" }) });
  const place = await homePlace("light");
  assert.equal(place.platform, "macos");
  assert.equal(place.home, "C:\\Users\\jj");
  const dir = kansoDir(place.home, place.platform);
  assert.equal(dir.includes(".config"), true);
  assert.equal(dir.includes("AppData"), false);
});

test("a local database is unchanged: no machine and no timeout", async (t) => {
  const { kdb, calls } = await openDb(t, null);
  await kdb.read("SELECT 1 AS n;");
  assert.ok(calls.some((c) => c.c === "sqlite3"));
  for (const c of calls) {
    assert.equal(c.on, null, c.c);
    assert.equal(c.timeout, null, c.c);
  }
});

test("an order the computer does not answer leaves nothing written", async (t) => {
  const dir = await temporary(t);
  const calls = [];
  let down = false;
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: hostExec(calls, { down: () => down }), appHome: () => dir, window: () => ({ platform: "macos" }) });
  const kdb = new Kdb(join(dir, "kanso"), "light");
  await kdb.open();
  down = true;
  await assert.rejects(() => kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0 }], requested: true }), /did not answer/);
  down = false;
  const rows = await kdb.read("SELECT COUNT(*) AS n FROM sleeps;");
  assert.equal(Number(rows[0].n), 0);
});

test("a remote store does not read this computer's old file", async () => {
  const { Store } = await load("kanso-spaces/store.js", ["Store"], {});
  const seen = [];
  const kdb = { machine: "light", async open() { seen.push("open"); }, async migrated() { seen.push("migrated"); return false; } };
  await new Store(kdb, "/legacy").open();
  assert.deepEqual(seen, ["open"]);
});

test("a remote database is read once in front, again after a minute, and on an order, never from behind", async () => {
  let now = 100000, active = false, kick = 0, reads = 0, layout = "ready", windows = 0;
  let spaces = [];
  const row = { id: "z1", from: ":/w", name: "Notes", saved: 1, space: "Kanso", spaceId: "sp", state: "asleep", cols: [{ panes: [{ terminal: "t1", name: "Ada", resume: "c1", argv: ["claude"] }] }], agents: [] };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: { now: () => now },
    spaces: () => spaces,
    window: () => { windows += 1; return { platform: "macos", active }; },
    shared: (key) => (key === "kanso.sleep.kick" ? kick : 0),
    setShared() {},
    machines: () => [{ name: "light", layout }],
    home: () => "/Users/jj",
  });
  const view = Object.assign(new Spaces(), {
    asleepReads: 0, asleepApplied: 0, leftNavStore: () => ({ asleep: async () => [] }), loadProjects: async () => {}, settleHidden() {},
    storeOn: async () => ({ asleep: async () => { reads += 1; return [row]; } }),
  });
  await view.loadAsleep(false);
  assert.equal(reads, 0);
  assert.equal(windows, 0, "no remote space asks whether this window is in front");
  spaces = [{ id: "light/sp", machine: "light", name: "Kanso", folder: "/w" }];
  await view.loadAsleep(false);
  assert.equal(reads, 0, "behind another window");
  active = true;
  await view.loadAsleep(false);
  assert.equal(reads, 1);
  now = 159000;
  await view.loadAsleep(false);
  assert.equal(reads, 1);
  now = 160000;
  await view.loadAsleep(false);
  assert.equal(reads, 2);
  active = false;
  kick = 7;
  await view.loadAsleep(false);
  assert.equal(reads, 3, "this window's own order");
  const kept = reads;
  layout = "unavailable";
  now += 60000;
  await view.loadAsleep(false);
  assert.equal(reads, kept, "an unreachable computer is not asked");
  assert.equal(view.remoteShown[0].quiet, "Unreachable");
  assert.match(view.remoteShown[0].asOf, /^as of /);
  assert.equal(view.remoteShown[0].agents[0].terminal, "light/t1");
});

test("rest is due in front after a minute, at once for an order, and never while behind", async () => {
  const { restDue, asOfText, REST_MS } = await load("kanso-spaces/kdb.js", ["restDue", "asOfText", "REST_MS"], { window: () => ({ platform: "linux" }) });
  assert.equal(REST_MS, 60000);
  assert.equal(restDue({ showing: true, active: false, readAt: null }), false);
  assert.equal(restDue({ showing: false, active: true, readAt: null }), false);
  assert.equal(restDue({ showing: true, active: true, readAt: null }), true);
  assert.equal(restDue({ showing: true, active: true, readAt: 0, now: 59999 }), false);
  assert.equal(restDue({ showing: true, active: true, readAt: 0, now: 60000 }), true);
  assert.equal(restDue({ showing: true, active: false, ordered: true, readAt: 0, now: 0 }), true);
  assert.equal(asOfText(null, 10), null);
  assert.equal(asOfText(0, 5000), "as of 5s");
  assert.equal(asOfText(0, 120000), "as of 2 min");
  assert.equal(asOfText(0, 7200000), "as of 2 h");
});

async function worker(t, machine, address) {
  const dir = await temporary(t);
  const calls = [], reads = [], hcLog = [];
  const host = {
    exec: hostExec(calls), window: () => ({ platform: "macos" }), home: () => "/Users/local", appHome: () => dir,
    terminals: () => [{ address }], panes: () => [{ pane: "p1", terminal: address, tab: machine ? `${machine}/tb1` : "tb1" }], run() {},
    hc: async (args) => {
      hcLog.push([...args]);
      if (args[0] !== "get" || args[1] !== address) return { code: 1, stdout: "", stderr: "missing" };
      return { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 11, argv: ["claude"], cwd: "/w" }, status: { state: "idle" }, title: "on it" }) };
    },
    readTextFile: async (path, options) => {
      reads.push({ path, on: options?.on ?? null });
      if (!/11\.json$/.test(path)) throw new Error("ENOENT");
      return JSON.stringify({ pid: 11, sessionId: C1 });
    },
  };
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], host);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], host);
  const kdb = new Kdb(join(dir, "kanso"), machine);
  await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true });
  const cx = { sleep: async () => {}, spawn: (fn) => fn(cx) };
  return { SleepWork, kdb, calls, reads, hcLog, cx };
}

function side(calls, reads, hcLog, machine) {
  for (const c of calls) assert.equal(c.on, machine, c.c);
  for (const r of reads) assert.equal(r.on, machine, r.path);
  for (const args of hcLog) {
    if (machine) assert.equal(args[1].startsWith(`${machine}/`), true, args.join(" "));
    else assert.equal(String(args[1]).includes("/"), false, args.join(" "));
  }
}

test("a worker on another computer calls only there, and a local row never does", async (t) => {
  const remote = await worker(t, "light", "light/t1");
  const one = new remote.SleepWork(remote.kdb, () => {}, "win-a");
  const two = new remote.SleepWork(remote.kdb, () => {}, "win-b");
  assert.equal(await one.tick(remote.cx, 1_000_000), true);
  assert.equal((await remote.kdb.read("SELECT step FROM agents;"))[0].step, "saving");
  assert.equal(await two.tick(remote.cx, 1_001_000), false, "the other window leaves the lease");
  assert.equal((await remote.kdb.read("SELECT pending, step FROM sleeps, agents;"))[0].pending, "win-a");
  assert.equal((await remote.kdb.read("SELECT step FROM agents;"))[0].step, "saving");
  const at = { calls: remote.calls.length, reads: remote.reads.length, hc: remote.hcLog.length };
  assert.equal(await one.tick(remote.cx, 1_002_000), true);
  side(remote.calls.slice(at.calls), remote.reads.slice(at.reads), remote.hcLog.slice(at.hc), "light");
  assert.ok(remote.reads.slice(at.reads).some((r) => r.path.endsWith("/.claude/sessions/11.json")));
  side(remote.calls, remote.reads, remote.hcLog, "light");
  const local = await worker(t, null, "t1");
  const mine = new local.SleepWork(local.kdb, () => {}, "win-a");
  await mine.tick(local.cx, 1_000_000);
  await mine.tick(local.cx, 1_002_000);
  side(local.calls, local.reads, local.hcLog, null);
  for (const c of local.calls) assert.equal(c.timeout, null, c.c);
});

test("a quiet asleep row keeps its reason and offers no retry", async () => {
  const { sleepingNow, asleepGroups } = await load("kanso-spaces/roster.js", ["sleepingNow", "asleepGroups"], {});
  const spaces = [{ id: "light/sp", name: "Kanso", folder: "/w", machine: "light", tabs: [] }];
  const slept = [{ id: "z1", from: ":/w", name: "Notes", spaceId: "sp", saved: 1, quiet: "Unreachable", asOf: "as of 2 min", state: "sleeping", pending: 1, agents: [{ name: "Ada", terminal: "light/t1", resume: "c1" }] }];
  const { rows } = sleepingNow(spaces, [{ address: "light/t1" }], slept, () => "");
  assert.equal(rows[0].asleep.quiet, "Unreachable");
  assert.equal(rows[0].asleep.asOf, "as of 2 min");
  assert.equal(rows[0].space, "light/sp");
  const group = asleepGroups(rows).groups[0];
  assert.deepEqual(clone(group.stuck), []);
  assert.deepEqual(clone(group.going), []);
  assert.equal(group.why, "Unreachable");
});
