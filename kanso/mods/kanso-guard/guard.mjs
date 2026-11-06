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

process.env.PATH = [join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", process.env.PATH ?? ""].join(":");
mkdirSync(DATA, { recursive: true });

// ---- small tools --------------------------------------------------------------

function readJSON(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function writeJSON(path, value) { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value)); renameSync(tmp, path); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Claude Code's prompt on screen (`hc read`) holds nothing: the box under
// the last rule, from its "❯" line to the rule that closes it, is blank.
// False when no such box shows, so a screen it can't read stops /exit.
export function promptEmpty(screen) {
  const lines = String(screen ?? "").split("\n");
  const rule = (l) => /^\s*─{8,}/.test(l ?? "");
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^\s*[❯>]/.test(lines[i]) || !rule(lines[i - 1])) continue;
    const box = [lines[i].replace(/^\s*[❯>]/, "")];
    for (let j = i + 1; j < lines.length && !rule(lines[j]); j++) box.push(lines[j]);
    return box.every((l) => !l.trim());
  }
  return false;
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
    execFile(cmd, args, { timeout, killSignal: "SIGKILL", maxBuffer: 32 * MB, env: process.env }, (error, stdout, stderr) => {
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
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
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
  const list = [];
  for (const line of r.stdout.split("\n")) {
    // lstart is five words: "Thu Nov  5 12:36:01 2026".
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[6];
    const exe = command.split(" ")[0];
    list.push({ pid: Number(m[1]), ppid: Number(m[2]), rssMB: Math.round(Number(m[3]) / 1024), ageMin: etimeMinutes(m[4]), lstart: m[5].replace(/\s+/g, " "), command, name: exe.split("/").pop() });
  }
  return list;
}

/** Physical footprint (what Activity Monitor calls Memory) in MB, per pid. */
async function footprints(pids) {
  const out = new Map();
  const want = [...new Set(pids.filter(Boolean))];
  if (!want.length) return out;
  const file = join(tmpdir(), `kanso-guard-fp-${process.pid}.json`);
  await run("footprint", [...want.flatMap((p) => ["-p", String(p)]), "--noCategories", "-j", file], 20_000);
  const j = readJSON(file);
  rmSync(file, { force: true });
  for (const p of j?.processes ?? []) out.set(Number(p.pid), Math.round(Number(p.footprint ?? 0) / MB));
  return out;
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

/** Every agent in a Herdr terminal on this computer, with what we know of it. */
// Each terminal's shell pid -> its address, filled by agentsNow (for Ports' owners).
let shellPids = new Map();

async function agentsNow(procs, fp) {
  const ls = await hcJSON(["ls"]);
  const out = [];
  shellPids = new Map();
  for (const t of ls?.terminals ?? []) {
    if (t.state !== "live" || t.address.includes("/")) continue; // this computer's only
    const g = await hcJSON(["get", t.address], 5000);
    if (g?.pid) shellPids.set(Number(g.pid), t.address);
    const pid = g?.foreground?.pid ?? null;
    if (!pid) continue;
    const proc = procs.find((p) => p.pid === pid);
    // Codex runs under node: what it is shows in its arguments.
    const kind = KIND((g.foreground.argv ?? []).slice(0, 2).join(" "), t.agent);
    if (kind === "other") continue;
    const s = kind === "claude" ? claudeSession(pid, procs) : null;
    const status = s ? (s.status === "idle" ? "idle" : "working") : (t.status === "working" ? "working" : "idle");
    const idleMin = s && s.status === "idle" ? Math.floor((Date.now() - (s.statusUpdatedAt ?? Date.now())) / MIN) : (status === "idle" ? 0 : null);
    const a = {
      pid, kind, terminal: t.address, where: t.where ?? null, cwd: g.foreground.cwd ?? t.cwd,
      name: g.labels?.["kanso.name"] || s?.name || t.where || t.address,
      mb: fp.get(pid) ?? proc?.rssMB ?? 0, status, idleMin, session: s?.sessionId ?? null,
      ageMin: proc?.ageMin ?? null, shellPid: g.pid, argv: g.foreground.argv ?? [],
    };
    a.why = kind !== "claude" ? "Only Claude Code agents can be resumed automatically"
      : !s ? "Its session record was not found"
      : !resumeArgv(g.foreground.argv ?? [], s.sessionId) ? "Started with options that can't be carried over"
      : g.pid === pid ? "No shell behind it to start it again"
      : status !== "idle" ? "It is working" : null;
    a.recyclable = a.why === null;
    out.push(a);
  }
  return out;
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
  if (!argv.length || argv[0].split("/").pop() !== "claude") return null;
  const keep = [];
  let positional = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (positional || !a.startsWith("-")) { positional = true; continue; } // the first prompt, and anything after it
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (KEEP_FLAG.has(flag) && eq < 0) keep.push(a);
    else if (KEEP_VALUE.has(flag)) { if (eq > 0) keep.push(a); else if (i + 1 < argv.length) keep.push(a, argv[++i]); else return null; }
    else if (DROP_VALUE.has(flag)) { if (eq < 0) i++; }
    else if (DROP_FLAG.has(flag)) { /* left out */ }
    else return null;
  }
  return [argv[0], ...keep, "--resume", session];
}
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

async function recycle(pid, reason, { manual = false, focusOnly = false } = {}) {
  const procs = await processes();
  const s = claudeSession(pid, procs);
  if (!s) return skip(pid, "its Claude session record was not found for this process");
  if (s.status !== "idle") return skip(pid, "it is working");
  const ls = await hcJSON(["ls"]);
  let term = null, g = null;
  for (const t of ls?.terminals ?? []) {
    if (t.state !== "live" || t.address.includes("/")) continue; // this computer's only
    const x = await hcJSON(["get", t.address], 5000);
    if (x?.foreground?.pid === pid) { term = t.address; g = x; break; }
  }
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
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) { await sleep(1000); gone = !(await run("kill", ["-0", String(pid)], 2000)).ok; }
  if (!gone) {
    event("error", `${name} did not exit; left as it was`, { pid, terminal: term });
    lastOutcome = { ok: false, why: "it did not exit; left as it was" };
    return false;
  }
  // The shell must be back in front before anything is typed into it.
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    const x = await hcJSON(["get", term], 5000);
    ready = x && x.pid === g.pid && (!x.foreground?.pid || x.foreground.pid === g.pid);
    if (!ready) await sleep(500);
  }
  if (!ready) {
    event("error", `${name} exited, but its shell is busy; start it with: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} needs a manual restart`, `It exited, but its terminal is busy. Run: claude --resume ${s.sessionId}`);
    lastOutcome = { ok: false, why: "it exited, but its terminal was busy; see Events for the command" };
    return false;
  }
  await sleep(1000); // the prompt draws after the shell takes the terminal back
  if (!(await run("hc", ["send", term, line], 20_000)).ok) {
    event("error", `${name} exited, but its terminal did not take the restart; run: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} needs a manual restart`, `Run in its terminal: claude --resume ${s.sessionId}`);
    lastOutcome = { ok: false, why: "its terminal did not take the restart; see Events" };
    return false;
  }
  // Attached when a process in that terminal holds the same conversation.
  let after = null;
  for (let i = 0; i < 30 && !after; i++) {
    await sleep(1000);
    const x = await hcJSON(["get", term], 5000);
    const np = x?.foreground?.pid;
    if (np && np !== x.pid && readJSON(join(SESSIONS, `${np}.json`))?.sessionId === s.sessionId) after = np;
  }
  if (!after) {
    event("error", `${name} was ended but did not come back on its conversation; run: ${line}`, { pid, terminal: term, session: s.sessionId });
    await notify(`${name} did not resume`, `Run in its terminal: claude --resume ${s.sessionId}`);
    lastOutcome = { ok: false, why: "it did not come back on its conversation; see Events" };
    return false;
  }
  const now = (await footprints([after])).get(after) ?? 0;
  event("recycle", `${name} recycled: ${before} MB to ${now} MB (${reason})`, { pid, newPid: after, terminal: term, session: s.sessionId, beforeMB: before, afterMB: now, freedMB: Math.max(0, before - now) });
  lastOutcome = { ok: true, beforeMB: before, afterMB: now };
  if (!manual) await notify(`${name} restarted`, `It held ${before} MB; the same conversation goes on in a fresh process (${now} MB).`);
  return true;
}
let lastOutcome = null; // why the last recycle stopped, or what it freed: for the batch's report
function skip(pid, why, verb = "recycled") { lastOutcome = { ok: false, why }; console.log(`not ${verb} (${pid}): ${why}`); event("skip", `Not ${verb}: ${why}`, { pid }); return false; }

