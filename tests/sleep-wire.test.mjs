// Round trips a sleep on another computer makes: exec and file reads aimed at that
// computer, and hc addressed to one of its terminals. Prints one row per tick.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { load, temporary, exec as realExec } from "./helpers.mjs";

const C1 = "00000000-0000-4000-8000-000000000001";
const RULE = "─".repeat(40);
const EMPTY = `Claude\n${RULE}\n❯ \n${RULE}\n`;

function lookText(pids, alive) {
  const lines = ["home=/Users/remote"];
  for (const pid of pids.map(Number)) {
    const record = pid === 11 || pid === 21 ? JSON.stringify({ pid, sessionId: C1 }) : "";
    lines.push(`pid=${pid}`, `alive=${alive.has(pid) ? 1 : 0}`, "record", record, "kanso-look-end");
  }
  return lines.join("\n");
}

function wireOf(calls, reads, hcLog, machine) {
  const mine = calls.filter((c) => c.on === machine);
  const exec = mine.length;
  const sqlite = mine.filter((c) => c.c === "sqlite3").length;
  const files = reads.filter((r) => r.on === machine).length;
  const hc = hcLog.filter((args) => String(args[1] ?? "").startsWith(`${machine}/`)).length;
  return { exec, sqlite, files, hc, trips: exec + files + hc };
}

