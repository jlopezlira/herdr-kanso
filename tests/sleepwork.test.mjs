// Sleep as the sidebar's work: each step is a pure function of the row and what was seen, written before it acts,
// so a closed dialog, a restart, a database that can't answer for a moment or a second window never leaves a sleep
// half way. The worker runs here on its own code, a stand-in Herdr and a real SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { processApi } from "../kanso/mods/kanso-panel/platform-processes.js";
import { EventEmitter, once } from "node:events";
import { load, clone, temporary, exec, nativeWindow } from "./helpers.mjs";

const C1 = "00000000-0000-4000-8000-000000000001";
const C2 = "00000000-0000-4000-8000-000000000002";
const RULE = "─".repeat(40);
const EMPTY = `Claude\n${RULE}\n❯ \n${RULE}\n`;
const DRAFT = `Claude\n${RULE}\n❯ half a thought\n${RULE}\n`;
const ASK = "Background work is running\n1. Exit and stop tasks\n2. Cancel";
const NAMES = ["leaveStep", "undoStep", "sleepStep", "mayTake", "closePlan", "agentsOf", "SleepWork", "LEASE_MS", "EXIT_MS", "SAVE_MS", "CLEAR_MS", "RESEND_MS", "LONG_MS"];

// Herdr as far as a sleep needs it: Alice (t1, pid 11, a draft in her prompt) and Bob (t2, pid 12) on their
// conversations, and a dev server (t3, pid 55), in tab tb1. `exits[t]`: how /exit goes there ("now", "asks", "never").
function herdr(dir, exits = {}) {
  const alive = new Set([11, 12, 55]), unreadable = new Set();
  const terms = {
    t1: { shell: 101, fg: { pid: 11, argv: ["claude"], cwd: "/w" }, screen: DRAFT },
    t2: { shell: 102, fg: { pid: 12, argv: ["claude"], cwd: "/w" }, screen: EMPTY },
    t3: { shell: 103, fg: { pid: 55, argv: ["npm", "run", "dev"], cwd: "/w" }, screen: "" },
  };
  const records = new Map([[11, { pid: 11, sessionId: C1 }], [12, { pid: 12, sessionId: C2 }]]);
  const log = [], ran = [];
  const ok = { code: 0, stdout: "" };
  const leave = (t) => { alive.delete(terms[t].fg.pid); terms[t].fg = { pid: terms[t].shell, argv: ["/bin/zsh"] }; terms[t].screen = "$ "; };
  const hc = async (args) => {
    const [verb, t, arg] = args;
    const x = terms[t];
    if (!x) return { code: 1, stdout: "", stderr: `${t} is not there` };
    if (verb !== "get" && verb !== "read") log.push([verb, t, arg]);
    if (verb === "get") return { code: 0, stdout: JSON.stringify({ pid: x.shell, foreground: x.fg, status: { state: x.state ?? "idle" }, title: "on the parser" }) };
    if (verb === "read") return { code: 0, stdout: x.screen };
    if (verb === "keys" && arg === "ctrl+c") { if (x.fg.argv[0] === "claude") x.screen = EMPTY; return ok; }
    if (verb === "keys" && arg === "enter") { if (x.screen === ASK) leave(t); return ok; }
    if (verb === "send" && arg === "/exit") {
      const how = exits[t] ?? "now";
      if (how === "now") leave(t); else if (how === "asks") x.screen = ASK; else x.screen = "Claude is finishing a turn\n";
      return ok;
    }
    const resume = /--resume['"]?\s+['"]?([0-9a-f-]{36})/.exec(arg ?? "")?.[1];
    if (verb === "send" && resume) {
      const pid = 20 + Number(t.slice(1));
      x.fg = { pid, argv: ["claude", "--resume", resume], cwd: "/w" };
      alive.add(pid); records.set(pid, { pid, sessionId: resume });
    }
    return ok;
  };
  const host = {
    processApi: (platform, run) => {
      const api = processApi(platform, run);
      return { ...api, exists: (pid, options) => unreadable.has(pid) ? Promise.reject(new Error("Process access denied")) : api.exists(pid, options) };
    },
    window: nativeWindow, hc, home: () => "/nonexistent-home", appHome: () => dir,
    exec: async (c, a, o) => (c === "pwsh" && a.at(-1).includes("Get-CimInstance") ? { code: 0, stdout: JSON.stringify([...alive].map((pid) => ({ pid, ppid: 1, name: "claude.exe", created: "2026-01-01T00:00:00Z" }))) } : c === "kill" && a[0] === "-0" ? { code: alive.has(Number(a[1])) ? 0 : 1, stdout: "" } : exec(c, a, o)),
    terminals: () => Object.keys(terms).map((address) => ({ address })),
    panes: () => Object.keys(terms).map((t, i) => ({ pane: `p${i}`, terminal: t, tab: "tb1" })),
    run: (cmd, args) => {
      ran.push([cmd, args]);
      if (cmd === "tab.close") Object.keys(terms).forEach((t) => delete terms[t]);
      if (cmd === "terminal.kill") delete terms[args.terminal];
    },
    readTextFile: async (path) => {
      const pid = Number(/(\d+)\.json$/.exec(path)?.[1]);
      if (!records.has(pid)) throw new Error("ENOENT");
      return JSON.stringify(records.get(pid));
    },
  };
  const sent = (verb, arg) => log.filter((l) => l[0] === verb && (arg == null || l[2] === arg)).map((l) => l[1]);
  return { host, terms, alive, unreadable, log, ran, leave, sent };
}

const pane = (terminal, resume, pid, name) => ({ argv: ["claude"], cwd: "/w", resume, wake: ["claude", "--resume", resume], name, terminal, tab: "tb1", front: pid, pid });
// What the dialog writes, and nothing more.
async function intent(kdb) {
  const layout = { per: null, tab: "tb1", cols: [{ w: 1, panes: [pane("t1", C1, 11, "Alice"), pane("t2", C2, 12, "Bob"), { argv: ["npm", "run", "dev"], cwd: "/w", terminal: "t3", tab: "tb1", front: 55 }] }] };
  const { id } = await kdb.sleepTab({ name: "1", space: { id: "sp1", name: "kanso" }, project: ":/w", layout, requested: true,
    agents: [{ conversation: C1, tab: "tb1", pos: 0 }, { conversation: C2, tab: "tb1", pos: 1 }] });
  return id;
}

async function setup(t, exits = {}) {
  const dir = await temporary(t);
  const world = herdr(dir, exits);
  const mod = await load("kanso-spaces/sleepwork.js", NAMES, world.host);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], world.host);
  const kdb = new Kdb(join(dir, "kanso"));
  const id = await intent(kdb);
  const changes = [];
  const worker = (me) => new mod.SleepWork(kdb, (row) => changes.push(row && { state: row.state, why: row.why }), me);
  const row = async () => clone((await kdb.sleeps()).find((r) => r.id === id) ?? null);
  const steps = async () => Object.fromEntries((await kdb.read("SELECT id, step FROM agents ORDER BY id")).map((a) => [a.id === C1 ? "Alice" : "Bob", a.step]));
  return { world, mod, kdb, id, worker, changes, row, steps };
}
const cx = { sleep: async () => {}, spawn: (fn) => fn(cx) };
// Ticks until the worker holds nothing (or `until` holds), at most n times.
async function drive(w, n = 40, until = async () => false) {
  for (let k = 0; k < n; k++) {
    if (await until()) return k;
    if (!(await w.tick(cx))) return k;
  }
  return n;
}

