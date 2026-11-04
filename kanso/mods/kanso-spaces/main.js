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
import { agentRow, agentFold, agentLabel, FLUSH, renameTerminal, statusMark, SETTLED_LABEL, SNOOZE_LABEL, UNREAD_LABEL, THREAD_LABEL, settledOf, snoozedUntil, isUnread, woke, backFromSettled, threadSections, snoozePresets, THREAD_ORDERS, STATUS_ORDERS, withTerminals, NAME_LABEL, PIN_LABEL, ORDERS, DEFAULT_ORDER, orderSessions, moved, nest, track, elapsed, activityOf, bySection, duration } from "./agents.js";
import { findThreads } from "./threads.js";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

// Right after layout.switch, layout() can still return the tree of the layout
// shown before; setting it would save that tree into kanso.json. Only Kanso's
// tree has the strip map, so only that tree is written.
const isKansoTree = (n) => n?.id === "strip-map" || (n?.children ?? []).some(isKansoTree);

// Same helper as kanso-strip, kanso-tabs, kanso-panel and open-with.
const LAYOUT_INTENT = "kanso.layout";
// The strip writes its columns under their own key, many times a second, so
// it never has to read back and copy the panel and rail to keep them.
const STRIP_INTENT = "kanso.layout.strip";

function walkLayout(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = walkLayout(child, id);
    if (found) return found;
  }
  return null;
}

function paintLayout(tree, preserveSizes = true) {
  if (!tree) return;
  const intent = { ...(shared(LAYOUT_INTENT) ?? {}), ...(shared(STRIP_INTENT) ?? {}) };
  if (intent.nodes) {
    const body = walkLayout(tree, "work-body");
    if (body?.children) {
      const mine = (n) => n.id === "main" || String(n.id).startsWith("strip-");
      const at = body.children.findIndex(mine);
      const rest = body.children.filter((n) => !mine(n));
      const i = Math.max(0, at);
      const nodes = JSON.parse(JSON.stringify(intent.nodes));
      // Native dividers leave px sizes before the strip's adopt timer runs.
      // Keep those edits, but not sizes from the tree a pending strip write
      // was based on: replaying those would undo an explicit width command.
      const keepSize = (node) => {
        const before = intent.sizesBefore?.[node.id], live = walkLayout(body, node.id);
        if (before !== undefined && live?.size?.px !== undefined
          && JSON.stringify(live.size) !== JSON.stringify(before)) node.size = { ...live.size };
        for (const child of node.children ?? []) keepSize(child);
      };
      if (preserveSizes) nodes.forEach(keepSize);
      body.children = [...rest.slice(0, i), ...nodes, ...rest.slice(i)];
    }
  }
  if ("panel" in intent) {
    const body = walkLayout(tree, "panel-body");
    const wrap = walkLayout(tree, "panel") ?? body;
    if (body) {
      const child = intent.panel ? JSON.parse(JSON.stringify(intent.panel)) : null;
      body.children = child ? [child] : [];
      if (child) body.active = child.id;
      else delete body.active;
      if (wrap) wrap.hidden = !child;
    }
  }
  if (intent.rail) {
    const sidebar = (tree.children ?? []).find((n) => n.id === "sidebar");
    if (sidebar) {
      tree.resizable = intent.rail.open;
      sidebar.min = intent.rail.min;
    }
  }
  edgeBesidePanel(tree);
}

// A side panel's left border is Herdr's divider, which moves only the two
// nodes beside it, so a fixed-width neighbor pins it. While a panel shows,
// the strip's right edge rail (28 px, fixed) stands after the panel instead
// of before it, and a strip column keeps the border draggable.
function edgeBesidePanel(tree) {
  const kids = walkLayout(tree, "work-body")?.children;
  const at = kids ? kids.findIndex((n) => n.id === "strip-edge-right") : -1;
  if (at < 0) return;
  const [edge] = kids.splice(at, 1);
  const panel = kids[at];
  const beside = panel && (panel.id === "panel-body" || panel.id === "panel") && !panel.hidden;
  kids.splice(beside ? at + 1 : at, 0, edge);
}

function rememberLayout(patch) {
  setShared(LAYOUT_INTENT, { ...(shared(LAYOUT_INTENT) ?? {}), ...patch });
}

function storedArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function storedObject(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const TREE_ROW = 32;
const PLAIN_ROW = 36;
const GUIDE_X = 19; // under the parent's avatar centre: 8px row padding + half its 22px width
const ELBOW_W = 11;
const GUIDE_OVERLAP = 4; // the line reaches up into the row above, so it never breaks
const CHILD_PAD = GUIDE_X + ELBOW_W + 6 - 8; // icon starts 6px after the elbow, inside the 8px row padding
const rowHeight = ({ tree }) => (tree ? TREE_ROW : PLAIN_ROW);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
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
const label = (address, key, value) => hc(["label", address, `${key}=${value ?? ""}`]).catch(() => {});

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as a row's right-click menu (props().menu): nothing else to run.
    if (props()?.menu) { this.confirmClose = false; return; }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(storedArray("machines.folded"));
    this.agentsFolded = new Set(storedArray("spaces.agentsFolded"));
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
    this.shelvesOpen = new Set(storedArray("spaces.shelvesOpen"));
    this.custom = storedObject("spaces.custom");
    this.orderOpen = false;
    // What you chose to see: the Spaces or the Agents view, the switch
    // between them, and the line of activity under each agent. Each agent's
    // state and since when, kept across restarts (agents.js `track`).
    const view = localStorage.getItem("spaces.view");
    this.view = view in VIEWS ? view : "spaces";
    this.threads = null; // terminal -> its conversation (threads.js), once read
    this.showSwitch = localStorage.getItem("spaces.switch") !== "off";
    this.showActivity = localStorage.getItem("spaces.activity") !== "off";
    this.sectionsFolded = new Set(storedArray("spaces.sections"));
    this.since = storedObject("spaces.since");
    this.held = null;
    this.hoverRow = null;
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
    // The times beside the rows count in minutes.
    cx.timer.every(30000, (cx) => cx.notify());
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
    if (!window().active && now - (this.lastLook ?? 0) < 5000) return;
    this.lastLook = now;
    this.trackAgents(now, cx);
    // The Threads view reads the conversations while it shows: every 15 s
    // with the window in front, every minute behind it.
    if (this.view === "threads" && now - (this.threadsAt ?? 0) > (window().active ? 15000 : 60000)) this.refreshThreads(cx);
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Since when each agent is in its state, and the done agent you are
  // looking at (it stays in Done in the Agents view until you leave it).
  trackAgents(now, cx) {
    const list = agents();
    const tabs = new Map(spaces().flatMap((s) => s.tabs ?? []).map((tb) => [tb.id, tb]));
    const next = track(this.since, list, now, (id) => tabs.get(id));
    const cur = list.find((a) => a.focused);
    // Looking turns done into idle at once: what it was a moment ago counts.
    const was = this.lastSeen ?? {};
    if (cur?.address !== this.held?.address) this.held = cur ? { address: cur.address, done: cur.status === "done" || was[cur.address] === "done" } : null;
    this.lastSeen = Object.fromEntries(list.map((a) => [a.address, a.status]));
    this.tidyLabels(list, now);
    if (!next) return;
    // A turn ended or began: what was said changed.
    if (this.view === "threads") this.threadsAt = 0;
    this.since = next;
    localStorage.setItem("spaces.since", JSON.stringify(next));
    cx.notify();
  }

  // As T3 Code: looking at a thread marked unread, or woken from a snooze,
  // reads it; new work brings a settled one back. Each label goes once
  // (`tidying` holds it until herdr-core echoes the change).
  tidyLabels(list, now) {
    const terms = new Map(terminals().map((k) => [k.address, k]));
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
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
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
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
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

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered(sp, ps) {
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
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
  // list reads like the screen.
  inStripOrder(list) {
    const state = shared("strip.state") ?? {};
    const pos = (a) => { const ids = (state[a.tab]?.cols ?? []).flatMap((c) => c.panes ?? []); const i = ids.indexOf(a.pane); return i < 0 ? 1e6 : i; };
    return list.map((a, i) => [a, i]).sort((x, y) => (x[0].tab_index - y[0].tab_index) || (pos(x[0]) - pos(y[0])) || (x[1] - y[1])).map(([a]) => a);
  }

  // The rows of a space, each agent with its sub-agents under it
  // (`entries`, from agents.js `nest`). In the "as on screen" order, the
  // panes that share a strip column (stacked one over another) are held
  // together in one soft slab, so the sidebar shows what is linked on screen.
  stacked(entries, mine, indent, t, space, ctx) {
    const state = shared("strip.state") ?? {};
    const colOf = ({ a }) => { if (this.order !== "screen" || a.pin != null || !a.pane) return null; const c = (state[a.tab]?.cols ?? []).find((k) => k.panes?.includes(a.pane)); return c && c.panes.length > 1 ? `${a.tab}:${c.panes[0]}` : null; };
    const out = [];
    for (let i = 0; i < entries.length;) {
      const key = colOf(entries[i]);
      let j = i + 1;
      while (key && j < entries.length && colOf(entries[j]) === key) j++;
      const rows = entries.slice(i, j).map((e) => agentRow(e.a, indent, t, e.a.pane && !e.lines.length ? this.rowOf(e.a, mine, space) : null, this.more(e, ctx)));
      if (key && rows.length > 1) out.push(v_flex().id(`stack-${key}`).flex_none().rounded(6).bg(t.foreground + "08").children(rows));
      else out.push(...rows);
      i = j;
    }
    return out;
  }

  // What a row shows besides its name: the time in its state, the line of
  // activity (when you keep it on), its tree lines, its space (Agents view).
  more(e, ctx, project = null) {
    return {
      lines: e.lines,
      time: e.a.sub ? null : elapsed(e.a, this.since ?? {}, ctx.now),
      activity: this.showActivity === false || e.a.sub ? null : activityOf(e.a, ctx.digests[e.a.pane]),
      project,
    };
  }

  // Every listed terminal in every space with its name, pin and starter
  // (`parent`, for sub-agents), from the labels and records in herdr-core.
  listed(ps, sp, terms) {
    const byAddress = new Map(terms.map((k) => [k.address, k]));
    return withTerminals(agents(), ps, sp).map((a) => {
      const k = byAddress.get(a.address), l = k?.labels, pin = l?.[PIN_LABEL];
      return { ...a, parent: k?.parent ?? null, labels: l ?? {}, turn: k?.turn ?? 0, name: l?.[NAME_LABEL] || undefined, pin: pin != null && pin !== "" && !Number.isNaN(Number(pin)) ? Number(pin) : null };
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
  // place among the pinned. Pinning puts it last among them; a drag among
  // the pinned renumbers them.
  togglePin(a, mine) {
    if (a.pin != null) { hc(["label", a.address, `${PIN_LABEL}=`]).catch(() => {}); return; }
    const last = Math.max(0, ...mine.filter((x) => x.pin != null).map((x) => x.pin));
    hc(["label", a.address, `${PIN_LABEL}=${last + 1}`]).catch(() => {});
  }

  setPins(addresses) {
    addresses.forEach((address, i) => hc(["label", address, `${PIN_LABEL}=${i + 1}`]).catch(() => {}));
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
      pin: () => this.togglePin(a, mine),
      menu: this.rowFor(a).menu,
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
    if (key === "switch") { this.showSwitch = on; if (!on) this.setView("spaces"); }
    else this.showActivity = on;
    localStorage.setItem(`spaces.${key}`, on ? "on" : "off");
    cx.notify();
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
    const rows = this.ordered(sp, ps);
    const live = machines();
    const all = this.listed(ps, sp, ctx.terms);
    const draw = (r) => {
      if (collapsed) return this.compact(r, t);
      const mine = orderSessions(this.inStripOrder(all.filter((a) => a.space === r.w.id)), this.order, this.custom[r.w.id] ?? []);
      const entries = nest(mine, ctx.terms);
      const open = !this.agentsFolded.has(r.w.id);
      // A breath of space between projects (a worktree stays close to its checkout).
      const gap = r.tree || r === rows[0] ? [] : [div().h(10).flex_none()];
      return [...gap, this.row(r, t, entries.map((e) => e.a)), ...(open ? this.stacked(entries, mine, r.tree ? CHILD_PAD : 0, t, r.w.id, ctx) : [])];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const state = live.find(k => k.name === m)?.layout;
      return state === "loading" || (!state && this.machines.some(k => k.name === m && k.state === "connected"))
        || rows.length < sp.length && sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
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
      return [head, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
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
    return agentFold(w.id, mine, open, (cx) => { this.setAgentsFolded(w.id, open); cx.notify(); }, t);
  }

  setAgentsFolded(id, folded) {
    folded ? this.agentsFolded.add(id) : this.agentsFolded.delete(id);
    localStorage.setItem("spaces.agentsFolded", JSON.stringify([...this.agentsFolded]));
  }

  // A space's avatar color: the theme's own hue (quiet in Kanso), else a fixed one.
  fill(w, t) {
    const color = this.colors?.[w.id] ?? "ansi6";
    return color.startsWith("#") ? color : (t[color] ?? MARK[color]);
  }

  row({ w, i, g, tree }, t, mine = []) {
    const on = w.active;
    const fill = this.fill(w, t);
    const rt = t;
    // A wash of the text color, so a loud theme accent never paints the row.
    const wash = t.foreground + "14";
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
      .when(on, (el) => el.bg(wash))
      .when(!on, (el) => el.hover((s) => s.bg(washHover)))
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
          if (mine.length) this.setAgentsFolded(w.id, on ? !this.agentsFolded.has(w.id) : false);
          if (!on) run("space.select", { id: w.id });
        }
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .when(Boolean(tree), (el) => el.children(this.connector(tree, rt)))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(CHILD_PAD).child(svg("mods/kanso-chrome/icons/branch.svg").size(13).text_color(rt.muted)))
          .when(!tree, el => el.child(h_flex().size(22).flex_none().rounded(6).bg(fill + "26").items_center().justify_center().text_size(12).font_semibold().text_color(fill).child(w.name[0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_size(13.5).font_semibold().text_color(tree && !on ? rt.muted : rt.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, rt) : div().flex_1())
          .when(mine.length > 0, (el) => el.child(this.fold(w, mine, rt))),
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
    const entries = nest(this.inStripOrder(this.listed(ps, sp, ctx.terms)), ctx.terms);
    const held = this.held?.done ? this.held.address : null;
    const sections = bySection(entries, this.since ?? {}, held, this.statusOrder);
    if (!sections.length) return [this.empty(t, "No agents yet", "Start one from + in the tab bar; it shows here by what it needs from you.")];
    const project = this.projectOf(sp, t);
    return sections.flatMap((s, i) => {
      const open = !this.sectionsFolded.has(s.id);
      const count = s.entries.filter((e) => !e.lines.length).length;
      const head = this.sectionHead(t, `section-${s.id}`, i, open, () => {
        open ? this.sectionsFolded.add(s.id) : this.sectionsFolded.delete(s.id);
        localStorage.setItem("spaces.sections", JSON.stringify([...this.sectionsFolded]));
      }, s.id === "other" ? null : statusMark(t, s.id, true), s.label, count, s.id === "blocked" ? t.blocked : t.foreground);
      const rows = open ? s.entries.map((e) => agentRow(e.a, FLUSH, t, this.rowFor(e.a), this.more(e, ctx, e.lines.length ? null : project(e.a.space)))) : [];
      return [head, ...rows];
    });
  }

  // A section's header: [mark] name count ........ chevron. 13px semibold,
  // the first flush with the top, the rest after 14px of space; no rules.
  sectionHead(t, id, i, open, toggle, mark, name, count, ink) {
    return h_flex().id(id).h(i ? 44 : 32).pt(i ? 12 : 0).px(12).flex_none().gap(10).items_center()
      .cursor_pointer().text_size(13).font_semibold().text_color(ink)
      .on_click((_e, cx) => { toggle(); cx.notify(); })
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

  // What a row in any view answers to besides a click: hover (for its
  // actions) and a right-click, the thread menu. `actions`: Threads' quick
  // ones on hover.
  rowFor(a, actions = null, extra = {}) {
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => { if (h ? this.hoverRow !== a.address : this.hoverRow === a.address) { this.hoverRow = h ? a.address : null; cx.notify(); } },
      menu: () => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 460, at: "pointer",
        props: { menu: { address: a.address, view: this.view, title: extra.title ?? null, session: extra.session ?? null } } }),
      actions,
      ...extra.row,
    };
  }

  // Projects | Status | Threads, under the top row. Status carries a dot
  // while an agent needs you and you are on another view.
  viewSwitch(t, sp) {
    const asks = sp.some((s) => s.status === "blocked");
    const seg = (view) => {
      const on = this.view === view;
      return h_flex().id(`spaces-view-${view}`).flex_1().h(28).gap(6).items_center().justify_center().rounded(7).cursor_pointer()
        .text_size(12.5).font_medium().text_color(on ? t.foreground : t.muted).border_1().border_color(on ? t.border : t.foreground + "00")
        .when(on, (el) => el.bg(t.raised ?? t.selected))
        .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { this.setView(view, cx); cx.notify(); })
        .child(div().child(VIEWS[view].label))
        .when(view === "agents" && asks && !on, (el) => el.child(div().size(6).rounded_full().bg(t.blocked)));
    };
    return h_flex().mx(18).mt(4).mb(14).p(3).gap(2).flex_none().rounded(10).bg(t.foreground + "0a").children(Object.keys(VIEWS).map(seg));
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
        activity: th?.prompt ? `You: ${th.prompt}` : null,
        roomy: true,
      });
    };
    return sections.flatMap((s, i) => {
      const folds = Boolean(s.folds);
      const open = folds ? this.shelvesOpen.has(s.id) : !this.sectionsFolded.has(`thread-${s.id}`);
      const toggle = () => {
        if (folds) { open ? this.shelvesOpen.delete(s.id) : this.shelvesOpen.add(s.id); localStorage.setItem("spaces.shelvesOpen", JSON.stringify([...this.shelvesOpen])); }
        else { open ? this.sectionsFolded.add(`thread-${s.id}`) : this.sectionsFolded.delete(`thread-${s.id}`); localStorage.setItem("spaces.sections", JSON.stringify([...this.sectionsFolded])); }
      };
      const p = s.project ? project(s.project) : null;
      const mark = p ? h_flex().size(18).flex_none().rounded(5).bg(p.fill + "2e").items_center().justify_center().text_size(10.5).font_semibold().text_color(p.fill).child(p.name[0]?.toUpperCase() ?? "?")
        : s.id === "pinned" ? svg("mods/kanso-chrome/icons/pin.svg").size(13).flex_none().text_color(t.muted)
        : s.id === "snoozed" ? svg("mods/kanso-chrome/icons/clock.svg").size(14).flex_none().text_color(t.muted)
        : s.id === "settled" ? svg("mods/kanso-chrome/icons/check.svg").size(14).flex_none().text_color(t.muted) : null;
      // The ungrouped active list needs no header: it is the inbox itself.
      const head = s.id === "active" ? (i ? [div().h(12).flex_none()] : [])
        : [this.sectionHead(t, `thread-${s.id}`, i, open, toggle, mark, p ? p.name : s.label, s.rows.length, folds ? t.muted : t.foreground)];
      return [...head, ...(open || s.id === "active" ? s.rows.map(row) : [])];
    });
  }

  // Pinning a thread puts it last among the pinned; again unpins it.
  pinThread(a) {
    if (a.pin != null) { label(a.address, PIN_LABEL); return; }
    const last = Math.max(0, ...terminals().map((k) => Number(k.labels?.[PIN_LABEL]) || 0));
    label(a.address, PIN_LABEL, last + 1);
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

  render() {
    const t = theme();
    if (props()?.menu) return this.menuView(t);
    const collapsed = shared("sidebar.collapsed") === true;
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ps = panes();
    const ids = new Set(sp.map(p => p.id));
    const stored = shared("space.colors") ?? {};
    const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(stored).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    this.colors = kept;
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
    // Read once per draw: every terminal's record, the panes' digests, now.
    const ctx = { terms: terminals(), digests: shared("kanso.digest") ?? {}, now: Date.now() };
    const switchShown = this.showSwitch !== false;
    const view = !collapsed && switchShown ? this.view : "spaces";
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
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).gap(collapsed ? 0 : view === "threads" ? 6 : 1).pt(collapsed ? 6 : 0).pb(14).overflow_y_scrollbar().mode(collapsed ? "hover" : "always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.draggedAgent = null; cx.notify(); })
        .children(view === "agents" ? this.agentsView(t, sp, ps, ctx) : view === "threads" ? this.threadsView(t, sp, ps, ctx) : this.grouped(t, collapsed, sp, ps, ctx)));
  }
}
