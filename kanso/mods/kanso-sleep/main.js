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
import { spaces, panes, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile, exec } from "herdr";
import { Store } from "./store.js";
import { base, tilde, shq, SHELLS, captureTab, describe, programOf, projectOf, folderOfKey, openTab } from "./tabkit.js";

const ARM_MS = 4000;

// The command that resumes `session` the way argv ran Claude Code, or null
// when it can't: only options known to carry over are kept; the first
// prompt and session options (--continue, --fork-session) are left out, so
// a wake neither repeats the task it started with nor forks the conversation.
const KEEP_VALUE = new Set(["--model", "--permission-mode", "--settings", "--agent", "--effort", "--fallback-model", "--append-system-prompt", "--system-prompt", "--plugin-dir", "--setting-sources", "--name", "--add-dir", "--mcp-config", "--allowedTools", "--disallowedTools"]);
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

// A name not taken yet: "shield", else "shield 2", "shield 3"...
export function freeName(name, taken) {
  let n = name, k = 2;
  while (taken.has(n)) n = `${name} ${k++}`;
  return n;
}

// Back on its conversation: the agent's session record says so, or, where
// Claude Code keeps none, the process runs with `--resume <session>`.
export function isResumed(fg, record, session) {
  if (record) return record.sessionId === session;
  const argv = fg?.argv ?? [];
  return base(argv[0]) === "claude" && argv.some((x, i) => (x === "--resume" || x === "-r") && argv[i + 1] === session);
}

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
      try { this.setAsleep(await this.store.asleep()); }
      catch (e) { this.asleep = []; this.error = String(e?.message ?? e); }
      const waking = ask.wakeAll ? this.asleep.filter((a) => a.from === ask.wakeAll)
        : ask.wake ? this.asleep.filter((a) => a.from === ask.wake.from && a.name === ask.wake.name) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // What sleeps, for the sidebar to show (shared "kanso.asleep").
  setAsleep(list) {
    this.asleep = list;
    setShared("kanso.asleep", list.map((a) => ({ from: a.from, name: a.name, saved: a.saved, who: sleepers(a), space: a.space ?? null })));
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
    return { tab, capture: captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra), blocker: sleepBlocker(recs), error };
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
      for (const r of list) {
        const cap = r.capture;
        const agents = cap.cols.flatMap((c) => c.panes).filter((p) => p.pid);
        const entry = { name: r.name, space: this.space?.name ?? null, per: cap.per, saved: Date.now(),
          cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map((p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, wake: p.wake ?? null, name: p.name ?? null })) })) };
        const left = [];
        try {
          await this.store.sleep(project, entry);
          for (const [i, p] of agents.entries()) {
            this.busy = `${p.name} is leaving, ${i + 1} of ${agents.length} in ${r.name}`; cx.notify();
            await this.leave(p, cx);
            left.push(p);
          }
          this.setAsleep(await this.store.settle(project, r.name));
          run("tab.close", { id: r.tab.id, confirmed: true });
        } catch (e) {
          const lost = [];
          for (const p of left) if (!(await this.comeBack(p, cx))) lost.push(p.name);
          await this.store.woke(project, r.name).catch(() => {});
          this.setAsleep(await this.store.asleep().catch(() => this.asleep ?? []));
          this.busy = null;
          this.error = `Stopped: ${String(e?.message ?? e)}. ${r.name} stays open` + (left.length ? (lost.length ? `; ${lost.join(", ")} did not come back, start it with claude --resume` : "; the agents that had left are back on their conversations") : "") + ".";
          cx.notify();
          return;
        }
      }
      closeOverlay(props()?.overlay);
    });
  }

  // One agent out: still the one read, its prompt cleared (a draft would go
  // out with /exit), /exit, then its process gone.
  async leave(p, cx) {
    const live = async () => (await exec("kill", ["-0", String(p.pid)]).catch(() => null))?.code === 0;
    const now = await hc(["get", p.terminal, "--json"]).catch(() => null);
    let fg = null;
    try { fg = JSON.parse(now.stdout).foreground?.pid; } catch { /* below */ }
    if (fg !== p.pid) throw new Error(`${p.name}'s terminal changed`);
    const clear = await hc(["keys", p.terminal, "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u"]).catch(() => null);
    if (clear?.code !== 0) throw new Error(`${p.name}'s prompt could not be cleared`);
    const s = await hc(["send", p.terminal, "/exit"]).catch(() => null);
    if (s?.code !== 0) throw new Error(`${p.name} did not take /exit`);
    for (let k = 0; k < 40; k++) { await cx.sleep(500); if (!(await live())) return; }
    throw new Error(`${p.name} did not exit`);
  }

  // An agent that left during a sleep that stopped: started again in its
  // terminal on its conversation. True when it is back.
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
    if ((await hc(["send", p.terminal, line]).catch(() => null))?.code !== 0) return false;
    return Boolean(await this.resumed(p.terminal, p.resume, cx));
  }

  // The pid of a Claude agent in `terminal` back on conversation `session`,
  // once it is there and has stayed a moment (up to 30 seconds).
  async resumed(terminal, session, cx) {
    let seen = null;
    for (let k = 0; k < 30; k++) {
      await cx.sleep(1000);
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      let fg = null;
      try { fg = JSON.parse(g.stdout).foreground ?? null; } catch { /* not yet */ }
      if (!fg?.pid || SHELLS.has(base(fg.argv?.[0]))) { seen = null; continue; }
      let record = null;
      try { record = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`)); } catch { /* none */ }
      if (!isResumed(fg, record, session)) { seen = null; continue; }
      if (record) return fg.pid;
      if (seen === fg.pid && k >= 4) return fg.pid; // no record: the same process, still running
      seen = fg.pid;
    }
    return null;
  }

  // Back in its project's space, each agent on its conversation, checked;
  // only then is it no longer asleep. What did not come back stays asleep
  // (only those panes). A project that slept whole has no space left: it
  // gets a new one. `rest`: more to wake after it (Wake all).
  wake(a, cx, rest = []) {
    if (this.busy) return;
    const space = spaces().find((sp) => projectOf(sp) === a.from) ?? null;
    const folder = folderOfKey(a.from), machine = String(a.from).slice(0, String(a.from).indexOf(":")) || undefined;
    const create = space ? null : { name: a.space || base(folder) || "~", folder, key: a.from, ...(machine ? { machine } : {}) };
    this.busy = `Waking ${a.name}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      if (!(await this.store.claim(a.from, a.name).catch(() => false))) {
        this.busy = null; this.error = `${a.name} is already waking.`; cx.notify(); return;
      }
      let ids;
      try {
        ids = await openTab({ ...wakeable(a), name: a.name }, cx, { space, create, progress: (t) => { this.busy = `${a.name}: ${t}`; cx.notify(); } });
      } catch (e) {
        this.setAsleep(await this.store.release(a.from, a.name).catch(() => this.asleep ?? []));
        this.busy = null; this.error = `Stopped: ${String(e?.message ?? e)}`; cx.notify(); return;
      }
      const flat = a.cols.flatMap((c) => c.panes);
      const terms = ids.flat().map((id) => panes().find((q) => q.pane === id)?.terminal ?? null);
      const missed = [];
      for (const [i, p] of flat.entries()) {
        if (!p.resume) continue;
        this.busy = `Checking ${p.name ?? "an agent"} is on its conversation`; cx.notify();
        if (!terms[i] || !(await this.resumed(terms[i], p.resume, cx))) missed.push(p);
      }
      try {
        if (missed.length) this.setAsleep(await this.store.keep(a.from, { ...a, cols: [{ w: 1, panes: missed }] }));
        else this.setAsleep(await this.store.woke(a.from, a.name));
      } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = null;
      if (missed.length) {
        this.error = `${missed.map((p) => p.name).join(", ")} did not come back on ${missed.length === 1 ? "its conversation; it stays" : "their conversations; they stay"} asleep.`;
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
        if (this.busy) return;
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
        .child(div().id(`zz-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => cx.spawn(async (cx) => { this.setAsleep(await this.store.woke(a.from, a.name)); cx.notify(); })); })
          .child(armed ? "Press again to forget it" : "Forget"));
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
        .child(button("zz-close", "Close", false, true, () => closeOverlay(p.overlay)))
        .child(button("zz-sleep", "Sleep this tab", true, !this.busy && Boolean(this.space), (cx) => this.startSleep(cx))));
  }
}
