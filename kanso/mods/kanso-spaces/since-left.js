import { tokens } from "./ui.js";
import { phrase, plus } from "./kit.js";
import { activity, awayMax } from "./activity.js";
import { present, focusedTarget, MAINTENANCE_MS } from "./since-left-model.js";
import { SinceStore } from "./since-left-store.js";
import { duration } from "./agents.js";

export class SinceLeft {
  constructor(db, redraw = (cx) => cx.notify()) {
    this.store = new SinceStore(db);
    this.redraw = redraw;
    this.clear();
  }

  // Nothing shown any more: the list starts empty again.
  clear() {
    this.project = null;
    this.rows = [];
    this.expanded = false;
  }

  leave() {
    this.clear();
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
        this.redraw(cx);
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
    const through = Math.max(...this.rows.map((row) => row.id));
    this.rows = [];
    this.expanded = false;
    this.redraw(cx);
    await this.store.dismiss(this.project, through);
  }

  viewOf(now = Date.now()) {
    return { now, focus: this.target ?? null, format: duration };
  }

  // The Activity card, or nothing: each row the keyboard can reach is one of the list's stops (`nav`), in screen order;
  // a press goes where it happened (`reach`) and drops the rows, × dismisses them all, +N more (the last stop) shows the rest.
  render(t, project, nav, reach, menu = null) {
    const events = present(this.rows, this.viewOf());
    this.showing = project === this.project && events.length > 0;
    if (!this.showing) return null;
    const max = this.expanded ? events.length : awayMax;
    const goes = events.slice(0, max).map((row) => {
      const to = reach(row);
      return to && ((cx) => { to(); this.dismiss(cx).catch(() => {}); });
    });
    const more = events.length > max ? (cx) => { this.expanded = true; this.redraw(cx); } : null;
    const rings = [...goes.map((go, i) => Boolean(go) && nav(`since-${events[i].id}`, go)), Boolean(more) && nav("since-more", more)];
    const presses = goes.reduce((acc, go, i) => ({ ...acc, [events[i].icon]: [...(acc[events[i].icon] ?? []), go] }), {
      "lu-x": (cx) => this.dismiss(cx).catch(() => {}),
      ...(more ? { [phrase(plus(events.length - max), "more")]: more } : {}),
    });
    const focus = rings.indexOf(true);
    return activity({ events, max, focus })("since-left", tokens(t), { presses, ...(menu ? { onMenu: (_e, cx) => menu(cx) } : {}) });
  }
}