test("each step is decided from the row and what was seen, and leaving goes requested, saving, clearing, exiting, left", async (t) => {
  const { mod } = await setup(t);
  const { leaveStep, EXIT_MS, SAVE_MS, CLEAR_MS, RESEND_MS } = mod;
  const a = { name: "Alice", pid: 11, conversation: C1, step_at: 1000, sent_at: 1000 };
  const seen = { alive: true, front: 11, state: "idle", screen: EMPTY, record: { pid: 11, sessionId: C1 } };
  const at = (step, more = {}, now = 1500) => clone(leaveStep({ ...a, step }, { ...seen, ...more }, now));
  assert.deepEqual(at("requested"), { write: { step: "saving", step_at: 1500 }, act: null });
  assert.deepEqual(at("saving", { title: "t", cwd: "/w" }), { write: { step: "clearing", step_at: 1500, program: "claude", title: "t", cwd: "/w" }, act: "interrupt" }, "its conversation is saved, then its prompt is cleared");
  assert.equal(at("saving", { state: "working" }).write.why, "Alice is working", "a turn is never cut off");
  assert.equal(at("saving", { front: 77 }).write.why, "Alice's terminal changed");
  assert.equal(at("saving", { record: { pid: 11, sessionId: C2 } }).write.why, "Alice is on another conversation now");
  assert.deepEqual(at("saving", { front: null }), { write: null, act: null }, "a terminal not read is waited for");
  assert.equal(at("saving", { front: null }, 1000 + SAVE_MS + 1).write.why, "Alice's terminal could not be read", "for a while");
  assert.deepEqual(at("clearing", { screen: DRAFT }), { write: null, act: null }, "a draft would go out with /exit: not yet");
  assert.deepEqual(clone(leaveStep({ ...a, step: "clearing" }, { ...seen, screen: DRAFT }, 1000 + CLEAR_MS + 1)),
    { write: { step: "clearing", step_at: 1000 + CLEAR_MS + 1, nudged_at: 1000 + CLEAR_MS + 1 }, act: "interrupt" }, "a ctrl+c that never went goes once more");
  assert.equal(clone(leaveStep({ ...a, step: "clearing", nudged_at: 1000 }, { ...seen, screen: DRAFT }, 1000 + CLEAR_MS + 1)).write.why, "Alice's prompt could not be cleared", "then stuck");
  assert.deepEqual(at("clearing"), { write: { step: "exiting", step_at: 1500, sent_at: 1500 }, act: "exit" }, "written before /exit goes");
  assert.deepEqual(at("exiting", { screen: ASK }), { write: null, act: "enter" }, "Claude's question: Exit and stop tasks");
  assert.deepEqual(at("exiting", { screen: ASK, front: 101 }), { write: null, act: null }, "the question left on screen over a shell: no Enter");
  assert.deepEqual(at("exiting", { screen: "bye" }), { write: null, act: null });
  assert.deepEqual(at("exiting", {}, 1000 + RESEND_MS + 1), { write: { step: "exiting", step_at: 1000 + RESEND_MS + 1 }, act: "exit" }, "a /exit a restart lost goes again");
  assert.equal(at("exiting", { screen: "bye" }, 1000 + EXIT_MS + 1).write.why, "Alice did not exit", "a process that refuses to exit is stuck, not taken for gone");
  assert.deepEqual(at("exiting", { alive: null, screen: "bye" }), { write: null, act: null }, "a check that failed is no sighting");
  assert.deepEqual(at("exiting", { alive: false }), { write: { step: "left", why: null }, act: null });
  assert.deepEqual(at("stuck", { alive: false }), { write: { step: "left", why: null }, act: null }, "stuck, then gone on its own: it left");
  assert.deepEqual(at("left", { alive: false }), { write: null, act: null });
});

