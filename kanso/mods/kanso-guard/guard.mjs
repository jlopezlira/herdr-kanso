#!/usr/bin/env node
// Kanso's memory guard, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Keeps a session that lasts weeks from taking the machine down. launchd runs
// `guard.mjs check` every 60 s (`guard.mjs install` sets that up; the Memory
// panel offers it). Each check:
//   - samples the machine, the Herdr window, herdr-core and every agent, and
//     keeps the history the Memory panel draws (data/kanso-guard/);
//   - restarts the Herdr window when it grows past its limit or its mod
//     runtime runs out of memory (terminals and agents live in herdr-core and
//     keep running), never while you type in it, and at most 3 times an hour;
//   - ends helpers the window started that hang (each answers in seconds);
//   - recycles a Claude Code agent that grew past its limit, or the heaviest
//     one when the machine runs low: only one idle for a while, in a Herdr
//     terminal with its shell behind it. It is ended with /exit and started
//     again there on the same conversation (`--resume <session>`), so a
//     conversation compacted for weeks lives on in a fresh process;
//   - tells you when the machine runs low, naming what holds the memory.
// It never ends a working agent, a terminal or herdr-core, and never kills an
// agent that does not leave on its own.
//
// Commands: check | recycle <pid> | restart-window | reap | install |
// uninstall | status

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tryOr, parseOr, retry, findAsync, mapSeries, reduceSeries } from "./pure.js";

const HOME = homedir();
const APP_HOME = process.env.HERDR_APP_HOME || join(HOME, ".config/herdr-app");
const DATA = join(APP_HOME, "data/kanso-guard");
const SELF = fileURLToPath(import.meta.url);
const LABEL = "dev.kanso.guard";
const PLIST = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const SESSIONS = join(HOME, ".claude/sessions");
const MB = 1024 * 1024;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// Limits; data/kanso-guard/settings.json overrides any of them.
const DEFAULTS = {
  windowMB: 1200,        // the window's footprint that restarts it
  graceMin: 15,          // longest wait for you to stop typing in it
  agentMB: 900,          // a Claude agent this heavy is due for a recycle
  agentIdleMin: 20,      // ...once it has been idle this long
  pressureAgentMB: 500,  // with the machine low, agents from this size are due
  lowFreePct: 20,        // the machine is low below this much free
  lowSwapMB: 5000,       // ...or with this much swapped (macOS keeps "free" up by swapping)
  noticeEveryMin: 20,    // at most one low-memory notice this often
  recycle: true,         // false: agents are only watched
  staleIdleMin: 2880,    // "Close the ones not used for..." in Memory (2 days)
};
const limits = { ...DEFAULTS, ...(readJSON(join(DATA, "settings.json")) ?? {}) };

// What every command guard runs sees: its tools first (launchd starts it
// with a bare PATH). Node finds a command through the PATH it is given.
const ENV = { ...process.env, PATH: [join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", process.env.PATH ?? ""].join(":") };
mkdirSync(DATA, { recursive: true });

// ---- small tools --------------------------------------------------------------

function readJSON(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function writeJSON(path, value) { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value)); renameSync(tmp, path); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The first answer of async `fn(item)` over `list` that is not null, in
// order, or null: the walk stops at it.
const firstOf = async (list, fn, i = 0) => (i >= list.length ? null : (await fn(list[i])) ?? firstOf(list, fn, i + 1));
// The terminals of this computer that are live (a remote one has a "/").
const liveHere = (ls) => (ls?.terminals ?? []).filter((t) => t.state === "live" && !t.address.includes("/"));

// Claude Code's prompt on screen (`hc read`) holds nothing: the box under
// the last rule, from its "❯" line to the rule that closes it, is blank.
// False when no such box shows, so a screen it can't read stops /exit.
export function promptEmpty(screen) {
  const lines = String(screen ?? "").split("\n");
  const rule = (l) => /^\s*─{8,}/.test(l ?? "");
  // The last prompt line right under a rule (never the first line).
  const i = lines.findLastIndex((l, k) => k > 0 && /^\s*[❯>]/.test(l) && rule(lines[k - 1]));
  if (i < 0) return false;
  const rest = lines.slice(i + 1);
  const end = rest.findIndex(rule);
  const box = [lines[i].replace(/^\s*[❯>]/, ""), ...(end < 0 ? rest : rest.slice(0, end))];
  return box.every((l) => !l.trim());
}

// A draft left in an agent's prompt, gone: ctrl+c empties every line of
// it, then the screen must show the prompt empty.
async function clearPrompt(term) {
  if (!(await run("hc", ["keys", term, "ctrl+c"], 10_000)).ok) return false;
  await sleep(400);
  const r = await run("hc", ["read", term], 10_000);
  return r.ok && promptEmpty(r.stdout);
}

/** Runs a program with a deadline; never throws. */
function run(cmd, args, timeout = 10_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, killSignal: "SIGKILL", maxBuffer: 32 * MB, env: ENV }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error ? (error.code ?? 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: Boolean(error?.killed) });
    });
  });
}

function event(kind, text, extra = {}) {
  const e = { at: Date.now(), kind, text, ...extra };
  appendFileSync(join(DATA, "events.jsonl"), `${JSON.stringify(e)}\n`);
  return e;
}
function recentEvents(n = 40) {
  try {
    const lines = readFileSync(join(DATA, "events.jsonl"), "utf8").trim().split("\n");
    if (lines.length > 3000) writeFileSync(join(DATA, "events.jsonl"), `${lines.slice(-2000).join("\n")}\n`);
    return lines.slice(-n).map((l) => parseOr(l)).filter(Boolean).toReversed();
  } catch { return []; }
}

async function notify(title, body) {
  await run("osascript", ["-e", "on run a", "-e", "display notification (item 2 of a) with title (item 1 of a)", "-e", "end run", title, body], 5000);
}

// "dd-hh:mm:ss" / "hh:mm:ss" / "mm:ss" as minutes.
export function etimeMinutes(e) {
  const [d, rest] = e.includes("-") ? e.split("-") : ["0", e];
  const p = rest.split(":").map(Number);
  const [h, m] = p.length === 3 ? [p[0], p[1]] : [0, p[0]];
  return Number(d) * 1440 + h * 60 + m;
}

// ---- what is running ----------------------------------------------------------

async function processes() {
  const r = await run("ps", ["-axo", "pid=,ppid=,rss=,etime=,lstart=,command="], 10_000);
  return r.stdout.split("\n").flatMap((line) => {
    // lstart is five words: "Thu Nov  5 12:36:01 2026".
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    if (!m) return [];
    const command = m[6];
    const exe = command.split(" ")[0];
    return [{ pid: Number(m[1]), ppid: Number(m[2]), rssMB: Math.round(Number(m[3]) / 1024), ageMin: etimeMinutes(m[4]), lstart: m[5].replace(/\s+/g, " "), command, name: exe.split("/").at(-1) }];
  });
}

/** Physical footprint (what Activity Monitor calls Memory) in MB, per pid. */
async function footprints(pids) {
  const want = [...new Set(pids.filter(Boolean))];
  if (!want.length) return new Map();
  const file = join(tmpdir(), `kanso-guard-fp-${process.pid}.json`);
  await run("footprint", [...want.flatMap((p) => ["-p", String(p)]), "--noCategories", "-j", file], 20_000);
  const j = readJSON(file);
  rmSync(file, { force: true });
  return new Map([...(j?.processes ?? [])].map((p) => [Number(p.pid), Math.round(Number(p.footprint ?? 0) / MB)]));
}

