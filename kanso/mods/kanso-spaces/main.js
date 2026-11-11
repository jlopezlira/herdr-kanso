// Derived from the `spaces` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: New space button, initial tiles, nested worktrees on guide lines, ahead/behind counts.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-spaces; each space lists its agents (agents.js), folded by clicking the space. The active space is a faint wash of the text color, never a theme accent.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-spaces; a fixed 76px rail when collapsed (resizable only when open), space avatars in the theme's hues, a breathing dot instead of a spinner, background polling slowed when the window is behind.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Popover, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar, ScrollHandle } from "gpui-base";
import { agentRow, agentFold, agentLabel, AGENT_PAD, FLUSH, NESTED, renameTerminal, statusMark, SETTLED_LABEL, SNOOZE_LABEL, UNREAD_LABEL, THREAD_LABEL, settledOf, snoozedUntil, isUnread, woke, backFromSettled, threadSections, snoozePresets, THREAD_ORDERS, STATUS_ORDERS, withTerminals, NAME_LABEL, PIN_LABEL, ORDERS, DEFAULT_ORDER, orderSessions, moved, nest, track, elapsed, activityOf, bySection, duration, trackSteps, stepOf, tasksOf, said, FOLD, FOLD_MS, pill, agentRowH, segmentAt, mostUrgent } from "./agents.js";
import { findThreads, pidsOf, aliveIn, aliveDue, ALIVE_MS, ALIVE_BEHIND_MS } from "./threads.js";
import { parseProcesses } from "./procs.js";
import { Panel, sameSeen } from "./panel.js";
import { Store, shownOf } from "./store.js";
import { Kdb, spaceFor, inPlace } from "./kdb.js";
import { agentSnapshot, agentTargets, observedAgents, targetOf, parseTarget, returnSignature } from "./since-left-model.js";
import { SinceLeft } from "./since-left.js";
import { SleepWork, settleOnLoad, commandsOf, runCmds, releaseHide, awayLeft, isAway } from "./sleepwork.js";
import { REGISTRY, WORKTREES, keyOfSpace, keyOfProject, closedProjects, shownNames, startingProjects, folderName, addWorktree, worktreesOf, missingFolders, trimmed, sameProjects } from "./projects.js";
import { stateMark } from "./marks.js";
import { sleepingNow, asleepGroups, withAway, nameOf, seenNow, conversationOfThread, readNow, shownThread, terminalNames, agentKey, SHOWN_LABEL, PROJECT_LABEL, ID_LABEL } from "./roster.js";
import { pollable, activePlaces } from "./background.js";
import { listKey, moveTo } from "./listkeys.js";
import { isKansoTree, paintLayout, rememberLayout, commitLayout } from "./layout.js";
import { tryOrAsync } from "./pure.js";
import { skeleton, breathe, H, G, T, R, ICON, HEADER_ICON, toggleSwitch, tokens, quietLink } from "./ui.js";
import { machineRecord, canRestore, addArgs, rmArgs, loginLine, hcError, needsLogin, heldNames, connectedNames, machinePhase, powerId, machineTitle, machineOf, visibleSpaces, visibleAgents, pollKeys, machineMarks } from "./machines.js";
import { NEEDS_YOU, EMPTY_NOTICE_MS, waitingSignature, sleepingSignature, sameQueue, waitingQueue, nextWaiting, queueState } from "./needs-you.js";
import { queueControl, queueList } from "./needs-you-view.js";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, nextCommand, focused, home, appHome, pickFolder, knownAgents, notify } from "herdr";

const PREFS = ["machines.folded", "spaces.agentsFolded", "spaces.order", "spaces.statusOrder", "spaces.threadOrder", "spaces.threadGroup",
  "spaces.shelvesOpen", "spaces.custom", "spaces.view", "spaces.sections", "spaces.since"];

// `ps`: panes(), read once by the caller: each read copies every pane.
function placesOf(sp, ps) {
  // Each tab's first pane with a folder (the first one set wins: read backwards).
  const byTab = new Map(ps.filter((p) => p.cwd).toReversed().map((p) => [p.tab, p.cwd]));
  return new Map(sp.map((s) => {
    const on = s.machine ?? null, cwd = (s.tabs ?? []).map((c) => byTab.get(c.id)).find(Boolean) || s.folder;
    return [s.id, { on, cwd, key: JSON.stringify([on, cwd]) }];
  }));
}
const TREE_ROW = 32;
const MENU_ROW = 30; // a popup row: the conversation picker's virtual list places rows by it
const RAIL_MARK = 46; // one group in the collapsed rail
const RAIL_MENU_ROWS = 10; // a rail popup shows this many rows; the rest scroll
const PLAIN_ROW = 36;
const GUIDE_X = 13; // under the parent's name, just in from its first letter: 8px row padding + 5
const ELBOW_W = 11;
const GUIDE_OVERLAP = 4; // the line reaches up into the row above, so it never breaks
const CHILD_PAD = GUIDE_X + ELBOW_W + 6 - 8; // icon starts 6px after the elbow, inside the 8px row padding
const rowHeight = ({ tree }) => (tree ? TREE_ROW : PLAIN_ROW);
// Every height is known before anything is drawn, so a scan (`laidOut`) finds where each pill goes.
const item = (el, h = null, mark = null) => ({ el, h, mark });
const goingOf = (group) => Boolean(group?.going?.length) && !group?.stuck?.length;
const spaceMark = (h) => ({ kind: "space", at: 0, h });
const agentMark = (at, h) => ({ kind: "agent", at, h });
function laidOut(items, gap) {
  const yAt = (i) => items.slice(0, i).reduce((y, it) => (it.h == null ? y : y + (it.h + gap)), 0);
  const last = (kind) => {
    const i = items.findLastIndex((it) => it.mark?.kind === kind);
    return i < 0 ? null : { y: yAt(i) + items[i].mark.at, h: items[i].mark.h };
  };
  return { els: items.map((it) => it.el), space: last("space"), agent: last("agent") };
}
const base = (path) => path.replace(/\/+$/, "").split("/").at(-1);
// Changes made outside Herdr (an editor's save, a commit in another app) are found this often, while the window is in front.
const FALLBACK = 60000;
// A `ps` answers in milliseconds; one still out after this is taken for hung (psRun).
const PS_GIVE_UP_MS = 10000;
const SIDEBAR_W = 256;
// The collapsed rail is as wide as the macOS traffic lights need, so they never spill over the tab bar.
const collapsedW = () => (window()?.platform === "macos" ? 76 : 44);
// Dragged narrower, rows keep one line under ONE_LINE_W, and under SNAP_W the sidebar folds to the rail as Hide sidebar does.
const ONE_LINE_W = 240;
const SNAP_W = 160;
const OPEN_MIN = 120; // open, the edge drags this far, past SNAP_W, so a drag can fold it
const HELD_MS = 400;

function setRail(open, width) {
  const min = open ? OPEN_MIN : collapsedW();
  rememberLayout({ rail: { open, min } });
  const tree = layout();
  const sidebar = (tree?.children ?? []).find((n) => n.id === "sidebar");
  if (!sidebar) return;
  if (tree.resizable !== open || sidebar.min !== min) {
    const painted = paintLayout(tree);
    if (isKansoTree(painted)) run("layout.set", { layout: painted });
  }
  run("layout.resize", { id: "sidebar", px: width });
}

// The same avatar colors in every mod that draws them: one strong color per hue.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const VIEWS = {
  spaces: { label: "Projects" },
  agents: { label: "Status" },
  threads: { label: "Threads" },
};
// Must match how kanso-sleep keys a project: its machine and folder.
export const projectKey = (w) => `${w?.machine ?? ""}:${w?.folder || home()}`;
const arrange = (props) => openOverlay({ mod: "kanso-sleep", kind: "dialog", width: 520, props });
const sleepTab = (spaceId, tab) => arrange({ sleep: { scope: "tab", space: spaceId, tab } });
const wakeRow = (id) => arrange({ wake: { id } });
const sleepAgent = (spaceId, tab, pane) => arrange({ sleep: { scope: "agent", space: spaceId, tab, pane } });
const sleepProject = (spaceId) => arrange({ sleep: { scope: "project", space: spaceId } });
// Reload sleeps after shared changes or two minutes; drop a read overtaken by a newer stamp.
// The Store holds live handles, so it stays the sidebar view's own state, never shared.
const since = (ms) => { const d = new Date(ms); return new Date().toDateString() === d.toDateString() ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };

const latestChoice = (entries) => entries.filter((x) => x?.projectAt).toSorted((a, b) => b.projectAt - a.projectAt)[0] ?? null;
const RETRY_MS = 30_000;
// Who last sent this agent a message from Send, until you open it.
const FROM_LABEL = "kanso.from";
const fromOf = (a) => (isUnread(a.labels) ? a.labels?.[FROM_LABEL] || null : null); // a terminal label write not seen yet is sent again after this
const label = (address, key, value) => hc(["label", address, `${key}=${value ?? ""}`]).catch(() => {});