test("an undo brings back what left, lets go of what never did, and waits for one that was told to go", async (t) => {
  const { mod } = await setup(t);
  const { undoStep, EXIT_MS } = mod;
  const a = { name: "Alice", pid: 11, step_at: 1000, sent_at: 1000 };
  const at = (step, alive, now = 1500, more = {}) => clone(undoStep({ ...a, step, ...more }, { alive, front: 11, screen: "Claude is finishing a turn", ...more.seen }, now));
  assert.deepEqual(at("left", false), { write: { step: "returning", step_at: 1500 }, act: "return" });
  assert.deepEqual(at("returning", true), { write: { step: "returning", step_at: 1500 }, act: "again" }, "cut short by a restart: looked at before anything is sent again");
  assert.deepEqual(at("stuck", true, 1500, { sent_at: null }), { write: null, act: "free" }, "it never got /exit: awake as it runs");
  assert.deepEqual(at("stuck", true), { write: { step: "unsure" }, act: null }, "stuck after its /exit, still busy: kept, never let go to die unrecorded");
  assert.deepEqual(at("stuck", false), { write: { step: "returning", step_at: 1500 }, act: "return" }, "and once it went, brought back");
  assert.deepEqual(at("saving", true, 1500, { seen: { state: "working" } }), { write: { step: "unsure" }, act: null }, "retried after its /exit went: still kept");
  assert.deepEqual(at("saving", null, 1500, { sent_at: null }), { write: null, act: "free" }, "unknown is not gone");
  assert.deepEqual(at("exiting", true), { write: null, act: null }, "told to go: it may still");
  assert.deepEqual(at("exiting", false), { write: { step: "returning", step_at: 1500 }, act: "return" });
  assert.deepEqual(at("exiting", true, 1000 + EXIT_MS + 1, { seen: { screen: EMPTY } }), { write: null, act: "free" }, "past the wait, at its empty prompt: no /exit waits there");
  assert.deepEqual(at("exiting", true, 1000 + EXIT_MS + 1), { write: { step: "unsure" }, act: null }, "past the wait, busy: it may still leave, so it stays asleep");
  assert.deepEqual(at("exiting", null, 1000 + EXIT_MS + 1), { write: { step: "returning", step_at: 1000 + EXIT_MS + 1 }, act: "return" }, "an exit that can't be checked is looked at, never dropped");
  assert.deepEqual(at("out", false), { write: null, act: null });
});

