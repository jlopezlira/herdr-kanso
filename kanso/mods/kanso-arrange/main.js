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
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, shared, setShared, hc, run, props, closeOverlay, theme, home } from "herdr";
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
export function captureTab(state, tabPanes, recs) {
  const byId = new Map(tabPanes.map((p) => [p.pane, p]));
  const cols = (state?.cols?.length ? state.cols : tabPanes.map((p) => ({ panes: [p.pane], w: 1 / Math.max(1, tabPanes.length) })))
    .map((c) => ({ w: c.w, panes: c.panes.map((id) => byId.get(id)).filter(Boolean).map((p) => {
      const rec = recs.get(p.terminal);
      return { argv: commandOf(rec), cwd: rec?.foreground?.cwd || p.cwd || null };
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
    this.space = spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    this.target = null; // { project, name } an Overwrite replaces
    cx.spawn(async (cx) => {
      try { this.take(await this.store.all()); }
      catch (e) { this.list = []; this.error = String(e?.message ?? e); }
      cx.notify();
    });
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
  open(a, cx) {
    if (this.busy) return;
    if (a.from && a.from !== projectOf(this.space)) a = rebase(a, this.space?.folder || home());
    const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
    if (!flat.length || !this.space) return;
    this.busy = `Opening 1 of ${flat.length}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
        let seen = new Set(panes().map((q) => q.pane));
        run("tab.new", { space: this.space.id, name: a.name, ...opts(flat[0]) });
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
        closeOverlay(props()?.overlay);
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
        if (this.view === "save") { this.view = "list"; this.target = null; cx.notify(); } else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

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
            .child(div().flex_shrink().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
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
    return shell
      .child(head("Arrangements", `Opens in ${project}`))
      .child(v_flex().id("ar-list").pt(14).gap(2).max_h(420).overflow_y_scrollbar()
        .when(this.list === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Reading")))
        .when(this.list !== null && !list.length && !others.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("No arrangement yet."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Set up a tab the way you work, with your agents, their flags and your servers, then save it to open it again in one click, in this project or any other."))))
        .when(list.length > 0 && others.length > 0, (el) => el.child(label("This project")))
        .children(list.map(row))
        .when(others.length > 0, (el) => el.child(label(list.length ? "Other projects, opened here" : "From other projects, opened here")))
        .children(others.map(row)))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ar-close", "Close", false, true, () => closeOverlay(p.overlay)))
        .child(button("ar-new", "Save this tab", !list.length && !others.length, !this.busy, (cx) => this.startSave(cx))));
  }
}
