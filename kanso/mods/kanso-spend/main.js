import { detailColumn, detailRow, scrollPage, pageHeader, pageSections, refreshTool, moreLink, barChart, chartColumn, chartRoom, heroStack, heroHeading } from "./ui-page.js";
import { localService, serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Spend, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// QuickJS runs every step under a time limit, so nothing heavy happens here.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Popover, ScrollHandle } from "gpui-base";
import { exec, appHome, home, theme, nextCommand, readTextFile, writeTextFile, layout, machines, shared, setShared } from "herdr";
import { T, G, H, OPACITY, breathe, tokens } from "./ui.js";
import { mark } from "./ui-mark.js";
import { quietLink, iconButton } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { menu } from "./ui-menu.js";
import { section } from "./ui-section.js";
import { button as kitButton, failureBlock, metric, row, skeletonOf, tooltip } from "./kit.js";
import { factList } from "./ui-facts.js";
import { segmented } from "./ui-tab.js";
import { toggleSwitch } from "./ui-toggle.js";
import { PERIOD_KEY, SPEND_PERIODS, spendPeriod } from "./period.js";
import { Share, shareRows } from "./share.js";
import { spendSpec, spendText } from "./spend-card.js";
import { readPlan, allChoice, chooserOptions, chooserKey } from "./spend-model.js";
import { clock, tryOr, tryOrAsync, afterMount } from "./pure.js";
import { powerOf } from "./sync-power.js";
import { Kdb } from "./kdb.js";
import { EXCHANGE_MS, SYNC_KICK, configFrom, exchangeAll, holdsOf, identityFrom, periodKeyOf, planExchange, probeApi, rowFromCosts, rowsFrom, rowsText, statusFrom, statusText, syncDir, syncOn } from "./sync.js";

const MOD = "kanso-spend";
const RUNTIME_FILE = `mods/${MOD}/runtime.json`;
const PRESENTER_FILE = `mods/${MOD}/presenter.mjs`;
const DATA_DIR = `data/${MOD}`;
// A project or model chooser shows this many, then scrolls.
const CHOOSER_ROWS = 8;
const PAYLOAD_KIND = "kanso-spend-costs";
const PAYLOAD_VERSION = 1;
const STEP_TIMEOUT_MS = 35_000;
const TICK_MS = 15_000;
const REFRESH_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_AT = "kanso.spend.snapshotAt";
const LIST_ROWS = 6;
const TASK_ROWS = 8;

function sanitizeError(error) {
  const raw = error && typeof error === "object" ? (error.message ?? error.error ?? "") : String(error ?? "");
  const text = String(raw).replace(/\s+/g, " ").trim() || "Unknown error";
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

function resultError(result) {
  const text = String(result?.stderr ?? "").trim() || String(result?.stdout ?? "").trim();
  if (!text) return `The collector stopped with code ${result?.code ?? "?"}.`;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /^(?:[A-Za-z][\w.]*Error|Error|error|token-spend|kanso-spend):/.test(line));
  return sanitizeError(errorLine || lines.find((line) => !/^at\s/.test(line)) || text);
}

function parseRuntimeNode(raw) {
  const config = JSON.parse(raw);
  const node = typeof config?.node === "string" ? config.node.trim() : "";
  if (!node || /[\u0000-\u001f\u007f]/.test(node)) throw new Error("runtime.json needs a node path.");
  return node;
}

function projectName(value) {
  const text = String(value ?? "").replace(/[\\/]+$/, "");
  return text.split(/[\\/]/).at(-1) || text || "Unknown project";
}

/** True when this block is in the layout but off screen; Herdr keeps hidden copies (and their timers) alive. */
function hiddenInLayout() {
  try {
    const pathTo = (node) => {
      if (node?.content?.mod === MOD) return [node];
      const below = (node?.children ?? []).reduce((found, child) => found ?? pathTo(child), null);
      return below ? [node, ...below] : null;
    };
    const path = pathTo(layout());
    if (!path) return false; // a pane or overlay: shown whenever it runs
    return path.some((node, index) => node.hidden
      || (node.type === "stack" && node.active && path[index + 1] && node.active !== path[index + 1].id));
  } catch {
    return false;
  }
}

function formatTime(iso) {
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? "" : clock(at, at);
}

function metricLine(c, name, tokensText, value, { color = c.text, tip = "", medium = false } = {}) {
  return detailRow(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(color).when(medium, (el) => el.font_medium()).when(Boolean(tip), (el) => el.tooltip(tooltip({ label: tip }))).child(name))
    .child(div().text_size(T.micro).text_color(c.dim).child(tokensText))
    .child(div().min_w(64).text_right().text_size(T.title).font_light().text_color(c.text).child(value));
}

export default class TokenSpend extends View {
  init(_props, cx) {
    this.closed = false;
    this.width = 960;
    this.nodeBinary = null;
    this.runtimeError = null;
    this.runtimeTask = null;
    this.scan = null;
    this.costs = null;
    this.share = new Share(MOD, paths.join(appHome(), DATA_DIR));
    this.error = null;
    this.running = null;
    this.queued = { snapshot: false, prepare: false };
    this.generation = 0;
    this.task = null;
    this.watchdog = null;
    this.continueTimer = null;
    this.lastSnapshotAt = Number(shared(SNAPSHOT_AT)) || 0;
    this.cost = { period: spendPeriod(shared(PERIOD_KEY)), offset: 0, project: "all", model: "all" };
    this.expanded = {};
    this.page = "home";
    this.stack = [];
    this.settings = null;
    this.planInputs = [];
    this.settingsNote = null;
    this.openMenu = null;
    this.menuOptions = null;
    this.menuAt = -1;
    this.menuG = 0;
    this.chooserFocus = { project: cx.focus_handle(), model: cx.focus_handle() };
    this.chooserScroll = ScrollHandle.new();
    this.syncHolds = [];
    this.syncStored = [];
    this.syncWaiting = false;
    this.syncSettled = null;
    this.syncEnded = 0;
    this.probing = false;
    this.db = new Kdb(cx.timer);
    this.syncKick = shared(SYNC_KICK);

    this.ticker = null;
    this.awake = false;

    // Herdr starts hidden copies too, so wake only when this one is on screen.
    if (!hiddenInLayout()) afterMount(cx, (cx) => this.wake(cx));

    afterMount(cx, (cx) => {
      if (this.closed) return;
      this.commandTask = cx.spawn(async (commandCx) => {
        for (;;) {
          const next = await tryOrAsync(async () => {
            const command = await nextCommand();
            commandCx.notify();
            return { command };
          });
          if (!next) break; // a replaced build (hot reload, update) stops here, before acting
          const { command } = next;
          const name = String(command).replace(new RegExp(`^${MOD}\\.`), "");
          if (name === "refresh") this.reload(commandCx);
          else if (name === "open") this.wake(commandCx);
          else if (name === "settings") this.openSettings(commandCx);
          else if (name === "back") this.back(commandCx);
        }
      });
    });
  }

  wake(cx) {
    if (this.closed) return;
    if (!this.awake && !(this.syncOffUntil > Date.now()) && this.syncSettled === null) this.syncWaiting = true;
    this.awake = true;
    if (!this.ticker) {
      this.ticker = cx.timer.every(TICK_MS, (tickCx) => {
        if (hiddenInLayout()) {
          this.sleep();
          return;
        }
        if (Date.now() - this.lastSnapshotAt >= REFRESH_MS) this.run("snapshot", tickCx);
        this.exchange(tickCx, false);
      });
    }
    if (!this.nodeBinary && !this.runtimeError) {
      if (this.runtimeTask) return;
      this.runtimeTask = cx.spawn(async (runtimeCx) => {
        try {
          // One-time migration of the old token-spend mod's data, so its history carries over.
          await localService(fileApi).migrate(paths.join(appHome(), "data", "token-spend"), paths.join(appHome(), DATA_DIR)).catch(() => null);
          this.nodeBinary = parseRuntimeNode(await readTextFile(paths.join(appHome(), RUNTIME_FILE)));
        } catch (error) {
          this.runtimeError = `Spend needs ${RUNTIME_FILE} with the path to Node 22: ${sanitizeError(error)}`;
        }
        this.runtimeTask = null;
        if (this.closed) return;
        if (this.nodeBinary) this.catchUp(runtimeCx);
        runtimeCx.notify();
      });
      return;
    }
    this.catchUp(cx);
    cx.notify();
  }

  catchUp(cx) {
    if (Date.now() - this.lastSnapshotAt >= REFRESH_MS) this.run("snapshot", cx);
    else if (!this.costs) this.run("prepare", cx);
    this.exchange(cx, this.forceNext === true, this.forceNext === true);
    this.forceNext = false;
  }

  reload(cx) {
    this.lastSnapshotAt = 0;
    this.forceNext = true;
    if (this.running) { this.run("snapshot", cx); return; }
    this.nodeBinary = null;
    this.runtimeError = null;
    this.wake(cx);
  }

  sleep() {
    this.awake = false;
    for (const handle of [this.ticker, this.continueTimer]) {
      try { handle?.cancel(); } catch { /* already gone */ }
    }
    this.ticker = null;
    this.continueTimer = null;
    this.costs = null;
    this.syncSettled = null;
    this.menuOptions = null;
    this.openMenu = null;
  }

  close() {
    this.closed = true;
    this.generation += 1;
    for (const handle of [this.chooserScroll, ...Object.values(this.chooserFocus ?? {})]) tryOr(() => handle.release());
    for (const handle of [this.task, this.watchdog, this.continueTimer, this.ticker, this.commandTask, this.runtimeTask]) {
      try { handle?.cancel(); } catch { /* already gone */ }
    }
  }

  options() {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { today, cost: { ...this.cost }, aliases: shared("kanso.alias") ?? {} };
  }

  /** One presenter call at a time; later requests queue, so filters never race a refresh. */
  run(command, cx, extra = null) {
    if (this.closed || !this.nodeBinary) return;
    if (this.running) {
      if (command === "configure") this.queuedSources = { ...(this.queuedSources ?? {}), ...(extra ?? {}) };
      this.queued = { ...this.queued, [command === "configure" ? "snapshot" : command]: true };
      return;
    }
    this.generation += 1;
    const generation = this.generation;
    const sent = this.options();
    const startedAt = Date.now();
    this.running = command;
    if (command === "snapshot") { this.lastSnapshotAt = Date.now(); setShared(SNAPSHOT_AT, this.lastSnapshotAt); }
    cx.notify();

    try { this.watchdog?.cancel(); } catch { /* already gone */ }
    this.watchdog = cx.timer.after(STEP_TIMEOUT_MS, (timerCx) => {
      if (generation !== this.generation) return;
      this.generation += 1;
      try { this.task?.cancel(); } catch { /* already gone */ }
      this.finish(timerCx, "Spend took too long to answer. It will try again shortly.");
    });

    this.task = cx.spawn(async (taskCx) => {
      const { payload, failure } = await this.ask(command, sent, extra).then(
        (answer) => ({
          payload: answer,
          failure: answer?.kind !== PAYLOAD_KIND || answer.version !== PAYLOAD_VERSION || !answer.costs
            ? "Spend got an answer it does not understand. Reload the panel."
            : null,
        }),
        (error) => ({ payload: null, failure: sanitizeError(error) }),
      );
      if (generation !== this.generation || this.closed) return;
      if (this.syncWaiting === "fold" && startedAt >= this.syncEnded) this.syncWaiting = false;
      if (payload) {
        this.scan = payload.scan ?? this.scan;
        if (this.awake) this.costs = payload.costs;
        if (payload.settings) this.settings = payload.settings;
        // Filters changed while this ran: price again with the current ones.
        if (JSON.stringify(sent.cost) !== JSON.stringify(this.cost)) this.queued = { ...this.queued, prepare: true };
      }
      this.finish(taskCx, failure);
    });
  }

  /** Parsed presenter answer; Node 22's node:sqlite experimental notice is suppressed so stderr stays clean for errors. */
  async ask(command, sent, extra) {
    const result = await exec(this.nodeBinary, [
      "--disable-warning=ExperimentalWarning",
      paths.join(appHome(), PRESENTER_FILE), command,
      "--store", paths.join(appHome(), DATA_DIR, "store.json"),
      "--home", home(),
      "--options", JSON.stringify(sent),
      ...(command === "configure" ? ["--sources", JSON.stringify(extra ?? {})] : []),
    ]);
    if (result.code !== 0) throw new Error(resultError(result));
    return JSON.parse(String(result.stdout ?? ""));
  }

  finish(cx, failure) {
    try { this.watchdog?.cancel(); } catch { /* already gone */ }
    this.watchdog = null;
    this.task = null;
    this.running = null;
    this.error = failure;
    if (!this.closed) {
      if (this.queued.snapshot) {
        this.queued = { snapshot: false, prepare: false };
        const sources = this.queuedSources;
        this.queuedSources = null;
        if (sources) this.run("configure", cx, sources);
        else this.run("snapshot", cx);
      } else if (this.queued.prepare) {
        this.queued = { ...this.queued, prepare: false };
        this.run("prepare", cx);
      } else if (this.scan?.partial && !failure && this.awake) {
        // The first scan is time-boxed; keep going until it has read everything.
        try { this.continueTimer?.cancel(); } catch { /* already gone */ }
        this.continueTimer = cx.timer.after(1000, (timerCx) => {
          this.continueTimer = null;
          this.run("snapshot", timerCx);
        });
      }
    }
    if (this.awake && !this.closed) this.exchange(cx, true);
    cx.notify();
  }

  exchange(cx, force = false, everyone = false) {
    if (this.closed || !this.awake || !this.nodeBinary) return;
    if (this.syncing) { this.syncAgain = true; if (force) this.syncForce = true; if (everyone) this.syncEveryone = true; return; }
    this.syncing = true;
    cx.spawn(async (syncCx) => {
      try { await this.exchangeOnce(syncCx, force, everyone); } catch { this.syncWaiting = false; }
      this.syncing = false;
      this.probing = false;
      syncCx.notify();
      if (this.syncAgain && this.awake && !this.closed) { const again = this.syncForce, all = this.syncEveryone; this.syncForce = false; this.syncEveryone = false; this.syncAgain = false; this.exchange(syncCx, again, all); }
    });
  }

  async exchangeOnce(cx, force = false, everyone = false) {
    if (!this.awake || this.closed) return;
    const now = Date.now();
    if (!force && this.syncOffUntil > now) return;
    const dir = syncDir(appHome());
    const config = configFrom(await readTextFile(paths.join(dir, "config.json")).catch(() => null));
    if (!syncOn(config)) { this.syncOffUntil = now + EXCHANGE_MS; this.syncHolds = []; this.syncWaiting = false; return; }
    this.syncOffUntil = 0;
    const periodKey = periodKeyOf(this.cost);
    const options = { today: this.options().today, cost: { period: this.cost.period, offset: Number(this.cost.offset) || 0, project: "all", model: "all" } };
    const settleKey = `${periodKey}:${options.today}`;
    const self = this.costs?.syncSelf || identityFrom(await readTextFile(paths.join(dir, "identity.json")).catch(() => null), () => "", "").id;
    const power = await powerOf(this.db, this.syncStored);
    if (!this.awake || this.closed) return;
    this.syncStored = power.stored;
    const peers = machines();
    const status = statusFrom(await readTextFile(paths.join(dir, "status.json")).catch(() => null));
    const steps = planExchange({ config, peers, status, now, periodKey, stored: power.stored, live: power.live, force: everyone });
    if (!steps.length) {
      if (this.syncWaiting === true) this.syncWaiting = false;
      this.syncSettled = settleKey;
    } else {
      this.probing = true;
      if (this.syncSettled !== settleKey) this.syncWaiting = true;
      cx.notify();
    }
    const out = await exchangeAll((on, payload) => serviceOn(probeApi, on).then((probe) => probe.exchange(payload)), {
      config, peers, status,
      rows: rowsFrom(await readTextFile(paths.join(dir, "rows.json")).catch(() => null)),
      self, own: self ? rowFromCosts(this.costs, self, new Date(now).toISOString(), options) : null,
      now, periodKey, options, stored: power.stored, live: power.live, force: everyone,
    });
    if (!this.awake || this.closed) return;
    this.syncHolds = holdsOf(out.status, power.stored, power.live);
    if (!out.ran) return;
    this.syncSettled = settleKey;
    this.syncEnded = Date.now();
    if (this.syncWaiting === true) this.syncWaiting = "fold";
    await localService(fileApi).mkdir(dir);
    const rowsFile = paths.join(dir, "rows.json");
    const statusFile = paths.join(dir, "status.json");
    await writeTextFile(rowsFile, rowsText(out.rows), await readTextFile(rowsFile).catch(() => null));
    await writeTextFile(statusFile, statusText(out.status), await readTextFile(statusFile).catch(() => null));
    this.run("prepare", cx);
  }

  setCost(patch, cx) {
    const moved = ("period" in patch && patch.period !== this.cost.period) || ("offset" in patch && patch.offset !== this.cost.offset);
    this.cost = { ...this.cost, ...patch };
    if (moved && this.syncOffUntil === 0) this.syncWaiting = true;
    if (patch.period) setShared(PERIOD_KEY, patch.period);
    this.run("prepare", cx);
    this.exchange(cx, true);
    cx.notify();
  }

  openDetail(kind, item, cx) {
    this.openMenu = null;
    if (kind === "task") {
      this.stack = [...this.stack, { kind, label: item.title, task: item }];
      cx.notify();
      return;
    }
    const entry = { kind, label: kind === "project" ? projectName(item.value) : item.value, value: item.value, prevCost: { ...this.cost } };
    this.stack = [...this.stack, entry];
    this.setCost({ [kind]: item.value }, cx);
  }

  back(cx) {
    if (this.page === "settings") {
      this.page = "home";
      cx.notify();
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    this.stack = this.stack.slice(0, -1);
    if (top.prevCost) this.setCost({ project: top.prevCost.project, model: top.prevCost.model }, cx);
    else cx.notify();
  }

  openSettings(cx) {
    this.page = "settings";
    this.settingsNote = null;
    // Inputs need a live host call: build them here, never in render.
    this.planInputs = (this.settings?.plans ?? []).map((plan) => ({
      name: new TextField({ value: plan.name, placeholder: "Plan" }),
      amount: new TextField({ value: String(plan.usdPerMonth), placeholder: "0" }),
    }));
    cx.notify();
  }

  addPlan(cx) {
    this.planInputs = [...this.planInputs, {
      name: new TextField({ placeholder: "ChatGPT Pro, Claude Max…" }),
      amount: new TextField({ placeholder: "200" }),
    }];
    cx.notify();
  }

  removePlan(index, cx) {
    this.planInputs = this.planInputs.filter((_, i) => i !== index);
    cx.notify();
  }

  /** Plans live in prices.json next to the store; other keys there are kept. */
  savePlans(cx) {
    const file = this.settings?.pricesPath ?? paths.join(appHome(), DATA_DIR, "prices.json");
    const plans = this.planInputs
      .map((input) => ({ name: input.name.value().trim(), usdPerMonth: Number(String(input.amount.value()).replace(/[^0-9.]/g, "")) }))
      .filter((plan) => plan.name && Number.isFinite(plan.usdPerMonth) && plan.usdPerMonth > 0);
    this.settingsNote = "Saving…";
    cx.notify();
    cx.spawn(async (saveCx) => {
      try {
        const before = await readTextFile(file);
        // Unreadable JSON starts over; an array is written back unchanged (a key on an array never reaches its JSON).
        const kept = tryOr(() => (before ? JSON.parse(before) : {}), {});
        if (!kept || typeof kept !== "object") throw new TypeError("prices.json is not a JSON object.");
        const data = Array.isArray(kept) ? kept : { ...kept, plans };
        await writeTextFile(file, `${JSON.stringify(data, null, 2)}\n`, before);
        this.settingsNote = plans.length ? `Saved ${plans.length} ${plans.length === 1 ? "plan" : "plans"}.` : "Saved. No plans.";
        this.run("prepare", saveCx);
      } catch (error) {
        this.settingsNote = `Could not save: ${sanitizeError(error)}`;
      }
      saveCx.notify();
    });
  }

  toggleSource(id, enabled, cx) {
    if (this.settings) {
      this.settings = { ...this.settings, sources: this.settings.sources.map((s) => (s.id === id ? { ...s, enabled } : s)) };
    }
    this.run("configure", cx, { [id]: enabled });
    cx.notify();
  }

  // A machine just turned on or off in the sidebar: exchange now, outside the render pass.
  kicked(cx) {
    const kick = shared(SYNC_KICK);
    if (kick === this.syncKick) return;
    this.syncKick = kick;
    cx.timer.after(0, (kickCx) => this.exchange(kickCx, true));
  }

  render(cx) {
    // A space switch can restore the panel without a command: wake on the next tick, outside the render pass.
    if (!this.awake && !this.closed && !this.waking && !hiddenInLayout()) {
      this.waking = true;
      cx.timer.after(0, (wakeCx) => {
        this.waking = false;
        if (!hiddenInLayout()) this.wake(wakeCx);
      });
    }
    this.kicked(cx);
    const c = tokens(theme());
    const narrow = (this.width || 960) < 560;
    const top = this.stack[this.stack.length - 1];
    const body = this.page === "settings" ? this.settingsView(c)
      : top?.kind === "task" ? this.taskView(c, top.task, narrow)
      : this.costs?.hero ? this.costsView(c, narrow, top) : this.waitingView(c);
    const { failure } = this.plan();
    return scrollPage.call(this, "spend-root", c, narrow, (column) => column
      .child(this.header(c, narrow))
      .children(shareRows(this, c, "Only the totals and the days: no project, task or session names. The post opens with the image in it."))
      .when(Boolean(failure), (el) => el.child(failureBlock(failure)("spend-failed", c, { onClick: (cx) => this.reload(cx) })))
      .when(Boolean(body), (el) => el.child(body)), { always: true });
  }

  plan() { return readPlan(this, Boolean(this.costs?.hero)); }

  // Only the unfiltered totals are shared, so a filter or a detail view hides it.
  canShare() {
    return this.page === "home" && !this.stack.length && Boolean(this.costs?.hero?.value) && !this.syncWaiting
      && this.cost.project === "all" && this.cost.model === "all";
  }

  shareCard() {
    return { spec: spendSpec(this.costs), text: spendText(this.costs), name: `spend-${this.costs.range?.label ?? "now"}`, title: "Spend" };
  }

  header(c, narrow) {
    const busy = Boolean(this.running);
    const updated = this.scan?.lastScanAt ? `Updated ${formatTime(this.scan.lastScanAt)}` : "";
    const reading = this.running !== "prepare" && busy && this.scan?.partial
      ? `Reading sessions, ${this.scan.processed} of ${this.scan.total}` : "";
    const top = this.stack[this.stack.length - 1];
    const inner = this.page === "settings" || Boolean(top);
    const title = this.page === "settings" ? "Settings" : top ? top.label : "Spend";
    const crumb = this.page === "settings" ? "" : top ? ({ project: "Project", model: "Model", task: "Task" })[top.kind] : "";
    const heading = h_flex().flex_1().min_w(0).items_center().gap(G.sm)
      .when(inner, (el) => el.child(iconButton("spend-back", "chevron-left", "Back", (cx) => this.back(cx), c)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .when(Boolean(crumb), (el) => el.child(div().text_size(T.micro).text_color(c.dim).child(crumb)))
        .child(div().truncate().text_size(inner ? (narrow ? 15 : 17) : (narrow ? 17 : 20)).text_color(c.text).tooltip(tooltip({ label: title })).child(title)));
    return pageHeader(heading, [
      reading ? div().pr(G.xs).text_size(T.micro).text_color(c.dim).child(reading) : null,
      this.canShare() ? iconButton("spend-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open }) : null,
      refreshTool("spend-refresh", c, { ...this.plan().refresh, busy: this.plan().refresh.busy || this.probing, working: "Updating…", stamp: updated }, (cx) => this.reload(cx)),
      this.page === "settings" ? null : iconButton("spend-settings", "settings", "Settings", (cx) => this.openSettings(cx), c),
    ]);
  }

  waitingView(c) {
    return this.plan().failure ? null : skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton", c);
  }

  costsView(c, narrow, top = null) {
    const data = this.costs;
    const lists = [
      top?.kind === "project" ? null : this.list(c, "Projects", `${data.projectCount} projects`, data.projects, "project"),
      top?.kind === "model" ? null : this.list(c, "Models", `${data.modelCount} models`, data.models, "model"),
    ].filter(Boolean);
    const wide = (this.width || 960) >= 860;
    return pageSections(narrow)
      .opacity(this.running === "prepare" ? OPACITY.away : 1)
      .when(!top && (data.plans?.length ?? 0) > 0, (el) => el.child(this.plans(c, data)))
      .child(this.controls(c, Boolean(top)))
      .child(this.hero(c, data.hero, narrow))
      .when(!top && !this.syncWaiting && (data.machines?.length ?? 0) > 1, (el) => el.child(this.machineSplit(c, data.machines)))
      .when(!top && (this.syncHolds?.length ?? 0) > 0, (el) => el.child(v_flex().w_full().gap(G.xs).pt(G.sm)
        .children(this.syncHolds.map((hold) => h_flex().w_full().items_center().gap(G.md)
          .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.text).child(hold.id))
          .child(div().text_size(T.body).text_color(c.muted).child(hold.text))))))
      .when(!data.hero.empty, (el) => el
        .child(this.chart(c, data.chart))
        .when(!top && Array.isArray(data.live) && data.live.length > 0, (live) => live.child(this.live(c, data.live)))
        .child(wide
          ? h_flex().w_full().gap(56).items_start().children(lists.map((list) => div().flex_1().min_w(0).max_w(lists.length === 1 ? 560 : 10_000).child(list)))
          : pageSections(narrow).children(lists))
        .child(this.tasks(c, data)))
      .child(v_flex().w_full().gap(G.hair).children(data.footnote.map((line) => div().text_size(T.micro).text_color(c.dim).child(line))));
  }

  controls(c, inDetail = false) {
    const filtered = !inDetail && (this.cost.project !== "all" || this.cost.model !== "all");
    const label = [
      this.cost.project !== "all" ? projectName(this.cost.project) : null,
      this.cost.model !== "all" ? this.cost.model : null,
    ].filter(Boolean).join(" and ");
    return v_flex().w_full().gap(G.md)
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.sm).items_center().justify_between()
        .child(segmented("ins-period", SPEND_PERIODS, this.cost.period, (key, cx) => this.setCost({ period: key, offset: 0 }, cx), c))
        .when(!inDetail, (row) => row.child(h_flex().gap(G.lg).items_center()
          .child(this.menu("project", c))
          .child(this.menu("model", c)))))
      .when(filtered, (el) => el.child(h_flex().gap(G.md).items_center()
        .child(div().text_size(T.body).text_color(c.muted).child(`Showing ${label}`))
        .child(quietLink("ins-clear", "Show everything", (cx) => this.setCost({ project: "all", model: "all" }, cx), c))));
  }

  menu(field, c) {
    const value = this.cost[field];
    const facet = this.costs.facets?.[field] ?? [];
    const shown = value === "all" ? allChoice(field) : (facet.find((entry) => entry.value === value)?.label ?? projectName(value));
    const id = `ins-menu-${field}`;
    // The kit's quiet button with the menu's caret: Tab reaches it, Enter and Space open the menu.
    const trigger = kitButton({ label: shown, kind: "quiet", small: true, icon: "lu-chevron-down", truncate: true, spoken: `${field === "project" ? "Project" : "Model"}: ${shown}`, color: value === "all" ? c.muted : c.text })(`${id}-trigger`, c);
    const focus = this.chooserFocus[field];
    const popover = Popover.new(id).trigger(trigger).track_focus(focus)
      .open(this.openMenu === id)
      .on_open_change((open, cx) => {
        this.openMenu = open ? id : null;
        // Options are built in this event, never in the render pass.
        this.menuOptions = open ? chooserOptions(field, facet) : null;
        this.menuAt = open ? this.menuOptions.findIndex((option) => option.value === value) : -1;
        this.menuG = 0;
        if (open) { focus.focus(); this.chooserScroll.scroll_to_item(Math.max(0, this.menuAt)); }
        cx.notify();
      });
    if (this.openMenu === id && this.menuOptions) {
      const choose = (option) => (cx) => { this.openMenu = null; this.menuOptions = null; this.setCost({ [field]: option.value }, cx); };
      popover.content(menu(`${id}-options`, { items: [{ scroll: this.menuOptions.map((option, at) => ({
        label: option.label, second: option.detail || null, hint: option.meta || null, selected: at === this.menuAt, onClick: choose(option),
      })), rows: CHOOSER_ROWS, handle: this.chooserScroll }] }, c).track_focus(focus).on_key_down((e, cx) => this.chooserKeyDown(e, cx, choose)));
    }
    return popover;
  }

  chooserKeyDown(e, cx, choose) {
    const step = chooserKey(e, { at: this.menuAt, gAt: this.menuG, count: this.menuOptions.length });
    this.menuG = step.gAt;
    if (!step.handled) return;
    cx.stop_propagation();
    const lit = this.menuOptions[step.at];
    if (step.does === "choose" && lit) { choose(lit)(cx); return; }
    if (step.does === "close") { this.openMenu = null; this.menuOptions = null; }
    if (step.does === "move") { this.menuAt = step.at; this.chooserScroll.scroll_to_item(step.at); }
    cx.notify();
  }

  hero(c, hero, narrow) {
    const offset = this.cost.offset || 0;
    const stepper = this.cost.period !== "all";
    return heroStack(heroHeading()
        .child(h_flex().gap(G.md).items_center()
          .child(div().text_size(T.title).text_color(c.muted).child(hero.title))
          .when(stepper, (el) => el
            .child(quietLink("ins-older", "‹", (cx) => this.setCost({ offset: offset - 1 }, cx), c, { label: "Previous period" }))
            .child(quietLink("ins-newer", "›", (cx) => this.setCost({ offset: Math.min(0, offset + 1) }, cx), c, {
              label: "Next period", disabled: offset >= 0,
            }))
            .when(offset < 0, (row) => row.child(quietLink("ins-now", "Back to now", (cx) => this.setCost({ offset: 0 }, cx), c)))))
        .child(metric({ value: hero.value, unit: "API value", facts: hero.empty ? "" : factList(hero.stats), tip: hero.tip, loading: Boolean(this.syncWaiting) })("ins-metric", c))
        .when(Boolean(hero.note), (el) => el.child(div().text_size(T.title).text_color(c.dim).child(hero.note)))
        .when(Boolean(hero.empty), (el) => el.child(div().text_size(T.title).text_color(c.muted).child(hero.empty)))
        .when(Boolean(hero.plan) && !this.syncWaiting, (el) => el.child(div().text_size(T.value).text_color(c.muted).child(hero.plan)))
        .when(Boolean(this.scan?.partial), (el) => el.child(div().text_size(T.body).text_color(c.dim)
          .child(`Still reading your history: ${this.scan.processed} of ${this.scan.total} files so far.`))));
  }

  plans(c, data) {
    const loading = Boolean(this.syncWaiting);
    return v_flex().w_full().gap(G.lg)
      .child(section(c, data.month.name, ""))
      .children(data.plans.map((plan, index) => metric({ value: plan.multiple, unit: plan.unit, facts: plan.detail, tone: plan.tone, loading })(`ins-plan-${index}`, c)));
  }

  chart(c, chart) {
    const height = 132;
    return barChart(c, {
      columns: chart.bars.map((bar) => chartColumn(c, { tip: bar.tip, marked: Boolean(bar.peak), value: bar.value }, chartRoom(height))
        .child(div().w(bar.peak ? 3 : 2).flex_none().rounded_t(1)
          .h(bar.ratio > 0 ? Math.max(3, Math.round(bar.ratio * height)) : 1)
          .bg(bar.peak ? c.accent : bar.ratio > 0 ? c.muted : c.border)
          .opacity(bar.peak || bar.ratio === 0 ? 1 : OPACITY.quiet))),
      axis: [chart.first, chart.title, chart.last],
    });
  }

  machineSplit(c, rows) {
    const note = rows.length === 1 ? "1 computer" : `${rows.length} computers`;
    return v_flex().w_full().gap(G.xs)
      .child(section(c, "Computers", note))
      .children(rows.map((row) => metricLine(c, row.name, row.tokensText, row.value, { tip: clock(row.updated_at) })));
  }

  list(c, title, count, items, field) {
    const selected = this.cost[field];
    const open = Boolean(this.expanded[field]);
    const shown = open ? items : items.slice(0, LIST_ROWS);
    return v_flex().w_full().gap(G.xs)
      .child(section(c, title, count))
      .when(items.length === 0, (el) => el.child(div().text_size(T.body).text_color(c.dim).child("Nothing here in this period.")))
      .children(shown.map((item, index) => {
        const active = selected === item.value;
        const line = row({ name: item.name, detail: item.tokensText, meta: item.usdText, current: active, dimmed: !active && selected !== "all" })(`ins-${field}-${index}`, c, {
          onClick: (cx) => this.openDetail(field, item, cx),
        }).accessibility_label(`${item.name}, ${item.usdText}`);
        return item.detail ? line.tooltip(tooltip({ label: item.detail })) : line;
      }))
      .when(items.length > LIST_ROWS, (el) => el.child(moreLink(`ins-${field}-more`, c, { open, hidden: items.length - LIST_ROWS }, (cx) => {
        this.expanded = { ...this.expanded, [field]: !open };
        cx.notify();
      })));
  }

  taskView(c, d, narrow) {
    const row = (name, sub, usd, tokens, index) => separatedRow(h_flex().w_full().items_end().gap(G.md).py(7), c, index)
      .child(detailColumn()
        .child(div().truncate().text_size(T.card).text_color(c.text).child(name))
        .when(Boolean(sub), (el) => el.child(div().text_size(T.micro).text_color(c.dim).child(sub))))
      .child(div().text_size(T.micro).text_color(c.dim).child(tokens))
      .child(div().min_w(64).text_right().text_size(T.title).font_light().text_color(c.text).child(usd));
    return v_flex().w_full().gap(narrow ? 36 : 44)
      .child(v_flex().w_full().gap(G.sm)
        .when(Boolean(d.ticket), (el) => el.child(div().text_size(T.body).font_medium().text_color(c.muted).child(d.ticket)))
        .child(div().w_full().text_size(T.title).line_height(1.45).text_color(c.text).child(d.title))
        .child(h_flex().w_full().flex_wrap().gap_x(G.md).gap_y(2)
          .children([d.project, d.tools, d.when].filter(Boolean).map((part) => div().text_size(T.body).text_color(c.dim).child(part)))))
      .child(v_flex().gap(G.xl)
        .child(metric({ value: d.usdText, unit: "API value", facts: factList(d.parts.map((part) => ({ value: part.value, unit: part.label }))), tip: `${d.usdExact} at API list price` })("ins-task-metric", c)))
      .child(v_flex().w_full()
        .child(section(c, "Models", `${d.models.length}`))
        .children(d.models.map((m, index) => row(m.name, "", m.usdText, m.tokensText, index))))
      .child(v_flex().w_full()
        .child(section(c, "Sessions", d.sessionCount > d.sessions.length ? `top ${d.sessions.length} of ${d.sessionCount}` : `${d.sessionCount}`))
        .children(d.sessions.map((s, index) => row(s.name, s.when, s.usdText, s.tokensText, index))))
      .child(h_flex().gap(G.lg)
        .child(quietLink("ins-task-project", `Open ${d.project}`, (cx) => this.openDetail("project", { value: d.projectPath }, cx), c)));
  }

  settingsView(c) {
    const s = this.settings;
    const heading = (title, note) => v_flex().w_full().gap(G.xs).pb(G.md)
      .child(div().text_size(T.title).text_color(c.text).child(title))
      .when(Boolean(note), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(note)));
    const busy = this.running === "configure" || (this.running === "snapshot" && this.queuedSources);
    return v_flex().w_full().gap(44)
      .child(v_flex().w_full()
        .child(heading("Sources", "Where Spend reads your sessions. Turning one off removes it from every number."))
        .when(!s && !this.plan().failure, (el) => el.child(skeletonOf({ shape: "line", count: 3 })("kanso-skeleton", c)))
        .children((s?.sources ?? []).map((source, index) => separatedRow(h_flex().w_full().items_center().gap(G.md).py(G.sm), c, index)
          .child(detailColumn()
            .child(div().text_size(T.value).text_color(source.enabled ? c.text : c.muted).child(source.label))
            .child(div().truncate().text_size(T.micro).text_color(c.dim).tooltip(tooltip({ label: source.roots })).child(source.roots)))
          .child(toggleSwitch(`ins-source-${source.id}`, source.enabled, (next, cx) => this.toggleSource(source.id, next, cx), c, {
            label: `${source.label}: ${source.enabled ? "on" : "off"}`,
          }))))
        .when(Boolean(busy), (el) => el.child(div().pt(G.sm).text_size(T.micro).text_color(c.dim).child("Updating sources…"))))
      .child(v_flex().w_full()
        .child(heading("Plans", "What you pay each month. Spend subtracts it from the API value to show what your plans save you."))
        .children(this.planInputs.map((input, index) => h_flex().w_full().items_center().gap(G.sm).py(G.xs)
          .child(div().flex_1().min_w(0).child(field(`ins-plan-name-${index}`, input.name, c)))
          .child(div().text_size(T.body).text_color(c.dim).child("$"))
          .child(div().w(84).flex_none().child(field(`ins-plan-amount-${index}`, input.amount, c)))
          .child(div().text_size(T.micro).text_color(c.dim).child("/ mo"))
          .child(iconButton(`ins-plan-remove-${index}`, "x", "Remove plan", (cx) => this.removePlan(index, cx), c))))
        .child(h_flex().w_full().gap(G.lg).items_center().pt(G.sm)
          .child(quietLink("ins-plan-add", "Add plan", (cx) => this.addPlan(cx), c))
          .child(quietLink("ins-plan-save", "Save plans", (cx) => this.savePlans(cx), c))
          .when(Boolean(this.settingsNote), (el) => el.child(div().text_size(T.micro).text_color(c.dim).child(this.settingsNote)))))
      .child(v_flex().w_full()
        .child(heading("Prices", null))
        .child(div().text_size(T.body).line_height(1.5).text_color(c.muted)
          .child("Claude models use Anthropic's list prices, Claude Code with its 1-hour cache writes. Other models use the OpenRouter catalog, refreshed once a day; tokens without a list price are left out, not guessed."))
        .child(div().pt(G.sm).text_size(T.micro).text_color(c.dim).child(`Your own per-model prices: "models" in ${s?.pricesPath ?? `${DATA_DIR}/prices.json`}`)))
      .child(v_flex().w_full()
        .child(heading("Updates", null))
        .child(div().text_size(T.body).line_height(1.5).text_color(c.muted)
          .child("While this panel is open: every minute, or every 30 seconds while a session is active. Closed, Spend does nothing.")));
  }

  live(c, sessions) {
    return v_flex().w_full()
      .child(h_flex().w_full().items_center().gap(G.sm).pb(G.sm)
        .child(mark(c, { status: "working", size: "sm" }))
        .child(div().text_size(T.title).text_color(c.text).child("Active now")))
      .children(sessions.map((s, index) => this.taskRow(`ins-live-${index}`, s, c)));
  }

  // A task or a live session: the kit's row, its ticket beside the title, its facts and tokens under it, its cost at the end; a press opens its detail.
  taskRow(id, task, c) {
    return row({ name: task.title, detail: task.ticket || null, meta: task.usdText, second: [...task.meta, task.tokensText] })(id, c, {
      onClick: (cx) => this.openDetail("task", task.detail, cx),
    }).accessibility_label(`${task.title}, ${task.usdText}`).tooltip(tooltip({ label: task.tip }));
  }

  tasks(c, data) {
    const open = Boolean(this.expanded.tasks);
    const shown = open ? data.tasks : data.tasks.slice(0, TASK_ROWS);
    return v_flex().w_full()
      .child(h_flex().w_full().items_end().justify_between().pb(G.md)
        .child(div().text_size(T.title).text_color(c.text).child("Tasks"))
        .child(div().text_size(T.body).text_color(c.dim).child(data.tasksNote)))
      .children(shown.map((task, index) => this.taskRow(`ins-task-${index}`, task, c)))
      .when(data.tasks.length > TASK_ROWS, (el) => el.child(moreLink("ins-tasks-more", c, { open, hidden: data.tasks.length - TASK_ROWS, ruled: true }, (cx) => {
        this.expanded = { ...this.expanded, tasks: !open };
        cx.notify();
      })));
  }
}

const separatedRow = (row, c, index) => row.when(index > 0, (el) => el.border_t(1).border_color(c.border));
