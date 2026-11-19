import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { systemApi } from "./platform-system.js";
// Memory, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { appHome, theme, nextCommand, readTextFile } from "herdr";
import { G, T, OPACITY, breathe, tokens } from "./ui.js";
import { mark } from "./ui-mark.js";
import { Armed, quietLink, iconButton } from "./ui-button.js";
import { section } from "./ui-section.js";
import { failureBlock, metric, skeletonOf } from "./kit.js";
import { factList } from "./ui-facts.js";
import { segmented } from "./ui-tab.js";
import { Share } from "./share.js";
import { tryOr, tryOrAsync, afterMount, readCommands, num } from "./pure.js";
import { hiddenInLayout } from "./page.js";
import { scrollPage, pageHeader, pageSections, refreshTool, moreLink, barChart, chartColumn, chartRoom } from "./ui-page.js";
import { memorySpec, memoryText } from "./memory-card.js";
import { RANGES, size, span, clock, parseNow, agentsMB, agentMeta, limitsNote, sparkFor, digestHistory, groupAgents, freedEstimate, parseBatch, staleAgents, idleWords, installError, leaveShowAll, unreadable, refreshPlan } from "./model.js";

const MOD = "kanso-guard";
const DATA_DIR = `data/${MOD}`;
const RUNTIME_FILE = `mods/${MOD}/runtime.json`;
const GUARD_FILE = `mods/${MOD}/guard.mjs`;
const TICK_MS = 15_000;
const HISTORY_MS = 60_000;
const BUSY_MS = 90_000;
const AGENT_ROWS = 12;
const EVENT_ROWS = 15;
const HEAVY_ROWS = 6;
const SHARE_NOTE = "Only counts and sizes: no agent names, folders or sessions. The post opens with the image in it.";

// The Node the guard runs under: runtime.json names it, "node" is the fallback.
const runtimeNode = async () => {
  const text = await readTextFile(paths.join(appHome(), RUNTIME_FILE)).catch(() => null);
  const asked = tryOr(() => JSON.parse(text ?? "{}")?.node);
  return typeof asked === "string" && asked.trim() ? asked.trim() : "node";
};

const readNow = async (file) => {
  try {
    return parseNow(await readTextFile(file));
  } catch (error) {
    return unreadable(error);
  }
};

export default class Memory extends View {
  init(_props, cx) {
    this.closed = false;
    this.awake = false;
    this.width = 960;
    this.node = null;
    this.forget();
    this.reading = false;
    this.again = false;
    this.range = "day";
    this.share = new Share(MOD, paths.join(appHome(), DATA_DIR, "share"));
    this.batch = null;
    this.batchSeen = 0; // the finished batch you dismissed
    this.showAll = false;
    this.armed = new Armed();
    this.busy = {};
    this.actionError = null;
    this.timers = [];
    this.ticker = null;

    if (!hiddenInLayout(MOD)) afterMount(cx, (wakeCx) => this.wake(wakeCx));
    readCommands(cx, () => nextCommand(), (command, commandCx) => this.command(command, commandCx), {
      closed: () => this.closed,
      keep: (task) => { this.commandTask = task; },
    });
  }

  // The mod's own commands; a "back" with nothing to leave stops the reader, as a return did before.
  command(raw, cx) {
    const name = String(raw).replace(new RegExp(`^${MOD}\\.`), "");
    if (name === "refresh") this.check(cx);
    else if (name === "open") this.wake(cx);
    else if (name === "back") {
      const next = leaveShowAll(this.showAll);
      if (next === null) return false;
      this.showAll = next;
      cx.notify();
    }
  }

  // Nothing remembered: the next read starts from the files alone.
  forget() {
    this.now = null;
    this.digest = null;
    this.historyAt = 0;
  }

  // Herdr can hand back a handle that is already gone: a cancel is allowed to fail.
  cancelAll(handles) {
    for (const handle of handles) {
      try { handle?.cancel(); } catch { /* already gone */ }
    }
  }

