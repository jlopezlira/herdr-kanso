// Ports: the dev servers listening on this computer, and the ones nobody owns.
//
// Agents start servers (npm run dev, vite, a Django runserver) and leave them
// running when their pane closes, as they leave worktrees behind. This lists
// every program of yours listening on a TCP port from a project folder, says
// which pane runs it (its process descends from that terminal's shell), and
// marks the ones no pane owns any more. Open one in the browser, go to its
// pane, or stop it: a second press confirms, SIGTERM first, then a force stop
// for one that won't go. Only this computer; nothing is read but lsof and ps.
import { div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, hc, panes, terminals, home, run, theme } from "herdr";
import { tilde } from "./lib.js";
import { G, Armed, tokens, quietLink, iconButton } from "./ui.js";
import { Share } from "./share.js";
import { portsSpec, portsText, readTally, addToTally } from "./ports-card.js";

// What Stop has given back over time, for the share card: this computer's
// own count, kept with the window's other local settings.
const TALLY = "kanso.ports.tally";
const loadTally = () => { try { return readTally(localStorage.getItem(TALLY)); } catch { return readTally(null); } };
const saveTally = (t) => { try { localStorage.setItem(TALLY, JSON.stringify(t)); } catch { /* not kept */ } };

// Resident memory of each pid with everything under it (a dev server's
// workers), in MB, from `ps -axo pid=,ppid=,rss=`.
export function treeMB(text, pids) {
  const kids = new Map(), rss = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)/.exec(line);
    if (!m) continue;
    const [pid, ppid, kb] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rss.set(pid, kb);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const out = new Map();
  for (const root of pids) {
    let kb = 0;
    const seen = new Set(), stack = [root];
    while (stack.length) { const p = stack.pop(); if (seen.has(p)) continue; seen.add(p); kb += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
    out.set(root, Math.round(kb / 1024));
  }
  return out;
}

const EVERY_MS = 10000;

// `lsof -F pcn` of the listening sockets: pid -> { pid, command, ports }.
export function parseListen(text) {
  const out = new Map();
  let cur = null;
  for (const line of String(text ?? "").split("\n")) {
    const k = line[0], v = line.slice(1);
    if (k === "p") { cur = { pid: Number(v), command: "", ports: [] }; out.set(cur.pid, cur); }
    else if (k === "c" && cur) cur.command = v;
    else if (k === "n" && cur) {
      const port = Number(v.slice(v.lastIndexOf(":") + 1));
      if (port && !cur.ports.includes(port)) cur.ports.push(port);
    }
  }
  for (const s of out.values()) s.ports.sort((a, b) => a - b);
  return out;
}

// `lsof -a -d cwd -F pn`: pid -> its working folder.
export function parseCwds(text) {
  const out = new Map();
  let pid = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid != null) out.set(pid, line.slice(1));
  }
  return out;
}

// `ps -axo pid=,ppid=,etime=,args=`: pid -> { ppid, secs, args }.
export function parsePs(text) {
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) out.set(Number(m[1]), { ppid: Number(m[2]), secs: etimeSecs(m[3]), args: m[4] });
  }
  return out;
}

// ps's elapsed time, [[dd-]hh:]mm:ss, in seconds.
export function etimeSecs(s) {
  const [days, rest] = String(s).includes("-") ? String(s).split("-") : [0, String(s)];
  const parts = rest.split(":").map(Number).reverse();
  return Number(days) * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}

// The terminal a process runs in: the first of its ancestors that is a
// terminal's shell (`shells`: pid -> terminal address), or null.
export function ownerOf(pid, ps, shells) {
  for (let p = pid, hops = 0; p > 1 && hops < 64; p = ps.get(p)?.ppid ?? 0, hops++) if (shells.has(p)) return shells.get(p);
  return null;
}

// The servers worth showing: a terminal's, or one started in a folder of
// your home (not the home itself, not ~/Library, where apps keep theirs).
export function servers(listen, cwds, ps, shells, homeDir) {
  const out = [];
  for (const s of listen.values()) {
    const cwd = cwds.get(s.pid) ?? null, owner = ownerOf(s.pid, ps, shells);
    const mine = cwd && cwd.startsWith(homeDir + "/") && !cwd.startsWith(homeDir + "/Library/");
    if (!owner && !mine) continue;
    const p = ps.get(s.pid);
    out.push({ pid: s.pid, ports: s.ports, command: s.command, args: p?.args ?? s.command, secs: p?.secs ?? 0, cwd, owner });
  }
  return out.sort((a, b) => Boolean(a.owner) - Boolean(b.owner) || a.ports[0] - b.ports[0]);
}