// Every idle agent that can be recycled (only those from `overMB`), heaviest
// first, one after another, never the one you are on. data/kanso-guard/
// batch.json says how far it got, for the Memory panel.
async function recycleBatch(overMB = 0) {
  const snap = await sample();
  const focused = snap.focused;
  const batch = { at: Date.now(), beat: Date.now(), owner: process.pid, overMB, total: 0, current: null, done: [], skippedFocused: null, finished: false };
  const save = () => { batch.beat = Date.now(); writeJSON(join(DATA, "batch.json"), batch); };
  if (focused === undefined) {
    batch.finished = true; batch.finishedAt = Date.now(); batch.error = "The window did not say which agent you are on, so nothing was recycled.";
    save(); event("error", batch.error); return;
  }
  const want = snap.agents.filter((a) => a.recyclable && a.mb >= overMB);
  const list = want.filter((a) => a.terminal !== focused).sort((a, b) => b.mb - a.mb);
  batch.total = list.length;
  batch.skippedFocused = want.some((a) => a.terminal === focused) ? focused : null;
  save();
  event("recycle-batch", list.length ? `Recycling ${list.length} ${list.length === 1 ? "agent" : "agents"}${overMB ? ` over ${overMB} MB` : ""}` : "Nothing to recycle");
  for (const a of list) {
    batch.current = a.name; save();
    lastOutcome = null;
    const ok = await recycle(a.pid, overMB ? `all over ${overMB} MB, asked from Memory` : "all idle, asked from Memory", { manual: true, focusOnly: true });
    batch.done.push({ name: a.name, terminal: a.terminal, ok, beforeMB: lastOutcome?.beforeMB ?? a.mb, afterMB: lastOutcome?.afterMB ?? null, why: ok ? null : lastOutcome?.why ?? "not recycled" });
    batch.current = null; save();
    // The panel's picture stays fresh while the batch holds the lock.
    await check({ act: false, locked: true });
  }
  batch.finished = true; batch.finishedAt = Date.now(); save();
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
  const ls = await hcJSON(["ls"]);
  let term = null, g = null;
  for (const t of ls?.terminals ?? []) {
    if (t.state !== "live" || t.address.includes("/")) continue;
    const x = await hcJSON(["get", t.address], 5000);
    if (x?.foreground?.pid === pid) { term = t.address; g = x; break; }
  }
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
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) { await sleep(1000); gone = !(await run("kill", ["-0", String(pid)], 2000)).ok; }
  if (!gone) { lastOutcome = { ok: false, why: "it did not exit; left as it was" }; event("error", `${name} did not exit; left as it was`, { pid }); return false; }
  // Its shell is back in front and nothing else started there; still not the one you are on.
  const after = await hcJSON(["get", term], 5000);
  if (!after || after.pid !== g.pid || (after.foreground?.pid && after.foreground.pid !== g.pid) || (await focusedTerminal()) === term || (pane && (await paneOf(term)) !== pane)) {
    lastOutcome = { ok: false, why: "it exited, but its terminal changed; the pane was left open" };
    event("close", `${name} exited (${mb} MB back) but its pane was left open: its terminal changed; to reopen: ${resume}`, { pid, terminal: term, session: s.sessionId, resume, freedMB: mb, beforeMB: mb });
    return false;
  }
  let closed = pane ? (await run("herdr-app", ["do", "pane.close", "--pane", pane], 15_000)).ok : false;
  if (!closed) closed = (await run("hc", ["kill", term], 15_000)).ok;
  lastOutcome = { ok: true, beforeMB: mb, afterMB: 0 };
  event("close", `${name} closed after ${Math.round(idleMin / 60)} h idle, ${mb} MB back (${why})${closed ? "" : "; its pane could not be closed"}; to reopen: ${resume}`,
    { pid, terminal: term, session: s.sessionId, resume, freedMB: mb, beforeMB: mb });
  return true;
}

