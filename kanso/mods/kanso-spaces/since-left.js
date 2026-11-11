import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, R, T, ICON } from "./ui.js";
import { present, RETURN_LABEL, focusedTarget, MAINTENANCE_MS } from "./since-left-model.js";
import { SinceStore } from "./since-left-store.js";
import { statusMark, AGENT_PAD, agentRowH, duration } from "./agents.js";

const ROW_GAP = 1; // the sidebar list's gap; the kit has no token for it

// An error has no glyph; the sidebar draws the blocked disc for a failed agent.
const lead = (t, mark) => (mark === "pr"
  ? svg("mods/kanso-chrome/icons/pull-request.svg").size(ICON).flex_none().text_color(t.muted)
  : statusMark(t, mark === "error" ? "blocked" : mark));

export class SinceLeft {
  constructor(db) {
    this.store = new SinceStore(db);
    this.project = null;
    this.rows = [];
    this.expanded = false;
    this.visible = 0;
    this.headed = false;
  }

  async update({ project, target, seenTarget, snapshots, now }, cx) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (snapshots) {
        await this.store.observe(snapshots, now);
        this.sources = snapshots.map((snapshot) => snapshot.source);
        this.observed = now;
      } else if (this.sources?.length && now - this.observed >= MAINTENANCE_MS) {
        await this.store.touchSources(this.sources, now);
        this.observed = now;
      }
      if (project !== this.project) {
        if (this.project) await this.touch(this.project, now);
        this.rows = [];
        this.expanded = false;
        this.showing = false;
        this.project = null;
        if (project) {
          this.rows = await this.store.enter(project, now);
          this.project = project;
        }
        this.touched = now;
        this.target = target;
        cx.notify();
      } else if (project) {
        if (this.showing && (focusedTarget(this.rows, this.target, target) || this.rows.some((row) => row.target === seenTarget))) await this.dismiss(cx);
        this.target = target;
        if (now - this.touched >= MAINTENANCE_MS) { await this.touch(project, now); this.touched = now; }
      }
      if ((project || this.sources?.length) && now - (this.pruned ?? 0) >= MAINTENANCE_MS) { await this.store.prune(now); this.pruned = now; }
    } finally { this.busy = false; }
  }

  async touch(project, now) {
    const prune = now - (this.pruned ?? 0) >= MAINTENANCE_MS;
    await this.store.touch(project, now, prune);
    if (prune) this.pruned = now;
  }

  async dismiss(cx) {
    if (!this.rows.length) return;
    await this.store.dismiss(this.project, Math.max(...this.rows.map((row) => row.id)));
    this.rows = [];
    this.expanded = false;
    cx.notify();
  }

  viewOf(now = Date.now()) {
    return { now, focus: this.target ?? null, expanded: this.expanded, format: duration };
  }

  lineCount() { return present(this.rows, this.viewOf()).rows.length; }

  blockHeight() {
    const n = this.visible;
    if (!n) return 0;
    const row = agentRowH({}, {});
    const items = n + (this.headed ? 1 : 0);
    return items * row + (items - 1) * ROW_GAP;
  }

  dismissControl(t) {
    return div().id("since-dismiss").size(20).flex_none().rounded(R.control)
      .flex().items_center().justify_center().cursor_pointer().text_color(t.dim).tooltip("Dismiss")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); return this.dismiss(cx).catch(() => {}); })
      .child(svg("mods/kanso-chrome/icons/close.svg").size(G.md).text_color(t.dim));
  }

  render(t, project, nav, jump, head = null) {
    const shown = present(this.rows, this.viewOf());
    this.showing = project === this.project && shown.count > 0;
    this.visible = this.showing ? shown.rows.length : 0;
    this.headed = Boolean(head) && this.showing;
    if (!this.showing) return div();
    const line = (row) => {
      const go = row.more ? (cx) => { this.expanded = true; cx.notify(); }
        : (cx) => { if (jump(row) !== false) this.dismiss(cx).catch(() => {}); };
      const selected = nav(`since-${row.id ?? "more"}`, go);
      return h_flex().id(`since-${row.id ?? "more"}`).h(agentRowH({}, {})).w_full().flex_none().pl(AGENT_PAD).pr(G.md).gap(G.md).min_w(0).items_center().rounded(R.card).cursor_pointer()
        .hover((s) => s.bg(t.foreground + "0c"))
        .when(selected, (el) => el.border_1().border_color(t.accent))
        .on_click((_e, cx) => go(cx))
        .when(!row.more, (el) => el.child(lead(t, row.mark)))
        .child(div().flex_1().min_w(0).truncate().text_size(row.more ? T.body : T.card).text_color(row.more ? t.dim : t.foreground)
          .when(!row.more, (el) => el.font_medium())
          .child(row.more ? `+${row.more}` : row.name))
        .when(Boolean(row.age) && !row.more, (el) => el.child(div().flex_none().text_size(T.body).text_color(t.dim).child(row.age)));
    };
    const body = shown.rows.map(line);
    const dismiss = this.dismissControl(t);
    return v_flex().w_full().gap(ROW_GAP).children(head ? [head(RETURN_LABEL, shown.count, dismiss), ...body] : body);
  }
}
