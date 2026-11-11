import { paths } from "./platform-paths.js";
// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Props: sleep { scope: "agent" | "tab" | "project", space, tab, pane }, wake { id } or { from, name }, wakeAll { from, space }.
// Asleep is a status of an agent in the left nav's database (the sidebar owns it); shared "kanso.asleep" is a copy of what it read.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile } from "herdr";
import { Store, idle, done, shownOf } from "./store.js";
import { spaceFor, inPlace } from "./kdb.js";
import { listKey, moveTo } from "./listkeys.js";
import { base, tilde, captureTab, commandOf, describe, programOf, projectOf, folderOfKey, openTab, openInto } from "./tabkit.js";
import { resumeArgv, isClaude } from "./resume.js";
import { runningOn, runningIn, stillThere, procOf, atPrompt, resumed, hidePlan, hideEntries, commandsOf, runCmds, rememberHide, claimHide, awayOf, awayLeft, releaseHide, wakeMidFlight, isAway } from "./sleepwork.js";
import { retry, tryOr, tryOrAsync, mapSeries, reduceSeries } from "./pure.js";
import { skeleton, breathe } from "./ui.js";

const ARM_MS = 4000;

const settled = async (fn) => {
  try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; }
};
// settled(fn) plus `told`: the arguments of its first tell(...) (it may tell, then throw), null when it never told.
const telling = (fn) => new Promise((done) => {
  const told = new Promise((tell) => {
    done(settled(() => fn((...args) => tell(args))).then(async (end) => { tell(null); return { ...end, told: await told }; }));
  });
});

export function wakeArgv(p) {
  if (!p.argv) return null;
  if (!p.resume || !isClaude(p.argv)) return p.argv;
  return p.wake ?? resumeArgv(p.argv, p.resume);
}
export const wakeable = (a) => ({ ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ argv: wakeArgv(p), cwd: p.cwd, resume: p.resume ?? null, name: p.name ?? null })) })) });
export const sleepers = (a) => a.cols.flatMap((c) => c.panes).map((p) => p.name || programOf(p.argv)).join(", ");

export function sleepBlocker(recs) {
  const r = [...recs].map(([, x]) => x).find((x) => x?.status?.state === "working" || x?.status?.state === "blocked");
  return r ? `${r.labels?.["kanso.name"] || r.title || r.address} is ${r.status.state === "working" ? "working" : "waiting on you"}` : null;
}

const shapeOf = (list) => JSON.stringify(list.map((r) => [r.tab.id, r.capture.cols.flatMap((c) => c.panes).map((p) => [p.terminal ?? null, p.pid ?? null, p.resume ?? null, p.argv])]));
export const sameTabs = (a, b) => shapeOf(a) === shapeOf(b);

export function freeName(name, taken) {
  const from = (n, k) => (taken.has(n) ? from(`${name} ${k}`, k + 1) : n);
  return from(name, 2);
}

// A pane the strip has not placed yet would be left running when the tab closes.
export function coversTab(capture, terminals) {
  const got = capture.cols.flatMap((c) => c.panes).map((p) => p.terminal);
  return got.length === terminals.length && new Set(got).size === got.length && terminals.every((t) => got.includes(t));
}
export const colsOf = (list) => [{ w: 1, panes: list }];

export const stateOf = (r) => (r.state === "stuck" ? `Stuck: ${r.why || "an agent could not leave"}` : r.state === "undoing" ? "Coming back" : r.state === "sleeping" ? "Going to sleep" : "Asleep");

const since = (ms) => { const d = new Date(ms); return new Date().toDateString() === d.toDateString() ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };

export default class Sleep extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.view = "list";
    this.asleep = null;
    this.armed = null;
    this.busy = null;
    this.error = null;
    const ask = props() ?? {};
    this.space = spaces().find((s) => s.id === ask.sleep?.space) ?? spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    if (ask.sleep) this.startSleep(cx, ask.sleep.scope === "project", ask.sleep.tab, ask.sleep.scope === "agent" ? ask.sleep.pane : null);
    // What is on its way or stuck, while the list shows.
    cx.timer.every(3000, (cx) => {
      if (this.view === "list" && this.work?.length && !this.busy) cx.spawn(async (cx) => { await this.refresh().catch(() => {}); cx.notify(); });
    });
    cx.spawn(async (cx) => {
      try { await this.refresh(true); }
      catch (e) { this.asleep = []; this.error = String(e?.message ?? e); cx.notify(); return; }
      const pool = [...(this.asleep ?? []), ...(this.work ?? [])];
      const waking = ask.wakeAll ? pool.filter((a) => inPlace(a, ask.wakeAll, spaces(), home()))
        : ask.wake ? pool.filter((a) => (ask.wake.id ? a.id === ask.wake.id : a.from === ask.wake.from && a.name === ask.wake.name)) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // A read overtaken by a newer "kanso.asleep.at" stamp (here or the sidebar's) is not published.
  async refresh(strict = false) {
    const started = Date.now();
    const read = await settled(() => this.store.asleep(true));
    if (!read.ok) { if (strict) throw read.error; return; }
    const all = read.value;
    // The list shows what can wake now; the sidebar also what is on its way.
    this.asleep = all.filter((a) => idle(a, started));
    // On its way, stuck or coming back: the sidebar has it.
    this.work = all.filter((a) => !done(a));
    if ((shared("kanso.asleep.at") ?? 0) > started) return;
    setShared("kanso.asleep.at", started);
    setShared("kanso.asleep", all.map((a) => shownOf(a, started)));
  }

  // Each Claude agent's conversation is its session record, ~/.claude/sessions/<pid>.json.
  async readTab(tab) {
    const tabPanes = panes().filter((p) => p.tab === tab.id && p.terminal && (!this.onlyPane || p.pane === this.onlyPane));
    // [record] per terminal, or null when it can't be read: reported below.
    const read = await Promise.all(tabPanes.map(async (p) => {
      const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
      return { p, got: r?.code === 0 ? tryOr(() => [JSON.parse(r.stdout)]) : null };
    }));
    const recs = new Map(read.flatMap(({ p, got }) => (got ? [[p.terminal, got[0]]] : [])));
    const unread = read.filter(({ p }) => !recs.has(p.terminal)).map(({ p }) => `${p.terminal} could not be read`);
    const claudes = [...recs].filter(([, r]) => { const fg = r.foreground; return fg?.pid && isClaude(fg.argv); });
    const agents = await mapSeries(claudes, async ([term, r]) => {
      const fg = r.foreground;
      const ses = await tryOrAsync(async () => JSON.parse(await readTextFile(paths.join(home(), ".claude", "sessions", `${fg.pid}.json`)))); // null: reported below
      // It sleeps under the name the sidebar shows it by.
      const who = shared("kanso.names")?.[term] || r.labels?.["kanso.name"] || ses?.name || r.title || term;
      const again = ses?.sessionId ? resumeArgv(fg.argv, ses.sessionId) : null;
      const problem = !ses?.sessionId || ses.pid !== fg.pid ? `${who}'s conversation was not found, so it could not wake on it`
        : !again ? `${who} was started with options a wake can't carry over` : null;
      // given: the name you gave it; it goes back on wake.
      return { problem, entry: [term, { resume: ses?.sessionId ?? null, name: who, given: r.labels?.["kanso.name"] || null, pid: fg.pid, terminal: term, wake: again }] };
    });
    const byAgent = new Map(agents.map((g) => g.entry));
    const extra = new Map([...byAgent, ...tabPanes.filter((p) => !byAgent.has(p.terminal)).map((p) => [p.terminal, { terminal: p.terminal }])]);
    const capture = this.onlyPane
      ? { per: null, cols: tabPanes.map((p) => ({ w: 1, panes: [{ argv: commandOf(recs.get(p.terminal)), cwd: recs.get(p.terminal)?.foreground?.cwd || p.cwd || null, ...(extra.get(p.terminal) ?? {}) }] })) }
      : captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra);
    // The first thing that stops it, in this order.
    const error = [
      this.space?.machine ? "Sleep works on this computer's agents for now" : null,
      ...unread,
      ...agents.map((g) => g.problem),
      this.onlyPane && !capture.cols[0]?.panes[0]?.pid ? "only a Claude agent can sleep on its own; this pane runs something else" : null,
      !this.onlyPane && !coversTab(capture, tabPanes.map((p) => p.terminal)) ? "a pane of it is still being placed; try again in a moment" : null,
    ].find((e) => e != null) ?? null;
    // What ran in front of each terminal at the read: after the sleep, only that process (still there) is this sleep's to end.
    const fronts = new Map([...recs].map(([t, x]) => [t, atPrompt(x) ? 0 : x?.foreground?.pid ?? null]));
    return { tab, capture, fronts, blocker: sleepBlocker(recs), error };
  }

  async readTabs(tabs) {
    const all = this.space?.tabs ?? [];
    const read = await Promise.all(tabs.map((t) => this.readTab(t)));
    return read.map((r) => ({ ...r, name: this.onlyPane ? (r.capture.cols[0]?.panes[0]?.name ?? "Agent") : r.tab.named ? r.tab.name : `Tab ${all.indexOf(r.tab) + 1}` }))
      .filter((r) => r.capture.cols.length);
  }

  // The tab or pane leaves in this turn. The read and the write happen after, and a failure puts it back.
  conceal(scope, tabId, paneId) {
    if (this.hidden) return;
    const space = this.space;
    const mine = panes().filter((p) => (space?.tabs ?? []).some((t) => t.id === p.tab));
    const order = { scope, tab: tabId ?? null, pane: paneId ?? null };
    const plan = hidePlan(order, mine, space?.tabs ?? []);
    if (!plan.settle.length && !plan.park.length) return;
    this.hidden = plan;
    const tabs = space?.tabs ?? [];
    const active = tabs.find((t) => t.active)?.id ?? null;
    const next = tabs.find((t) => !plan.settle.includes(t.id))?.id ?? null;
    runCmds(commandsOf(plan, { active, next }));
    setShared("kanso.sleep.hidden", rememberHide(shared("kanso.sleep.hidden"), hideEntries(plan)));
    setShared("kanso.sleep.away", awayOf(order, space, mine, projectOf(space)));
  }

  clearAway(tabs, hidden) {
    setShared("kanso.sleep.hidden", hidden);
    setShared("kanso.sleep.away", awayLeft(shared("kanso.sleep.away"), tabs));
  }

  reveal() {
    if (!this.hidden) return;
    runCmds(commandsOf(this.hidden, { back: true }));
    const tabs = new Set(this.hidden.tabs ?? []);
    this.clearAway(tabs, (shared("kanso.sleep.hidden") ?? []).filter((h) => !tabs.has(h.tab)));
    this.hidden = null;
  }

  // Writes that landed stay hidden. Only the tabs still waiting on a row come back.
  revealLeft() {
    const hidden = shared("kanso.sleep.hidden") ?? [];
    const left = hidden.filter((h) => isAway(h.id));
    if (left.length) {
      runCmds(left.flatMap((h) => commandsOf(h, { back: true })));
      const tabs = new Set(left.map((h) => h.tab));
      this.clearAway(tabs, hidden.filter((h) => !tabs.has(h.tab)));
    }
    this.hidden = null;
  }

  startSleep(cx, whole = false, tabId = null, pane = null) {
    const all = this.space?.tabs ?? [];
    const tabs = whole ? all : all.filter((t) => (tabId ? t.id === tabId : t.active));
    this.view = "sleep"; this.whole = whole; this.onlyPane = pane; this.sleepers = null; this.error = null; this.sleepTabs = tabs;
    if (!whole) this.conceal(pane ? "agent" : "tab", tabs[0]?.id ?? tabId, pane);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.sleepers = await this.readTabs(tabs);
        const blocked = !this.sleepers.length || this.sleepers.some((r) => r.blocker || r.error);
        if (!whole && blocked) this.reveal();
        else if (!whole) this.sleep(cx);
      } catch (e) {
        this.reveal();
        this.error = String(e?.message ?? e);
      } finally { cx.notify(); }
    });
  }

  // The read at the press may be old. A stored order closes this dialog; a blocker or a failed write leaves it open.
  sleep(cx) {
    const shown = this.sleepers;
    if (this.view !== "sleep" || this.busy || this.ordering || !shown?.length || shown.some((r) => r.blocker || r.error)) return;
    if (this.whole) this.conceal("project");
    const project = projectOf(this.space);
    this.ordering = true; this.busy = null; this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      this.leave = false;
      try {
        const list = await this.readTabs(this.sleepTabs ?? []);
        const stop = list.find((r) => r.blocker || r.error);
        if (stop || !sameTabs(shown, list)) {
          this.reveal();
          this.sleepers = list; this.view = "sleep";
          this.error = stop ? `It can't sleep now: ${stop.blocker || stop.error}.` : "The tabs changed since this opened; here they are as they are now.";
          return;
        }
        const was = await settled(async () => new Set((await this.store.asleep(true)).filter((a) => a.from === project).map((a) => a.name)));
        if (!was.ok) { this.reveal(); this.view = "sleep"; this.error = String(was.error?.message ?? was.error); return; }
        // Each tab under a name no other tab asleep in the project has (nor one before it here).
        const named = list.reduce(({ out, taken }, r) => {
          const name = freeName(r.name, taken);
          return { out: [...out, { ...r, name }], taken: new Set([...taken, name]) };
        }, { out: [], taken: was.value }).out;
        // A tab that can't be written stops the ones after it; those written go on.
        const out = await reduceSeries(named, async (acc, r) => {
          if (acc.error) return acc;
          const w = await settled(() => this.store.sleep(project, this.intentOf(r)));
          if (!w.ok) return { ...acc, error: w.error };
          setShared("kanso.sleep.hidden", claimHide(shared("kanso.sleep.hidden"), r.tab.id, w.value));
          return { ...acc, ids: [...acc.ids, w.value] };
        }, { ids: [], error: null });
        if (out.error && out.ids.length) this.revealLeft();
        else if (out.error) this.reveal();
        if (out.ids.length) setShared("kanso.sleep.kick", Date.now());
        await this.refresh();
        this.error = out.error ? `${out.ids.length ? "The rest" : "It"} can't sleep: ${String(out.error?.message ?? out.error)}.` : null;
        this.leave = out.ids.length > 0 && !out.error;
        if (!this.leave) this.view = "sleep";
      } catch (e) {
        this.reveal();
        this.view = "sleep";
        this.error = String(e?.message ?? e);
      } finally { this.ordering = false; cx.notify(); }
      if (this.leave) closeOverlay(props()?.overlay);
    });
  }

  // What the sidebar needs to put a tab to sleep: each pane as read, and what ran in front of it then
  // (after the sleep, only that process, still there, is the sleep's to end).
  intentOf(r) {
    const cap = r.capture;
    const kept = (p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, wake: p.wake ?? null, name: p.name ?? null, given: p.given ?? null, terminal: p.terminal ?? null,
      tab: r.tab.id, front: r.fronts?.get(p.terminal) ?? null, ...(p.pid ? { pid: p.pid } : {}) });
    return { name: r.name, space: this.space ? { id: this.space.id, name: this.space.name } : null, per: cap.per, saved: Date.now(), tab: r.tab.id,
      cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map(kept) })),
      ...(this.onlyPane ? { into: { tab: r.tab.named ? r.tab.name : null, tabId: r.tab.id } } : {}) };
  }

  // Retry or undo a sleep the sidebar holds as stuck (undo also stops one on its way).
  act(cx, id, how) {
    if (how === "undo" && releaseHide(id, shared, setShared)) {
      const left = new Set((shared("kanso.sleep.hidden") ?? []).map((h) => h.tab));
      if (this.hidden && (this.hidden.tabs ?? []).every((t) => !left.has(t))) this.hidden = null;
    }
    cx.spawn(async (cx) => {
      const r = await settled(() => (how === "retry" ? this.store.retry(id) : this.store.undo(id)));
      this.error = !r.ok ? String(r.error?.message ?? r.error) : !r.value ? "It moved on meanwhile; here it is as it is now." : null;
      if (r.ok && r.value) setShared("kanso.sleep.kick", Date.now());
      await this.refresh();
      cx.notify();
    });
  }

  // Only checked agents stop being asleep; what did not prove it back is ended, so nothing runs twice.
  // `claim` hands back the row as it is now: an old list never opens what another window changed. `rest`: more to wake after it.
  wake(shown, cx, rest = []) {
    const how = wakeMidFlight(shown?.state);
    if (how === "cancel") { this.act(cx, shown.id, "undo"); return; }
    if (how === "wait") return;
    if (this.busy) return;
    this.busy = `Waking ${shown.name}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const claimed = await settled(() => this.store.claim(shown.id));
      if (!claimed.ok) { this.busy = null; this.error = `${shown.name} could not be woken: ${String(claimed.error?.message ?? claimed.error)}`; cx.notify(); return; }
      const a = claimed.value;
      if (!a) {
        await this.refresh();
        this.busy = null; this.error = `${shown.name} is waking in another window, or is no longer asleep.`; cx.notify(); return;
      }
      await this.refresh(); // the sidebar shows it waking
      // A sleep that stopped half way left its row pending: an agent that never left may still run in p.check.
      const mayRun = async (p) => {
        if (!p.check) return [];
        const gone = !terminals().some((t) => t.address === p.check);
        const g = gone ? null : await hc(["get", p.check, "--json"]).catch(() => null);
        const x = tryOr(() => (g?.code === 0 ? JSON.parse(g.stdout) : null)); // null: below
        const idleShell = atPrompt(x);
        return !gone && !idleShell ? [`${p.name ?? "an agent"} may still run in ${p.check}`] : [];
      };
      // Already running anywhere (brought back by a stopped sleep, or by hand): never a second one.
      const runsAlready = async (p) => {
        const look = await settled(async () => {
          const pid = await runningOn(p.resume);
          return { pid, term: pid ? null : await runningIn(p.resume) };
        });
        if (!look.ok) return [`whether ${p.name ?? "an agent"} already runs could not be checked (${String(look.error?.message ?? look.error)})`];
        const { pid, term } = look.value;
        return [...(pid ? [`${p.name ?? "an agent"} already runs on its conversation (pid ${pid})`] : []),
          ...(term ? [`${p.name ?? "an agent"} is starting on its conversation in ${term}`] : [])];
      };
      // An older sleep's row kept no conversation: match its old pid by program and start time.
      const stillRuns = async (p) => (a.pending && p.pid && (await stillThere(p.pid, a.saved)) ? [`${p.name ?? "an agent"} still runs (pid ${p.pid})`] : []);
      const still = (await mapSeries(a.cols.flatMap((c) => c.panes), async (p) => [...(await mayRun(p)), ...(p.resume ? await runsAlready(p) : await stillRuns(p))])).flat();
      if (still.length) {
        await this.store.release(a.id, a.token).catch(() => {});
        await this.refresh();
        this.busy = null; this.error = `${a.name} can't wake yet: ${still.join("; ")}. End ${still.length === 1 ? "it" : "them"} there, then wake.`; cx.notify(); return;
      }
      // From here this wake holds the row: whatever stops it lets the row go.
      const woke = await settled(() => this.wakeHeld(a, cx));
      if (!woke.ok) {
        await this.store.release(a.id, a.token).catch(() => {});
        await this.refresh();
        this.busy = null; this.error = `${a.name} could not be woken: ${String(woke.error?.message ?? woke.error)}`; this.view = "list"; cx.notify(); return;
      }
      if (!woke.value) return;
      if (rest.length) { this.wake(rest[0], cx, rest.slice(1)); return; }
      closeOverlay(props()?.overlay);
    });
  }

  // If another window took the row meanwhile, what this wake opened ends: nothing runs twice.
  async wakeHeld(a, cx) {
    const startedAt = Date.now();
    // replacing: this wake makes the space in place of a gone one.
    const where = async () => {
      const first = spaceFor({ spaceId: a.spaceId, spaceName: a.space, project: a.from }, spaces(), home());
      if (first || !a.spaceId) return { space: first, replacing: false };
      // One window at a time makes the replacement; a wake that waits takes the one made.
      const made = async () => { const to = await this.store.kdb.replacement(a.spaceId); return to ? spaces().find((w) => w.id === to) ?? null : null; };
      const found = await made();
      if (found) return { space: found, replacing: false };
      if (!(await this.store.kdb.replacing(a.spaceId, a.token))) {
        const waited = await retry(30, async () => { await cx.sleep(500); return made(); });
        if (!waited) throw new Error("another window is making its space; wake it again in a moment");
        return { space: waited, replacing: false };
      }
      // Made by another between the look and the hold: that one, not a second.
      const late = await made();
      if (late) { await this.store.kdb.unreplacing(a.spaceId, a.token).catch(() => {}); return { space: late, replacing: false }; }
      return { space: null, replacing: true };
    };
    const { space, replacing } = await where();
    const folder = folderOfKey(a.from), machine = String(a.from).slice(0, String(a.from).indexOf(":")) || undefined;
    const create = space ? null : { name: a.space || base(folder) || "~", folder, key: a.from, ...(machine ? { machine } : {}) };
    const intoTab = a.into && space ? (space.tabs ?? []).find((x) => x.id === a.into.tabId) ?? (a.into.tab ? (space.tabs ?? []).find((x) => x.name === a.into.tab) : null) : null;
    // Renew the hold last, so it still holds when the pane opens; the first throw stops the whole opening.
    const ahead = (lost) => async (p) => {
      const pid = p?.resume ? await runningOn(p.resume) : null;
      if (pid) throw new Error(`${p.name ?? "an agent"} already runs on its conversation (pid ${pid})`);
      const term = p?.resume ? await runningIn(p.resume) : null;
      if (term) throw new Error(`${p.name ?? "an agent"} is starting on its conversation in ${term}`);
      if (!(await this.store.renew(a.id, a.token))) { lost(); throw new Error("another window woke it meanwhile"); }
    };
    const opening = await telling(async (lost) => {
      if (intoTab) {
        this.busy = `${a.name}: back into ${intoTab.name || "its tab"}`; cx.notify();
        const p = wakeable(a).cols[0].panes[0];
        await ahead(lost)(p);
        return [[await openInto(p, cx, intoTab.id)]];
      }
      return openTab({ ...wakeable(a), name: a.into?.tab || a.name }, cx, { space, create, before: ahead(lost), progress: (t) => { this.busy = `${a.name}: ${t}`; cx.notify(); } });
    });
    const failure = opening.ok ? null : opening.error;
    const ids = opening.ok ? opening.value : opening.error?.opened ?? [];
    // The hold, lost to another window while it opened.
    const lostOpening = Boolean(opening.told);
    // Asked of Herdr and not shown (yet): it may still open, so the row is held until a wake can see whether it did.
    const late = Number(failure?.pending) || 0;
    const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ p, pane: ids[ci]?.[ri] ?? null })));
    const termOf = (pane) => (pane ? panes().find((q) => q.pane === pane)?.terminal ?? null : null);
    const tabOf = flat.map((x) => x.pane && panes().find((q) => q.pane === x.pane)?.tab).find(Boolean);
    const nowIn = space?.id ?? (tabOf ? spaces().find((w) => (w.tabs ?? []).some((tb) => tb.id === tabOf))?.id ?? null : null);
    // Its space was gone and one was made for it: what else slept there wakes there too.
    if (replacing) await (nowIn && !lostOpening ? this.store.kdb.moveSpace(a.spaceId, nowIn, a.token) : this.store.kdb.unreplacing(a.spaceId, a.token)).catch(() => {});
    // owner: what this wake started per terminal; only that, or a terminal back at its prompt, is ever ended by it.
    const endIfOurs = async (owner, term, p) => {
      const g = await hc(["get", term, "--json"]).catch(() => null);
      const got = tryOr(() => [JSON.parse(g.stdout)]);
      if (!got) return false;
      const [x] = got;
      const fg = x.foreground;
      const mine = atPrompt(x) || (owner.has(term) && fg.pid === owner.get(term))
        || (!p?.resume && !owner.has(term) && JSON.stringify(fg?.argv ?? null) === JSON.stringify(wakeArgv(p)) && ((await procOf(fg.pid))?.start ?? 0) >= startedAt - 2000);
      if (mine) run("terminal.kill", { terminal: term });
      return mine;
    };
    // lost: the hold, renewed before each check, was lost; kept: terminals left open, not this wake's to end.
    const checked = await reduceSeries(flat, async (st, { p, pane }) => {
      const term = termOf(pane);
      if (!term) return { ...st, missed: [...st.missed, p] };
      if (!p.resume) return st;
      this.busy = `Checking ${p.name ?? "an agent"} is on its conversation`; cx.notify();
      const lost = st.lost || !(await this.store.renew(a.id, a.token).catch(() => true));
      // The first claude seen there on this conversation since the wake began is this wake's, unless one was already there.
      const saw = async (fg, mine) => {
        if (st.owner.has(term) || mine || !fg?.pid || !(fg.argv ?? []).map(String).includes(p.resume)) return mine;
        const proc = await procOf(fg.pid);
        return proc?.comm === "claude" && proc.start >= startedAt - 2000 ? fg.pid : mine;
      };
      const seen = await resumed(term, p.resume, cx, saw);
      const back = seen.pid, ours = back || seen.mine || st.owner.get(term);
      const owner = ours ? new Map([...st.owner, [term, ours]]) : st.owner;
      if (back) {
        // The name you gave it goes back on its new terminal, where names live.
        const given = (a.agents ?? []).find((g) => g.id === p.resume)?.name;
        const named = !given || (await retry(3, async () => (await hc(["label", term, `kanso.name=${given}`]).catch(() => null))?.code === 0));
        // Not put back yet: kept with its conversation; the sidebar puts it back when it can.
        return named ? { ...st, owner, lost } : { ...st, owner, lost, unnamed: [...st.unnamed, given], restores: [...st.restores, [p.resume, given]] };
      }
      // Not ended (unreadable, or not this wake's to end): it stays asleep with that terminal looked at first.
      const ended = await endIfOurs(owner, term, p);
      return { ...st, owner, lost, kept: ended ? st.kept : [...st.kept, term], missed: [...st.missed, ended ? p : { ...p, checkNow: term }] };
    }, { owner: new Map(), lost: lostOpening, missed: [], unnamed: [], restores: [], kept: [] });
    const { owner, lost, missed, unnamed, restores } = checked;
    const opened = flat.some((x) => x.pane);
    const endOpened = async () => (await mapSeries(flat, async ({ p, pane }) => {
      const term = termOf(pane);
      return term && !(await endIfOurs(owner, term, p)) ? [term] : [];
    })).flat();
    // Never awake and still claimable at once: what this wake started ends if the write can't land.
    const missedNow = missed.map(({ check, checkNow, ...p }) => (checkNow ? { ...p, check: checkNow } : p));
    const write = () => (!opened && !late ? this.store.release(a.id, a.token)
      : missed.length ? this.store.narrow(a.id, colsOf(missedNow), a.token, { space: nowIn, restores, wait: late > 0 })
      : this.store.woke(a.id, a.token, restores));
    const saved = lost ? { held: false, error: null } : await retry(4, async () => {
      const w = await settled(write);
      if (w.ok) return { done: true, held: w.value, error: null };
      const error = String(w.error?.message ?? w.error);
      await cx.sleep(1000);
      return { done: false, held: true, error };
    }, { done: (v) => v.done });
    const held = saved.held;
    const endedNow = (!held && opened) || (saved.error && opened) ? await endOpened() : [];
    const saveError = !held && opened ? "another window woke it meanwhile; what this one opened was ended"
      : saved.error && opened ? `${saved.error}; what it opened was ended, so it wakes from here again in 10 minutes`
      : saved.error;
    const kept = [...checked.kept, ...endedNow];
    await this.refresh();
    this.busy = null;
    if (failure || missed.length || saveError || (unnamed.length && held)) {
      const why = (failure ? `Stopped: ${String(failure?.message ?? failure)}. ` : "") + (saveError ? `${a.name} could not be updated (${saveError}). ` : "")
        + (unnamed.length && held ? `${unnamed.join(", ")} woke, but ${unnamed.length === 1 ? "its name" : "their names"} could not be put back on ${unnamed.length === 1 ? "its terminal" : "their terminals"}; the sidebar keeps trying. ` : "");
      this.error = why + (missed.length && held ? `${missed.map((p) => p.name || programOf(p.argv)).join(", ")} did not come back; ${missed.length === 1 ? "it stays" : "they stay"} asleep.` : "")
        + (kept.length ? ` ${[...new Set(kept)].join(", ")} ${kept.length === 1 ? "runs" : "run"} something this wake did not start and ${kept.length === 1 ? "is" : "are"} left open.` : "")
        + (late && held ? ` Herdr had not opened ${late === 1 ? "one of them" : `${late} of them`} yet and may still: ${a.name} can be woken again in 10 minutes, and a wake then never starts a conversation that runs.` : "");
      this.view = "list"; cx.notify(); return false;
    }
    return true;
  }

  arm(key, cx, act) {
    if (this.armed === key && Date.now() - this.armedAt <= ARM_MS) { this.armed = null; act(cx); return; }
    this.armed = key; this.armedAt = Date.now(); cx.notify();
    cx.timer.after(ARM_MS + 50, (cx) => { if (this.armed === key) { this.armed = null; cx.notify(); } });
  }

  listed(e) {
    const { move, gAt } = listKey(e, this.listG);
    this.listG = gAt;
    return move;
  }

  sleepBones(t) {
    const { line } = skeleton({ border: t.border });
    return breathe(v_flex().id("kanso-skeleton").w_full().pt(14).gap(10))
      .children([0, 1, 2].map((i) => h_flex().w_full().gap(10).items_center().child(line([140, 110, 160][i], 12)).child(div().flex_1()).child(line(80, 11))));
  }

  asleepBones(t) {
    const { block, line } = skeleton({ border: t.border });
    return breathe(v_flex().id("kanso-skeleton").w_full().gap(2))
      .children([0, 1, 2, 3].map((i) => h_flex().w_full().px(10).py(8).gap(10).items_center()
        .child(block(15, 15, 4))
        .child(v_flex().flex_1().gap(2).child(line([130, 100, 150, 90][i], 13)).child(line([170, 140, 110, 160][i], 11)))));
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const project = this.space?.name ?? tilde(this.space?.folder);
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .child(text);
    const head = (title, sub) => v_flex().gap(4)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child(sub));
    const note = (text, tone) => div().pt(10).text_size(11.5).line_height(1.45).text_color(tone ?? t.dim).child(text);
    const shell = v_flex().id("kanso-sleep").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const move = this.view === "list" ? this.listed(e) : (e.key === "escape" ? "escape" : null);
        if (!move) return;
        if (move !== "escape") {
          const order = this.order ?? [];
          if (move === "enter") { if (!this.busy && order[this.at ?? 0]) this.wake(order[this.at ?? 0], cx); }
          else if (move !== "pending") this.at = moveTo(move, this.at ?? 0, order.length);
          cx.stop_propagation(); cx.notify(); return;
        }
        if (this.busy) { cx.stop_propagation(); return; }
        if (this.view === "sleep" && (props()?.sleep == null)) { this.view = "list"; this.error = null; cx.notify(); }
        else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

    if (this.view === "sleep") {
      const list = this.sleepers ?? [];
      const whole = this.whole, alone = Boolean(this.onlyPane);
      const panesOf = (r) => r.capture.cols.flatMap((c) => c.panes);
      const others = [...new Set(list.flatMap(panesOf).filter((q) => !q.pid && q.argv).map((q) => programOf(q.argv)))];
      const stop = list.find((r) => r.blocker || r.error);
      const line = (q, i) => h_flex().id(`sl-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.pid ? t.foreground : t.muted).child(q.pid ? q.name : describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(q.pid ? "keeps its conversation" : tilde(q.cwd)));
      // Each pane's id counts the panes before it, across the tabs.
      const starts = list.map((_, k) => list.slice(0, k).reduce((s, r) => s + panesOf(r).length, 0));
      const ready = list.length > 0 && !stop && !this.busy && !this.ordering;
      return shell
        .child(head(whole ? `Sleep ${project}` : alone ? "Sleep this agent" : "Sleep this tab",
          whole ? "Every tab's agents exit and the tabs close. Wake opens them again, each agent on its conversation."
          : alone ? "It exits and its pane closes; the rest of the tab stays. Wake opens it again in that tab, on its conversation."
          : "Its agents exit and the tab closes. Wake opens it again, each agent on its conversation."))
        .when(this.sleepers === null, (el) => el.child(this.sleepBones(t)))
        .children(list.map((r, k) => v_flex().pt(14).gap(4)
          .when(whole, (el) => el.child(div().pb(3).text_size(11.5).text_color(t.dim).child(r.name)))
          .children(panesOf(r).map((q, j) => line(q, starts[k] + j)))))
        .when(this.sleepers !== null && !list.length, (el) => el.child(note("Nothing runs here to put to sleep.")))
        .when(others.length > 0, (el) => el.child(note(`${others.join(", ")} will stop now and start fresh on wake.`)))
        .when(Boolean(stop) && !this.error, (el) => el.child(note(`It can't sleep now: ${stop?.blocker || stop?.error}.`, t.blocked)))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("sl-back", "Cancel", false, !this.busy, () => closeOverlay(p.overlay)))
          .when(whole || Boolean(stop) || Boolean(this.error), (el) => el.child(button("sl-go", whole ? `Sleep ${list.length} ${list.length === 1 ? "tab" : "tabs"}` : "Sleep", true, ready, (cx) => this.sleep(cx)))));
    }

    const link = (id, text, act) => div().id(id).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.opacity(0.8)).on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(text);
    const work = this.work ?? [];
    const workRow = (a, i) => h_flex().id(`zw-${i}`).w_full().px(10).py(8).gap(10).items_center()
      .child(svg("mods/kanso-chrome/icons/moon.svg").size(15).flex_none().text_color(a.state === "stuck" ? t.blocked : t.muted))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).text_color(t.foreground).child(a.name))
        .child(div().truncate().text_size(11.5).text_color(a.state === "stuck" ? t.blocked : t.dim).child(stateOf(a))))
      .when(a.state === "stuck" || a.state === "sleeping", (el) => el.child(link(`zw-undo-${i}`, "Undo", (cx) => this.act(cx, a.id, "undo"))))
      .when(a.state === "stuck", (el) => el.child(link(`zw-retry-${i}`, "Retry", (cx) => this.act(cx, a.id, "retry"))));
    const asleep = this.asleep ?? [];
    const groups = [...new Set(asleep.map((a) => a.from))].map((from) => [from, asleep.filter((a) => a.from === from)]);
    this.order = groups.flatMap(([, tabs]) => tabs);
    const atId = this.order[Math.min(this.at ?? 0, Math.max(0, this.order.length - 1))]?.id;
    const spaceName = (from, list) => spaces().find((sp) => projectOf(sp) === from)?.name ?? list[0]?.space ?? (base(folderOfKey(from)) || "~");
    const label = (text) => div().pt(12).pb(4).px(10).text_size(11.5).text_color(t.dim).child(text);
    const row = (a) => {
      const id = `${a.from}:${a.name}`, key = `forget:${id}`, armed = this.armed === key;
      return h_flex().id(`zz-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(a.id === atId, (el) => el.bg(t.selected))
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.wake(a, cx)))
        .child(svg("mods/kanso-chrome/icons/moon.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`since ${since(a.saved)}`)))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(sleepers(a))))
        .when(!this.busy, (el) => el.child(div().id(`zz-wake-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.foreground)
          .hover((s) => s.opacity(0.8)).on_click((_e, cx) => { cx.stop_propagation(); this.wake(a, cx); }).child("Wake")))
        .when(!this.busy, (el) => el.child(div().id(`zz-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => cx.spawn(async (cx) => { try { await this.store.forget(a.id); } catch (e) { this.error = String(e?.message ?? e); } await this.refresh(); cx.notify(); })); })
          .child(armed ? "Press again to forget it" : "Forget")));
    };
    return shell
      .child(head("Asleep", "Tabs put to sleep, each agent's conversation kept. Wake opens one again in its project."))
      // A column that never shrinks: past max_h 420 the list scrolls.
      .child(v_flex().id("zz-list").pt(10).max_h(420).overflow_y_scrollbar().child(v_flex().flex_none().w_full().gap(2)
        .when(this.asleep === null, (el) => el.child(this.asleepBones(t)))
        .when(work.length > 0, (el) => el.child(label("Not asleep yet")).children(work.map(workRow)))
        .when(this.asleep !== null && !asleep.length && !work.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("Nothing is asleep."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Put a tab you are waiting on to sleep: its agents stop holding memory, and wake on their conversations when you need them."))))
        .children(groups.map(([from, tabs]) => v_flex().gap(2)
          .child(h_flex().items_center().child(div().flex_1().child(label(spaceName(from, tabs))))
            .when(tabs.length > 1 && !this.busy, (el) => el.child(div().id(`zz-all-${from}`).px(10).pt(8).text_size(11.5).text_color(t.foreground).cursor_pointer()
              .hover((s) => s.opacity(0.8)).on_click((_e, cx) => this.wake(tabs[0], cx, tabs.slice(1))).child(`Wake all ${tabs.length}`))))
          .children(tabs.map(row))))))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("zz-close", "Close", false, !this.busy, () => closeOverlay(p.overlay)))
        .child(button("zz-sleep", "Sleep this tab", true, !this.busy && Boolean(this.space), (cx) => this.startSleep(cx))));
  }
}