  wake(wakeCx) {
    if (this.closed) return;
    this.awake = true;
    if (!this.ticker) this.ticker = wakeCx.timer.every(TICK_MS, (tickCx) => {
      if (hiddenInLayout(MOD)) { this.sleep(); return; }
      this.read(tickCx);
    });
    this.read(wakeCx);
  }

  // A space switch can bring the page back without a command: wake on the next tick, outside the render pass.
  wakeOnShow(cx) {
    if (this.awake || this.closed || this.waking || hiddenInLayout(MOD)) return;
    this.waking = true;
    cx.timer.after(0, (wakeCx) => this.woken(wakeCx));
  }

  woken(wakeCx) {
    this.waking = false;
    if (!hiddenInLayout(MOD)) this.wake(wakeCx);
  }

  sleep() {
    this.awake = false;
    this.again = false;
    this.cancelAll([this.ticker, this.batchTimer, ...this.timers]);
    this.ticker = null;
    this.timers = [];
    this.forget();
  }

  close() {
    this.closed = true;
    this.cancelAll([this.ticker, this.batchTimer, this.commandTask, ...this.timers]);
  }

  // A press always reads: one already under way is followed by another.
  refresh(cx) {
    if (this.reading) this.again = true;
    else this.read(cx);
  }

  read(cx) {
    if (this.closed || !this.awake || this.reading) return;
    this.reading = true;
    cx.spawn(async (readCx) => {
      const dir = paths.join(appHome(), DATA_DIR);
      const now = await readNow(paths.join(dir, "now.json"));
      const last = this.digest;
      // A history.json that can't be read keeps the last digest.
      const fresh = now.data && (!last || Date.now() - this.historyAt >= HISTORY_MS)
        ? await tryOrAsync(async () => {
          const read = digestHistory(await readTextFile(paths.join(dir, "history.json")), Date.now(), now.data.limits?.lowFreePct ?? null);
          this.historyAt = Date.now();
          return { read };
        })
        : null;
      const digest = fresh ? fresh.read : last;
      const batch = await tryOrAsync(async () => parseBatch(await readTextFile(paths.join(dir, "batch.json"))), null);
      const installing = this.busy.install;
      const installFailure = installing ? installError(await tryOrAsync(() => readTextFile(paths.join(dir, "install.json"))), installing.at) : null;
      this.reading = false;
      const again = this.again;
      this.again = false;
      if (this.closed || !this.awake) return;
      const before = this.picture();
      this.now = now;
      this.digest = digest;
      this.batch = batch && batch.at !== this.batchSeen ? batch : null;
      if (installFailure) { this.actionError = installFailure; delete this.busy.install; }
      this.settle();
      // One follow-up timer at most, never a chain per read.
      try { this.batchTimer?.cancel(); } catch { /* already gone */ }
      this.batchTimer = this.batch && !this.batch.finished ? readCx.timer.after(4000, (timerCx) => { this.batchTimer = null; this.read(timerCx); }) : null;
      if (this.picture() !== before) readCx.notify();
      if (again) this.read(readCx);
    });
  }

  picture() {
    return JSON.stringify([this.now, this.digest, this.batch, this.actionError, this.busy]);
  }

  settle() {
    const data = this.now?.data;
    for (const [key, b] of Object.entries(this.busy)) {
      if (key === "batch") { // a batch takes minutes: done when its file says so
        if ((this.batch?.finished && this.batch.at >= b.at - 5000) || Date.now() - b.at > 20 * 60_000) delete this.busy[key];
        continue;
      }
      if (Date.now() - b.at > BUSY_MS || (data && b.done(data, this.now.state))) delete this.busy[key];
    }
  }

