// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, shared, hc, props, closeOverlay, theme, home } from "herdr";
import { Store } from "./store.js";
import { base, tilde, captureTab, describe, summary, projectOf, folderOfKey, openTab } from "./tabkit.js";
import { listKey, moveTo } from "./listkeys.js";
import { tryOr } from "./pure.js";
import { skeleton, breathe } from "./ui.js";
const ARM_MS = 4000;

export function listFor(projects, key) {
  const tag = (k) => (projects?.[k] ?? []).map((a) => ({ ...a, from: k }));
  const others = Object.keys(projects ?? {}).filter((k) => k !== key).flatMap(tag)
    .toSorted((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
  return { mine: tag(key), others };
}

export function originOf(a) {
  const cwds = a.cols.flatMap((c) => c.panes).map((p) => p.cwd).filter(Boolean);
  const count = [...new Set(cwds)].map((cwd) => [cwd, cwds.filter((x) => x === cwd).length]);
  const top = count.toSorted((x, y) => y[1] - x[1])[0]?.[0];
  return base(top || folderOfKey(a.from)) || "~";
}

export function rebase(a, folder) {
  return { ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ ...p, cwd: folder || p.cwd })) })) };
}


export default class Arrange extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.view = "list";
    this.list = null;
    this.others = [];
    this.armed = null;
    this.busy = null;
    this.error = null;
    this.name = InputState.new({ placeholder: "Name" });
    this.name.on("submit", (_e, cx) => this.save(cx));
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.space = spaces().find((s) => s.active) ?? null;
    this.store = new Store(cx.timer);
    this.target = null;
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

  startSave(cx, a = null) {
    const tab = this.space?.tabs.find((t) => t.active);
    this.view = "save"; this.capture = null; this.error = null;
    this.target = a ? { project: a.from, name: a.name } : null;
    this.name.set_value(a ? a.name : tab?.named ? tab.name : `Arrangement ${(this.list?.length ?? 0) + 1}`);
    this.name.focus();
    cx.notify();
    const tabPanes = panes().filter((p) => p.tab === tab?.id && p.terminal);
    cx.spawn(async (cx) => {
      // A terminal whose record can't be read is left as a shell.
      const read = await Promise.all(tabPanes.map(async (p) => {
        const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
        const rec = r?.code === 0 ? tryOr(() => [JSON.parse(r.stdout)]) : null;
        return rec ? [[p.terminal, rec[0]]] : [];
      }));
      const recs = new Map(read.flat());
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

  open(saved, cx) {
    if (this.busy || !this.space) return;
    const a = saved.from && saved.from !== projectOf(this.space) ? rebase(saved, this.space.folder || home()) : saved;
    this.busy = "Opening"; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        await openTab(a, cx, { space: this.space, progress: (text) => { this.busy = text; cx.notify(); } });
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

  // The pending g (for gg) is kept on the view between keys.
  listed(e) {
    const { move, gAt } = listKey(e, this.listG);
    this.listG = gAt;
    return move;
  }

  listBones(t) {
    const { block, line } = skeleton({ border: t.border });
    const row = (i) => h_flex().w_full().px(10).py(8).gap(10).items_center()
      .child(block(15, 15, 4))
      .child(v_flex().flex_1().gap(2).child(line([120, 96, 140, 84][i], 13)).child(line([180, 150, 100, 160][i], 11)));
    return breathe(v_flex().id("kanso-skeleton").w_full().gap(2)).children([0, 1, 2, 3].map(row));
  }

  captureBones(t) {
    const { line } = skeleton({ border: t.border });
    const col = (i) => h_flex().w_full().gap(10).items_stretch()
      .child(div().w(2).flex_none().rounded_full().bg(t.border))
      .child(v_flex().flex_1().gap(4).child(line([140, 100][i], 12)).child(line([90, 120][i], 11)));
    return breathe(v_flex().id("kanso-skeleton").w_full().gap(10)).children([0, 1].map(col));
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
        // Not in the save view: its name field takes letters.
        const move = this.view !== "save" ? this.listed(e) : (e.key === "escape" ? "escape" : null);
        if (!move) return;
        if (move !== "escape") {
          const order = this.order ?? [];
          if (move === "enter") { if (!this.busy && order[this.at ?? 0]) this.open(order[this.at ?? 0], cx); }
          else if (move !== "pending") this.at = moveTo(move, this.at ?? 0, order.length);
          cx.stop_propagation(); cx.notify(); return;
        }
        if (this.view === "save") { this.view = "list"; this.target = null; cx.notify(); } else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

    if (this.view === "save") {
      const cols = this.capture?.cols ?? [];
      const line = (q, i) => h_flex().id(`cap-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.argv ? t.foreground : t.muted).child(describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(tilde(q.cwd)));
      const starts = cols.map((_, ci) => cols.slice(0, ci).reduce((s, c) => s + c.panes.length, 0));
      const typed = this.name.value().trim(), tg = this.target;
      const replaces = (tg && tg.name === typed) ? tg : (this.list ?? []).some((a) => a.name === typed) ? { name: typed } : null;
      return shell
        .child(head(tg ? `Overwrite ${tg.name}` : "Save this tab", tg ? "With this tab as it is now" : `An arrangement for ${project}`))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.name).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(cols.length
          ? div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(`${cols.length} ${cols.length === 1 ? "column" : "columns"}, left to right`)
          : this.captureBones(t))
        .when(cols.length > 0, (el) => el.child(v_flex().gap(10).children(cols.map((c, ci) => h_flex().w_full().gap(10).items_stretch()
          .child(div().w(2).flex_none().rounded_full().bg(t.border))
          .child(v_flex().flex_1().min_w(0).gap(4).children(c.panes.map((q, ri) => line(q, `${ci}-${starts[ci] + ri}`))))))))
        .child(note("Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh."))
        .when(Boolean(replaces), (el) => el.child(note(`This replaces the arrangement named ${replaces?.name}.`, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ar-back", "Back", false, true, (cx) => { this.view = "list"; this.target = null; cx.notify(); }))
          .child(button("ar-save", replaces ? "Overwrite" : "Save", true, Boolean(cols.length), (cx) => this.save(cx))));
    }

    const list = this.list ?? [];
    const others = this.others ?? [];
    this.order = [...list, ...others];
    const at = this.order[Math.min(this.at ?? 0, Math.max(0, this.order.length - 1))];
    const row = (a) => {
      const key = `rm:${a.from}:${a.name}`, armed = this.armed === key, id = `${a.from}:${a.name}`;
      const from = a.from === projectOf(this.space) ? null : originOf(a);
      const n = a.cols.reduce((s, c) => s + c.panes.length, 0);
      return h_flex().id(`ar-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(a === at, (el) => el.bg(t.selected))
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
    return shell
      .child(head("Arrangements", `Opens in ${project}`))
      // The list's content in a column that never shrinks: past 420 it scrolls.
      .child(v_flex().id("ar-list").pt(14).max_h(420).overflow_y_scrollbar().child(v_flex().flex_none().w_full().gap(2)
        .when(this.list === null, (el) => el.child(this.listBones(t)))
        .when(this.list !== null && !list.length && !others.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("No arrangement yet."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Set up a tab the way you work, with your agents, their flags and your servers, then save it to open it again in one click, in this project or any other."))))
        .when(list.length > 0 && others.length > 0, (el) => el.child(label("This project")))
        .children(list.map(row))
        .when(others.length > 0, (el) => el.child(label(list.length ? "Other projects, opened here" : "From other projects, opened here")))
        .children(others.map(row))))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ar-close", "Close", false, true, () => closeOverlay(p.overlay)))
        .child(button("ar-new", "Save this tab", !list.length && !others.length, !this.busy, (cx) => this.startSave(cx))));
  }
}