async function windowPid() {
  const r = await run("lsof", ["-t", join(APP_HOME, "herdr-app.sock")], 5000);
  const pid = Number(r.stdout.trim().split("\n")[0]);
  return pid > 0 ? pid : null;
}

/** The terminal of the agent you are on, from the window; undefined when it can't say. */
async function focusedTerminal() {
  const r = await run("herdr-app", ["status"], 10_000);
  try { return r.ok ? (JSON.parse(r.stdout).agent ?? null) : undefined; } catch { return undefined; }
}

async function windowOOM() {
  const r = await run("herdr-app", ["status"], 10_000);
  if (!r.ok) return false;
  try { return (JSON.parse(r.stdout).errors ?? []).some((e) => /out of memory/i.test(JSON.stringify(e))); } catch { return false; }
}

async function hcJSON(args, timeout = 8000) {
  const r = await run("hc", [...args, "--json"], timeout);
  try { return r.ok ? JSON.parse(r.stdout) : null; } catch { return null; }
}

/** A Claude session record, only when it belongs to this very process. */
function claudeSession(pid, procs) {
  const s = readJSON(join(SESSIONS, `${pid}.json`));
  if (!s?.sessionId) return null;
  const p = procs.find((x) => x.pid === pid);
  if (!p) return null;
  // The record names when its process started; a reused pid does not match.
  if (!s.procStart || !sameStart(s.procStart, p.lstart)) return null; // no proof: not this process
  return s;
}

// Claude Code writes its start in UTC, ps in local time; both to the second.
export function sameStart(procStart, lstart) {
  const utc = Date.parse(`${procStart.replace(/\s+/g, " ")} UTC`), local = Date.parse(lstart);
  if (Number.isNaN(utc) || Number.isNaN(local)) return false;
  return Math.abs(utc - local) <= 1500;
}

const KIND = (argv0 = "", agent = "") => {
  const a = `${agent} ${argv0}`.toLowerCase();
  if (/claude/.test(a)) return "claude";
  if (/codex/.test(a)) return "codex";
  if (/grok/.test(a)) return "grok";
  return "other";
};

/** The agent in front in terminal `t` (`g` its details), or null when none is. */
function agentIn(t, g, procs, fp) {
  const pid = g?.foreground?.pid ?? null;
  if (!pid) return null;
  const proc = procs.find((p) => p.pid === pid);
  // Codex runs under node: what it is shows in its arguments.
  const kind = KIND((g.foreground.argv ?? []).slice(0, 2).join(" "), t.agent);
  if (kind === "other") return null;
  const s = kind === "claude" ? claudeSession(pid, procs) : null;
  const status = s ? (s.status === "idle" ? "idle" : "working") : (t.status === "working" ? "working" : "idle");
  const idleMin = s && s.status === "idle" ? Math.floor((Date.now() - (s.statusUpdatedAt ?? Date.now())) / MIN) : (status === "idle" ? 0 : null);
  const why = kind !== "claude" ? "Only Claude Code agents can be resumed automatically"
    : !s ? "Its session record was not found"
    : !resumeArgv(g.foreground.argv ?? [], s.sessionId) ? "Started with options that can't be carried over"
    : g.pid === pid ? "No shell behind it to start it again"
    : status !== "idle" ? "It is working" : null;
  return {
    pid, kind, terminal: t.address, where: t.where ?? null, cwd: g.foreground.cwd ?? t.cwd,
    name: g.labels?.["kanso.name"] || s?.name || t.where || t.address,
    mb: fp.get(pid) ?? proc?.rssMB ?? 0, status, idleMin, session: s?.sessionId ?? null,
    ageMin: proc?.ageMin ?? null, shellPid: g.pid, argv: g.foreground.argv ?? [],
    why, recyclable: why === null,
  };
}

/**
 * Every agent in a Herdr terminal on this computer, with what we know of it,
 * and each terminal's shell pid -> its address (for Ports' owners).
 */
async function agentsNow(procs, fp) {
  const ls = await hcJSON(["ls"]);
  const looks = await mapSeries(liveHere(ls), async (t) => {
    const g = await hcJSON(["get", t.address], 5000);
    return { shell: g?.pid ? [Number(g.pid), t.address] : null, agent: agentIn(t, g, procs, fp) };
  });
  return { agents: looks.map((l) => l.agent).filter(Boolean), shells: new Map(looks.map((l) => l.shell).filter(Boolean)) };
}

// ---- recycling an agent ------------------------------------------------------------

// Options that carry over into the fresh process, each with its one value
// or none. A first prompt, another session or print mode is left out. Any
// other option (one that takes several values, one this does not know) or a
// launcher in front of claude means the command can't be rebuilt faithfully:
// that agent is not recycled.
const KEEP_VALUE = new Set(["--model", "--permission-mode", "--settings", "--agent", "--effort", "--fallback-model", "--append-system-prompt", "--system-prompt", "--plugin-dir", "--setting-sources", "--name"]);
const KEEP_FLAG = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose", "--chrome", "--no-chrome", "--ide", "--strict-mcp-config", "--brief", "--debug"]);
const DROP_VALUE = new Set(["--resume", "-r", "--session-id"]);
const DROP_FLAG = new Set(["--continue", "-c", "--fork-session"]);

/** The command that resumes `session` the way argv ran, or null when it can't. */
export function resumeArgv(argv, session) {
  if (!argv.length || argv[0].split("/").at(-1) !== "claude") return null;
  // The options from argv[i] on that carry over, or null when one can't.
  const options = (i, keep) => {
    if (i >= argv.length) return keep;
    const a = argv[i];
    if (!a.startsWith("-")) return keep; // the first prompt, and anything after it
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (KEEP_FLAG.has(flag) && eq < 0) return options(i + 1, [...keep, a]);
    if (KEEP_VALUE.has(flag)) return eq > 0 ? options(i + 1, [...keep, a]) : i + 1 < argv.length ? options(i + 2, [...keep, a, argv[i + 1]]) : null;
    if (DROP_VALUE.has(flag)) return options(eq < 0 ? i + 2 : i + 1, keep);
    if (DROP_FLAG.has(flag)) return options(i + 1, keep); // left out
    return null;
  };
  const keep = options(1, []);
  return keep && [argv[0], ...keep, "--resume", session];
}
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replaceAll("'", "'\\''")}'`);

/** The live terminal on this computer with `pid` in front, as { term, g }, or null. */
async function terminalOf(pid) {
  const ls = await hcJSON(["ls"]);
  return firstOf(liveHere(ls), async (t) => {
    const x = await hcJSON(["get", t.address], 5000);
    return x?.foreground?.pid === pid ? { term: t.address, g: x } : null;
  });
}

// Up to 30 s for `pid` to leave: true once it is gone.
const exited = (pid) => retry(30, async () => { await sleep(1000); return !(await run("kill", ["-0", String(pid)], 2000)).ok; });