  // Detached, so exec's 30 s limit never applies to the guard.
  act(key, args, done, cx) {
    // One action at a time: two recycles never race each other.
    if (!localService(systemApi).memoryGuardAvailable || this.closed || this.busy[key] || Object.keys(this.busy).some((k) => k !== "check")) return;
    this.actionError = null;
    this.busy[key] = { at: Date.now(), done };
    cx.notify();
    cx.spawn(async (actCx) => {
      try {
        if (!this.node) this.node = await runtimeNode();
        const result = await localService(systemApi).guardRun(this.node, paths.join(appHome(), GUARD_FILE), args, appHome());
        if (result.code !== 0) throw new Error(result.stderr || "Memory could not start");
      } catch (error) {
        this.actionError = String(error.message || error);
        delete this.busy[key];
      }
      if (this.closed || !this.awake) return;
      const timers = [...this.timers, ...[3000, 8000, 20_000].map((ms) => actCx.timer.after(ms, (timerCx) => { this.historyAt = 0; this.read(timerCx); }))];
      const extra = Math.max(0, timers.length - 12);
      this.cancelAll(timers.slice(0, extra));
      this.timers = timers.slice(extra);
      actCx.notify();
    });
  }

  check(cx) {
    const since = this.now?.data?.at ?? 0;
    this.act("check", ["check"], (data) => data.at > since, cx);
  }

  turnOn(cx) { this.act("install", ["install"], (_d, state) => state === "ok", cx); }

  recycle(a, cx) { this.act(`recycle:${a.pid}`, ["recycle", String(a.pid)], (data) => !data.agents.some((x) => x.pid === a.pid), cx); }

  recycleAll(overMB, cx) { this.batchSeen = 0; this.act("batch", ["recycle-all", String(overMB || 0)], () => false, cx); }

  closeAgent(a, cx) { this.act(`close:${a.pid}`, ["close", String(a.pid)], (data) => !data.agents.some((x) => x.pid === a.pid), cx); }

  closeStale(minIdle, cx) { this.batchSeen = 0; this.act("batch", ["close-stale", String(minIdle)], () => false, cx); }

  restartWindow(cx) {
    const pid = this.now?.data?.window?.pid;
    this.act("restart", ["restart-window"], (data) => data.window?.pid !== pid, cx);
  }

  reap(cx) { this.act("reap", ["reap"], (data) => !data.helpers, cx); }

  render(cx) {
    this.wakeOnShow(cx);
    const c = tokens(theme());
    if (!localService(systemApi).memoryGuardAvailable) return v_flex().size_full().p(G.xl).text_size(T.card).text_color(c.muted).child(localService(systemApi).memoryGuardReason);
    const narrow = (this.width || 960) < 560;
    const state = this.now?.state;
    const body = !this.now ? this.skeleton(c)
      : state === "off" || state === "bad" ? this.offView(c, state)
        : this.mainView(c, narrow);
    return scrollPage.call(this, "guard-root", c, narrow, (column) => column
      .child(this.header(c, narrow))
      .when(this.share.open && this.canShare(), (el) => el.child(this.share.row(c, () => this.shareCard(), SHARE_NOTE, G.sm)))
      .when(Boolean(this.actionError), (el) => el.child(failureBlock({ text: this.actionError })("guard-failed", c)))
      .child(body), { always: true });
  }

  canShare() { return this.now?.state === "ok" && Boolean(this.now.data); }

  shareCard() {
    return { spec: memorySpec(this.now.data, this.digest), text: memoryText(this.now.data, this.digest), name: "memory", title: "Memory" };
  }