export async function sleepWire(t, { machine = "light", agent = "idle" } = {}) {
  const dir = await temporary(t);
  const calls = [], reads = [], hcLog = [];
  const alive = new Set([11]);
  const terms = { t1: { shell: 101, fg: { pid: 11, argv: ["claude"], cwd: "/w" }, screen: EMPTY, state: agent } };
  const address = `${machine}/t1`;
  let now = 1_700_000_000_000;
  const Clock = class extends Date {
    static now() { return now; }
    constructor(...args) { super(...(args.length ? args : [now])); }
  };
  const leave = () => {
    alive.delete(11);
    terms.t1.fg = { pid: terms.t1.shell, argv: ["/bin/zsh"] };
    terms.t1.screen = "$ ";
  };
  const host = {
    Date: Clock, window: () => ({ platform: "macos" }), home: () => "/Users/local", appHome: () => dir,
    terminals: () => [{ address }], panes: () => [{ pane: "p1", terminal: address, tab: `${machine}/tb1` }], run() {},
    exec: async (c, a = [], o = {}) => {
      calls.push({ c, a: [...a], on: o.on ?? null });
      if (c === "pwsh" || c === "powershell") return { code: 1, stdout: "", stderr: "" };
      if (c === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
      if (c === "kill" && a[0] === "-0") return { code: alive.has(Number(a[1])) ? 0 : 1, stdout: "", stderr: "" };
      if (c === "sh" && String(a[1] ?? "").includes("kanso-look-end")) return { code: 0, stdout: lookText(a.slice(3), alive), stderr: "" };
      if (c === "sh" && String(a[1] ?? "").includes('"$HOME"')) return { code: 0, stdout: "/Users/remote", stderr: "" };
      if (c === "sh") return { code: 0, stdout: "", stderr: "" };
      if (c === "ps") return { code: 0, stdout: "00:01 claude\n", stderr: "" };
      return realExec(c, a, o);
    },
    hc: async (args) => {
      hcLog.push([...args]);
      const [verb, id, arg] = args;
      if (id !== address) return { code: 1, stdout: "", stderr: "missing" };
      const x = terms.t1;
      if (verb === "get") return { code: 0, stdout: JSON.stringify({ pid: x.shell, foreground: x.fg, status: { state: x.state }, title: "on it" }) };
      if (verb === "read") return { code: 0, stdout: x.screen };
      if (verb === "keys" && arg === "ctrl+c") { x.screen = EMPTY; return { code: 0, stdout: "" }; }
      if (verb === "send" && arg === "/exit") { leave(); return { code: 0, stdout: "" }; }
      if (verb === "send" && String(arg).includes(C1)) {
        x.fg = { pid: 21, argv: ["claude", "--resume", C1], cwd: "/w" };
        alive.add(21);
        return { code: 0, stdout: "" };
      }
      return { code: 0, stdout: "" };
    },
    readTextFile: async (path, options) => {
      reads.push({ path, on: options?.on ?? null });
      const pid = Number(/(\d+)\.json$/.exec(path)?.[1]);
      if (!alive.has(pid) && pid !== 11 && pid !== 21) throw new Error("ENOENT");
      if (pid === 11 || pid === 21) return JSON.stringify({ pid, sessionId: C1 });
      throw new Error("ENOENT");
    },
  };
  const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Ada", terminal: "t1", tab: "tb1", front: 11, pid: 11 }] }] };
  const { SleepWork, TICK_MS, homePlace } = await load("kanso-spaces/sleepwork.js", ["SleepWork", "TICK_MS", "homePlace"], host);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], host);
  const kdb = new Kdb(join(dir, "kanso"), machine);
  await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true, saved: now, now });
  await homePlace(machine);
  const opened = { calls: calls.length, reads: reads.length, hc: hcLog.length };
  const tasks = [];
  const cx = { sleep: async () => {}, spawn: (fn) => { const task = fn(cx); tasks.push(task); return task; } };
  const drain = async () => { while (tasks.length) await tasks.shift(); };
  const ticks = [];
  const take = async (tick) => {
    const at = { calls: calls.length, reads: reads.length, hc: hcLog.length };
    const more = await tick();
    await drain();
    ticks.push(wireOf(calls.slice(at.calls), reads.slice(at.reads), hcLog.slice(at.hc), machine));
    return more;
  };
  const w = new SleepWork(kdb, () => {}, "win-a", () => false, machine);
  for (let i = 0; i < 40; i++) {
    const more = await take(() => w.tick(cx, now));
    if (!more) break;
    now += TICK_MS;
  }
  const sleep = wireOf(calls.slice(opened.calls), reads.slice(opened.reads), hcLog.slice(opened.hc), machine);
  const row = (await kdb.sleeps())[0];
  const rowState = row?.state ?? null;
  const wakeFrom = { calls: calls.length, reads: reads.length, hc: hcLog.length };
  const wakeTicks = [];
  // The worker brings back an agent that has left: the row is put back into its hands.
  await kdb.run(`UPDATE sleeps SET state='undoing',pending=NULL,pending_at=${now} WHERE id='${row.id}';
    UPDATE agents SET step='left',sent_at=${now - 60_000} WHERE sleep_id='${row.id}';`);
  w.kicked = now;
  const from = ticks.length;
  for (let i = 0; i < 30; i++) {
    const at = { calls: calls.length, reads: reads.length, hc: hcLog.length };
    const more = await w.tick(cx, now);
    await drain();
    wakeTicks.push(wireOf(calls.slice(at.calls), reads.slice(at.reads), hcLog.slice(at.hc), machine));
    if (!more) break;
    now += TICK_MS;
  }
  ticks.length = from;
  const wake = wireOf(calls.slice(wakeFrom.calls), reads.slice(wakeFrom.reads), hcLog.slice(wakeFrom.hc), machine);
  return { ticks, sleep, wakeTicks, wake, rowState, commands: calls.slice(opened.calls).filter((c) => c.on === machine).map((c) => c.c) };
}

function table(rows) {
  const line = (label, row) => `${label.padEnd(8)} ${String(row.exec).padStart(5)} ${String(row.sqlite ?? 0).padStart(6)} ${String(row.files).padStart(5)} ${String(row.hc).padStart(5)} ${String(row.trips).padStart(5)}`;
  return ["tick      exec sqlite files    hc trips", ...rows.map((row, i) => line(String(i + 1), row))].join("\n");
}