/** Every idle agent not used for `minIdle` minutes (Claude's own idle time), oldest first. */
async function closeStale(minIdle) {
  const snap = await sample();
  const list = snap.agents.filter((a) => a.kind === "claude" && a.status === "idle" && (a.idleMin ?? 0) >= minIdle && a.terminal !== snap.focused)
    .sort((a, b) => (b.idleMin ?? 0) - (a.idleMin ?? 0));
  const batch = { kind: "close", at: Date.now(), beat: Date.now(), owner: process.pid, overMB: 0, minIdle, total: list.length, current: null, done: [], skippedFocused: null, finished: false };
  const save = () => { batch.beat = Date.now(); writeJSON(join(DATA, "batch.json"), batch); };
  if (snap.focused === undefined) { batch.finished = true; batch.finishedAt = Date.now(); batch.error = "The window did not say which agent you are on, so nothing was closed."; save(); return; }
  save();
  for (const a of list) {
    batch.current = a.name; save();
    lastOutcome = null;
    const ok = await closeAgent(a.pid, `not used for ${Math.round(a.idleMin / 60)} h, asked from Memory`, minIdle);
    batch.done.push({ name: a.name, terminal: a.terminal, ok, beforeMB: a.mb, afterMB: ok ? 0 : null, why: ok ? null : lastOutcome?.why ?? "not closed" });
    batch.current = null; save();
    await check({ act: false, locked: true });
  }
  batch.finished = true; batch.finishedAt = Date.now(); save();
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
  for (let i = 0; i < 20; i++) { if (!(await run("kill", ["-0", String(pid)], 2000)).ok) break; await sleep(500); }
  if ((await run("kill", ["-0", String(pid)], 2000)).ok) { await run("kill", ["-TERM", String(pid)]); await sleep(2000); }
  if ((await run("kill", ["-0", String(pid)], 2000)).ok) await run("kill", ["-KILL", String(pid)]);
  await sleep(1000);
  const app = [join(HOME, "Applications/Herdr.app"), "/Applications/Herdr.app"].find((p) => existsSync(p));
  const env = ["--env", `HERDR_APP_HOME=${APP_HOME}`];
  if (app) await run("open", ["-g", "-n", ...env, app], 10_000);
  else execFile("sh", ["-c", "nohup herdr-app >/dev/null 2>&1 &"], { env: { ...process.env, HERDR_APP_HOME: APP_HOME } });
  await notify("Herdr window restarted", `${reason}. Your terminals and agents kept running.`);
  return true;
}