  header(c, narrow) {
    const at = this.now?.data?.at;
    const { header } = refreshPlan(this);
    return pageHeader(div().text_size(narrow ? 17 : T.page).text_color(c.text).child(this.now?.data?.metric === "working set" ? "Memory · working set" : "Memory"), [
      this.canShare() ? iconButton("guard-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open }) : null,
      refreshTool("guard-refresh", c, { ...header, working: "Checking…", stamp: at ? `checked ${clock(at)}` : "" }, (cx) => this.check(cx)),
    ]);
  }

  skeleton(c) {
    return v_flex().w_full().gap(G.xl).child(skeletonOf({ shape: "metric" })("kanso-skeleton", c)).child(skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton-rows", c));
  }

  offView(c, state, narrow) {
    const busy = Boolean(this.busy.install);
    const { failure, inline } = refreshPlan(this);
    return v_flex().w_full().gap(G.md)
      .child(metric({ value: state === "bad" ? "Unreadable" : "Off", tone: "muted" })("guard-off", c))
      .child(h_flex().gap(G.lg).items_center()
        .child(quietLink("guard-on", busy ? "Turning on…" : "Turn on", (cx) => { if (!busy) this.turnOn(cx); }, c, { color: c.text }))
        .when(inline, (el) => el.child(quietLink("guard-reread", "Refresh", (cx) => this.refresh(cx), c))))
      .when(Boolean(failure), (el) => el.child(failureBlock(failure)("guard-unreadable", c, { onClick: (cx) => this.refresh(cx) })));
  }

  mainView(c, narrow) {
    const data = this.now.data;
    const stale = this.now.state === "stale";
    const events = data.events.filter((e) => e.text !== data.window?.reason);
    return pageSections(narrow)
      .when(stale, (el) => el.child(h_flex().w_full().gap(G.lg).items_center()
        .child(div().text_size(T.value).text_color(c.red).child(`Stopped at ${clock(data.at)}`))
        .child(quietLink("guard-on", this.busy.install ? "Turning on…" : "Turn on", (cx) => { if (!this.busy.install) this.turnOn(cx); }, c, { color: c.text }))))
      .child(pageSections(narrow).opacity(stale ? OPACITY.away : 1)
        .child(this.hero(c, data, narrow))
        .child(this.chart(c))
        .child(this.agents(c, data))
        .when(data.heaviest.length > 0, (el) => el.child(this.heaviest(c, data)))
        .when(events.length > 0, (el) => el.child(this.events(c, { ...data, events })))
        .child(div().text_size(T.micro).text_color(c.dim).child(limitsNote(data.limits))));
  }

  hero(c, data, narrow) {
    const m = data.machine, w = data.window, l = data.limits;
    const free = typeof m.freePct === "number" ? Math.round(m.freePct) : null;
    const low = free !== null && typeof l.lowFreePct === "number" && free < l.lowFreePct;
    const swap = typeof m.swapMB === "number" ? `${size(m.swapMB)} ${data.swapLabel || "swap"}${m.swapTotalMB ? ` of ${size(m.swapTotalMB)}` : ""}` : null;
    const totals = this.digest?.totals;
    const windowHot = Boolean(w.oom) || (typeof w.mb === "number" && typeof l.windowMB === "number" && w.mb > l.windowMB);
    const stats = [
      { value: size(w.pid ? w.mb : undefined), unit: w.oom ? "window, out of memory" : windowHot ? "window, over its limit" : "window" },
      { value: size(data.core.mb), unit: "core" },
      { value: size(agentsMB(data)), unit: `${data.agents.length} ${data.agents.length === 1 ? "agent" : "agents"}` },
      totals ? { value: String(totals.recycles), unit: totals.recycles === 1 ? "recycle" : "recycles" } : null,
      totals && totals.closed ? { value: String(totals.closed), unit: "closed" } : null,
      totals ? { value: String(totals.restarts), unit: totals.restarts === 1 ? "restart" : "restarts" } : null,
      totals && totals.freedMB > 0 ? { value: size(totals.freedMB), unit: totals.since ? `freed since ${clock(totals.since)}` : "freed" } : null,
    ].filter(Boolean);
    const unit = [data.paused ? "free, paused" : "free", m.totalMB ? `of ${size(m.totalMB)}` : null].filter(Boolean).join(" ");
    return v_flex().w_full().gap(G.xl)
      .child(metric({ value: free === null ? "–" : `${free}%`, unit: [unit, swap].filter(Boolean).join(" · "), facts: factList(stats), tone: low ? "blocked" : "" })("guard-metric", c))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).items_center()
        .when(Boolean(w.pid), (el) => el.child(quietLink("guard-restart", this.busy.restart ? "Restarting the window…" : "Restart window",
          (cx) => { if (!this.busy.restart) this.restartWindow(cx); }, c)))
        .when(data.helpers > 0 || Boolean(this.busy.reap), (el) => el.child(this.armed.link("guard-reap",
          this.busy.reap ? "Cleaning up…" : `Clean up ${data.helpers} hung ${data.helpers === 1 ? "helper" : "helpers"}`, `end ${data.helpers}`,
          "reap", (cx) => this.reap(cx), c, { disabled: Boolean(this.busy.reap) }))))
      .when(Boolean(w.reason), (el) => el.child(div().text_size(T.body).text_color(c.muted).child(w.reason)));
  }

