// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The tab you set up every morning, kept: save the tab as it is (each pane's
// program with the flags you started it with, its folder, the columns, the
// stacks and their widths) and open it again in a new tab with one click.
// Kanso adds nothing of its own: an arrangement holds only what you ran.
// A session's resume id is left out, so each agent starts fresh.
//
// An arrangement is saved with the project it was made in (the space's
// folder, on its machine) and can be opened in any project: one from
// another project opens each pane in the folder of the project you are in.
// Saving under a name the project already has overwrites it. They live in
// a SQLite database (store.js), data/kanso-arrange/arrange.db. Opened with
// Cmd+Alt+T or a right-click on the tab bar's new tab button.
//
// Sleep puts a tab away for later: it is saved with each Claude agent's
// conversation, the agents exit and the tab closes, so nothing of it runs.
// Wake opens it again in its project, each agent back on its conversation.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile } from "herdr";
import { Store } from "./store.js";
const ARM_MS = 4000;

const base = (s) => String(s ?? "").split("/").pop().replace(/^-/, "");
const tilde = (cwd) => {
  if (!cwd) return "~";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

// A program's arguments without the session it resumed, so opening the
// arrangement starts each agent fresh: Claude Code's --resume/-r <id>,
// --session-id <id>, --continue/-c; Codex's `resume <id>`.
export function cleanArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const [cmd, ...rest] = argv.map(String);
  const name = base(cmd), out = [cmd];
  const value = (i) => rest[i + 1] !== undefined && !rest[i + 1].startsWith("-");
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (name === "claude") {
      if (a === "--resume" || a === "-r" || a === "--session-id") { if (value(i)) i++; continue; }
      if (a.startsWith("--resume=") || a.startsWith("--session-id=") || a === "--continue" || a === "-c") continue;
    }
    if (name === "codex" && i === 0 && a === "resume") { if (value(i)) i++; continue; }
    out.push(a);
  }
  return out;
}

// What a terminal runs, from `hc get --json`: the program in the foreground
// with its arguments (one you started in its shell, or one the terminal was
// opened with), or null for a shell at its prompt.
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);
export function commandOf(rec) {
  const fg = rec?.foreground;
  if (!fg?.argv?.length || SHELLS.has(base(fg.argv[0]))) return null;
  return cleanArgv(fg.argv);
}

// The tab's panes as columns, in the strip's order, each pane with what it
// runs and where (`recs`: terminal address -> its `hc get` record).
export function captureTab(state, tabPanes, recs, extra = null) {
  const byId = new Map(tabPanes.map((p) => [p.pane, p]));
  const cols = (state?.cols?.length ? state.cols : tabPanes.map((p) => ({ panes: [p.pane], w: 1 / Math.max(1, tabPanes.length) })))
    .map((c) => ({ w: c.w, panes: c.panes.map((id) => byId.get(id)).filter(Boolean).map((p) => {
      const rec = recs.get(p.terminal);
      return { argv: commandOf(rec), cwd: rec?.foreground?.cwd || p.cwd || null, ...(extra?.get(p.terminal) ?? {}) };
    }) }))
    .filter((c) => c.panes.length);
  return { per: state?.n ?? null, cols };
}

export const describe = (argv) => (argv ? argv.join(" ") : "Shell");
// A program's name: the script a runtime runs (`node …/bin/codex` is codex).
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3", "ruby"]);
export const programOf = (argv) => (!argv?.length ? "shell" : RUNTIMES.has(base(argv[0])) && argv[1] && !argv[1].startsWith("-") ? base(argv[1]) : base(argv[0]));
export const summary = (a) => a.cols.flatMap((c) => c.panes).map((p) => programOf(p.argv)).join(", ");

// The project an arrangement belongs to: the space's folder on its machine.
const projectOf = (space) => `${space?.machine ?? ""}:${space?.folder || home()}`;
const folderOfKey = (key) => String(key ?? "").slice(String(key ?? "").indexOf(":") + 1);