test("a row moves one agent at a time; one stuck stops it with why; only its owner, or anyone once the owner went quiet, works it", async (t) => {
  const { mod } = await setup(t);
  const { sleepStep, mayTake, closePlan, LEASE_MS, LONG_MS } = mod;
  const ag = (name, step, why = null) => ({ name, step, why });
  assert.equal(sleepStep({ state: "sleeping" }, [ag("A", "left"), ag("B", "saving")]).agent.name, "B");
  assert.deepEqual(clone(sleepStep({ state: "sleeping" }, [ag("A", "left"), ag("B", "stuck", "B did not exit")])), { state: "stuck", why: "B did not exit" });
  assert.deepEqual(clone(sleepStep({ state: "sleeping" }, [ag("A", "left"), ag("B", "left")])), { close: true });
  assert.deepEqual(clone(sleepStep({ state: "stuck" }, [ag("A", "left")])), { state: "sleeping", why: null }, "nothing stuck any more: it goes on");
  assert.equal(sleepStep({ state: "undoing" }, [ag("A", "out"), ag("B", "left")]).agent.name, "B");
  assert.deepEqual(clone(sleepStep({ state: "undoing" }, [ag("A", "out"), ag("B", "unsure")])), { finish: true });
  const row = { state: "sleeping", pending: "w-a", pending_at: 1000, waking: null };
  assert.equal(mayTake(row, "w-a", 2000, true), true);
  assert.equal(mayTake(row, "w-b", 1000 + LEASE_MS - 1, true), false, "its owner still beats");
  assert.equal(mayTake(row, "w-b", 1000 + LEASE_MS, true), true, "its owner went quiet (a restart, a closed window)");
  assert.equal(mayTake(row, "w-b", 1000 + LEASE_MS, false), false, "terminals not in this window: left to the one that has them");
  assert.equal(mayTake(row, "w-b", 1000 + LONG_MS, false), true, "unless no one has for long");
  assert.equal(mayTake({ ...row, state: "stuck" }, "w-a", 2000, true), false, "stuck waits for you");
  assert.equal(mayTake({ ...row, state: "asleep" }, "w-a", 2000, true), false);
  assert.equal(mayTake({ ...row, waking: "x" }, "w-a", 2000, true), false);
  assert.deepEqual(clone(closePlan([{ t: "t1", idle: true }, { t: "t2", idle: false }], false)), { closeTab: false, kill: ["t1"], busy: ["t2"] });
  assert.deepEqual(clone(closePlan([{ t: "t1", idle: true }], false)), { closeTab: true, kill: ["t1"], busy: [] });
  assert.equal(closePlan([{ t: "t1", idle: true }], true).closeTab, false, "a pane opened in the tab since keeps it");
});

test("with the dialog closed, the sidebar alone puts the tab to sleep: a draft cleared, each agent out in turn, the tab closed", async (t) => {
  const { world, kdb, id, worker, row, steps } = await setup(t);
  const w = worker("w-a");
  assert.equal((await row()).state, "sleeping", "the dialog wrote only what is to sleep");
  await drive(w);
  assert.deepEqual(world.sent("keys", "ctrl+c"), ["t1", "t2"]);
  assert.deepEqual(world.sent("send", "/exit"), ["t1", "t2"], "each once, Alice first");
  assert.deepEqual(world.ran.map(([cmd]) => cmd), ["tab.close"]);
  const r = await row();
  assert.equal(r.state, "asleep");
  assert.equal(r.pending, null, "let go of");
  assert.deepEqual(await steps(), { Alice: null, Bob: null });
  assert.deepEqual(clone((await kdb.read("SELECT status, title FROM agents ORDER BY id")).map((a) => [a.status, a.title])), [["asleep", "on the parser"], ["asleep", "on the parser"]], "saved with what it was on");
  assert.ok((await kdb.claim(id)), "and a wake can take it");
});

test("Claude's question before leaving is answered, and the agent goes", async (t) => {
  const { world, worker, row } = await setup(t, { t1: "asks" });
  await drive(worker("w-a"));
  assert.deepEqual(world.sent("keys", "enter"), ["t1"]);
  assert.equal((await row()).state, "asleep");
});

test("an agent that refuses to exit is stuck, shown with why; its tab stays; undo brings back the one that left and lets go of it", async (t) => {
  const { world, kdb, id, worker, changes, row, steps } = await setup(t, { t2: "never" });
  const w = worker("w-a");
  await drive(w, 40, async () => (await steps()).Bob === "exiting");
  await kdb.run(`UPDATE agents SET sent_at=sent_at-60000 WHERE id='${C2}';`); // 45 s went by
  await drive(w);
  const r = await row();
  assert.deepEqual([r.state, r.why, r.pending], ["stuck", "Bob did not exit", null]);
  assert.deepEqual(changes.at(-1), { state: "stuck", why: "Bob did not exit" }, "told, so the sidebar shows it");
  assert.deepEqual(world.ran, [], "the tab stays open");
  assert.equal(await w.tick(cx), false, "stuck waits for you: nothing is held");
  world.terms.t2.screen = EMPTY; // Bob gave up on his /exit: at his prompt, nothing waits
  assert.equal(await kdb.undo(id), true);
  await drive(w);
  assert.equal(await row(), null, "undone: the row goes");
  assert.deepEqual(clone(world.terms.t1.fg.argv), ["claude", "--resume", C1], "Alice back on her conversation, in her terminal");
  assert.deepEqual(clone(await kdb.read("SELECT status, sleep_id FROM agents ORDER BY id")), [{ status: "unknown", sleep_id: null }, { status: "unknown", sleep_id: null }], "both awake: Bob never left");
});

