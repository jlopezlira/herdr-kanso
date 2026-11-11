import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { G, H, R, T, tokens, quietLink, iconButton } from "./ui.js";
import { lines, focusedTarget, MAINTENANCE_MS } from "./since-left-model.js";
import { SinceStore } from "./since-left-store.js";

export class SinceLeft {
  constructor(db) {
    this.store = new SinceStore(db);
    this.project = null;
    this.rows = [];
    this.expanded = false;
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
        if (this.project) await this.store.touch(this.project, now);
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
        if (now - this.touched >= MAINTENANCE_MS) { await this.store.touch(project, now); this.touched = now; }
      }
      if ((project || this.sources?.length) && now - (this.pruned ?? 0) >= MAINTENANCE_MS) { await this.store.prune(now); this.pruned = now; }
    } finally { this.busy = false; }
  }

  async dismiss(cx) {
    if (!this.rows.length) return;
    await this.store.dismiss(this.project, Math.max(...this.rows.map((row) => row.id)));
    this.rows = [];
    this.expanded = false;
    cx.notify();
  }

  lineCount() { return lines(this.rows, this.expanded).length; }

  render(t, project, nav, jump) {
    this.showing = project === this.project && this.rows.length > 0;
    if (!this.showing) return div();
    const c = tokens(t);
    const action = (id, text, go) => {
      const selected = nav(id, go);
      return quietLink(id, text, go, c, { size: T.body }).w_full().min_w(0).overflow_hidden().tooltip(text).justify_start().px(G.sm).rounded(R.control)
        .when(selected, (el) => el.bg(c.selected));
    };
    return v_flex().px(G.sm).pb(G.sm).children(lines(this.rows, this.expanded).map((row, index) => {
      const go = row.more ? (cx) => { this.expanded = true; cx.notify(); }
        : (cx) => { if (jump(row) !== false) this.dismiss(cx).catch(() => {}); };
      return h_flex().h(H.control).items_center().min_w(0)
        .child(action(`since-${row.id ?? "more"}`, row.more ? `+${row.more}` : row.text, go).flex_1())
        .when(index === 0, (el) => el.child(iconButton("since-dismiss", "close", "Dismiss", (cx) => this.dismiss(cx).catch(() => {}), c)));
    }));
  }
}
