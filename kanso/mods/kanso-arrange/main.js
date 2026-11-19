// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, shared, hc, props, closeOverlay, theme, home } from "herdr";
import { Store } from "./store.js";
import { base, tilde, captureTab, describe, summary, projectOf, folderOfKey, openTab } from "./tabkit.js";
import { listKey, moveTo } from "./listkeys.js";
import { tryOr, focusOn } from "./pure.js";
import { T, G, H, tokens } from "./ui.js";
import { Armed } from "./ui-button.js";
import { dialog, statusNotes } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { row } from "./ui-row.js";
import { skeletonOf } from "./kit.js";

const LIST_ROWS = 13;

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
    this.handle = focusOn(cx);
    this.view = "list";
    this.list = null;
    this.others = [];
    this.armed = new Armed();
    this.busy = null;
    this.error = null;
    this.name = new TextField({ placeholder: "Name" });
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

  // The pending g (for gg) is kept on the view between keys.
  listed(e) {
    const { move, gAt } = listKey(e, this.listG);
    this.listG = gAt;
    return move;
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const project = this.space?.name ?? tilde(this.space?.folder);
    const c = tokens(t);
    const said = statusNotes(this);
    const back = (cx) => { this.view = "list"; this.target = null; cx.notify(); };
    const shell = (look) => dialog("kanso-arrange", c, { ...look, focusHandle: this.handle });

    if (this.view === "save") {
      const cols = this.capture?.cols ?? [];
      const line = (q, i) => row(`cap-${i}`, c, { name: describe(q.argv), dimmed: !q.argv, meta: tilde(q.cwd) });
      const starts = cols.map((_, ci) => cols.slice(0, ci).reduce((s, c) => s + c.panes.length, 0));
      const typed = this.name.value().trim(), tg = this.target;
      const replaces = (tg && tg.name === typed) ? tg : (this.list ?? []).some((a) => a.name === typed) ? { name: typed } : null;
      return shell({
        title: tg ? `Overwrite ${tg.name}` : "Save this tab", scope: tg ? "With this tab as it is now" : `An arrangement for ${project}`,
        body: [
          field("ar-name", this.name, c, { label: "Name" }),
          cols.length ? v_flex().pt(G.md).gap(G.md).children(cols.map((c, ci) => h_flex().w_full().gap(G.md).items_stretch()
            .child(div().w(2).flex_none().rounded_full().bg(t.border))
            .child(v_flex().flex_1().min_w(0).gap(G.xs).children(c.panes.map((q, ri) => line(q, `${ci}-${starts[ci] + ri}`)))))) : skeletonOf({ shape: "list row", count: 2 })("kanso-skeleton", c),
        ],
        notes: [...(cols.length ? [{ text: `${cols.length} ${cols.length === 1 ? "column" : "columns"}, left to right` }] : []),
          { text: "Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh." },
          ...(replaces ? [{ text: `This replaces the arrangement named ${replaces.name}.`, tone: "muted" }] : []),
          ...statusNotes({ error: this.error })],
        secondary: "Back", primary: replaces ? "Overwrite" : "Save", state: cols.length ? "default" : "disabled",
        onCancel: back, onPrimary: (cx) => this.save(cx),
      });
    }

    const list = this.list ?? [];
    const others = this.others ?? [];
    this.order = [...list, ...others];
    const at = this.order[Math.min(this.at ?? 0, Math.max(0, this.order.length - 1))];
    const arrangement = (a) => {
      const id = `${a.from}:${a.name}`;
      const from = a.from === projectOf(this.space) ? null : originOf(a);
      const n = a.cols.reduce((s, col) => s + col.panes.length, 0);
      const remove = this.armed.verb("Delete", "delete", `rm:${id}`, (cx) => this.remove(a, cx));
      return row(`ar-${id}`, c, {
        icon: "layers", name: a.name, detail: from ? `from ${from}` : null, second: `${n} ${n === 1 ? "pane" : "panes"}: ${summary(a)}`, current: a === at,
        verbs: this.busy ? [remove] : [{ label: "Overwrite", onClick: (cx) => this.startSave(cx, a) }, remove],
        onClick: this.busy ? null : (cx) => this.open(a, cx),
      });
    };
    const label = (text) => row(`ar-label-${text}`, c, { name: text, heading: true });
    return shell({
      title: "Arrangements", scope: `Opens in ${project}`,
      // The list's content in a column that never shrinks: past LIST_ROWS lines it scrolls.
      body: v_flex().id("ar-list").pt(G.hair).max_h(LIST_ROWS * H.line).mx(-G.sm).px(G.sm).overflow_y_scrollbar().child(v_flex().flex_none().w_full()
        .when(this.list === null, (el) => el.child(skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton", c)))
        .when(this.list !== null && !list.length && !others.length, (el) => el.child(v_flex().py(6).gap(G.xs)
          .child(div().text_size(T.value).text_color(t.muted).child("No arrangement yet."))
          .child(div().text_size(T.body).line_height(1.45).text_color(t.dim).child("Set up a tab the way you work, with your agents, their flags and your servers, then save it to open it again in one click, in this project or any other."))))
        .when(list.length > 0 && others.length > 0, (el) => el.child(label("This project")))
        .children(list.map(arrangement))
        .when(others.length > 0, (el) => el.child(label(list.length ? "Other projects, opened here" : "From other projects, opened here")))
        .children(others.map(arrangement))),
      notes: said,
      primary: "Save this tab", kind: !list.length && !others.length ? "solid" : "tonal", state: this.busy ? "disabled" : "default",
      onPrimary: (cx) => this.startSave(cx), onCancel: () => closeOverlay(p.overlay),
      onKey: (e, cx) => {
        const move = this.listed(e);
        if (!move || (move === "enter" && !this.handle.is_focused())) return;
        const order = this.order ?? [];
        if (move === "enter") { if (!this.busy && order[this.at ?? 0]) this.open(order[this.at ?? 0], cx); }
        else if (move !== "pending") this.at = moveTo(move, this.at ?? 0, order.length);
        cx.stop_propagation(); cx.notify();
      },
    });
  }
}