// A command line, short: the program's name and its arguments.
export const shortArgs = (args) => {
  const [cmd, ...rest] = String(args).split(" ");
  return [cmd.split("/").pop(), ...rest].join(" ");
};

const age = (secs) => secs < 3600 ? `${Math.max(1, Math.round(secs / 60))} min` : secs < 86400 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 86400)} d`;

export class Ports {
  constructor() { this.armed = new Armed(); this.share = new Share("kanso-panel"); } // Stop asks for a second press

  // What the share card holds: counts and sizes, never a port, folder or command.
  shareCard() {
    const list = this.list ?? [], tally = loadTally();
    return { spec: portsSpec(list, tally), text: portsText(list, tally), name: "ports", title: "Ports" };
  }

  init(cx) {
    this.list = null; this.note = null; this.stopping = new Set(); this.forced = new Set(); this.width = 368;
    this.refresh(cx);
    cx.timer.every(EVERY_MS, (cx) => this.refresh(cx));
  }

  // Terminal shells by pid: herdr-core knows each terminal's.
  async shells() {
    const out = new Map();
    const local = terminals().filter((t) => t?.address && !String(t.address).includes("/") && t.state !== "dead");
    await Promise.all(local.map(async (t) => {
      let pid = t.pid;
      if (!pid) {
        const r = await hc(["get", t.address, "--json"]).catch(() => null);
        try { pid = r?.code === 0 ? JSON.parse(r.stdout).pid : null; } catch { pid = null; }
      }
      if (pid) out.set(Number(pid), t.address);
    }));
    return out;
  }

  async read() {
    const listen = parseListen((await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])).stdout);
    const pids = [...listen.keys()];
    const [cwdOut, psOut, shells] = await Promise.all([
      pids.length ? exec("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"]).then((r) => r.stdout) : "",
      exec("ps", ["-axo", "pid=,ppid=,etime=,args="]).then((r) => r.stdout),
      this.shells()]);
    const list = servers(listen, parseCwds(cwdOut), parsePs(psOut), shells, home());
    // One asked to stop that is still here gets a force stop next.
    for (const s of list) if (this.forced?.has(s.pid)) s.force = true;
    return list;
  }

  refresh(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try { this.list = await this.read(); this.note = null; this.countStopped(); }
      catch (e) { this.note = `Could not read the ports: ${String(e?.message ?? e)}`; this.list ??= []; }
      finally { this.reading = false; cx.notify(); }
    });
  }

  // SIGTERM, or SIGKILL for one asked to stop that is still here.
  stop(items, cx) {
    for (const s of items) this.stopping.add(s.pid);
    cx.notify();
    cx.spawn(async (cx) => {
      // Their memory, before they go: what the share card counts as given back.
      const before = await exec("ps", ["-axo", "pid=,ppid=,rss="]).then((r) => treeMB(r.stdout, items.map((s) => s.pid))).catch(() => new Map());
      this.asked ??= new Map(); // pid -> its MB, until it is gone
      for (const s of items) if (!this.asked.has(s.pid)) this.asked.set(s.pid, before.get(s.pid) ?? 0);
      for (const s of items) await exec("kill", [s.force ? "-KILL" : "-TERM", String(s.pid)]).catch(() => null);
      this.forced ??= new Set();
      for (const s of items) this.forced.add(s.pid);
      await cx.sleep(900);
      try { this.list = await this.read(); } catch { /* the timer reads again */ }
      this.countStopped();
      for (const s of items) this.stopping.delete(s.pid);
      cx.notify();
    });
  }

  // A server you stopped counts once, when it no longer listens (a slow one
  // may take until the next read). One still there after a minute is let go.
  countStopped() {
    if (!this.asked?.size || !this.list) return;
    let n = 0, mb = 0;
    for (const [pid, size] of this.asked) {
      if (this.list.some((x) => x.pid === pid)) continue;
      n++; mb += size; this.asked.delete(pid);
    }
    if (n) saveTally(addToTally(loadTally(), n, mb));
  }

  // Which pane runs it, by the name its header shows.
  paneOf(address) {
    const p = panes().find((q) => q.terminal === address);
    const given = terminals().find((t) => t.address === address)?.labels?.["kanso.name"];
    return { pane: p, name: given || p?.program?.name || p?.title || address };
  }

  row(s, c) {
    const key = `stop:${s.pid}`, armed = this.armed.is(key), busy = this.stopping.has(s.pid);
    const owner = s.owner ? this.paneOf(s.owner) : null;
    const stopLabel = busy ? "Stopping…" : armed ? (s.force ? "Press again to force stop" : "Press again to stop") : s.force ? "Force stop" : "Stop";
    return v_flex().w_full().px(G.md).py(10).gap(4).rounded(6).hover((st) => st.bg(c.subtle)).when(busy, (el) => el.opacity(0.45))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(div().flex_none().text_size(17).font_light().text_color(c.text).child(s.ports.map((p) => `:${p}`).join(" ")))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.muted).child(shortArgs(s.args)))
        .child(div().flex_none().text_size(11.5).text_color(c.dim).child(age(s.secs))))
      .child(h_flex().w_full().min_w(0).gap(G.sm).items_center()
        .child(div().size(6).flex_none().rounded_full().bg(owner ? c.green : c.yellow))
        .child(div().flex_none().text_size(12).text_color(owner ? c.muted : c.yellow).child(owner ? `In ${owner.name}` : "No pane runs it"))
        .when(Boolean(s.cwd), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(tilde(s.cwd)))))
      .child(h_flex().flex_wrap().gap_x(G.lg)
        .child(quietLink(`pt-open-${s.pid}`, "Open in the browser", (cx) => cx.open_url(`http://localhost:${s.ports[0]}`), c, { color: c.text }))
        .when(Boolean(owner?.pane), (el) => el.child(quietLink(`pt-go-${s.pid}`, "Go to its pane", () => run("pane.focus", { terminal: s.owner }), c)))
        .child(quietLink(`pt-stop-${s.pid}`, stopLabel, (cx) => { if (!busy) this.armed.press(key, cx, (cx) => this.stop([s], cx)); }, c, { color: armed ? c.red : c.muted })));
  }

  render(cx) {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    const list = this.list ?? [], loose = list.filter((s) => !s.owner);
    const armedAll = this.armed.is("all");
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Ports"))
      .child(h_flex().gap(G.xs).items_center()
        .child(iconButton("pt-share", "share", "Share", (cx) => this.share.toggle(cx), c, { disabled: this.list === null, active: this.share.open }))
        .child(iconButton("pt-refresh", "refresh", "Read again", (cx) => this.refresh(cx), c, { spin: this.reading })));
    const hero = v_flex().gap(G.xs)
      .child(div().text_size(15).text_color(c.muted).child("Listening on this computer"))
      .child(h_flex().items_end().gap(G.md)
        .child(div().text_size(narrow ? 48 : 64).line_height(1).font_light().text_color(c.text).child(String(list.length)))
        .child(div().pb(narrow ? 6 : 9).text_size(13).text_color(c.dim).child(list.length === 1 ? "server" : "servers")))
      .child(div().text_size(15).text_color(c.dim).child(loose.length
        ? `${loose.length} ${loose.length === 1 ? "runs" : "run"} with no pane: left behind when its pane closed.`
        : "Every one runs in a pane."))
      .when(loose.length > 0, (el) => el.child(h_flex().pt(G.md).gap(G.lg).items_center().flex_wrap()
        .child(Button.new("pt-stop-all").h(30).px(14).flex_none().items_center().rounded(6).cursor_pointer()
          .bg(armedAll ? c.red : c.primary).hover((s) => s.opacity(0.85))
          .on_click((_e, cx) => this.armed.press("all", cx, (cx) => this.stop(loose, cx)))
          .child(div().text_size(12).font_medium().text_color(armedAll ? "#ffffff" : c.primaryText)
            .child(armedAll ? `Press again to stop ${loose.length}` : `Stop ${loose.length} with no pane`)))
        .child(div().text_size(12).text_color(c.dim).child("The ones in a pane stay."))));
    const body = this.list === null
      ? div().text_size(13).text_color(c.dim).child("Reading the ports")
      : !list.length
        ? v_flex().gap(G.sm).child(div().text_size(15).text_color(c.muted).child("No dev server is running."))
          .child(div().text_size(12).text_color(c.dim).child("Servers started from your projects show here, with the pane that runs them."))
        : v_flex().w_full().gap(narrow ? 32 : 40).child(hero).child(v_flex().w_full().gap(2).children(list.map((s) => this.row(s, c))));
    return v_flex().id("kanso-ports").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => { if (Math.abs((this.width || 0) - size.width) >= 1) { this.width = size.width; sizeCx.notify(); } })
      .child(h_flex().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(header)
          .when(this.share.open && this.list !== null, (el) => el.child(this.share.row(c, () => this.shareCard(),
            "Only counts and sizes: no ports, folders or commands. The post opens with the image in it.", G.sm)))
          .child(body)
          .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(c.red).child(this.note)))
          .child(div().text_size(10.5).text_color(c.dim).child("Programs of yours listening on a TCP port, started in a pane or from a folder in your home. This computer only."))));
  }
}
