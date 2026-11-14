import { localService, serviceFor, REMOTE_TIMEOUT } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { portApi } from "./platform-ports.js";
import { killApi } from "./platform-kill.js";
import { fileApi } from "./platform-files.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, panes, terminals, machines, home, run, theme, appHome, readTextFile, shared } from "herdr";
import { tilde, said, failNote } from "./lib.js";
import { aliasText, machineTitle, tryOr } from "./pure.js";
import { parseProcesses, etimeSecs } from "./procs.js";
import { STOP_LOOP, systemApi } from "./platform-system.js";
export { STOP_LOOP };
import { G, Armed, tokens, button, quietLink, segmented, iconButton, section, ghost, breathe } from "./ui.js";
import { Share } from "./share.js";
import { portsSpec, portsText } from "./ports-card.js";
import { parsePorts, historyOf, RANGES, activeSeries, portStats, historyLists, size, clock } from "./ports-model.js";
import { portsMemory } from "./panel-state.js";
import { Front } from "./front.js";
import { localAddress, REST_MS } from "./kdb.js";

// The guard's files: change the name here if it is installed under another.
const GUARD = "kanso-guard";
const PORTS_FILE = `data/${GUARD}/ports.json`;
const GUARD_FILE = `mods/${GUARD}/guard.mjs`;
const RUNTIME_FILE = `mods/${GUARD}/runtime.json`;
const HISTORY_MS = 30_000; // the guard writes once a minute
const BUSY_MS = 90_000;
const LIST_ROWS = 12;
// One detached shell stops them one at a time: $0 node, $1 guard.mjs, then a pid each ("pid:force" for a force stop).


const EVERY_MS = 10000;
export const NO_PANE = "no pane";

// lsof's -F output: each "p" line (pid) and the field lines after it; lines before the first are no one's.
function byProcess(text) {
  const lines = String(text ?? "").split("\n");
  const starts = lines.flatMap((line, i) => (line[0] === "p" ? [i] : []));
  return starts.map((at, k) => ({ pid: Number(lines[at].slice(1)), fields: lines.slice(at + 1, starts[k + 1] ?? lines.length) }));
}

// `lsof -F pcn` of the listening sockets: pid -> { pid, command, ports }
export function parseListen(text) {
  return new Map(byProcess(text).map(({ pid, fields }) => {
    const command = fields.filter((line) => line[0] === "c").map((line) => line.slice(1)).at(-1) ?? "";
    const ports = fields.filter((line) => line[0] === "n").map((line) => Number(line.slice(line.lastIndexOf(":") + 1))).filter(Boolean);
    return [pid, { pid, command, ports: [...new Set(ports)].toSorted((a, b) => a - b) }];
  }));
}

// `lsof -a -d cwd -F pn`: pid -> its working folder.
export function parseCwds(text) {
  return new Map(byProcess(text).flatMap(({ pid, fields }) => fields.filter((line) => line[0] === "n").map((line) => [pid, line.slice(1)])));
}

// `ps -axo pid=,ppid=,etime=,args=`, read as the sidebar reads it (procs.js): pid -> { ppid, secs, args }.
export const parsePs = (text) => new Map([...parseProcesses(text).byPid].map(([pid, r]) => [pid, { ppid: r.ppid, secs: etimeSecs(r.etime), args: r.command }]));

// The terminal a process runs in: the first ancestor that is a terminal's shell (`shells`: pid -> address), or null; 64 hops at most.
export function ownerOf(pid, ps, shells) {
  const up = (p, hops) => (!(p > 1 && hops < 64) ? null : shells.has(p) ? shells.get(p) : up(ps.get(p)?.ppid ?? 0, hops + 1));
  return up(pid, 0);
}