// Every saved arrangement, this project's first, then the other projects'
// newest first, each with the project it was saved in (`from`).
export function listFor(projects, key) {
  const tag = (k) => (projects?.[k] ?? []).map((a) => ({ ...a, from: k }));
  const others = Object.keys(projects ?? {}).filter((k) => k !== key).flatMap(tag)
    .sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
  return { mine: tag(key), others };
}

// What waking a pane runs: a Claude agent back on its conversation; any
// other program as it was started.
export function wakeArgv(p) {
  if (!p.argv) return null;
  return p.resume && base(p.argv[0]) === "claude" ? [...cleanArgv(p.argv), "--resume", p.resume] : p.argv;
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

// Where an arrangement was made, named by the folder most of its panes ran
// in (the space's folder when none of them say).
export function originOf(a) {
  const count = new Map();
  for (const p of a.cols.flatMap((c) => c.panes)) if (p.cwd) count.set(p.cwd, (count.get(p.cwd) ?? 0) + 1);
  const top = [...count].sort((x, y) => y[1] - x[1])[0]?.[0];
  return base(top || folderOfKey(a.from)) || "~";
}

// An arrangement from another project, ready to open in `folder`: the same
// programs, flags, columns and widths, every pane in that folder.
export function rebase(a, folder) {
  return { ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ ...p, cwd: folder || p.cwd })) })) };
}