async function guardWindow(win, state) {
  if (!win.pid) { state.overSince = null; return; }
  const reason = win.mb > limits.windowMB ? `It used ${win.mb} MB (limit ${limits.windowMB})` : win.oom ? "Its mod runtime ran out of memory" : null;
  if (!reason) { state.overSince = null; return; }
  state.overSince ??= Date.now();
  // At most 3 restarts an hour: past that, something restarts it bloated.
  state.restarts = (state.restarts ?? []).filter((t) => Date.now() - t < HOUR);
  if (state.restarts.length >= 3) {
    if (!state.paused) { state.paused = true; event("error", `Window restarts paused: 3 in the last hour and still ${reason.toLowerCase()}`); await notify("Herdr keeps outgrowing its limit", "Automatic restarts are paused for an hour. Open Memory in Kanso to see what grows."); }
    return;
  }
  state.paused = false;
  if (state.restarts.length && Date.now() - state.restarts[state.restarts.length - 1] < 10 * MIN) return;
  // Only after a minute without input: never under your hands, even past the
  // grace period (which only ends the notices).
  const typing = (await idleSeconds()) < 60;
  if (typing) {
    if (Date.now() - state.overSince < limits.graceMin * MIN && (!state.overNoticed || Date.now() - state.overNoticed > 10 * MIN)) {
      state.overNoticed = Date.now();
      await notify("Herdr will restart its window", `${reason}. It restarts when you pause for a minute; terminals keep running.`);
    }
    return;
  }
  if (await restartWindow(reason)) { state.restarts.push(Date.now()); state.overSince = null; }
}

// ---- hung helpers -------------------------------------------------------------------

