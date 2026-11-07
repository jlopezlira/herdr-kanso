import { div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, hc, panes, terminals, home, run, theme, appHome, readTextFile } from "herdr";
import { tilde } from "./lib.js";
import { tryOr } from "./pure.js";
import { G, Armed, tokens, quietLink, quietTabs, iconButton, section } from "./ui.js";
import { Share } from "./share.js";
import { portsSpec, portsText } from "./ports-card.js";
import { parsePorts, historyOf, RANGES, activeSeries, portStats, historyLists, size, clock } from "./ports-model.js";

// The guard's files: change the name here if it is installed under another.
const GUARD = "kanso-guard";
const PORTS_FILE = `data/${GUARD}/ports.json`;
const GUARD_FILE = `mods/${GUARD}/guard.mjs`;
const RUNTIME_FILE = `mods/${GUARD}/runtime.json`;
const HISTORY_MS = 30_000; // the guard writes once a minute
const BUSY_MS = 90_000;
const LIST_ROWS = 12;
// One detached shell stops them one at a time: $0 node, $1 guard.mjs, then a pid each ("pid:force" for a force stop).
export const STOP_LOOP = 'g="$1"; shift; for a in "$@"; do case "$a" in *:force) "$0" "$g" stop-server "${a%:force}" force;; *) "$0" "$g" stop-server "$a";; esac; done';
const DETACHED = 'nohup "$0" "$@" >/dev/null 2>&1 &';

const EVERY_MS = 10000;

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

// `ps -axo pid=,ppid=,etime=,args=`: pid -> { ppid, secs, args }.
export function parsePs(text) {
  return new Map(String(text ?? "").split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [[Number(m[1]), { ppid: Number(m[2]), secs: etimeSecs(m[3]), args: m[4] }]] : [];
  }));
}

// ps's elapsed time, [[dd-]hh:]mm:ss, in seconds.
export function etimeSecs(s) {
  const [days, rest] = String(s).includes("-") ? String(s).split("-") : [0, String(s)];
  const parts = rest.split(":").map(Number).toReversed();
  return Number(days) * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}

// The terminal a process runs in: the first ancestor that is a terminal's shell (`shells`: pid -> address), or null; 64 hops at most.
export function ownerOf(pid, ps, shells) {
  const up = (p, hops) => (!(p > 1 && hops < 64) ? null : shells.has(p) ? shells.get(p) : up(ps.get(p)?.ppid ?? 0, hops + 1));
  return up(pid, 0);
}

// Worth showing: a terminal's, or one under home (not home itself, not ~/Library, where apps keep theirs).
export function servers(listen, cwds, ps, shells, homeDir) {
  return [...listen.values()].flatMap((s) => {
    const cwd = cwds.get(s.pid) ?? null, owner = ownerOf(s.pid, ps, shells);
    const mine = cwd && cwd.startsWith(homeDir + "/") && !cwd.startsWith(homeDir + "/Library/");
    if (!owner && !mine) return [];
    const p = ps.get(s.pid);
    return [{ pid: s.pid, ports: s.ports, command: s.command, args: p?.args ?? s.command, secs: p?.secs ?? 0, cwd, owner }];
  }).toSorted((a, b) => Boolean(a.owner) - Boolean(b.owner) || a.ports[0] - b.ports[0]);
}

export const shortArgs = (args) => {
  const [cmd, ...rest] = String(args).split(" ");
  return [cmd.split("/").at(-1), ...rest].join(" ");
};

const age = (secs) => secs < 3600 ? `${Math.max(1, Math.round(secs / 60))} min` : secs < 86400 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;

export class Ports {
  constructor() { this.armed = new Armed(); this.share = new Share("kanso-panel"); } // Stop asks for a second press

  // What the share card holds: counts and sizes, never a port, folder, project or command.
  canShare() { return Boolean(this.hist?.data); }

  shareCard() {
    const data = this.hist.data;
    return { spec: portsSpec(data), text: portsText(data), name: "ports", title: "Ports" };
  }