export default class Arrange extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.view = "list";
    this.list = null; // this project's arrangements, once read
    this.others = []; // the other projects' arrangements, each with its `from`
    this.armed = null;
    this.busy = null; // "Opening 2 of 4" while an arrangement opens
    this.error = null;
    this.name = InputState.new({ placeholder: "Name" });
    this.name.on("submit", (_e, cx) => this.save(cx));
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    // Opened from a menu (the sidebar's, a pane header's): `sleep` { scope:
    // "tab" | "project", space, tab } goes straight to the sleep view;
    // `wake` { from, name } or `wakeAll` (a project) wakes at once.
    const ask = props() ?? {};
    this.space = spaces().find((s) => s.id === ask.sleep?.space) ?? spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    this.target = null; // { project, name } an Overwrite replaces
    this.asleep = [];
    cx.spawn(async (cx) => {
      try { this.take(await this.store.all()); this.setAsleep(await this.store.asleep()); }
      catch (e) { this.list = []; this.error = String(e?.message ?? e); }
      if (ask.sleep) this.startSleep(cx, ask.sleep.scope === "project", ask.sleep.tab);
      const waking = ask.wakeAll ? this.asleep.filter((a) => a.from === ask.wakeAll)
        : ask.wake ? this.asleep.filter((a) => a.from === ask.wake.from && a.name === ask.wake.name) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // What sleeps, for the sidebar and the pane headers to show (shared
  // "kanso.asleep": [{ from, name, saved, who }]).
  setAsleep(list) {
    this.asleep = list;
    setShared("kanso.asleep", list.map((a) => ({ from: a.from, name: a.name, saved: a.saved, who: sleepers(a), space: a.space ?? null })));
  }

  take(projects) {
    const { mine, others } = listFor(projects, projectOf(this.space));
    this.list = mine; this.others = others;
  }

  // The save view: what the tab runs now, read from herdr-core.
  // With `a`, an Overwrite: the tab replaces that arrangement, in the
  // project it was saved in, under its name.
  startSave(cx, a = null) {
    const tab = this.space?.tabs.find((t) => t.active);
    this.view = "save"; this.capture = null; this.error = null;
    this.target = a ? { project: a.from, name: a.name } : null;
    this.name.set_value(a ? a.name : tab?.named ? tab.name : `Arrangement ${(this.list?.length ?? 0) + 1}`);
    this.name.focus();
    cx.notify();
    const tabPanes = panes().filter((p) => p.tab === tab?.id && p.terminal);
    cx.spawn(async (cx) => {
      const recs = new Map();
      await Promise.all(tabPanes.map(async (p) => {
        const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
        try { if (r?.code === 0) recs.set(p.terminal, JSON.parse(r.stdout)); } catch { /* left as a shell */ }
      }));
      this.capture = captureTab(shared("strip.state")?.[tab?.id], tabPanes, recs);
      cx.notify();
    });
  }

  save(cx) {
    const name = this.name.value().trim();
    if (!name || !this.capture?.cols.length) return;
    const entry = { name, ...this.capture, saved: Date.now() };
    const t = this.target;
    const key = t && t.name === name ? t.project : projectOf(this.space);
    cx.spawn(async (cx) => {
      try {
        this.take(await this.store.save(key, entry));
        this.view = "list"; this.target = null;
      } catch (e) { this.error = `Not saved: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  remove(a, cx) {
    const key = a.from ?? projectOf(this.space);
    cx.spawn(async (cx) => {
      try {
        this.take(await this.store.remove(key, a.name));
      } catch (e) { this.error = `Not removed: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  // A tab as it runs, each Claude agent with its conversation (its session
  // record, ~/.claude/sessions/<pid>.json): { tab, capture, blocker, error }.
  async readTab(tab) {
    const tabPanes = panes().filter((p) => p.tab === tab.id && p.terminal);
    const recs = new Map(), extra = new Map();
    let error = null;
    await Promise.all(tabPanes.map(async (p) => {
      const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
      try { if (r?.code === 0) recs.set(p.terminal, JSON.parse(r.stdout)); } catch { /* left as a shell */ }
    }));
    for (const [term, r] of recs) {
      const fg = r.foreground;
      if (!fg?.pid || base(fg.argv?.[0]) !== "claude") continue;
      let ses = null;
      try { ses = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`)); } catch { /* reported below */ }
      const who = ses?.name || r.labels?.["kanso.name"] || r.title || term;
      if (!ses?.sessionId) error = `${who}'s conversation was not found, so it could not wake on it`;
      extra.set(term, { resume: ses?.sessionId ?? null, name: who, pid: fg.pid, terminal: term });
    }
    return { tab, capture: captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra), blocker: sleepBlocker(recs), error };
  }

  // The sleep view, for the tab you are on or (`whole`) every tab of the
  // project; each tab sleeps under its own name.
  startSleep(cx, whole = false, tabId = null) {
    const all = this.space?.tabs ?? [];
    const tabs = whole ? all : all.filter((t) => (tabId ? t.id === tabId : t.active));
    this.view = "sleep"; this.whole = whole; this.sleepers = null; this.error = null;
    const tab = tabs[0];
    this.name.set_value(tab?.named ? tab.name : `Tab ${all.indexOf(tab) + 1}`);
    cx.notify();
    cx.spawn(async (cx) => {
      const read = await Promise.all(tabs.map((t) => this.readTab(t)));
      read.forEach((r) => { r.name = r.tab.named ? r.tab.name : `Tab ${all.indexOf(r.tab) + 1}`; });
      this.sleepers = read.filter((r) => r.capture.cols.length);
      cx.notify();
    });
  }

  // Saved first, then each agent leaves with /exit (its conversation stays
  // on disk), then its tab closes with whatever else ran in it.
  sleep(cx) {
    const list = this.sleepers;
    if (this.busy || !list?.length || list.some((r) => r.blocker || r.error)) return;
    if (!this.whole) list[0].name = this.name.value().trim();
    if (list.some((r) => !r.name)) return;
    const taken = new Set();
    for (const r of list) { let n = r.name, k = 2; while (taken.has(n)) n = `${r.name} ${k++}`; r.name = n; taken.add(n); }
    this.busy = "Saving"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        for (const r of list) {
          const cap = r.capture;
          const entry = { name: r.name, space: this.space?.name ?? null, per: cap.per, saved: Date.now(), cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map((p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, name: p.name ?? null })) })) };
          this.setAsleep(await this.store.sleep(projectOf(this.space), entry));
          const agents = cap.cols.flatMap((c) => c.panes).filter((p) => p.pid);
          for (const [i, p] of agents.entries()) {
            this.busy = `${p.name} is leaving, ${i + 1} of ${agents.length} in ${r.name}`; cx.notify();
            // A draft left in its prompt would go out with /exit: cleared first.
            await hc(["keys", p.terminal, "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u"]).catch(() => null);
            const s = await hc(["send", p.terminal, "/exit"]).catch(() => null);
            if (s?.code !== 0) throw new Error(`${p.name} did not take /exit; ${r.name} is kept under Asleep and left open`);
            let gone = false;
            for (let k = 0; k < 40 && !gone; k++) {
              await cx.sleep(500);
              const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
              try { gone = g?.code !== 0 || JSON.parse(g.stdout).foreground?.pid !== p.pid; } catch { gone = false; }
            }
            if (!gone) throw new Error(`${p.name} did not exit; ${r.name} is kept under Asleep and left open`);
          }
          run("tab.close", { id: r.tab.id, confirmed: true });
        }
        closeOverlay(props()?.overlay);
      } catch (e) {
        this.busy = null;
        this.error = `Stopped: ${String(e?.message ?? e)}`;
        cx.notify();
      }
    });
  }

  // Back in its project's space (this one when that space is gone), each
  // agent on its conversation; then it is no longer asleep. `rest`: more to
  // wake after it (Wake all).
  // A project that slept whole may have no space left: it gets a new one.
  wake(a, cx, rest = []) {
    const space = spaces().find((sp) => projectOf(sp) === a.from) ?? null;
    const at = String(a.from).indexOf(":"), folder = folderOfKey(a.from), machine = String(a.from).slice(0, at) || undefined;
    const create = space ? null : { name: a.space || base(folder) || "~", folder, ...(machine ? { machine } : {}) };
    this.open({ ...wakeable(a), name: a.name }, cx, { space, create, keepOpen: rest.length > 0, then: async (cx) => {
      this.setAsleep(await this.store.woke(a.from, a.name));
      if (rest.length) { this.busy = null; this.wake(rest[0], cx, rest.slice(1)); }
    } });
  }

  // A new pane, once Herdr has it (one not in `seen`) and the strip has put
  // it in its place: the next split's "beside this one" needs that place.
  async newPane(seen, cx, tab) {
    for (let i = 0; i < 60; i++) {
      const p = panes().find((q) => !seen.has(q.pane) && q.terminal && (!tab || q.tab === tab));
      if (p) {
        for (let j = 0; j < 20 && !shared("strip.state")?.[p.tab]?.cols?.some((c) => c.panes?.includes(p.pane)); j++) await cx.sleep(75);
        return p;
      }
      await cx.sleep(100);
    }
    throw new Error("Herdr did not open the pane");
  }

  // A new tab with the first pane, then each other pane beside or under the
  // one before it, as the strip places a split; then the columns' widths.
  open(a, cx, { space = this.space, create = null, then = null, keepOpen = false } = {}) {
    if (this.busy) return;
    if (!then && a.from && a.from !== projectOf(space)) a = rebase(a, space?.folder || home());
    const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
    if (!flat.length || (!space && !create)) return;
    this.busy = `Opening 1 of ${flat.length}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
        let seen = new Set(panes().map((q) => q.pane));
        if (create) run("space.new", { ...opts(flat[0]), ...create, tab: a.name });
        else run("tab.new", { space: space.id, name: a.name, ...opts(flat[0]) });
        const first = await this.newPane(seen, cx);
        const ids = [[first.pane]];
        for (let k = 1; k < flat.length; k++) {
          const p = flat[k];
          this.busy = `Opening ${k + 1} of ${flat.length}`; cx.notify();
          const dir = p.ri > 0 ? "down" : "right";
          const from = p.ri > 0 ? ids[p.ci][p.ri - 1] : ids[p.ci - 1][0];
          seen = new Set(panes().map((q) => q.pane));
          setShared("strip.intent", { dir, from, at: Date.now() });
          run("pane.focus", { pane: from });
          run("terminal.open", { ...opts(p), place: dir });
          const made = await this.newPane(seen, cx, first.tab);
          (ids[p.ci] ??= []).push(made.pane);
        }
        await cx.sleep(150);
        setShared("strip.req", { op: "widths", per: a.per, cols: ids.map((col, ci) => ({ pane: col[0], w: a.cols[ci].w })), n: Date.now() + Math.random() });
        run("pane.focus", { pane: ids[0][0] });
        if (then) await then(cx);
        if (!keepOpen) closeOverlay(props()?.overlay);
      } catch (e) {
        this.busy = null;
        this.error = `Stopped: ${String(e?.message ?? e)}`;
        cx.notify();
      }
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
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub));
    const note = (text, tone) => div().pt(10).text_size(11.5).line_height(1.45).text_color(tone ?? t.dim).child(text);
    const shell = v_flex().id("kanso-arrange").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.view !== "list" && !this.busy) { this.view = "list"; this.target = null; this.error = null; cx.notify(); }
        else if (this.view !== "list") return; else closeOverlay(p.overlay);
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
        .when(Boolean(stop), (el) => el.child(note(`It can't sleep now: ${stop?.blocker || stop?.error}.`, t.blocked)))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("sl-back", "Back", false, !this.busy, (cx) => { this.view = "list"; this.error = null; cx.notify(); }))
          .child(button("sl-go", whole ? `Sleep ${list.length} ${list.length === 1 ? "tab" : "tabs"}` : "Sleep", true, ready, (cx) => this.sleep(cx))));
    }

    if (this.view === "save") {
      const cols = this.capture?.cols ?? [];
      const line = (q, i) => h_flex().id(`cap-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.argv ? t.foreground : t.muted).child(describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(tilde(q.cwd)));
      let i = 0;
      const typed = this.name.value().trim(), tg = this.target;
      const replaces = (tg && tg.name === typed) ? tg : (this.list ?? []).some((a) => a.name === typed) ? { name: typed } : null;
      return shell
        .child(head(tg ? `Overwrite ${tg.name}` : "Save this tab", tg ? "With this tab as it is now" : `An arrangement for ${project}`))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.name).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(cols.length ? `${cols.length} ${cols.length === 1 ? "column" : "columns"}, left to right` : "Reading the tab"))
        // One rule per column; a stack's panes sit on the same rule.
        .child(v_flex().gap(10).children(cols.map((c, ci) => h_flex().w_full().gap(10).items_stretch()
          .child(div().w(2).flex_none().rounded_full().bg(t.border))
          .child(v_flex().flex_1().min_w(0).gap(4).children(c.panes.map((q) => line(q, `${ci}-${i++}`)))))))
        .child(note("Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh."))
        .when(Boolean(replaces), (el) => el.child(note(`This replaces the arrangement named ${replaces?.name}.`, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ar-back", "Back", false, true, (cx) => { this.view = "list"; this.target = null; cx.notify(); }))
          .child(button("ar-save", replaces ? "Overwrite" : "Save", true, Boolean(cols.length), (cx) => this.save(cx))));
    }

    const list = this.list ?? [];
    const others = this.others ?? [];
    const row = (a) => {
      const key = `rm:${a.from}:${a.name}`, armed = this.armed === key, id = `${a.from}:${a.name}`;
      const from = a.from === projectOf(this.space) ? null : originOf(a);
      const n = a.cols.reduce((s, c) => s + c.panes.length, 0);
      return h_flex().id(`ar-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.open(a, cx)))
        .child(svg("mods/kanso-chrome/icons/layers.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .when(Boolean(from), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11.5).text_color(t.dim).child(`from ${from}`))))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(`${n} ${n === 1 ? "pane" : "panes"}: ${summary(a)}`)))
        .when(!this.busy, (el) => el.child(div().id(`ar-ow-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.startSave(cx, a); })
          .child("Overwrite")))
        .child(div().id(`ar-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => this.remove(a, cx)); })
          .child(armed ? "Press again to delete" : "Delete"));
    };
    const label = (text) => div().pt(12).pb(4).px(10).text_size(11.5).text_color(t.dim).child(text);
    const asleep = this.asleep ?? [];
    const groups = [...asleep.reduce((m, a) => m.set(a.from, [...(m.get(a.from) ?? []), a]), new Map())];
    const spaceName = (from) => spaces().find((sp) => projectOf(sp) === from)?.name ?? (base(folderOfKey(from)) || "~");
    const when = (ms) => { const d = new Date(ms), today = new Date().toDateString() === d.toDateString(); return today ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };
    const sleeper = (a) => {
      const id = `${a.from}:${a.name}`, key = `forget:${id}`, armed = this.armed === key;
      return h_flex().id(`zz-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.wake(a, cx)))
        .child(svg("mods/kanso-chrome/icons/layers.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`asleep since ${when(a.saved)}`)))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(sleepers(a))))
        .when(!this.busy, (el) => el.child(div().id(`zz-wake-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.foreground)
          .hover((s) => s.opacity(0.8)).on_click((_e, cx) => { cx.stop_propagation(); this.wake(a, cx); }).child("Wake")))
        .child(div().id(`zz-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => cx.spawn(async (cx) => { this.setAsleep(await this.store.woke(a.from, a.name)); cx.notify(); })); })
          .child(armed ? "Press again to forget" : "Forget"));
    };
    return shell
      .child(head("Arrangements", `Opens in ${project}`))
      .child(v_flex().id("ar-list").pt(14).gap(2).max_h(420).overflow_y_scrollbar()
        .when(this.list === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Reading")))
        .when(asleep.length > 0, (el) => el.children(groups.map(([from, tabs]) => v_flex().gap(2)
            .child(h_flex().items_center().child(div().flex_1().child(label(`Asleep in ${spaceName(from)}`)))
              .when(tabs.length > 1 && !this.busy, (el) => el.child(div().id(`zz-all-${from}`).px(16).pt(8).text_size(11.5).text_color(t.foreground).cursor_pointer()
                .hover((s) => s.opacity(0.8)).on_click((_e, cx) => this.wake(tabs[0], cx, tabs.slice(1))).child(`Wake all ${tabs.length}`))))
            .children(tabs.map(sleeper))))
          .when(list.length + others.length > 0, (el) => el.child(label("Arrangements"))))
        .when(this.list !== null && !list.length && !others.length && !asleep.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("No arrangement yet."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Set up a tab the way you work, with your agents, their flags and your servers, then save it to open it again in one click, in this project or any other."))))
        .when(list.length > 0 && others.length > 0 && !asleep.length, (el) => el.child(label("This project")))
        .children(list.map(row))
        .when(others.length > 0, (el) => el.child(label(list.length ? "Other projects, opened here" : "From other projects, opened here")))
        .children(others.map(row)))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ar-close", "Close", false, true, () => closeOverlay(p.overlay)))
        .child(button("ar-sleep-all", `Sleep ${project}`, false, !this.busy && (this.space?.tabs.length ?? 0) > 1, (cx) => this.startSleep(cx, true)))
        .child(button("ar-sleep", "Sleep this tab", false, !this.busy, (cx) => this.startSleep(cx)))
        .child(button("ar-new", "Save this tab", !list.length && !others.length, !this.busy, (cx) => this.startSave(cx))));
  }
}