test("retry takes a stuck agent from the start; one you end yourself lets the sleep go on", async (t) => {
  const { world, kdb, id, worker, row, steps } = await setup(t, { t2: "never" });
  const w = worker("w-a");
  await drive(w, 40, async () => (await steps()).Bob === "exiting");
  await kdb.run(`UPDATE agents SET sent_at=sent_at-60000 WHERE id='${C2}';`);
  await drive(w);
  assert.equal((await row()).state, "stuck");
  world.terms.t2.screen = EMPTY;
  assert.equal(await kdb.retry(id), true);
  assert.equal((await steps()).Bob, "saving", "looked at again before anything is sent");
  await drive(w, 40, async () => (await steps()).Bob === "exiting");
  await kdb.run(`UPDATE agents SET sent_at=sent_at-60000 WHERE id='${C2}';`);
  await drive(w);
  assert.equal((await row()).state, "stuck", "it refused again");
  world.leave("t2"); // you end it there
  w.watchedAt = 0;
  await drive(w);
  assert.equal((await row()).state, "asleep");
  assert.deepEqual(world.ran.map(([cmd]) => cmd), ["tab.close"]);
});

test("a step the database can't write is not acted on, and is taken again on the next look", async (t) => {
  const { world, kdb, worker, steps } = await setup(t);
  const w = worker("w-a");
  await w.tick(cx); // requested -> saving
  const real = kdb.stepAgent.bind(kdb);
  kdb.stepAgent = async () => { throw new Error("database is locked"); };
  await w.tick(cx);
  assert.deepEqual(world.sent("keys"), [], "no ctrl+c without its step written");
  assert.equal((await steps()).Alice, "saving");
  kdb.stepAgent = real;
  await w.tick(cx);
  assert.deepEqual(world.sent("keys", "ctrl+c"), ["t1"]);
  assert.equal((await steps()).Alice, "clearing");
});

test("a restart mid-step: another sidebar takes the row once the old owner's heartbeat stops, and goes on from the step written", async (t) => {
  const { world, mod, worker, row, steps } = await setup(t, { t1: "never" });
  const a = worker("w-a");
  await drive(a, 40, async () => (await steps()).Alice === "exiting");
  // a is gone (reloaded); b is the new sidebar.
  const b = worker("w-b");
  assert.equal(await b.tick(cx), false, "a's hold is fresh: b waits");
  assert.equal(await b.tick(cx, Date.now() + mod.LEASE_MS + 1000), true, "a went quiet: b takes it");
  world.leave("t1"); // Alice's /exit lands at last
  await drive(b);
  assert.equal((await row()).state, "asleep");
  assert.deepEqual(world.sent("send", "/exit"), ["t1", "t2"], "Alice's /exit is not sent twice");
});

test("two windows: one works the row, the other never sends a key to it", async (t) => {
  const { world, worker, row } = await setup(t);
  const a = worker("w-a"), b = worker("w-b");
  for (let k = 0; k < 40; k++) {
    const [x, y] = await Promise.all([a.tick(cx), b.tick(cx)]);
    if (!x && !y) break;
  }
  assert.equal((await row()).state, "asleep");
  assert.deepEqual(world.sent("keys", "ctrl+c"), ["t1", "t2"], "each key once");
  assert.deepEqual(world.sent("send", "/exit"), ["t1", "t2"]);
  assert.deepEqual(world.ran.map(([cmd]) => cmd), ["tab.close"]);
});

test("once all left, a terminal running something you started there meanwhile stays, and so does its tab", async (t) => {
  const { world, worker, row } = await setup(t);
  const w = worker("w-a");
  // Bob's last step: right after he leaves, you start a script in Alice's shell.
  await drive(w, 40, async () => !world.alive.has(12));
  world.terms.t1.fg = { pid: 90, argv: ["bash", "long-job.sh"] };
  await drive(w);
  const r = await row();
  assert.equal(r.state, "asleep");
  assert.equal(r.why, "t1 runs something started there meanwhile and stays open.");
  assert.deepEqual(clone(world.ran), [["terminal.kill", { terminal: "t2" }], ["terminal.kill", { terminal: "t3" }]], "Bob's shell goes, and the dev server that slept (it starts again on wake)");
});