// Worth showing: a terminal's, or one under home (not home itself, not ~/Library, where apps keep theirs).
export function servers(listen, cwds, ps, shells, homeDir) {
  return [...listen.values()].flatMap((s) => {
    const cwd = cwds.get(s.pid) ?? null, owner = ownerOf(s.pid, ps, shells);
    const mine = cwd && !paths.equal(cwd, homeDir) && paths.within(cwd, homeDir) && !paths.within(cwd, paths.join(homeDir, "Library"));
    if (!owner && !mine) return [];
    const p = ps.get(s.pid);
    return [{ pid: s.pid, ports: s.ports, command: s.command, args: p?.args ?? s.command, secs: p?.secs ?? 0, cwd, owner }];
  }).toSorted((a, b) => Boolean(a.owner) - Boolean(b.owner) || a.ports[0] - b.ports[0]);
}

export const shortArgs = (args) => {
  const [cmd, ...rest] = String(args).split(" ");
  return [paths.basename(cmd), ...rest].join(" ");
};

export const portKey = (s) => `${s.machine ?? ""}:${s.pid}`;
const SAME_START_MS = 5000;
const STOP_WAIT_MS = 45_000;
export const sameServer = (a, b) => a.pid === b.pid && a.ports.join() === b.ports.join() && Math.abs((a.startedAt ?? 0) - (b.startedAt ?? 0)) <= SAME_START_MS;
const LONGEST_MS = 10 * 60_000;
export const backoffMs = (fails) => Math.min(2 ** Math.max(0, fails - 1) * 60_000, LONGEST_MS);
export function unreadable(error) {
  const text = String(error?.message ?? error ?? "");
  const missing = /\b(lsof|ps)\b[^\n]*(?:not found|no such file|not installed)/i.exec(text) ?? /(?:not found|no such file|not installed)[^\n]*\b(lsof|ps)\b/i.exec(text);
  if (missing) return `${missing[1]} is not installed`;
  return !text || /unreachable|did not answer|timed out|timeout|refused|offline|no route|was lost|not connected/i.test(text) ? "unreachable" : "its ports can't be read";
}
const rowId = (s) => (s.machine ? `${s.machine}-${s.pid}` : String(s.pid));