// What the Kanso mods start, by signature. Each answers in seconds.
const HELPERS = [
  /^git --no-optional-locks status /, /^lsof -nP -iTCP -sTCP:LISTEN/, /^ps -axo pid=,ppid=,etime=,/,
  /^gh pr (view|list) .*--json /, /(^| )ls-remote --tags --refs https:\/\/github\.com\/jlopezlira\/herdr-kanso/,
  /^hc machine ls --json/, /herdr-app status/, /said\(\) \{/, /kanso-spend\/presenter\.mjs/,
];
export const isHelper = (command) => HELPERS.some((re) => re.test(command));

async function reap(procs, winPid, { manual = false } = {}) {
  let n = 0;
  for (const p of procs) {
    const mine = (winPid && p.ppid === winPid) || (p.ppid === 1 && p.command.includes(join(APP_HOME, "mods/kanso-spend/presenter.mjs")));
    const patience = /presenter\.mjs/.test(p.command) ? 10 : 3;
    if (!mine || !isHelper(p.command) || p.ageMin < patience) continue;
    if ((await run("kill", ["-TERM", String(p.pid)])).ok) { n++; event("reap", `Ended a hung helper after ${p.ageMin} min: ${p.command.slice(0, 100)}`, { pid: p.pid }); }
  }
  // Half-written copies of shared.json a crashed window left behind.
  await run("find", [APP_HOME, "-maxdepth", "1", "-name", "shared.json.tmp.*", "-mmin", "+60", "-delete"], 5000);
  if (manual && !n) event("reap", "No hung helpers");
  return n;
}

// ---- history ---------------------------------------------------------------------------

export function addToHistory(h, row, agents, at = Date.now()) {
  h ??= {};
  h.v = 1;
  h.minutes = (h.minutes ?? []).filter((r) => at - r[0] < DAY);
  h.minutes.push(row);
  const [, free, swap, win, agentsMB] = row;
  const hourAt = Math.floor(at / HOUR) * HOUR;
  h.hours = (h.hours ?? []).filter((r) => at - r[0] < 90 * DAY);
  const last = h.hours[h.hours.length - 1];
  if (last && last[0] === hourAt) {
    const n = (h.hourN ?? 1) + 1;
    last[1] = Math.min(last[1], free); last[2] = Math.round(((last[2] * (n - 1)) + free) / n);
    last[3] = Math.max(last[3], swap); last[4] = Math.max(last[4], win); last[5] = Math.max(last[5], agentsMB);
    h.hourN = n;
  } else { h.hours.push([hourAt, free, free, swap, win, agentsMB]); h.hourN = 1; }
  h.agents ??= {};
  for (const a of agents) {
    const key = a.session ?? `${a.kind}:${a.name}`;
    const e = (h.agents[key] ??= { name: a.name, kind: a.kind, points: [] });
    e.name = a.name;
    const p = e.points[e.points.length - 1];
    if (p && p[0] === hourAt) p[1] = Math.max(p[1], a.mb); else e.points.push([hourAt, a.mb]);
  }
  for (const [k, e] of Object.entries(h.agents)) {
    e.points = e.points.filter((p) => at - p[0] < 14 * DAY);
    if (!e.points.length) delete h.agents[k];
  }
  // At most 40 agents (the latest seen), so the file stays far under the
  // 1 MiB the panel can read: about 450 KB at the most.
  const keys = Object.keys(h.agents);
  if (keys.length > 40) {
    const last = (k) => h.agents[k].points[h.agents[k].points.length - 1][0];
    for (const k of keys.sort((a, b) => last(b) - last(a)).slice(40)) delete h.agents[k];
  }
  return h;
}

/** What the guard has done, from its event log. */
function totals() {
  const t = { recycles: 0, closed: 0, restarts: 0, reaped: 0, freedMB: 0, recycledMB: 0, closedMB: 0, since: null };
  for (const e of recentEvents(3000)) {
    t.since = e.at;
    if (e.kind === "recycle") { t.recycles++; t.recycledMB += e.freedMB ?? 0; t.freedMB += e.freedMB ?? 0; }
    else if (e.kind === "close") { t.closed++; t.closedMB += e.freedMB ?? 0; t.freedMB += e.freedMB ?? 0; }
    else if (e.kind === "restart") t.restarts++;
    else if (e.kind === "reap" && e.pid) t.reaped++;
    // a batch's own lines are summaries; each agent in it is counted above
  }
  return t;
}

// ---- dev servers (the Ports panel's history) ---------------------------------------

/** pid -> { command, ports } from `lsof -F pcn` of the listening sockets. */
export function parseListen(text) {
  const out = new Map();
  let cur = null;
  for (const line of String(text ?? "").split("\n")) {
    const k = line[0], v = line.slice(1);
    if (k === "p") { cur = { pid: Number(v), command: "", ports: [] }; out.set(cur.pid, cur); }
    else if (k === "c" && cur) cur.command = v;
    else if (k === "n" && cur) { const port = Number(v.slice(v.lastIndexOf(":") + 1)); if (port && !cur.ports.includes(port)) cur.ports.push(port); }
  }
  for (const x of out.values()) x.ports.sort((a, b) => a - b);
  return out;
}

const shortArgs = (command) => { const [cmd, ...rest] = String(command).split(" "); return [cmd.split("/").pop(), ...rest].join(" ").slice(0, 120); };

/** The process and everything under it, from the ps listing. */
function treeOf(root, procs) {
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [], seen = new Set(), stack = [procs.find((p) => p.pid === root)].filter(Boolean);
  while (stack.length) { const p = stack.pop(); if (seen.has(p.pid)) continue; seen.add(p.pid); out.push(p); stack.push(...(kids.get(p.pid) ?? [])); }
  return out;
}

/** The dev servers listening now: a terminal's, or started in a folder of your home (not ~/Library). */
/** Each terminal's shell pid, from herdr-core (when no agent sample filled them). */
async function loadShells() {
  shellPids = new Map();
  for (const t of (await hcJSON(["ls"]))?.terminals ?? []) {
    if (t.state !== "live" || t.address.includes("/")) continue;
    const g = await hcJSON(["get", t.address], 5000);
    if (g?.pid) shellPids.set(Number(g.pid), t.address);
  }
}

/** The dev servers listening now, or null when lsof could not say (nothing is concluded then). */
async function serversNow(procs) {
  const ls = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], 10_000);
  // lsof exits 1 with no output when nothing listens; anything else unexplained is a failure.
  if (ls.timedOut || (!ls.ok && (ls.stderr.trim() || ls.stdout.trim()))) return null;
  const listen = parseListen(ls.stdout);
  const pids = [...listen.keys()];
  const cwds = new Map();
  if (pids.length) {
    let pid = null;
    for (const line of (await run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"], 10_000)).stdout.split("\n")) {
      if (line[0] === "p") pid = Number(line.slice(1)); else if (line[0] === "n" && pid != null) cwds.set(pid, line.slice(1));
    }
  }
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const ownerOf = (pid) => { for (let p = pid, hops = 0; p > 1 && hops < 64; p = byPid.get(p)?.ppid ?? 0, hops++) if (shellPids.has(p)) return shellPids.get(p); return null; };
  const out = [];
  for (const l of listen.values()) {
    const proc = byPid.get(l.pid);
    if (!proc) continue;
    const cwd = cwds.get(l.pid) ?? null, owner = ownerOf(l.pid);
    const mine = cwd && cwd.startsWith(`${HOME}/`) && !cwd.startsWith(`${HOME}/Library/`);
    if (!owner && !mine) continue;
    const startedAt = Date.parse(proc.lstart) || null;
    out.push({
      key: `${l.pid}@${startedAt}`, pid: l.pid, ports: l.ports, command: l.command, args: shortArgs(proc.command), cwd,
      project: cwd ? cwd.split("/").filter(Boolean).pop() : null, owner, mb: treeOf(l.pid, procs).reduce((t, p) => t + p.rssMB, 0),
      startedAt, lstart: proc.lstart,
    });
  }
  return out.sort((a, b) => Boolean(a.owner) - Boolean(b.owner) || a.ports[0] - b.ports[0]);
}