test("a sleep on its way or stuck is the sidebar's: no wake claims it, no sighting frees it, no forget drops it mid-way", async (t) => {
  const { kdb, id, worker, row } = await setup(t, { t2: "never" });
  assert.equal(await kdb.claim(id), null, "on its way: not to wake");
  assert.deepEqual(clone(await kdb.awake([{ conversation: C1, terminal: "t9", program: "claude", pid: 999 }])), [], "Alice seen elsewhere mid-sleep: the sleep keeps her");
  assert.equal(await kdb.forget(id), false);
  assert.ok(await row());
  const w = worker("w-a");
  await w.tick(cx);
  assert.equal(await kdb.stepAgent(id, "w-a", "undoing", C1, "saving", { step: "clearing" }), false, "a step read in another state is not written");
  assert.equal(await kdb.stepAgent(id, "w-b", "sleeping", C1, "saving", { step: "clearing" }), false, "nor by a window that does not hold the row");
});

test("a ctrl+c that never went (a restart between its step and the key, or a key that failed) goes again before the agent is stuck", async (t) => {
  const { world, kdb, worker, row, steps } = await setup(t);
  const hc = world.host.hc;
  let lost = 1;
  world.host.hc = async (args) => (args[0] === "keys" && args[2] === "ctrl+c" && lost-- > 0 ? { code: 1, stdout: "" } : hc(args));
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], world.host);
  const w = new SleepWork(kdb, () => {}, "w-a");
  await drive(w, 40, async () => (await steps()).Alice === "clearing");
  await w.tick(cx);
  assert.equal((await steps()).Alice, "clearing", "her draft is still there: waited for");
  await kdb.run(`UPDATE agents SET step_at=step_at-5000 WHERE id='${C1}';`); // past CLEAR_MS
  await drive(w);
  assert.equal((await row()).state, "asleep", "not stuck: the second ctrl+c cleared it");
  assert.equal(world.sent("send", "/exit")[0], "t1");
});

test("an Enter decided by a window that lost the row meanwhile is never sent", async (t) => {
  const { world, kdb, id, worker, steps } = await setup(t, { t1: "asks" });
  const a = worker("w-a");
  await drive(a, 40, async () => (await steps()).Alice === "exiting");
  const stale = clone((await kdb.sleeps()).find((r) => r.id === id));
  // b took it over while a was looking (a's heartbeat stopped for a while), and answered the question itself.
  await kdb.run(`UPDATE sleeps SET pending='w-b', pending_at=${Date.now()} WHERE id='${id}';`);
  await a.advance(stale, cx);
  assert.deepEqual(world.sent("keys", "enter"), [], "a sends nothing on what it read before");
});

test("an undo pressed while the tab is about to close keeps the tab, and brings the agents back", async (t) => {
  const { world, kdb, id, worker, row, steps } = await setup(t);
  const w = worker("w-a");
  await drive(w, 40, async () => { const st = await steps(); return st.Alice === "left" && st.Bob === "left"; });
  const stale = clone((await kdb.sleeps()).find((r) => r.id === id));
  assert.equal(await kdb.undo(id), true, "pressed while close() reads the terminals");
  await w.close(stale);
  assert.deepEqual(world.ran, [], "nothing closed under the undo");
  await drive(w);
  assert.equal(await row(), null, "undone");
  assert.deepEqual(clone([world.terms.t1.fg.argv, world.terms.t2.fg.argv]), [["claude", "--resume", C1], ["claude", "--resume", C2]], "both back in their terminals");
});

test("an undo of an agent stuck after its /exit, still busy, keeps it asleep: if it leaves later, a wake still has it", async (t) => {
  const { world, kdb, id, worker, row, steps } = await setup(t, { t2: "never" });
  const w = worker("w-a");
  await drive(w, 40, async () => (await steps()).Bob === "exiting");
  await kdb.run(`UPDATE agents SET sent_at=sent_at-60000 WHERE id='${C2}';`);
  await drive(w);
  assert.equal((await row()).state, "stuck");
  assert.equal(await kdb.undo(id), true);
  await drive(w);
  const r = await row();
  assert.equal(r.state, "asleep", "the row stays, for Bob");
  assert.deepEqual(clone(JSON.parse(r.layout).cols[0].panes.map((p) => [p.resume, p.check])), [[C2, "t2"]], "Bob alone, his terminal looked at before a wake");
  assert.deepEqual(clone(await kdb.read(`SELECT id, sleep_id FROM agents ORDER BY id`)), [{ id: C1, sleep_id: null }, { id: C2, sleep_id: id }], "Alice back and awake, Bob still recorded");
  world.leave("t2"); // his /exit lands late
  assert.ok(await kdb.claim(id), "and a wake can bring him back");
});

