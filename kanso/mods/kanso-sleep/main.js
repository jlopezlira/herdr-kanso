// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A tab, or every tab of a project, put away for later: each Claude agent's
// conversation is kept, the agents leave with /exit and the tabs close, so
// nothing of them runs or holds memory. Wake opens them again in their
// project, each agent back on its own conversation (`claude --resume`).
// Other programs in a tab stop, and start fresh on wake.
//
// Careful with your agents: the tabs are read again when you press Sleep;
// each agent's prompt is cleared before /exit and its process must be gone
// before its tab closes; if one won't leave, the ones that left come back
// on their conversations and the tab stays. A wake is held by one window at
// a time and checks every agent is back on its conversation before the tab
// stops being asleep; what did not come back stays asleep.
//
// Opened from the sidebar's menus, a pane header's moon, or on its own (the
// list of what sleeps). Props: `sleep` { scope: "tab" | "project", space,
// tab }, `wake` { from, name }, `wakeAll` (a project key). The tabs live in
// data/kanso-sleep/sleep.db (store.js); shared "kanso.asleep" tells the
// sidebar what sleeps.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile, exec } from "herdr";
import { Store, idle } from "./store.js";
import { base, tilde, shq, SHELLS, captureTab, describe, programOf, projectOf, folderOfKey, openTab } from "./tabkit.js";

const ARM_MS = 4000;

// The command that resumes `session` the way argv ran Claude Code, or null
// when it can't: only options known to carry over are kept; the first
// prompt and session options (--continue, --fork-session) are left out, so
// a wake neither repeats the task it started with nor forks the conversation.
const KEEP_VALUE = new Set(["--model", "--permission-mode", "--settings", "--agent", "--effort", "--fallback-model", "--append-system-prompt", "--system-prompt", "--plugin-dir", "--setting-sources", "--name"]);
// Options that take one value or more (Claude Code reads every word after
// them up to the next option), so the words after them are theirs, not a prompt.
const KEEP_MANY = new Set(["--add-dir", "--mcp-config", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools"]);
const KEEP_FLAG = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose", "--chrome", "--no-chrome", "--ide", "--strict-mcp-config", "--brief", "--debug"]);
const DROP_VALUE = new Set(["--resume", "-r", "--session-id"]);
const DROP_FLAG = new Set(["--continue", "-c", "--fork-session"]);
export function resumeArgv(argv, session) {
  if (!Array.isArray(argv) || !argv.length || base(argv[0]) !== "claude" || !session) return null;
  const keep = [];
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (!a.startsWith("-")) break; // the first prompt, and anything after it
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (KEEP_FLAG.has(flag) && eq < 0) keep.push(a);
    else if (KEEP_MANY.has(flag)) {
      if (eq > 0) { keep.push(a); continue; }
      const vals = [];
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")) vals.push(String(argv[++i]));
      if (!vals.length) return null;
      keep.push(a, ...vals);
    }
    else if (KEEP_VALUE.has(flag)) { if (eq > 0) keep.push(a); else if (i + 1 < argv.length) keep.push(a, String(argv[++i])); else return null; }
    else if (DROP_VALUE.has(flag)) { if (eq < 0) i++; }
    else if (DROP_FLAG.has(flag)) { /* left out */ }
    else return null;
  }
  return [argv[0], ...keep, "--resume", session];
}

// What waking a pane runs: a Claude agent back on its conversation (the
// command saved when it slept, else rebuilt); any other program as it was.
export function wakeArgv(p) {
  if (!p.argv) return null;
  if (!p.resume || base(p.argv[0]) !== "claude") return p.argv;
  return p.wake ?? resumeArgv(p.argv, p.resume);
}
export const wakeable = (a) => ({ ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ argv: wakeArgv(p), cwd: p.cwd })) })) });
// A sleeping tab's agents by the names they go by, the other panes by program.
export const sleepers = (a) => a.cols.flatMap((c) => c.panes).map((p) => p.name || programOf(p.argv)).join(", ");