// A recycle or close answers with its outcome: { ok: true, beforeMB,
// afterMB } or { ok: false, why }, what a batch reports.
async function recycle(pid, reason, { manual = false, focusOnly = false } = {}) {
  const procs = await processes();
  const s = claudeSession(pid, procs);
  if (!s) return skip(pid, "its Claude session record was not found for this process");
  if (s.status !== "idle") return skip(pid, "it is working");
  const { term = null, g = null } = (await terminalOf(pid)) ?? {};
  if (!term) return skip(pid, "it is not in a Herdr terminal");
  if (g.pid === pid) return skip(pid, "no shell behind it would start it again");
  const name = g.labels?.["kanso.name"] || s.name || term;
  const recent = recentEvents(400).find((e) => e.kind === "recycle" && e.session === s.sessionId && Date.now() - e.at < 6 * HOUR);
  if (recent && !manual) return skip(pid, "it was recycled less than 6 hours ago");

  const before = (await footprints([pid])).get(pid) ?? 0;
  const argv = resumeArgv(g.foreground.argv ?? [], s.sessionId);
  if (!argv) return skip(pid, "it was started with options that can't be carried over");
  const line = `cd ${shq(s.cwd ?? g.foreground.cwd)} && ${argv.map(shq).join(" ")}`;

  // Right before /exit: still idle, still the same idle spell.
  const again = readJSON(join(SESSIONS, `${pid}.json`));
  if (again?.status !== "idle" || again.statusUpdatedAt !== s.statusUpdatedAt) return skip(pid, "it started working again");
  // Never under your hands: not the agent you are on, not while you type.
  // A batch you started checks focus only (you just clicked, so you are not
  // typing into an agent).
  if (!manual || focusOnly) {
    const on = await focusedTerminal();
    if (on === undefined) return skip(pid, "the window did not say which agent you are on");
    if (on === term) return skip(pid, "it is the agent you are on");
    if (!manual && (await idleSeconds()) < 120) return skip(pid, "you are typing");
  }
  const still = await hcJSON(["get", term], 5000);
  if (still?.foreground?.pid !== pid || still.pid !== g.pid || !claudeSession(pid, await processes())) return skip(pid, "its terminal changed");
  // A draft left in its prompt would go out with /exit: cleared first.
  if (!(await clearPrompt(term))) return skip(pid, "its prompt could not be cleared");
  if (!(await run("hc", ["send", term, "/exit"], 20_000)).ok) return skip(pid, "its terminal did not take /exit");
  if (!(await exited(pid))) {
    event("error", `${name} did not exit; left as it was`, { pid, terminal: term });
    return { ok: false, why: "it did not exit; left as it was" };
  }
  // The shell must be back in front before anything is typed into it.
  const ready = await retry(20, async () => {
    const x = await hcJSON(["get", term], 5000);
    const back = x && x.pid === g.pid && (!x.foreground?.pid || x.foreground.pid === g.pid);
    if (!back) await sleep(500);
    return back;
  });
  if (!ready) {
    event("error", `${name} exited, but its shell is busy; start it with: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} needs a manual restart`, `It exited, but its terminal is busy. Run: claude --resume ${s.sessionId}`);
    return { ok: false, why: "it exited, but its terminal was busy; see Events for the command" };
  }
  await sleep(1000); // the prompt draws after the shell takes the terminal back
  if (!(await run("hc", ["send", term, line], 20_000)).ok) {
    event("error", `${name} exited, but its terminal did not take the restart; run: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} needs a manual restart`, `Run in its terminal: claude --resume ${s.sessionId}`);
    return { ok: false, why: "its terminal did not take the restart; see Events" };
  }
  // Attached when a process in that terminal holds the same conversation.
  const after = await retry(30, async () => {
    await sleep(1000);
    const x = await hcJSON(["get", term], 5000);
    const np = x?.foreground?.pid;
    return np && np !== x.pid && readJSON(join(SESSIONS, `${np}.json`))?.sessionId === s.sessionId ? np : null;
  });
  if (!after) {
    event("error", `${name} was ended but did not come back on its conversation; run: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} did not resume`, `Run in its terminal: claude --resume ${s.sessionId}`);
    return { ok: false, why: "it did not come back on its conversation; see Events" };
  }
  const now = (await footprints([after])).get(after) ?? 0;
  event("recycle", `${name} recycled: ${before} MB to ${now} MB (${reason})`, { pid, newPid: after, terminal: term, session: s.sessionId, beforeMB: before, afterMB: now, freedMB: Math.max(0, before - now) });
  if (!manual) await notify(`${name} restarted`, `It held ${before} MB; the same conversation goes on in a fresh process (${now} MB).`);
  return { ok: true, beforeMB: before, afterMB: now };
}
function skip(pid, why, verb = "recycled") { console.log(`not ${verb} (${pid}): ${why}`); event("skip", `Not ${verb}: ${why}`, { pid }); return { ok: false, why }; }

// A batch's progress file: each save stamps its beat and writes it whole.
const saveBatch = (batch) => {
  const next = { ...batch, beat: Date.now() };
  writeJSON(join(DATA, "batch.json"), next);
  return next;
};

// Every idle agent that can be recycled (only those from `overMB`), heaviest
// first, one after another, never the one you are on. data/kanso-guard/
// batch.json says how far it got, for the Memory panel.
async function recycleBatch(overMB = 0) {
  const snap = await sample();
  const focused = snap.focused;
  const start = { at: Date.now(), beat: Date.now(), owner: process.pid, overMB, total: 0, current: null, done: [], skippedFocused: null, finished: false };
  if (focused === undefined) {
    const error = "The window did not say which agent you are on, so nothing was recycled.";
    saveBatch({ ...start, finished: true, finishedAt: Date.now(), error }); event("error", error); return;
  }
  const want = snap.agents.filter((a) => a.recyclable && a.mb >= overMB);
  const list = want.filter((a) => a.terminal !== focused).toSorted((a, b) => b.mb - a.mb);
  const begun = saveBatch({ ...start, total: list.length, skippedFocused: want.some((a) => a.terminal === focused) ? focused : null });
  event("recycle-batch", list.length ? `Recycling ${list.length} ${list.length === 1 ? "agent" : "agents"}${overMB ? ` over ${overMB} MB` : ""}` : "Nothing to recycle");
  const ran = await reduceSeries(list, async (batch, a) => {
    const going = saveBatch({ ...batch, current: a.name });
    const o = await recycle(a.pid, overMB ? `all over ${overMB} MB, asked from Memory` : "all idle, asked from Memory", { manual: true, focusOnly: true });
    const done = saveBatch({ ...going, done: [...going.done, { name: a.name, terminal: a.terminal, ok: o.ok, beforeMB: o.beforeMB ?? a.mb, afterMB: o.afterMB ?? null, why: o.ok ? null : o.why ?? "not recycled" }], current: null });
    // The panel's picture stays fresh while the batch holds the lock.
    await check({ act: false, locked: true });
    return done;
  }, begun);
  const batch = saveBatch({ ...ran, finished: true, finishedAt: Date.now() });
  const freed = batch.done.reduce((s, d) => s + (d.ok ? Math.max(0, d.beforeMB - (d.afterMB ?? d.beforeMB)) : 0), 0);
  const okN = batch.done.filter((d) => d.ok).length;
  if (list.length) event("recycle-batch", `Recycled ${okN} of ${list.length}, ${freed} MB freed`);
  if (list.length) await notify("Agents recycled", `${okN} of ${list.length}, ${freed} MB freed. Same conversations, fresh processes.`);
}