// Bob is told to exit, stays busy past the wait and is stuck: the setup of the two below.
async function stuckAfterExit(t, tweak = () => {}) {
  const ctx = await setup(t, { t2: "never" });
  tweak(ctx.world);
  // Loaded again: the module takes the host's functions as it loads.
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], ctx.world.host);
  const w = new SleepWork(ctx.kdb, () => {}, "w-a");
  await drive(w, 40, async () => (await ctx.steps()).Bob === "exiting");
  await ctx.kdb.run(`UPDATE agents SET sent_at=sent_at-60000 WHERE id='${C2}';`);
  await drive(w);
  assert.equal((await ctx.row()).state, "stuck");
  return { ...ctx, w };
}
const keptForBob = async ({ kdb, id, row }) => {
  const r = await row();
  assert.equal(r?.state, "asleep", "the row stays, for Bob");
  assert.deepEqual(clone(JSON.parse(r.layout).cols[0].panes.map((p) => [p.resume, p.check])), [[C2, "t2"]]);
  assert.deepEqual(clone(await kdb.read("SELECT id, sleep_id FROM agents ORDER BY id")), [{ id: C1, sleep_id: null }, { id: C2, sleep_id: id }]);
};

test("an undo that can't check whether the agent told to exit still runs, and finds it in front, keeps it asleep", async (t) => {
  const ctx = await stuckAfterExit(t);
  ctx.world.unreadable.add(12);
  assert.equal(await ctx.kdb.undo(ctx.id), true);
  await drive(ctx.w);
  await keptForBob(ctx);
  assert.deepEqual(clone(ctx.world.sent("send").filter((t) => t === "t2")), ["t2"], "nothing typed over Bob: only his first /exit");
});

test("retry keeps that an /exit went: an undo after it still keeps the agent while it may leave", async (t) => {
  const ctx = await stuckAfterExit(t);
  ctx.world.terms.t2.state = "working";
  assert.equal(await ctx.kdb.retry(ctx.id), true);
  assert.ok((await ctx.kdb.read(`SELECT sent_at FROM agents WHERE id='${C2}'`))[0].sent_at, "kept through the retry");
  await drive(ctx.w);
  assert.equal((await ctx.row()).why, "Bob is working", "stuck again, nothing sent");
  assert.equal(await ctx.kdb.undo(ctx.id), true);
  await drive(ctx.w);
  await keptForBob(ctx);
});

test("an undo cut short by a restart, with the agent told to exit still in front on its conversation, keeps it asleep", async (t) => {
  const ctx = await stuckAfterExit(t, (world) => {
    // Bob was itself started on his conversation: his argv and record both name it.
    world.terms.t2.fg = { ...world.terms.t2.fg, argv: ["claude", "--resume", C2] };
  });
  ctx.world.unreadable.add(12);
  assert.equal(await ctx.kdb.undo(ctx.id), true);
  // The step the return wrote before the restart; the return itself never went.
  await ctx.kdb.run(`UPDATE agents SET step='returning' WHERE id='${C2}';`);
  await drive(ctx.w);
  await keptForBob(ctx);
  assert.deepEqual(clone(ctx.world.sent("send").filter((t) => t === "t2")), ["t2"], "nothing typed over Bob: only his first /exit");
});