  chart(c) {
    const height = 96;
    const series = this.digest?.series?.[this.range];
    return barChart(c, {
      head: this.chartHead(c, series),
      columns: (series?.bars ?? []).map((bar) => this.chartBar(bar, height, c)),
      room: chartRoom(height),
      axis: [series?.first ?? "", "Free", series?.last ?? ""],
    });
  }

  chartHead(c, series) {
    return h_flex().w_full().items_center().justify_between().gap(G.md).pb(G.xs)
      .child(segmented("guard-range", RANGES.map((r) => ({ key: r.key, label: r.label })), this.range, (key, cx) => { this.range = key; cx.notify(); }, c))
      .child(div().text_size(T.body).text_color(c.dim).child(series?.lowest ? `lowest ${series.lowest}` : ""));
  }

  chartBar(bar, height, c) {
    return chartColumn(c, { tip: bar.tip, marked: Boolean(bar.mark), value: bar.value }, chartRoom(height))
      .child(div().w(bar.mark ? 3 : 2).flex_none().rounded_t(1)
        .h(bar.empty ? 1 : Math.max(2, Math.round(bar.ratio * height)))
        .bg(bar.mark ? c.accent : bar.empty ? c.border : bar.low ? c.red : c.muted)
        .opacity(bar.mark || bar.empty ? 1 : OPACITY.quiet));
  }

  spark(c, ratios) {
    return h_flex().h(16).flex_none().items_end().gap(1)
      .children(ratios.map((r) => div().w(2).flex_none().rounded_t(1).h(r > 0 ? Math.max(2, Math.round(r * 16)) : 1).bg(r > 0 ? c.muted : c.border).opacity(r > 0 ? OPACITY.trace : 1)));
  }