  init(cx) {
    this.list = null; this.note = null; this.stopping = new Set(); this.forced = new Set(); this.width = 368;
    this.hist = null; // parsePorts(): { state, data }
    this.digest = null; // what the history draws, worked out once per read
    this.histAt = 0; this.range = "day"; this.tab = null; this.showAll = false; this.busy = {};
    this.refresh(cx);
    cx.timer.every(EVERY_MS, (cx) => this.refresh(cx));
  }

  async shells() {
    const local = terminals().filter((t) => t?.address && !String(t.address).includes("/") && t.state !== "dead");
    const asked = async (t) => {
      const r = await hc(["get", t.address, "--json"]).catch(() => null);
      return tryOr(() => (r?.code === 0 ? JSON.parse(r.stdout).pid : null));
    };
    const found = await Promise.all(local.map(async (t) => {
      const pid = t.pid || await asked(t);
      return pid ? [[Number(pid), t.address]] : [];
    }));
    return new Map(found.flat());
  }

  async read() {
    const listen = parseListen((await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])).stdout);
    const pids = [...listen.keys()];
    const [cwdOut, psOut, shells] = await Promise.all([
      pids.length ? exec("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"]).then((r) => r.stdout) : "",
      exec("ps", ["-axo", "pid=,ppid=,etime=,args="]).then((r) => r.stdout),
      this.shells()]);
    const list = servers(listen, parseCwds(cwdOut), parsePs(psOut), shells, home());
    const now = Date.now();
    return list.map((s) => {
      const h = historyOf(s, this.hist?.data, now);
      return {
        ...s,
        // One asked to stop that is still here gets a force stop next.
        ...(this.forced?.has(s.pid) ? { force: true } : {}),
        ...(h ? { mb: h.mb, startedAt: h.startedAt, project: h.project } : {}),
      };
    });
  }

  /** Read ports.json: a file read, no process. */
  async readHistory() {
    const text = await readTextFile(`${appHome()}/${PORTS_FILE}`).catch(() => null);
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

  refresh(cx, { history = false, then = null } = {}) {
    if (this.reading) { if (then) cx.timer.after(1000, (cx) => this.refresh(cx, { history, then })); return; }
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        if (history || Date.now() - this.histAt >= HISTORY_MS) await this.readHistory();
        this.list = await this.read(); this.note = null;
      } catch (e) { this.note = `Could not read the ports: ${String(e?.message ?? e)}`; this.list = this.list ?? []; }
      finally { this.reading = false; then?.(); cx.notify(); }
    });
  }

  async guardReady() {
    if (!this.hist?.data) return false;
    if (this.guardFile === undefined) this.guardFile = (await exec("test", ["-f", `${appHome()}/${GUARD_FILE}`]).catch(() => null))?.code === 0;
    return this.guardFile;
  }

  async node() {
    if (this.nodeBin) return this.nodeBin;
    const raw = await readTextFile(`${appHome()}/${RUNTIME_FILE}`).catch(() => null);
    const v = tryOr(() => JSON.parse(raw ?? "{}")?.node);
    const node = typeof v === "string" && v.trim() ? v.trim() : "node";
    this.nodeBin = node;
    return node;
  }

  // Through the guard when installed (it measures what stopping gives back); without it, the signal directly.
  stop(items, cx) {
    this.stopping = new Set([...this.stopping, ...items.map((s) => s.pid)]);
    cx.notify();
    cx.spawn(async (cx) => {
      const viaGuard = await this.guardReady();
      if (viaGuard) {
        // pid@start: the guard stops it only if that pid is still the process this row showed.
        const args = items.map((s) => `${s.pid}@${Math.round(Date.now() - (s.secs ?? 0) * 1000)}${s.force ? ":force" : ""}`);
        await exec("sh", ["-c", DETACHED, "sh", "-c", STOP_LOOP, await this.node(), `${appHome()}/${GUARD_FILE}`, ...args]).catch(() => null);
      } else {
        for (const s of items) await exec("kill", [s.force ? "-KILL" : "-TERM", String(s.pid)]).catch(() => null);
      }
      this.forced = new Set([...this.forced, ...items.map((s) => s.pid)]);
      await cx.sleep(1500);
      try { this.list = await this.read(); } catch { /* the timer reads again */ }
      const settled = (gone) => { this.stopping = new Set([...this.stopping].filter((pid) => !gone.some((s) => s.pid === pid))); };
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

  turnOn(cx) {
    if (this.busy.install && Date.now() - this.busy.install < BUSY_MS) return;
    this.busy = { ...this.busy, install: Date.now() };
    cx.notify();
    cx.spawn(async (cx) => {
      await exec("sh", ["-c", DETACHED, await this.node(), `${appHome()}/${GUARD_FILE}`, "install"]).catch(() => { this.idle(); });
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
    const key = `stop:${s.pid}`, armed = this.armed.is(key), busy = this.stopping.has(s.pid);
    const owner = s.owner ? this.paneOf(s.owner) : null;
    const stopLabel = busy ? "Stopping…" : armed ? (s.force ? "Press again to force stop" : "Press again to stop") : s.force ? "Force stop" : "Stop";
    const since = s.startedAt ?? Date.now() - s.secs * 1000;
    return v_flex().w_full().px(G.md).py(10).gap(4).rounded(6).hover((st) => st.bg(c.subtle)).when(busy, (el) => el.opacity(0.45))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(div().flex_none().text_size(17).font_light().text_color(c.text).child(s.ports.map((p) => `:${p}`).join(" ")))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.muted).child(shortArgs(s.args)))
        .when(typeof s.mb === "number", (el) => el.child(div().flex_none().text_size(12.5).text_color(c.muted).child(size(s.mb))))
        .child(div().flex_none().text_size(11.5).text_color(c.dim).tooltip(`Since ${clock(since)}`).child(age(s.secs))))
      .child(h_flex().w_full().min_w(0).gap(G.sm).items_center()
        .child(div().size(6).flex_none().rounded_full().bg(owner ? c.green : c.yellow))
        .child(div().flex_none().text_size(12).text_color(owner ? c.muted : c.yellow).child(owner ? `In ${owner.name}` : "No pane runs it"))
        .when(Boolean(s.cwd || s.project), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(s.cwd ? tilde(s.cwd) : s.project))))
      .child(h_flex().flex_wrap().gap_x(G.lg)
        .child(quietLink(`pt-open-${s.pid}`, "Open in the browser", (cx) => cx.open_url(`http://localhost:${s.ports[0]}`), c, { color: c.text }))
        .when(Boolean(owner?.pane), (el) => el.child(quietLink(`pt-go-${s.pid}`, "Go to its pane", () => run("pane.focus", { terminal: s.owner }), c)))
        .child(quietLink(`pt-stop-${s.pid}`, stopLabel, (cx) => { if (!busy) this.armed.press(key, cx, (cx) => this.stop([s], cx)); }, c, { color: armed ? c.red : c.muted })));
  }

  hero(c, list, narrow) {
    const loose = list.filter((s) => !s.owner);
    const armedAll = this.armed.is("all");
    const held = list.reduce((t, s) => t + (typeof s.mb === "number" ? s.mb : 0), 0);
    const st = this.digest?.stats;
    const stats = [
      { value: String(loose.length), unit: "with no pane", hot: loose.length > 0 },
      held > 0 ? { value: size(held), unit: "held now" } : null,
      st ? { value: String(st.openedToday), unit: "opened today" } : null,
      st ? { value: String(st.stopped), unit: "stopped by you", tip: st.since ? `Since ${clock(st.since)}` : null } : null,
      st && st.freedMB > 0 ? { value: size(st.freedMB), unit: "given back", tip: st.since ? `Since ${clock(st.since)}` : null } : null,
    ].filter(Boolean);
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().gap(G.xs)
        .child(div().text_size(15).text_color(c.muted).child("Listening on this computer"))
        .child(h_flex().items_end().gap(G.md)
          .child(div().text_size(narrow ? 48 : 64).line_height(1).font_light().text_color(c.text).child(String(list.length)))
          .child(div().pb(narrow ? 6 : 9).text_size(13).text_color(c.dim).child(list.length === 1 ? "server" : "servers"))))
      .child(h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
        .children(stats.map((s) => h_flex().items_end().gap(6).when(Boolean(s.tip), (el) => el.tooltip(s.tip))
          .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(s.hot ? c.yellow : c.text).child(s.value))
          .child(div().pb(3).text_size(12).text_color(c.dim).child(s.unit)))))
      .when(loose.length > 0, (el) => el.child(h_flex().gap(G.lg).items_center().flex_wrap()
        .child(Button.new("pt-stop-all").h(30).px(14).flex_none().items_center().rounded(6).cursor_pointer()
          .bg(armedAll ? c.red : c.primary).hover((s) => s.opacity(0.85))
          .on_click((_e, cx) => this.armed.press("all", cx, (cx) => this.stop(loose, cx)))
          .child(div().text_size(12).font_medium().text_color(armedAll ? "#ffffff" : c.primaryText)
            .child(armedAll ? `Press again to stop ${loose.length}` : `Stop ${loose.length} with no pane`)))
        .child(div().text_size(12).text_color(c.dim).child("The ones in a pane stay."))));
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
        .child(quietTabs("pt-range", RANGES.map((r) => ({ key: r.key, label: r.label })), this.range, (key, cx) => { this.range = key; cx.notify(); }, c))
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
          .when(anyLoose, (el) => el.child(div().size(5).ml(G.sm).rounded_full().bg(c.yellow)).child(div().text_size(10).text_color(c.dim).child("no pane"))))
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
        .child(quietTabs("pt-list", tabs.map((t) => ({ key: t.key, label: t.label })), tab.key, (key, cx) => { this.tab = key; this.showAll = false; cx.notify(); }, c))
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

  render(cx) {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    const list = this.list ?? [];
    const state = this.hist?.state;
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Ports"))
      .child(h_flex().gap(G.xs).items_center()
        .when(this.canShare(), (el) => el.child(iconButton("pt-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open })))
        .child(iconButton("pt-refresh", "refresh", "Read again", (cx) => this.refresh(cx, { history: true }), c, { spin: this.reading })));
    const history = this.history(c);
    const body = this.list === null
      ? div().text_size(13).text_color(c.dim).child("Reading the ports")
      : v_flex().w_full().gap(narrow ? 32 : 44)
        .child(this.hero(c, list, narrow))
        .when(state !== undefined && state !== "ok", (el) => el.child(this.guardOff(c)))
        .when(Boolean(this.digest), (el) => el.child(v_flex().w_full().opacity(state === "stale" ? 0.55 : 1).child(this.chart(c))))
        .when(list.length > 0, (el) => el.child(v_flex().w_full().gap(2)
          .child(section(c, "Running", ""))
          .children(list.map((s) => this.row(s, c)))))
        .when(Boolean(history), (el) => el.child(v_flex().w_full().opacity(state === "stale" ? 0.55 : 1).child(history)));
    return v_flex().id("kanso-ports").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => { if (Math.abs((this.width || 0) - size.width) >= 1) { this.width = size.width; sizeCx.notify(); } })
      .child(h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(header)
          .when(this.share.open && this.canShare(), (el) => el.child(this.share.row(c, () => this.shareCard(),
            "Only counts and sizes: no ports, folders, projects or commands. The post opens with the image in it.", G.sm)))
          .child(body)
          .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(c.red).child(this.note)))
          .child(div().text_size(10.5).text_color(c.dim).child("Programs of yours listening on a TCP port, started in a pane or from a folder in your home. This computer only."))));
  }
}
