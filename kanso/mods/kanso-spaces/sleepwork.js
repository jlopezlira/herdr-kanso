import { serviceFor, serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { killApi } from "./platform-kill.js";
import { openApi } from "./platform-open.js";
import { systemApi } from "./platform-system.js";
import { sleepEvent, LOG_LIMITS } from "./since-left-model.js";
// Sleep as work the sidebar does, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// This is the source copy; `npm run sync:share` copies it into kanso-sleep, and a test fails when a copy differs.
// The dialog only writes what is to sleep. The tab or pane leaves when sleep is ordered; this worker does the slow
// leave afterwards. The sidebar (kanso-spaces, alive as long as its window) takes each row and moves it one step
// at a time, writing each step before it acts, so a closed dialog, a restart or another window picks it up where
// it was. Per agent: requested, saving, clearing and exiting (leaving), left; any step can end stuck, with why.
// Per row: sleeping; once every agent left, its tab closes and it is asleep. Stuck waits for retry or undo;
// undoing brings back what left. An owner token and its heartbeat (sleeps.pending, pending_at) keep two windows
// off one row.
import { hc, run, panes, terminals, readTextFile, home } from "herdr";
import { promptEmpty, asksToExit, base } from "./resume.js";
import { SHELLS, spaceBeside } from "./tabkit.js";
import { range, retry, tryOr, tryOrAsync, findAsync, mapSeries, reduceSeries, parseOr } from "./pure.js";
import { LEASE_MS, CALL_MS, seenAddress, localAddress } from "./kdb.js";

export const LONG_MS = 5 * 60_000; // a row whose terminals this window can't see is taken anyway once left this long
export const SAVE_MS = 30_000; // a terminal that can't be read this long is stuck
export const CLEAR_MS = 3000; // for the prompt to show empty after ctrl+c
export const RESEND_MS = 5000; // /exit again when the prompt still shows empty this long after it went
export const EXIT_MS = 45_000; // for the process to go once /exit went
export const TICK_MS = 600;
export const WORKING = ["sleeping", "undoing"];
const KEPT = ["out", "unsure"]; // an undo's agents that stay asleep
const OWNER_KEY = "kanso.sleep.owner";

const ownerId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// The same id after a reload, so this window resumes a sleep it still owns instead of waiting out the lease.
export function keptOwner(storage = globalThis.localStorage) {
  try {
    const kept = storage?.getItem(OWNER_KEY);
    if (kept) return kept;
    const id = ownerId();
    storage?.setItem(OWNER_KEY, id);
    return id;
  } catch { return ownerId(); }
}

const AWAY = "away:";
export const isAway = (id) => String(id ?? "").startsWith(AWAY);
export const tabOfAway = (id) => (isAway(id) ? String(id).slice(AWAY.length) : null);

// A lone pane's tab settles too, so an empty tab does not stay. Nothing here ends a terminal.
export function hidePlan(order, panes, tabs = [], allSpaces = []) {
  if (order.scope === "agent") {
    const p = (panes ?? []).find((x) => x.pane === order.pane);
    if (!p) return { settle: [], park: [], tabs: [] };
    const others = (panes ?? []).some((x) => x.tab === p.tab && x.pane !== p.pane);
    return { park: p.terminal ? [p.terminal] : [], settle: others || !p.tab ? [] : [p.tab], tabs: p.tab ? [p.tab] : [] };
  }
  const ids = order.scope === "project" ? (tabs ?? []).map((t) => t.id) : [order.tab].filter(Boolean);
  const space = allSpaces.find((s) => s.active && s.tabs.some((t) => t.active && ids.includes(t.id)));
  const nextSpace = space && !tabs.some((t) => !ids.includes(t.id)) ? spaceBeside(space.id, allSpaces) : null;
  return { park: [], settle: ids, tabs: ids, ...(nextSpace ? { space: space.id, nextSpace: nextSpace.id } : {}) };
}

export function hideEntries(plan) {
  const settled = new Set(plan.settle ?? []);
  const tabs = plan.tabs?.length ? plan.tabs : [...settled];
  return tabs.map((tab) => ({
    id: `away:${tab}`, tab,
    ...(plan.nextSpace ? { space: plan.space, nextSpace: plan.nextSpace } : {}),
    settle: settled.has(tab) ? [tab] : [],
    park: tabs.length === 1 ? (plan.park ?? []) : [],
  }));
}

export function commandsOf(hide, { back = false, active = null, next = null } = {}) {
  const settle = hide?.settle ?? [], park = hide?.park ?? [];
  if (back) return [...settle.map((id) => ["tab.unsettle", { id }]), ...park.map((terminal) => ["terminal.keep", { terminal }]), ...(hide?.nextSpace ? [["space.select", { id: hide.space }]] : [])];
  const select = hide?.nextSpace ? [["space.select", { id: hide.nextSpace }]] : next && active && settle.includes(active) ? [["tab.select", { id: next }]] : [];
  return [...park.map((terminal) => ["terminal.park", { terminal }]), ...settle.map((id) => ["tab.settle", { id }]), ...select];
}

export const runCmds = (cmds) => { for (const [cmd, args] of cmds) run(cmd, args); };

export function rememberHide(list, entries) {
  const tabs = new Set(entries.map((e) => e.tab));
  return [...(list ?? []).filter((h) => !tabs.has(h.tab)), ...entries];
}
export function claimHide(list, tab, sleepId) {
  return (list ?? []).map((h) => (h.tab === tab && isAway(h.id) ? { ...h, id: sleepId } : h));
}

export function awayOf({ scope, tab, pane }, space, panes, project) {
  const tabs = scope === "project" ? (space?.tabs ?? []) : (space?.tabs ?? []).filter((t) => t.id === tab);
  const mine = (panes ?? []).filter((p) => tabs.some((t) => t.id === p.tab) && (scope !== "agent" || p.pane === pane));
  return {
    rows: tabs.map((t, i) => ({
      id: `away:${t.id}`, from: project,
      name: scope === "agent" ? (mine[0]?.name || "Agent") : (t.named ? t.name : `Tab ${i + 1}`),
      saved: Date.now(), space: space?.name ?? null, spaceId: space?.id ?? null,
      pending: true, state: "sleeping", going: true, stuck: null,
      agents: mine.filter((p) => p.tab === t.id).map((p, n) => ({
        name: p.name || "Agent", terminal: p.terminal ?? null, resume: null, spaceId: space?.id ?? null, at: n,
      })),
    })),
  };
}

export function awayLeft(away, tabs) {
  if (!tabs?.size) return away ?? null;
  const rows = (away?.rows ?? []).filter((r) => !tabs.has(tabOfAway(r.id)));
  return rows.length ? { rows } : null;
}

export function undoHide(hidden, away, id) {
  const hit = (hidden ?? []).filter((h) => h.id === id || h.tab === id);
  const tabs = new Set(hit.map((h) => h.tab));
  return { hit, hidden: (hidden ?? []).filter((h) => h.id !== id && !tabs.has(h.tab)), away: awayLeft(away, tabs) };
}

export function releaseHide(id, read, write) {
  const plan = undoHide(read("kanso.sleep.hidden"), read("kanso.sleep.away"), id);
  if (!plan.hit.length) return false;
  runCmds(plan.hit.flatMap((h) => commandsOf(h, { back: true })));
  write("kanso.sleep.hidden", plan.hidden);
  write("kanso.sleep.away", plan.away);
  return true;
}

export function wakeMidFlight(state) {
  if (state === "sleeping" || state === "stuck") return "cancel";
  if (state === "undoing") return "wait";
  return "wake";
}

// What a reload does with a row still in flight. A lease this window cannot see, not yet abandoned, is stuck.
export function onLoad(row, me, now, sees) {
  if (row.waking != null || !WORKING.includes(row.state)) return "leave";
  if (mayTake(row, me, now, sees)) return "resume";
  const quiet = now - (Number(row.pending_at) || 0);
  if (row.pending != null && quiet >= LEASE_MS && !sees && quiet < LONG_MS) return "stuck";
  return "leave";
}

const placeOf = (h, open, byTab) => {
  if (isAway(h.id)) {
    const row = byTab.get(h.tab);
    return row?.state === "sleeping" || row?.state === "stuck" ? "keep" : "reveal";
  }
  const row = open.get(h.id);
  return !row ? "restore" : row.state === "undoing" ? "reveal" : "keep";
};

export function settleOnLoad(hidden, rows) {
  const open = new Map((rows ?? []).filter((r) => r.state === "sleeping" || r.state === "undoing" || r.state === "stuck").map((r) => [r.id, r]));
  const byTab = new Map((rows ?? []).map((r) => [r.tab ?? r.into?.tabId ?? null, r]));
  const tagged = (hidden ?? []).map((h) => ({ h, place: placeOf(h, open, byTab) }));
  const of = (place) => tagged.filter((t) => t.place === place).map((t) => t.h);
  return { keep: of("keep"), reveal: of("reveal"), restore: of("restore") };
}

// --- Transitions: pure, a row and what was seen in, the next step out. ---

const wait = { write: null, act: null };
const stuck = (why) => ({ write: { step: "stuck", why }, act: null });
const busyWhy = (a, state) => (state === "working" ? `${a.name} is working` : state === "blocked" ? `${a.name} is waiting on you` : null);

// a: the agent ({ step, step_at, sent_at, pid, conversation, name }); seen: { alive (true, false, null: unknown),
// front (the terminal's foreground pid, null when unread), state, screen, record (its session record) }.
// write: what the row becomes (before act runs); act: "interrupt" (ctrl+c), "exit" (/exit), "enter".
export function leaveStep(a, seen, now) {
  if (a.step === "left") return wait;
  // Unknown is never gone: only a check that answered counts.
  if (seen.alive === false) return { write: { step: "left", why: null }, act: null };
  const since = now - (Number(a.step_at) || now);
  if (a.step === "requested") return { write: { step: "saving", step_at: now }, act: null };
  if (a.step === "saving") {
    if (seen.front == null) return since > SAVE_MS ? stuck(`${a.name}'s terminal could not be read`) : wait;
    if (seen.front !== a.pid) return stuck(`${a.name}'s terminal changed`);
    const busy = busyWhy(a, seen.state);
    if (busy) return stuck(busy);
    if (!seen.record) return since > SAVE_MS ? stuck(`${a.name}'s conversation was not found`) : wait;
    if (seen.record.sessionId !== a.conversation) return stuck(`${a.name} is on another conversation now`);
    return { write: { step: "clearing", step_at: now, program: "claude", ...(seen.title ? { title: seen.title } : {}), ...(seen.cwd ? { cwd: seen.cwd } : {}) }, act: "interrupt" };
  }
  if (a.step === "clearing") {
    if (seen.front != null && seen.front !== a.pid) return stuck(`${a.name}'s terminal changed`);
    // A draft would go out with /exit.
    if (promptEmpty(seen.screen)) return { write: { step: "exiting", step_at: now, sent_at: now }, act: "exit" };
    if (since <= CLEAR_MS) return wait;
    // Its ctrl+c may never have gone (a restart between the write and the key, or a key that failed): once more,
    // marked by nudged_at, then stuck.
    return a.nudged_at == null && seen.front === a.pid ? { write: { step: "clearing", step_at: now, nudged_at: now }, act: "interrupt" } : stuck(`${a.name}'s prompt could not be cleared`);
  }
  if (a.step === "exiting") {
    // Claude asks before leaving work in the background: sleeping it is stopping all of it.
    if (asksToExit(seen.screen) && seen.front === a.pid) return { write: null, act: "enter" };
    if (now - (Number(a.sent_at) || now) > EXIT_MS) return stuck(`${a.name} did not exit`);
    // Its /exit never arrived (a restart between the write and the send): sent again.
    if (seen.front === a.pid && promptEmpty(seen.screen) && since > RESEND_MS) return { write: { step: "exiting", step_at: now }, act: "exit" };
    return wait;
  }
  return wait;
}

// An undo: what left comes back on its conversation, what never left is let go as it runs.
// act: "return" (comeBack), "again" (a return a restart cut short: look before sending anything), "free".
export function undoStep(a, seen, now) {
  if (KEPT.includes(a.step)) return wait;
  const back = { write: { step: "returning", step_at: now }, act: "return" };
  if (a.step === "left") return back;
  if (a.step === "returning") return { write: { step: "returning", step_at: now }, act: "again" };
  if (seen.alive === false) return back;
  // An /exit went (sent_at stays through stuck and retry until the agent leaves): it may still go, so it is waited for.
  // Past the wait, one that can't be checked is looked at like one gone (comeBack: still in front, it stays asleep). One
  // running is let go only at its empty prompt, where no /exit waits; else it stays asleep, its terminal looked at first.
  if (a.sent_at != null) {
    if (a.step === "exiting" && now - (Number(a.sent_at) || now) <= EXIT_MS) return wait;
    if (seen.alive !== true) return back;
    return seen.front === a.pid && promptEmpty(seen.screen) ? { write: null, act: "free" } : { write: { step: "unsure" }, act: null };
  }
  return { write: null, act: "free" };
}

// The row's next move: { state, why } to change it, { agent } to move one agent (one at a time, in order),
// { close } once all left, { finish } once an undo is done, { watch } for a stuck row's agents.
export function sleepStep(row, agents) {
  if (row.state === "sleeping") {
    const held = agents.find((a) => a.step === "stuck");
    if (held) return { state: "stuck", why: held.why || `${held.name} could not leave` };
    const next = agents.find((a) => a.step !== "left");
    return next ? { agent: next } : { close: true };
  }
  if (row.state === "stuck") {
    const held = agents.filter((a) => a.step === "stuck");
    return held.length ? { watch: held } : { state: "sleeping", why: null };
  }
  if (row.state === "undoing") {
    const next = agents.find((a) => !KEPT.includes(a.step));
    return next ? { agent: next, undo: true } : { finish: true };
  }
  return {};
}

// Whether this window (`me`) may work on the row now. `sees`: its terminals are in this window.
export function mayTake(row, me, now, sees) {
  if (row.waking != null || !WORKING.includes(row.state)) return false;
  if (row.pending === me) return true;
  const quiet = now - (Number(row.pending_at) || 0);
  if (row.pending != null && quiet < LEASE_MS) return false;
  return sees || quiet >= LONG_MS;
}

// looked: [{ t, idle }] per terminal of the row; fresh: a pane opened in its tab since. A terminal running
// something you started there meanwhile is yours: it, and its tab, stay.
export function closePlan(looked, fresh) {
  const busy = looked.filter((x) => !x.idle).map((x) => x.t);
  const idle = looked.filter((x) => x.idle).map((x) => x.t);
  return { closeTab: !fresh && !busy.length, kill: idle, busy };
}
function closeWhy(plan, machine) {
  const busy = plan.busy.map((t) => seenAddress(t, machine));
  return busy.length ? `${busy.join(", ")} ${busy.length === 1 ? "runs" : "run"} something started there meanwhile and ${busy.length === 1 ? "stays" : "stay"} open.` : null;
}
function closingOf(row, machine, looked) {
  const known = [...new Set(terminalsOf(row))];
  const tab = parseOr(row.layout, { cols: [] }).tab ?? null;
  const seen = (id) => seenAddress(id, machine);
  const have = new Set(known.map(seen));
  const fresh = !tab || panes().some((p) => p.tab === seen(tab) && p.terminal && !have.has(p.terminal));
  const plan = closePlan(looked, fresh);
  return { plan, why: closeWhy(plan, machine), tab };
}

// The row's agents in the order of its panes, each with its pane (pid, terminal, wake, front...).
export function agentsOf(row) {
  const cols = parseOr(row.layout, { cols: [] })?.cols ?? [];
  const byId = new Map((row.agents ?? []).map((a) => [a.id, a]));
  return cols.flatMap((c) => c.panes ?? []).filter((p) => p.resume && byId.has(p.resume))
    .map((p) => ({ ...byId.get(p.resume), conversation: p.resume, pid: p.pid ?? null, terminal: p.terminal ?? null, name: byId.get(p.resume).name || p.name || "an agent", pane: p }));
}
export const terminalsOf = (row) => (parseOr(row.layout, { cols: [] })?.cols ?? []).flatMap((c) => c.panes ?? []).map((p) => p.terminal).filter(Boolean);

// --- Processes and terminals. ---

class Homes {
  constructor() { this.dirs = new Map(); }
  get(machine) { return this.dirs.get(machine); }
  put(machine, place) { this.dirs.set(machine, place); }
}
const homes = new Homes();
const hosted = (factory, machine) => serviceFor(factory, machine, CALL_MS, serviceOn);
// Home and system, from the service that already probed that computer.
export async function homePlace(machine) {
  if (!machine) return { home: home(), platform: null };
  const had = homes.get(machine);
  if (had) return had;
  const place = await hosted(async (platform, run) => ({ home: await systemApi(platform, run).userHome(), platform }), machine);
  if (place.home) homes.put(machine, place);
  return place;
}
export async function homeOf(machine) {
  return (await homePlace(machine)).home;
}
async function probeMachine(machine, pids) {
  const ids = [...new Set(pids.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
  return hosted(async (platform, run) => {
    const seen = await processApi(platform, run).look(ids);
    const had = homes.get(machine);
    if (seen.home && !(had?.home && had.platform)) homes.put(machine, { home: seen.home, platform });
    return seen;
  }, machine);
}
const sessionText = async (pid, machine) => {
  if (machine) {
    const record = (await probeMachine(machine, [pid])).found.get(Number(pid))?.record;
    if (!record) throw new Error("missing session");
    return JSON.stringify(record);
  }
  return readTextFile(paths.join(await homeOf(null), ".claude", "sessions", `${pid}.json`));
};

// true, false, or null when the check itself failed (a failed exec is no sighting of anything).
export const alive = async (pid, machine = null) => { if (!pid) return null; return (await hosted(processApi, machine)).exists(pid).catch(() => null); };

// The pid still on conversation `session`, matched by start time (a reused pid is not it); throws when it can't tell: never "none" for what it could not see.
export const runningOn = (session, machine = null) => hosted(processApi, machine).then(async (api) => api.runningSession(session, await homeOf(machine)));

// At its own shell's prompt: another shell in front (a script, say) counts as running.
export const atPrompt = (x) => Boolean(x) && (!x.foreground?.pid || x.foreground.pid === x.pid);

export async function procOf(pid, now = Date.now(), machine = null) {
  const proc = await (await hosted(processApi, machine)).identity(pid, now).catch(() => null);
  return proc ? { ...proc, comm: base(proc.comm) } : null;
}
// A pid given to another process since is not it: the start time must match.
export async function stillThere(pid, before, now = Date.now(), machine = null) {
  const p = await procOf(pid, now, machine);
  return p?.comm === "claude" && p.start <= before + 2000;
}

// A claude resuming `session` names it in its argv even before its session record exists;
// throws when a live terminal can't be read, never "none" for what it could not see.
export async function runningIn(session, machine = null) {
  const live = terminals().filter((k) => !(k.state && k.state !== "live") && localAddress(k.address, machine) != null);
  const k = await findAsync(live, async (t) => {
    const g = await hc(["get", t.address, "--json"]).catch(() => null);
    const x = tryOr(() => JSON.parse(g.stdout));
    if (!x) throw new Error(`${t.address} could not be read`);
    return (x.foreground?.argv ?? []).map(String).includes(session);
  });
  return k ? k.address : null;
}

// The record, not the arguments, proves it: a --resume process may be stuck before the conversation loads.
export function isResumed(fg, record, session) {
  return Boolean(fg?.pid && record && record.pid === fg.pid && record.sessionId === session);
}

// Its front pid, 0 at its prompt, null when it can't be read.
export async function frontOf(terminal) {
  const g = await hc(["get", terminal, "--json"]).catch(() => null);
  try { const x = JSON.parse(g.stdout); return atPrompt(x) ? 0 : x.foreground.pid; } catch { return null; }
}

// { pid } once a Claude is back on `session` and has stayed a moment: up to 30 s while nothing of it runs yet, and
// up to 90 s while a Claude on it is starting (a long conversation, many MCP servers take their time).
// saw(fg, mine) sees each front process meanwhile and answers the next `mine`.
export async function resumed(terminal, session, cx, saw = async (_fg, mine) => mine, machine = null) {
  const look = async ({ mine }, k) => {
    await cx.sleep(1000);
    const g = await hc(["get", terminal, "--json"]).catch(() => null);
    const fg = tryOr(() => JSON.parse(g.stdout).foreground ?? null); // null: not yet
    const seen = await saw(fg, mine);
    const starting = Boolean(fg?.pid) && !SHELLS.has(base(fg.argv?.[0])) && (fg.argv ?? []).map(String).includes(session);
    if (!fg?.pid || SHELLS.has(base(fg.argv?.[0]))) return { pid: null, mine: seen, stop: k >= 29 };
    const record = await tryOrAsync(async () => JSON.parse(await sessionText(fg.pid, machine))); // null: none
    return { pid: isResumed(fg, record, session) ? fg.pid : null, mine: seen, stop: k >= 29 && !starting };
  };
  return reduceSeries(range(90), (st, k) => (st.pid || st.stop ? st : look(st, k)), { pid: null, mine: null, stop: false });
}

// `only`: stop that pid alone; anything else running there now (it ended and you started something) is left, and counts as stopped.
export async function stopIn(terminal, cx, only = null, machine = null) {
  const front = async () => {
    const g = await hc(["get", terminal, "--json"]).catch(() => null);
    try { const x = JSON.parse(g.stdout); const fg = x.foreground; return !fg?.pid || fg.pid === x.pid || SHELLS.has(base(fg.argv?.[0])) ? 0 : fg.pid; } catch { return null; }
  };
  // One signal: true or false when that settles it, null to send the next.
  const signal = async (sig) => {
    const pid = await front();
    if (pid === 0 || (only && pid !== only && pid != null)) return true;
    if (pid == null) return false;
    await (await hosted(killApi, machine)).stop(pid, { force: sig === "-KILL" }).catch(() => null);
    return (await retry(10, async () => { await cx.sleep(300); return (await front()) === 0; })) ? true : null;
  };
  return (await reduceSeries(["-TERM", "-KILL"], async (got, sig) => (got === null ? signal(sig) : got), null)) === true;
}

// "back" when it is again on its conversation, "here" when the one that was to leave never did (so it is on it still),
// "out" when nothing of it runs, "unsure" when something it started could not be stopped.
// The terminal must be at its prompt right before the line goes, and only what that line started is ever stopped.
export async function comeBack(p, cx, onBack = () => {}, machine = null) {
  const line = (await hosted(openApi, machine)).terminalLine(p.cwd || await homeOf(machine), p.wake);
  const front = async () => {
    const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
    try { const x = JSON.parse(g.stdout); return { x, idle: atPrompt(x) }; } catch { return null; }
  };
  const f = await retry(20, async () => {
    const look = await front();
    if (!look?.idle) await cx.sleep(500);
    return look;
  }, { done: (look) => Boolean(look?.idle) });
  // Not at its prompt: the Claude that was to leave is still there (it never took /exit, or sits on its question), or
  // something else runs; only the first is "here", on its conversation as before.
  if (!f?.idle) return f?.x?.foreground?.pid === p.pid ? "here" : "out";
  await cx.sleep(800);
  // Started elsewhere meanwhile: never a second one here; what can't be checked is not started either.
  try { if ((await runningOn(p.resume, machine)) || (await runningIn(p.resume, machine))) return "out"; } catch { return "unsure"; }
  // The last look, right before the line goes.
  const last = await front();
  if (!last?.idle) return last?.x?.foreground?.pid === p.pid ? "here" : "out";
  const sentAt = Date.now();
  if ((await hc(["send", p.terminal, line]).catch(() => null))?.code !== 0) return "out";
  // mine: the first process seen there since, on this resume and started after the line went; only that one is ever stopped.
  const check = async (fg, mine) => {
    if (mine || !fg?.pid || !(fg.argv ?? []).map(String).includes(p.resume)) return mine;
    const proc = await procOf(fg.pid, Date.now(), machine);
    return proc?.comm === "claude" && proc.start >= sentAt - 2000 ? fg.pid : mine;
  };
  const { pid, mine: ours } = await resumed(p.terminal, p.resume, cx, check, machine);
  if (pid) { onBack(pid); return "back"; }
  // Not back: end only what it started; anything else there is yours and a wake looks at that terminal first.
  const now = await front();
  if (!now) return "unsure";
  if (now.idle) return "out";
  if (ours && now.x.foreground?.pid === ours) return (await stopIn(p.terminal, cx, ours, machine)) ? "out" : "unsure";
  return "unsure";
}

// A return a restart cut short: a claude already on the conversation in its terminal is waited for, nothing is sent again.
// The one that was to leave is "here", never "back", though its argv and record name the conversation too.
export async function returnAgain(p, cx, machine = null) {
  const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
  const fg = tryOr(() => JSON.parse(g.stdout).foreground ?? null);
  if (p.pid && fg?.pid === p.pid) return "here";
  if (!(fg?.argv ?? []).map(String).includes(p.resume)) return comeBack(p, cx, undefined, machine);
  const { pid } = await resumed(p.terminal, p.resume, cx, undefined, machine);
  return !pid ? "unsure" : pid === p.pid ? "here" : "back";
}

// --- The worker: one per sidebar. ---

async function termOf(address) {
  const g = await hc(["get", address, "--json"]).catch(() => null);
  const x = tryOr(() => (g?.code === 0 ? JSON.parse(g.stdout) : null));
  if (!x) return null;
  const fg = x.foreground ?? null;
  return { front: fg?.pid ?? 0, pid: fg?.pid ?? null, state: x.status?.state ?? null, title: x.title ?? null, cwd: fg?.cwd ?? null };
}
const screenOf = async (address) => {
  const shot = await hc(["read", address]).catch(() => null);
  return shot?.code === 0 ? shot.stdout : null;
};

// What one look at an agent's terminal shows; `screen` and `record` only when its step reads them.
async function see(a, machine = null) {
  const terminal = seenAddress(a.terminal, machine);
  const there = Boolean(a.terminal) && terminals().some((t) => t.address === terminal);
  const got = there ? await termOf(terminal) : null;
  const reads = ["clearing", "exiting"].includes(a.step) || a.sent_at != null;
  const record = got?.pid && a.step === "saving" ? await tryOrAsync(async () => JSON.parse(await sessionText(got.pid, machine))) : null;
  return { alive: await alive(a.pid, machine), front: got ? got.front : null, state: got?.state ?? null, screen: got && reads ? await screenOf(terminal) : null, record, title: got?.title ?? null, cwd: got?.cwd ?? null };
}

// A remote step is asked again only when the last look is stale or its timer is due. Exiting is never skipped.
export function lookDue(agent, now, look) {
  if (!agent || agent.step === "requested" || agent.step === "left" || KEPT.includes(agent.step)) return false;
  if (!look || look.step !== agent.step) return true;
  const since = now - (Number(agent.step_at) || now);
  if (agent.step === "saving") return since > SAVE_MS;
  if (agent.step === "clearing") return since > CLEAR_MS;
  return true;
}

const acts = (machine) => ({
  interrupt: (a) => hc(["keys", seenAddress(a.terminal, machine), "ctrl+c"]),
  exit: (a) => hc(["send", seenAddress(a.terminal, machine), "/exit"]),
  enter: (a) => hc(["keys", seenAddress(a.terminal, machine), "enter"]),
});

export class SleepWork {
  // kdb: the sidebar's database; changed(row): a row changed state (`row` as it is now when this window moved it), for the sidebar to read again.
  constructor(kdb, changed = () => {}, me = null, records = () => true, machine = null) {
    this.kdb = kdb;
    this.records = records;
    this.changed = changed;
    this.machine = machine || kdb?.machine || null;
    this.me = me || keptOwner();
    this.held = new Set();
    this.pending = new Set();
    this.running = false;
    this.kicked = 0;
    this.watchedAt = 0;
    this.rows = null;
    this.due = null;
    this.looks = new Map();
    this.seenKick = 0;
  }

  // Runs while there is work this window holds; started on load, on a kick from the dialog and with the sidebar's poll.
  start(cx) {
    this.kicked = Date.now();
    if (this.running) return;
    this.running = true;
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          // A kick while a look was under way is looked at again: its row may have come after the read.
          const at = this.kicked;
          const more = await this.tick(cx).catch(() => false);
          if (!more && this.kicked === at) break;
          await cx.sleep(TICK_MS);
        }
      } finally { this.running = false; this.held = new Set(); this.rows = null; this.due = null; this.looks = new Map(); }
    });
  }

  // The heartbeat, apart from the steps: a long one (an agent coming back takes up to two minutes) keeps its rows.
  async beat(now = Date.now()) {
    await mapSeries([...this.held], (id) => this.kdb.holdWork(id, this.me, now).catch(() => null));
  }

  // True while this window holds a row; rows held elsewhere are left to their owner until its heartbeat stops.
  async tick(cx, now = Date.now()) {
    if (this.machine) return this.tickFar(cx, now);
    return this.tickNear(cx, now);
  }

  async tickNear(cx, now = Date.now()) {
    const first = await this.kdb.sleeps();
    const watching = now - this.watchedAt >= 5000 ? first.filter((r) => r.state === "stuck") : [];
    if (watching.length) this.watchedAt = now;
    const moved = (await mapSeries(watching, (r) => this.watch(r))).some(Boolean);
    const rows = moved ? await this.kdb.sleeps() : first;
    const live = new Set(terminals().map((t) => t.address));
    const seesOf = (r) => terminalsOf(r).some((t) => live.has(seenAddress(t, this.machine)));
    const stranded = rows.filter((r) => onLoad(r, this.me, now, seesOf(r)) === "stuck");
    if (stranded.length) {
      await Promise.all(stranded.map(async (r) => {
        const why = r.why || "The sleep stopped";
        if ((await this.kdb.holdWork(r.id, this.me, now)) && (await this.kdb.setWorkState(r.id, this.me, r.state, "stuck", why, now, this.fact(r.id, "stuck", why)))) this.changed({ ...r, state: "stuck", why });
      }));
    }
    const skip = new Set(stranded.map((r) => r.id));
    const open = rows.filter((r) => !skip.has(r.id) && mayTake(r, this.me, now, seesOf(r)));
    const held = (await mapSeries(open, async (r) => ((await this.kdb.holdWork(r.id, this.me, now)) ? r : null))).filter(Boolean);
    this.held = new Set(held.map((r) => r.id));
    await Promise.all(held.map((r) => this.advance(r, cx).catch(() => null)));
    return held.length > 0;
  }

  fact(id, state, why) { return this.records() ? sleepEvent(id, state, why) : null; }

  // A stuck agent that went on its own (you ended it there) has left; the sleep then goes on.
  // True when the row goes on.
  async watch(row) {
    const plan = sleepStep(row, agentsOf(row));
    const gone = (await mapSeries(plan.watch ?? [], async (a) => ((await alive(a.pid, this.machine)) === false ? a : null))).filter(Boolean);
    const went = plan.state ? [await this.kdb.unstick(row.id).catch(() => false)] : await mapSeries(gone, (a) => this.kdb.unstick(row.id, a.conversation).catch(() => false));
    if (went.some(Boolean)) this.changed();
    return went.some(Boolean);
  }

  async advance(row, cx) {
    const now = Date.now();
    const agents = agentsOf(row);
    const plan = sleepStep(row, agents);
    if (plan.state) {
      if (await this.kdb.setWorkState(row.id, this.me, row.state, plan.state, plan.why ?? null, now, this.fact(row.id, plan.state, plan.why))) this.changed({ ...row, state: plan.state, why: plan.why ?? null });
      return;
    }
    if (plan.close) return this.close(row);
    if (plan.finish) return this.finish(row, agents);
    if (!plan.agent) return;
    const a = plan.agent;
    const seen = await see(a, this.machine);
    const next = plan.undo ? undoStep(a, seen, now) : leaveStep(a, seen, now);
    const returning = ["return", "again"].includes(next.act);
    const key = JSON.stringify([row.id, a.conversation, returning ? "return" : next.act]);
    if (next.act && this.pending.has(key)) return;
    // Written before it acts, and only while this window holds the row in the state it was read in: else nothing is done.
    if (next.write && !(await this.kdb.stepAgent(row.id, this.me, row.state, a.conversation, a.step, next.write))) return;
    // An act with nothing to write (Enter on Claude's question) goes only while this window holds the row in the state it read.
    if (next.act && !next.write && !(await this.kdb.stillMine(row.id, this.me, row.state))) return;
    if (next.act === "free") { await this.kdb.freeAgent(row.id, this.me, a.conversation); return; }
    if (next.act) this.startAct(key, cx, (cx) => returning
      ? this.returnAgent(row, a, next.act === "again", cx) : acts(this.machine)[next.act](a));
  }

  startAct(key, cx, act) {
    this.pending.add(key);
    cx.spawn(async (cx) => {
      try { await act(cx); } catch {} finally { this.pending.delete(key); this.rows = null; }
    });
  }

  async returnAgent(row, a, again, cx) {
    const p = { ...a.pane, terminal: seenAddress(a.terminal, this.machine), resume: a.conversation, pid: a.pid };
    const how = !p.wake ? "out" : await (again ? returnAgain(p, cx, this.machine) : comeBack(p, cx, () => {}, this.machine)).catch(() => "unsure");
    // An original process told to exit may still leave after the undo.
    const kept = how === "here" && a.sent_at != null ? "unsure" : how;
    if (kept === "back" || kept === "here") await this.kdb.freeAgent(row.id, this.me, a.conversation);
    else await this.kdb.stepAgent(row.id, this.me, row.state, a.conversation, "returning", { step: kept });
  }

  async lookIdle(row) {
    const layout = parseOr(row.layout, { cols: [] });
    const known = [...new Set(terminalsOf(row))];
    const fronts = new Map((layout.cols ?? []).flatMap((c) => c.panes ?? []).map((p) => [p.terminal, p.front ?? null]));
    return mapSeries(known, async (t) => {
      const address = seenAddress(t, this.machine);
      const now = terminals().some((k) => k.address === address) ? await frontOf(address) : 0;
      return { t, idle: now === 0 || (now != null && now === fronts.get(t)) };
    });
  }
  endTab(plan, tab) {
    const seen = (id) => seenAddress(id, this.machine);
    const open = new Set(panes().map((p) => p.terminal));
    if (plan.closeTab) run("tab.close", { id: seen(tab), confirmed: true });
    for (const t of plan.kill) {
      const address = seen(t);
      if (!plan.closeTab || !open.has(address)) run("terminal.kill", { terminal: address });
    }
  }
  // Every agent left: what slept is ended so it can't run twice, then the row is asleep.
  async close(row) {
    const looked = await this.lookIdle(row);
    const { plan, why, tab } = closingOf(row, this.machine, looked);
    // Held still, and still sleeping (an undo meanwhile keeps the tab), right before anything closes.
    if (!(await this.kdb.stillMine(row.id, this.me, "sleeping"))) return;
    this.endTab(plan, tab);
    if (await this.kdb.finishSleep(row.id, this.me, why, Date.now(), this.fact(row.id, "asleep", why))) this.changed();
  }

  liveIds() { return terminals().map((t) => localAddress(t.address, this.machine)).filter(Boolean); }
  logLimits() { return this.records() ? LOG_LIMITS : null; }
  take(rows) {
    this.rows = rows;
    this.held = new Set(rows.filter((r) => r.pending === this.me && WORKING.includes(r.state)).map((r) => r.id));
  }
  stuckAgents() {
    return (this.rows ?? []).filter((r) => r.state === "stuck").flatMap((row) => (sleepStep(row, agentsOf(row)).watch ?? []).map((agent) => ({ row, agent })));
  }
  async tickFar(cx, now) {
    if (this.kicked !== this.seenKick) {
      this.seenKick = this.kicked;
      this.rows = null;
      this.due = null;
      this.looks = new Map();
    }
    if (this.due) return this.playDue();
    if (!this.rows) {
      this.take(await this.kdb.openWork(this.me, now, this.liveIds(), { log: this.logLimits(), longMs: LONG_MS }));
      if (this.held.size > 0) return true;
    }
    const stuck = this.stuckAgents();
    if (!this.held.size && stuck.length && now - this.watchedAt >= 5000) return this.watchFar(stuck, now);
    const job = this.job(now);
    if (!job || job.kind === "skip") return this.renew(now);
    if (job.kind === "state") return this.writeState(job, now);
    if (job.kind === "finish") return this.finishFar(job);
    if (job.kind === "close") return this.closeFar(job);
    return this.observe(job, cx, now);
  }
  // The key waits a tick: the write showed this window owns the row, and the lease covers the gap.
  async playDue() {
    const due = this.due;
    this.due = null;
    await acts(this.machine)[due.act](due.agent).catch(() => null);
    const look = this.looks.get(due.key);
    if (look) this.looks = new Map([...this.looks, [due.key, { ...look, sent: true }]]);
    return true;
  }
  rowJob(row, now) {
    const agents = agentsOf(row);
    const plan = sleepStep(row, agents);
    if (plan.state) return { kind: "state", row, plan };
    if (plan.finish) return { kind: "finish", row, agents };
    if (plan.close) return { kind: "close", row };
    if (!plan.agent) return null;
    const agent = plan.agent;
    const key = `${row.id}:${agent.conversation}`;
    const blind = Boolean(plan.undo) && agent.step === "left";
    const waiting = !blind && (this.pending.has(JSON.stringify([row.id, agent.conversation, "return"])) || !lookDue(agent, now, this.looks.get(key)));
    return waiting ? { kind: "skip", row } : { kind: "agent", row, agent, agents, undo: Boolean(plan.undo), key };
  }
  job(now) {
    const marked = (this.rows ?? []).filter((row) => this.held.has(row.id)).map((row) => this.rowJob(row, now)).filter(Boolean);
    return marked.find((item) => item.kind !== "skip") ?? marked[0] ?? null;
  }
  async renew(now) {
    const due = (this.rows ?? []).filter((r) => this.held.has(r.id) && now - Number(r.pending_at) > LEASE_MS - TICK_MS * 2);
    if (!due.length) return this.held.size > 0;
    this.take((await this.kdb.stage(due.map((r) => this.kdb.holdSql(r.id, this.me, now)))).rows);
    return this.held.size > 0;
  }
  async writeState(job, now) {
    const { row, plan } = job;
    const { wrote, rows } = await this.kdb.stage([this.kdb.stateSql(row.id, this.me, row.state, plan.state, plan.why ?? null, now, this.fact(row.id, plan.state, plan.why))]);
    this.take(rows);
    if (wrote[0]?.length) this.changed({ ...row, state: plan.state, why: plan.why ?? null });
    return this.held.size > 0;
  }
  async finishFar(job) {
    const { row, agents } = job;
    const kept = agents.filter((a) => KEPT.includes(a.step)).map((a) => ({ ...a.pane, ...(a.step === "unsure" ? { check: a.terminal } : {}) }));
    const layout = kept.length ? { ...parseOr(row.layout, {}), cols: [{ w: 1, panes: kept }] } : null;
    const { wrote, rows } = await this.kdb.stage([this.kdb.endSql(row.id, this.me, layout)]);
    this.take(rows);
    if (wrote[0]?.length) this.changed();
    return this.held.size > 0;
  }
  async closeFar(job) {
    const looked = await this.lookIdle(job.row);
    const { plan, why, tab } = closingOf(job.row, this.machine, looked);
    if (!(await this.kdb.finishSleep(job.row.id, this.me, why, Date.now(), this.fact(job.row.id, "asleep", why)))) return this.held.size > 0;
    this.endTab(plan, tab);
    this.changed();
    this.take((this.rows ?? []).filter((r) => r.id !== job.row.id));
    return this.held.size > 0;
  }
  async watchFar(stuck, now) {
    this.watchedAt = now;
    const probed = await probeMachine(this.machine, stuck.map((x) => x.agent.pid)).catch(() => null);
    if (!probed) return false;
    const gone = stuck.filter((x) => probed.found.get(Number(x.agent.pid))?.alive === false);
    if (!gone.length) return false;
    const texts = gone.flatMap((x) => [this.kdb.unstickSql(x.row.id, x.agent.conversation, now), this.kdb.holdSql(x.row.id, this.me, now)]);
    const { wrote, rows } = await this.kdb.stage(texts);
    this.take(rows);
    if (wrote.some((part) => part.length)) this.changed();
    return this.held.size > 0;
  }
  async seenNow(agent, probed, key) {
    const item = probed.found.get(Number(agent.pid));
    const prior = this.looks.get(key);
    const address = seenAddress(agent.terminal, this.machine);
    const there = Boolean(agent.terminal) && terminals().some((t) => t.address === address);
    const dying = item?.alive === false;
    const front = prior?.front ?? null;
    const got = !dying && front == null && there ? await termOf(address) : null;
    const wantScreen = !dying && (["clearing", "exiting"].includes(agent.step) || agent.sent_at != null || prior?.sent);
    const screen = wantScreen && there ? await screenOf(address) : null;
    return { alive: item ? item.alive : null, front: got ? got.front : front, state: got?.state ?? null, screen, record: item?.record ?? null, title: got?.title ?? null, cwd: got?.cwd ?? null };
  }
  async observe(job, cx, now) {
    const { row, agent, agents, undo, key } = job;
    if (undo && agent.step === "left") return this.bringBack(job, cx, now);
    const probed = await probeMachine(this.machine, [agent.pid]).catch(() => null);
    if (!probed) {
      await this.kdb.holdWork(row.id, this.me, now).catch(() => null);
      return this.held.size > 0;
    }
    const seen = await this.seenNow(agent, probed, key);
    const next = undo ? undoStep(agent, seen, now) : leaveStep(agent, seen, now);
    const last = !undo && next.write?.step === "left" && row.state === "sleeping" && agents.every((a) => a.conversation === agent.conversation || a.step === "left");
    const looked = last ? await this.lookIdle(row) : null;
    const closed = last ? closingOf(row, this.machine, looked) : null;
    this.looks.set(key, { step: agent.step, front: seen.front ?? null, sent: false });
    const extra = closed
      ? this.kdb.leaveSql(row.id, this.me, agent.conversation, agent.step, closed.why, now, this.fact(row.id, "asleep", closed.why))
      : next.write
        ? this.kdb.stepSql(row.id, this.me, row.state, agent.conversation, agent.step, next.write)
        : next.act === "free"
          ? this.kdb.freeSql(row.id, this.me, agent.conversation)
          : next.act
            ? this.kdb.stillSql(row.id, this.me, row.state, now)
            : null;
    const { wrote, rows } = await this.kdb.stage([this.kdb.holdSql(row.id, this.me, now), ...(extra ? [extra] : [])]);
    this.take(rows);
    const wroteIt = !extra || Boolean(wrote[1]?.length);
    if (closed && wroteIt) { this.endTab(closed.plan, closed.tab); this.changed(); }
    if (!wroteIt) this.looks.delete(key);
    if (closed || !wroteIt || next.act === "free" || !next.act) return this.held.size > 0;
    if (next.act === "return" || next.act === "again") {
      const actKey = JSON.stringify([row.id, agent.conversation, "return"]);
      if (!this.pending.has(actKey)) this.startAct(actKey, cx, (task) => this.returnAgent(row, agent, next.act === "again", task));
      return true;
    }
    this.due = { act: next.act, agent, key };
    return true;
  }
  async bringBack(job, cx, now) {
    const { row, agent } = job;
    const next = undoStep(agent, { alive: null, front: null, screen: null, record: null }, now);
    const { wrote, rows } = await this.kdb.stage([
      this.kdb.holdSql(row.id, this.me, now),
      this.kdb.stepSql(row.id, this.me, row.state, agent.conversation, agent.step, next.write),
    ]);
    this.take(rows);
    if (!wrote[1]?.length) return this.held.size > 0;
    const actKey = JSON.stringify([row.id, agent.conversation, "return"]);
    if (next.act && !this.pending.has(actKey)) this.startAct(actKey, cx, (task) => this.returnAgent(row, agent, next.act === "again", task));
    return true;
  }

  // An undo is done: what came back is awake, what did not stays asleep (one unsure with its terminal looked at first).
  async finish(row, agents) {
    const kept = agents.filter((a) => KEPT.includes(a.step)).map((a) => ({ ...a.pane, ...(a.step === "unsure" ? { check: a.terminal } : {}) }));
    const layout = { ...parseOr(row.layout, {}), cols: kept.length ? [{ w: 1, panes: kept }] : [] };
    if (await this.kdb.endUndo(row.id, this.me, kept.length ? layout : null)) this.changed();
  }
}
