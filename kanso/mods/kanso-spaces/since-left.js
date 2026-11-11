import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, R, T, ICON, iconButton, tokens } from "./ui.js";
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
    this.heights = [];
    this.headed = false;
  }

  leave() {
    this.project = null;
    this.rows = [];
    this.expanded = false;
    this.showing = false;
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
        this.leave();
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
    if (!this.heights.length) return 0;
    const items = [...this.heights, ...(this.headed ? [agentRowH({}, {})] : [])];
    return items.reduce((sum, h) => sum + h, 0) + (items.length - 1) * ROW_GAP;
  }

  dismissControl(t) {
    return iconButton("since-dismiss", "close", "Dismiss", (cx) => { cx.stop_propagation(); return this.dismiss(cx).catch(() => {}); }, tokens(t));
  }

  line(t, row, nav, reach) {
    const id = `since-${row.id ?? "more"}`;
    const to = row.more ? null : reach(row);
    const go = row.more ? (cx) => { this.expanded = true; cx.notify(); } : to && ((cx) => { to(); this.dismiss(cx).catch(() => {}); });
    const selected = go ? nav(id, go) : false;
    const top = h_flex().gap(G.sm).min_w(0).items_center()
      .child(div().min_w(0).truncate().text_size(row.more ? T.body : T.card).text_color(row.more || !go ? t.dim : t.foreground)
        .when(!row.more, (el) => el.font_medium()).child(row.more ? `+${row.more}` : row.name))
      .when(Boolean(row.outcome), (el) => el.child(div().flex_none().text_size(T.body).text_color(t.muted).child(row.outcome)))
      .child(div().flex_1())
      .when(Boolean(row.age), (el) => el.child(div().flex_none().text_size(T.body).text_color(t.dim).child(row.age)));
    return h_flex().id(id).h(agentRowH({}, { activity: row.did })).w_full().flex_none().pl(AGENT_PAD).pr(G.md).gap(G.md).min_w(0).items_center().rounded(R.card)
      .when(Boolean(go), (el) => el.cursor_pointer().hover((s) => s.bg(t.foreground + "0c")).on_click((_e, cx) => go(cx)))
      .when(selected, (el) => el.border_1().border_color(t.accent))
      .when(!row.more, (el) => el.child(lead(t, row.mark)))
      .child(v_flex().flex_1().min_w(0).justify_center().child(top)
        .when(Boolean(row.did), (el) => el.child(div().min_w(0).truncate().text_size(T.body).text_color(t.dim).child(row.did))));
  }

  render(t, project, nav, reach, head = null) {
    const shown = present(this.rows, this.viewOf());
    this.showing = project === this.project && shown.count > 0;
    this.heights = this.showing ? shown.rows.map((row) => agentRowH({}, { activity: row.did })) : [];
    this.headed = Boolean(head) && this.showing;
    if (!this.showing) return div();
    const body = shown.rows.map((row) => this.line(t, row, nav, reach));
    return v_flex().w_full().gap(ROW_GAP).children(head ? [head(RETURN_LABEL, shown.count, this.dismissControl(t)), ...body] : body);
  }
}