// ---- closing an agent you no longer use --------------------------------------------

/** The pane that shows a terminal in the window, or null. */
async function paneOf(term) {
  const r = await run("herdr-app", ["ls"], 10_000);
  try {
    for (const sp of JSON.parse(r.stdout).spaces ?? []) for (const tab of sp.tabs ?? []) for (const t of tab.terminals ?? []) if (t.terminal === term) return t.pane ?? null;
  } catch {}
  return null;
}

/**
 * Ends an idle Claude agent and closes its pane. It leaves with /exit, so its
 * conversation is saved and `claude --resume <session>` brings it back any
 * time; the event keeps that command. Only a Claude agent with its session
 * record (Codex and Grok have no idle state to trust), never the agent you
 * are on, never one that is working or was used since it was picked
 * (`minIdle`), and the pane only while that terminal still holds what it held.
 */
async function closeAgent(pid, why, minIdle = 0) {
  const no = (reason) => skip(pid, reason, "closed");
  const procs = await processes();
  const s = claudeSession(pid, procs);
  if (!s) return no("only a Claude agent with its session record can be closed from here");
  if (s.status !== "idle") return no("it is working");
  const idleMin = Math.floor((Date.now() - (s.statusUpdatedAt ?? Date.now())) / MIN);
  if (idleMin < minIdle) return no("it was used since it was picked");
  const { term = null, g = null } = (await terminalOf(pid)) ?? {};
  if (!term) return no("it is not in a Herdr terminal");
  const name = g.labels?.["kanso.name"] || s.name || term;
  const pane = await paneOf(term);
  const mb = (await footprints([pid])).get(pid) ?? 0;
  const resume = `cd ${shq(s.cwd ?? HOME)} && claude --resume ${s.sessionId}`;
  // Right before /exit: not the one you are on, the same idle spell, the same process in front.
  const on = await focusedTerminal();
  if (on === undefined) return no("the window did not say which agent you are on");
  if (on === term) return no("it is the agent you are on");
  const again = readJSON(join(SESSIONS, `${pid}.json`));
  if (again?.status !== "idle" || again.statusUpdatedAt !== s.statusUpdatedAt) return no("it started working again");
  const still = await hcJSON(["get", term], 5000);
  if (still?.foreground?.pid !== pid || still.pid !== g.pid) return no("its terminal changed");
  if (!(await clearPrompt(term))) return no("its prompt could not be cleared");
  if (!(await run("hc", ["send", term, "/exit"], 20_000)).ok) return no("its terminal did not take /exit");
  if (!(await exited(pid))) { event("error", `${name} did not exit; left as it was`, { pid }); return { ok: false, why: "it did not exit; left as it was" }; }
  // Its shell is back in front and nothing else started there; still not the one you are on.
  const after = await hcJSON(["get", term], 5000);
  if (!after || after.pid !== g.pid || (after.foreground?.pid && after.foreground.pid !== g.pid) || (await focusedTerminal()) === term || (pane && (await paneOf(term)) !== pane)) {
    event("close", `${name} exited (${mb} MB back) but its pane was left open: its terminal changed; to reopen: ${resume}`, { pid, terminal: term, session: s.sessionId, resume, freedMB: mb, beforeMB: mb });
    return { ok: false, why: "it exited, but its terminal changed; the pane was left open" };
  }
  // Its pane closed, or else its terminal ended.
  const closed = (pane ? (await run("herdr-app", ["do", "pane.close", "--pane", pane], 15_000)).ok : false)
    || (await run("hc", ["kill", term], 15_000)).ok;
  event("close", `${name} closed after ${Math.round(idleMin / 60)} h idle, ${mb} MB back (${why})${closed ? "" : "; its pane could not be closed"}; to reopen: ${resume}`,
    { pid, terminal: term, session: s.sessionId, resume, freedMB: mb, beforeMB: mb });
  return { ok: true, beforeMB: mb, afterMB: 0 };
}

/** Every idle agent not used for `minIdle` minutes (Claude's own idle time), oldest first. */
async function closeStale(minIdle) {
  const snap = await sample();
  const list = snap.agents.filter((a) => a.kind === "claude" && a.status === "idle" && (a.idleMin ?? 0) >= minIdle && a.terminal !== snap.focused)
    .toSorted((a, b) => (b.idleMin ?? 0) - (a.idleMin ?? 0));
  const start = { kind: "close", at: Date.now(), beat: Date.now(), owner: process.pid, overMB: 0, minIdle, total: list.length, current: null, done: [], skippedFocused: null, finished: false };
  if (snap.focused === undefined) { saveBatch({ ...start, finished: true, finishedAt: Date.now(), error: "The window did not say which agent you are on, so nothing was closed." }); return; }
  const ran = await reduceSeries(list, async (batch, a) => {
    const going = saveBatch({ ...batch, current: a.name });
    const o = await closeAgent(a.pid, `not used for ${Math.round(a.idleMin / 60)} h, asked from Memory`, minIdle);
    const done = saveBatch({ ...going, done: [...going.done, { name: a.name, terminal: a.terminal, ok: o.ok, beforeMB: a.mb, afterMB: o.ok ? 0 : null, why: o.ok ? null : o.why ?? "not closed" }], current: null });
    await check({ act: false, locked: true });
    return done;
  }, saveBatch(start));
  const batch = saveBatch({ ...ran, finished: true, finishedAt: Date.now() });
  const okN = batch.done.filter((d) => d.ok).length;
  if (list.length) event("close-batch", `Closed ${okN} of ${list.length} agents not used for ${Math.round(minIdle / 60)} h`);
}

// ---- the window ---------------------------------------------------------------------

async function idleSeconds() {
  const r = await run("ioreg", ["-c", "IOHIDSystem"], 5000);
  const m = /"HIDIdleTime" = (\d+)/.exec(r.stdout);
  return m ? Math.floor(Number(m[1]) / 1e9) : 0;
}

async function restartWindow(reason) {
  const pid = await windowPid();
  if (!pid) return false;
  event("restart", `Window restarted: ${reason}`, { pid });
  await run("herdr-app", ["do", "app.quit"], 10_000);
  // Up to 10 s for it to quit by itself.
  await retry(20, async () => {
    const gone = !(await run("kill", ["-0", String(pid)], 2000)).ok;
    if (!gone) await sleep(500);
    return gone;
  });
  if ((await run("kill", ["-0", String(pid)], 2000)).ok) { await run("kill", ["-TERM", String(pid)]); await sleep(2000); }
  if ((await run("kill", ["-0", String(pid)], 2000)).ok) await run("kill", ["-KILL", String(pid)]);
  await sleep(1000);
  const app = [join(HOME, "Applications/Herdr.app"), "/Applications/Herdr.app"].find((p) => existsSync(p));
  const env = ["--env", `HERDR_APP_HOME=${APP_HOME}`];
  if (app) await run("open", ["-g", "-n", ...env, app], 10_000);
  else execFile("sh", ["-c", "nohup herdr-app >/dev/null 2>&1 &"], { env: { ...ENV, HERDR_APP_HOME: APP_HOME } });
  await notify("Herdr window restarted", `${reason}. Your terminals and agents kept running.`);
  return true;
}