test("a remote sleep and wake of one idle agent, counted across the wire", async (t) => {
  const run = await sleepWire(t);
  console.log(`\nsleep\n${table(run.ticks)}\n${table([{ ...run.sleep }]).replace("1   ", "sleep")}`);
  console.log(`wake\n${table(run.wakeTicks)}\n${table([{ ...run.wake }]).replace("1   ", "wake ")}`);
  console.log(`commands ${run.commands.join(",")}`);
  assert.equal(run.sleep.exec, 8);
  assert.equal(run.sleep.sqlite, 5);
  assert.equal(run.sleep.files, 0);
  assert.equal(run.sleep.hc, 5);
  assert.equal(run.sleep.trips, 13);
  assert.ok(run.ticks.length > 0 && run.ticks.every((row) => row.trips <= 4));
  assert.equal(run.wake.exec, 9);
  assert.equal(run.wake.sqlite, 6);
  assert.equal(run.wake.files, 0);
  assert.equal(run.wake.hc, 5);
  assert.equal(run.wake.trips, 14);
  assert.equal(run.rowState, "asleep");
});

test("a local sleep and wake of one idle agent, counted on this computer", async (t) => {
  const dir = await temporary(t);
  const calls = [], reads = [], hcLog = [];
  const alive = new Set([11]);
  const terms = { t1: { shell: 101, fg: { pid: 11, argv: ["claude"], cwd: "/w" }, screen: EMPTY } };
  const leave = () => { alive.delete(11); terms.t1.fg = { pid: 101, argv: ["/bin/zsh"] }; terms.t1.screen = "$ "; };
  const host = {
    window: () => ({ platform: "macos" }), home: () => "/nonexistent-home", appHome: () => dir,
    terminals: () => [{ address: "t1" }], panes: () => [{ pane: "p1", terminal: "t1", tab: "tb1" }], run() {},
    exec: async (c, a, o) => {
      calls.push({ c, a: [...(a ?? [])], on: o?.on ?? null });
      if (c === "sh" && String(a?.[1] ?? "").includes("kanso-look-end")) return { code: 0, stdout: lookText(a.slice(3), alive).replace("home=/Users/remote", "home=/nonexistent-home"), stderr: "" };
      if (c === "kill" && a?.[0] === "-0") return { code: alive.has(Number(a[1])) ? 0 : 1, stdout: "", stderr: "" };
      return realExec(c, a, o);
    },
    hc: async (args) => {
      hcLog.push([...args]);
      const [verb, , arg] = args;
      const x = terms.t1;
      if (verb === "get") return { code: 0, stdout: JSON.stringify({ pid: x.shell, foreground: x.fg, status: { state: "idle" }, title: "on it" }) };
      if (verb === "read") return { code: 0, stdout: x.screen };
      if (verb === "keys" && arg === "ctrl+c") { x.screen = EMPTY; return { code: 0, stdout: "" }; }
      if (verb === "send" && arg === "/exit") { leave(); return { code: 0, stdout: "" }; }
      if (verb === "send" && String(arg).includes(C1)) { x.fg = { pid: 21, argv: ["claude", "--resume", C1], cwd: "/w" }; alive.add(21); return { code: 0, stdout: "" }; }
      return { code: 0, stdout: "" };
    },
    readTextFile: async (path, options) => {
      reads.push({ path, on: options?.on ?? null });
      const pid = Number(/(\d+)\.json$/.exec(path)?.[1]);
      if (pid !== 11 && pid !== 21) throw new Error("ENOENT");
      return JSON.stringify({ pid, sessionId: C1 });
    },
  };
  const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Ada", terminal: "t1", tab: "tb1", front: 11, pid: 11 }] }] };
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], host);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], host);
  const kdb = new Kdb(join(dir, "kanso"));
  await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true });
  const at = calls.length;
  const tasks = [];
  const cx = { sleep: async () => {}, spawn: (fn) => { const task = fn(cx); tasks.push(task); return task; } };
  const drain = async () => { while (tasks.length) await tasks.shift(); };
  const w = new SleepWork(kdb, () => {}, "win-a");
  for (let i = 0; i < 40; i++) {
    if (!(await w.tick(cx))) break;
    await drain();
  }
  const sleepCalls = calls.slice(at);
  const sleep = { exec: sleepCalls.length, sqlite: sleepCalls.filter((c) => c.c === "sqlite3").length, files: reads.length, hc: hcLog.length };
  console.log(`local sleep exec ${sleep.exec} sqlite ${sleep.sqlite} files ${sleep.files} hc ${sleep.hc}: ${sleepCalls.map((c) => c.c).join(",")}`);
  const row = (await kdb.sleeps())[0];
  assert.equal(row?.state, "asleep");
  const wakeFrom = calls.length;
  const wakeReads = reads.length;
  const wakeHc = hcLog.length;
  await kdb.run(`UPDATE sleeps SET state='undoing',pending=NULL,pending_at=${Date.now()} WHERE id='${row.id}';
    UPDATE agents SET step='left',sent_at=${Date.now() - 60_000} WHERE sleep_id='${row.id}';`);
  w.kicked = Date.now();
  for (let i = 0; i < 30; i++) {
    if (!(await w.tick(cx))) break;
    await drain();
  }
  const wakeCalls = calls.slice(wakeFrom);
  const wake = { exec: wakeCalls.length, sqlite: wakeCalls.filter((c) => c.c === "sqlite3").length, files: reads.length - wakeReads, hc: hcLog.length - wakeHc };
  console.log(`local wake exec ${wake.exec} sqlite ${wake.sqlite} files ${wake.files} hc ${wake.hc}: ${wakeCalls.map((c) => c.c).join(",")}`);
  assert.equal(sleep.exec, 12);
  assert.equal(sleep.sqlite, 9);
  assert.equal(sleep.files, 0);
  assert.equal(sleep.hc, 5);
  assert.equal(wake.exec, 8);
  assert.equal(wake.sqlite, 6);
  assert.equal(wake.files, 1);
  assert.equal(wake.hc, 5);
});