// The projects, as every view of the sidebar draws them (the database read last, which local folders are gone).
const registry = () => { const rows = shared(REGISTRY); return Array.isArray(rows) ? rows : []; };
async function publishRegistry(kdb) {
  const list = await kdb.projects();
  const sleeping = new Set((shared("kanso.asleep") ?? []).filter((s) => s.state !== "undoing").map((s) => s.from));
  const awake = new Set(spaces().map((s) => keyOfSpace(s, home())));
  const quiet = (p) => sleeping.has(keyOfProject(p)) && !awake.has(keyOfProject(p));
  const missing = await missingFolders(list.filter((p) => !p.machine && !quiet(p)).map((p) => p.folder));
  const previous = new Map(registry().map((p) => [p.id, p.missing]));
  // Only this computer's folders are looked at: another machine's project is never called gone from here.
  const shown = list.map((p) => ({ id: p.id, name: p.name, folder: p.folder, machine: p.machine ?? "", agent: p.agent ?? null, missing: quiet(p) ? (previous.get(p.id) ?? false) : !p.machine && missing.has(p.folder) }));
  if (JSON.stringify(shown) !== JSON.stringify(registry())) setShared(REGISTRY, shown);
  return shown;
}
// A sleep's key as a project's (a trailing / never makes two of one place).
const sameKey = (key) => { const i = String(key).indexOf(":"); return `${key.slice(0, i)}:${trimmed(key.slice(i + 1))}`; };
const projectAt = (key) => registry().find((p) => keyOfProject(p) === sameKey(key)) ?? null;
// Kanso's worktrees: beside its database here; on another machine, ~/.kanso/worktrees (the script's default).
const kansoWorktrees = (machine) => (machine ? "" : `${appHome()}/${WORKTREES}`);
// Where a new agent of a project goes. Plain data, so a menu can be given it.
const placeOfSpace = (w) => {
  const project = registry().find((p) => keyOfProject(p) === keyOfSpace(w, home())) ?? null;
  return { space: w.id, folder: w.folder || (w.machine ? null : home()), machine: w.machine ?? "", project: project?.id ?? null, name: w.name };
};
const placeOfKey = (key, project = projectAt(key)) => {
  const i = key.indexOf(":"), machine = key.slice(0, i), at = key.slice(i + 1);
  // Another machine's space at its home was kept under this computer's home: there, its own home (no folder) is meant.
  const folder = project?.folder ?? (machine && trimmed(at) === trimmed(home()) ? null : at);
  return { space: null, folder, machine, project: project?.id ?? null, name: project?.name ?? folderName(at) };
};
// An agent (argv; none: a shell) in a project: in its open space, else a new space at its folder.
function startIn(place, argv = null) {
  const agent = argv ? { argv } : {};
  const at = place.folder ? { folder: place.folder } : {};
  if (place.space) { run("space.select", { id: place.space }); run("tab.new", { space: place.space, ...at, ...agent }); }
  else {
    // A project you named otherwise than its folder: its space takes that name.
    const named = place.name && place.folder && place.name !== folderName(place.folder) ? { name: place.name } : {};
    run("space.new", { ...at, ...named, machine: place.machine ?? "", ...agent });
  }
}
// In another folder of the project (a worktree): a closed project gets its space at its own folder first.
function openAt(place, folder, argv = null, name = null) {
  if (place.space) run("space.select", { id: place.space });
  else run("space.new", { ...(place.folder ? { folder: place.folder } : {}), machine: place.machine ?? "" });
  run("tab.new", { ...(place.space ? { space: place.space } : {}), folder, ...(name ? { name } : {}), ...(argv ? { argv } : {}) });
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as a row's right-click menu (props().menu): nothing else to run.
    if (props()?.menu || props()?.railMenu || props()?.spaceMenu || props()?.newAgent || props()?.worktree || props()?.newConversation || props()?.newProject) {
      // Nothing is chosen for you: no row lit until the keyboard moves.
      this.confirmClose = false; this.menuAt = -1; this.handle = cx.focus_handle();
      // A scroll handle is state: made here, never during render (Herdr refuses it there).
      if (props()?.newConversation || props()?.railMenu) this.convScroll = VirtualListScrollHandle.new();
      this.openPopup(cx); return;
    }
    this.asleepReads = 0;
    this.asleepApplied = 0;
    this.loadAsleep().catch(() => {});
    this.handle = cx.focus_handle(); // the list by keyboard (enterList)
    this.needsScroll = ScrollHandle.new();
    if (shared("kanso.list")) setShared("kanso.list", null); // a reload: nothing is on the list
    this.git = {}; // place key -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its place key at the last look
    this.watching = new Set(); // local repos' git folders
    // A new space waits a moment for its git, so a worktree appears under its repo instead of jumping.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.parked = [];
    this.waking = new Set();
    this.login = new Set();
    this.failed = new Set();
    this.powerBusy = new Set();
    this.hostName = "";
    // The first frame uses localStorage's copy; the database's answer replaces it when it comes.
    this.panel = new Panel(PREFS, this.leftNavStore());
    this.panelReady = false;
    this.sinceLeft = new SinceLeft(this.leftNavStore().kdb);
    this.prSeenAt = shared("kanso.pr.seen")?.at ?? 0;
    // Sleeps are this sidebar's work (sleepwork.js): taken up now (what a restart cut short goes on), on the dialog's
    // kick and with the 30 s look; the heartbeat keeps a long step's row this window's.
    this.sleepWork = new SleepWork(this.leftNavStore().kdb, (row) => {
      if (row?.state === "stuck") notify({ title: `${row.name} could not sleep`, body: `${row.why}. Retry or undo it from Asleep.`, level: "error" });
      this.loadAsleep().catch(() => {});
    });
    this.sleepWork.start(cx);
    cx.timer.every(5000, () => { if (this.sleepWork.held.size) this.sleepWork.beat().catch(() => {}); });
    this.applyPrefs();
    cx.spawn(async (cx) => {
      this.panelTried = Date.now();
      try { if (await this.panel.load()) this.applyPrefs(); this.panelReady = true; } catch { /* tried again from keepSeen; the copy stays meanwhile */ }
      cx.notify();
    });
    this.orderOpen = false;
    this.threads = null; // terminal -> its conversation (threads.js), once read
    // A pre-2.7 hide choice moves to kanso.hidden once.
    for (const [key, id] of [["switch", "sidebar.switch"], ["activity", "sidebar.activity"]]) {
      if (localStorage.getItem(`spaces.${key}`) === "off") { this.hide(id, true); localStorage.removeItem(`spaces.${key}`); }
    }
    this.steps = {}; // agent -> what it says it is on, and since when (agents.js trackSteps)
    this.tasks = {}; // agent -> what still runs under it (checkTasks)
    this.held = null;
    this.hoverRow = null;
    // folding: the group of rows on the move; foldH: each group's last height, so a fold knows where it ends.
    this.folding = null;
    this.foldH = {};
    this.migrate();
    this.refreshMachines(cx);
    cx.spawn(async (cx) => {
      const rev = this.parkRev ?? 0;
      try {
        const rows = (await this.db().machinesOff()).map((row) => machineRecord(row)).filter(Boolean);
        if ((this.parkRev ?? 0) !== rev) return;
        this.parked = rows;
        await this.settleParked();
      } catch { /* the next look reads it */ }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        const result = await exec("hostname", []);
        const name = String(result?.stdout ?? "").replace(/\r/g, "").trim();
        if (result?.code === 0 && name) { this.hostName = name; cx.notify(); }
      } catch { /* the header says This computer */ }
    });
    // Remote machines: every 30 s in front, every 2 min behind.
    cx.timer.every(30000, cx => {
      if (window().active) { this.refreshMachines(cx, true); return; }
      this.machineTicks += 1;
      if (this.machineTicks % 4 === 0) this.refreshMachines(cx, true);
    });
    this.machineTicks = 0;
    // `git status` walks the whole tree: only when its answer could have changed (see `due`);
    // behind other windows every 5 s instead of 0.5 s, nothing is missed.
    cx.timer.every(500, (cx) => this.checkNew(cx));
    cx.timer.every(ALIVE_MS, (cx) => this.checkTasks(cx));
    // A sleep or wake that stopped half way shows again once old; another window's changes arrive.
    cx.timer.every(30000, (cx) => { this.loadAsleep(false).catch(() => {}); this.sleepWork.start(cx); cx.notify(); });
    // keys.json: ⌃1-9 and ⌃⌥P/S/T arrive here as commands.
    cx.spawn(async (cx) => {
      for (;;) {
        const next = await tryOrAsync(async () => { const c = await nextCommand(); cx.notify(); return { c }; });
        if (!next) break; // a replaced build (hot reload, update) stops here, before acting
        this.command(String(next.c).replace(/^kanso-spaces\./, ""), cx);
      }
    });
  }

  leftNavStore() {
    return (this.navStore ??= new Store());
  }

  // A popup of this mod: what it shows that has to be read first is read here.
  openPopup(cx) {
    const p = props();
    this.kdb = new Kdb();
    if (p.newProject) {
      this.projectName = InputState.new({ placeholder: "Its name" });
      this.projectName.on("submit", (_e, cx) => this.createProject(cx));
      this.projectFolder = null;
      this.projectName.focus();
      return;
    }
    if (p.worktree) {
      this.branch = InputState.new({ placeholder: "feat/my-change" });
      this.branch.on("submit", (_e, cx) => this.makeWorktree(cx));
      this.branch.focus();
      return;
    }
    this.handle.focus();
    if (p.newAgent) {
      knownAgents({ on: p.newAgent.machine || null }).then((list) => { this.known = list; cx.notify(); }).catch(() => { this.known = []; cx.notify(); });
    }
    const place = p.spaceMenu ? this.menuPlace(p.spaceMenu) : null;
    // A worktree whose folder was deleted (prunable) is only git's note of it: not listed.
    if (place?.folder) {
      worktreesOf(place.folder, place.machine || null).then((list) => { this.trees = list.filter((x) => !x.main && !x.prunable); cx.notify(); });
    }
  }

  close() {
    try { this.branch?.release(); this.projectName?.release(); this.convScroll?.release(); } catch { /* already gone */ }
  }

  menuPlace(m) {
    const w = m.id ? spaces().find((s) => s.id === m.id) : null;
    return w ? placeOfSpace(w) : m.key ? placeOfKey(m.key) : null;
  }

  // Projects: the database's, read again after each change so every window draws the same.
  async loadProjects(kdb, rows) {
    // Once, when every machine's spaces are in: the spaces open now (and the places asleep whole) become your projects.
    // Read here, after the waits before it, so spaces that came in meanwhile are not left out.
    if (!this.projectsIn && !machines().some((m) => m.layout === "loading")) {
      await kdb.migrateProjects(startingProjects(spaces(), [...new Set(rows.map((a) => a.from).filter(Boolean))], home()));
      this.projectsIn = true;
    }
    await publishRegistry(kdb);
  }

  // The sidebar's own database handle; a popup has its own.
  db() { return this.kdb ?? this.leftNavStore().kdb; }

  // A project's name and folder, asked in a dialog; `start`: a conversation begins in it once made.
  addProject(start = false) {
    openOverlay({ mod: "kanso-spaces", kind: "dialog", width: 460, height: 270, props: { newProject: { start } } });
  }

  // The click's context ends with the click: the dialog redraws from its own spawned one.
  chooseProjectFolder(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Choose" }).catch(() => null);
      if (!folder) return;
      this.projectFolder = trimmed(folder);
      if (!this.projectName.value().trim()) this.projectName.set_value(folderName(folder));
      this.projectError = null;
      cx.notify();
    });
  }

  createProject(cx) {
    if (this.creating) return;
    const name = this.projectName.value().trim(), folder = this.projectFolder, start = Boolean(props().newProject?.start);
    if (!folder) { this.projectError = "Choose its folder."; cx.notify(); return; }
    this.creating = true;
    cx.spawn(async (cx) => {
      try {
        const { row, existed } = await this.kdb.addProject({ name: name || folderName(folder), folder, machine: "" });
        await publishRegistry(this.kdb);
        const open = spaces().find((w) => keyOfSpace(w, home()) === keyOfProject(row));
        if (existed) notify({ title: `${row.name} is already one of your projects`, level: "info", timeout: 4000 });
        closeOverlay(props().overlay);
        // Then which agent: the ones you have installed, none chosen for you.
        if (start) this.newAgentMenu(open ? placeOfSpace(open) : placeOfKey(keyOfProject(row), row));
        else if (open) run("space.select", { id: open.id });
      } catch (e) { this.projectError = String(e?.message ?? e); }
      finally { this.creating = false; cx.notify(); }
    });
  }

  newProjectView(t) {
    const start = Boolean(props().newProject?.start);
    const shown = this.projectFolder ? this.projectFolder.replace(trimmed(home()), "~") : "No folder chosen";
    const button = (id, text, act, primary) => div().id(id).h(28).px(12).flex().flex_none().items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(primary, (el) => el.bg(t.accent).text_color(t.accent_foreground ?? t.background))
      .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => act(cx))
      .child(text);
    const label = (text) => div().text_size(12).text_color(t.muted).child(text);
    return v_flex().id("project-dialog").size_full().p(18).gap(8).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (String(e.key).toLowerCase() === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(div().pb(4).text_size(15).font_semibold().child(start ? "New project with a conversation" : "New project"))
      .child(label("Folder"))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(this.projectFolder ? t.foreground : t.dim).child(shown))
        .child(button("project-choose", this.projectFolder ? "Change\u2026" : "Choose\u2026", (cx) => this.chooseProjectFolder(cx), false)))
      .child(label("Name"))
      .child(div().h(32).flex_none().px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
        .child(Input.new(this.projectName).flex_1().h_full().text_size(13)))
      .child(div().min_h(16).text_size(12).text_color(this.projectError ? t.blocked : t.dim).child(this.projectError ?? (start ? "The agent you used there last starts in it." : "It stays in Projects even with nothing open.")))
      .child(h_flex().gap(8).justify_end()
        .child(button("project-cancel", "Cancel", () => closeOverlay(props().overlay), false))
        .child(button("project-create", this.creating ? "Creating\u2026" : start ? "Create and start" : "Create project", (cx) => this.createProject(cx), true)));
  }


  newConversationMenu() {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 280, height: 460, at: "pointer", props: { newConversation: true } });
  }

  // Every project: the open ones (each space), then the ones you added that have none open.
  // A project chosen asks which agent.
  newConversationView(t) {
    const sp = spaces();
    const item = this.items(t);
    const closed = closedProjects(registry(), sp, home()).filter((p) => !p.missing);
    const names = shownNames(registry());
    // A project chosen, then which agent, in its own menu: nothing is started for you.
    const start = (place) => { closeOverlay(props().overlay); this.newAgentMenu(place); };
    const entries = [
      ...sp.map((w) => ({ id: `conv-${w.id}`, place: placeOfSpace(w), hint: w.machine ?? null })),
      // The shown name tells two alike apart; the space keeps the project's own.
      ...closed.map((p) => ({ id: `conv-${p.id}`, place: placeOfKey(keyOfProject(p), p), hint: p.machine || "closed", label: names.get(p.id) ?? p.name })),
    ];
    // Every row's act is there for the keyboard, drawn or not; the list draws only what shows, and follows the selection.
    this.menuActs = entries.map((e) => (cx) => start(e.place));
    this.menuScroll = this.convScroll ? { handle: this.convScroll, count: entries.length } : null;
    // Drawn inside the virtual list: no handlers on the rows; the list's own say which row, by its key.
    const row = (e, at) => this.menuRow(t, e.id, e.label ?? e.place.name ?? "~", at, null, { hint: e.hint });
    const byKey = (key) => entries.find((e) => e.id === key) ?? null;
    return this.menuFrame(t)
      .child(this.menuTitle(t, "New conversation in"))
      .child(v_flex().relative().flex_none().h(Math.min(330, entries.length * MENU_ROW))
        .child(v_virtual_list("conv-list", entries.length, MENU_ROW, (i) => entries[i].id,
          (range) => entries.slice(range.start, range.end).map((e, k) => row(e, range.start + k)))
          .when(Boolean(this.convScroll), (el) => el.track_scroll(this.convScroll))
          .on_item_click((key, cx) => { const e = byKey(key); if (e) start(e.place); cx.notify(); })
          .on_item_secondary_click((key, _ev, cx) => { const e = byKey(key); if (e) { cx.stop_propagation(); start(e.place); } }))
        .child(Scrollbar.vertical("conv-list").absolute().inset_0()))
      .child(div().mx(8).my(4).h(1).bg(t.border))
      .child(item("conv-add-project", "New project with a conversation\u2026", () => this.addProject(true), { icon: "folder-plus" }))
      .child(item("conv-folder", "Open a folder, no project\u2026", () => run("kanso-spaces.open-folder"), { icon: "file" }));
  }

  newAgentMenu(place) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 300, at: "pointer", props: { newAgent: place } });
  }

  // A project's + : asks which agent, of the ones installed.
  plus(id, t, place) {
    return div().id(id).size(20).flex_none().rounded(6).flex().items_center().justify_center().text_color(t.dim)
      .tooltip("New conversation")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.newAgentMenu(place); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.newAgentMenu(place); })
      .child(svg("mods/kanso-chrome/icons/plus.svg").size(13));
  }



  async loadAsleep(force = true) {
    const started = Date.now(), stamp = shared("kanso.asleep.at") ?? 0, kick = shared("kanso.sleep.kick") ?? 0;
    if (!force && stamp === this.asleepStamp && kick === this.asleepKick && started - this.asleepLoaded < 120000) return;
    this.asleepReads += 1;
    const seq = this.asleepReads;
    // A sleep from before space ids adopts the one space it now fits.
    const st = this.leftNavStore(), sp = spaces();
    const rows = await st.asleep(true, sp, started).catch(() => null);
    if (rows) {
      const found = rows.filter((a) => !a.spaceId).map((a) => ({ sleep: a.id, space: spaceFor({ spaceName: a.space, project: a.from }, sp, home())?.id })).filter((x) => x.space);
      if (found.length) await st.kdb.adoptSpaces(found).catch(() => {});
      await this.loadProjects(st.kdb, rows).catch(() => {});
    }
    if (rows) this.settleHidden(rows);
    if (!rows || seq < this.asleepApplied || (shared("kanso.asleep.at") ?? 0) > started) return;
    this.asleepApplied = seq;
    this.asleepLoaded = started;
    this.asleepStamp = stamp;
    this.asleepKick = kick;
    const list = rows.map((a) => shownOf(a, started));
    if (JSON.stringify(list) === JSON.stringify(shared("kanso.asleep") ?? [])) return;
    this.asleepStamp = started;
    setShared("kanso.asleep.at", started);
    setShared("kanso.asleep", list);
  }

  // A hide from before this load: still sleeping stays hidden, an undo or a missed write comes back, a tab left open is shown once.
  settleHidden(rows) {
    const hidden = shared("kanso.sleep.hidden") ?? [];
    if (!hidden.length) { this.hidOnce = true; return; }
    const plan = settleOnLoad(hidden, rows);
    const live = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    const back = [...plan.reveal, ...plan.restore.filter((h) => live.has(h.tab))];
    runCmds(back.flatMap((h) => commandsOf(h, { back: true })));
    if (!this.hidOnce) {
      this.hidOnce = true;
      runCmds(plan.keep.flatMap((h) => commandsOf(h)));
    }
    if (plan.keep.length !== hidden.length || plan.keep.some((h, i) => h !== hidden[i])) setShared("kanso.sleep.hidden", plan.keep);
    const tabs = new Set([...plan.reveal, ...plan.restore].map((h) => h.tab));
    if (tabs.size) setShared("kanso.sleep.away", awayLeft(shared("kanso.sleep.away"), tabs));
  }

  // A space that isn't there is nothing to do, not an error.
  command(c, cx) {
    const space = /^space-(\d)$/.exec(c), view = /^view-(spaces|agents|threads)$/.exec(c);
    if (space) { const i = Number(space[1]); if (i >= 1 && i <= spaces().length) run("space.select", { index: i }); }
    else if (view) { this.setView(view[1], cx); cx.notify(); }
    else if (c === "needs-you.next") this.nextNeeds(cx);
    else if (c === "needs-you.list") this.toggleNeeds(cx);
    else if (c === "list") this.enterList(cx);
    // From a popup, which is gone once clicked: the sidebar asks for the folder.
    else if (c === "add-project") this.addProject();
    else if (c === "add-project-start") this.addProject(true);
    else if (c === "new-conversation") this.newConversationMenu();
    else if (c === "open-folder") pickFolder({ prompt: "Open" }).then((folder) => folder && run("space.new", { folder, machine: "" })).catch(() => {});
    else if (c === "list-up" || c === "list-down") {
      if (this.kbd) this.listKeyDown({ key: c === "list-up" ? "up" : "down", modifiers: {} }, cx);
      // Not on the list any more: the flag was stale; the strip takes it.
      else { setShared("kanso.list", null); run(`kanso-strip.go-${c === "list-up" ? "up" : "down"}`); }
    }
  }

  background() {
    const sleeps = withAway(shared("kanso.asleep") ?? [], shared("kanso.sleep.away")), layouts = machines();
    return { sleeps, layouts, allows: (address, thread = null) => pollable(address, sleeps, layouts, thread) };
  }

  pollingPlaces(sp = spaces(), ps = panes(), places = placesOf(sp, ps)) {
    const background = this.background();
    const allowed = activePlaces(sp, ps, background.sleeps, background.layouts, home());
    return new Map([...places].filter(([id]) => allowed.has(id)));
  }

  refreshNeeds(sp = spaces(), terms = terminals(), asleep = this.sleepingNow(sp, terms)) {
    const list = agents(), layouts = machines();
    const signature = waitingSignature(list, terms, asleep.dozing, NAME_LABEL);
    const layoutSignature = layouts.map((m) => m.layout).join(",");
    const changed = signature !== this.needsSignature || this.threads !== this.needsThreads;
    if (!changed && layoutSignature === this.needsLayoutSignature) return this.needsQueue;
    this.needsSignature = signature;
    this.needsThreads = this.threads;
    this.needsLayoutSignature = layoutSignature;
    const named = () => {
      const names = new Map(terms.map((term) => [term.address, term.labels?.[NAME_LABEL]]));
      return list.map((a) => ({ ...a, name: this.nameOf({ ...a, name: names.get(a.address) }) }));
    };
    const previous = this.needsQueue ?? shared(NEEDS_YOU);
    const rows = changed ? waitingQueue(named(), terms, asleep.dozing, previous?.rows) : previous.rows;
    const next = queueState(rows, layouts);
    this.needsQueue = previous;
    if (sameQueue(next, previous)) return previous;
    this.needsQueue = next;
    setShared(NEEDS_YOU, next);
    return this.needsQueue;
  }

  jumpNeeds(row, cx) {
    const live = this.refreshNeeds().rows.find((a) => a.address === row.address && a.pane === row.pane);
    if (!live) return;
    this.needsCursor = live;
    this.leaveList(cx, false);
    run("agent.focus", { terminal: live.address });
  }

  nextNeeds(cx) {
    const row = nextWaiting(this.refreshNeeds().rows, this.needsCursor);
    if (row) { this.jumpNeeds(row, cx); return; }
    this.needsCursor = null;
    this.needsEmpty = true;
    const at = (this.needsEmptyAt ?? 0) + 1;
    this.needsEmptyAt = at;
    cx.timer.after(EMPTY_NOTICE_MS, (cx) => { if (this.needsEmptyAt === at) { this.needsEmpty = false; cx.notify(); } });
    cx.notify();
  }

  toggleNeeds(cx) {
    this.needsOpen = !this.needsOpen;
    if (this.needsOpen) {
      if (shared("sidebar.collapsed") === true) this.openRail();
      this.listFrom = focused()?.pane ?? null;
      this.kbd = true;
      this.navKey = `agent:${this.refreshNeeds().rows[0]?.address}`;
      this.handle.focus();
    } else this.leaveList(cx);
    cx.notify();
  }

  needsList(t, queue, now) {
    return queueList(t, queue, (row) => {
      const go = (cx) => this.jumpNeeds(row, cx);
      return { go, selected: this.navMark(`agent:${row.address}`, go) };
    }, (row) => duration(Math.max(0, now - row.at)), this.needsScroll);
  }

  // Rows add themselves as they draw (navMark), in screen order; Esc goes back to the pane you came from.
  enterList(cx) {
    if (shared("sidebar.collapsed") === true || !(this.nav ?? []).length) return;
    const f = focused();
    this.listFrom = f?.pane ?? null;
    const here = this.nav.find((n) => n.here) ?? this.nav[0];
    this.navKey = here.key;
    this.kbd = true;
    this.handle.focus();
    // For the strip: ⌘⌥l (or →) now goes back to that pane.
    setShared("kanso.list", { from: this.listFrom, at: Date.now() });
    cx.notify();
  }

  leaveList(cx, back = true) {
    this.kbd = false;
    if (shared("kanso.list")) setShared("kanso.list", null);
    if (back && this.listFrom) run("pane.focus", { pane: this.listFrom });
    cx.notify();
  }

  // True when the keyboard's ring is on this row; `go` is its click, `here` the row you are in.
  navMark(key, go, here = false) {
    this.navNext = [...(this.navNext ?? []), { key, go, here }];
    return Boolean(this.kbd) && this.navKey === key;
  }

  navRow(a, row) {
    // Asleep: no pane to open; Enter opens its menu (Wake).
    const go = () => (a.asleep ? this.openMenu(a) : a.pane ? run("pane.focus", { pane: a.pane }) : run("terminal.peek", { terminal: a.address }));
    return this.navMark(`agent:${a.address}`, go, Boolean(a.focused)) ? { ...(row ?? {}), kbd: true } : row;
  }

  listKeyDown(e, cx) {
    if (!this.kbd) return;
    const nav = this.nav ?? [];
    const k = String(e.key ?? "").toLowerCase(), m = e.modifiers ?? {};
    const plain = !m.control && !m.platform && !m.alt;
    const { move: listed, gAt } = listKey(e, this.listG);
    this.listG = gAt;
    const move = !listed && plain && k === "l" ? "enter" : listed;
    if (!move && plain && (k === "/" || e.key_char === "/")) { this.leaveList(cx, false); run("mod.open", { name: "picker" }); cx.stop_propagation?.(); return; }
    if (!move) return;
    cx.stop_propagation?.();
    if (move === "escape") { this.leaveList(cx); return; }
    if (move === "pending") return;
    const at = Math.max(0, nav.findIndex((n) => n.key === this.navKey));
    if (move === "enter") {
      const row = nav[at];
      if (!row) return;
      if (row.key.startsWith("agent:")) { this.kbd = false; setShared("kanso.list", null); }
      row.go(cx);
      cx.notify();
      return;
    }
    const next = moveTo(move, at, nav.length);
    this.navKey = nav[next]?.key ?? this.navKey;
    if (this.needsOpen) this.needsScroll?.scroll_to_item(next);
    cx.notify();
  }

  // One `ps` at a time for checkTasks and checkAlive: `psLook` is the start of the one out. One that has not answered in
  // PS_GIVE_UP_MS is given up on, so a hung `ps` never stops either; its late answer, if any, is dropped,
  // whether or not another has started since (behind, the next may be a minute away).
  psFree(now) {
    return this.psLook == null || now - this.psLook >= PS_GIVE_UP_MS;
  }
  async psRun(now, args, take) {
    this.psLook = now;
    try {
      const r = await exec("ps", args);
      if (this.psLook === now && Date.now() - now < PS_GIVE_UP_MS) take(r);
    } catch { /* the last look stands */ }
    finally { if (this.psLook === now) this.psLook = null; }
  }

  // One process table serves tasks and conversation liveness.
  checkTasks(cx, now = Date.now(), active = window().active) {
    if (!this.psFree(now) || window().platform === "windows") return;
    const background = this.background();
    const mine = terminals().filter((k) => background.allows(k.address) && k.state === "live" && k.status && !k.address.includes("/") && (k.foreground?.pid ?? k.pid));
    const pids = pidsOf(Object.fromEntries(Object.entries(this.threads ?? {}).filter(([address, thread]) => !address.includes("/") && background.allows(address, thread))));
    const sig = pids.join(","), every = active ? ALIVE_MS : ALIVE_BEHIND_MS;
    const due = pids.length && aliveDue({ sig: this.aliveSig, at: this.aliveAt }, sig, now, every);
    if (!mine.some((k) => k.status === "working") && !due) {
      if (!mine.length && Object.keys(this.tasks).length) { this.tasks = {}; cx.notify(); }
      return;
    }
    if (now - (this.psAt ?? -Infinity) < every) return;
    this.psAt = now;
    if (pids.length) { this.aliveSig = sig; this.aliveAt = now; }
    cx.spawn((cx) => this.psRun(now, ["-axo", "pid=,ppid=,etime=,command="], (r) => {
      if (r.code !== 0) return;
      const table = parseProcesses(r.stdout);
      if (pids.length) this.sawAlive(aliveIn(table.byPid, pids), pids.join(","), now, cx);
      const next = Object.fromEntries(mine.flatMap((k) => {
        const had = this.tasks[k.address] ?? [];
        const list = tasksOf(table, k.foreground?.pid ?? k.pid, Boolean(k.foreground?.pid))
          .map((x) => ({ pid: x.pid, command: x.command, start: had.find((h) => h.pid === x.pid)?.start ?? now - x.ms }));
        return list.length ? [[k.address, list]] : [];
      }));
      const key = (m) => JSON.stringify(Object.entries(m).map(([addr, l]) => [addr, l.map((x) => [x.pid, x.command])]));
      if (key(next) !== key(this.tasks)) { this.tasks = next; cx.notify(); }
    }));
  }

  applyPrefs() {
    const p = this.panel;
    this.folded = new Set(p.json("machines.folded", []));
    this.agentsFolded = new Set(p.json("spaces.agentsFolded", []));
    const order = p.get("spaces.order");
    this.order = order in ORDERS ? order : DEFAULT_ORDER;
    const statusOrder = p.get("spaces.statusOrder");
    this.statusOrder = statusOrder in STATUS_ORDERS ? statusOrder : "latest";
    const threadOrder = p.get("spaces.threadOrder");
    this.threadOrder = threadOrder in THREAD_ORDERS ? threadOrder : "said";
    // Conversations go by project unless you turned it off.
    this.threadGroup = p.get("spaces.threadGroup") !== "off";
    this.shelvesOpen = new Set(p.json("spaces.shelvesOpen", []));
    this.custom = p.json("spaces.custom", {});
    const view = p.get("spaces.view");
    this.view = view in VIEWS ? view : "spaces";
    this.sectionsFolded = new Set(p.json("spaces.sections", []));
    this.since = p.json("spaces.since", {});
  }

  // Without the switch the rail shows spaces whatever was chosen; work runs for this view only.
  shownView() {
    return this.showSwitch === false ? "spaces" : this.view;
  }

  // One-time fixes from older versions, out of render: drawing never changes state.
  migrate() {
    const collapsed = shared("sidebar.collapsed") === true;
    // Open the rail once so search is on the same row as +, not buried under the lights.
    if (shared("kanso.row") !== 3) {
      setShared("kanso.row", 3);
      setShared("sidebar.collapsed", false);
      setRail(true, SIDEBAR_W);
      return;
    }
    // Applied on every start, so older layouts are brought in line.
    if (collapsed) setRail(false, collapsedW());
    else setRail(true, shared("sidebar.width") ?? SIDEBAR_W);
  }

  openRail() {
    const width = shared("sidebar.width") ?? SIDEBAR_W;
    this.lastWide = width;
    setShared("sidebar.collapsed", false);
    setRail(true, width);
  }

  // Remembers how wide you left it open (`width`, when known), to open it the same width.
  foldRail(width) {
    if (width != null) setShared("sidebar.width", Math.round(width));
    setShared("sidebar.collapsed", true);
    setRail(false, collapsedW());
  }

  // Herdr sizes the sidebar as its edge is dragged. Only a drag reaches OPEN_MIN to SNAP_W (a stale tree jumps to the
  // rail's width), and only once it was seen wide since it opened: there it folds, to open again at the width you had.
  // The width you had is the last one held a moment (HELD_MS): a drag's sizes come a frame apart.
  sized(w, cx, now = Date.now()) {
    const was = this.width ?? SIDEBAR_W;
    const open = shared("sidebar.collapsed") !== true;
    if (open && this.width != null && was >= SNAP_W && now - (this.sizedAt ?? 0) >= HELD_MS) this.lastWide = Math.round(was);
    this.width = w;
    this.sizedAt = now;
    if (!open) { this.seenWide = false; return; }
    if (w >= SNAP_W) this.seenWide = true;
    else if (this.seenWide && w >= OPEN_MIN - 1) {
      this.seenWide = false;
      this.foldRail(this.lastWide ?? null);
    }
    if ((was < ONE_LINE_W) !== (w < ONE_LINE_W)) cx?.notify();
  }

  checkNew(cx) {
    if (this.sleepWork && (shared("kanso.sleep.kick") ?? 0) > this.sleepWork.kicked) this.sleepWork.start(cx);
    const now = Date.now();
    const active = window().active;
    if (!active && now - (this.lastLook ?? 0) < 5000) return;
    this.lastLook = now;
    this.takeMoves();
    const projects = registry();
    if (!sameProjects(projects, this.projectsSeen)) { this.projectsSeen = projects; cx.notify(); }
    this.trackFocus();
    const sp = visibleSpaces(spaces(), this.offNames());
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
    if (now - (this.trackedAt ?? -Infinity) < 2000) return;
    this.trackedAt = now;
    const ps = panes();
    this.trackAgents(now, sp, cx);
    this.trackReturn(sp, ps, active, now, cx);
    // Each agent's name is its conversation's title: read every minute, every 15 s while Threads shows in front.
    if (now - (this.threadsAt ?? 0) > (this.view === "threads" && active ? 15000 : 60000)) this.refreshThreads(cx);
    this.checkAlive(cx, now, active);
    this.keepSeen(now);
    // Git shows on space rows only: the Agents and Threads views don't ask.
    const due = this.due(now, sp, ps, placesOf(sp, ps), active);
    if (due.size && this.shownView() === "spaces") this.refreshGit(due, cx);
    if (now - (this.prunedAt ?? 0) > 30000) { this.prunedAt = now; this.prune(sp, now); }
  }

  trackReturn(sp, ps, active, now, cx) {
    if (this.sinceLeft.busy) return;
    const background = this.background();
    const allowed = activePlaces(sp, ps, background.sleeps, background.layouts, home());
    const off = this.offNames();
    const focus = focused(), list = visibleAgents(agents(), off).filter((a) => allowed.has(a.space)), rawTerms = visibleAgents(terminals(), off).filter((k) => background.allows(k.address));
    const signature = returnSignature(list, rawTerms, sp, ps, this.seenNow, this.panel.agents);
    const changed = signature !== this.returnSignature;
    const terms = changed ? new Map(rawTerms.map((term) => [term.address, term])) : null;
    const live = changed ? observedAgents(list, ps, sp, rawTerms) : [];
    const snapshots = changed ? live.map((agent) => {
      const snapshot = agentSnapshot(agent, this.seenNow?.get(agent.address), terms.get(agent.address), projectKey(sp.find((space) => space.id === agent.space)));
      const assigned = this.panel.agents.get(parseTarget(snapshot.source).id)?.project;
      return { ...snapshot, project: assigned ?? snapshot.project };
    }) : undefined;
    const targets = changed ? new Map(live.map((agent, index) => [agent.address, snapshots[index].value.target])) : this.returnTargets;
    const project = active && focus ? sp.find((space) => space.id === focus.space && allowed.has(space.id)) : null;
    const pr = shared("kanso.pr.seen");
    const seenTarget = pr && pr.at > (this.prSeenAt ?? 0) ? targetOf("pr", pr.url) : null;
    this.sinceLeft.update({ project: project ? projectKey(project) : null, target: targets?.get(focus?.terminal) ?? null, seenTarget, snapshots, now }, cx).then(() => {
      this.returnSignature = signature;
      this.returnTargets = targets;
      if (pr) this.prSeenAt = pr.at;
    }).catch(() => {});
  }

  returnRows(t, space) {
    if (!space || !this.sinceLeft?.rows.length || this.sinceLeft.project !== projectKey(space)) return [];
    const view = this.sinceLeft.render(t, projectKey(space), (key, go) => this.navMark(key, go), (row) => this.jumpReturn(row));
    return [item(view, this.sinceLeft.lineCount() * H.control + G.sm)];
  }

  jumpReturn(row) {
    const { kind, id } = parseTarget(row.target);
    const destinations = {
      pr: () => commitLayout({ panel: { id: "pr", type: "block", content: { mod: "kanso-panel", props: { panel: "pr", url: id, at: Date.now() } } } }),
      sleep: () => wakeRow(id),
      agent: () => this.focusReturnAgent(row.target),
    };
    return Object.hasOwn(destinations, kind) ? destinations[kind]() : false;
  }

  focusReturnAgent(target) {
    const terms = new Map(terminals().map((term) => [term.address, term]));
    const agent = observedAgents(agents(), panes(), spaces(), [...terms.values()]).find((a) => agentTargets(a, this.seenNow?.get(a.address), terms.get(a.address)).includes(target));
    if (!agent) return false;
    run("agent.focus", { terminal: agent.address });
  }

  // `seen` goes to the database; each name goes to shared "kanso.names" (Sleep keeps it),
  // other windows' names left as they are while their terminals live.
  keepSeen(now) {
    const seen = this.seenNow;
    if (!seen) return;
    if (this.panelReady) {
      if (!sameSeen(this.remembered, seen) && now - (this.rememberedAt ?? -Infinity) >= 10000) {
        this.remembered = seen;
        this.rememberedAt = now;
        this.panel.remember(seen, this.seenAt ?? now);
      }
      // A name a wake could not put back on its new terminal: put back now, every 30 s until it is.
      if (this.panel.toRestore(seen).length && now - (this.restoredAt ?? 0) > 30000) {
        this.restoredAt = now;
        // Checked again just before: the same conversation still runs there, still without a name.
        this.panel.reloadAgents().then(() => {
          const terms = new Map(terminals().map((k) => [k.address, k]));
          for (const x of this.panel.toRestore(this.seenNow ?? seen)) {
            const k = terms.get(x.terminal), th = this.threads?.[x.terminal];
            if (k && !k.labels?.[NAME_LABEL] && readNow(th, k, this.alive) && conversationOfThread(th) === x.conversation) label(x.terminal, NAME_LABEL, x.name);
          }
        }).catch(() => {});
      }
    }
    // A start that could not read the database tries again, every 30 s.
    else if (now - (this.panelTried ?? 0) > 30000) {
      this.panelTried = now;
      this.panel.load().then((changed) => { if (changed) this.applyPrefs(); this.panelReady = true; }).catch(() => {});
    }
    const live = new Set(terminals().map((k) => k.address));
    const cur = shared("kanso.names") ?? {};
    const next = {
      ...Object.fromEntries(Object.entries(cur).filter(([k]) => live.has(k))),
      ...Object.fromEntries([...seen].map(([k, v]) => [k, v.name])),
    };
    if (JSON.stringify(next) !== JSON.stringify(cur)) setShared("kanso.names", next);
    // A project set while only the terminal's id was known goes with the conversation too, once known.
    for (const [address, x] of seen) {
      if (!x.conversation || x.conversation.startsWith("term:")) continue;
      const k = this.termBy?.get(address), termKey = k?.labels?.[ID_LABEL] ? `term:${k.labels[ID_LABEL]}` : null;
      const byTerm = termKey ? this.panel?.agents.get(termKey) : null;
      // The later choice wins, a clearing ("back to where it runs") too.
      if (byTerm?.projectAt && byTerm.projectAt > (this.panel.agents.get(x.conversation)?.projectAt ?? 0)) this.panel.setProject(x.conversation, byTerm.project, byTerm.projectAt);
    }
    // Each agent's project, for its menu (another view) to show.
    const projects = Object.fromEntries([...(this.panel?.agents ?? [])].filter(([, v]) => v?.project).map(([key, v]) => [key, v.project]));
    if (JSON.stringify(projects) !== JSON.stringify(shared("kanso.projects") ?? {})) setShared("kanso.projects", projects);
    this.nameTerminals(seen);
  }

  // Asked from a menu (another view) through shared state, done here where the database is held; each ask once, by its stamp.
  takeMoves() {
    if (!this.panelReady) return;
    const asks = (Array.isArray(shared("kanso.move")) ? shared("kanso.move") : []).filter((x) => x?.address && x.n > (this.movedN ?? 0));
    if (!asks.length) return;
    this.movedN = Math.max(...asks.map((x) => x.n));
    for (const ask of asks) for (const key of this.keysOf(ask.address)) this.panel.setProject(key, ask.project ?? null, Math.floor(ask.n));
  }
  // Both keys of one agent: its conversation (when known) and its terminal's own id.
  keysOf(address) {
    const k = this.termBy?.get(address) ?? terminals().find((x) => x.address === address);
    return [...new Set([agentKey(this.threads?.[address], k, this.alive), k?.labels?.[ID_LABEL] ? `term:${k.labels[ID_LABEL]}` : null].filter(Boolean))];
  }

  // Labels are written only when they change, so any agent of any model finds them with Herdr alone;
  // a label just sent is not sent again while Herdr's list catches up.
  nameTerminals(seen) {
    const off = this.offNames();
    const sp = visibleSpaces(spaces(), off);
    const spaceName = (id) => sp.find((w) => w.id === id)?.name ?? null;
    const shown = new Map([...seen].filter(([address]) => !off.has(machineOf(address))).map(([address, v]) => [address, { name: v.name, project: spaceName(v.space) }]));
    const terms = terminals();
    const names = terminalNames(terms, shown, (k) => spaceName(k.labels?.["herdr.space"]));
    const byAddress = new Map(terms.map((k) => [k.address, k]));
    const now = Date.now();
    // A write not seen in Herdr's list is tried again after RETRY_MS; one sent for a gone terminal is
    // forgotten at once, so an address given to a new terminal is named again.
    const wants = new Map([...names].map(([address, { name, project }]) => [address, { [SHOWN_LABEL]: name, [PROJECT_LABEL]: project ?? "" }]));
    const sent = new Map([...(this.labelsSent ?? [])].filter(([address, x]) => wants.has(address) && now - x.at < RETRY_MS));
    const due = [...wants].filter(([address, want]) => {
      const has = byAddress.get(address)?.labels ?? {};
      const missing = Object.entries(want).some(([key, value]) => (has[key] ?? "") !== value) || !has[ID_LABEL];
      return missing && JSON.stringify(sent.get(address)?.want) !== JSON.stringify(want);
    });
    this.labelsSent = new Map([...sent, ...due.map(([address, want]) => [address, { want, at: now }])]);
    for (const [address, want] of due) this.labelTerminal(address, want, byAddress.get(address));
  }

  // Its own id is derived (address + when Herdr made it), so every window writes the same one and a reused address gets another.
  async labelTerminal(address, want, terminal) {
    const id = terminal?.labels?.[ID_LABEL], made = terminal?.created_ms;
    const own = id ?? (made ? `${address}-${made}` : null);
    const pairs = Object.entries({ ...want, ...(own && !id ? { [ID_LABEL]: own } : {}) }).map(([key, value]) => `${key}=${value}`);
    await hc(["label", address, ...pairs]).catch(() => {});
  }

  // Trimmed to what still exists, so a day of spaces coming and going leaves nothing behind.
  prune(sp, now) {
    const ids = new Set(sp.map((s) => s.id));
    const places = new Set(Object.values(this.at ?? {}));
    for (const k of Object.keys(this.git)) if (!places.has(k)) { delete this.git[k]; delete this.checked[k]; this.unsure.delete(k); }
    for (const id of Object.keys(this.born)) if (!ids.has(id)) delete this.born[id];
    for (const id of Object.keys(this.foldH)) if (!ids.has(id)) delete this.foldH[id];
    for (const id of [...this.shown]) if (!ids.has(id)) this.shown.delete(id);
    if (this.tidying) for (const [k, at] of this.tidying) if (now - at > 10000) this.tidying.delete(k);
  }

  // The done agent you are looking at stays in Done until you leave it.
  trackFocus(list = null) {
    const address = list ? list.find((a) => a.focused)?.address : focused()?.terminal;
    if ((address ?? null) === (this.held?.address ?? null)) return;
    const cur = (list ?? agents()).find((a) => a.address === address);
    this.held = cur ? { address, done: cur.status === "done" || this.lastSeen?.[address] === "done" } : null;
  }

  trackAgents(now, sp, cx) {
    const background = this.background();
    const list = visibleAgents(agents(), this.offNames()).filter((a) => background.allows(a.address, this.threads?.[a.address]));
    const tabs = new Map(sp.flatMap((s) => s.tabs ?? []).map((tb) => [tb.id, tb]));
    const next = track(this.since, list, now, (id) => tabs.get(id));
    // An agent came or went: read the conversations now, so it shows by its name at once rather than in a minute.
    const sig = list.map((a) => a.address).toSorted().join(" ");
    if (sig !== this.agentSig) { this.agentSig = sig; this.threadsAt = 0; }
    this.trackFocus(list);
    this.lastSeen = Object.fromEntries(list.map((a) => [a.address, a.status]));
    const terms = new Map(terminals().map((k) => [k.address, k]));
    this.tidyLabels(list, now, terms);
    const steps = trackSteps(this.steps, list.map((a) => { const k = terms.get(a.address); return { address: a.address, status: a.status, msg: k?.report?.msg, status_ms: k?.status_ms }; }), now);
    if (steps) this.steps = steps;
    if (!next) { if (steps) cx.notify(); return; }
    // A turn ended or began: what was said changed.
    if (this.view === "threads") this.threadsAt = 0;
    this.since = next;
    this.panel.set("spaces.since", next);
    cx.notify();
  }

  // Each label goes once: `tidying` holds it until herdr-core echoes the change.
  tidyLabels(list, now, terms) {
    this.tidying ??= new Map();
    for (const a of list) {
      const k = terms.get(a.address), l = k?.labels ?? {};
      const drop = (key) => { const id = `${a.address}:${key}`; if (now - (this.tidying.get(id) ?? 0) < 3000) return; this.tidying.set(id, now); label(a.address, key); };
      if (a.focused && isUnread(l)) drop(UNREAD_LABEL);
      if (a.focused && l[FROM_LABEL]) drop(FROM_LABEL);
      if (a.focused && woke({ labels: l }, now)) drop(SNOOZE_LABEL);
      if (backFromSettled({ ...a, labels: l, turn: k?.turn })) drop(SETTLED_LABEL);
    }
  }

  due(now, sp, ps, places, active) {
    // Moved there: what it knew of that place may be old.
    const all = [...this.pollingPlaces(sp, ps, places)];
    const at = Object.fromEntries(all.map(([id, { key }]) => [id, key]));
    const found = all.filter(([, { cwd }]) => cwd);
    const keys = new Set(found.map(([, { key }]) => key)), onOf = new Map(found.map(([, { key, on }]) => [key, on]));
    const fresh = [...keys].filter((k) => !(k in this.git));
    const moved = Object.entries(at).filter(([id, k]) => this.at[id] && this.at[id] !== k && keys.has(k)).map(([, k]) => k);
    this.at = at;
    const spaceOf = Object.fromEntries(sp.flatMap((s) => (s.tabs ?? []).map((t) => [t.id, s])));
    // A command or a turn that just ended: its place, and the rest of its repo.
    const looked = ps.filter((p) => p.terminal && spaceOf[p.tab]).map((p) => ({ p, busy: p.status === "working" || !(p.program?.shell || p.program?.agent) }));
    const ended = looked.filter(({ p, busy }) => this.busy[p.pane] && !busy).flatMap(({ p }) => this.sameRepo(at[spaceOf[p.tab].id], keys));
    this.busy = Object.fromEntries(looked.map(({ p, busy }) => [p.pane, busy]));
    const back = machines().flatMap((m) => {
      const ready = m.layout === "ready", was = this.ready[m.name];
      this.ready[m.name] = ready;
      return ready && was === false ? [...keys].filter((k) => onOf.get(k) === m.name) : [];
    });
    const stale = active ? [...keys].filter((k) => {
      const asks = this.git[k] || this.unsure.has(k);
      return asks && !this.folded.has(onOf.get(k)) && now - (this.checked[k] ?? 0) > FALLBACK;
    }) : [];
    return new Set(pollKeys([...fresh, ...moved, ...ended, ...back, ...stale], this.offNames()));
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  offNames() { return heldNames(this.parked ?? []); }

  phaseOf(name, layouts = null) {
    const layout = (layouts ?? machines()).find((row) => row.name === name)?.layout ?? null;
    return machinePhase({
      name, stored: this.parked ?? [], live: this.machines ?? [], layout,
      asking: this.waking?.has(name) ?? false, login: this.login?.has(name) ?? false, failed: this.failed?.has(name) ?? false,
    });
  }

  async readMachines() {
    const result = await hc(["machine", "ls", "--json"]);
    if (result.code !== 0) return;
    this.machines = (JSON.parse(result.stdout).machines ?? []).filter((row) => !row.temporary);
    await this.settleParked();
  }

  async settleParked() {
    const done = connectedNames(this.parked ?? [], this.machines ?? []);
    if (done.length) {
      const drop = new Set(done);
      this.parked = (this.parked ?? []).filter((row) => !drop.has(row.name));
      for (const name of done) {
        this.clearFlags(name);
        await this.db().forgetMachine(name).catch(() => {});
      }
    }
    for (const row of this.parked ?? []) {
      const live = (this.machines ?? []).find((item) => item.name === row.name);
      if (live?.state !== "needs_login") continue;
      this.login.add(row.name);
      this.waking.delete(row.name);
    }
  }

  // One look at a time: a herdr-core that hangs must not stack them up.
  refreshMachines(cx, repeat = false) {
    if (this.machinesBusy || repeat && ![...(this.machines ?? []), ...(this.parked ?? []), ...machines()].some((row) => row.name)) return;
    this.machinesBusy = true;
    cx.spawn(async (cx) => {
      try { await this.readMachines(); } catch { /* the last list stands */ }
      finally { this.machinesBusy = false; }
      cx.notify();
    });
  }

  setPower(name, on, cx) {
    if (!name || this.powerBusy?.has(name)) return;
    if (on) this.turnOn(name, cx);
    else this.turnOff(name, cx);
  }

  clearFlags(name) {
    this.login.delete(name);
    this.failed.delete(name);
    this.waking.delete(name);
  }

  async unpark(name) {
    this.parked = (this.parked ?? []).filter((row) => row.name !== name);
    await this.db().forgetMachine(name).catch(() => {});
  }

  // hc machine rm forgets it here; work already running there keeps running.
  turnOff(name, cx) {
    const live = (this.machines ?? []).find((row) => row.name === name) ?? null;
    const had = (this.parked ?? []).find((row) => row.name === name) ?? null;
    const record = machineRecord(live) ?? had;
    if (!canRestore(record)) return;
    this.parkRev = (this.parkRev ?? 0) + 1;
    const rev = this.parkRev;
    this.powerBusy.add(name);
    this.clearFlags(name);
    this.parked = [...(this.parked ?? []).filter((row) => row.name !== name), record];
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.db().parkMachine(record);
        if (!live || (this.parkRev ?? 0) !== rev) return;
        const result = await hc(rmArgs(name));
        if ((this.parkRev ?? 0) !== rev || result.code === 0) return;
        await this.unpark(name);
      } catch {
        if (live && (this.parkRev ?? 0) === rev) await this.unpark(name);
      } finally {
        this.powerBusy.delete(name);
        cx.notify();
      }
    });
  }

  turnOn(name, cx) {
    const record = (this.parked ?? []).find((row) => row.name === name);
    if (!canRestore(record)) return;
    this.powerBusy.add(name);
    this.clearFlags(name);
    this.waking.add(name);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await hc(addArgs(record)).catch((error) => ({ code: 1, stdout: "", stderr: String(error) }));
        const why = hcError(result);
        if (!why) { await this.readMachines().catch(() => {}); return; }
        this.waking.delete(name);
        if (needsLogin(why)) this.login.add(name);
        else this.failed.add(name);
      } finally {
        this.powerBusy.delete(name);
        cx.notify();
      }
    });
  }

  retryMachine(name, cx) {
    const parked = (this.parked ?? []).some((row) => row.name === name);
    const listed = (this.machines ?? []).some((row) => row.name === name);
    if (parked && !listed) this.turnOn(name, cx);
    else this.refreshMachines(cx);
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
      const keys = new Set([...this.pollingPlaces().values()].map((place) => place.key));
      const used = new Set(Object.entries(this.git).filter(([key, value]) => keys.has(key) && value).map(([, value]) => value).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    if (on && this.offNames().has(on)) return;
    if (![...this.pollingPlaces().values()].some((place) => place.key === key)) return;
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
      const lines = r.stdout.split("\n");
      const head = lines.findLast((line) => line.startsWith("# branch.head "));
      const ab = lines.findLast((line) => line.startsWith("# branch.ab "));
      const [a, b] = ab ? ab.slice(12).split(" ") : [];
      this.git[key] = {
        name, branch: head ? head.slice(14) : null,
        ahead: ab ? Math.abs(parseInt(a, 10)) || 0 : 0, behind: ab ? Math.abs(parseInt(b, 10)) || 0 : 0,
        repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git`,
      };
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
          const keys = [...this.pollingPlaces().values()].filter((place) => this.git[place.key]?.repo === mine).map((place) => place.key);
          if (!keys.length) this.watching.delete(repo);
          else if (this.watching.has(repo)) this.refreshGit(keys, cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // A popup is as tall as its items; height is only the most.
  menu(w) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 460, at: "pointer", props: { spaceMenu: { id: w.id } } });
  }

  // A project that sleeps whole has no space left: it stays in Projects as a quiet row of its own.
  asleepProjects(ctx) {
    const rows = ctx.asleep.rows.filter((a) => !a.space);
    return [...new Set(rows.map((a) => a.asleep.from))].map((key) => [key, rows.filter((a) => a.asleep.from === key)]);
  }

  // The projects on machine `m` with no space open: the ones you added, and places asleep whole. Each with what sleeps in it.
  closedOn(m, ctx) {
    const asleep = this.asleepProjects(ctx).filter(([key]) => key.slice(0, key.indexOf(":")) === (m ?? ""));
    const added = closedProjects(ctx.registry.filter((p) => (p.machine || null) === (m ?? null)), ctx.spaces, home());
    const keys = [...new Set([...added.map(keyOfProject), ...asleep.map(([key]) => sameKey(key))])];
    return keys.map((key) => ({ key, project: added.find((p) => keyOfProject(p) === key) ?? null, list: asleep.filter(([k]) => sameKey(k) === key).flatMap(([, list]) => list) }));
  }

  closedName({ key, project, list }, names) {
    return project ? names.get(project.id) ?? project.name : list[0]?.asleep.spaceName || folderName(key.slice(key.indexOf(":") + 1));
  }

  closedRow(t, { key, project, list }, names, group = null) {
    const name = this.closedName({ key, project, list }, names);
    const open = () => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 420, at: "pointer", props: { spaceMenu: { key } } });
    const missing = Boolean(project?.missing);
    const go = (cx) => { if (group) this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx); else open(); };
    const row = h_flex().id(`closed-project-${key}`).h(rowHeight({ tree: null })).flex_none().px(8).gap(9).items_center().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.foreground + "0c"))
      .on_hover((h, cx) => { if (h ? this.hoverSpace !== key : this.hoverSpace === key) { this.hoverSpace = h ? key : null; cx.notify(); } })
      .when(this.navMark(`asleep-project:${key}`, go), (el) => el.border_1().border_color(t.accent))
      .on_click((_e, cx) => { go(cx); cx.notify(); })
      .on_mouse_down("right", open)
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().text_color(missing ? t.dim : t.muted).child(name))
      .when(missing, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Folder not found")))
      .when(list.length > 0 && !group, (el) => el.child(svg("mods/kanso-chrome/icons/moon.svg").size(13).flex_none().text_color(t.dim)))
      .when(Boolean(group), (el) => el.children(this.asleepTail(t, group)))
      .when(this.hoverSpace === key, (el) => el.child(this.dots(`asleep-dots-${key}`, t, open)))
      .when(!missing, (el) => el.child(this.plus(`closed-plus-${key}`, t, placeOfKey(key, project))));
    return row;
  }

  closedRail(t, c, names, ctx) {
    const name = this.closedName(c, names);
    const rows = c.list.map((a) => this.railRow(a, null, ctx.now));
    const menu = () => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 420, at: "pointer", props: { spaceMenu: { key: c.key } } });
    return this.railMark(t, `rail-closed-${c.key}`, { lead: this.railInitial(name, t.muted), rows, tip: name, menu });
  }

  asleepOpenOf(id) {
    this.asleepOpen ??= new Set();
    return this.asleepOpen.has(id);
  }

  toggleAsleep(id, open, cx) {
    this.asleepOpen ??= new Set();
    if (open) this.asleepOpen.delete(id); else this.asleepOpen.add(id);
    if (cx?.timer) this.toggleFold(`asleep-${id}`, !open, cx);
  }

  sleepAct(id, how, cx) {
    const go = async (cx) => {
      try {
        if (how === "undo") releaseHide(id, shared, setShared);
        if (isAway(id)) { await this.loadAsleep(); return; }
        const ok = await this.leftNavStore()[how](id);
        if (ok) { setShared("kanso.sleep.kick", Date.now()); this.sleepWork?.start(cx); }
        await this.loadAsleep();
      } catch { /* the row stays as it is */ }
    };
    if (cx?.spawn) cx.spawn(go); else go(cx);
  }

  sleepButtons(t, ids, { retry = true } = {}) {
    const btn = (id, how, icon, tip) => div().id(`asleep-${how}-${id}`).size(22).flex_none().rounded(6)
      .flex().items_center().justify_center().text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.sleepAct(id, how, cx); })
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(13));
    return (ids ?? []).flatMap((id) => [btn(id, "undo", "undo", "Undo"), ...(retry ? [btn(id, "retry", "refresh", "Retry")] : [])]);
  }

  asleepMark(t, group) {
    const moon = stateMark(t, "asleep");
    if (!moon || !group) return moon;
    return goingOf(group) ? breathe(moon.id(`asleep-going-${group.id}`)) : moon;
  }

  asleepTail(t, group, { mark = true, count = true } = {}) {
    if (!group) return [];
    const why = group.why ? div().id(`asleep-why-${group.id}`).max_w(140).flex_none().truncate().text_size(11).text_color(t.dim).child(group.why) : null;
    return [
      ...(mark ? [this.asleepMark(t, group)] : []),
      ...(count ? [div().id(`asleep-n-${group.id}`).flex_none().text_size(11).text_color(t.dim).child(String(group.rows.length))] : []),
      why,
      ...this.sleepButtons(t, group.stuck),
      ...(goingOf(group) ? this.sleepButtons(t, group.going, { retry: false }) : []),
    ].filter(Boolean);
  }

  asleepHead(t, group, { name = null, pad = AGENT_PAD } = {}) {
    const open = this.asleepOpenOf(group.id);
    const label = name || group.name || "Asleep";
    const row = h_flex().id(`asleep-group-${group.id}`).h(32).flex_none().pl(pad).pr(12).gap(9).items_center().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.foreground + "0c"))
      .when(this.navMark(`asleep:${group.id}`, (cx) => this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx)), (el) => el.border_1().border_color(t.accent))
      .on_click((_e, cx) => { this.toggleAsleep(group.id, open, cx); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_medium().text_color(t.muted).child(label))
      .children(this.asleepTail(t, group));
    return row;
  }

  asleepAgents(group, t, ctx, indent = 0) {
    this.foldH ??= {};
    const open = this.asleepOpenOf(group.id);
    const id = `asleep-${group.id}`;
    if (!this.unfolded(id, open, ctx.now)) return { els: [], h: 0 };
    const drawn = group.rows.map((a) => {
      const more = this.more({ a, lines: [] }, ctx);
      return { h: agentRowH(a, more), el: agentRow(a, indent, t, this.navRow(a, this.rowFor(a)), more) };
    });
    const h = drawn.reduce((n, r) => n + r.h + 1, 0);
    return { els: this.foldBox(id, open, drawn.map((r) => r.el), ctx.now), h: Math.max(0, h - 1) };
  }

  asleepStatus(s, t, ctx) {
    const tops = s.entries.filter((e) => !e.lines.length);
    return [...Map.groupBy(tops, (e) => e.a.space ?? e.a.asleep?.from ?? "asleep")].flatMap(([key, list]) => {
      const g = asleepGroups(list.map((e) => e.a), { key }).groups[0];
      if (!g) return [];
      const name = list[0].a.space_name || this.zzProject(list[0].a, t).name;
      const agents = this.asleepAgents(g, t, ctx, FLUSH);
      const box = agents.els.map((el) => ({ focused: false, rh: this.asleepOpenOf(g.id) ? ((this.foldH ?? {})[`asleep-${g.id}`] ?? agents.h) : 0, el }));
      return [{ focused: false, rh: 32, el: this.asleepHead(t, g, { name, pad: AGENT_PAD + FLUSH }) }, ...box];
    });
  }

  zzProject(a, t) {
    const key = a.asleep.from;
    return { name: a.asleep.spaceName || key.slice(key.indexOf(":") + 1).split("/").at(-1) || "~", fill: t.muted };
  }

  sleepingNow(sp, terms) {
    const asleep = shared("kanso.asleep") ?? [], away = shared("kanso.sleep.away"), here = home();
    const signature = sleepingSignature(sp, terms, asleep, away, here);
    if (signature !== this.sleepingSignature) {
      this.sleepingRows = sleepingNow(sp, terms, withAway(asleep, away), () => here);
      this.sleepingSignature = signature;
    }
    return this.sleepingRows;
  }

  // Each sleeping row goes back at the place it had, so it stays where it was.
  spaceRows(id, ctx) {
    const mine = orderSessions(this.inStripOrder(ctx.all.filter((a) => this.projectFor(a, ctx) === id), ctx.strip), this.order, this.custom[id] ?? []);
    const zz = ctx.asleep.rows.filter((a) => a.space === id).toSorted((x, y) => (x.asleep.at ?? 1e9) - (y.asleep.at ?? 1e9) || x.asleep.saved - y.asleep.saved);
    return zz.reduce((rows, a) => rows.toSpliced(Math.min(a.asleep.at ?? rows.length, rows.length), 0, a), mine);
  }

  // Asked by both its keys (conversation and terminal id), so a moment when the conversation can't be read doesn't move it back.
  projectFor(a, ctx) {
    const k = this.termBy?.get(a.address);
    const keys = [agentKey(this.threads?.[a.address], k, this.alive), k?.labels?.[ID_LABEL] ? `term:${k.labels[ID_LABEL]}` : null].filter(Boolean);
    const set = latestChoice(keys.map((key) => this.panel?.agents.get(key)))?.project;
    return set && ctx.spaceIds?.has(set) ? set : a.space;
  }

  nameOf(a) {
    const k = this.termBy?.get(a.address), th = shownThread(this.threads?.[a.address], k, this.alive);
    const c = th ? conversationOfThread(th) : null;
    return nameOf(a, th, c ? this.panel?.agents.get(c) : null);
  }

  seen(sp, ctx) { return seenNow(sp, ctx, this.threads, this.panel?.agents ?? new Map(), (a) => this.nameOf(a), this.since ?? {}); }

  zzActions(a) {
    return a.asleep.busy ? [] : [{ id: "wake", icon: "sun", tip: "Wake", act: () => wakeRow(a.asleep.id) }];
  }

  // Each item() adds itself to menuActs as it draws: the keyboard walks the items in screen order.
  menuFrame(t) {
    return v_flex().id("spaces-menu").track_focus(this.handle).w_full().p(5).gap(1).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const { move, gAt } = listKey(e, this.menuG);
        this.menuG = gAt;
        if (!move) return;
        const acts = this.menuActs ?? [];
        if (move === "escape") closeOverlay(props().overlay);
        else if (move === "enter") acts[this.menuAt]?.(cx);
        else this.menuAt = moveTo(move, this.menuAt, acts.length);
        if (this.menuScroll && this.menuAt < this.menuScroll.count) this.menuScroll.handle.scroll_to_item(this.menuAt);
        cx.stop_propagation();
        cx.notify();
      });
  }

  // A popup's rows from the start: the keyboard's list emptied, and the row maker for this theme.
  items(t) {
    this.menuActs = [];
    return (id, text, act, opts) => this.menuItem(t, id, text, act, opts);
  }

  // One line of a popup: added to menuActs as it draws, so the keyboard walks them in screen order.
  // One activation for the keyboard and the mouse: the act, then the popup closes unless `keep`.
  menuItem(t, id, text, act, opts = {}) {
    const at = this.menuActs.length;
    const go = (cx) => { act(cx); if (!opts.keep) closeOverlay(props().overlay); };
    this.menuActs = [...this.menuActs, go];
    return this.menuRow(t, id, text, at, go, opts);
  }

  // The row itself, at its place `at` in the keyboard's order; `go` runs on a click (none in a virtual list).
  // `lead`: an element in the icon's place (a rail list's state marks).
  menuRow(t, id, text, at, go, { icon = null, lead = null, hint = null, ink = t.foreground, badge = null } = {}) {
    return h_flex().id(`menu-${id}`).flex_none().h(MENU_ROW).px(8).gap(10).items_center().rounded(6).cursor_pointer().text_size(13).text_color(ink)
      .when(at === this.menuAt, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      // A row of a virtual list takes no handler of its own (registering one there throws): its list's on_item_click acts.
      .when(Boolean(go), (el) => el.on_click((_e, cx) => { go(cx); cx.notify(); }))
      .child(h_flex().w(14).flex_none().justify_center().when(Boolean(icon), (el) => el.child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14).text_color(t.muted))).when(Boolean(lead), (el) => el.child(lead)))
      .child(div().flex_1().truncate().child(text))
      .when(Boolean(badge), (el) => el.child(div().flex_none().px(6).h(18).rounded_full().bg(t.accent + "26")
        .flex().items_center().text_size(11).font_semibold().text_color(t.accent).child(badge)))
      .when(Boolean(hint), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(hint)));
  }

  menuTitle(t, text) { return div().h(26).pl(32).flex().items_center().text_size(11.5).text_color(t.dim).child(text); }

  // Opens a worktree's folder: where something already runs there it is shown; else a shell starts there.
  openTree(place, x) {
    // A pane's machine is its space's (panes don't name one).
    const machineOf = new Map(spaces().flatMap((w) => (w.tabs ?? []).map((tb) => [tb.id, w.machine ?? ""])));
    const p = panes().find((k) => k.cwd && (k.cwd === x.path || k.cwd.startsWith(`${x.path}/`)) && (machineOf.get(k.tab) ?? "") === (place.machine ?? ""));
    if (p) run("pane.focus", { pane: p.pane });
    else openAt(place, x.path, null, x.branch);
  }

  worktreeDialog(place) {
    openOverlay({ mod: "kanso-spaces", kind: "dialog", width: 440, height: 230, props: { worktree: place } });
  }


  // A popup's write finishes before the popup closes: closed first, the write could be cut off with it.
  thenClose(write, after = () => {}) {
    Promise.resolve(write).then(() => publishRegistry(this.kdb)).catch(() => {})
      .finally(() => { after(); closeOverlay(props().overlay); });
  }

  // Removing a project you have open closes its space too (asked first, with how many tabs go), so it really goes.
  removeProject(project, w) {
    this.thenClose(project ? this.kdb.removeProject(project.id) : null, () => { if (w) run("space.close", { id: w.id }); });
  }

  spaceMenuView(t) {
    const m = props().spaceMenu;
    const w = m.id ? spaces().find((s) => s.id === m.id) : null;
    const key = w ? projectKey(w) : m.key;
    const place = this.menuPlace(m);
    const project = place?.project ? registry().find((p) => p.id === place.project) ?? null : null;
    const asleep = (shared("kanso.asleep") ?? []).filter((a) => (a.state == null || a.state === "asleep") && inPlace(a, { from: key, space: w?.id ?? null }, spaces(), home()));
    if (!w && !asleep.length && !project) return v_flex().id("spaces-menu").p(10).bg(t.popover).text_size(12.5).text_color(t.dim).child("Nothing here sleeps any more.");
    const item = this.items(t);
    const active = w?.tabs?.find((x) => x.active);
    const tabs = w?.tabs?.length ?? 0;
    const trees = this.trees ?? [];
    const home_ = trimmed(home()), base = trimmed(kansoWorktrees(place?.machine));
    const where = (path) => (base && path.startsWith(`${base}/`) ? "kans\u014d" : path.startsWith(`${home_}/`) ? `~/${path.slice(home_.length + 1).split("/").slice(-2).join("/")}` : path.split("/").slice(-2).join("/"));
    // Keeping it: a space's folder (not home) can be a project of yours.
    const keepable = Boolean(w && !project && w.folder && trimmed(w.folder) !== home_);
    return this.menuFrame(t)
      .when(asleep.length > 0, (el) => el
        .child(this.menuTitle(t, "Asleep"))
        .children(asleep.map((a, i) => item(`wake-${i}`, `Wake ${a.name}`, () => wakeRow(a.id), { icon: "sun", hint: since(a.saved) })))
        .when(asleep.length > 1, (el) => el.child(item("wake-all", `Wake all ${asleep.length}`, () => arrange({ wakeAll: { from: key, space: w?.id ?? null } }), { icon: "undo" }))))
      .when(Boolean(place) && !project?.missing, (el) => el
        .child(item("new-agent", "New agent\u2026", () => this.newAgentMenu(place), { icon: "plus" }))
        .child(item("new-worktree", "New agent in a worktree\u2026", () => this.worktreeDialog(place), { icon: "worktree" })))
      .when(trees.length > 0, (el) => el.child(this.menuTitle(t, "Worktrees"))
        .child(v_flex().id("tree-list").flex_none().h(Math.min(trees.length, 4) * 30).overflow_y_scrollbar()
          .children(trees.map((x, i) => item(`tree-${i}`, x.branch ?? "detached", () => this.openTree(place, x), { icon: "branch", hint: where(x.path) })))))
      .when(Boolean(active), (el) => el.child(item("sleep-tab", "Sleep this tab\u2026", () => sleepTab(w.id, active.id), { icon: "moon" })))
      .when((w?.tabs?.length ?? 0) > 1, (el) => el.child(item("sleep-project", "Sleep the whole project\u2026", () => sleepProject(w.id), { icon: "moon" })))
      .when(Boolean(w), (el) => el.child(item("space-options", "Project options\u2026", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } }), { icon: "settings" })))
      .when(keepable, (el) => el.child(item("keep-project", "Keep as a project", () => {
        this.thenClose(this.kdb.addProject({ name: folderName(w.folder), folder: trimmed(w.folder), machine: w.machine ?? "" }));
      }, { icon: "pin", keep: true })))
      .when(Boolean(project?.missing) && !project?.machine, (el) => el.child(item("locate", "Locate folder\u2026", () => {
        pickFolder({ prompt: "Use this folder" }).then((folder) => folder && this.kdb.relocateProject(project.id, trimmed(folder)))
          .catch((e) => notify({ title: "The folder was not changed", body: String(e?.message ?? e), level: "error" }))
          .finally(() => this.thenClose(null));
      }, { icon: "file", keep: true })))
      // Any project you see can go: one you added (its row too), or an open space you never kept.
      .when(Boolean(project) || Boolean(w), (el) => el.child(this.confirmClose
        ? item("remove-project", w ? `Click again: remove it and close its ${tabs} tab${tabs === 1 ? "" : "s"}` : "Click again to remove it", () => this.removeProject(project, w), { icon: "close", ink: t.blocked, keep: true })
        : item("remove-project", "Remove project", () => { this.confirmClose = true; }, { icon: "close", ink: t.muted, keep: true })));
  }

  // Every + ends here: which agent of the ones installed (or a shell), none chosen for you; the one used last
  // in the project says so. `place.tree`: a worktree just made, where the agent starts in its own tab.
  newAgentView(t) {
    const place = props().newAgent;
    const project = registry().find((p) => p.id === place.project) ?? null;
    if (!this.known) return v_flex().id("spaces-menu").p(10).bg(t.popover).text_size(12.5).text_color(t.dim).child("Looking for your agents\u2026");
    const item = this.items(t);
    const pick = (a) => {
      if (this.starting) return; // a second click while the first is written starts nothing
      this.starting = true;
      if (place.tree) openAt(place, place.tree.folder, a?.run ?? null, place.tree.branch);
      else startIn(place, a?.run ?? null);
      this.thenClose(project && a ? this.kdb.setProjectAgent(project.id, a.key) : null);
    };
    return this.menuFrame(t)
      .child(this.menuTitle(t, `New in ${place.tree?.branch ?? place.name ?? "this project"}`))
      .children(this.known.filter((a) => a.installed).map((a) => item(`agent-${a.key}`, a.name, () => pick(a), { hint: a.key === project?.agent ? "last" : null, keep: true })))
      .child(item("agent-shell", "Terminal", () => pick(null), { keep: true }))
      .when(!place.tree, (el) => el.child(div().mx(8).my(4).h(1).bg(t.border))
        .child(item("agent-worktree", "In a new worktree\u2026", () => this.worktreeDialog(place), { icon: "worktree" })));
  }

  makeWorktree(cx) {
    if (this.making) return;
    const place = props().worktree, branch = this.branch.value().trim();
    this.making = true;
    this.wtError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await addWorktree({ folder: place.folder, machine: place.machine || null, branch, base: kansoWorktrees(place.machine) });
        if (r.error) { this.wtError = r.error; return; }
        if (!r.made) notify({ title: `${branch} already had a worktree`, body: r.path, level: "info", timeout: 5000 });
        closeOverlay(props().overlay);
        // Then which agent starts in it, asked like every other start.
        this.newAgentMenu({ ...place, tree: { folder: r.path, branch } });
      } finally { this.making = false; cx.notify(); }
    });
  }

  worktreeView(t) {
    const place = props().worktree;
    const base = kansoWorktrees(place.machine);
    const shownBase = base ? base.replace(trimmed(home()), "~") : "~/.kanso/worktrees";
    const button = (id, text, act, primary) => div().id(id).h(28).px(12).flex().items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(primary, (el) => el.bg(t.accent).text_color(t.accent_foreground ?? t.background))
      .when(!primary, (el) => el.border_1().border_color(t.border).text_color(t.foreground))
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => act(cx))
      .child(text);
    return v_flex().id("worktree-dialog").size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (String(e.key).toLowerCase() === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(div().text_size(15).font_semibold().child(`New agent in a worktree of ${place.name ?? "this project"}`))
      .child(div().text_size(12).text_color(t.muted).child(`A new branch (or one you have), checked out in its own folder under ${shownBase}. The agent starts there.`))
      .child(div().h(32).flex_none().px(8).flex().items_center().rounded(6).border_1().border_color(this.wtError ? t.blocked : t.border)
        .child(Input.new(this.branch).flex_1().h_full().text_size(13)))
      .child(div().min_h(16).text_size(12).text_color(this.wtError ? t.blocked : t.dim).child(this.wtError ?? (this.making ? "Making the worktree\u2026" : "Enter to make it, Esc to cancel.")))
      .child(h_flex().gap(8).justify_end()
        .child(button("wt-cancel", "Cancel", () => closeOverlay(props().overlay), false))
        .child(button("wt-make", this.making ? "Making\u2026" : "Make worktree", (cx) => this.makeWorktree(cx), true)));
  }

  // Each worktree space moves under its main checkout's.
  ordered(sp, places) {
    const key = (w) => places.get(w.id).key;
    const ready = (w) => this.shown.has(w.id) || key(w) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[key(w)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const tops = list.filter((r) => !nested(r));
    // A repo's worktrees are listed under the first of its main checkout's spaces.
    const first = (r) => r.g && !r.g.linked && tops.find((x) => x.g && !x.g.linked && x.g.repo === r.g.repo) === r;
    const kidsOf = (r) => list.filter((k) => nested(k) && k.g.repo === r.g.repo).map((k, n, kids) => ({ ...k, tree: { last: n === kids.length - 1 } }));
    return tops.flatMap((r) => [{ ...r, tree: null }, ...(first(r) ? kidsOf(r) : [])]);
  }

  // The order the strip shows their panes, so the list reads like the screen.
  inStripOrder(list, strip) {
    const pos = (a) => { const ids = (strip[a.tab]?.cols ?? []).flatMap((c) => c.panes ?? []); const i = ids.indexOf(a.pane); return i < 0 ? 1e6 : i; };
    return list.map((a, i) => [a, i]).toSorted((x, y) => (x[0].tab_index - y[0].tab_index) || (pos(x[0]) - pos(y[0])) || (x[1] - y[1])).map(([a]) => a);
  }

  // Panes that share a strip column are held together in one soft slab, so the sidebar shows what is linked on screen.
  stacked(entries, mine, indent, t, space, ctx) {
    const colOf = ({ a }) => { if (this.order !== "screen" || a.pin != null || !a.pane) return null; const c = (ctx.strip[a.tab]?.cols ?? []).find((k) => k.panes?.includes(a.pane)); return c && c.panes.length > 1 ? `${a.tab}:${c.panes[0]}` : null; };
    // Runs of rows in one column; a row in none is a run of its own.
    const keys = entries.map(colOf);
    const starts = keys.flatMap((key, i) => (i === 0 || !keys[i - 1] || key !== keys[i - 1] ? [i] : []));
    const runs = starts.map((i, k) => {
      const rows = entries.slice(i, starts[k + 1] ?? entries.length).map((e) => { const m = this.more(e, ctx); return { a: e.a, h: agentRowH(e.a, m), el: agentRow(e.a, indent, t, this.navRow(e.a, e.a.asleep ? this.rowFor(e.a) : e.a.pane && !e.lines.length ? this.rowOf(e.a, mine, space) : null), m) }; });
      return { key: keys[i], rows, slab: keys[i] && rows.length > 1 };
    });
    // Down the rows: where each starts, 1px apart, a slab's touching, with 1px after it.
    const { y, focus, focusH } = runs.reduce((acc, run) => {
      const end = run.rows.reduce((s, r) => ({ y: s.y + r.h + (run.slab ? 0 : 1), focus: r.a.focused ? s.y : s.focus, focusH: r.a.focused ? r.h : s.focusH }), acc);
      return run.slab ? { ...end, y: end.y + 1 } : end;
    }, { y: 0, focus: null, focusH: 0 });
    const out = runs.flatMap((run) => (run.slab
      ? [v_flex().id(`stack-${run.key}`).flex_none().rounded(6).bg(t.foreground + "08").children(run.rows.map((r) => r.el))]
      : run.rows.map((r) => r.el)));
    return { out, h: Math.max(0, y - 1), focus, focusH };
  }

  more(e, ctx, project = null) {
    const a = e.a, show = this.showActivity !== false && !a.sub;
    if (a.asleep) return { lines: e.lines, label: a.name, time: a.asleep.busy ? "\u2026" : since(a.asleep.saved), project, steady: show, oneLine: this.narrow };
    return {
      label: this.nameOf(a),
      lines: e.lines,
      time: a.sub ? null : elapsed(a, this.since ?? {}, ctx.now),
      // A message sent to it from Send and not seen yet: who it is from.
      activity: show ? (fromOf(a) ? `Message from ${fromOf(a)}` : activityOf(a, ctx.digests[a.pane])) : null,
      // An agent's row keeps its second line, so the list never jumps.
      steady: show && Boolean(a.status),
      ...this.extras(a, ctx, show),
      project,
      oneLine: this.narrow,
    };
  }

  extras(a, ctx, show = true) {
    return {
      faint: a.status === "idle",
      step: show ? stepOf(a, this.steps, ctx.now) : null,
      tasks: a.sub ? [] : (this.tasks[a.address] ?? []).map((x) => ({ command: x.command, time: duration(Math.max(0, ctx.now - x.start)) })),
    };
  }

  listed(ps, sp, terms) {
    const byAddress = new Map(terms.map((k) => [k.address, k]));
    return visibleAgents(withTerminals(agents(), ps, sp), this.offNames()).map((a) => {
      const k = byAddress.get(a.address), l = k?.labels, pin = l?.[PIN_LABEL];
      return { ...a, parent: k?.parent ?? null, labels: l ?? {}, turn: k?.turn ?? 0, msg: k?.report?.msg ?? null, name: l?.[NAME_LABEL] || undefined, pin: pin != null && pin !== "" && !Number.isNaN(Number(pin)) ? Number(pin) : null };
    });
  }

  setOrder(key, value, cx) {
    this[key] = value;
    this.panel.set(`spaces.${key}`, key === "threadGroup" ? (value ? "on" : "off") : value);
    this.orderOpen = false;
    cx.notify();
  }

  // The pin is the `kanso.pin` label on the terminal: its number is its place among the pinned; pinning again unpins.
  pin(a, pins) {
    if (a.pin != null) { label(a.address, PIN_LABEL); return; }
    label(a.address, PIN_LABEL, Math.max(0, ...pins) + 1);
  }

  setPins(addresses) {
    addresses.forEach((address, i) => label(address, PIN_LABEL, i + 1));
  }

  dropped(d, a, mine, side, space) {
    if (d.section === "pinned") this.setPins(moved(mine.filter((x) => x.pin != null).map((x) => x.address), d.address, a.address, side));
    else {
      const list = mine.filter((x) => x.pin == null).map((x) => x.address);
      this.custom[space] = moved(list, d.address, a.address, side);
      this.panel.set("spaces.custom", this.custom);
    }
  }

  rowOf(a, mine, space) {
    const section = a.pin != null ? "pinned" : this.order === "custom" ? "custom" : null;
    const from = this.draggedAgent;
    const ok = Boolean(section && from && from.address !== a.address && from.space === space && from.section === section);
    const side = () => (from.at < mine.indexOf(a) ? "after" : "before");
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => {
        const over = Boolean(h && this.draggedAgent && this.overAgent !== a.address);
        if (over) this.overAgent = a.address;
        const hovered = h ? this.hoverRow !== a.address : this.hoverRow === a.address;
        if (hovered) this.hoverRow = h ? a.address : null;
        if (over || hovered) cx.notify();
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

  // With the switch off, the sidebar stays on Spaces.
  setShown(key, on, cx) {
    if (key === "switch" && !on) this.setView("spaces");
    this.hide(key === "switch" ? "sidebar.switch" : "sidebar.activity", !on);
    cx.notify();
  }

  // A piece on or off the `kanso.hidden` list (Kanso settings keeps the same list).
  hide(id, off) {
    const set = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    if (off === set.has(id)) return;
    setShared("kanso.hidden", off ? [...set, id] : [...set].filter((x) => x !== id));
  }

  setView(view, cx) {
    this.view = view;
    this.panel.set("spaces.view", view);
    if (view === "threads" && cx) this.refreshThreads(cx);
  }

  checkAlive(cx, now = Date.now(), active = window().active) {
    this.checkTasks(cx, now, active);
  }

  sawAlive(next, sig, at, cx) {
    this.aliveSig = sig;
    this.aliveAt = at;
    const changed = !this.alive || next.size !== this.alive.size || [...next].some((p) => !this.alive.has(p));
    this.alive = next;
    if (changed) cx.notify();
  }

  // A file that hasn't grown isn't read again (threads.js).
  refreshThreads(cx) {
    this.threadsAt = Date.now();
    if (this.readingThreads) return;
    this.readingThreads = true;
    // Agents on this computer (another machine's files are not here).
    const background = this.background();
    const list = agents().filter((a) => !a.address.includes("/") && background.allows(a.address, this.threads?.[a.address])).map((a) => ({ address: a.address, app: a.app }));
    if (!list.length) { this.readingThreads = false; return; }
    cx.spawn(async (cx) => {
      try { this.threads = await findThreads(list, this.threads ?? {}, terminals()); } catch { this.threads ??= {}; }
      finally { this.readingThreads = false; }
      cx.notify();
    });
  }

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

  grouped(t, collapsed, sp, ps, ctx) {
    const rows = this.ordered(sp, ctx.places);
    const live = machines();
    const draw = (r) => {
      if (collapsed) return item(this.compact(r, t, ctx), RAIL_MARK);
      const mine = ctx.rowsBy.get(r.w.id) ?? [];
      const split = asleepGroups(mine, { key: r.w.id });
      const whole = split.groups.find((g) => g.whole) ?? null;
      const entries = nest(whole ? [] : split.live, ctx.terms);
      const open = !this.agentsFolded.has(r.w.id);
      const indent = r.tree ? CHILD_PAD : 0;
      // A breath of space between projects (a worktree stays close to its checkout).
      const gap = r.tree || r === rows[0] ? [] : [item(div().h(10).flex_none(), 10)];
      // The space's row before its agents': the keyboard's path (navMark) goes in screen order.
      const head = item(this.row(r, t, whole ? [] : entries.map((e) => e.a), whole), rowHeight(r), r.w.active ? spaceMark(rowHeight(r)) : null);
      const returned = r.w.active ? this.returnRows(t, r.w) : [];
      if (whole) {
        const agents = this.asleepAgents(whole, t, ctx, indent);
        const box = agents.els.map((el) => item(el, this.asleepOpenOf(whole.id) ? ((this.foldH ?? {})[`asleep-${whole.id}`] ?? agents.h) : 0));
        return [...gap, head, ...returned, ...box];
      }
      const show = this.unfolded(r.w.id, open, ctx.now);
      const st = show ? this.stacked(entries, split.live, indent, t, r.w.id, ctx) : null;
      const tabs = show ? split.groups.flatMap((g) => {
        const agents = this.asleepAgents(g, t, ctx, indent);
        return [this.asleepHead(t, g, { pad: AGENT_PAD + indent }), ...agents.els];
      }) : [];
      const inner = [...(st?.out ?? []), ...tabs];
      const box = (inner.length ? this.foldBox(r.w.id, open, inner, ctx.now) : [])
        .map((el) => item(el, open ? ((this.foldH ?? {})[r.w.id] ?? st?.h ?? 0) : 0, open && st?.focus != null ? agentMark(st.focus, st.focusH) : null));
      return [...gap, head, ...returned, ...box];
    };
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...(this.machines ?? []).map((row) => row.name), ...(this.parked ?? []).map((row) => row.name)])].filter(Boolean).toSorted();
    const loading = m => {
      const state = live.find(k => k.name === m)?.layout;
      return state === "loading" || (!state && this.machines.some(k => k.name === m && k.state === "connected"))
        || rows.length < sp.length && sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => item(this.machineBones(t, collapsed, m), collapsed ? RAIL_MARK : PLAIN_ROW);
    // Projects with no space open (added, or asleep whole), on their machine; each keeps a + to start an agent in it.
    const names = shownNames(ctx.registry);
    const closed = (m) => this.closedOn(m, ctx).flatMap((c) => {
      const group = c.list.length ? asleepGroups(c.list, { key: c.key }).groups[0] ?? null : null;
      if (collapsed) return group ? [item(this.closedRail(t, c, names, ctx), RAIL_MARK)] : [];
      const agents = group ? this.asleepAgents(group, t, ctx, 0) : { els: [], h: 0 };
      const box = agents.els.map((el) => item(el, this.asleepOpenOf(group.id) ? ((this.foldH ?? {})[`asleep-${group.id}`] ?? agents.h) : 0));
      return [item(div().h(10).flex_none(), 10), item(this.closedRow(t, c, names, group), rowHeight({ tree: null })), ...box];
    });
    if (!remote.length) return loading(null) && !rows.length && !this.closedOn(null, ctx).length ? [loadingRow(null)] : [...rows.flatMap(draw), ...closed(null)];
    const block = { t, collapsed, rows, draw, closed, loading, loadingRow, ctx, layouts: live };
    return [null, ...remote].flatMap((m) => this.machineBlock(m, block));
  }

  machineMark(t, phase) {
    const mark = machineMarks[phase];
    if (!mark) return null;
    const glyph = svg(`mods/kanso-chrome/icons/${mark.icon}.svg`).size(ICON).flex_none().text_color(t[mark.color]).tooltip(mark.tip);
    return mark.icon === "refresh" ? glyph.spin(900) : glyph;
  }

  machineSwitch(m, phase, t, collapsed) {
    const id = powerId(m);
    if (!id) return null;
    const on = phase !== "off";
    const ring = this.navMark(`machine-power:${m}`, (cx) => this.setPower(m, this.phaseOf(m) === "off", cx));
    const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    if (collapsed) {
      return stop(div().id(id).size(ICON).flex_none().cursor_pointer().tooltip(on ? "On" : "Off"))
        .when(ring, (el) => el.border_1().border_color(t.accent))
        .on_click((_e, cx) => { cx.stop_propagation(); this.setPower(m, !on, cx); })
        .child(svg("mods/kanso-chrome/icons/plug.svg").size(ICON).text_color(on ? t.foreground : t.muted));
    }
    return stop(toggleSwitch(id, on, (next, cx) => this.setPower(m, next, cx), tokens(t), { label: on ? `Disconnect ${m}` : `Connect ${m}` }))
      .when(ring, (el) => el.border_color(t.accent));
  }

  machineHead(m, phase, t, collapsed, folded) {
    const title = machineTitle(m, this.hostName);
    const off = phase === "off";
    const connected = phase === "connected";
    const ink = off ? t.dim : t.foreground;
    const mark = this.machineMark(t, phase);
    const go = (cx) => {
      if (off && m) { this.setPower(m, true, cx); return; }
      if (!connected) return;
      if (folded) this.folded.delete(m); else this.folded.add(m);
      this.panel?.set("machines.folded", [...this.folded]);
      cx.notify();
    };
    const ring = this.navMark(`machine:${m ?? "local"}`, go);
    const power = this.machineSwitch(m, phase, t, collapsed);
    const icon = svg(`mods/kanso-chrome/icons/${m ? "server" : "monitor"}.svg`).size(HEADER_ICON).flex_none().text_color(ink);
    return h_flex().id(`machine-${m ?? "local"}`).h(collapsed ? RAIL_MARK : PLAIN_ROW).flex_none()
      .px(collapsed ? 0 : G.sm).gap(collapsed ? G.xs : G.sm).items_center().justify_center().text_color(ink)
      .when(!collapsed, (el) => el.justify_start())
      .when(ring, (el) => el.border_1().border_color(t.accent))
      .when(connected || (off && Boolean(m)), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => go(cx))
      .when(collapsed, (el) => el.tooltip(phase === "login" ? `${title}: ${loginLine(m)}` : title).child(icon).when(Boolean(power), (row) => row.child(power)))
      .when(!collapsed, (el) => el.child(icon)
        .child(div().flex_1().min_w(0).truncate().text_size(T.title).font_semibold().text_color(ink).child(title))
        .when(connected, (row) => row.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(G.xs).rounded(R.control)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
        .when(mark, (row) => row.child(mark))
        .when(Boolean(power), (row) => row.child(power))
        .when(connected, (row) => row.child(svg(`mods/kanso-chrome/icons/chevron-${folded ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim))));
  }

  machineDown(m, t, collapsed) {
    const retry = (cx) => this.retryMachine(m, cx);
    if (collapsed) {
      return div().id(`machine-retry-${m}`).size(ICON).flex_none().cursor_pointer().tooltip("Unavailable")
        .on_click((_e, cx) => retry(cx))
        .child(svg("mods/kanso-chrome/icons/refresh.svg").size(ICON).text_color(t.blocked));
    }
    return h_flex().id(`machine-unavailable-${m}`).h(H.compact).flex_none().px(G.sm).gap(G.sm).items_center()
      .child(div().text_size(T.body).text_color(t.blocked).child("Unavailable"))
      .child(quietLink(`machine-retry-${m}`, "Retry", retry, tokens(t), { color: t.foreground, label: "Retry" }));
  }

  machineLogin(m, t, collapsed) {
    const line = loginLine(m);
    const onCopy = (_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard?.(line); this.copiedLogin = line; cx.notify(); };
    if (collapsed) {
      return div().id(`machine-login-copy-${m}`).size(ICON).flex_none().cursor_pointer().tooltip(line)
        .on_click(onCopy)
        .child(svg("mods/kanso-chrome/icons/copy.svg").size(ICON).text_color(t.foreground));
    }
    return v_flex().id(`machine-login-${m}`).px(G.sm).gap(G.xs).flex_none()
      .child(div().text_size(T.small).text_color(t.blocked).child("Needs a login"))
      .child(h_flex().gap(G.xs).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.small).text_color(t.muted).child(line))
        .child(div().id(`machine-login-copy-${m}`).flex_none().px(G.xs).rounded(R.control).cursor_pointer()
          .text_size(T.small).text_color(t.foreground).tooltip(line)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(onCopy)
          .child(this.copiedLogin === line ? "Copied" : "Copy")));
  }

  machineBlock(m, block) {
    const { t, collapsed, rows, draw, closed, loading, loadingRow, ctx, layouts } = block;
    const phase = this.phaseOf(m, layouts);
    const folded = phase === "connected" && (this.folded ?? new Set()).has(m);
    const mine = rows.filter((r) => (r.w.machine ?? null) === m);
    const headItem = item(this.machineHead(m, phase, t, collapsed, folded), collapsed ? RAIL_MARK : PLAIN_ROW);
    if (phase === "off") return [headItem];
    if (phase === "loading") return [headItem, loadingRow(m)];
    if (phase === "unavailable") return [headItem, item(this.machineDown(m, t, collapsed), collapsed ? RAIL_MARK : H.compact)];
    if (phase === "login") return [headItem, item(this.machineLogin(m, t, collapsed), collapsed ? RAIL_MARK : H.compact * 2)];
    const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(R.control)
      .text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("space.new", { machine: m ?? "" }))
      .child(svg("mods/kanso-chrome/icons/plus.svg").size(14)).tooltip("New space");
    if (folded) return [headItem];
    const asleep = this.closedOn(m, ctx).length > 0;
    return [headItem, ...(mine.length ? mine.flatMap(draw) : asleep ? [] : [loading(m) ? loadingRow(m) : item(empty, 28)]), ...closed(m)];
  }

  // Only a worktree row drops the branch: its name already is the branch.
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

  // The last child's line stops at the bend.
  connector({ last }, t) {
    const mid = TREE_ROW / 2;
    return [
      div().absolute().left(GUIDE_X).top(-GUIDE_OVERLAP).w(1).h(last ? mid + GUIDE_OVERLAP : TREE_ROW + GUIDE_OVERLAP).bg(t.input),
      div().absolute().left(GUIDE_X).top(mid).w(ELBOW_W).h(1).bg(t.input),
    ];
  }

  fold(w, mine, t) {
    const open = !this.agentsFolded.has(w.id);
    return agentFold(w.id, mine, open, (cx) => { this.setAgentsFolded(w.id, open, cx); cx.notify(); }, t);
  }

  setAgentsFolded(id, folded, cx = null) {
    if (folded === this.agentsFolded.has(id)) return;
    folded ? this.agentsFolded.add(id) : this.agentsFolded.delete(id);
    this.panel.set("spaces.agentsFolded", [...this.agentsFolded]);
    if (cx) this.toggleFold(id, !folded, cx);
  }

  // Opening draws the box at 0 for one frame (`phase`) so the height ease has a start;
  // closing keeps the rows drawn for FOLD_MS so it has an end to show.
  toggleFold(id, open, cx) {
    this.folding = { id, open, phase: 0, at: Date.now() };
    const tick = (cx) => { if (this.folding?.id !== id) return; if (this.folding.phase === 0) this.folding.phase = 1; cx.notify(); };
    cx.timer.after(16, tick);
    cx.timer.after(FOLD_MS, (cx) => { if (this.folding?.id === id && !this.folding.open) cx.notify(); });
  }

  unfolded(id, open, now) {
    return open || (this.folding?.id === id && !this.folding.open && now - this.folding.at < FOLD_MS);
  }

  // `gap`: the list's own, so the rows sit as they would in it.
  foldBox(id, open, rows, now, gap = 1) {
    if (!rows.length) return [];
    this.foldH ??= {};
    const mine = this.folding?.id === id;
    const closing = !open && mine;
    const start = open && mine && this.folding.open && this.folding.phase === 0;
    const h = this.foldH?.[id];
    const inner = v_flex().w_full().flex_none().gap(gap).children(rows)
      .on_size_change((s, cx) => { if (this.foldH[id] !== s.height) { this.foldH[id] = s.height; cx.notify(); } });
    return [v_flex().id(`fold-${id}`).w_full().flex_none().overflow_hidden()
      .h(closing || start ? 0 : h ?? "auto").opacity(closing || start ? 0 : 1)
      .transition("height", FOLD).transition("opacity", FOLD)
      .child(inner)];
  }

  avatarColor(w, t) {
    const color = this.colors?.[w.id] ?? "ansi6";
    return color.startsWith("#") ? color : (t[color] ?? MARK[color]);
  }

  dots(id, t, open) {
    return div().id(id).size(20).flex_none().rounded(6).flex().items_center().justify_center().text_color(t.dim).tooltip("More")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); open(); })
      .child(svg("mods/kanso-chrome/icons/more-vertical.svg").size(13));
  }

  row({ w, i, g, tree }, t, mine = [], group = null) {
    const on = w.active;
    // A wash of the text color, never a theme accent; under the space you are in it is the list's pill.
    const washHover = t.foreground + "0c";
    const asleep = Boolean(group);
    const ring = this.navMark(`space:${w.id}`, (cx) => {
      if (asleep) this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx);
      else if (mine.length) this.setAgentsFolded(w.id, on ? !this.agentsFolded.has(w.id) : false, cx);
      if (!on) run("space.select", { id: w.id });
    }, on && !mine.some((a) => a.focused));
    const row = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .when(ring, (el) => el.border_1().border_color(t.accent))
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
        if (e.click_count === 2) { this.pressed = null; run("space.rename", { id: w.id }); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else {
          if (asleep) this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx);
          else if (mine.length) this.setAgentsFolded(w.id, on ? !this.agentsFolded.has(w.id) : false, cx);
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
          .child(div().flex_shrink(0).max_w(150).truncate().text_size(13.5).font_semibold().text_color(tree && !on ? t.muted : t.foreground).child(w.name))
          .child(g && !asleep ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(asleep, (el) => el.children(this.asleepTail(t, group)))
          .when(this.hoverSpace === w.id, (el) => el.child(this.plus(`space-plus-${w.id}`, t, placeOfSpace(w))).child(this.dots(`space-dots-${w.id}`, t, () => this.menu(w))))
          .when(!asleep && mine.length > 0, (el) => el.child(this.fold(w, mine, t))),
      );
    return row;
  }

  // Projects, collapsed: one mark per project; a click lists its agents, or goes to it when it has none.
  compact({ w }, t, ctx) {
    const rows = (ctx.rowsBy.get(w.id) ?? []).map((a) => this.railRow(a, null, ctx.now));
    return this.railMark(t, `space-${w.id}`, { lead: this.railInitial(w.name, this.avatarColor(w, t)), rows, tip: w.name, on: w.active, space: w.id, menu: () => this.menu(w) });
  }

  agentsView(t, sp, ps, ctx) {
    // Asleep is a status like the others: those agents are entries too.
    const names = new Map(sp.map((w) => [w.id, w.name]));
    const zz = ctx.asleep.rows.map((a) => ({ a: { ...a, space_name: names.get(a.space) ?? a.asleep.spaceName ?? "" }, lines: [] }));
    const entries = [...nest(this.inStripOrder(ctx.all, ctx.strip), ctx.terms), ...zz];
    const since = { ...(this.since ?? {}), ...Object.fromEntries(zz.map((e) => [e.a.address, { s: "asleep", at: e.a.asleep.saved }])) };
    const held = this.held?.done ? this.held.address : null;
    const sections = bySection(entries, since, held, this.statusOrder);
    if (!sections.length) return [item(this.empty(t, "No agents yet", "Start one from + in the tab bar; it shows here by what it needs from you."))];
    const project = this.projectOf(sp, t);
    return sections.flatMap((s, i) => {
      const id = `section-${s.id}`;
      const open = !this.sectionsFolded.has(s.id);
      const count = s.entries.filter((e) => !e.lines.length).length;
      const head = this.sectionHead(t, id, i, open, (cx) => {
        open ? this.sectionsFolded.add(s.id) : this.sectionsFolded.delete(s.id);
        this.panel.set("spaces.sections", [...this.sectionsFolded]);
        this.toggleFold(id, !open, cx);
      }, s.id === "other" ? null : statusMark(t, s.id), s.label, count, s.id === "blocked" ? t.blocked : t.foreground);
      const laid = this.unfolded(id, open, ctx.now) ? (s.id === "asleep" ? this.asleepStatus(s, t, ctx) : s.entries.map((e) => {
        const m = this.more(e, ctx, e.lines.length ? null : project(e.a.space) ?? (e.a.asleep ? this.zzProject(e.a, t) : null)), rh = agentRowH(e.a, m);
        return { focused: e.a.focused, rh, el: agentRow(e.a, FLUSH, t, this.navRow(e.a, this.rowFor(e.a)), m) };
      })) : [];
      const { h, focus, focusH } = laid.reduce((acc, r) => ({ h: acc.h + r.rh + 1, focus: r.focused ? acc.h : acc.focus, focusH: r.focused ? r.rh : acc.focusH }), { h: 0, focus: null, focusH: 0 });
      const rows = laid.map((r) => r.el);
      const box = this.foldBox(id, open, rows, ctx.now)
        .map((el) => item(el, open ? (this.foldH[id] ?? Math.max(0, h - 1)) : 0, open && focus != null ? agentMark(focus, focusH) : null));
      return [item(head, i ? 44 : 32), ...box];
    });
  }

  // `lift`: the space above the header (12 under an earlier section).
  sectionHead(t, id, i, open, toggle, mark, name, count, ink, extra = null, lift = i ? 12 : 0) {
    return h_flex().id(id).h(32 + lift).pt(lift).px(12).flex_none().gap(10).items_center()
      .cursor_pointer().text_size(13).font_semibold().text_color(ink)
      .on_click((_e, cx) => { toggle(cx); cx.notify(); })
      .when(Boolean(mark), (el) => el.child(mark))
      .child(div().child(name))
      .when(count != null, (el) => el.child(div().font_normal().text_color(t.dim).child(String(count))))
      .child(div().flex_1())
      .when(Boolean(extra), (el) => el.child(extra))
      .child(svg(`mods/kanso-chrome/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim));
  }

  machineBones(t, collapsed, m) {
    const { block, line } = skeleton({ border: t.border });
    if (collapsed) return breathe(h_flex().id(`machine-loading-${m ?? "local"}`).w_full().h(RAIL_MARK).flex_none().justify_center().items_center()).child(block(28, 32, 6));
    return breathe(h_flex().id(`machine-loading-${m ?? "local"}`).h(PLAIN_ROW).flex_none().px(8).gap(9).items_center()).child(block(16, 16, 4)).child(line(112, 11));
  }

  silhouette(t) {
    const { block, line } = skeleton({ border: t.border });
    const titles = [132, 104, 150, 92, 118], seconds = [170, 138, 120, 160, 100];
    const row = (i) => h_flex().h(64).mb(6).px(12).gap(12).items_center()
      .child(v_flex().h(64).pt(11).flex_none().child(block(20, 20, 6)))
      .child(v_flex().flex_1().min_w(0).gap(9)
        .child(h_flex().items_center().child(line(titles[i], 10)).child(div().flex_1()).child(block(22, 8)))
        .child(line(seconds[i], 8)));
    return breathe(v_flex().id("kanso-skeleton").w_full()).children([0, 1, 2, 3, 4].map(row));
  }

  empty(t, title, body) {
    return v_flex().px(10).py(12).gap(4)
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(title))
      .child(div().text_size(12).text_color(t.muted).child(body));
  }

  projectOf(sp, t) {
    const byId = new Map(sp.map((s) => [s.id, s]));
    return (id) => { const w = byId.get(id); return w ? { name: w.name, fill: this.avatarColor(w, t) } : null; };
  }

  openMenu(a, { title = null, session = null } = {}) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: a.asleep ? 170 : 460, at: "pointer",
      props: { menu: { address: a.address, view: this.view, title, session, ...(a.asleep ? { asleep: a.asleep, name: a.name } : {}) } } });
  }

  rowFor(a, actions = null, extra = {}) {
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => { if (h ? this.hoverRow !== a.address : this.hoverRow === a.address) { this.hoverRow = h ? a.address : null; cx.notify(); } },
      menu: () => this.openMenu(a, extra),
      actions: a.asleep ? actions ?? this.zzActions(a) : actions,
    };
  }

  // The thumb needs the switch's width (measured); until the first measure the chosen segment is raised on its own.
  // The three views as icons, stacked, for the collapsed rail: the one shown has the wash the open switch gives it.
  railSwitch(t, sp) {
    const asks = sp.some((s) => s.status === "blocked");
    const icons = { spaces: "folder", agents: "pulse", threads: "message" };
    return v_flex().mt(4).p(3).gap(2).rounded(8).bg(t.foreground + "0a").children(Object.keys(VIEWS).map((view) => {
      const on = this.view === view;
      return div().id(`rail-view-${view}`).relative().size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
        .tooltip(VIEWS[view].label).text_color(on ? t.foreground : t.muted)
        .when(on, (el) => el.bg(t.raised ?? t.selected).border_1().border_color(t.border))
        .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.setView(view, cx); cx.notify(); })
        .child(svg(`mods/kanso-chrome/icons/${icons[view]}.svg`).size(14))
        .when(view === "agents" && asks && !on, (el) => el.child(div().absolute().top(3).right(3).size(5).rounded_full().bg(t.blocked)));
    }));
  }

  // One group in the collapsed rail (a project, a status, a shelf): its lead (a project's initial in its color, or an icon), the most
  // urgent state as the list's own mark, how many. A click lists the group in a popup; a right click opens `menu` (else the same list).
  // `space`: a project's, so its list also offers to go to it; with no rows a click goes there at once.
  // `urgent: false`: a status section's lead already is its state.
  railMark(t, id, { lead, rows, tip, on = false, space = null, menu = null, ink = t.dim, urgent = true }) {
    const top = urgent ? mostUrgent(rows.map((r) => ({ status: r.status }))) : null;
    const shown = top === "working" || top === "blocked" || top === "done" || top === "asleep" ? top : null;
    const list = () => (rows.length ? this.railMenu(tip, rows, space) : space ? run("space.select", { id: space }) : null);
    const strong = rows.some((r) => r.strong);
    return h_flex().w_full().h(RAIL_MARK).flex_none().justify_center().items_center().child(
      v_flex().id(id).w(36).h(40).flex_none().gap(3).items_center().justify_center().rounded(6).cursor_pointer().tooltip(tip)
        .when(on, (el) => el.bg(t.foreground + "14"))
        .when(!on, (el) => el.hover((s) => s.bg(t.foreground + "0c")))
        .when(strong, (el) => el.border_1().border_color(t.accent + "80"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(list)
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); (menu ?? list)(); })
        .child(lead)
        .when(rows.length > 0, (el) => el.child(h_flex().h(12).gap(3).items_center().text_size(10.5).text_color(top === "blocked" ? t.blocked : ink)
          .when(Boolean(shown), (el2) => el2.child(stateMark(t, shown, 11)))
          .child(div().child(String(rows.length))))));
  }

  // A project's initial, no square: its color says which.
  railInitial(name, fill) {
    return div().h(16).flex().items_center().text_size(14).font_semibold().text_color(fill).child(name?.[0]?.toUpperCase() ?? "?");
  }

  railIcon(t, icon) {
    return h_flex().h(16).items_center().child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14).flex_none().text_color(t.muted));
  }

  // What the popup needs of a row: it draws in its own view, from its props.
  // Unread and woke carry over: the group's mark gets the ring the open view's strong rows have, the row its badge.
  railRow(a, hint = null, now = Date.now()) {
    const zz = a.status === "asleep" || Boolean(a.dozing) || Boolean(a.asleep);
    const up = woke(a, now), unread = isUnread(a.labels);
    return { address: a.address, pane: a.pane ?? null, name: a.asleep ? a.name : this.nameOf(a), status: zz ? "asleep" : a.status ?? null, hint, asleep: a.asleep ?? null,
      strong: up || unread, badge: up ? "Woke" : unread ? "Unread" : null };
  }

  railMenu(title, rows, space = null) {
    const height = 18 + 26 + Math.min(rows.length, RAIL_MENU_ROWS) * (MENU_ROW + 1) + (space ? MENU_ROW + 9 : 0);
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 260, height, at: "pointer", props: { railMenu: { title, rows, space } } });
  }

  // The rail's list of one group: each row with its state, a click goes to it; an asleep one opens its wake menu.
  railMenuView(t) {
    const m = props().railMenu;
    const item = this.items(t);
    const to = (r) => (r.asleep ? () => { closeOverlay(props().overlay); openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 170, at: "pointer", props: { menu: { address: r.address, asleep: r.asleep, name: r.name } } }); }
      : () => { closeOverlay(props().overlay); r.pane ? run("pane.focus", { pane: r.pane }) : run("terminal.peek", { terminal: r.address }); });
    // As the conversation picker's: every row's act for the keyboard, the list drawing what shows and scrolled to the selection.
    this.menuActs = m.rows.map(to);
    this.menuScroll = this.convScroll ? { handle: this.convScroll, count: m.rows.length } : null;
    const key = (r) => `rail-${r.address}`;
    const byKey = (k) => m.rows.find((r) => key(r) === k) ?? null;
    const row = (r, at) => this.menuRow(t, key(r), r.name, at, null, { lead: r.status ? stateMark(t, r.status, 13, { idle: true }) : null, hint: r.hint, badge: r.badge, ink: r.status === "asleep" ? t.muted : t.foreground });
    return this.menuFrame(t)
      .child(this.menuTitle(t, m.title))
      .child(v_flex().relative().flex_none().h(Math.min(m.rows.length, RAIL_MENU_ROWS) * MENU_ROW)
        .child(v_virtual_list("rail-menu-list", m.rows.length, MENU_ROW, (i) => key(m.rows[i]),
          (range) => m.rows.slice(range.start, range.end).map((r, k) => row(r, range.start + k)))
          .when(Boolean(this.convScroll), (el) => el.track_scroll(this.convScroll))
          .on_item_click((k, cx) => { const r = byKey(k); if (r) to(r)(); cx.notify(); }))
        .child(Scrollbar.vertical("rail-menu-list").absolute().inset_0()))
      .when(Boolean(m.space), (el) => el.child(div().mx(8).my(4).h(1).bg(t.border))
        .child(item("rail-go", "Go to project", () => run("space.select", { id: m.space }), { icon: "chevron-right" })));
  }

  // Status, collapsed: one mark per section.
  agentsRail(t, sp, ctx) {
    const names = new Map(sp.map((w) => [w.id, w.name]));
    const zz = ctx.asleep.rows.map((a) => ({ a: { ...a, space_name: names.get(a.space) ?? a.asleep.spaceName ?? "" }, lines: [] }));
    const entries = [...nest(this.inStripOrder(ctx.all, ctx.strip), ctx.terms), ...zz];
    const since = { ...(this.since ?? {}), ...Object.fromEntries(zz.map((e) => [e.a.address, { s: "asleep", at: e.a.asleep.saved }])) };
    const sections = bySection(entries, since, this.held?.done ? this.held.address : null, this.statusOrder);
    return sections.map((s) => {
      const rows = s.entries.filter((e) => !e.lines.length).map((e) => this.railRow(e.a, e.a.space_name || null, ctx.now));
      const lead = s.id === "other" ? this.railIcon(t, "layers") : h_flex().h(16).items_center().child(statusMark(t, s.id));
      return item(this.railMark(t, `rail-section-${s.id}`, { lead, rows, tip: s.label, ink: s.id === "blocked" ? t.blocked : t.dim, urgent: false }), RAIL_MARK);
    });
  }

  // Threads, collapsed: one mark per project (or per shelf: Pinned, Snoozed, Settled).
  threadsRail(t, sp, ctx) {
    if (!this.threads) return [];
    const rows = ctx.all
      .filter((a) => !a.address.includes("/") && (this.threads[a.address] || a.program?.agent || a.status))
      .map((a) => ({ a, th: shownThread(this.threads[a.address], this.termBy?.get(a.address), this.alive) }))
      .concat(ctx.asleep.rows.filter((a) => a.asleep.resume).map((a) => ({ a, th: { title: a.title, said: a.asleep.said ?? a.asleep.saved, at: a.asleep.saved } })));
    const sections = threadSections(rows, { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} });
    const icons = { pinned: "pin", snoozed: "clock", settled: "check" };
    return sections.map((s) => {
      const p = s.project ? ctx.project(s.project) : null;
      const w = s.project ? sp.find((x) => x.id === s.project) : null;
      const list = s.rows.map(({ a }) => this.railRow(a, p ? null : ctx.project(a.space)?.name ?? null, ctx.now));
      const lead = p ? this.railInitial(p.name, p.fill) : this.railIcon(t, icons[s.id] ?? "message");
      return item(this.railMark(t, `rail-thread-${s.id}`, { lead, rows: list, tip: p?.name ?? s.label ?? "Conversations", on: Boolean(w?.active), space: w?.id ?? null, menu: w ? () => this.menu(w) : null }), RAIL_MARK);
    });
  }

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

  threadsView(t, sp, ps, ctx) {
    if (!this.threads) return [item(this.silhouette(t))];
    const project = this.projectOf(sp, t);
    const rows = ctx.all
      .filter((a) => !a.address.includes("/") && (this.threads[a.address] || a.program?.agent || a.status))
      .map((a) => ({ a, th: shownThread(this.threads[a.address], this.termBy?.get(a.address), this.alive) }))
      // Asleep, a conversation keeps its place among the others (by your last message in it).
      .concat(ctx.asleep.rows.filter((a) => a.asleep.resume).map((a) => ({ a, th: { title: a.title, said: a.asleep.said ?? a.asleep.saved, at: a.asleep.saved } })));
    if (!rows.length) return [item(this.empty(t, "No conversations open", "Start Claude Code or Codex in a tab; each conversation shows here, named on its own."))];
    const sections = threadSections(rows, { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} });
    // Under its project's header a conversation is nested: indented, the agent's icon as its mark, and no project line.
    const row = ({ a, th }, nested = false) => {
      const when = (this.threadOrder === "started" ? th?.began : th?.said ?? th?.at) ?? this.since?.[a.address]?.at;
      const unread = isUnread(a.labels), up = woke(a, ctx.now), settled = Boolean(settledOf(a.labels)) && !backFromSettled(a);
      const snoozed = snoozedUntil(a.labels) > ctx.now;
      const free = a.status !== "working" && a.status !== "blocked";
      const actions = a.asleep ? this.zzActions(a) : [
        settled ? { id: "unsettle", icon: "undo", tip: "Bring back", act: () => label(a.address, SETTLED_LABEL) }
          : free && a.pin == null ? { id: "settle", icon: "check", tip: "Settle", act: () => label(a.address, SETTLED_LABEL, `${Date.now()}:${a.turn ?? 0}`) } : null,
        { id: "pin", icon: "pin", tip: a.pin != null ? "Unpin" : "Pin to the top", act: () => this.pinThread(a) },
      ].filter(Boolean);
      const more = {
        label: this.nameOf(a),
        time: snoozed ? new Date(snoozedUntil(a.labels)).toTimeString().slice(0, 5) : when ? duration(Math.max(0, ctx.now - when)) : null,
        badge: up ? "Woke" : null,
        strong: unread || up,
        project: nested ? null : project(a.space),
        // What the agent says it is on, or said last; else the last thing you wrote.
        activity: a.asleep ? (a.asleep.stuck ? `Stuck: ${a.asleep.stuck}` : a.asleep.busy ? "On its way" : `Asleep since ${since(a.asleep.saved)}`) : said(a) ?? (th?.prompt ? `You: ${th.prompt}` : null),
        roomy: true,
        oneLine: this.narrow,
        ...this.extras(a, ctx),
      };
      return { rh: agentRowH(a, more), el: agentRow(a, nested ? NESTED : FLUSH, t, this.navRow(a, this.rowFor(a, actions, { title: th?.title ?? null, session: th?.file ?? null })), more) };
    };
    // Rows of varying height: where each one starts, for the pill.
    const stack = (laid, gap) => laid.reduce((acc, r, k) => ({ h: acc.h + r.rh + (k ? gap : 0), tops: [...acc.tops, acc.h + (k ? gap : 0)] }), { h: 0, tops: [] });
    const quiet = (g, nested) => {
      const zOpen = this.asleepOpenOf(g.id);
      const drawn = this.unfolded(`asleep-${g.id}`, zOpen, ctx.now) ? g.rows.map((r) => row(r, nested)) : [];
      const box = this.foldBox(`asleep-${g.id}`, zOpen, drawn.map((r) => r.el), ctx.now, 6);
      const h = drawn.reduce((n, r, k) => n + r.rh + (k ? 6 : 0), 0);
      const a = g.rows[0].a;
      const name = g.name || project(a.space)?.name || this.zzProject(a, t).name;
      return [item(this.asleepHead(t, g, { name, pad: AGENT_PAD + (nested ? NESTED : FLUSH) }), 32), ...box.map((el) => item(el, zOpen ? ((this.foldH ?? {})[`asleep-${g.id}`] ?? h) : 0))];
    };
    return sections.flatMap((s, i) => {
      const split = s.id.startsWith("project-") ? asleepGroups(s.rows, { asleepOf: (r) => r.a.asleep ?? null, key: s.project ?? s.rows[0]?.a.asleep?.from ?? s.id }) : { live: s.rows, groups: [] };
      const whole = split.groups.find((g) => g.whole) ?? null;
      const folds = Boolean(s.folds);
      const open = whole ? this.asleepOpenOf(whole.id) : folds ? this.shelvesOpen.has(s.id) : !this.sectionsFolded.has(`thread-${s.id}`);
      const foldId = whole ? `asleep-${whole.id}` : `thread-${s.id}`;
      const toggle = (cx) => {
        if (whole) { this.toggleAsleep(whole.id, open, cx); return; }
        if (folds) { open ? this.shelvesOpen.delete(s.id) : this.shelvesOpen.add(s.id); this.panel.set("spaces.shelvesOpen", [...this.shelvesOpen]); }
        else { open ? this.sectionsFolded.add(`thread-${s.id}`) : this.sectionsFolded.delete(`thread-${s.id}`); this.panel.set("spaces.sections", [...this.sectionsFolded]); }
        this.toggleFold(foldId, !open, cx);
      };
      const p = s.project ? project(s.project) : null;
      // A project's name alone heads its conversations: the structure tells the group.
      const mark = whole ? this.asleepMark(t, whole) : p ? null
        : s.id === "pinned" ? svg("mods/kanso-chrome/icons/pin.svg").size(13).flex_none().text_color(t.muted)
        : s.id === "snoozed" ? svg("mods/kanso-chrome/icons/clock.svg").size(14).flex_none().text_color(t.muted)
        : s.id === "settled" ? svg("mods/kanso-chrome/icons/check.svg").size(14).flex_none().text_color(t.muted) : null;
      // Alone, the active list is the inbox itself: no header. Asleep rows park at the end, one project each.
      if (s.id === "active" && sections.length === 1) {
        const live = s.rows.filter((r) => !r.a.asleep);
        const groups = [...Map.groupBy(s.rows.filter((r) => r.a.asleep), (r) => r.a.space ?? r.a.asleep?.from ?? "asleep")]
          .flatMap(([key, list]) => asleepGroups(list, { asleepOf: (r) => r.a.asleep, key }).groups);
        if (!groups.length) return s.rows.map((r) => { const { rh, el } = row(r); return item(el, rh, r.a.focused ? agentMark(0, rh) : null); });
        return [...live.map((r) => { const { rh, el } = row(r); return item(el, rh, r.a.focused ? agentMark(0, rh) : null); }), ...groups.flatMap((g) => quiet(g, false))];
      }
      // A project's conversations: its + starts a new one there.
      const w = s.project ? sp.find((x) => x.id === s.project) : null;
      const tail = whole ? this.asleepTail(t, whole, { mark: false, count: false }) : [];
      const extra = tail.length
        ? h_flex().flex_none().gap(8).items_center().children([...tail, ...(w ? [this.plus(`thread-plus-${w.id}`, t, placeOfSpace(w))] : [])])
        : w ? this.plus(`thread-plus-${w.id}`, t, placeOfSpace(w)) : null;
      // A project starts after a wider breath than the gap inside it, so each reads as one group.
      const lift = i ? (p ? 18 : 12) : 0;
      const headName = p ? p.name : whole ? this.zzProject(whole.rows[0].a, t).name : (s.label ?? "Active");
      const head = [item(this.sectionHead(t, `thread-${s.id}`, i, open, toggle, mark, headName, s.rows.length, folds ? t.muted : t.foreground, extra, lift), 32 + lift)];
      const body = whole ? s.rows : split.live;
      const show = this.unfolded(foldId, open, ctx.now);
      const laid = show ? body.map((r) => row(r, Boolean(s.project))) : [];
      const tabs = !whole && show ? split.groups.flatMap((g) => quiet(g, true).map((it) => it.el)) : [];
      const { h: stackH, tops } = stack(laid, 6);
      const k = laid.findIndex((_r, j) => body[j].a.focused);
      const box = this.foldBox(foldId, open, [...laid.map((r) => r.el), ...tabs], ctx.now, 6)
        .map((el) => item(el, open ? ((this.foldH ?? {})[foldId] ?? stackH) : 0, open && k >= 0 ? agentMark(tops[k], laid[k].rh) : null));
      return [...head, ...box];
    });
  }

  pinThread(a) {
    this.pin(a, terminals().map((k) => Number(k.labels?.[PIN_LABEL]) || 0));
  }

  // Thread states are kept as labels on the terminal in herdr-core, so every window and a restart agree.
  menuView(t) {
    const m = props().menu, close = () => closeOverlay(props().overlay);
    if (m.asleep) return this.zzMenuView(t, m);
    const k = terminals().find((x) => x.address === m.address);
    const p = panes().find((x) => x.terminal === m.address);
    const a = agents().find((x) => x.address === m.address);
    const sp = p?.tab ? spaces().find((s) => s.tabs?.some((x) => x.id === p.tab)) : null;
    const l = k?.labels ?? {}, now = Date.now();
    const pinned = l[PIN_LABEL] != null && l[PIN_LABEL] !== "";
    const settled = Boolean(settledOf(l)), snoozed = snoozedUntil(l) > now;
    const free = a?.status !== "working" && a?.status !== "blocked";
    const item = this.items(t);
    const rule = () => div().mx(8).my(4).h(1).bg(t.border);
    const copy = (text) => (cx) => cx.write_to_clipboard?.(text);
    const session = m.session ? m.session.split("/").at(-1).replace(/\.jsonl$/, "").replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, "") : null;
    const title = m.title ?? l[THREAD_LABEL] ?? null;
    // Its project is kept with the agent (conversation key, else its terminal's id); the sidebar holds the database.
    const conversation = session && /^[0-9a-f]{8}-/.test(session) ? session : null;
    const moveKeys = [conversation, l[ID_LABEL] ? `term:${l[ID_LABEL]}` : null].filter(Boolean);
    const movedTo = moveKeys.map((key) => (shared("kanso.projects") ?? {})[key]).find(Boolean) ?? null;
    const shownIn = movedTo ?? sp?.id ?? null;
    // A short queue, so two quick moves both land.
    const moveTo = (project) => setShared("kanso.move", [...(Array.isArray(shared("kanso.move")) ? shared("kanso.move") : []).slice(-15), { address: m.address, project, n: Date.now() + Math.random() }]);
    return this.menuFrame(t)
      .when(Boolean(p), (el) => el.child(item("open", "Open", () => run("pane.focus", { pane: p.pane }), { icon: "chevron-right" })))
      .child(item("pin", pinned ? "Unpin" : "Pin to the top", () => this.pinThread({ address: m.address, pin: pinned ? 1 : null }), { icon: "pin" }))
      .when(settled, (el) => el.child(item("unsettle", "Bring back", () => label(m.address, SETTLED_LABEL), { icon: "undo" })))
      .when(!settled && free, (el) => el.child(item("settle", "Settle", () => label(m.address, SETTLED_LABEL, `${now}:${k?.turn ?? 0}`), { icon: "check" })))
      .when(snoozed, (el) => el.child(item("wake", "Wake now", () => label(m.address, SNOOZE_LABEL), { icon: "clock" })))
      .when(!snoozed, (el) => el.child(div().h(26).pl(32).flex().items_center().text_size(11.5).text_color(t.dim).child("Snooze"))
        .children(snoozePresets(now).map((x) => item(`snooze-${x.id}`, x.label, () => label(m.address, SNOOZE_LABEL, x.until), { hint: x.when }))))
      .when(Boolean(p?.tab) && Boolean(sp) && Boolean(a), (el) => el.child(item("sleep-agent", "Sleep this agent", () => sleepAgent(sp.id, p.tab, p.pane), { icon: "moon" })))
      .when(Boolean(p?.tab) && Boolean(sp), (el) => el.child(item("sleep-tab", "Sleep its tab", () => sleepTab(sp.id, p.tab), { icon: "moon" })))
      .when((sp?.tabs?.length ?? 0) > 1, (el) => el.child(item("sleep-project", "Sleep its project\u2026", () => sleepProject(sp.id), { icon: "moon" })))
      .child(item("unread", isUnread(l) ? "Mark read" : "Mark unread", () => label(m.address, UNREAD_LABEL, isUnread(l) ? "" : "1"), { icon: "enso" }))
      .child(item("rename", "Rename\u2026", () => renameTerminal(m.address, l[NAME_LABEL] || l[THREAD_LABEL] || title || a?.title || "")))
      .when(Boolean(m.address), (el) => el.child(div().h(26).pl(32).flex().items_center().text_size(11.5).text_color(t.dim).child("Move to project"))
        // Four show, the rest scroll, so the menu's own items stay in view.
        .child(((list) => v_flex().id("move-list").flex_none().h(Math.min(list.length, 4) * 30).overflow_y_scrollbar()
          .children(list.map((w) => item(`move-${w.id}`, w.name, () => moveTo(w.id), { icon: "chevron-right" }).flex_none())))(spaces().filter((w) => !w.machine && w.id !== shownIn)))
        .when(Boolean(movedTo), (el2) => el2.child(item("move-back", "Back to where it runs", () => moveTo(null), { icon: "undo" }))))
      .child(rule())
      .when(Boolean(p?.cwd), (el) => el.child(item("copy-path", "Copy folder", copy(p.cwd), { icon: "copy" })))
      .when(Boolean(p?.branch), (el) => el.child(item("copy-branch", "Copy branch", copy(p.branch), { icon: "branch" })))
      .when(Boolean(session), (el) => el.child(item("copy-id", "Copy conversation id", copy(session), { icon: "copy" })))
      .child(rule())
      .child(this.confirmClose
        ? item("close", "Click again to close it", () => run("terminal.kill", { terminal: m.address }), { icon: "close", ink: t.blocked })
        : item("close", a ? "Close agent" : "Close terminal", (cx) => { this.confirmClose = true; }, { icon: "close", ink: t.blocked, keep: true }));
  }

  zzMenuView(t, m) {
    const z = m.asleep;
    const item = this.items(t);
    return this.menuFrame(t)
      .child(div().h(26).px(8).flex().items_center().text_size(11.5).text_color(t.dim).truncate().child(`${m.name}, asleep since ${since(z.saved)}`))
      .when(!z.busy, (el) => el.child(item("wake", z.n > 1 ? `Wake it and ${z.n - 1} more of ${z.tab}` : "Wake", () => wakeRow(z.id), { icon: "sun" })))
      .when(Boolean(z.resume), (el) => el.child(item("copy-id", "Copy conversation id", (cx) => cx.write_to_clipboard?.(z.resume), { icon: "copy" })))
      .child(item("all", "Everything asleep\u2026", () => arrange({}), { icon: "moon" }));
  }

  // Kept in shared "space.colors" so every window agrees; a gone space gives its hue up.
  assignColors(sp) {
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const ids = new Set(sp.map((p) => p.id));
    const had = shared("space.colors") ?? {};
    const stale = Object.keys(had).some((id) => !ids.has(id));
    const missing = sp.filter((p) => !had[p.id] && p.name !== "~");
    if (!stale && !missing.length) { this.colors = had; return; }
    const kept = Object.fromEntries(Object.entries(had).filter(([id]) => ids.has(id)));
    const uses = Object.values(kept).reduce((m, c) => new Map([...m, [c, (m.get(c) ?? 0) + 1]]), new Map(palette.map((c) => [c, 0])));
    // Each new space takes the hue used least so far, the ones just given counted.
    const { colors } = missing.reduce(({ colors, uses }, p) => {
      const c = palette.reduce((best, c) => (uses.get(c) < uses.get(best) ? c : best));
      return { colors: { ...colors, [p.id]: c }, uses: new Map([...uses, [c, uses.get(c) + 1]]) };
    }, { colors: kept, uses });
    setShared("space.colors", colors);
    this.colors = colors;
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.menuView(t);
    if (props()?.railMenu) return this.railMenuView(t);
    if (props()?.spaceMenu) return this.spaceMenuView(t);
    if (props()?.newAgent) return this.newAgentView(t);
    if (props()?.newConversation) return this.newConversationView(t);
    if (props()?.newProject) return this.newProjectView(t);
    if (props()?.worktree) return this.worktreeView(t);
    const collapsed = shared("sidebar.collapsed") === true;
    if (this.sinceLeft) this.sinceLeft.showing = false;
    this.narrow = !collapsed && (this.width ?? SIDEBAR_W) < ONE_LINE_W;
    // The keyboard left (a click on a pane, say): the ring goes too.
    if (this.kbd && ((!this.needsOpen && collapsed) || !this.handle.is_focused())) { this.kbd = false; if (shared("kanso.list")) setShared("kanso.list", null); }
    this.navNext = [];
    const sp = visibleSpaces(spaces(), this.offNames());
    const ps = panes();
    this.assignColors(sp);
    const quiet = (id, icon, tip, action) => div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).cursor_pointer().tooltip(tip)
      .hover((s) => s.bg(t.foreground + "12").text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(17));
    const toggle = () => (collapsed ? this.openRail() : this.foldRail(this.width >= SNAP_W ? this.width : null));
    const active = sp.find((p) => p.active);
    // Read once per draw: each read copies every record.
    const hidden = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    this.showSwitch = !hidden.has("sidebar.switch");
    this.showActivity = !hidden.has("sidebar.activity");
    const switchShown = this.showSwitch !== false;
    // Collapsed, the rail keeps the view you chose: projects as avatars, agents and threads as tiles.
    const view = switchShown ? this.view : "spaces";
    const read = { terms: terminals(), alive: this.alive, digests: shared("kanso.digest") ?? {}, strip: shared("strip.state") ?? {}, places: placesOf(sp, ps), now: Date.now() };
    // Each terminal now: a conversation read from another process in it is not this one's.
    this.termBy = new Map(read.terms.map((k) => [k.address, k]));
    // Every row built once per draw, for every view.
    const asleep = this.sleepingNow(sp, read.terms);
    const rowsCtx = { ...read, asleep, spaces: sp, registry: registry(), spaceIds: new Set(sp.map((w) => w.id)), all: this.listed(ps, sp, read.terms).filter((a) => !asleep.dozing.has(a.address)) };
    const ctx = { ...rowsCtx, rowsBy: new Map(sp.map((w) => [w.id, this.spaceRows(w.id, rowsCtx)])), project: this.projectOf(sp, t) };
    const queue = this.refreshNeeds(sp, read.terms, asleep);
    this.seenNow = this.seen(sp, ctx);
    this.seenAt = ctx.now; // when it was seen: a later write of it is no newer
    // In Projects, + adds a project; in Status and Threads, it starts a conversation in a project you pick.
    const plus = view === "spaces"
      ? quiet("space-new", "plus", "Add project", () => this.addProject())
      : quiet("space-new", "plus", "New conversation", () => this.newConversationMenu());
    const hide = quiet("sidebar-toggle", "sidebar", collapsed ? "Show sidebar" : "Hide sidebar", toggle);
    const search = quiet("search", "search", "Search", () => run("mod.open", { name: "picker" }));
    // Collapsed, Herdr's mark sits here; open, kanso-chrome draws it in the top bar.
    const brand = image("frame/welcome/herdr.png").size(20).rounded(6).flex_none();
    // Collapsed, stacked so two buttons never sit on top of each other.
    const add = collapsed
      ? v_flex().w_full().pt(8).gap(6).items_center().child(brand).child(plus).child(hide).when(switchShown, (el) => el.child(this.railSwitch(t, sp)))
      : h_flex().h(40).px(10).gap(4).items_center()
        .child(plus)
        .child(div().flex_1())
        .child(this.orderPicker(t))
        .child(search)
        .child(hide);
    const root = v_flex().id("spaces-root").track_focus(this.handle).size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_key_down((e, cx) => this.listKeyDown(e, cx))
      .on_size_change((size, cx) => this.sized(size.width, cx))
      // A pane held in the strip and let go here goes back where it was.
      .on_mouse_up("left", () => { if (shared("strip.drag")) { setShared("strip.drop", null); setShared("strip.drag", null); } })
      .child(add)
      .when(!collapsed && switchShown, (el) => el.child(this.viewSwitch(t, sp)))
      .child(queueControl(t, queue, collapsed, this.needsEmpty && !queue.rows.length, (cx) => this.toggleNeeds(cx)))
      .child(this.needsOpen ? this.needsList(t, queue, read.now) : this.list(t, collapsed, view, [
        ...(!collapsed && view !== "spaces" ? this.returnRows(t, active) : []),
        ...(view === "agents" ? (collapsed ? this.agentsRail(t, sp, ctx) : this.agentsView(t, sp, ps, ctx))
          : view === "threads" ? (collapsed ? this.threadsRail(t, sp, ctx) : this.threadsView(t, sp, ps, ctx)) : this.grouped(t, collapsed, sp, ps, ctx))]));
    this.nav = this.navNext;
    // The row the ring was on is gone: it stays at the same place in the list.
    if (this.kbd && this.nav.length && !this.nav.some((n) => n.key === this.navKey)) this.navKey = this.nav[Math.min(this.navAt ?? 0, this.nav.length - 1)].key;
    this.navAt = Math.max(0, this.nav.findIndex((n) => n.key === this.navKey));
    return root;
  }

  // A pill keeps its identity per view, so a change of view places it rather than sliding it across.
  list(t, collapsed, view, items) {
    const gap = view === "threads" ? 6 : 1;
    const { els, space, agent } = laidOut(items, gap);
    const pills = collapsed ? [] : [
      ...(space ? [pill("pill-space", space.y, space.h, t.foreground + "14")] : []),
      ...(agent ? [pill(`pill-agent-${view}`, agent.y, agent.h, t.foreground + "12")] : []),
    ];
    // Named, so its scroll position survives every redraw (an unnamed one is placed anew and starts at the top).
    return v_flex().id(`spaces-list-${collapsed ? "rail" : view}`).relative().flex_1().min_h(0).px(collapsed ? 0 : 8).gap(collapsed ? 0 : gap).pt(collapsed ? 6 : 0).pb(14).overflow_y_scrollbar().mode(collapsed ? "hover" : "always")
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.draggedAgent = null; cx.notify(); })
      // Rows keep their height: shrunk to fit, there would be nothing to scroll.
      .children([...pills, ...els.map((el) => el.flex_none())]);
  }
}