/** ports.json after this minute's look at `now` (the servers listening). */
export function updatePorts(prev, now, at = Date.now()) {
  const p = prev?.v === 1 ? prev : { v: 1, minutes: [], hours: [], servers: [], totals: { opened: 0, stopped: 0, exited: 0, freedMB: 0, since: at } };
  p.totals ??= { opened: 0, stopped: 0, exited: 0, freedMB: 0, since: at };
  const byKey = new Map((p.servers ?? []).map((x) => [x.key, x]));
  const live = new Set(now.map((x) => x.key));
  for (const x of now) {
    let rec = byKey.get(x.key);
    if (rec?.ended) { // listening again after a look that missed it: it never ended
      if (rec.ended.how === "exited") p.totals.exited = Math.max(0, p.totals.exited - 1);
      if (rec.ended.how !== "stopped") rec.ended = null;
    }
    if (!rec) {
      rec = { key: x.key, pid: x.pid, ports: x.ports, command: x.command, args: x.args, cwd: x.cwd, project: x.project, startedAt: x.startedAt, firstSeen: at, lastSeen: at, peakMB: x.mb, owner: x.owner, everLoose: !x.owner, ended: null };
      byKey.set(x.key, rec);
      p.totals.opened++;
    }
    rec.lastSeen = at; rec.ports = x.ports; rec.peakMB = Math.max(rec.peakMB ?? 0, x.mb);
    if (x.owner) rec.owner = x.owner; else rec.everLoose = true;
    x.firstSeen = rec.firstSeen;
  }
  // Gone since the last look, and not stopped from Ports: it exited on its own.
  for (const rec of byKey.values()) {
    if (!rec.ended && !live.has(rec.key)) { rec.ended = { at, how: "exited", freedMB: 0 }; p.totals.exited++; }
  }
  // At most 300: every running one, then the latest ended within 30 days.
  const all = [...byKey.values()].filter((r) => !r.ended || at - r.ended.at < 30 * DAY);
  const running = all.filter((r) => !r.ended), ended = all.filter((r) => r.ended).sort((a, b) => b.ended.at - a.ended.at);
  p.servers = [...running, ...ended.slice(0, Math.max(0, 300 - running.length))].sort((a, b) => b.firstSeen - a.firstSeen);
  p.now = now.map(({ lstart, ...x }) => x);
  const active = now.length, loose = now.filter((x) => !x.owner).length, mb = now.reduce((t, x) => t + x.mb, 0);
  p.minutes = (p.minutes ?? []).filter((r) => at - r[0] < DAY);
  p.minutes.push([at, active, loose, mb]);
  const hourAt = Math.floor(at / HOUR) * HOUR;
  p.hours = (p.hours ?? []).filter((r) => at - r[0] < 90 * DAY);
  const last = p.hours[p.hours.length - 1];
  if (last && last[0] === hourAt) { last[1] = Math.max(last[1], active); last[2] = Math.max(last[2], loose); last[3] = Math.max(last[3], mb); }
  else p.hours.push([hourAt, active, loose, mb]);
  p.at = at;
  return p;
}

async function samplePorts(procs) {
  const path = join(DATA, "ports.json");
  const now = await serversNow(procs);
  if (now) writeJSON(path, updatePorts(readJSON(path), now));
}

