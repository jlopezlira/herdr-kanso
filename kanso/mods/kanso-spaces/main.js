// Derived from the `spaces` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: New space button, initial tiles, nested worktrees on guide lines, ahead/behind counts.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-spaces; each space lists its agents (agents.js), folded by clicking the space. The active space is a faint wash of the text color, never a theme accent.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-spaces; a fixed 76px rail when collapsed (resizable only when open), space avatars in the theme's hues, a breathing dot instead of a spinner, background polling slowed when the window is behind.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.
// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Its agents are listed under it (agents.js). Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Popover } from "gpui-base";
import { agentRow, agentFold, agentLabel, FLUSH, renameTerminal, statusMark, SETTLED_LABEL, SNOOZE_LABEL, UNREAD_LABEL, THREAD_LABEL, settledOf, snoozedUntil, isUnread, woke, backFromSettled, threadSections, snoozePresets, THREAD_ORDERS, STATUS_ORDERS, withTerminals, NAME_LABEL, PIN_LABEL, ORDERS, DEFAULT_ORDER, orderSessions, moved, nest, track, elapsed, activityOf, bySection, duration, trackSteps, stepOf, tasksOf, said, FOLD, FOLD_MS, pill, agentRowH, segmentAt } from "./agents.js";
import { findThreads } from "./threads.js";
import { isKansoTree, paintLayout, rememberLayout } from "./layout.js";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, nextCommand, home, appHome } from "herdr";

// A value kept in localStorage, when it is the same shape as `fallback`.
function stored(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v !== null && typeof v === "object" && Array.isArray(v) === Array.isArray(fallback) ? v : fallback;
  } catch { return fallback; }
}

// Where each space is now: its first terminal's live folder, else where it
// was made, with the machine, as one key (what `git` is remembered by).
// `ps`: panes(), read once by the caller (each read copies every pane).
function placesOf(sp, ps) {
  const byTab = new Map();
  for (const p of ps) if (p.cwd && !byTab.has(p.tab)) byTab.set(p.tab, p.cwd);
  const out = new Map();
  for (const s of sp) {
    const on = s.machine ?? null, cwd = (s.tabs ?? []).map((c) => byTab.get(c.id)).find(Boolean) || s.folder;
    out.set(s.id, { on, cwd, key: JSON.stringify([on, cwd]) });
  }
  return out;
}
const TREE_ROW = 32;
const PLAIN_ROW = 36;
const GUIDE_X = 19; // under the parent's avatar centre: 8px row padding + half its 22px width
const ELBOW_W = 11;
const GUIDE_OVERLAP = 4; // the line reaches up into the row above, so it never breaks
const CHILD_PAD = GUIDE_X + ELBOW_W + 6 - 8; // icon starts 6px after the elbow, inside the 8px row padding
const rowHeight = ({ tree }) => (tree ? TREE_ROW : PLAIN_ROW);
// Where the chosen rows are. A list is built in order and every item's
// height is known before it is drawn, so as the items are added up (`take`)
// the list learns where the active space and the focused agent sit
// (`tape.space`, `tape.agent`, with their heights) and puts a pill under
// each, which glides there (agents.js `pill`). `gap`: the list's own.
const take = (tape, h) => { const y = tape.y; tape.y += h + tape.gap; return y; };
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
const SIDEBAR_W = 256;
// Collapsed, the rail is as wide as the macOS traffic lights need (12px in,
// three buttons, 12px out), so they never spill over the tab bar.
const collapsedW = () => (window()?.platform === "macos" ? 76 : 44);
const OPEN_MIN = 200; // dragged open, the sidebar never gets narrower than this