// Where this computer's browser reaches another one: the host `hc machine ls` connects to, else its name.
export function browserHost(listed, name) {
  const rows = tryOr(() => JSON.parse(String(listed ?? "")).machines) ?? [];
  const target = String((Array.isArray(rows) ? rows : []).find((m) => m?.name === name)?.target ?? "").trim();
  return target.replace(/^ssh:\/\//, "").replace(/^[^@/]*@/, "").replace(/:\d+$/, "") || name;
}

const age = (secs) => secs < 3600 ? `${Math.max(1, Math.round(secs / 60))} min` : secs < 86400 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;

export class Ports {
  constructor() { this.armed = new Armed(); this.share = new Share("kanso-panel"); this.remote = {}; this.homes = {}; this.pids = new Map(); } // Stop asks for a second press

  // What the share card holds: counts and sizes, never a port, folder, project or command.
  canShare() { return Boolean(this.hist?.data); }

  shareCard() {
    const data = this.hist.data;
    return { spec: portsSpec(data), text: portsText(data), name: "ports", title: "Ports" };
  }

  saveState() { return portsMemory({ range: this.range, tab: this.tab, showAll: this.showAll }); }

  restoreState(state) {
    const next = portsMemory(state);
    if (!next) return false;
    this.keptPorts = next;
    return true;
  }

  init(cx) {
    this.list = null; this.note = null; this.stopping = new Set(); this.forced = new Set(); this.width = 368;
    this.hist = null; // parsePorts(): { state, data }
    this.digest = null; // what the history draws, worked out once per read
    this.histAt = 0; this.range = this.keptPorts?.range ?? "day"; this.tab = this.keptPorts?.tab ?? null; this.showAll = this.keptPorts?.showAll ?? false; this.busy = {};
    this.front = new Front();
    this.refresh(cx);
    cx.timer.every(EVERY_MS, (cx) => this.refresh(cx));
  }

  async shells(on = null) {
    const local = terminals().filter((t) => t?.address && localAddress(t.address, on) !== null && t.state !== "dead");
    for (const address of [...this.pids.keys()]) if (localAddress(address, on) !== null && !local.some((t) => t.address === address)) this.pids.delete(address);
    const asked = async (t) => {
      const args = ["get", t.address, "--json"];
      const r = await (on ? exec("hc", args, { timeout: REMOTE_TIMEOUT }) : hc(args)).catch(() => null);
      return tryOr(() => (r?.code === 0 ? JSON.parse(r.stdout).pid : null));
    };
    const found = await Promise.all(local.map(async (t) => {
      const pid = t.pid || (this.pids.has(t.address) ? this.pids.get(t.address) : await asked(t));
      if (!t.pid) this.pids.set(t.address, pid);
      return pid ? [[Number(pid), t.address]] : [];
    }));
    return new Map(found.flat());
  }

  async homeOf(on) {
    if (!on) return home();
    this.homes[on] ??= await (await serviceFor(systemApi, on)).userHome();
    return this.homes[on];
  }

  async read(on = null) {
    const ports = await serviceFor(portApi, on), processes = await serviceFor(processApi, on);
    const listen = await ports.listen();
    const [cwd, table, shells, homeDir] = await Promise.all([processes.cwd([...listen.keys()]), processes.list(), this.shells(on), this.homeOf(on)]);
    if (!on) this.attribution = cwd.state === "unavailable" ? said("Some servers cannot be attributed", "Working directories require a Herdr API on Windows.") : null;
    const ps = new Map(table.rows.map((r) => [r.pid, { ppid: r.ppid, secs: etimeSecs(r.etime), args: r.command }]));
    const list = servers(listen, cwd.values ?? new Map(), ps, shells, homeDir);
    const now = Date.now();
    return list.map((s) => {
      const h = on ? null : historyOf(s, this.hist?.data, now);
      return {
        ...s, cwdReason: cwd.reason ?? null,
        ...(on ? { machine: on, startedAt: now - s.secs * 1000 } : {}),
        // One asked to stop that is still here gets a force stop next.
        ...(this.forced?.has(portKey({ machine: on, pid: s.pid })) ? { force: true } : {}),
        ...(h ? { mb: h.mb, startedAt: h.startedAt, project: h.project } : {}),
      };
    });
  }

  /** Read ports.json: a file read, no process. */
  async readHistory() {
    const text = await readTextFile(paths.join(appHome(), PORTS_FILE)).catch(() => null);
    const now = Date.now();
    const hist = parsePorts(text, now);
    this.hist = hist;
    this.histAt = now;
    this.digest = hist.data ? {
      series: Object.fromEntries(RANGES.map((r) => [r.key, activeSeries(hist.data, r.key, now)])),
      stats: portStats(hist.data, now),
      lists: historyLists(hist.data, now),
    } : null;
    if (this.busy.install && (hist.state === "ok" || now - this.busy.install > BUSY_MS)) this.idle();
  }

  refresh(cx, { history = false, then = null, now = false } = {}) {
    if (this.front.behind()) { this.front.rest(); return; }
    this.front.woke();
    this.readRemotes(cx, now);
    if (this.reading) { if (then) cx.timer.after(1000, (cx) => this.refresh(cx, { history, then })); return; }
    this.reading = true;
    cx.spawn(async (cx) => {
      const before = this.picture();
      try {
        if (history || Date.now() - this.histAt >= HISTORY_MS) await this.readHistory();
        this.list = await this.read(); this.note = this.attribution;
      } catch (e) { this.note = said("Can't read the ports", e?.message ?? e); this.list = this.list ?? []; }
      finally { this.reading = false; then?.(); if (this.picture() !== before) cx.notify(); }
    });
  }

  readRemotes(cx, now = false) {
    const listed = machines().filter((m) => m?.name), at = Date.now();
    this.remote = Object.fromEntries(Object.entries(this.remote).filter(([name]) => listed.some((m) => m.name === name)));
    for (const { name } of listed.filter((m) => m.layout === "ready")) {
      const r = this.remote[name] ?? { list: null, why: null, fails: 0, next: 0 };
      // A read lost by the host frees its computer after the longest wait.
      if (r.reading && at - r.reading < LONGEST_MS) continue;
      if (!now && at < r.next) continue;
      this.remote = { ...this.remote, [name]: { ...r, reading: at } };
      cx.spawn(async (cx) => {
        const before = this.picture();
        const was = this.remote[name], fails = now ? 0 : was.fails;
        const next = await this.read(name).then(
          (list) => ({ list, why: null, fails: 0, next: Date.now() + REST_MS }),
          (e) => ({ list: null, why: unreadable(e), fails: fails + 1, next: Date.now() + backoffMs(fails + 1) }));
        this.remote = { ...this.remote, [name]: { ...next, reading: 0 } };
        if (this.picture() !== before) cx.notify();
      });
    }
  }

  picture() {
    const remote = Object.entries(this.remote ?? {}).map(([name, r]) => [name, r.list, r.why, r.said]);
    return JSON.stringify([this.list, this.note, this.digest, [...(this.stopping ?? [])], remote]);
  }

  async guardReady() {
    if (!this.hist?.data || !localService(systemApi).memoryGuardAvailable) return false;
    if (this.guardFile === undefined) this.guardFile = await localService(fileApi).test(paths.join(appHome(), GUARD_FILE)).catch(() => false);
    return this.guardFile;
  }

  async node() {
    if (this.nodeBin) return this.nodeBin;
    const raw = await readTextFile(paths.join(appHome(), RUNTIME_FILE)).catch(() => null);
    const v = tryOr(() => JSON.parse(raw ?? "{}")?.node);
    const node = typeof v === "string" && v.trim() ? v.trim() : "node";
    this.nodeBin = node;
    return node;
  }

  // Through the guard when installed (it measures what stopping gives back); without it, the signal directly.
  stop(items, cx) {
    if (items[0]?.machine) { this.stopOn(items[0].machine, items, cx); return; }
    this.stopping = new Set([...this.stopping, ...items.map(portKey)]);
    cx.notify();
    cx.spawn(async (cx) => {
      const viaGuard = await this.guardReady();
      if (viaGuard) {
        // pid@start: the guard stops it only if that pid is still the process this row showed.
        const args = items.map((s) => `${s.pid}@${Math.round(Date.now() - (s.secs ?? 0) * 1000)}${s.force ? ":force" : ""}`);
        await localService(systemApi).guardStop(await this.node(), paths.join(appHome(), GUARD_FILE), args).catch(() => null);
      } else {
        for (const s of items) await localService(killApi).stop(s.pid, { force: s.force }).catch(() => null);
      }
      this.forced = new Set([...this.forced, ...items.map(portKey)]);
      await cx.sleep(1500);
      try { this.list = await this.read(); } catch { /* the timer reads again */ }
      const settled = (gone) => { this.stopping = new Set([...this.stopping].filter((key) => !gone.some((s) => portKey(s) === key))); };
      const done = () => settled(items);
      if (!viaGuard) done();
      else {
        // The guard takes a moment per server: the rest show "Stopping…" until it has written.
        settled(items.filter((s) => !this.list.some((x) => x.pid === s.pid)));
        cx.timer.after(4000, (cx) => this.refresh(cx, { history: true, then: done }));
        cx.timer.after(10_000, (cx) => this.refresh(cx, { history: true }));
      }
      cx.notify();
    });
  }

  stopOn(machine, items, cx, since = Date.now()) {
    const settle = (line) => {
      this.remote = { ...this.remote, [machine]: { ...this.remote[machine], said: line } };
      this.stopping = new Set([...this.stopping].filter((key) => !items.some((s) => portKey(s) === key)));
      cx.notify();
    };
    this.stopping = new Set([...this.stopping, ...items.map(portKey)]);
    if (this.remote[machine]?.reading) {
      if (Date.now() - since >= STOP_WAIT_MS) settle("not stopped, it is still being read");
      else { cx.notify(); cx.timer.after(1000, (cx) => this.stopOn(machine, items, cx, since)); }
      return;
    }
    this.remote = { ...this.remote, [machine]: { ...this.remote[machine], reading: Date.now(), said: null } };
    cx.notify();
    cx.spawn(async (cx) => {
      const keep = (list) => { if (list) this.remote = { ...this.remote, [machine]: { ...this.remote[machine], list, why: null } }; };
      const asked = await this.read(machine).then((list) => ({ list }), (e) => ({ list: null, failed: unreadable(e) }));
      const fresh = asked.list, failed = asked.failed;
      keep(fresh);
      const still = items.filter((s) => fresh?.some((x) => sameServer(s, x)));
      if (still.length) {
        const kill = await serviceFor(killApi, machine).catch(() => null);
        for (const s of still) await kill?.stop(s.pid, { force: s.force }).catch(() => null);
        this.forced = new Set([...this.forced, ...still.map(portKey)]);
        await cx.sleep(1500);
        keep(await this.read(machine).catch(() => null));
      }
      this.remote = { ...this.remote, [machine]: { ...this.remote[machine], reading: 0 } };
      settle(failed ? `not stopped, ${failed}` : still.length < items.length ? "not stopped, that server is gone" : null);
    });
  }

  openPort(s, cx) {
    if (!s.machine) { cx.open_url(`http://localhost:${s.ports[0]}`); return; }
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "ls", "--json"]).catch(() => null);
      cx.open_url(`http://${browserHost(r?.code === 0 ? r.stdout : null, s.machine)}:${s.ports[0]}`);
    });
  }

  turnOn(cx) {
    if (!localService(systemApi).memoryGuardAvailable) { this.note = said(localService(systemApi).memoryGuardReason); cx.notify(); return; }
    if (this.busy.install && Date.now() - this.busy.install < BUSY_MS) return;
    this.busy = { ...this.busy, install: Date.now() };
    cx.notify();
    cx.spawn(async (cx) => {
      await localService(systemApi).guardRun(await this.node(), paths.join(appHome(), GUARD_FILE), ["install"], appHome()).catch(() => { this.idle(); });
      this.guardFile = undefined;
      for (const ms of [3000, 8000, 20_000]) cx.timer.after(ms, (cx) => this.refresh(cx, { history: true }));
      cx.notify();
    });
  }

  idle() {
    const { install: _install, ...rest } = this.busy;
    this.busy = rest;
  }

  paneOf(address) {
    const p = panes().find((q) => q.terminal === address);
    const given = terminals().find((t) => t.address === address)?.labels?.["kanso.name"];
    return { pane: p, name: given || p?.program?.name || p?.title || address };
  }

  row(s, c) {
    const busy = this.stopping.has(portKey(s)), id = rowId(s);
    const owner = s.owner ? this.paneOf(s.owner) : null;
    const since = s.startedAt ?? Date.now() - s.secs * 1000;
    return v_flex().w_full().px(G.md).py(10).gap(4).rounded(6).hover((st) => st.bg(c.subtle)).when(busy, (el) => el.opacity(0.45))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(div().flex_none().text_size(17).font_light().text_color(c.text).child(s.ports.map((p) => `:${p}`).join(" ")))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.muted).child(shortArgs(s.args)))
        .when(typeof s.mb === "number", (el) => el.child(div().flex_none().text_size(12.5).text_color(c.muted).child(size(s.mb))))
        .child(div().flex_none().text_size(11.5).text_color(c.dim).tooltip(`Since ${clock(since)}`).child(age(s.secs))))
      .child(h_flex().w_full().min_w(0).gap(G.sm).items_center()
        .child(div().size(6).flex_none().rounded_full().bg(owner ? c.green : c.yellow))
        .child(div().flex_none().text_size(12).text_color(owner ? c.muted : c.yellow).child(owner ? `In ${owner.name}` : NO_PANE))
        .when(Boolean(s.cwd || s.project || s.cwdReason), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(s.cwd ? tilde(s.cwd) : s.project || s.cwdReason))))
      .child(h_flex().flex_wrap().gap_x(G.lg)
        .child(quietLink(`pt-open-${id}`, "Open in the browser", (cx) => this.openPort(s, cx), c, { color: c.text }))
        .when(Boolean(owner?.pane), (el) => el.child(quietLink(`pt-go-${id}`, "Go to its pane", () => run("pane.focus", { terminal: s.owner }), c)))
        .child(this.armed.link(`pt-stop-${id}`, busy ? "Stopping…" : s.force ? "Force stop" : "Stop", s.force ? "force stop" : "stop",
          `stop:${id}`, (cx) => this.stop([s], cx), c, { disabled: busy })));
  }

  hero(c, list, narrow) {
    const loose = list.filter((s) => !s.owner);
    const here = aliasText(shared("kanso.alias"), "");
    const held = list.reduce((t, s) => t + (typeof s.mb === "number" ? s.mb : 0), 0);
    const st = this.digest?.stats;
    const stats = [
      { value: String(loose.length), unit: NO_PANE, hot: loose.length > 0 },
      held > 0 ? { value: size(held), unit: "held now" } : null,
      st ? { value: String(st.openedToday), unit: "opened today" } : null,
      st ? { value: String(st.stopped), unit: "stopped by you", tip: st.since ? `Since ${clock(st.since)}` : null } : null,
      st && st.freedMB > 0 ? { value: size(st.freedMB), unit: "given back", tip: st.since ? `Since ${clock(st.since)}` : null } : null,
    ].filter(Boolean);
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().gap(G.xs)
        .child(div().text_size(15).text_color(c.muted).child(here ? `Listening on ${machineTitle("", "", here)}` : "Listening on this computer"))
        .child(h_flex().items_end().gap(G.md)
          .child(div().text_size(narrow ? 48 : 64).line_height(1).font_light().text_color(c.text).child(String(list.length)))
          .child(div().pb(narrow ? 6 : 9).text_size(13).text_color(c.dim).child(list.length === 1 ? "server" : "servers"))))
      .child(h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
        .children(stats.map((s) => h_flex().items_end().gap(6).when(Boolean(s.tip), (el) => el.tooltip(s.tip))
          .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(s.hot ? c.yellow : c.text).child(s.value))
          .child(div().pb(3).text_size(12).text_color(c.dim).child(s.unit)))))
      .when(loose.length > 0, (el) => el.child(h_flex().gap(G.lg).items_center().flex_wrap()
        .child(this.armed.button("pt-stop-all", `Stop ${loose.length} ${NO_PANE}`, `stop ${loose.length}`, "all", (cx) => this.stop(loose, cx), c))
        .child(div().text_size(12).text_color(c.dim).child("The ones in a pane stay."))));
  }

  remoteSections(c) {
    const alias = shared("kanso.alias");
    return machines().filter((m) => m?.name).flatMap((m) => {
      const r = this.remote?.[m.name], title = machineTitle(m.name, "", aliasText(alias, m.name));
      const why = m.layout === "unavailable" ? "unreachable" : r?.why;
      if (why) return [div().w_full().truncate().text_size(11.5).text_color(c.blocked).child(`${title} · ${why}`)];
      if (!r?.list?.length) return [];
      return [v_flex().w_full().gap(2)
        .child(section(c, title, String(r.list.length)))
        .when(Boolean(r.said), (el) => el.child(div().w_full().truncate().text_size(11.5).text_color(c.blocked).child(`${title} · ${r.said}`)))
        .children(r.list.map((s) => this.row(s, c)))];
    });
  }

  guardOff(c) {
    const state = this.hist?.state, busy = Boolean(this.busy.install);
    const at = this.hist?.data?.at;
    return h_flex().w_full().gap(G.lg).items_center().flex_wrap()
      .child(div().text_size(12).text_color(state === "stale" ? c.red : c.dim)
        .child(state === "stale" ? `History stopped at ${clock(at)}` : state === "bad" ? "History unreadable" : "No history"))
      .child(quietLink("pt-guard-on", busy ? "Turning on…" : "Turn on the guard", (cx) => this.turnOn(cx), c, { color: c.text, disabled: busy }));
  }

  chart(c) {
    const series = this.digest?.series?.[this.range];
    const height = 72;
    const anyLoose = (series?.bars ?? []).some((b) => b.loose > 0);
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_center().justify_between().gap(G.md).pb(G.xs)
        .child(segmented("pt-range", RANGES.map((r) => ({ key: r.key, label: r.label })), this.range, (key, cx) => { this.range = key; cx.notify(); }, c))
        .child(div().text_size(12).text_color(c.dim).child(series && !series.empty ? `peak ${series.peak} at once` : "")))
      .child(h_flex().w_full().h(height + 18).items_end()
        .children((series?.bars ?? []).map((bar) => {
          const total = bar.empty ? 1 : Math.max(2, Math.round(bar.ratio * height));
          const looseH = bar.loose ? Math.min(total, Math.max(2, Math.round(bar.looseRatio * height))) : 0;
          return v_flex().flex_1().min_w(0).h(height + 18).items_center().justify_end().gap(4).tooltip(bar.tip)
            .when(Boolean(bar.mark), (el) => el.child(div().text_size(10).text_color(c.text).whitespace_nowrap().child(bar.value)))
            .child(v_flex().w(bar.mark ? 3 : 2).flex_none()
              .when(total - looseH > 0, (el) => el.child(div().w_full().h(total - looseH).rounded_t(1)
                .bg(bar.mark ? c.accent : bar.empty ? c.border : c.muted).opacity(bar.mark || bar.empty ? 1 : 0.55)))
              .when(looseH > 0, (el) => el.child(div().w_full().h(looseH).when(total === looseH, (d) => d.rounded_t(1)).bg(c.yellow))));
        })))
      .child(h_flex().w_full().justify_between().items_center()
        .child(div().text_size(10).text_color(c.dim).child(series?.first ?? ""))
        .child(h_flex().gap(G.xs).items_center()
          .child(div().text_size(10).text_color(c.dim).child("Servers"))
          .when(anyLoose, (el) => el.child(div().size(5).ml(G.sm).rounded_full().bg(c.yellow)).child(div().text_size(10).text_color(c.dim).child(NO_PANE))))
        .child(div().text_size(10).text_color(c.dim).child(series?.last ?? "")));
  }

  history(c) {
    const lists = this.digest?.lists;
    const tabs = [
      lists?.opened.length ? { key: "opened", label: "Opened today", rows: lists.opened } : null,
      lists?.ended.length ? { key: "ended", label: "Recently ended", rows: lists.ended } : null,
    ].filter(Boolean);
    if (!tabs.length) return null;
    const tab = tabs.find((t) => t.key === this.tab) ?? tabs[0];
    const open = this.showAll || tab.rows.length <= LIST_ROWS;
    const shown = open ? tab.rows : tab.rows.slice(0, LIST_ROWS);
    const head = tabs.length > 1
      ? h_flex().w_full().items_center().justify_between().gap(G.md).pb(G.sm)
        .child(segmented("pt-list", tabs.map((t) => ({ key: t.key, label: t.label })), tab.key, (key, cx) => { this.tab = key; this.showAll = false; cx.notify(); }, c))
        .child(div().text_size(12).text_color(c.dim).child(String(tab.rows.length)))
      : section(c, tab.label, String(tab.rows.length));
    return v_flex().w_full()
      .child(head)
      .children(shown.map((r) => h_flex().w_full().items_center().gap(G.md).py(G.sm).border_t(1).border_color(c.border)
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().w_full().truncate().text_size(13).text_color(c.text).child(r.name))
          .child(h_flex().w_full().flex_wrap().gap_x(G.md)
            .children([r.ports, r.opened, r.ran].filter(Boolean).map((part) => div().text_size(11).text_color(c.dim).whitespace_nowrap().child(part)))
            .when(Boolean(r.how), (el) => el.child(div().text_size(11).text_color(r.loose ? c.yellow : c.dim).whitespace_nowrap().child(r.how)))))
        .child(div().flex_none().text_size(15).font_light().text_color(c.text).whitespace_nowrap().tooltip("Its largest").child(r.peak))))
      .when(tab.rows.length > LIST_ROWS, (el) => el.child(h_flex().pt(G.sm)
        .child(quietLink("pt-more", this.showAll ? "Show fewer" : `Show ${tab.rows.length - LIST_ROWS} more`, (cx) => { this.showAll = !this.showAll; cx.notify(); }, c))));
  }

  skeleton(c, narrow) {
    const { block, line } = ghost(c);
    const heights = [28, 50, 36, 72, 40, 60, 24, 44, 32, 48, 20, 56];
    const two = (i) => v_flex().w_full().py(10).gap(4)
      .child(line([140, 110, 160, 96][i], 13)).child(line([180, 150, 120, 170][i], 11));
    return breathe(v_flex().id("kanso-skeleton").w_full().gap(narrow ? 32 : 44))
      .child(v_flex().gap(G.xs)
        .child(line(160, 15))
        .child(h_flex().items_end().gap(G.md).child(block(narrow ? 72 : 96, narrow ? 48 : 64, 6)).child(line(70, 13))))
      .child(h_flex().gap(narrow ? G.xl : 48).children([52, 46, 64].map((w) => block(w, narrow ? 22 : 28, 4))))
      .child(h_flex().w_full().h(72).items_end()
        .children(heights.map((h) => v_flex().flex_1().min_w(0).items_center().justify_end().child(block(2, Math.min(h, 72), 1)))))
      .child(v_flex().w_full().child(h_flex().pb(G.sm).child(line(70, 12))).children([0, 1, 2, 3].map(two)));
  }

  bones(c, narrow = true) {
    const { header } = ghost(c);
    const pad = narrow ? G.lg : 32;
    return v_flex().size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .child(h_flex().flex_none().w_full().justify_center().px(pad).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(header(narrow ? 70 : 90, narrow ? 17 : 20))
          .child(this.skeleton(c, narrow))));
  }

  render(cx) {
    this.front?.wake(cx, (wakeCx) => this.refresh(wakeCx));
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    const list = this.list ?? [];
    const state = this.hist?.state;
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Ports"))
      .child(h_flex().gap(G.xs).items_center()
        .when(this.canShare(), (el) => el.child(iconButton("pt-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open })))
        .child(iconButton("pt-refresh", "refresh", "Read again", (cx) => this.refresh(cx, { history: true, now: true }), c, { spin: this.reading })));
    const history = this.history(c);
    const others = this.list === null ? [] : this.remoteSections(c);
    const body = this.list === null
      ? this.skeleton(c, narrow)
      : v_flex().w_full().gap(narrow ? 32 : 44)
        .child(this.hero(c, list, narrow))
        .when(state !== undefined && state !== "ok", (el) => el.child(this.guardOff(c)))
        .when(Boolean(this.digest), (el) => el.child(v_flex().w_full().opacity(state === "stale" ? 0.55 : 1).child(this.chart(c))))
        .when(list.length > 0, (el) => el.child(v_flex().w_full().gap(2)
          .child(section(c, others.length ? machineTitle("", "", aliasText(shared("kanso.alias"), "")) : "Running", ""))
          .children(list.map((s) => this.row(s, c)))))
        .children(others)
        .when(Boolean(history), (el) => el.child(v_flex().w_full().opacity(state === "stale" ? 0.55 : 1).child(history)));
    return v_flex().id("kanso-ports").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => { if (Math.abs((this.width || 0) - size.width) >= 1) { this.width = size.width; sizeCx.notify(); } })
      .child(h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(header)
          .when(this.share.open && this.canShare(), (el) => el.child(this.share.row(c, () => this.shareCard(),
            "Only counts and sizes: no ports, folders, projects or commands. The post opens with the image in it.", G.sm)))
          .child(body)
          .when(Boolean(this.note), (el) => el.child(failNote("pt-note", this.note, c)))));
  }
}