/** Stops a dev server Ports lists: TERM (KILL with `force`), and records what it gave back. */
async function stopServer(pid, force = false, shownStart = null) {
  const path = join(DATA, "ports.json");
  await loadShells();
  const procs = await processes();
  const now = await serversNow(procs);
  if (!now) { console.log("lsof could not list the servers"); return false; }
  const x = now.find((s) => s.pid === pid);
  if (!x) { console.log(`not a dev server Ports lists: ${pid}`); return false; }
  // The row's start (from ps's elapsed time, to the minute): a pid reused by another process is left alone.
  if (shownStart && x.startedAt && Math.abs(x.startedAt - shownStart) > 2 * MIN) { console.log(`pid ${pid} is another process now`); return false; }
  const tree = treeOf(pid, procs).map((p) => ({ pid: p.pid, lstart: p.lstart, mb: p.rssMB }));
  await run("kill", [force ? "-KILL" : "-TERM", String(pid)]);
  let after = null;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    after = new Map((await processes()).map((p) => [p.pid, p.lstart]));
    if (after.get(pid) !== x.lstart) break;
  }
  const gone = (t) => after.get(t.pid) !== t.lstart;
  if (!gone(tree[0])) { event("skip", `${x.project ?? "A dev server"} did not stop yet${force ? "" : "; Stop again forces it"}`, { pid }); return false; }
  const freed = tree.filter(gone).reduce((t, p) => t + p.mb, 0);
  // Recorded as listening first (one stopped before its first minute's look
  // still counts as opened), then as stopped.
  const p = updatePorts(readJSON(path), now);
  const rec = p.servers.find((r) => r.key === x.key);
  if (rec) rec.ended = { at: Date.now(), how: "stopped", freedMB: freed };
  p.now = (p.now ?? []).filter((s) => s.key !== x.key);
  p.totals.stopped++; p.totals.freedMB += freed;
  writeJSON(path, p);
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
  const heavy = [...procs].sort((a, b) => b.rssMB - a.rssMB).slice(0, 14).map((p) => p.pid);
  const fp0 = await footprints([winPid, ...corePids, ...heavy]);
  const agents = await agentsNow(procs, fp0);
  const missing = agents.filter((a) => !fp0.has(a.pid)).map((a) => a.pid);
  if (missing.length) for (const [k, v] of await footprints(missing)) { fp0.set(k, v); const a = agents.find((x) => x.pid === k); if (a) a.mb = v; }
  const win = { pid: winPid, mb: winPid ? fp0.get(winPid) ?? 0 : 0, oom: winPid ? await windowOOM() : false, limitMB: limits.windowMB };
  const agentPids = new Set(agents.map((a) => a.pid));
  const heaviest = heavy.map((pid) => procs.find((p) => p.pid === pid)).filter(Boolean)
    .map((p) => ({ pid: p.pid, name: p.command.startsWith("claude") || /^\d+\.\d+\.\d+$/.test(p.name) ? "claude" : p.name, mb: fp0.get(p.pid) ?? p.rssMB, ageMin: p.ageMin, agent: agentPids.has(p.pid) }))
    .sort((a, b) => b.mb - a.mb).slice(0, 8);
  return {
    procs, win, agents, heaviest, focused: await focusedTerminal(),
    machine: { totalMB: Math.round(Number(memsize.stdout) / MB), freePct: Number(level.stdout) || 0, swapMB: Math.round(swapUsed), swapTotalMB: Math.round(swapTotal) },
    core: { mb: corePids.reduce((s, p) => s + (fp0.get(p) ?? 0), 0) },
  };
}

function writeNow(snap, state, helpers) {
  writeJSON(join(DATA, "now.json"), {
    v: 1, at: Date.now(), machine: snap.machine, window: snap.win, core: snap.core, focused: snap.focused ?? null,
    agents: snap.agents.map(({ shellPid, argv, ...a }) => a).sort((a, b) => b.mb - a.mb),
    heaviest: snap.heaviest, helpers, limits, paused: Boolean(state.paused), events: recentEvents(40),
  });
}

async function pressure(snap, state) {
  const { freePct, swapMB } = snap.machine;
  if (!isLow(snap.machine)) return;
  if (state.lowNoticed && Date.now() - state.lowNoticed < limits.noticeEveryMin * MIN) return;
  state.lowNoticed = Date.now();
  const top = snap.heaviest.slice(0, 4).map((p) => `${p.name} ${p.mb} MB`).join(", ");
  event("low", `Memory low: ${freePct}% free, ${swapMB} MB swapped. Heaviest: ${top}`);
  await notify(`Memory low: ${freePct}% free, ${(swapMB / 1024).toFixed(1)} GB swapped`, `Heaviest: ${top}`);
}

const isLow = (m) => m.freePct < limits.lowFreePct || m.swapMB > limits.lowSwapMB;

