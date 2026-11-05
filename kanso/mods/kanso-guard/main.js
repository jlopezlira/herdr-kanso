// Memory, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Memory: what the guard (guard.mjs, a launchd job every 60 s) sees and does
// in a weeks-long session: memory free, the window, herdr-core, every agent's
// footprint, what it recycled, restarted and cleaned up. This view only reads
// the two files the guard writes (no process to read them) and starts the
// guard detached for a manual action, then reads again.
//
// It works only while shown, like Spend: hidden or closed, it runs nothing.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, appHome, theme, nextCommand, readTextFile, layout } from "herdr";
import { G, PULSE, breathe, Armed, tokens, quietTabs, quietLink, iconButton, section, ghost } from "./ui.js";
import { RANGES, size, span, clock, parseNow, agentsMB, agentMeta, limitsNote, sparkFor, digestHistory } from "./model.js";

// The folder name: change it here if you install the mod under another name.
const MOD = "kanso-guard";
const DATA_DIR = `data/${MOD}`;
const RUNTIME_FILE = `mods/${MOD}/runtime.json`;
const GUARD_FILE = `mods/${MOD}/guard.mjs`;
const TICK_MS = 15_000;
const HISTORY_MS = 60_000;
const BUSY_MS = 90_000; // an action's "…" gives way after this, done or not
const AGENT_ROWS = 12;
const EVENT_ROWS = 15;
const HEAVY_ROWS = 6;

/**
 * True when this mod's block is in the layout but not on screen: under a
 * hidden node, or in a stack showing another child (as Spend's).
 */
function hiddenInLayout() {
  try {
    const path = [];
    const walk = (node) => {
      path.push(node);
      if (node?.content?.mod === MOD) return true;
      for (const child of node?.children ?? []) if (walk(child)) return true;
      path.pop();
      return false;
    };
    if (!walk(layout())) return false;
    return path.some((node, index) => node.hidden
      || (node.type === "stack" && node.active && path[index + 1] && node.active !== path[index + 1].id));
  } catch {
    return false;
  }
}

export default class Memory extends View {
  init(_props, cx) {
    this.closed = false;
    this.awake = false;
    this.width = 960;
    this.node = null;
    this.now = null; // parseNow(): { state, data }
    this.digest = null; // digestHistory()
    this.historyAt = 0;
    this.reading = false;
    this.range = "day";
    this.showAll = false;
    this.armed = new Armed();
    this.busy = {}; // action key -> { at, done(data) }
    this.timers = [];
    this.ticker = null;

    if (!hiddenInLayout()) this.wake(cx);

    this.commandTask = cx.spawn(async (commandCx) => {
      for (;;) {
        let command;
        try {
          command = await nextCommand();
          commandCx.notify();
        } catch {
          break;
        }
        const name = String(command).replace(new RegExp(`^${MOD}\\.`), "");
        if (name === "refresh") this.check(commandCx);
        else if (name === "open") this.wake(commandCx);
        else if (name === "back") { this.armed.clear(); this.showAll = false; commandCx.notify(); }
      }
    });
  }

  /** Shown: read now, then every 15 s while visible. */
  wake(cx) {
    if (this.closed) return;
    this.awake = true;
    if (!this.ticker) {
      this.ticker = cx.timer.every(TICK_MS, (tickCx) => {
        if (hiddenInLayout()) { this.sleep(); return; }
        this.read(tickCx);
      });
    }
    this.read(cx);
  }

  /** Hidden: no timer, nothing kept. */
  sleep() {
    this.awake = false;
    for (const handle of [this.ticker, ...this.timers]) {
      try { handle?.cancel(); } catch { /* already gone */ }
    }
    this.ticker = null;
    this.timers = [];
    this.now = null;
    this.digest = null;
    this.historyAt = 0;
  }

  close() {
    this.closed = true;
    for (const handle of [this.ticker, this.commandTask, ...this.timers]) {
      try { handle?.cancel(); } catch { /* already gone */ }
    }
  }