test("what leaves the screen is decided before any slow work, and a reload knows what to resume", async () => {
  const names = ["hidePlan", "commandsOf", "hideEntries", "claimHide", "rememberHide", "wakeMidFlight", "onLoad", "settleOnLoad", "keptOwner", "isAway", "tabOfAway", "LEASE_MS", "LONG_MS"];
  const m = await load("kanso-spaces/sleepwork.js", names, {});
  const panes = [{ pane: "p1", tab: "tb1", terminal: "t1" }, { pane: "p2", tab: "tb1", terminal: "t2" }];
  const alone = m.hidePlan({ scope: "agent", pane: "p1" }, [panes[0]], [{ id: "tb1" }]);
  assert.deepEqual(clone(alone), { park: ["t1"], settle: ["tb1"], tabs: ["tb1"] }, "the only pane: the tab goes too");
  const beside = m.hidePlan({ scope: "agent", pane: "p1" }, panes, [{ id: "tb1" }]);
  assert.deepEqual(clone(beside), { park: ["t1"], settle: [], tabs: ["tb1"] }, "a pane beside others: only that pane parks");
  const tab = m.hidePlan({ scope: "tab", tab: "tb1" }, panes, [{ id: "tb1" }, { id: "tb2" }]);
  assert.deepEqual(clone(m.commandsOf(tab, { active: "tb1", next: "tb2" })), [["tab.settle", { id: "tb1" }], ["tab.select", { id: "tb2" }]]);
  assert.deepEqual(clone(m.commandsOf(alone, { back: true })), [["tab.unsettle", { id: "tb1" }], ["terminal.keep", { terminal: "t1" }]]);
  const hidden = m.rememberHide([], m.hideEntries(tab));
  assert.equal(hidden[0].id, "away:tb1");
  assert.equal(m.claimHide(hidden, "tb1", "sl1")[0].id, "sl1");
  assert.equal(m.wakeMidFlight("sleeping"), "cancel");
  assert.equal(m.wakeMidFlight("stuck"), "cancel");
  assert.equal(m.wakeMidFlight("undoing"), "wait");
  assert.equal(m.wakeMidFlight("asleep"), "wake");
  const row = { state: "sleeping", waking: null, pending: "w-a", pending_at: 1000 };
  assert.equal(m.onLoad(row, "w-a", 2000, true), "resume", "this window still owns it");
  assert.equal(m.onLoad(row, "w-b", 2000, true), "leave", "another window's lease is still fresh");
  assert.equal(m.onLoad(row, "w-b", 1000 + m.LEASE_MS + 1, false), "stuck", "the lease ran out and this window cannot see it");
  assert.equal(m.onLoad(row, "w-b", 1000 + m.LONG_MS + 1, false), "resume", "left long enough, it is taken anyway");
  const open = [{ id: "sl1", state: "sleeping", tab: "tb1" }];
  const plan = m.settleOnLoad([{ id: "sl1", tab: "tb1", settle: ["tb1"] }, { id: "away:tb2", tab: "tb2", settle: ["tb2"] }], open);
  assert.equal(plan.reapply, undefined);
  assert.deepEqual(clone(plan.keep.map((h) => h.id)), ["sl1"]);
  assert.equal(m.isAway("away:tb1"), true);
  assert.equal(m.isAway("sl1"), false);
  assert.equal(m.tabOfAway("away:tb1"), "tb1");
  assert.equal(m.tabOfAway("sl1"), null);
  assert.deepEqual(clone(plan.reveal.map((h) => h.id)), ["away:tb2"], "a hide whose row never landed comes back");
  assert.deepEqual(clone(m.settleOnLoad([{ id: "sl1", tab: "tb1", settle: ["tb1"] }], [{ id: "sl1", state: "asleep", tab: "tb1" }]).restore.map((h) => h.id)), ["sl1"]);
  const box = new Map();
  const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  assert.equal(m.keptOwner(storage), m.keptOwner(storage));
});

test("an undo while an agent is still saving brings it back and never closes the tab", async (t) => {
  const { world, kdb, id, worker, row, steps } = await setup(t);
  const w = worker("w-a");
  await drive(w, 40, async () => (await steps()).Alice === "saving");
  assert.equal(await kdb.undo(id), true);
  await drive(w);
  assert.equal(await row(), null, "undone");
  assert.deepEqual(world.ran, [], "the tab was never closed");
});

test("two sleeps move at once: one terminal's slow read does not hold the other", { timeout: 30000 }, async (t) => {
  const { world, kdb } = await setup(t);
  const C3 = "00000000-0000-4000-8000-000000000003";
  world.terms.t4 = { shell: 104, fg: { pid: 14, argv: ["claude"], cwd: "/w" }, screen: EMPTY };
  world.alive.add(14);
  await kdb.sleepTab({ name: "2", space: { id: "sp1", name: "kanso" }, project: ":/w", requested: true,
    layout: { per: null, tab: "tb2", cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: C3, wake: ["claude", "--resume", C3], name: "Cara", terminal: "t4", tab: "tb2", front: 14, pid: 14 }] }] },
    agents: [{ conversation: C3, tab: "tb2", pos: 0 }] });
  const hc = world.host.hc;
  const reads = new EventEmitter();
  const otherRead = once(reads, "other", { signal: t.signal });
  let first = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  world.host.hc = async (args) => {
    if (args[0] === "get") {
      if (!first) first = args[1];
      if (args[1] === first) await gate;
      else reads.emit("other", args[1]);
    }
    return hc(args);
  };
  const { SleepWork } = await load("kanso-spaces/sleepwork.js", ["SleepWork"], world.host);
  const w = new SleepWork(kdb, () => {}, "w-a");
  const tickP = w.tick(cx);
  try {
    const [other] = await Promise.race([otherRead, tickP.then(() => { throw new Error("The other terminal was never read"); })]);
    assert.notEqual(other, first, "the other sleep is read while the first read waits");
  } finally {
    release();
    await tickP;
  }
});

test("a reload that cannot see the terminals, once the owner's lease has run out, marks the sleep stuck", async (t) => {
  const { world, mod, kdb, id, worker, row } = await setup(t);
  const a = worker("w-a");
  await a.tick(cx);
  for (const term of Object.keys(world.terms)) delete world.terms[term];
  const b = worker("w-b");
  await b.tick(cx, Date.now() + mod.LEASE_MS + 1000);
  const r = await row();
  assert.equal(r.state, "stuck");
  assert.equal(r.why, "The sleep stopped");
  assert.deepEqual(clone(await kdb.read("SELECT kind,target FROM since_events;")), [{ kind: "sleep_failed", target: `sleep:${id}` }]);
  assert.equal(r.id, id);
});