  agents(c, data) {
    const list = data.agents;
    const { ready, batchable, working, other } = groupAgents(list, data.focused);
    const limit = data.limits.agentMB;
    const over = num(data.limits.pressureAgentMB) ?? 500;
    const heavy = batchable.filter((a) => a.mb >= over);
    const batchBusy = Boolean(this.busy.batch) || Boolean(this.batch && !this.batch.finished);
    const counts = [
      ready.length ? `${ready.length} ready` : null,
      working.length ? `${working.length} working` : null,
      other.length ? `${other.length} can't be recycled` : null,
    ].filter(Boolean).join(" · ");
    const staleMin = num(data.limits.staleIdleMin) ?? 2880;
    const stale = staleAgents(list, staleMin, data.focused);
    const actions = h_flex().w_full().flex_wrap().gap_x(G.xl).gap_y(G.sm).items_center()
      .when(batchable.length > 0, (el) => el.child(quietLink("guard-recycle-all",
        `Recycle all ${batchable.length} idle · about ${size(freedEstimate(batchable))} back`,
        (cx) => this.recycleAll(0, cx), c, { color: c.text, label: "Recycle every idle agent" })))
      .when(heavy.length > 0 && heavy.length < batchable.length, (el) => el.child(quietLink("guard-recycle-heavy",
        `Only the ${heavy.length} over ${size(over)}`, (cx) => this.recycleAll(over, cx), c)))
      .when(stale.length > 0, (el) => el.child(this.armed.link("guard-close-stale",
        `Close the ${stale.length} not used for ${idleWords(staleMin)} · ${size(stale.reduce((t, a) => t + (a.mb ?? 0), 0))} back`, `close ${stale.length}`,
        "stale", (cx) => this.closeStale(staleMin, cx), c, { label: "Close agents not used for a long time" })));
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().w_full().gap(G.sm)
        .child(section(c, "Agents", list.length ? size(agentsMB(data)) : ""))
        .when(list.length === 0, (el) => el.child(div().text_size(T.body).text_color(c.dim).child("None running.")))
        .when(Boolean(counts), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(counts)))
        .when(Boolean(this.batch), (el) => el.child(this.batchView(c)))
        .when(!batchBusy && (batchable.length > 0 || stale.length > 0), (el) => el.child(actions))
        .when(!batchBusy && ready.length > 0 && batchable.length === 0, (el) => el.child(div().text_size(T.body).text_color(c.dim).child("Only the agent you are on is idle; it is never recycled in bulk."))))
      .when(ready.length > 0, (el) => el.child(this.group(c, "Ready to recycle", ready, { limit, action: !batchBusy })))
      .when(working.length > 0, (el) => el.child(this.group(c, "Working", working, { limit })))
      .when(other.length > 0, (el) => el.child(this.group(c, "Can't be recycled", other, { limit, reason: true })));
  }

  batchView(c) {
    const b = this.batch;
    const closing = b.kind === "close";
    const head = b.error ? b.error
      : b.interrupted ? `Stopped after ${b.done.length} of ${b.total} · ${size(b.freed)} back`
      : b.finished
      ? (b.total ? `${closing ? "Closed" : "Recycled"} ${b.ok} of ${b.total} · ${size(b.freed)} back` : `Nothing was ready to ${closing ? "close" : "recycle"}`)
      : `${closing ? "Closing" : "Recycling"} ${Math.min(b.done.length + 1, b.total)} of ${b.total}${b.current ? ` · ${b.current}` : ""}`;
    return v_flex().w_full().gap(G.xs).py(G.sm)
      .child(h_flex().w_full().items_center().gap(G.sm)
        .when(!b.finished, (el) => el.child(mark(c, { status: "working", size: "sm" })))
        .child(div().flex_1().min_w(0).text_size(T.card).text_color(c.text).child(head))
        .when(b.finished, (el) => el.child(quietLink("guard-batch-dismiss", "Dismiss", (cx) => { this.batchSeen = b.at; this.batch = null; delete this.busy.batch; cx.notify(); }, c))))
      .children(b.done.map((d, i) => h_flex().w_full().items_center().gap(G.md).py(G.hair).id(`guard-batch-${i}`)
        .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(d.ok ? c.muted : c.text).child(d.name ?? d.terminal ?? ""))
        .child(div().flex_none().text_size(T.body).text_color(d.ok ? c.dim : c.red).whitespace_nowrap()
          .child(d.ok ? (closing ? `${size(d.beforeMB)} back` : `${size(d.beforeMB)} → ${size(d.afterMB ?? d.beforeMB)}`) : String(d.why ?? "not done")))))
      .when(Boolean(b.skippedFocused), (el) => el.child(div().text_size(T.micro).text_color(c.dim).child(`The agent you are on (${b.skippedFocused}) was left as it is.`)));
  }

  group(c, title, list, { limit, action = false, reason = false }) {
    const open = this.showAll || list.length <= AGENT_ROWS;
    const shown = open ? list : list.slice(0, AGENT_ROWS);
    return v_flex().w_full()
      .child(h_flex().w_full().items_end().justify_between().pb(G.xs)
        .child(div().text_size(T.body).text_color(c.muted).child(title))
        .child(div().text_size(T.body).text_color(c.dim).child(`${list.length} · ${size(list.reduce((s, a) => s + (a.mb ?? 0), 0))}`)))
      .children(shown.map((a, index) => this.agentRow(c, a, index, { limit, action, reason })))
      .when(list.length > AGENT_ROWS, (el) => el.child(moreLink(`guard-more-${title}`, c, { open: this.showAll, hidden: list.length - AGENT_ROWS },
        (cx) => { this.showAll = !this.showAll; cx.notify(); })));
  }

  agentRow(c, a, index, { limit, action, reason }) {
    const busy = Boolean(this.busy[`recycle:${a.pid}`]);
    const closeKey = `close:${a.pid}`, closing = Boolean(this.busy[closeKey]);
    const closable = a.closeable !== false && a.kind === "claude" && Boolean(a.session) && a.status !== "working" && a.terminal !== this.now?.data?.focused && !(this.busy.batch || (this.batch && !this.batch.finished));
    const spark = sparkFor(this.digest?.sparks, a);
    const over = typeof limit === "number" && typeof a.mb === "number" && a.mb > limit;
    return h_flex().w_full().items_center().gap(G.md).py(G.sm).border_t(1).border_color(c.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().w_full().items_center().gap(G.sm)
          .when(a.status === "working", (el) => el.child(mark(c, { status: "working", size: "sm" })))
          .child(div().flex_1().min_w(0).truncate().text_size(T.value).text_color(reason ? c.muted : c.text).child(a.name || a.kind || String(a.pid))))
        .child(h_flex().w_full().flex_wrap().gap_x(G.md)
          .children([...agentMeta(a), ...(a.terminal && a.terminal === this.now?.data?.focused ? ["you are on it"] : [])]
            .map((part) => div().text_size(T.micro).text_color(c.dim).whitespace_nowrap().child(part))))
        .when(reason && Boolean(a.why), (el) => el.child(div().text_size(T.micro).text_color(c.dim).child(a.why))))
      .child(v_flex().flex_none().items_end().gap(G.hair)
        .child(h_flex().items_center().gap(G.md)
          .when(Boolean(spark), (el) => el.child(this.spark(c, spark.ratios)))
          .child(div().text_size(T.title).font_light().text_color(over ? c.yellow : reason ? c.muted : c.text).whitespace_nowrap().child(size(a.mb))))
        .child(h_flex().gap(G.md).items_center()
          .when(closable || closing, (el) => el.child(this.armed.link(`guard-close-${a.pid}`, closing ? "Closing…" : "Close", "close",
            closeKey, (cx) => this.closeAgent(a, cx), c, { color: c.dim, disabled: closing, label: `Close ${a.name || a.pid}` })))
          .when((action && a.recyclable) || busy, (el) => el.child(quietLink(`guard-recycle-${a.pid}`, busy ? "Recycling…" : "Recycle",
            (cx) => { if (!busy) this.recycle(a, cx); }, c, { label: `Recycle ${a.name || a.pid}` })))));
  }

  heaviest(c, data) {
    return v_flex().w_full().gap(G.xs)
      .child(section(c, "Heaviest", ""))
      .children(data.heaviest.slice(0, HEAVY_ROWS).map((p) => h_flex().w_full().items_end().gap(G.md).py(5)
        .child(div().flex_1().min_w(0).truncate().text_size(T.value).text_color(c.muted).child(p.name || String(p.pid)))
        .child(div().text_size(T.micro).text_color(c.dim).child(typeof p.ageMin === "number" ? `up ${span(p.ageMin)}` : ""))
        .child(div().min_w(64).text_right().text_size(T.title).font_light().text_color(c.text).child(size(p.mb)))));
  }

  events(c, data) {
    const tone = { error: c.red, recycle: c.text, close: c.text, restart: c.text, reap: c.muted, low: c.yellow, skip: c.dim };
    return v_flex().w_full().gap(G.xs)
      .child(section(c, "Events", ""))
      .children(data.events.slice(0, EVENT_ROWS).map((e) => h_flex().w_full().items_start().gap(G.md).py(3)
        .child(div().w(92).flex_none().text_size(T.micro).text_color(c.dim).child(clock(e.at)))
        .child(div().flex_1().min_w(0).text_size(T.body).line_height(1.4).text_color(tone[e.kind] ?? c.muted).child(String(e.text ?? "")))));
  }
}