  /** Reads now.json, and history.json once a minute. Files only, no process. */
  read(cx) {
    if (this.closed || !this.awake || this.reading) return; // hidden: nothing is read
    this.reading = true;
    cx.spawn(async (readCx) => {
      const dir = `${appHome()}/${DATA_DIR}`;
      let now;
      try { now = parseNow(await readTextFile(`${dir}/now.json`)); } catch { now = { state: "bad", data: null }; }
      let digest = this.digest;
      if (now.data && (!digest || Date.now() - this.historyAt >= HISTORY_MS)) {
        try {
          digest = digestHistory(await readTextFile(`${dir}/history.json`), Date.now(), now.data.limits?.lowFreePct ?? null);
          this.historyAt = Date.now();
        } catch { /* keep the last one */ }
      }
      this.reading = false;
      if (this.closed || !this.awake) return;
      this.now = now;
      this.digest = digest;
      this.settle();
      readCx.notify();
    });
  }

  /** Drops an action's "…" once the guard shows it done, or after a while. */
  settle() {
    const data = this.now?.data;
    for (const [key, b] of Object.entries(this.busy)) {
      if (Date.now() - b.at > BUSY_MS || (data && b.done(data, this.now.state))) delete this.busy[key];
    }
  }

  /**
   * Starts the guard detached (so exec's 30 s limit never applies) and reads
   * again a few seconds later, and once more after that.
   */
  act(key, args, done, cx) {
    if (this.closed || this.busy[key]) return;
    this.busy[key] = { at: Date.now(), done };
    cx.notify();
    cx.spawn(async (actCx) => {
      try {
        if (!this.node) {
          const raw = await readTextFile(`${appHome()}/${RUNTIME_FILE}`).catch(() => null);
          let node = "node";
          try { const v = JSON.parse(raw ?? "{}")?.node; if (typeof v === "string" && v.trim()) node = v.trim(); } catch { /* the default */ }
          this.node = node;
        }
        await exec("sh", ["-c", 'nohup "$0" "$@" >/dev/null 2>&1 &', this.node, `${appHome()}/${GUARD_FILE}`, ...args]);
      } catch {
        delete this.busy[key];
      }
      if (this.closed || !this.awake) return; // hidden meanwhile: nothing scheduled
      for (const ms of [3000, 8000, 20_000]) {
        this.timers.push(actCx.timer.after(ms, (timerCx) => { this.historyAt = 0; this.read(timerCx); }));
      }
      while (this.timers.length > 12) { try { this.timers.shift()?.cancel(); } catch { /* already gone */ } }
      actCx.notify();
    });
  }

  check(cx) {
    const since = this.now?.data?.at ?? 0;
    this.act("check", ["check"], (data) => data.at > since, cx);
  }

  turnOn(cx) { this.act("install", ["install"], (_d, state) => state === "ok", cx); }

  recycle(a, cx) { this.act(`recycle:${a.pid}`, ["recycle", String(a.pid)], (data) => !data.agents.some((x) => x.pid === a.pid), cx); }

  restartWindow(cx) {
    const pid = this.now?.data?.window?.pid;
    this.act("restart", ["restart-window"], (data) => data.window?.pid !== pid, cx);
  }

  reap(cx) { this.act("reap", ["reap"], (data) => !data.helpers, cx); }

  // -------------------------------------------------------------------------
  // Render