// The guard's state after this look at the window: what it keeps between
// checks (when it grew too big, its restarts, a pause, the last notice).
async function guardWindow(win, state) {
  if (!win.pid) return { ...state, overSince: null };
  const reason = win.mb > limits.windowMB ? `It used ${win.mb} MB (limit ${limits.windowMB})` : win.oom ? "Its mod runtime ran out of memory" : null;
  if (!reason) return { ...state, overSince: null };
  // At most 3 restarts an hour: past that, something restarts it bloated.
  const over = { ...state, overSince: state.overSince ?? Date.now(), restarts: (state.restarts ?? []).filter((t) => Date.now() - t < HOUR) };
  if (over.restarts.length >= 3) {
    if (over.paused) return over;
    event("error", `Window restarts paused: 3 in the last hour and still ${reason.toLowerCase()}`);
    await notify("Herdr keeps outgrowing its limit", "Automatic restarts are paused for an hour. Open Memory in kansō to see what grows.");
    return { ...over, paused: true };
  }
  const going = { ...over, paused: false };
  if (going.restarts.length && Date.now() - going.restarts.at(-1) < 10 * MIN) return going;
  // Only after a minute without input: never under your hands, even past the
  // grace period (which only ends the notices).
  const typing = (await idleSeconds()) < 60;
  if (typing) {
    if (Date.now() - going.overSince < limits.graceMin * MIN && (!going.overNoticed || Date.now() - going.overNoticed > 10 * MIN)) {
      const noticed = { ...going, overNoticed: Date.now() };
      await notify("Herdr will restart its window", `${reason}. It restarts when you pause for a minute; terminals keep running.`);
      return noticed;
    }
    return going;
  }
  return (await restartWindow(reason)) ? { ...going, restarts: [...going.restarts, Date.now()], overSince: null } : going;
}

// ---- hung helpers -------------------------------------------------------------------