async function recycleDue(snap) {
  if (!limits.recycle) return;
  const low = isLow(snap.machine);
  const due = snap.agents
    .filter((a) => a.recyclable && a.idleMin >= limits.agentIdleMin && (a.mb > limits.agentMB || (low && a.mb > limits.pressureAgentMB)))
    .sort((a, b) => b.mb - a.mb);
  for (const a of due) {
    const why = a.mb > limits.agentMB ? `${a.mb} MB, over ${limits.agentMB}` : `machine low: ${snap.machine.freePct}% free, ${snap.machine.swapMB} MB swapped`;
    if (await recycle(a.pid, why)) return; // one per check
  }
}

/** One guard at a time, for checks and actions alike. Taken from an owner
 *  only once that process is gone. Returns the release, or null. */
async function lock(waitMs = 0) {
  const path = join(DATA, "lock");
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return () => { try { if (readJSON(path)?.pid === process.pid) rmSync(path, { force: true }); } catch {} };
    } catch {
      const held = readJSON(path);
      let alive = false;
      if (held?.pid) { try { process.kill(held.pid, 0); alive = true; } catch {} }
      if (!alive && (held || Date.now() - statSync(path).mtimeMs > 10_000)) { rmSync(path, { force: true }); continue; }
      if (Date.now() >= until) return null;
      await sleep(1000);
    }
  }
}

async function check({ act = true, locked = false } = {}) {
  const release = locked ? () => {} : await lock();
  if (!release) return;
  try {
    const state = readJSON(join(DATA, "state.json")) ?? {};
    const snap = await sample();
    const agentsMB = snap.agents.reduce((s, a) => s + a.mb, 0);
    const histPath = join(DATA, "history.json");
    const hist = addToHistory(readJSON(histPath), [Date.now(), snap.machine.freePct, snap.machine.swapMB, snap.win.mb, agentsMB], snap.agents);
    hist.totals = totals();
    writeJSON(histPath, hist);
    await samplePorts(snap.procs);
    const helpers = snap.procs.filter((p) => snap.win.pid && p.ppid === snap.win.pid && isHelper(p.command) && p.ageMin >= 3).length;
    writeNow(snap, state, helpers);
    if (act) {
      await guardWindow(snap.win, state);
      const ended = await reap(snap.procs, snap.win.pid);
      await recycleDue(snap);
      await pressure(snap, state);
      writeNow(snap, state, Math.max(0, helpers - ended));
    }
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
if (isMain) {
  const [cmd = "check", arg] = process.argv.slice(2);
  const manual = async (fn) => {
    const release = await lock(120_000);
    if (!release) { console.log("another guard is busy; try again"); process.exitCode = 1; return; }
    try { await fn(); await check({ act: false, locked: true }); } finally { release(); }
  };
  if (cmd === "check") await check();
  else if (cmd === "sample") await check({ act: false });
  else if (cmd === "stop-server") await manual(async () => { const [p, start] = String(arg).split("@"); process.exitCode = (await stopServer(Number(p), process.argv[4] === "force", Number(start) || null)) ? 0 : 1; });
  else if (cmd === "close") await manual(async () => { process.exitCode = (await closeAgent(Number(arg), "asked from Memory")) ? 0 : 1; });
  else if (cmd === "close-stale") await manual(() => closeStale(arg !== undefined && Number.isFinite(Number(arg)) ? Number(arg) : limits.staleIdleMin));
  else if (cmd === "recycle-all") await manual(() => recycleBatch(Number(arg) || 0));
  else if (cmd === "recycle") await manual(async () => { process.exitCode = (await recycle(Number(arg), "asked from Memory", { manual: true })) ? 0 : 1; });
  else if (cmd === "restart-window") await manual(() => restartWindow("Asked from Memory"));
  else if (cmd === "reap") await manual(async () => { await reap(await processes(), await windowPid(), { manual: true }); });
  else if (cmd === "install") { await install(); }
  else if (cmd === "uninstall") { await uninstall(); }
  else if (cmd === "status") {
    const n = readJSON(join(DATA, "now.json"));
    if (!n) console.log("no sample yet");
    else {
      console.log(`${new Date(n.at).toLocaleString()}  free ${n.machine.freePct}%  swap ${n.machine.swapMB} MB  window ${n.window.mb} MB  core ${n.core.mb} MB`);
      for (const a of n.agents) console.log(`  ${String(a.mb).padStart(5)} MB  ${a.kind.padEnd(6)} ${a.terminal.padEnd(5)} ${a.status === "idle" ? `idle ${a.idleMin}m` : "working"}  ${a.name}${a.why ? `  (${a.why})` : ""}`);
      for (const e of n.events.slice(0, 8)) console.log(`  ${new Date(e.at).toLocaleTimeString()} ${e.kind}: ${e.text}`);
    }
  } else { console.log("usage: guard.mjs check|recycle <pid>|recycle-all [overMB]|close <pid>|close-stale [minIdle]|stop-server <pid> [force]|restart-window|reap|install|uninstall|status"); process.exitCode = 2; }
}