// Why a tab can't sleep now: its agents at work or waiting on you.
export function sleepBlocker(recs) {
  for (const [, r] of recs) {
    const st = r?.status?.state;
    if (st === "working" || st === "blocked") return `${r.labels?.["kanso.name"] || r.title || r.address} is ${st === "working" ? "working" : "waiting on you"}`;
  }
  return null;
}

// The same tabs, panes and agents as when the sleep view opened.
const shapeOf = (list) => JSON.stringify(list.map((r) => [r.tab.id, r.capture.cols.flatMap((c) => c.panes).map((p) => [p.terminal ?? null, p.pid ?? null, p.resume ?? null, p.argv])]));
export const sameTabs = (a, b) => shapeOf(a) === shapeOf(b);

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

// A name not taken yet: "shield", else "shield 2", "shield 3"...
export function freeName(name, taken) {
  let n = name, k = 2;
  while (taken.has(n)) n = `${name} ${k++}`;
  return n;
}

// Back on its conversation: the agent's own session record says so (the
// one Sleep read it from). Its arguments alone prove nothing: a process
// started with --resume may still be stuck before the conversation loads.
export function isResumed(fg, record, session) {
  return Boolean(fg?.pid && record && record.pid === fg.pid && record.sessionId === session);
}

// Every terminal pane of the tab in the capture, once: a pane the strip has
// not placed yet would be left running when the tab closes.
export function coversTab(capture, terminals) {
  const got = capture.cols.flatMap((c) => c.panes).map((p) => p.terminal);
  return got.length === terminals.length && new Set(got).size === got.length && terminals.every((t) => got.includes(t));
}
// A wake's panes as columns again (those it keeps asleep).
export const colsOf = (list) => [{ w: 1, panes: list }];

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
    this.name = InputState.new({ placeholder: "Name" });
    this.name.on("submit", (_e, cx) => this.sleep(cx));
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    const ask = props() ?? {};
    this.space = spaces().find((s) => s.id === ask.sleep?.space) ?? spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    if (ask.sleep) this.startSleep(cx, ask.sleep.scope === "project", ask.sleep.tab);
    cx.spawn(async (cx) => {
      try { await this.refresh(true); }
      catch (e) { this.asleep = []; this.error = String(e?.message ?? e); cx.notify(); return; }
      const waking = ask.wakeAll ? this.asleep.filter((a) => a.from === ask.wakeAll)
        : ask.wake ? this.asleep.filter((a) => a.from === ask.wake.from && a.name === ask.wake.name) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // What sleeps, read again, for this list and for the sidebar (shared
  // "kanso.asleep"). A read that a newer publication ("kanso.asleep.at",
  // stamped with when its read started, here and in the sidebar) overtook
  // is not published. `strict`: a failed read throws; else it is let be.
  async refresh(strict = false) {
    const started = Date.now();
    let list;
    try { list = await this.store.asleep(); } catch (e) { if (strict) throw e; return; }
    this.asleep = list;
    if ((shared("kanso.asleep.at") ?? 0) > started) return;
    setShared("kanso.asleep.at", started);
    setShared("kanso.asleep", list.filter((a) => idle(a)).map((a) => ({ from: a.from, name: a.name, saved: a.saved, who: sleepers(a), space: a.space ?? null })));
  }

  // A tab as it runs, each Claude agent with its conversation (its session
  // record, ~/.claude/sessions/<pid>.json) and the command that resumes it:
  // { tab, capture, blocker, error }. Anything it can't read stops it.
  async readTab(tab) {
    const tabPanes = panes().filter((p) => p.tab === tab.id && p.terminal);
    const recs = new Map(), extra = new Map();
    let error = this.space?.machine ? "Sleep works on this computer's agents for now" : null;
    await Promise.all(tabPanes.map(async (p) => {
      const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
      try { if (r?.code === 0) recs.set(p.terminal, JSON.parse(r.stdout)); } catch { /* reported below */ }
      if (!recs.has(p.terminal)) error ??= `${p.terminal} could not be read`;
    }));
    for (const [term, r] of recs) {
      const fg = r.foreground;
      if (!fg?.pid || base(fg.argv?.[0]) !== "claude") continue;
      let ses = null;
      try { ses = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`)); } catch { /* reported below */ }
      const who = ses?.name || r.labels?.["kanso.name"] || r.title || term;
      const again = ses?.sessionId ? resumeArgv(fg.argv, ses.sessionId) : null;
      if (!ses?.sessionId || ses.pid !== fg.pid) error ??= `${who}'s conversation was not found, so it could not wake on it`;
      else if (!again) error ??= `${who} was started with options a wake can't carry over`;
      extra.set(term, { resume: ses?.sessionId ?? null, name: who, pid: fg.pid, terminal: term, wake: again });
    }
    for (const p of tabPanes) if (!extra.has(p.terminal)) extra.set(p.terminal, { terminal: p.terminal });
    const capture = captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra);
    if (!coversTab(capture, tabPanes.map((p) => p.terminal))) error ??= "a pane of it is still being placed; try again in a moment";
    return { tab, capture, blocker: sleepBlocker(recs), error };
  }

  async readTabs(tabs) {
    const all = this.space?.tabs ?? [];
    const read = await Promise.all(tabs.map((t) => this.readTab(t)));
    read.forEach((r) => { r.name = r.tab.named ? r.tab.name : `Tab ${all.indexOf(r.tab) + 1}`; });
    return read.filter((r) => r.capture.cols.length);
  }

  // The sleep view, for one tab (the one you are on by default) or (`whole`)
  // every tab of the project; each tab sleeps under its own name.
  startSleep(cx, whole = false, tabId = null) {
    const all = this.space?.tabs ?? [];
    const tabs = whole ? all : all.filter((t) => (tabId ? t.id === tabId : t.active));
    this.view = "sleep"; this.whole = whole; this.sleepers = null; this.error = null; this.sleepTabs = tabs;
    const tab = tabs[0];
    this.name.set_value(tab?.named ? tab.name : `Tab ${all.indexOf(tab) + 1}`);
    cx.notify();
    cx.spawn(async (cx) => { this.sleepers = await this.readTabs(tabs); cx.notify(); });
  }

  // Read again at the press (what the view showed may be old), saved as
  // going to sleep, then each agent leaves; its tab closes once all have.
  // If one won't leave, the ones that left come back and the tab stays.
  sleep(cx) {
    const shown = this.sleepers;
    if (this.view !== "sleep" || this.busy || !shown?.length || shown.some((r) => r.blocker || r.error)) return;
    const typed = this.whole ? null : this.name.value().trim();
    if (!this.whole && !typed) return;
    const project = projectOf(this.space);
    this.busy = "Reading the tabs again"; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const list = await this.readTabs(this.sleepTabs ?? []);
      const stop = list.find((r) => r.blocker || r.error);
      if (stop || !sameTabs(shown, list)) {
        this.sleepers = list; this.busy = null;
        this.error = stop ? `It can't sleep now: ${stop.blocker || stop.error}.` : "The tabs changed since this opened; here they are as they are now.";
        cx.notify();
        return;
      }
      if (!this.whole) list[0].name = typed;
      let taken;
      try { taken = new Set((await this.store.asleep(true)).filter((a) => a.from === project).map((a) => a.name)); }
      catch (e) { this.busy = null; this.error = String(e?.message ?? e); cx.notify(); return; }
      for (const r of list) { r.name = freeName(r.name, taken); taken.add(r.name); }
      const stayed = [], notes = [];
      for (const r of list) {
        const cap = r.capture;
        const agents = cap.cols.flatMap((c) => c.panes).filter((p) => p.pid);
        const kept = (p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, wake: p.wake ?? null, name: p.name ?? null, ...(p.pid ? { pid: p.pid } : {}) });
        const entry = { name: r.name, space: this.space?.name ?? null, per: cap.per, saved: Date.now(),
          cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map(kept) })) };
        const left = [], sent = [];
        let id = null;
        try {
          id = await this.store.sleep(project, entry);
          for (const [i, p] of agents.entries()) {
            this.busy = `${p.name} is leaving, ${i + 1} of ${agents.length} in ${r.name}`; cx.notify();
            await this.leave(p, cx, () => sent.push(p));
            left.push(p);
          }
        } catch (e) {
          // Only what this sleep wrote is undone. An agent that did not come
          // back stays asleep (its conversation kept); one whose terminal
          // could not be checked stays asleep with that terminal to check
          // again before it wakes, so it never runs twice. One that took
          // /exit but was slow to go is waited for, then comes back too.
          this.busy = "Bringing the agents back"; cx.notify();
          for (const p of sent) if (!left.includes(p) && (await this.gone(p.pid, cx, 30))) left.push(p);
          const lost = [], unsure = [];
          for (const p of left) {
            const how = await this.comeBack(p, cx);
            if (how === "out") lost.push(p);
            else if (how === "unsure") unsure.push(p);
          }
          if (id) {
            const missing = [...lost.map(kept), ...unsure.map((p) => ({ ...kept(p), check: p.terminal }))];
            await (missing.length ? this.store.narrow(id, colsOf(missing)) : this.store.drop(id)).catch(() => {});
            await this.refresh();
          }
          this.busy = null;
          const names = (list) => list.map((p) => p.name).join(", ");
          this.error = `Stopped: ${String(e?.message ?? e)}. ${r.name} stays open`
            + (!left.length ? "" : !lost.length && !unsure.length ? "; the agents that had left are back on their conversations" : "")
            + (lost.length ? `; ${names(lost)} did not come back and ${lost.length === 1 ? "stays" : "stay"} asleep, to wake from here` : "")
            + (unsure.length ? `; ${names(unsure)} could not be checked or stopped and ${unsure.length === 1 ? "stays" : "stay"} asleep; a wake looks at ${unsure.length === 1 ? "its" : "their"} terminal first` : "") + ".";
          this.view = lost.length || unsure.length ? "list" : this.view;
          cx.notify();
          return;
        }
        // Every agent has left: the tab is asleep, whatever comes next.
        let note = null;
        try { await this.store.settle(id); } catch (e) { note = `${r.name} is asleep but could not be marked so (${String(e?.message ?? e)}); it shows to wake in 10 minutes.`; }
        await this.refresh();
        // A pane opened in the tab while it went to sleep keeps it open.
        const known = new Set(cap.cols.flatMap((c) => c.panes).map((p) => p.terminal));
        if (note || panes().some((p) => p.tab === r.tab.id && p.terminal && !known.has(p.terminal))) {
          // The tab stays for what is new in it; what slept ends, so it
          // doesn't run here and again on wake.
          for (const t of known) run("terminal.kill", { terminal: t });
          if (note) notes.push(note); else stayed.push(r.name);
        } else run("tab.close", { id: r.tab.id, confirmed: true });
      }
      if (stayed.length || notes.length) {
        this.busy = null; this.view = "list";
        this.error = [...notes, ...(stayed.length ? [`${stayed.join(", ")} ${stayed.length === 1 ? "is" : "are"} asleep, but ${stayed.length === 1 ? "its tab stays" : "their tabs stay"} open: a pane opened in ${stayed.length === 1 ? "it" : "them"} meanwhile.`] : [])].join(" ");
        cx.notify();
        return;
      }
      closeOverlay(props()?.overlay);
    });
  }

  // One agent out: still the one read, its prompt cleared and seen empty
  // (a draft would go out with /exit), /exit, then its process gone.
  async leave(p, cx, onSent = () => {}) {
    const now = await hc(["get", p.terminal, "--json"]).catch(() => null);
    let fg = null;
    try { fg = JSON.parse(now.stdout).foreground?.pid; } catch { /* below */ }
    if (fg !== p.pid) throw new Error(`${p.name}'s terminal changed`);
    // ctrl+c empties the whole draft, every line of it; the screen must
    // then show the prompt empty, or /exit is not sent.
    const clear = await hc(["keys", p.terminal, "ctrl+c"]).catch(() => null);
    await cx.sleep(400);
    const screen = clear?.code === 0 ? await hc(["read", p.terminal]).catch(() => null) : null;
    if (screen?.code !== 0 || !promptEmpty(screen.stdout)) throw new Error(`${p.name}'s prompt could not be cleared`);
    const s = await hc(["send", p.terminal, "/exit"]).catch(() => null);
    onSent();
    if (s?.code !== 0) throw new Error(`${p.name} did not take /exit`);
    if (!(await this.gone(p.pid, cx, 20))) throw new Error(`${p.name} did not exit`);
  }

  // True once process `pid` has ended, looking for up to `secs` seconds.
  async gone(pid, cx, secs) {
    for (let k = 0; k < secs * 2; k++) {
      await cx.sleep(500);
      if ((await exec("kill", ["-0", String(pid)]).catch(() => null))?.code !== 0) return true;
    }
    return false;
  }

  // An agent that left during a sleep that stopped: started again in its
  // terminal on its conversation. "back" when it is; "out" when it is not
  // running (it never started, or what started was stopped); "unsure" when
  // something it started could not be stopped.
  async comeBack(p, cx) {
    const line = `cd ${shq(p.cwd || home())} && ${p.wake.map(shq).join(" ")}`;
    for (let k = 0; k < 20; k++) {
      const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
      let x = null;
      try { x = JSON.parse(g.stdout); } catch { /* not yet */ }
      if (x && (!x.foreground?.pid || x.foreground.pid === x.pid || SHELLS.has(base(x.foreground.argv?.[0])))) break;
      await cx.sleep(500);
    }
    await cx.sleep(800);
    if ((await hc(["send", p.terminal, line]).catch(() => null))?.code !== 0) return "out";
    if (await this.resumed(p.terminal, p.resume, cx)) return "back";
    return (await this.stopIn(p.terminal, cx)) ? "out" : "unsure";
  }

  // Whatever runs in `terminal` in front of its shell, stopped (TERM, then
  // KILL): true once nothing does.
  async stopIn(terminal, cx) {
    const front = async () => {
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      try { const x = JSON.parse(g.stdout); const fg = x.foreground; return !fg?.pid || fg.pid === x.pid || SHELLS.has(base(fg.argv?.[0])) ? 0 : fg.pid; } catch { return null; }
    };
    for (const sig of ["-TERM", "-KILL"]) {
      const pid = await front();
      if (pid === 0) return true;
      if (pid == null) return false;
      await exec("kill", [sig, String(pid)]).catch(() => null);
      for (let k = 0; k < 10; k++) { await cx.sleep(300); if ((await front()) === 0) return true; }
    }
    return false;
  }

  // The pid of a Claude agent in `terminal` back on conversation `session`,
  // once it is there and has stayed a moment (up to 30 seconds).
  async resumed(terminal, session, cx) {
    for (let k = 0; k < 30; k++) {
      await cx.sleep(1000);
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      let fg = null;
      try { fg = JSON.parse(g.stdout).foreground ?? null; } catch { /* not yet */ }
      if (!fg?.pid || SHELLS.has(base(fg.argv?.[0]))) continue;
      let record = null;
      try { record = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`)); } catch { /* none */ }
      if (isResumed(fg, record, session)) return fg.pid;
    }
    return null;
  }

  // Back in its project's space, each agent on its conversation, checked;
  // only then is it no longer asleep. What did not come back stays asleep
  // (only those agents), and a pane that did not prove it is ended, so it
  // can't come back late and run twice on the next wake. A project that
  // slept whole has no space left: it gets a new one. `rest`: more to wake
  // after it (Wake all). The claim hands back the row as it is now, so an
  // old list never opens what another window changed.
  wake(shown, cx, rest = []) {
    if (this.busy) return;
    this.busy = `Waking ${shown.name}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      let a;
      try { a = await this.store.claim(shown.id); }
      catch (e) { this.busy = null; this.error = `${shown.name} could not be woken: ${String(e?.message ?? e)}`; cx.notify(); return; }
      if (!a) {
        await this.refresh();
        this.busy = null; this.error = `${shown.name} is waking in another window, or is no longer asleep.`; cx.notify(); return;
      }
      // An agent whose terminal could not be checked when a sleep stopped:
      // that terminal is looked at first, and the wake waits while it runs.
      // A sleep that stopped half way (the window closed under it, say)
      // left its row pending: an agent of it that never left still runs.
      const still = [];
      for (const p of a.cols.flatMap((c) => c.panes)) {
        if (p.check) {
          const gone = !terminals().some((t) => t.address === p.check);
          const g = gone ? null : await hc(["get", p.check, "--json"]).catch(() => null);
          let x = null;
          try { x = g?.code === 0 ? JSON.parse(g.stdout) : null; } catch { /* below */ }
          const idleShell = x && (!x.foreground?.pid || x.foreground.pid === x.pid || SHELLS.has(base(x.foreground.argv?.[0])));
          if (!gone && !idleShell) still.push(`${p.name ?? "an agent"} may still run in ${p.check}`);
        }
        if (a.pending && p.pid) {
          const ps = await exec("ps", ["-p", String(p.pid), "-o", "comm="]).catch(() => null);
          if (ps?.code === 0 && base(ps.stdout.trim()) === "claude") still.push(`${p.name ?? "an agent"} still runs (pid ${p.pid})`);
        }
      }
      if (still.length) {
        await this.store.release(a.id, a.token).catch(() => {});
        await this.refresh();
        this.busy = null; this.error = `${a.name} can't wake yet: ${still.join("; ")}. End ${still.length === 1 ? "it" : "them"} there, then wake.`; cx.notify(); return;
      }
      const space = spaces().find((sp) => projectOf(sp) === a.from) ?? null;
      const folder = folderOfKey(a.from), machine = String(a.from).slice(0, String(a.from).indexOf(":")) || undefined;
      const create = space ? null : { name: a.space || base(folder) || "~", folder, key: a.from, ...(machine ? { machine } : {}) };
      let ids, failure = null;
      try {
        ids = await openTab({ ...wakeable(a), name: a.name }, cx, { space, create, progress: (t) => { this.busy = `${a.name}: ${t}`; cx.notify(); } });
      } catch (e) { ids = e?.opened ?? []; failure = e; }
      const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ p, pane: ids[ci]?.[ri] ?? null })));
      // Every pane that did not open stays asleep, agent or not; an agent
      // that opened stays asleep too until its session record proves it.
      const missed = [];
      for (const { p, pane } of flat) {
        const term = pane ? panes().find((q) => q.pane === pane)?.terminal ?? null : null;
        if (!term) { missed.push(p); continue; }
        if (!p.resume) continue;
        this.busy = `Checking ${p.name ?? "an agent"} is on its conversation`; cx.notify();
        if (await this.resumed(term, p.resume, cx)) continue;
        missed.push(p);
        run("terminal.kill", { terminal: term });
      }
      const opened = flat.some((x) => x.pane);
      // Written, or, if it can't be after a few tries, what this wake
      // started ends: never awake and still claimable at once.
      let saveError = null;
      const missedNow = missed.map(({ check, ...p }) => p);
      for (let k = 0; k < 4; k++) {
        try {
          if (!opened) await this.store.release(a.id, a.token);
          else if (missed.length) await this.store.narrow(a.id, colsOf(missedNow), a.token);
          else await this.store.woke(a.id, a.token);
          saveError = null; break;
        } catch (e) { saveError = String(e?.message ?? e); await cx.sleep(1000); }
      }
      if (saveError && opened) {
        for (const pane of ids.flat()) { const term = panes().find((q) => q.pane === pane)?.terminal; if (term) run("terminal.kill", { terminal: term }); }
        saveError += "; what it opened was ended, so it wakes from here again in 10 minutes";
      }
      await this.refresh();
      this.busy = null;
      if (failure || missed.length || saveError) {
        const why = (failure ? `Stopped: ${String(failure?.message ?? failure)}. ` : "") + (saveError ? `${a.name} could not be updated (${saveError}). ` : "");
        this.error = why + (missed.length ? `${missed.map((p) => p.name || programOf(p.argv)).join(", ")} did not come back; ${missed.length === 1 ? "it stays" : "they stay"} asleep.` : "");
        this.view = "list"; cx.notify(); return;
      }
      if (rest.length) { this.wake(rest[0], cx, rest.slice(1)); return; }
      closeOverlay(props()?.overlay);
    });
  }

  arm(key, cx, act) {
    if (this.armed === key && Date.now() - this.armedAt <= ARM_MS) { this.armed = null; act(cx); return; }
    this.armed = key; this.armedAt = Date.now(); cx.notify();
    cx.timer.after(ARM_MS + 50, (cx) => { if (this.armed === key) { this.armed = null; cx.notify(); } });
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
        if (e.key !== "escape") return;
        if (this.busy) { cx.stop_propagation(); return; }
        if (this.view === "sleep" && (props()?.sleep == null)) { this.view = "list"; this.error = null; cx.notify(); }
        else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

    if (this.view === "sleep") {
      const list = this.sleepers ?? [];
      const whole = this.whole;
      const panesOf = (r) => r.capture.cols.flatMap((c) => c.panes);
      const others = [...new Set(list.flatMap(panesOf).filter((q) => !q.pid && q.argv).map((q) => programOf(q.argv)))];
      const stop = list.find((r) => r.blocker || r.error);
      const line = (q, i) => h_flex().id(`sl-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.pid ? t.foreground : t.muted).child(q.pid ? q.name : describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(q.pid ? "keeps its conversation" : tilde(q.cwd)));
      let i = 0;
      const ready = list.length > 0 && !stop && !this.busy;
      return shell
        .child(head(whole ? `Sleep ${project}` : "Sleep this tab", whole ? "Every tab's agents exit and the tabs close. Wake opens them again, each agent on its conversation." : "Its agents exit and the tab closes. Wake opens it again, each agent on its conversation."))
        .when(!whole, (el) => el
          .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
          .child(Input.new(this.name).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)))
        .when(this.sleepers === null, (el) => el.child(note("Reading")))
        .children(list.map((r) => v_flex().pt(14).gap(4)
          .when(whole, (el) => el.child(div().pb(3).text_size(11.5).text_color(t.dim).child(r.name)))
          .children(panesOf(r).map((q) => line(q, i++)))))
        .when(this.sleepers !== null && !list.length, (el) => el.child(note("Nothing runs here to put to sleep.")))
        .when(others.length > 0, (el) => el.child(note(`${others.join(", ")} will stop now and start fresh on wake.`)))
        .when(Boolean(stop) && !this.error, (el) => el.child(note(`It can't sleep now: ${stop?.blocker || stop?.error}.`, t.blocked)))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("sl-back", "Cancel", false, !this.busy, () => closeOverlay(p.overlay)))
          .child(button("sl-go", whole ? `Sleep ${list.length} ${list.length === 1 ? "tab" : "tabs"}` : "Sleep", true, ready, (cx) => this.sleep(cx))));
    }

    // The list: what sleeps, by project, newest first.
    const asleep = this.asleep ?? [];
    const groups = [...asleep.reduce((m, a) => m.set(a.from, [...(m.get(a.from) ?? []), a]), new Map())];
    const spaceName = (from, list) => spaces().find((sp) => projectOf(sp) === from)?.name ?? list[0]?.space ?? (base(folderOfKey(from)) || "~");
    const label = (text) => div().pt(12).pb(4).px(10).text_size(11.5).text_color(t.dim).child(text);
    const row = (a) => {
      const id = `${a.from}:${a.name}`, key = `forget:${id}`, armed = this.armed === key;
      return h_flex().id(`zz-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
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
      .child(v_flex().id("zz-list").pt(10).gap(2).max_h(420).overflow_y_scrollbar()
        .when(this.asleep === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Reading")))
        .when(this.asleep !== null && !asleep.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("Nothing is asleep."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Put a tab you are waiting on to sleep: its agents stop holding memory, and wake on their conversations when you need them."))))
        .children(groups.map(([from, tabs]) => v_flex().gap(2)
          .child(h_flex().items_center().child(div().flex_1().child(label(spaceName(from, tabs))))
            .when(tabs.length > 1 && !this.busy, (el) => el.child(div().id(`zz-all-${from}`).px(10).pt(8).text_size(11.5).text_color(t.foreground).cursor_pointer()
              .hover((s) => s.opacity(0.8)).on_click((_e, cx) => this.wake(tabs[0], cx, tabs.slice(1))).child(`Wake all ${tabs.length}`))))
          .children(tabs.map(row)))))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("zz-close", "Close", false, !this.busy, () => closeOverlay(p.overlay)))
        .child(button("zz-sleep", "Sleep this tab", true, !this.busy && Boolean(this.space), (cx) => this.startSleep(cx))));
  }
}