// What the Kanso mods start, by signature. Each answers in seconds.
const HELPERS = [
  /^git -{2}no-optional-locks status /, /^lsof -nP -iTCP -sTCP:LISTEN/, /^ps -axo pid=,ppid=,etime=,/,
  /^gh pr (view|list) .*-{2}json /, /(^| )ls-remote -{2}tags -{2}refs https:\/\/github\.com\/jlopezlira\/herdr-kanso/,
  /^hc machine ls -{2}json/, /herdr-app status/, /said\(\) \{/, /kanso-spend\/presenter\.mjs/,
];
export const isHelper = (command) => HELPERS.some((re) => re.test(command));

async function reap(procs, winPid, { manual = false } = {}) {
  const hung = procs.filter((p) => {
    const mine = (winPid && p.ppid === winPid) || (p.ppid === 1 && p.command.includes(join(APP_HOME, "mods/kanso-spend/presenter.mjs")));
    const patience = /presenter\.mjs/.test(p.command) ? 10 : 3;
    return mine && isHelper(p.command) && p.ageMin >= patience;
  });
  // How many were ended, one after another.
  const n = await reduceSeries(hung, async (ended, p) => {
    if (!(await run("kill", ["-TERM", String(p.pid)])).ok) return ended;
    event("reap", `Ended a hung helper after ${p.ageMin} min: ${p.command.slice(0, 100)}`, { pid: p.pid });
    return ended + 1;
  }, 0);
  // Half-written copies of shared.json a crashed window left behind.
  await run("find", [APP_HOME, "-maxdepth", "1", "-name", "shared.json.tmp.*", "-mmin", "+60", "-delete"], 5000);
  if (manual && !n) event("reap", "No hung helpers");
  return n;
}

// ---- history ---------------------------------------------------------------------------

// history.json after this minute's row, as a new value (`prev` is left as it was).
export function addToHistory(prev, row, agents, at = Date.now()) {
  const h = prev ?? {};
  // A history.json that is not an object (a bare number, string or boolean)
  // stops the check here, with the error setting a field on it gives.
  if (typeof h !== "object" && typeof h !== "function") throw new TypeError(`Cannot create property 'v' on ${typeof h} '${String(h)}'`);
  const [, free, swap, win, agentsMB] = row;
  const hourAt = Math.floor(at / HOUR) * HOUR;
  const minutes = [...(h.minutes ?? []).filter((r) => at - r[0] < DAY), row];
  // This hour's row folds the minute in: lowest and mean free, the most swap,
  // window and agents.
  const kept = (h.hours ?? []).filter((r) => at - r[0] < 90 * DAY);
  const last = kept.at(-1);
  const same = Boolean(last && last[0] === hourAt);
  const hourN = same ? (h.hourN ?? 1) + 1 : 1;
  const hours = same
    ? kept.with(-1, [last[0], Math.min(last[1], free), Math.round(((last[2] * (hourN - 1)) + free) / hourN), Math.max(last[3], swap), Math.max(last[4], win), Math.max(last[5], agentsMB), ...last.slice(6)])
    : [...kept, [hourAt, free, free, swap, win, agentsMB]];
  // Each agent's hourly peak. The agents seen now are grouped by key in one
  // pass; two under one key fold in turn, as they come.
  const old = h.agents ?? {};
  const seen = Map.groupBy(agents, (a) => a.session ?? `${a.kind}:${a.name}`);
  const fold = (entry, group) => group.reduce((e, a) => {
    const p = e.points.at(-1);
    return { ...e, name: a.name, points: p && p[0] === hourAt ? e.points.with(-1, [p[0], Math.max(p[1], a.mb), ...p.slice(2)]) : [...e.points, [hourAt, a.mb]] };
  }, entry ?? { name: group[0].name, kind: group[0].kind, points: [] });
  const merged = [
    ...Object.keys(old).map((k) => [k, seen.has(k) ? fold(old[k], seen.get(k)) : old[k]]),
    ...[...seen].filter(([k]) => !Object.hasOwn(old, k)).map(([k, group]) => [k, fold(null, group)]),
  ].map(([k, e]) => [k, { ...e, points: e.points.filter((p) => at - p[0] < 14 * DAY) }]).filter(([, e]) => e.points.length);
  // At most 40 agents (the latest seen), so the file stays far under the
  // 1 MiB the panel can read: about 450 KB at the most.
  const latest = (e) => e.points.at(-1)[0];
  const keep = merged.length > 40 ? new Set(merged.toSorted(([, a], [, b]) => latest(b) - latest(a)).slice(0, 40).map(([k]) => k)) : null;
  return { ...h, v: 1, minutes, hours, hourN, agents: Object.fromEntries(keep ? merged.filter(([k]) => keep.has(k)) : merged) };
}

/** What the guard has done, from its event log. */
function totals() {
  const zero = { recycles: 0, closed: 0, restarts: 0, reaped: 0, freedMB: 0, recycledMB: 0, closedMB: 0, since: null };
  return recentEvents(3000).reduce((t, e) => {
    const at = { ...t, since: e.at };
    const freed = e.freedMB ?? 0;
    if (e.kind === "recycle") return { ...at, recycles: t.recycles + 1, recycledMB: t.recycledMB + freed, freedMB: t.freedMB + freed };
    if (e.kind === "close") return { ...at, closed: t.closed + 1, closedMB: t.closedMB + freed, freedMB: t.freedMB + freed };
    if (e.kind === "restart") return { ...at, restarts: t.restarts + 1 };
    if (e.kind === "reap" && e.pid) return { ...at, reaped: t.reaped + 1 };
    // a batch's own lines are summaries; each agent in it is counted above
    return at;
  }, zero);
}

// ---- dev servers (the Ports panel's history) ---------------------------------------

// `lsof -F` output as one block per process: its "p" line, then the lines
// under it (whatever comes before the first "p" line belongs to none).
const lsofBlocks = (text) => {
  const lines = String(text ?? "").split("\n");
  const starts = lines.flatMap((line, i) => (line[0] === "p" ? [i] : []));
  return starts.map((start, j) => ({ pid: Number(lines[start].slice(1)), lines: lines.slice(start + 1, starts[j + 1] ?? lines.length) }));
};

/** pid -> { command, ports } from `lsof -F pcn` of the listening sockets. */
export function parseListen(text) {
  return new Map(lsofBlocks(text).map(({ pid, lines }) => {
    // The last "c" line names it; each "n" line is an address ending in its port.
    const command = lines.findLast((line) => line[0] === "c")?.slice(1) ?? "";
    const ports = [...new Set(lines.filter((line) => line[0] === "n").map((line) => {
      const v = line.slice(1);
      return Number(v.slice(v.lastIndexOf(":") + 1));
    }).filter(Boolean))].toSorted((a, b) => a - b);
    return [pid, { pid, command, ports }];
  }));
}

const shortArgs = (command) => { const [cmd, ...rest] = String(command).split(" "); return [cmd.split("/").at(-1), ...rest].join(" ").slice(0, 120); };

/** The process and everything under it, from the ps listing. */
function treeOf(root, procs) {
  const kids = Map.groupBy(procs, (p) => p.ppid);
  // Depth first, the last child first; a pid already on the way down is not
  // walked again.
  const walk = (p, above) => (above.has(p.pid) ? [] : [p, ...(kids.get(p.pid) ?? []).toReversed().flatMap((k) => walk(k, new Set([...above, p.pid])))]);
  const top = procs.find((p) => p.pid === root);
  return top ? walk(top, new Set()) : [];
}

/** Each terminal's shell pid -> its address, from herdr-core (when no agent sample has them). */
async function loadShells() {
  const looks = await mapSeries(liveHere(await hcJSON(["ls"])), async (t) => [t.address, await hcJSON(["get", t.address], 5000)]);
  return new Map(looks.filter(([, g]) => g?.pid).map(([address, g]) => [Number(g.pid), address]));
}

/**
 * The dev servers listening now (a terminal's, by `shells`, or started in a
 * folder of your home, not ~/Library), or null when lsof could not say
 * (nothing is concluded then).
 */
async function serversNow(procs, shells) {
  const ls = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], 10_000);
  // lsof exits 1 with no output when nothing listens; anything else unexplained is a failure.
  if (ls.timedOut || (!ls.ok && (ls.stderr.trim() || ls.stdout.trim()))) return null;
  const listen = parseListen(ls.stdout);
  const pids = [...listen.keys()];
  // Each one's folder: the last "n" line under its pid.
  const cwds = pids.length
    ? new Map(lsofBlocks((await run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"], 10_000)).stdout)
      .flatMap(({ pid, lines }) => lines.filter((line) => line[0] === "n").map((line) => [pid, line.slice(1)])))
    : new Map();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // The terminal whose shell it runs under, up to 64 parents up.
  const ownerOf = (p, hops = 0) => (p > 1 && hops < 64 ? (shells.has(p) ? shells.get(p) : ownerOf(byPid.get(p)?.ppid ?? 0, hops + 1)) : null);
  return [...listen.values()].flatMap((l) => {
    const proc = byPid.get(l.pid);
    if (!proc) return [];
    const cwd = cwds.get(l.pid) ?? null, owner = ownerOf(l.pid);
    const mine = cwd && cwd.startsWith(`${HOME}/`) && !cwd.startsWith(`${HOME}/Library/`);
    if (!owner && !mine) return [];
    const startedAt = Date.parse(proc.lstart) || null;
    return [{
      key: `${l.pid}@${startedAt}`, pid: l.pid, ports: l.ports, command: l.command, args: shortArgs(proc.command), cwd,
      project: cwd ? cwd.split("/").filter(Boolean).at(-1) : null, owner, mb: treeOf(l.pid, procs).reduce((t, p) => t + p.rssMB, 0),
      startedAt, lstart: proc.lstart,
    }];
  }).toSorted((a, b) => Boolean(a.owner) - Boolean(b.owner) || a.ports[0] - b.ports[0]);
}

/** ports.json after this minute's look at `now` (the servers listening). */
/** ports.json after this minute's look at `now` (the servers listening), as a new value. */
export function updatePorts(prev, now, at = Date.now()) {
  const p = prev?.v === 1 ? prev : { v: 1, minutes: [], hours: [], servers: [], totals: { opened: 0, stopped: 0, exited: 0, freedMB: 0, since: at } };
  const totals = p.totals ?? { opened: 0, stopped: 0, exited: 0, freedMB: 0, since: at };
  const byKey = new Map((p.servers ?? []).map((x) => [x.key, x]));
  const live = new Set(now.map((x) => x.key));
  // Each server seen now, by key (one look lists a key once; a repeat folds
  // in turn): its record brought up to this look.
  const looks = [...Map.groupBy(now, (x) => x.key)].map(([key, xs]) => {
    const was = byKey.get(key);
    // Listening again after a look that missed it: it never ended.
    const back = was?.ended && was.ended.how !== "stopped" ? { ...was, ended: null } : was;
    const first = back ?? { key: xs[0].key, pid: xs[0].pid, ports: xs[0].ports, command: xs[0].command, args: xs[0].args, cwd: xs[0].cwd, project: xs[0].project, startedAt: xs[0].startedAt, firstSeen: at, lastSeen: at, peakMB: xs[0].mb, owner: xs[0].owner, everLoose: !xs[0].owner, ended: null };
    const rec = xs.reduce((r, x) => ({ ...r, lastSeen: at, ports: x.ports, peakMB: Math.max(r.peakMB ?? 0, x.mb), ...(x.owner ? { owner: x.owner } : { everLoose: true }) }), first);
    return { key, rec, opened: !was, reopened: was?.ended?.how === "exited" };
  });
  const seen = new Map(looks.map((l) => [l.key, l.rec]));
  // Gone since the last look, and not stopped from Ports: it exited on its own.
  const gone = (r) => !r.ended && !live.has(r.key);
  const merged = [...new Map([...byKey, ...seen]).values()];
  const exitedNow = merged.filter(gone).length;
  const records = merged.map((r) => (gone(r) ? { ...r, ended: { at, how: "exited", freedMB: 0 } } : r));
  // At most 300: every running one, then the latest ended within 30 days.
  const all = records.filter((r) => !r.ended || at - r.ended.at < 30 * DAY);
  const running = all.filter((r) => !r.ended), ended = all.filter((r) => r.ended).toSorted((a, b) => b.ended.at - a.ended.at);
  const servers = [...running, ...ended.slice(0, Math.max(0, 300 - running.length))].toSorted((a, b) => b.firstSeen - a.firstSeen);
  const active = now.length, loose = now.filter((x) => !x.owner).length, mb = now.reduce((t, x) => t + x.mb, 0);
  const hourAt = Math.floor(at / HOUR) * HOUR;
  const kept = (p.hours ?? []).filter((r) => at - r[0] < 90 * DAY);
  const last = kept.at(-1);
  const hours = last && last[0] === hourAt
    ? kept.with(-1, [last[0], Math.max(last[1], active), Math.max(last[2], loose), Math.max(last[3], mb), ...last.slice(4)])
    : [...kept, [hourAt, active, loose, mb]];
  return {
    ...p,
    totals: {
      ...totals,
      opened: totals.opened + looks.filter((l) => l.opened).length,
      // Back after one look away: the exit counted then is taken back first.
      exited: Math.max(0, totals.exited - looks.filter((l) => l.reopened).length) + exitedNow,
    },
    servers,
    now: now.map(({ lstart, ...x }) => ({ ...x, firstSeen: seen.get(x.key).firstSeen })),
    minutes: [...(p.minutes ?? []).filter((r) => at - r[0] < DAY), [at, active, loose, mb]],
    hours,
    at,
  };
}

async function samplePorts(procs, shells) {
  const path = join(DATA, "ports.json");
  const now = await serversNow(procs, shells);
  if (now) writeJSON(path, updatePorts(readJSON(path), now));
}

/** Stops a dev server Ports lists: TERM (KILL with `force`), and records what it gave back. */
async function stopServer(pid, force = false, shownStart = null) {
  const path = join(DATA, "ports.json");
  const shells = await loadShells();
  const procs = await processes();
  const now = await serversNow(procs, shells);
  if (!now) { console.log("lsof could not list the servers"); return false; }
  const x = now.find((s) => s.pid === pid);
  if (!x) { console.log(`not a dev server Ports lists: ${pid}`); return false; }
  // The row's start (from ps's elapsed time, to the minute): a pid reused by another process is left alone.
  if (shownStart && x.startedAt && Math.abs(x.startedAt - shownStart) > 2 * MIN) { console.log(`pid ${pid} is another process now`); return false; }
  const tree = treeOf(pid, procs).map((p) => ({ pid: p.pid, lstart: p.lstart, mb: p.rssMB }));
  await run("kill", [force ? "-KILL" : "-TERM", String(pid)]);
  // Up to 5 s for it to go: pid -> start of what runs then.
  const after = await retry(10, async () => {
    await sleep(500);
    return new Map((await processes()).map((p) => [p.pid, p.lstart]));
  }, { done: (running) => running.get(pid) !== x.lstart });
  const gone = (t) => after.get(t.pid) !== t.lstart;
  if (!gone(tree[0])) { event("skip", `${x.project ?? "A dev server"} did not stop yet${force ? "" : "; Stop again forces it"}`, { pid }); return false; }
  const freed = tree.filter(gone).reduce((t, p) => t + p.mb, 0);
  // Recorded as listening first (one stopped before its first minute's look
  // still counts as opened), then as stopped.
  const listed = updatePorts(readJSON(path), now);
  const i = listed.servers.findIndex((r) => r.key === x.key);
  writeJSON(path, {
    ...listed,
    servers: i < 0 ? listed.servers : listed.servers.with(i, { ...listed.servers[i], ended: { at: Date.now(), how: "stopped", freedMB: freed } }),
    now: (listed.now ?? []).filter((s) => s.key !== x.key),
    totals: { ...listed.totals, stopped: listed.totals.stopped + 1, freedMB: listed.totals.freedMB + freed },
  });
  event("stop", `Stopped the dev server in ${x.project ?? "a folder"}${x.owner ? "" : " (no pane ran it)"}: ${freed} MB back`, { pid, freedMB: freed });
  return true;
}

// ---- one check ----------------------------------------------------------------------------

async function sample() {
  const procs = await processes();
  const [memsize, level, swapText] = await Promise.all([
    run("sysctl", ["-n", "hw.memsize"]), run("sysctl", ["-n", "kern.memorystatus_level"]), run("sysctl", ["-n", "vm.swapusage"]),
  ]);
  const swapUsed = Number(/used = ([\d.]+)M/.exec(swapText.stdout)?.[1] ?? 0);
  const swapTotal = Number(/total = ([\d.]+)M/.exec(swapText.stdout)?.[1] ?? 0);
  const winPid = await windowPid();
  const corePids = procs.filter((p) => /\/herdr-core$/.test(p.command.split(" ")[0]) && !/ connect\b/.test(p.command)).map((p) => p.pid);
  const heavy = procs.toSorted((a, b) => b.rssMB - a.rssMB).slice(0, 14).map((p) => p.pid);
  const fp0 = await footprints([winPid, ...corePids, ...heavy]);
  const found = await agentsNow(procs, fp0);
  // An agent outside the first footprint gets its own, in a second call.
  const missing = found.agents.filter((a) => !fp0.has(a.pid)).map((a) => a.pid);
  const extra = missing.length ? await footprints(missing) : new Map();
  const fp = new Map([...fp0, ...extra]);
  // Each pid's first agent takes it (entries reversed: the first one wins).
  const firstWith = new Map(found.agents.map((a, i) => [a.pid, i]).toReversed());
  const agents = found.agents.map((a, i) => (extra.has(a.pid) && firstWith.get(a.pid) === i ? { ...a, mb: extra.get(a.pid) } : a));
  const win = { pid: winPid, mb: winPid ? fp.get(winPid) ?? 0 : 0, oom: winPid ? await windowOOM() : false, limitMB: limits.windowMB };
  const agentPids = new Set(agents.map((a) => a.pid));
  const heaviest = heavy.map((pid) => procs.find((p) => p.pid === pid)).filter(Boolean)
    .map((p) => ({ pid: p.pid, name: p.command.startsWith("claude") || /^\d+\.\d+\.\d+$/.test(p.name) ? "claude" : p.name, mb: fp.get(p.pid) ?? p.rssMB, ageMin: p.ageMin, agent: agentPids.has(p.pid) }))
    .toSorted((a, b) => b.mb - a.mb).slice(0, 8);
  return {
    procs, win, agents, heaviest, focused: await focusedTerminal(),
    machine: { totalMB: Math.round(Number(memsize.stdout) / MB), freePct: Number(level.stdout) || 0, swapMB: Math.round(swapUsed), swapTotalMB: Math.round(swapTotal) },
    core: { mb: corePids.reduce((s, p) => s + (fp.get(p) ?? 0), 0) },
    shells: found.shells,
  };
}

function writeNow(snap, state, helpers) {
  writeJSON(join(DATA, "now.json"), {
    v: 1, at: Date.now(), machine: snap.machine, window: snap.win, core: snap.core, focused: snap.focused ?? null,
    agents: snap.agents.map(({ shellPid, argv, ...a }) => a).toSorted((a, b) => b.mb - a.mb),
    heaviest: snap.heaviest, helpers, limits, paused: Boolean(state.paused), events: recentEvents(40),
  });
}

// The state after telling you the machine runs low (at most once in a while).
async function pressure(snap, state) {
  const { freePct, swapMB } = snap.machine;
  if (!isLow(snap.machine)) return state;
  if (state.lowNoticed && Date.now() - state.lowNoticed < limits.noticeEveryMin * MIN) return state;
  const noticed = { ...state, lowNoticed: Date.now() };
  const top = snap.heaviest.slice(0, 4).map((p) => `${p.name} ${p.mb} MB`).join(", ");
  event("low", `Memory low: ${freePct}% free, ${swapMB} MB swapped. Heaviest: ${top}`);
  await notify(`Memory low: ${freePct}% free, ${(swapMB / 1024).toFixed(1)} GB swapped`, `Heaviest: ${top}`);
  return noticed;
}

const isLow = (m) => m.freePct < limits.lowFreePct || m.swapMB > limits.lowSwapMB;

async function recycleDue(snap) {
  if (!limits.recycle) return;
  const low = isLow(snap.machine);
  const due = snap.agents
    .filter((a) => a.recyclable && a.idleMin >= limits.agentIdleMin && (a.mb > limits.agentMB || (low && a.mb > limits.pressureAgentMB)))
    .toSorted((a, b) => b.mb - a.mb);
  // One per check: the heaviest that recycles.
  await findAsync(due, async (a) => {
    const why = a.mb > limits.agentMB ? `${a.mb} MB, over ${limits.agentMB}` : `machine low: ${snap.machine.freePct}% free, ${snap.machine.swapMB} MB swapped`;
    return (await recycle(a.pid, why)).ok;
  });
}

/** One guard at a time, for checks and actions alike. Taken from an owner
 *  only once that process is gone. Returns the release, or null. */
async function lock(waitMs = 0) {
  const path = join(DATA, "lock");
  const until = Date.now() + waitMs;
  const attempt = async () => {
    const release = tryOr(() => {
      writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return () => { try { if (readJSON(path)?.pid === process.pid) rmSync(path, { force: true }); } catch {} };
    });
    if (release) return release;
    const held = readJSON(path);
    const alive = Boolean(held?.pid) && tryOr(() => { process.kill(held.pid, 0); return true; }, false);
    // An owner gone (or a lock file nobody wrote whole for 10 s): taken over.
    if (!alive && (held || Date.now() - statSync(path).mtimeMs > 10_000)) { rmSync(path, { force: true }); return attempt(); }
    if (Date.now() >= until) return null;
    await sleep(1000);
    return attempt();
  };
  return attempt();
}

async function check({ act = true, locked = false } = {}) {
  const release = locked ? () => {} : await lock();
  if (!release) return;
  try {
    const before = readJSON(join(DATA, "state.json")) ?? {};
    const snap = await sample();
    const agentsMB = snap.agents.reduce((s, a) => s + a.mb, 0);
    const histPath = join(DATA, "history.json");
    const hist = addToHistory(readJSON(histPath), [Date.now(), snap.machine.freePct, snap.machine.swapMB, snap.win.mb, agentsMB], snap.agents);
    writeJSON(histPath, { ...hist, totals: totals() });
    await samplePorts(snap.procs, snap.shells);
    const helpers = snap.procs.filter((p) => snap.win.pid && p.ppid === snap.win.pid && isHelper(p.command) && p.ageMin >= 3).length;
    writeNow(snap, before, helpers);
    // Acting moves the state on: the window's watch, then the low notice.
    const state = act ? await (async () => {
      const watched = await guardWindow(snap.win, before);
      const ended = await reap(snap.procs, snap.win.pid);
      await recycleDue(snap);
      const after = await pressure(snap, watched);
      writeNow(snap, after, Math.max(0, helpers - ended));
      return after;
    })() : before;
    writeJSON(join(DATA, "state.json"), state);
  } finally { release(); }
}

// ---- install ------------------------------------------------------------------------------

async function install() {
  mkdirSync(join(HOME, "Library/LaunchAgents"), { recursive: true });
  const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${x(process.execPath)}</string><string>${x(SELF)}</string><string>check</string></array>
  <key>EnvironmentVariables</key><dict><key>HERDR_APP_HOME</key><string>${x(APP_HOME)}</string></dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${x(join(DATA, "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${x(join(DATA, "launchd.log"))}</string>
</dict>
</plist>
`);
  const uid = String(process.getuid());
  await run("launchctl", ["bootout", `gui/${uid}/${LABEL}`], 10_000);
  const r = await run("launchctl", ["bootstrap", `gui/${uid}`, PLIST], 10_000);
  event(r.ok ? "skip" : "error", r.ok ? "Guard turned on: a check every minute" : `Guard could not start: ${r.stderr.trim()}`);
  console.log(r.ok ? `kanso-guard on: ${process.execPath} ${SELF} check, every 60 s` : r.stderr);
}

async function uninstall() {
  await run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], 10_000);
  rmSync(PLIST, { force: true });
  event("skip", "Guard turned off");
  console.log("kanso-guard off (history kept in data/kanso-guard)");
}

// ---- main --------------------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:fs")).realpathSync(process.argv[1]);
// A command's answer as its exit status: 0 ends as Node would by itself;
// another ends once what was printed is out.
const exitWith = (code) => (code ? new Promise(() => process.stdout.write("", () => process.exit(code))) : undefined);
if (isMain) {
  const [cmd = "check", arg] = process.argv.slice(2);
  // Under the lock (another guard busy: 1), its answer, then a fresh sample.
  const manual = async (fn) => {
    const release = await lock(120_000);
    if (!release) { console.log("another guard is busy; try again"); return 1; }
    try { const code = await fn(); await check({ act: false, locked: true }); return code ?? 0; } finally { release(); }
  };
  const status = () => {
    const n = readJSON(join(DATA, "now.json"));
    if (!n) { console.log("no sample yet"); return 0; }
    console.log(`${new Date(n.at).toLocaleString()}  free ${n.machine.freePct}%  swap ${n.machine.swapMB} MB  window ${n.window.mb} MB  core ${n.core.mb} MB`);
    for (const a of n.agents) console.log(`  ${String(a.mb).padStart(5)} MB  ${a.kind.padEnd(6)} ${a.terminal.padEnd(5)} ${a.status === "idle" ? `idle ${a.idleMin}m` : "working"}  ${a.name}${a.why ? `  (${a.why})` : ""}`);
    for (const e of n.events.slice(0, 8)) console.log(`  ${new Date(e.at).toLocaleTimeString()} ${e.kind}: ${e.text}`);
    return 0;
  };
  const commands = {
    check: async () => { await check(); },
    sample: async () => { await check({ act: false }); },
    "stop-server": () => manual(async () => { const [p, start] = String(arg).split("@"); return (await stopServer(Number(p), process.argv[4] === "force", Number(start) || null)) ? 0 : 1; }),
    close: () => manual(async () => ((await closeAgent(Number(arg), "asked from Memory")).ok ? 0 : 1)),
    "close-stale": () => manual(async () => { await closeStale(arg !== undefined && Number.isFinite(Number(arg)) ? Number(arg) : limits.staleIdleMin); }),
    "recycle-all": () => manual(async () => { await recycleBatch(Number(arg) || 0); }),
    recycle: () => manual(async () => ((await recycle(Number(arg), "asked from Memory", { manual: true })).ok ? 0 : 1)),
    "restart-window": () => manual(async () => { await restartWindow("Asked from Memory"); }),
    reap: () => manual(async () => { await reap(await processes(), await windowPid(), { manual: true }); }),
    install: async () => { await install(); },
    uninstall: async () => { await uninstall(); },
    status,
  };
  const run = Object.hasOwn(commands, cmd) ? commands[cmd]
    : () => { console.log("usage: guard.mjs check|recycle <pid>|recycle-all [overMB]|close <pid>|close-stale [minIdle]|stop-server <pid> [force]|restart-window|reap|install|uninstall|status"); return 2; };
  const code = await run();
  await exitWith(typeof code === "number" ? code : 0);
}