test("a step is looked at again only when its timer is due", async () => {
  const { lookDue, SAVE_MS, CLEAR_MS } = await load("kanso-spaces/sleepwork.js", ["lookDue", "SAVE_MS", "CLEAR_MS"], { home: () => "/Users/local" });
  const saving = { step: "saving", step_at: 1000 };
  assert.equal(lookDue(saving, 1001, null), true);
  assert.equal(lookDue(saving, 1000 + SAVE_MS, { step: "saving" }), false);
  assert.equal(lookDue(saving, 1000 + SAVE_MS + 1, { step: "saving" }), true);
  const clearing = { step: "clearing", step_at: 1000 };
  assert.equal(lookDue(clearing, 1000 + CLEAR_MS, { step: "clearing" }), false);
  assert.equal(lookDue(clearing, 1000 + CLEAR_MS + 1, { step: "clearing" }), true);
  assert.equal(lookDue({ step: "exiting", step_at: 0 }, 1, { step: "exiting" }), true);
  assert.equal(lookDue({ step: "requested" }, 1, null), false);
  assert.equal(lookDue({ step: "left" }, 1, null), false);
  assert.equal(lookDue(clearing, 1, { step: "saving" }), true);
  assert.equal(lookDue(saving, 1000, { step: "saving" }, true), true, "this computer looks on every tick");
});