  render(cx) {
    if (!this.awake && !this.closed && !this.waking && !hiddenInLayout()) {
      this.waking = true;
      cx.timer.after(0, (wakeCx) => {
        this.waking = false;
        if (!hiddenInLayout()) this.wake(wakeCx);
      });
    }
    const c = tokens(theme());
    const narrow = (this.width || 960) < 560;
    const state = this.now?.state;
    const body = !this.now ? this.skeleton(c, narrow)
      : state === "off" || state === "bad" ? this.offView(c, state)
        : this.mainView(c, narrow);
    return v_flex().id("guard-root").size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .overflow_y_scrollbar()
      .on_size_change((s, sizeCx) => {
        const changed = Math.abs((this.width || 0) - s.width) >= 1;
        this.width = s.width;
        if (changed) sizeCx.notify();
      })
      .child(h_flex().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(this.header(c, narrow))
          .child(body)));
  }

  header(c, narrow) {
    const busy = Boolean(this.busy.check);
    const at = this.now?.data?.at;
    const tip = busy ? "Checking…" : at ? `Check now · checked ${clock(at)}` : "Check now";
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Memory"))
      .child(iconButton("guard-refresh", "refresh", tip, (cx) => this.check(cx), c, { spin: busy, disabled: busy }));
  }

  /** Loading: the view's own shape, breathing. */
  skeleton(c, narrow) {
    const { block, row } = ghost(c);
    const heights = [40, 44, 42, 46, 50, 48, 52, 38, 30, 26, 34, 42, 48, 54, 56, 52, 50, 46, 44, 48, 52, 50, 46, 44];
    return breathe(v_flex().w_full().gap(narrow ? 36 : 48))
      .child(v_flex().gap(G.md)
        .child(block(narrow ? 120 : 170, narrow ? 40 : 58, 6))
        .child(block(190, 11))
        .child(h_flex().gap(narrow ? G.xl : 48).pt(G.md).children([52, 46, 64, 40].map((w) => block(w, narrow ? 18 : 22, 4)))))
      .child(h_flex().w_full().h(110).items_end()
        .children(heights.map((h) => v_flex().flex_1().min_w(0).items_center().justify_end().child(block(2, h, 1)))))
      .child(v_flex().w_full()
        .child(h_flex().pb(G.sm).child(block(70, 12)))
        .children([0, 1, 2, 3, 4].map(row)));
  }

  offView(c, state, narrow) {
    const busy = Boolean(this.busy.install);
    return v_flex().w_full().gap(G.md)
      .child(div().text_size(narrow ? 22 : 28).font_light().text_color(c.muted).child(state === "bad" ? "Unreadable" : "Off"))
      .child(h_flex().gap(G.lg).items_center()
        .child(quietLink("guard-on", busy ? "Turning on…" : "Turn on", (cx) => { if (!busy) this.turnOn(cx); }, c, { size: 13, color: c.text }))
        .when(state === "bad", (el) => el.child(quietLink("guard-reread", "Read again", (cx) => this.read(cx), c, { size: 13 }))));
  }

  mainView(c, narrow) {
    const data = this.now.data;
    const stale = this.now.state === "stale";
    return v_flex().w_full().gap(narrow ? 36 : 48)
      .when(stale, (el) => el.child(h_flex().w_full().gap(G.lg).items_center()
        .child(div().text_size(12).text_color(c.red).child(`Stopped at ${clock(data.at)}`))
        .child(quietLink("guard-on", this.busy.install ? "Turning on…" : "Turn on", (cx) => { if (!this.busy.install) this.turnOn(cx); }, c, { color: c.text }))))
      .child(v_flex().w_full().gap(narrow ? 36 : 48).opacity(stale ? 0.55 : 1)
        .child(this.hero(c, data, narrow))
        .child(this.chart(c))
        .child(this.agents(c, data))
        .when(data.heaviest.length > 0, (el) => el.child(this.heaviest(c, data)))
        .when(data.events.length > 0, (el) => el.child(this.events(c, data)))
        .child(div().text_size(10.5).text_color(c.dim).child(limitsNote(data.limits))));
  }

  hero(c, data, narrow) {
    const m = data.machine, w = data.window, l = data.limits;
    const free = typeof m.freePct === "number" ? Math.round(m.freePct) : null;
    const low = free !== null && typeof l.lowFreePct === "number" && free < l.lowFreePct;
    const swap = typeof m.swapMB === "number" ? `${size(m.swapMB)} swap${m.swapTotalMB ? ` of ${size(m.swapTotalMB)}` : ""}` : null;
    const totals = this.digest?.totals;
    const windowHot = Boolean(w.oom) || (typeof w.mb === "number" && typeof l.windowMB === "number" && w.mb > l.windowMB);
    const stats = [
      { value: size(w.mb), unit: "window", tip: w.oom ? "Its mod runtime ran out of memory" : null, hot: windowHot },
      { value: size(data.core.mb), unit: "core" },
      { value: size(agentsMB(data)), unit: `${data.agents.length} ${data.agents.length === 1 ? "agent" : "agents"}` },
      totals ? { value: String(totals.recycles), unit: totals.recycles === 1 ? "recycle" : "recycles" } : null,
      totals ? { value: String(totals.restarts), unit: totals.restarts === 1 ? "restart" : "restarts" } : null,
      totals && totals.freedMB > 0 ? { value: size(totals.freedMB), unit: "freed", tip: totals.since ? `Since ${clock(totals.since)}` : null } : null,
    ].filter(Boolean);
    const armedRestart = this.armed.is("restart");
    const armedReap = this.armed.is("reap");
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().gap(G.xs)
        .child(h_flex().flex_wrap().items_end().gap_x(G.md)
          .child(div().text_size(narrow ? 48 : 72).line_height(1).font_light().text_color(low ? c.red : c.text).child(free === null ? "–" : `${free}%`))
          .child(div().pb(narrow ? 6 : 10).text_size(13).text_color(c.dim).child(data.paused ? "free · paused" : "free")))
        .child(div().text_size(15).text_color(c.dim).child([m.totalMB ? `of ${size(m.totalMB)}` : null, swap].filter(Boolean).join(" · "))))
      .child(h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
        .children(stats.map((s) => h_flex().items_end().gap(6).when(Boolean(s.tip), (el) => el.tooltip(s.tip))
          .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(s.hot ? c.red : c.text).child(s.value))
          .child(div().pb(3).text_size(12).text_color(c.dim).child(s.unit)))))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).items_center()
        .child(quietLink("guard-restart", this.busy.restart ? "Restarting the window…" : armedRestart ? "Press again to restart the window" : "Restart window",
          (cx) => { if (!this.busy.restart) this.armed.press("restart", cx, (cx) => this.restartWindow(cx)); }, c, { color: armedRestart ? c.red : c.muted }))
        .when(data.helpers > 0 || Boolean(this.busy.reap), (el) => el.child(quietLink("guard-reap",
          this.busy.reap ? "Cleaning up…" : armedReap ? `Press again to end ${data.helpers}` : `Clean up ${data.helpers} hung ${data.helpers === 1 ? "helper" : "helpers"}`,
          (cx) => { if (!this.busy.reap) this.armed.press("reap", cx, (cx) => this.reap(cx)); }, c, { color: armedReap ? c.red : c.muted }))));
  }

  chart(c) {
    const series = this.digest?.series?.[this.range];
    const height = 96;
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_center().justify_between().gap(G.md).pb(G.xs)
        .child(quietTabs("guard-range", RANGES.map((r) => ({ key: r.key, label: r.label })), this.range, (key, cx) => { this.range = key; cx.notify(); }, c))
        .child(div().text_size(12).text_color(c.dim).child(series?.lowest ? `lowest ${series.lowest}` : "")))
      .child(h_flex().w_full().h(height + 18).items_end()
        .children((series?.bars ?? []).map((bar) => v_flex().flex_1().min_w(0).h(height + 18).items_center().justify_end().gap(4)
          .tooltip(bar.tip)
          .when(Boolean(bar.mark), (el) => el.child(div().text_size(10).text_color(c.text).whitespace_nowrap().child(bar.value)))
          .child(div().w(bar.mark ? 3 : 2).flex_none().rounded_t(1)
            .h(bar.empty ? 1 : Math.max(2, Math.round(bar.ratio * height)))
            .bg(bar.mark ? c.accent : bar.empty ? c.border : bar.low ? c.red : c.muted)
            .opacity(bar.mark || bar.empty ? 1 : 0.55)))))
      .child(h_flex().w_full().justify_between()
        .child(div().text_size(10).text_color(c.dim).child(series?.first ?? ""))
        .child(div().text_size(10).text_color(c.dim).child("Free"))
        .child(div().text_size(10).text_color(c.dim).child(series?.last ?? "")));
  }

  spark(c, ratios) {
    return h_flex().h(16).flex_none().items_end().gap(1)
      .children(ratios.map((r) => div().w(2).flex_none().rounded_t(1).h(r > 0 ? Math.max(2, Math.round(r * 16)) : 1).bg(r > 0 ? c.muted : c.border).opacity(r > 0 ? 0.6 : 1)));
  }

  agents(c, data) {
    const list = data.agents;
    const shown = this.showAll ? list : list.slice(0, AGENT_ROWS);
    const limit = data.limits.agentMB;
    return v_flex().w_full()
      .child(section(c, "Agents", list.length ? size(agentsMB(data)) : ""))
      .when(list.length === 0, (el) => el.child(div().text_size(12).text_color(c.dim).child("None running.")))
      .children(shown.map((a, index) => {
        const key = `recycle:${a.pid}`, armed = this.armed.is(key), busy = Boolean(this.busy[key]);
        const spark = sparkFor(this.digest?.sparks, a);
        const over = typeof limit === "number" && typeof a.mb === "number" && a.mb > limit;
        return h_flex().w_full().items_center().gap(G.md).py(G.sm)
          .when(index > 0, (el) => el.border_t(1).border_color(c.border))
          .child(v_flex().flex_1().min_w(0).gap(3).when(!a.recyclable && Boolean(a.why), (el) => el.tooltip(a.why))
            .child(h_flex().w_full().items_center().gap(G.sm)
              .when(a.status === "working", (el) => el.child(breathe(div().size(5).flex_none().rounded_full().bg(c.accent), PULSE)))
              .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).child(a.name || a.kind || String(a.pid))))
            .child(h_flex().w_full().flex_wrap().gap_x(G.md)
              .children(agentMeta(a).map((part) => div().text_size(11).text_color(c.dim).whitespace_nowrap().child(part)))))
          .child(v_flex().flex_none().items_end().gap(2)
            .child(h_flex().items_center().gap(G.md)
              .when(Boolean(spark), (el) => el.child(this.spark(c, spark.ratios)))
              .child(div().text_size(15).font_light().text_color(over ? c.yellow : c.text).whitespace_nowrap().child(size(a.mb))))
            .when(Boolean(a.recyclable) || busy, (el) => el.child(quietLink(`guard-recycle-${a.pid}`,
              busy ? "Recycling…" : armed ? "Press again" : "Recycle",
              (cx) => { if (!busy) this.armed.press(key, cx, (cx) => this.recycle(a, cx)); }, c,
              { color: armed ? c.red : c.muted, size: 11.5, label: `Recycle ${a.name || a.pid}` }))));
      }))
      .when(list.length > AGENT_ROWS, (el) => el.child(h_flex().pt(G.sm)
        .child(quietLink("guard-agents-more", this.showAll ? "Show fewer" : `Show ${list.length - AGENT_ROWS} more`, (cx) => { this.showAll = !this.showAll; cx.notify(); }, c))));
  }

  heaviest(c, data) {
    return v_flex().w_full().gap(G.xs)
      .child(section(c, "Heaviest", ""))
      .children(data.heaviest.slice(0, HEAVY_ROWS).map((p) => h_flex().w_full().items_end().gap(G.md).py(5)
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.muted).child(p.name || String(p.pid)))
        .child(div().text_size(11).text_color(c.dim).child(typeof p.ageMin === "number" ? `up ${span(p.ageMin)}` : ""))
        .child(div().min_w(64).text_right().text_size(15).font_light().text_color(c.text).child(size(p.mb)))));
  }

  events(c, data) {
    const tone = { error: c.red, recycle: c.text, restart: c.text, reap: c.muted, low: c.yellow, skip: c.dim };
    return v_flex().w_full().gap(G.xs)
      .child(section(c, "Events", ""))
      .children(data.events.slice(0, EVENT_ROWS).map((e) => h_flex().w_full().items_start().gap(G.md).py(3)
        .child(div().w(92).flex_none().text_size(11).text_color(c.dim).child(clock(e.at)))
        .child(div().flex_1().min_w(0).text_size(12).line_height(1.4).text_color(tone[e.kind] ?? c.muted).child(String(e.text ?? "")))));
  }
}