// Collapsed, the rail has a fixed width: its edge can't be dragged. Open, the
// edge drags between OPEN_MIN and 480. The root row owns that edge
// (`resizable`), so both live in the layout; then the width is applied.
function setRail(open, width) {
  const min = open ? OPEN_MIN : collapsedW();
  rememberLayout({ rail: { open, min } });
  const tree = layout();
  const sidebar = (tree?.children ?? []).find((n) => n.id === "sidebar");
  if (!sidebar) return;
  if (tree.resizable !== open || sidebar.min !== min) {
    paintLayout(tree);
    if (isKansoTree(tree)) run("layout.set", { layout: tree });
  }
  run("layout.resize", { id: "sidebar", px: width });
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// The sidebar's three views, by what each is called on the switch. Each
// says how it is arranged by its own shape, never by a caption: Projects is
// a tree under each project's square, Status opens each section with the
// ensō of its state, Threads reads as an inbox of conversations.
const VIEWS = {
  spaces: { label: "Projects" },
  agents: { label: "Status" },
  threads: { label: "Threads" },
};
// Tabs put to sleep (kanso-sleep, shared "kanso.asleep"), by project key:
// the space's machine and folder, as kanso-sleep keys them.
export const projectKey = (w) => `${w?.machine ?? ""}:${w?.folder || home()}`;
const asleepOf = (w) => (shared("kanso.asleep") ?? []).filter((a) => a.from === projectKey(w));
const arrange = (props) => openOverlay({ mod: "kanso-sleep", kind: "dialog", width: 520, props });
const sleepTab = (spaceId, tab) => arrange({ sleep: { scope: "tab", space: spaceId, tab } });
const sleepProject = (spaceId) => arrange({ sleep: { scope: "project", space: spaceId } });
// What sleeps, read from kanso-sleep's database: at start (shared state
// outlives a restart and may be old) and every 30 s. A read that a newer
// publication ("kanso.asleep.at", set by kanso-sleep too) overtook is dropped.
// Reads overtaken by a later one of this sidebar are dropped too, even when
// that later one changed nothing (and so published nothing).
let asleepReads = 0, asleepApplied = 0;
async function loadAsleep() {
  const started = Date.now(), seq = ++asleepReads;
  const r = await exec("sqlite3", ["-json", `${appHome()}/data/kanso-sleep/sleep.db`, "SELECT project, name, saved, layout FROM asleep;"]).catch(() => null);
  if (seq < asleepApplied || (shared("kanso.asleep.at") ?? 0) > started) return;
  asleepApplied = seq;
  const publish = (list) => {
    if (JSON.stringify(list) === JSON.stringify(shared("kanso.asleep") ?? [])) return;
    setShared("kanso.asleep.at", started);
    setShared("kanso.asleep", list);
  };
  if (r?.code !== 0) { publish([]); return; }
  let rows = [];
  try { rows = r.stdout.trim() ? JSON.parse(r.stdout) : []; } catch { return; }
  const space = (l) => { try { return JSON.parse(l).space ?? null; } catch { return null; } };
  const who = (l) => { try { return JSON.parse(l).cols.flatMap((c) => c.panes).map((p) => p.name || String(p.argv?.[0] ?? "shell").split("/").pop()).join(", "); } catch { return ""; } };
  const busy = (l) => { try { const x = JSON.parse(l), old = Date.now() - 600000; return x.pending > old || parseInt(x.waking ?? 0, 10) > old; } catch { return true; } };
  publish(rows.filter((x) => !busy(x.layout)).map((x) => ({ from: x.project, name: x.name, saved: Number(x.saved) || 0, who: who(x.layout), space: space(x.layout) })).sort((a, b) => b.saved - a.saved));
}
const since = (ms) => { const d = new Date(ms); return new Date().toDateString() === d.toDateString() ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };

const label = (address, key, value) => hc(["label", address, `${key}=${value ?? ""}`]).catch(() => {});

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as a row's right-click menu (props().menu): nothing else to run.
    if (props()?.menu || props()?.spaceMenu) { this.confirmClose = false; return; }
    loadAsleep().catch(() => {});
    // By place key (placesOf): what git says of each place, when it was last
    // looked at, where git couldn't answer (a machine away), what to look at next.
    this.git = {}; // -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its place key at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(stored("machines.folded", []));
    this.agentsFolded = new Set(stored("spaces.agentsFolded", []));
    // How a space's agents are listed (ORDERS), and your own order per space.
    const order = localStorage.getItem("spaces.order");
    this.order = order in ORDERS ? order : DEFAULT_ORDER;
    // Each view sorts in its own terms: Status within its sections, Threads
    // its conversations (and whether they are grouped by project).
    const statusOrder = localStorage.getItem("spaces.statusOrder");
    this.statusOrder = statusOrder in STATUS_ORDERS ? statusOrder : "latest";
    const threadOrder = localStorage.getItem("spaces.threadOrder");
    this.threadOrder = threadOrder in THREAD_ORDERS ? threadOrder : "said";
    this.threadGroup = localStorage.getItem("spaces.threadGroup") === "on";
    this.shelvesOpen = new Set(stored("spaces.shelvesOpen", []));
    this.custom = stored("spaces.custom", {});
    this.orderOpen = false;
    // What you chose to see: the Spaces or the Agents view, the switch
    // between them, and the line of activity under each agent. Each agent's
    // state and since when, kept across restarts (agents.js `track`).
    const view = localStorage.getItem("spaces.view");
    this.view = view in VIEWS ? view : "spaces";
    this.threads = null; // terminal -> its conversation (threads.js), once read
    // The switch and the activity line are pieces Kanso settings can hide
    // (`kanso.hidden`); a choice made here before 2.7 moves there once.
    for (const [key, id] of [["switch", "sidebar.switch"], ["activity", "sidebar.activity"]]) {
      if (localStorage.getItem(`spaces.${key}`) === "off") { this.hide(id, true); localStorage.removeItem(`spaces.${key}`); }
    }
    this.sectionsFolded = new Set(stored("spaces.sections", []));
    this.since = stored("spaces.since", {});
    // What each agent says it is on and since when (agents.js
    // `trackSteps`), and what still runs under each (`checkTasks`).
    this.steps = {};
    this.tasks = {};
    this.held = null;
    this.hoverRow = null;
    // Folding: the group of rows on the move (`toggleFold`) and the height
    // each group measured last, so a fold knows where it ends.
    this.folding = null;
    this.foldH = {};
    this.migrate();
    this.refreshMachines(cx);
    // `hc machine ls` is a process: every 30 s while the window is in front,
    // every 2 min behind it.
    cx.timer.every(30000, cx => { if (window().active || ++this.machineTicks % 4 === 0) this.refreshMachines(cx); });
    this.machineTicks = 0;
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`). Behind other
    // windows, look every 5 s instead of every 0.5 s; nothing is missed, the
    // next look compares against the last one.
    cx.timer.every(500, (cx) => this.checkNew(cx));
    // What runs under each agent: one `ps` every 5 s in front, 30 s behind.
    cx.timer.every(5000, (cx) => this.checkTasks(cx));
    // The times beside the rows count in minutes.
    // ...and what sleeps is read again with them: a sleep or wake that
    // stopped half way shows again once it is old, and another window's
    // changes arrive.
    cx.timer.every(30000, (cx) => { loadAsleep().catch(() => {}); cx.notify(); });
    // Keys (keys.json): ⌃1-9 goes to a space by position, ⌃⌥P/S/T to a view.
    cx.spawn(async (cx) => {
      for (;;) {
        let c;
        try { c = await nextCommand(); cx.notify(); } catch { break; } // a replaced build (hot reload, update) stops here, before acting
        this.command(String(c).replace(/^kanso-spaces\./, ""), cx);
      }
    });
  }

  // A key's command. A space that isn't there is nothing to do, not an
  // error: Herdr's own space.select would say "no such space".
  command(c, cx) {
    const space = /^space-(\d)$/.exec(c), view = /^view-(spaces|agents|threads)$/.exec(c);
    if (space) { const i = Number(space[1]); if (i >= 1 && i <= spaces().length) run("space.select", { index: i }); }
    else if (view) { this.setView(view[1], cx); cx.notify(); }
  }

  // What still runs under each agent on this computer (agents.js `tasksOf`,
  // from its process: the terminal's foreground, else its shell). Each task
  // keeps the start it was first seen with, so a look that finds the same
  // ones changes nothing.
  checkTasks(cx) {
    const now = Date.now();
    if (this.psBusy || window().platform === "windows" || this.shownView() === "threads") return;
    if (!window().active && now - (this.psAt ?? 0) < 30000) return;
    const mine = terminals().filter((k) => k.state === "live" && k.status && !k.address.includes("/") && (k.foreground?.pid ?? k.pid));
    if (!mine.length) { if (Object.keys(this.tasks).length) { this.tasks = {}; cx.notify(); } return; }
    this.psAt = now;
    this.psBusy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("ps", ["-axo", "pid=,ppid=,etime=,command="]);
        if (r.code !== 0) return;
        const next = {};
        for (const k of mine) {
          const had = this.tasks[k.address] ?? [];
          const list = tasksOf(r.stdout, k.foreground?.pid ?? k.pid, Boolean(k.foreground?.pid))
            .map((x) => ({ pid: x.pid, command: x.command, start: had.find((h) => h.pid === x.pid)?.start ?? now - x.ms }));
          if (list.length) next[k.address] = list;
        }
        const key = (m) => JSON.stringify(Object.entries(m).map(([addr, l]) => [addr, l.map((x) => [x.pid, x.command])]));
        if (key(next) !== key(this.tasks)) { this.tasks = next; cx.notify(); }
      } catch {} finally { this.psBusy = false; }
    });
  }

  // The view on screen (render's choice): collapsed, or without the switch,
  // the rail shows spaces whatever was chosen. Work runs for this view only.
  shownView() {
    return shared("sidebar.collapsed") === true || this.showSwitch === false ? "spaces" : this.view;
  }

  // One-time fixes to how this rail was left by older versions. Kept out of
  // render so drawing never changes state.
  migrate() {
    const collapsed = shared("sidebar.collapsed") === true;
    // Open the rail once so search is on the same row as +, not buried under the lights.
    if (shared("kanso.row") !== 3) {
      setShared("kanso.row", 3);
      setShared("sidebar.collapsed", false);
      setRail(true, SIDEBAR_W);
      return;
    }
    // Collapsed: a fixed 76px rail (room for the traffic lights) that can't be
    // dragged. Applied on every start, so older layouts are brought in line.
    if (collapsed) setRail(false, collapsedW());
    else setRail(true, shared("sidebar.width") ?? SIDEBAR_W);
  }

  checkNew(cx) {
    const now = Date.now();
    const active = window().active;
    if (!active && now - (this.lastLook ?? 0) < 5000) return;
    this.lastLook = now;
    // Read once per look: each read copies every record.
    const sp = spaces(), ps = panes();
    this.trackAgents(now, sp, cx);
    // The Threads view reads the conversations while it shows: every 15 s
    // with the window in front, every minute behind it.
    if (this.view === "threads" && now - (this.threadsAt ?? 0) > (active ? 15000 : 60000)) this.refreshThreads(cx);
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    // Git shows on space rows only: the Agents and Threads views don't ask.
    const due = this.due(now, sp, ps, placesOf(sp, ps), active);
    if (due.size && this.shownView() === "spaces") this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
    if (now - (this.prunedAt ?? 0) > 30000) { this.prunedAt = now; this.prune(sp, now); }
  }

  // What this view keeps between looks, trimmed to what still exists, so a
  // day of spaces coming and going leaves nothing behind: git and its times
  // by place, each space's first sight and measured height, labels in flight.
  prune(sp, now) {
    const ids = new Set(sp.map((s) => s.id));
    const places = new Set(Object.values(this.at ?? {}));
    for (const k of Object.keys(this.git)) if (!places.has(k)) { delete this.git[k]; delete this.checked[k]; this.unsure.delete(k); }
    for (const map of [this.born, this.foldH]) for (const id of Object.keys(map)) if (!ids.has(id)) delete map[id];
    for (const id of [...this.shown]) if (!ids.has(id)) this.shown.delete(id);
    if (this.tidying) for (const [k, at] of this.tidying) if (now - at > 10000) this.tidying.delete(k);
  }

  // Since when each agent is in its state, and the done agent you are
  // looking at (it stays in Done in the Agents view until you leave it).
  trackAgents(now, sp, cx) {
    const list = agents();
    const tabs = new Map(sp.flatMap((s) => s.tabs ?? []).map((tb) => [tb.id, tb]));
    const next = track(this.since, list, now, (id) => tabs.get(id));
    const cur = list.find((a) => a.focused);
    // Looking turns done into idle at once: what it was a moment ago counts.
    const was = this.lastSeen ?? {};
    if (cur?.address !== this.held?.address) this.held = cur ? { address: cur.address, done: cur.status === "done" || was[cur.address] === "done" } : null;
    this.lastSeen = Object.fromEntries(list.map((a) => [a.address, a.status]));
    const terms = new Map(terminals().map((k) => [k.address, k]));
    this.tidyLabels(list, now, terms);
    // What each says it is on, from its record (the report and its time).
    const steps = trackSteps(this.steps, list.map((a) => { const k = terms.get(a.address); return { address: a.address, status: a.status, msg: k?.report?.msg, status_ms: k?.status_ms }; }), now);
    if (steps) this.steps = steps;
    if (!next) { if (steps) cx.notify(); return; }
    // A turn ended or began: what was said changed.
    if (this.view === "threads") this.threadsAt = 0;
    this.since = next;
    localStorage.setItem("spaces.since", JSON.stringify(next));
    cx.notify();
  }

  // As T3 Code: looking at a thread marked unread, or woken from a snooze,
  // reads it; new work brings a settled one back. Each label goes once
  // (`tidying` holds it until herdr-core echoes the change). `terms`:
  // terminals() by address, read once by the caller.
  tidyLabels(list, now, terms) {
    this.tidying ??= new Map();
    for (const a of list) {
      const k = terms.get(a.address), l = k?.labels ?? {};
      const drop = (key) => { const id = `${a.address}:${key}`; if (now - (this.tidying.get(id) ?? 0) < 3000) return; this.tidying.set(id, now); label(a.address, key); };
      if (a.focused && isUnread(l)) drop(UNREAD_LABEL);
      if (a.focused && woke({ labels: l }, now)) drop(SNOOZE_LABEL);
      if (backFromSettled({ ...a, labels: l, turn: k?.turn })) drop(SETTLED_LABEL);
    }
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  // `places`: placesOf(sp, ps); `active`: whether the window is in front.
  due(now, sp, ps, places, active) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    const keys = new Set(), onOf = new Map();
    for (const [id, { key, on, cwd }] of places) {
      at[id] = key;
      if (cwd) { keys.add(key); onOf.set(key, on); }
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (onOf.get(k) === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(onOf.get(k)) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  // One look at a time: a herdr-core that hangs must not stack them up.
  refreshMachines(cx) {
    if (this.machinesBusy) return;
    this.machinesBusy = true;
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      finally { this.machinesBusy = false; }
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const meta = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on });
      if (meta.code !== 0) throw new Error(meta.stderr || "git rev-parse failed");
      const [top, repo] = meta.stdout.trim().split(/\r?\n/).map((s) => s.trim());
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // A project's menu (right-click or its ⋮): sleep and wake, then Herdr's
  // own space menu. A popup is as tall as its items; height is only the most.
  menu(w) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 360, at: "pointer", props: { spaceMenu: { id: w.id } } });
  }

  // Sleep is a state. A project that sleeps whole has no space left, so it
  // stays in Projects as a quiet row of its own, its moon and count where a
  // space shows its state; a click opens its wake menu.
  asleepProjects() {
    const keys = new Set(spaces().map(projectKey));
    const by = new Map();
    for (const a of shared("kanso.asleep") ?? []) if (!keys.has(a.from)) by.set(a.from, [...(by.get(a.from) ?? []), a]);
    return [...by];
  }

  asleepProjectRow(t, key, list) {
    const name = list[0].space || key.slice(key.indexOf(":") + 1).split("/").pop() || "~";
    const open = () => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 300, at: "pointer", props: { spaceMenu: { key } } });
    return h_flex().id(`asleep-project-${key}`).h(rowHeight({ tree: null })).flex_none().px(8).gap(9).items_center().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.foreground + "0c"))
      .on_hover((h, cx) => { if (h ? this.hoverSpace !== key : this.hoverSpace === key) { this.hoverSpace = h ? key : null; cx.notify(); } })
      .tooltip(list.map((a) => `${a.name}: ${a.who}, asleep since ${since(a.saved)}`).join("\n"))
      .on_click(open)
      .on_mouse_down("right", open)
      .child(h_flex().size(22).flex_none().rounded(6).bg(t.foreground + "12").items_center().justify_center().text_size(12).font_semibold().text_color(t.muted).child(name[0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().text_color(t.muted).child(name))
      .when(this.hoverSpace === key, (el) => el.child(this.dots(`asleep-dots-${key}`, t, open)))
      .child(h_flex().flex_none().h(18).px(6).gap(4).rounded_full().bg(t.foreground + "12").items_center().text_size(11).text_color(t.muted)
        .child(svg("mods/kanso-chrome/icons/moon.svg").size(11)).child(String(list.length)));
  }

  // Status: what sleeps, as its own section after the others; a row per
  // sleeping tab (its agents, its project), a click wakes it.
  asleepSection(t, first, tape) {
    const list = shared("kanso.asleep") ?? [];
    if (!list.length) return [];
    const id = "section-asleep", open = !this.sectionsFolded.has("asleep");
    take(tape, first ? 32 : 44);
    const head = this.sectionHead(t, id, first ? 0 : 1, open, (cx) => {
      open ? this.sectionsFolded.add("asleep") : this.sectionsFolded.delete("asleep");
      localStorage.setItem("spaces.sections", JSON.stringify([...this.sectionsFolded]));
      this.toggleFold(id, !open, cx);
    }, svg("mods/kanso-chrome/icons/moon.svg").size(13).flex_none().text_color(t.muted), "Asleep", list.length, t.foreground);
    const project = (key) => spaces().find((sp) => projectKey(sp) === key)?.name ?? (list.find((a) => a.from === key)?.space || key.slice(key.indexOf(":") + 1).split("/").pop() || "~");
    const menu = (key) => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 300, at: "pointer", props: { spaceMenu: { key } } });
    const rows = this.unfolded(id, open, Date.now()) ? list.map((a) => {
      const rid = `${a.from}:${a.name}`, hovered = this.hoverRow === `asleep:${rid}`;
      return h_flex().id(`asleep-tab-${rid}`).h(50).flex_none().pl(12).pr(12).gap(12).items_center().rounded(8).cursor_pointer()
        .hover((s) => s.bg(t.foreground + "0c"))
        .on_hover((h, cx) => { const k = `asleep:${rid}`; if (h ? this.hoverRow !== k : this.hoverRow === k) { this.hoverRow = h ? k : null; cx.notify(); } })
        .on_click(() => arrange({ wake: { from: a.from, name: a.name } }))
        .on_mouse_down("right", () => menu(a.from))
        .child(v_flex().flex_1().min_w(0).justify_center()
          .child(h_flex().h(22).gap(10).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_medium().text_color(t.muted).child(a.who || a.name))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(since(a.saved)))
            .when(hovered, (el) => el.child(this.dots(`asleep-tab-dots-${rid}`, t, () => menu(a.from))))
            .child(svg("mods/kanso-chrome/icons/moon.svg").size(13).flex_none().text_color(t.dim)))
          .child(h_flex().h(18).mt(2).min_w(0).items_center().text_size(12).text_color(t.dim)
            .child(div().flex_none().max_w(110).truncate().font_medium().child(project(a.from)))
            .child(div().flex_none().px(5).child("\u00b7"))
            .child(div().flex_1().min_w(0).truncate().child(a.name))));
    }) : [];
    const box = this.foldBox(id, open, rows, Date.now());
    if (box.length) take(tape, open ? (this.foldH[id] ?? Math.max(0, list.length * 51 - 1)) : 0);
    return [head, ...box];
  }

  spaceMenuView(t) {
    const m = props().spaceMenu, close = () => closeOverlay(props().overlay);
    const w = m.id ? spaces().find((s) => s.id === m.id) : null;
    const key = w ? projectKey(w) : m.key;
    const asleep = (shared("kanso.asleep") ?? []).filter((a) => a.from === key);
    if (!w && !asleep.length) return v_flex().id("spaces-menu").p(10).bg(t.popover).text_size(12.5).text_color(t.dim).child("Nothing here sleeps any more.");
    const item = (id, text, act, { icon = null, hint = null } = {}) =>
      h_flex().id(`menu-${id}`).h(30).px(8).gap(10).items_center().rounded(6).cursor_pointer().text_size(13).text_color(t.foreground)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { act(cx); close(); cx.notify(); })
        .child(div().w(14).flex_none().when(Boolean(icon), (el) => el.child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14).text_color(t.muted))))
        .child(div().flex_1().truncate().child(text))
        .when(Boolean(hint), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(hint)));
    const active = w?.tabs?.find((x) => x.active);
    return v_flex().id("spaces-menu").w_full().p(5).gap(1).bg(t.popover).text_size(13)
      .when(asleep.length > 0, (el) => el
        .child(div().h(26).pl(32).flex().items_center().text_size(11.5).text_color(t.dim).child("Asleep"))
        .children(asleep.map((a, i) => item(`wake-${i}`, `Wake ${a.name}`, () => arrange({ wake: { from: a.from, name: a.name } }), { icon: "moon", hint: since(a.saved) })))
        .when(asleep.length > 1, (el) => el.child(item("wake-all", `Wake all ${asleep.length}`, () => arrange({ wakeAll: key }), { icon: "undo" }))))
      .when(Boolean(active), (el) => el.child(item("sleep-tab", "Sleep this tab\u2026", () => sleepTab(w.id, active.id), { icon: "moon" })))
      .when((w?.tabs?.length ?? 0) > 1, (el) => el.child(item("sleep-project", "Sleep the whole project\u2026", () => sleepProject(w.id), { icon: "moon" })))
      .when(Boolean(w), (el) => el.child(item("space-options", "Project options\u2026", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } }), { icon: "settings" })));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  // `places`: placesOf(sp, ps).
  ordered(sp, places) {
    const key = (w) => places.get(w.id).key;
    const ready = (w) => this.shown.has(w.id) || key(w) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[key(w)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: { last: n === kids.length - 1 } }));
    }
    return out;
  }

  // Sessions in the order the strip shows their panes (tab by tab), so the
  // list reads like the screen. `strip`: shared "strip.state", read once per draw.
  inStripOrder(list, strip) {
    const pos = (a) => { const ids = (strip[a.tab]?.cols ?? []).flatMap((c) => c.panes ?? []); const i = ids.indexOf(a.pane); return i < 0 ? 1e6 : i; };
    return list.map((a, i) => [a, i]).sort((x, y) => (x[0].tab_index - y[0].tab_index) || (pos(x[0]) - pos(y[0])) || (x[1] - y[1])).map(([a]) => a);
  }

  // The rows of a space, each agent with its sub-agents under it
  // (`entries`, from agents.js `nest`). In the "as on screen" order, the
  // panes that share a strip column (stacked one over another) are held
  // together in one soft slab, so the sidebar shows what is linked on screen.
  // Returns the rows (`out`), their height together (`h`, 1px apart, a slab's
  // rows touching) and where the focused one starts (`focus`, `focusH`).
  stacked(entries, mine, indent, t, space, ctx) {
    const colOf = ({ a }) => { if (this.order !== "screen" || a.pin != null || !a.pane) return null; const c = (ctx.strip[a.tab]?.cols ?? []).find((k) => k.panes?.includes(a.pane)); return c && c.panes.length > 1 ? `${a.tab}:${c.panes[0]}` : null; };
    const out = [];
    let y = 0, focus = null, focusH = 0;
    for (let i = 0; i < entries.length;) {
      const key = colOf(entries[i]);
      let j = i + 1;
      while (key && j < entries.length && colOf(entries[j]) === key) j++;
      const rows = entries.slice(i, j).map((e) => { const m = this.more(e, ctx); return { a: e.a, h: agentRowH(e.a, m), el: agentRow(e.a, indent, t, e.a.pane && !e.lines.length ? this.rowOf(e.a, mine, space) : null, m) }; });
      const slab = key && rows.length > 1;
      for (const r of rows) { if (r.a.focused) { focus = y; focusH = r.h; } y += r.h + (slab ? 0 : 1); }
      if (slab) { y += 1; out.push(v_flex().id(`stack-${key}`).flex_none().rounded(6).bg(t.foreground + "08").children(rows.map((r) => r.el))); }
      else out.push(...rows.map((r) => r.el));
      i = j;
    }
    return { out, h: Math.max(0, y - 1), focus, focusH };
  }

  // What a row shows besides its name: the time in its state, the line of
  // activity (when you keep it on), its tree lines, its space (Agents view).
  more(e, ctx, project = null) {
    const a = e.a, show = this.showActivity !== false && !a.sub;
    return {
      lines: e.lines,
      time: a.sub ? null : elapsed(a, this.since ?? {}, ctx.now),
      activity: show ? activityOf(a, ctx.digests[a.pane]) : null,
      // An agent's row keeps its second line, so the list never jumps.
      steady: show && Boolean(a.status),
      ...this.extras(a, ctx, show),
      project,
    };
  }

  // A long step's time and what still runs under the agent, for any view's row.
  extras(a, ctx, show = true) {
    return {
      faint: a.status === "idle",
      step: show ? stepOf(a, this.steps, ctx.now) : null,
      tasks: a.sub ? [] : (this.tasks[a.address] ?? []).map((x) => ({ command: x.command, time: duration(Math.max(0, ctx.now - x.start)) })),
    };
  }

  // Every listed terminal in every space with its name, pin, starter
  // (`parent`, for sub-agents) and what it says it is on (`msg`, the
  // agent's report), from the labels and records in herdr-core.
  listed(ps, sp, terms) {
    const byAddress = new Map(terms.map((k) => [k.address, k]));
    return withTerminals(agents(), ps, sp).map((a) => {
      const k = byAddress.get(a.address), l = k?.labels, pin = l?.[PIN_LABEL];
      return { ...a, parent: k?.parent ?? null, labels: l ?? {}, turn: k?.turn ?? 0, msg: k?.report?.msg ?? null, name: l?.[NAME_LABEL] || undefined, pin: pin != null && pin !== "" && !Number.isNaN(Number(pin)) ? Number(pin) : null };
    });
  }

  // ---- Order: pins, your order, the chosen order -------------------------------

  setOrder(key, value, cx) {
    this[key] = value;
    localStorage.setItem(`spaces.${key}`, key === "threadGroup" ? (value ? "on" : "off") : value);
    this.orderOpen = false;
    cx.notify();
  }

  // The pin is the `kanso.pin` label on the terminal: its number is its
  // place among the pinned. Pinning puts it last among them (`pins`: the
  // numbers already taken, a space's or every terminal's); again unpins
  // it. A drag among the pinned renumbers them.
  pin(a, pins) {
    if (a.pin != null) { label(a.address, PIN_LABEL); return; }
    label(a.address, PIN_LABEL, Math.max(0, ...pins) + 1);
  }

  setPins(addresses) {
    addresses.forEach((address, i) => label(address, PIN_LABEL, i + 1));
  }

  // A drop: among the pinned it renumbers the pins; in your own order it
  // moves the session in that space's list.
  dropped(d, a, mine, side, space) {
    if (d.section === "pinned") this.setPins(moved(mine.filter((x) => x.pin != null).map((x) => x.address), d.address, a.address, side));
    else {
      const list = mine.filter((x) => x.pin == null).map((x) => x.address);
      this.custom[space] = moved(list, d.address, a.address, side);
      localStorage.setItem("spaces.custom", JSON.stringify(this.custom));
    }
  }

  // What a row needs: whether it can be dragged (a pinned session among the
  // pinned; any other in your own order), the hover for its pin, the pin.
  rowOf(a, mine, space) {
    const section = a.pin != null ? "pinned" : this.order === "custom" ? "custom" : null;
    const from = this.draggedAgent;
    const ok = Boolean(section && from && from.address !== a.address && from.space === space && from.section === section);
    const side = () => (from.at < mine.indexOf(a) ? "after" : "before");
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => {
        let changed = false;
        if (h && this.draggedAgent && this.overAgent !== a.address) { this.overAgent = a.address; changed = true; }
        if (h ? this.hoverRow !== a.address : this.hoverRow === a.address) { this.hoverRow = h ? a.address : null; changed = true; }
        if (changed) cx.notify();
      },
      pin: () => this.pin(a, mine.map((x) => x.pin).filter((p) => p != null)),
      menu: () => this.openMenu(a),
      drag: section ? {
        target: ok && this.overAgent === a.address ? side() : null,
        down: () => { this.draggedAgent = { address: a.address, space, section, at: mine.indexOf(a) }; this.overAgent = null; },
        up: (cx) => { const d = this.draggedAgent; this.draggedAgent = null; if (ok) this.dropped(d, a, mine, side(), space); cx.notify(); },
      } : null,
    };
  }

  // Turning the switch or the activity line on or off; with the switch off,
  // the sidebar stays on Spaces.
  setShown(key, on, cx) {
    if (key === "switch" && !on) this.setView("spaces");
    this.hide(key === "switch" ? "sidebar.switch" : "sidebar.activity", !on);
    cx.notify();
  }

  // A piece on or off the `kanso.hidden` list (Kanso settings keeps the same list).
  hide(id, off) {
    const set = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    if (off === set.has(id)) return;
    off ? set.add(id) : set.delete(id);
    setShared("kanso.hidden", [...set]);
  }

  setView(view, cx) {
    this.view = view;
    localStorage.setItem("spaces.view", view);
    if (view === "threads" && cx) this.refreshThreads(cx);
  }

  // The conversations of the agents on this computer, read in the
  // background (threads.js); a file that hasn't grown isn't read again.
  refreshThreads(cx) {
    this.threadsAt = Date.now();
    if (this.readingThreads) return;
    this.readingThreads = true;
    // Agents on this computer (another machine's files are not here).
    const list = agents().filter((a) => !a.address.includes("/")).map((a) => ({ address: a.address, app: a.app }));
    cx.spawn(async (cx) => {
      try { this.threads = await findThreads(list, this.threads ?? {}); } catch { this.threads ??= {}; }
      finally { this.readingThreads = false; }
      cx.notify();
    });
  }

  // The order and view picker in the sidebar's top row: the SDK's Popover.
  // What it sorts follows the view: in Projects each space's agents, in
  // Status the agents within each section, in Threads the conversations
  // (and whether they are grouped by project). Then what to show.
  orderPicker(t) {
    const view = this.showSwitch === false ? "spaces" : this.view;
    const [orders, current, key, head] = view === "agents" ? [STATUS_ORDERS, this.statusOrder, "statusOrder", "In each section, by"]
      : view === "threads" ? [THREAD_ORDERS, this.threadOrder, "threadOrder", "Threads, pinned first, then by"]
      : [ORDERS, this.order, "order", "Agents, pinned first, then by"];
    const plain = current === Object.keys(orders)[0] || (view === "spaces" && current === DEFAULT_ORDER);
    const trigger = div().id("spaces-order").size(28).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer()
      .text_color(plain ? t.dim : t.muted).tooltip(`Sort: ${orders[current]}`)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .child(svg("mods/kanso-chrome/icons/sort.svg").size(14));
    const tick = (on) => (el) => el.when(on, (el) => el.child(div().text_size(11).child("\u2713")));
    const line = (id, text, on, act) => h_flex().id(id).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().text_size(12.5)
      .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => act(cx)).child(div().flex_1().child(text)).map(tick(on));
    const title = (text) => div().h(26).px(8).flex().items_center().text_size(11.5).text_color(t.dim).child(text);
    return Popover.new("spaces-order-popover").trigger(trigger).anchor("top_left")
      .open(this.orderOpen).on_open_change((open, cx) => { this.orderOpen = open; cx.notify(); })
      .content(v_flex().w(232).p(5).gap(1).rounded(10).bg(t.popover).border_1().border_color(t.border)
        .child(title(head))
        .children(Object.keys(orders).map((mode) => line(`spaces-order-${mode}`, orders[mode], mode === current, (cx) => this.setOrder(key, mode, cx))))
        .when(view === "threads", (el) => el.child(line("spaces-group", "Grouped by project", this.threadGroup, (cx) => this.setOrder("threadGroup", !this.threadGroup, cx))))
        .child(div().mx(8).my(5).h(1).bg(t.border))
        .child(title("Show"))
        .child(line("spaces-show-activity", "What each agent is on", this.showActivity !== false, (cx) => this.setShown("activity", this.showActivity === false, cx)))
        .child(line("spaces-show-switch", "Projects, Status and Threads", this.showSwitch !== false, (cx) => this.setShown("switch", this.showSwitch === false, cx))));
  }

  // The rows, under a header per machine once one isn't this computer.
  // An agent's name is the terminal's `kanso.name` label when it has one
  // (a double-click on the row opens the rename dialog).
  grouped(t, collapsed, sp, ps, ctx) {
    const rows = this.ordered(sp, ctx.places);
    const live = machines();
    const all = this.listed(ps, sp, ctx.terms);
    const tape = ctx.tape;
    const draw = (r) => {
      if (collapsed) return this.compact(r, t);
      const mine = orderSessions(this.inStripOrder(all.filter((a) => a.space === r.w.id), ctx.strip), this.order, this.custom[r.w.id] ?? []);
      const entries = nest(mine, ctx.terms);
      const open = !this.agentsFolded.has(r.w.id);
      // A breath of space between projects (a worktree stays close to its checkout).
      const gap = r.tree || r === rows[0] ? [] : [div().h(10).flex_none()];
      if (gap.length) take(tape, 10);
      const rowY = take(tape, rowHeight(r));
      if (r.w.active) { tape.space = rowY; tape.spaceH = rowHeight(r); }
      const st = this.unfolded(r.w.id, open, ctx.now) ? this.stacked(entries, mine, r.tree ? CHILD_PAD : 0, t, r.w.id, ctx) : null;
      const box = st ? this.foldBox(r.w.id, open, st.out, ctx.now) : [];
      if (box.length) {
        const boxY = take(tape, open ? (this.foldH[r.w.id] ?? st.h) : 0);
        if (open && st.focus != null) { tape.agent = boxY + st.focus; tape.agentH = st.focusH; }
      }
      return [...gap, this.row(r, t, entries.map((e) => e.a)), ...box];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const state = live.find(k => k.name === m)?.layout;
      return state === "loading" || (!state && this.machines.some(k => k.name === m && k.state === "connected"))
        || rows.length < sp.length && sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => { take(tape, 28); return div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…"); };
    // Projects asleep whole (no space left), on their machine ("" here).
    const sleepingOn = (m) => this.asleepProjects().filter(([key]) => key.slice(0, key.indexOf(":")) === (m ?? ""));
    const sleeping = (m) => collapsed ? [] : sleepingOn(m).flatMap(([key, list]) => {
      take(tape, 10);
      take(tape, rowHeight({ tree: null }));
      return [div().h(10).flex_none(), this.asleepProjectRow(t, key, list)];
    });
    if (!remote.length) return loading(null) && !rows.length && !sleepingOn(null).length ? [loadingRow(null)] : [...rows.flatMap(draw), ...sleeping(null)];
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      take(tape, 26);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/kanso-chrome/icons/${m ? "server" : "monitor"}.svg`).size(14).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded_full().flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/kanso-chrome/icons/chevron-${folded ? "right" : "down"}.svg`).size(12).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(6)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/kanso-chrome/icons/plus.svg").size(14)).tooltip("New space");
      if (folded) return [head];
      const asleep = sleepingOn(m).length > 0;
      return [head, ...(mine.length ? mine.flatMap(draw) : asleep ? [] : [loading(m) ? loadingRow(m) : (take(tape, 28), empty)]), ...sleeping(m)];
    });
  }

  // After the name: "herdr  ⎇ main ↑2 ↓1". The branch always shows (main and master
  // too); only a worktree row drops it, since its name already is the branch.
  gitTail(g, tree, name, t) {
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = tree ? "" : (g.branch ?? "detached");
    const repo = tree || same(g.name) ? "" : g.name;
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(repo), (el) => el.child(div().min_w(0).truncate().child(repo)))
      .when(Boolean(branch), (el) => el
        .child(svg("mods/kanso-chrome/icons/branch.svg").size(12).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_color(t.muted).child(branch)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // A child row's connector: a line down from its parent that bends into the row;
  // the last child's line stops at the bend.
  connector({ last }, t) {
    const mid = TREE_ROW / 2;
    return [
      div().absolute().left(GUIDE_X).top(-GUIDE_OVERLAP).w(1).h(last ? mid + GUIDE_OVERLAP : TREE_ROW + GUIDE_OVERLAP).bg(t.input),
      div().absolute().left(GUIDE_X).top(mid).w(ELBOW_W).h(1).bg(t.input),
    ];
  }

  // A space's agents fold toggle; the state is kept across restarts.
  fold(w, mine, t) {
    const open = !this.agentsFolded.has(w.id);
    return agentFold(w.id, mine, open, (cx) => { this.setAgentsFolded(w.id, open, cx); cx.notify(); }, t);
  }

  setAgentsFolded(id, folded, cx = null) {
    if (folded === this.agentsFolded.has(id)) return;
    folded ? this.agentsFolded.add(id) : this.agentsFolded.delete(id);
    localStorage.setItem("spaces.agentsFolded", JSON.stringify([...this.agentsFolded]));
    if (cx) this.toggleFold(id, !folded, cx);
  }

  // ---- Folding -----------------------------------------------------------------
  // A group of rows folds and unfolds by height, natively: the rows sit in a
  // box clipped to the height they measured last (`foldH`), and the box's
  // height eases between 0 and that. Opening draws the box at 0 on its first
  // frame and at its height on the next (`phase`), so the ease has a start;
  // closing keeps the rows drawn for FOLD_MS, so the ease has an end to show.
  // A group whose rows change while open measures again and eases to the new
  // height: a new agent's row grows into place instead of pushing the list.
  toggleFold(id, open, cx) {
    this.folding = { id, open, phase: 0, at: Date.now() };
    const tick = (cx) => { if (this.folding?.id !== id) return; if (this.folding.phase === 0) this.folding.phase = 1; cx.notify(); };
    cx.timer.after(16, tick);
    cx.timer.after(FOLD_MS, (cx) => { if (this.folding?.id === id && !this.folding.open) cx.notify(); });
  }

  // Whether a group's rows are drawn now: open, or still closing.
  unfolded(id, open, now) {
    return open || (this.folding?.id === id && !this.folding.open && now - this.folding.at < FOLD_MS);
  }

  // The box for a group's rows (`unfolded` said to draw them). `gap`: the
  // list's own, so the rows sit as they would in it.
  foldBox(id, open, rows, now, gap = 1) {
    if (!rows.length) return [];
    const mine = this.folding?.id === id;
    const closing = !open && mine;
    const start = open && mine && this.folding.open && this.folding.phase === 0;
    const h = this.foldH[id];
    const inner = v_flex().w_full().flex_none().gap(gap).children(rows)
      .on_size_change((s, cx) => { if (this.foldH[id] !== s.height) { this.foldH[id] = s.height; cx.notify(); } });
    return [v_flex().id(`fold-${id}`).w_full().flex_none().overflow_hidden()
      .h(closing || start ? 0 : h ?? "auto").opacity(closing || start ? 0 : 1)
      .transition("height", FOLD).transition("opacity", FOLD)
      .child(inner)];
  }

  // A space's avatar color: the theme's own hue (quiet in Kanso), else a fixed one.
  fill(w, t) {
    const color = this.colors?.[w.id] ?? "ansi6";
    return color.startsWith("#") ? color : (t[color] ?? MARK[color]);
  }

  // The ⋮ button: the same menu a right-click opens.
  dots(id, t, open) {
    return div().id(id).size(20).flex_none().rounded(6).flex().items_center().justify_center().text_color(t.dim).tooltip("More")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); open(); })
      .child(svg("mods/kanso-chrome/icons/more-vertical.svg").size(13));
  }

  row({ w, i, g, tree }, t, mine = []) {
    const on = w.active;
    const asleep = asleepOf(w);
    const fill = this.fill(w, t);
    // A wash of the text color, so a loud theme accent never paints the row;
    // the wash under the space you are in is the list's pill, which glides here.
    const washHover = t.foreground + "0c";
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .cursor_pointer()
      .hover((s) => s.bg(washHover))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.border_t(2).border_color(t.accent))
      .on_mouse_down("left", (e) => {
        this.pressed = i;
        this.over = i;
        // A double-click renames the space (Herdr's own prompt).
        if (e.click_count === 2) { this.pressed = null; run("space.rename", { id: w.id }); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else {
          // Like a desktop app's project list: the row itself folds. Arriving at a
          // space opens it; clicking the space you're in folds or opens it.
          if (mine.length) this.setAgentsFolded(w.id, on ? !this.agentsFolded.has(w.id) : false, cx);
          if (!on) run("space.select", { id: w.id });
        }
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .on_hover((h, cx) => { if (h ? this.hoverSpace !== w.id : this.hoverSpace === w.id) { this.hoverSpace = h ? w.id : null; cx.notify(); } })
      .when(Boolean(tree), (el) => el.children(this.connector(tree, t)))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(CHILD_PAD).child(svg("mods/kanso-chrome/icons/branch.svg").size(13).text_color(t.muted)))
          .when(!tree, el => el.child(h_flex().size(22).flex_none().rounded(6).bg(fill + "26").items_center().justify_center().text_size(12).font_semibold().text_color(fill).child(w.name[0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_size(13.5).font_semibold().text_color(tree && !on ? t.muted : t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(asleep.length > 0, (el) => el.child(h_flex().id(`asleep-${w.id}`).flex_none().h(18).px(6).gap(4).rounded_full().bg(t.foreground + "12")
            .items_center().text_size(11).text_color(t.muted).tooltip(asleep.map((a) => `${a.name}: ${a.who}, asleep since ${since(a.saved)}`).join("\n"))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.menu(w); })
            .child(svg("mods/kanso-chrome/icons/moon.svg").size(11)).child(String(asleep.length))))
          .when(this.hoverSpace === w.id, (el) => el.child(this.dots(`space-dots-${w.id}`, t, () => this.menu(w))))
          .when(mine.length > 0, (el) => el.child(this.fold(w, mine, t))),
      );
  }

  // Collapsed: the same avatar the open row shows, centred in a square, with a
  // dot only when the space needs you. The name is in the tooltip.
  compact({ w }, t) {
    const fill = this.fill(w, t);
    const speaks = w.status === "blocked" || w.status === "done";
    return h_flex().w_full().h(36).flex_none().justify_center().items_center().child(
      div()
        .id(`space-${w.id}`)
        .relative()
        .size(32)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .tooltip(w.name)
        .when(w.active, (el) => el.bg(t.foreground + "14"))
        .when(!w.active, (el) => el.hover((s) => s.bg(t.foreground + "0c")))
        .on_click(() => run("space.select", { id: w.id }))
        .on_mouse_down("right", () => this.menu(w))
        .child(h_flex().size(22).flex_none().rounded(6).bg(fill + "26").items_center().justify_center()
          .text_size(12).font_semibold().text_color(fill).child(w.name[0]?.toUpperCase() ?? "?"))
        .when(speaks, (el) => el.child(div().absolute().top(4).right(4).size(7).rounded_full()
          .border(1).border_color(t.chrome).bg(tone(t, w.status)))),
    );
  }

  // The Status view: every agent in every space by what it needs from you
  // (agents.js `bySection`). Each section opens with the ensō of its state
  // in that state's color, its name and its count, after a breath of space:
  // the mark says how the list is arranged. A header folds its section.
  agentsView(t, sp, ps, ctx) {
    const entries = nest(this.inStripOrder(this.listed(ps, sp, ctx.terms), ctx.strip), ctx.terms);
    const held = this.held?.done ? this.held.address : null;
    const sections = bySection(entries, this.since ?? {}, held, this.statusOrder);
    if (!sections.length && !(shared("kanso.asleep") ?? []).length) return [this.empty(t, "No agents yet", "Start one from + in the tab bar; it shows here by what it needs from you.")];
    const project = this.projectOf(sp, t);
    const tape = ctx.tape;
    return sections.flatMap((s, i) => {
      const id = `section-${s.id}`;
      const open = !this.sectionsFolded.has(s.id);
      const count = s.entries.filter((e) => !e.lines.length).length;
      take(tape, i ? 44 : 32);
      const head = this.sectionHead(t, id, i, open, (cx) => {
        open ? this.sectionsFolded.add(s.id) : this.sectionsFolded.delete(s.id);
        localStorage.setItem("spaces.sections", JSON.stringify([...this.sectionsFolded]));
        this.toggleFold(id, !open, cx);
      }, s.id === "other" ? null : statusMark(t, s.id), s.label, count, s.id === "blocked" ? t.blocked : t.foreground);
      const rows = [];
      let h = 0, focus = null, focusH = 0;
      if (this.unfolded(id, open, ctx.now)) {
        for (const e of s.entries) {
          const m = this.more(e, ctx, e.lines.length ? null : project(e.a.space)), rh = agentRowH(e.a, m);
          if (e.a.focused) { focus = h; focusH = rh; }
          rows.push(agentRow(e.a, FLUSH, t, this.rowFor(e.a), m));
          h += rh + 1;
        }
      }
      const box = this.foldBox(id, open, rows, ctx.now);
      if (box.length) {
        const boxY = take(tape, open ? (this.foldH[id] ?? Math.max(0, h - 1)) : 0);
        if (open && focus != null) { tape.agent = boxY + focus; tape.agentH = focusH; }
      }
      return [head, ...box];
    }).concat(this.asleepSection(t, !sections.length, tape));
  }

  // A section's header: [mark] name count ........ chevron. 13px semibold,
  // the first flush with the top, the rest after 14px of space; no rules.
  sectionHead(t, id, i, open, toggle, mark, name, count, ink) {
    return h_flex().id(id).h(i ? 44 : 32).pt(i ? 12 : 0).px(12).flex_none().gap(10).items_center()
      .cursor_pointer().text_size(13).font_semibold().text_color(ink)
      .on_click((_e, cx) => { toggle(cx); cx.notify(); })
      .when(Boolean(mark), (el) => el.child(mark))
      .child(div().child(name))
      .when(count != null, (el) => el.child(div().font_normal().text_color(t.dim).child(String(count))))
      .child(div().flex_1())
      .child(svg(`mods/kanso-chrome/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim));
  }

  // While Threads reads the conversations: the view's own silhouette, as
  // Spend loads (the rows' square, title, time and second line in the
  // faintest tone, breathing slowly; one native loop on the whole shape).
  silhouette(t) {
    const block = (w, h, radius = 3) => div().w(w).h(h).flex_none().rounded(radius).bg(t.border);
    const row = (i) => h_flex().h(64).mb(6).px(12).gap(12).items_center()
      .child(v_flex().h(64).pt(11).flex_none().child(block(20, 20, 6)))
      .child(v_flex().flex_1().min_w(0).gap(9)
        .child(h_flex().items_center().child(block([132, 104, 150, 92, 118][i], 10)).child(div().flex_1()).child(block(22, 8)))
        .child(block([170, 138, 120, 160, 100][i], 8)));
    return v_flex().w_full().loop("opacity", { from: 0.35, to: 0.8, period: 1800 }).children([0, 1, 2, 3, 4].map(row));
  }

  // An empty view: what will show here and how to get there, two lines.
  empty(t, title, body) {
    return v_flex().px(10).py(12).gap(4)
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(title))
      .child(div().text_size(12).text_color(t.muted).child(body));
  }

  // A project as the Status and Threads rows show it: its name and its
  // avatar's color (the same square as in Projects).
  projectOf(sp, t) {
    const byId = new Map(sp.map((s) => [s.id, s]));
    return (id) => { const w = byId.get(id); return w ? { name: w.name, fill: this.fill(w, t) } : null; };
  }

  // A row's right-click menu: this mod's own popup (menuView), with the
  // thread's title and conversation file when the Threads view has them.
  openMenu(a, { title = null, session = null } = {}) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 460, at: "pointer",
      props: { menu: { address: a.address, view: this.view, title, session } } });
  }

  // What a row in any view answers to besides a click: hover (for its
  // actions) and a right-click, the thread menu. `actions`: Threads' quick
  // ones on hover.
  rowFor(a, actions = null, extra = {}) {
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => { if (h ? this.hoverRow !== a.address : this.hoverRow === a.address) { this.hoverRow = h ? a.address : null; cx.notify(); } },
      menu: () => this.openMenu(a, extra),
      actions,
    };
  }

  // Projects | Status | Threads, under the top row. Status carries a dot
  // while an agent needs you and you are on another view.
  // The chosen one sits on a raised thumb that slides to it, natively. The
  // thumb needs the switch's width (measured, kept); until the first measure
  // the chosen segment is raised on its own.
  viewSwitch(t, sp) {
    const asks = sp.some((s) => s.status === "blocked");
    const views = Object.keys(VIEWS);
    const at = this.switchW ? segmentAt(this.switchW, views.indexOf(this.view), views.length) : null;
    const seg = (view) => {
      const on = this.view === view;
      return h_flex().id(`spaces-view-${view}`).flex_1().h(28).gap(6).items_center().justify_center().rounded(7).cursor_pointer()
        .text_size(12.5).font_medium().text_color(on ? t.foreground : t.muted)
        .when(on && !at, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border))
        .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { this.setView(view, cx); cx.notify(); })
        .child(div().child(VIEWS[view].label))
        .when(view === "agents" && asks && !on, (el) => el.child(div().size(6).rounded_full().bg(t.blocked)));
    };
    const thumb = at ? div().id("spaces-view-thumb").absolute().top(3).left(at.left).w(at.width).h(28).rounded(7)
      .bg(t.raised ?? t.selected).border_1().border_color(t.border)
      .transition("left", { duration: 200, easing: "ease-out" }) : null;
    return h_flex().relative().mx(18).mt(4).mb(14).p(3).gap(2).flex_none().rounded(10).bg(t.foreground + "0a")
      .on_size_change((s, cx) => { if (Math.abs((this.switchW ?? 0) - s.width) >= 1) { this.switchW = s.width; cx.notify(); } })
      .when(Boolean(thumb), (el) => el.child(thumb))
      .children(views.map(seg));
  }

  // The Threads view, as T3 Code's sidebar: the conversations of the agents
  // on this computer, each named on its own (the title its agent gives it,
  // kept up to date as it goes, else the first thing you wrote; Rename puts
  // yours over it). Pinned up top; then the rest by your last message (or
  // when they started), woken ones first, or one group per project; then,
  // folded, Snoozed and Settled. Each row: the title, the time, its state;
  // under it the project in its color and the last thing you wrote. Hovered:
  // Settle (or bring back) and Pin; right-click for the rest.
  threadsView(t, sp, ps, ctx) {
    if (!this.threads) return [this.silhouette(t)];
    const project = this.projectOf(sp, t);
    const rows = this.listed(ps, sp, ctx.terms)
      .filter((a) => !a.address.includes("/") && (this.threads[a.address] || a.program?.agent || a.status))
      .map((a) => ({ a, th: this.threads[a.address] ?? null }));
    if (!rows.length) return [this.empty(t, "No conversations open", "Start Claude Code or Codex in a tab; each conversation shows here, named on its own.")];
    const sections = threadSections(rows, { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} });
    const row = ({ a, th }) => {
      const when = (this.threadOrder === "started" ? th?.began : th?.said ?? th?.at) ?? this.since?.[a.address]?.at;
      const unread = isUnread(a.labels), up = woke(a, ctx.now), settled = Boolean(settledOf(a.labels)) && !backFromSettled(a);
      const snoozed = snoozedUntil(a.labels) > ctx.now;
      const free = a.status !== "working" && a.status !== "blocked";
      const actions = [
        settled ? { id: "unsettle", icon: "undo", tip: "Bring back", act: () => label(a.address, SETTLED_LABEL) }
          : free && a.pin == null ? { id: "settle", icon: "check", tip: "Settle", act: () => label(a.address, SETTLED_LABEL, `${Date.now()}:${a.turn ?? 0}`) } : null,
        { id: "pin", icon: "pin", tip: a.pin != null ? "Unpin" : "Pin to the top", act: () => this.pinThread(a) },
      ].filter(Boolean);
      return agentRow(a, FLUSH, t, this.rowFor(a, actions, { title: th?.title ?? null, session: th?.file ?? null }), {
        label: a.labels?.[THREAD_LABEL] || th?.title || agentLabel(a),
        time: snoozed ? new Date(snoozedUntil(a.labels)).toTimeString().slice(0, 5) : when ? duration(Math.max(0, ctx.now - when)) : null,
        badge: up ? "Woke" : null,
        strong: unread || up,
        project: project(a.space),
        // What the agent says it is on, or said last; else the last thing you wrote.
        activity: said(a) ?? (th?.prompt ? `You: ${th.prompt}` : null),
        roomy: true,
        ...this.extras(a, ctx),
      });
    };
    return sections.flatMap((s, i) => {
      const folds = Boolean(s.folds);
      const open = folds ? this.shelvesOpen.has(s.id) : !this.sectionsFolded.has(`thread-${s.id}`);
      const toggle = (cx) => {
        if (folds) { open ? this.shelvesOpen.delete(s.id) : this.shelvesOpen.add(s.id); localStorage.setItem("spaces.shelvesOpen", JSON.stringify([...this.shelvesOpen])); }
        else { open ? this.sectionsFolded.add(`thread-${s.id}`) : this.sectionsFolded.delete(`thread-${s.id}`); localStorage.setItem("spaces.sections", JSON.stringify([...this.sectionsFolded])); }
        this.toggleFold(`thread-${s.id}`, !open, cx);
      };
      const p = s.project ? project(s.project) : null;
      const mark = p ? h_flex().size(18).flex_none().rounded(5).bg(p.fill + "2e").items_center().justify_center().text_size(10.5).font_semibold().text_color(p.fill).child(p.name[0]?.toUpperCase() ?? "?")
        : s.id === "pinned" ? svg("mods/kanso-chrome/icons/pin.svg").size(13).flex_none().text_color(t.muted)
        : s.id === "snoozed" ? svg("mods/kanso-chrome/icons/clock.svg").size(14).flex_none().text_color(t.muted)
        : s.id === "settled" ? svg("mods/kanso-chrome/icons/check.svg").size(14).flex_none().text_color(t.muted) : null;
      const tape = ctx.tape, rowH = agentRowH({}, { roomy: true, project: true });
      // Alone, the active list is the inbox itself and needs no header;
      // beside Pinned, Snoozed or Settled it gets one too, so each state
      // reads apart.
      if (s.id === "active" && sections.length === 1) {
        return s.rows.map((r) => { const y = take(tape, rowH); if (r.a.focused) { tape.agent = y; tape.agentH = rowH; } return row(r); });
      }
      take(tape, i ? 44 : 32);
      const head = [this.sectionHead(t, `thread-${s.id}`, i, open, toggle, mark, p ? p.name : s.label ?? "Active", s.rows.length, folds ? t.muted : t.foreground)];
      const rows = this.unfolded(`thread-${s.id}`, open, ctx.now) ? s.rows.map(row) : [];
      const box = this.foldBox(`thread-${s.id}`, open, rows, ctx.now, 6);
      if (box.length) {
        const boxY = take(tape, open ? (this.foldH[`thread-${s.id}`] ?? s.rows.length * (rowH + 6) - 6) : 0);
        const k = s.rows.findIndex((r) => r.a.focused);
        if (open && k >= 0) { tape.agent = boxY + k * (rowH + 6); tape.agentH = rowH; }
      }
      return [...head, ...box];
    });
  }

  // Pinning a thread puts it last among every pinned terminal; again unpins it.
  pinThread(a) {
    this.pin(a, terminals().map((k) => Number(k.labels?.[PIN_LABEL]) || 0));
  }

  // A row's right-click menu, opened as this mod's own popup: what T3 Code
  // offers on a thread, in Herdr's terms, kept as labels on the terminal in
  // herdr-core (so every window and a restart agree). Close ends the
  // agent's terminal after a second click; no conversation file is touched.
  menuView(t) {
    const m = props().menu, close = () => closeOverlay(props().overlay);
    const k = terminals().find((x) => x.address === m.address);
    const p = panes().find((x) => x.terminal === m.address);
    const a = agents().find((x) => x.address === m.address);
    const sp = p?.tab ? spaces().find((s) => s.tabs?.some((x) => x.id === p.tab)) : null;
    const l = k?.labels ?? {}, now = Date.now();
    const pinned = l[PIN_LABEL] != null && l[PIN_LABEL] !== "";
    const settled = Boolean(settledOf(l)), snoozed = snoozedUntil(l) > now;
    const free = a?.status !== "working" && a?.status !== "blocked";
    const item = (id, text, act, { icon = null, hint = null, ink = t.foreground, keep = false } = {}) =>
      h_flex().id(`menu-${id}`).h(30).px(8).gap(10).items_center().rounded(6).cursor_pointer().text_size(13).text_color(ink)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { act(cx); if (!keep) close(); cx.notify(); })
        .child(div().w(14).flex_none().when(Boolean(icon), (el) => el.child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14).text_color(t.muted))))
        .child(div().flex_1().truncate().child(text))
        .when(Boolean(hint), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(hint)));
    const rule = () => div().mx(8).my(4).h(1).bg(t.border);
    const copy = (text) => (cx) => cx.write_to_clipboard?.(text);
    const session = m.session ? m.session.split("/").pop().replace(/\.jsonl$/, "").replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, "") : null;
    const title = m.title ?? l[THREAD_LABEL] ?? null;
    return v_flex().id("spaces-menu").w_full().p(5).gap(1).bg(t.popover).text_size(13)
      .when(Boolean(p), (el) => el.child(item("open", "Open", () => run("pane.focus", { pane: p.pane }), { icon: "chevron-right" })))
      .child(item("pin", pinned ? "Unpin" : "Pin to the top", () => this.pinThread({ address: m.address, pin: pinned ? 1 : null }), { icon: "pin" }))
      .when(settled, (el) => el.child(item("unsettle", "Bring back", () => label(m.address, SETTLED_LABEL), { icon: "undo" })))
      .when(!settled && free, (el) => el.child(item("settle", "Settle", () => label(m.address, SETTLED_LABEL, `${now}:${k?.turn ?? 0}`), { icon: "check" })))
      .when(snoozed, (el) => el.child(item("wake", "Wake now", () => label(m.address, SNOOZE_LABEL), { icon: "clock" })))
      .when(!snoozed, (el) => el.child(div().h(26).pl(32).flex().items_center().text_size(11.5).text_color(t.dim).child("Snooze"))
        .children(snoozePresets(now).map((x) => item(`snooze-${x.id}`, x.label, () => label(m.address, SNOOZE_LABEL, x.until), { hint: x.when }))))
      .when(Boolean(p?.tab) && Boolean(sp), (el) => el.child(item("sleep-tab", "Sleep its tab\u2026", () => sleepTab(sp.id, p.tab), { icon: "moon" })))
      .when((sp?.tabs?.length ?? 0) > 1, (el) => el.child(item("sleep-project", "Sleep its project\u2026", () => sleepProject(sp.id), { icon: "moon" })))
      .child(item("unread", isUnread(l) ? "Mark read" : "Mark unread", () => label(m.address, UNREAD_LABEL, isUnread(l) ? "" : "1"), { icon: "enso" }))
      .child(item("rename", m.view === "threads" ? "Rename thread\u2026" : "Rename\u2026",
        () => renameTerminal(m.address, m.view === "threads" ? (l[THREAD_LABEL] || title || "") : (l[NAME_LABEL] || a?.title || ""), m.view === "threads")))
      .child(rule())
      .when(Boolean(p?.cwd), (el) => el.child(item("copy-path", "Copy folder", copy(p.cwd), { icon: "copy" })))
      .when(Boolean(p?.branch), (el) => el.child(item("copy-branch", "Copy branch", copy(p.branch), { icon: "branch" })))
      .when(Boolean(session), (el) => el.child(item("copy-id", "Copy conversation id", copy(session), { icon: "copy" })))
      .child(rule())
      .child(this.confirmClose
        ? item("close", "Click again to close it", () => run("terminal.kill", { terminal: m.address }), { icon: "close", ink: t.blocked })
        : item("close", a ? "Close agent" : "Close terminal", (cx) => { this.confirmClose = true; }, { icon: "close", ink: t.blocked, keep: true }));
  }

  // Each space's avatar hue, kept in shared "space.colors" so every window
  // agrees: a new space takes the hue used least; a gone space gives its up.
  // Nothing is written while every space has one.
  assignColors(sp) {
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const ids = new Set(sp.map((p) => p.id));
    const had = shared("space.colors") ?? {};
    const stale = Object.keys(had).some((id) => !ids.has(id));
    const missing = sp.filter((p) => !had[p.id] && p.name !== "~");
    if (!stale && !missing.length) { this.colors = had; return; }
    const kept = Object.fromEntries(Object.entries(had).filter(([id]) => ids.has(id)));
    const uses = new Map(palette.map((c) => [c, 0]));
    for (const c of Object.values(kept)) uses.set(c, (uses.get(c) ?? 0) + 1);
    for (const p of missing) {
      const c = palette.reduce((best, c) => (uses.get(c) < uses.get(best) ? c : best));
      kept[p.id] = c;
      uses.set(c, uses.get(c) + 1);
    }
    setShared("space.colors", kept);
    this.colors = kept;
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.menuView(t);
    if (props()?.spaceMenu) return this.spaceMenuView(t);
    const collapsed = shared("sidebar.collapsed") === true;
    const sp = spaces();
    const ps = panes();
    this.assignColors(sp);
    const quiet = (id, icon, tip, action) => div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).cursor_pointer().tooltip(tip)
      .hover((s) => s.bg(t.foreground + "12").text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(17));
    const toggle = () => {
      // Remember how wide you left it open, to open it the same width.
      if (!collapsed && this.width > OPEN_MIN - 1) setShared("sidebar.width", Math.round(this.width));
      setShared("sidebar.collapsed", !collapsed);
      setRail(collapsed, collapsed ? (shared("sidebar.width") ?? SIDEBAR_W) : collapsedW());
    };
    const active = sp.find((p) => p.active);
    // Read once per draw: every terminal's record, the panes' digests, the
    // strip's columns, where each space is, now.
    const hidden = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    this.showSwitch = !hidden.has("sidebar.switch");
    this.showActivity = !hidden.has("sidebar.activity");
    const switchShown = this.showSwitch !== false;
    const view = !collapsed && switchShown ? this.view : "spaces";
    // `tape`: where the list's chosen rows end up (see `take`), for the pills.
    const tape = { y: 0, gap: view === "threads" ? 6 : 1, space: null, agent: null };
    const ctx = { terms: terminals(), digests: shared("kanso.digest") ?? {}, strip: shared("strip.state") ?? {}, places: placesOf(sp, ps), now: Date.now(), tape };
    const plus = quiet("space-new", "plus", "New space", () => run("space.new", { machine: active?.machine ?? "" }));
    const hide = quiet("sidebar-toggle", "sidebar", collapsed ? "Show sidebar" : "Hide sidebar", toggle);
    const search = quiet("search", "search", "Search", () => run("mod.open", { name: "picker" }));
    // Collapsed, Herdr's mark sits here over the buttons (open, it's in the
    // top bar beside the traffic lights, drawn by kanso-chrome).
    const brand = image("frame/welcome/herdr.png").size(20).rounded(6).flex_none();
    // One row when open: + at the left, search and hide at the right, same size.
    // Collapsed, stack them so two buttons never sit on top of each other.
    const add = collapsed
      ? v_flex().w_full().pt(8).gap(6).items_center().child(brand).child(plus).child(hide)
      : h_flex().h(40).px(10).gap(4).items_center()
        .child(plus)
        .child(div().flex_1())
        .child(this.orderPicker(t))
        .child(search)
        .child(hide);
    return v_flex().id("spaces-root").size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_size_change((size) => { this.width = size.width; })
      // A pane held in the strip and let go here goes back where it was.
      .on_mouse_up("left", () => { if (shared("strip.drag")) { setShared("strip.drop", null); setShared("strip.drag", null); } })
      .child(add)
      .when(!collapsed && switchShown, (el) => el.child(this.viewSwitch(t, sp)))
      .child(this.list(t, collapsed, view, ctx,
        view === "agents" ? this.agentsView(t, sp, ps, ctx) : view === "threads" ? this.threadsView(t, sp, ps, ctx) : this.grouped(t, collapsed, sp, ps, ctx)))
      ;
  }

  // The scrolling list, with the pills under the active space and the
  // focused agent drawn first (the items are built before this runs, so the
  // tape knows where they are). A pill keeps its identity per view, so a
  // change of view places it rather than sliding it across.
  list(t, collapsed, view, ctx, items) {
    const { tape } = ctx;
    const pills = collapsed ? [] : [
      ...(tape.space != null ? [pill("pill-space", tape.space, tape.spaceH, t.foreground + "14")] : []),
      ...(tape.agent != null ? [pill(`pill-agent-${view}`, tape.agent, tape.agentH, t.foreground + "12")] : []),
    ];
    return v_flex().relative().flex_1().min_h(0).px(collapsed ? 0 : 8).gap(collapsed ? 0 : tape.gap).pt(collapsed ? 6 : 0).pb(14).overflow_y_scrollbar().mode(collapsed ? "hover" : "always")
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.draggedAgent = null; cx.notify(); })
      .children([...pills, ...items]);
  }
}