test("a remote claim takes a free row, leaves a fresh lease, and sticks one that went quiet unseen", async (t) => {
  const dir = await temporary(t);
  const { Kdb, LEASE_MS } = await load("kanso-spaces/kdb.js", ["Kdb", "LEASE_MS"], { exec: realExec, appHome: () => dir, home: () => "/Users/local", window: () => ({ platform: "macos" }) });
  const { LONG_MS } = await load("kanso-spaces/sleepwork.js", ["LONG_MS"], { home: () => "/Users/local" });
  const kdb = new Kdb(join(dir, "kanso"));
  const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C1, name: "Ada", terminal: "t1", tab: "tb1", pid: 11 }] }] };
  const now = 1_700_000_000_000;
  const { id } = await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true, now });
  let rows = await kdb.openWork("me", now, ["t1"], { longMs: LONG_MS });
  assert.equal(rows[0].pending, "me");
  assert.equal(rows[0].agents[0].step, "saving");
  await kdb.run(`UPDATE sleeps SET pending='other',pending_at=${now} WHERE id='${id}'; UPDATE agents SET step='requested' WHERE sleep_id='${id}';`);
  rows = await kdb.openWork("me", now + 1000, ["t1"], { longMs: LONG_MS });
  assert.equal(rows[0].pending, "other");
  assert.equal(rows[0].agents[0].step, "requested");
  await kdb.run(`UPDATE sleeps SET pending='other',pending_at=${now - LEASE_MS - 1000},state='sleeping' WHERE id='${id}';`);
  rows = await kdb.openWork("me", now, [], { longMs: LONG_MS });
  assert.equal(rows[0].state, "stuck");
  assert.equal(rows[0].pending, null);
  await kdb.run(`UPDATE sleeps SET state='sleeping',pending='other',pending_at=${now - LONG_MS - 1000} WHERE id='${id}';`);
  rows = await kdb.openWork("me", now, [], { longMs: LONG_MS });
  assert.equal(rows[0].pending, "me");
  assert.equal(rows[0].state, "sleeping");
});

test("a remote step that is waiting does not ask again until its timer", async (t) => {
  const dir = await temporary(t);
  const calls = [], hcLog = [];
  const alive = new Set([11]);
  const host = {
    window: () => ({ platform: "macos" }), home: () => "/Users/local", appHome: () => dir,
    terminals: () => [{ address: "light/t1" }], panes: () => [], run() {},
    exec: async (c, a = [], o = {}) => {
      calls.push({ c, on: o.on ?? null });
      if (c === "pwsh" || c === "powershell") return { code: 1, stdout: "", stderr: "" };
      if (c === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
      if (c === "sh" && String(a[1] ?? "").includes("kanso-look-end")) return { code: 0, stdout: lookText(a.slice(3), alive), stderr: "" };
      if (c === "sh") return { code: 0, stdout: "/Users/remote", stderr: "" };
      return realExec(c, a, o);
    },
    hc: async (args) => { hcLog.push(args); return { code: 1, stdout: "", stderr: "missing" }; },
    readTextFile: async () => { throw new Error("ENOENT"); },
  };
  const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C1, wake: ["claude"], name: "Ada", terminal: "t1", tab: "tb1", pid: 11 }] }] };
  const { SleepWork, homePlace, TICK_MS, SAVE_MS } = await load("kanso-spaces/sleepwork.js", ["SleepWork", "homePlace", "TICK_MS", "SAVE_MS"], host);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], host);
  const kdb = new Kdb(join(dir, "kanso"), "light");
  const now = 1_700_000_000_000;
  await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, agents: [{ conversation: C1, tab: "tb1", pos: 0, given: "Ada" }], requested: true, now });
  await homePlace("light");
  const cx = { sleep: async () => {}, spawn: (fn) => fn(cx) };
  const w = new SleepWork(kdb, () => {}, "win-a", () => false, "light");
  assert.equal(await w.tick(cx, now), true);
  const at = calls.length + hcLog.length;
  assert.equal(await w.tick(cx, now + TICK_MS), true);
  assert.ok(calls.length + hcLog.length > at);
  const quiet = calls.length + hcLog.length;
  assert.equal(await w.tick(cx, now + TICK_MS * 2), true);
  assert.equal(calls.length + hcLog.length, quiet);
  const later = calls.length + hcLog.length;
  assert.equal(await w.tick(cx, now + SAVE_MS + 5000), true);
  assert.ok(calls.length + hcLog.length > later);
});
