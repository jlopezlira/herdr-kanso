import { localService, serviceOn, localName } from "./platform-host.js";
import { copiesToViewer, viewerFor } from "./platform-viewer.js";
import { signInTab } from "./sign-in.js";
import { homeRoute } from "./lan-route.js";
import { findTailscale } from "./reach.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { systemApi } from "./platform-system.js";
// Derived from the `spaces` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: New space button, initial tiles, nested worktrees on guide lines, ahead/behind counts.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-spaces; each space lists its agents (agents.js), folded by clicking the space. The active space is a faint wash of the text color, never a theme accent.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-spaces; a fixed 76px rail when collapsed (resizable only when open), space avatars in the theme's hues, a breathing dot instead of a spinner, background polling slowed when the window is behind.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.
// SidebarFooter is derived from the sidebar footer of the `workspace-chrome` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app), by way of kanso-chrome.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agentSession, agentLabel, renameTerminal, SETTLED_LABEL, SNOOZE_LABEL, UNREAD_LABEL, THREAD_LABEL, settledOf, snoozedUntil, isUnread, woke, backFromSettled, threadSections, snoozePresets, THREAD_ORDERS, STATUS_ORDERS, withTerminals, NAME_LABEL, PIN_LABEL, ORDERS, DEFAULT_ORDER, orderSessions, moved, nest, track, elapsed, activityOf, bySection, duration, trackSteps, stepOf, tasksOf, said, FOLD_MS, pill, sessionHeight, mostUrgent } from "./agents.js";
import { ThreadLocator, findThreads, sameThread, pidsOf, aliveIn, aliveDue, ALIVE_MS, ALIVE_BEHIND_MS } from "./threads.js";
import { Panel, sameSeen } from "./panel.js";
import { Store } from "./store.js";
import { Kdb, restDue, machinesToAsk, kansoDir } from "./kdb.js";
import { agentSnapshot, agentTargets, observedAgents, targetOf, parseTarget, returnSignature, RETURN_LABEL, AWAY_PIECE, destinationOf, livePlaces } from "./since-left-model.js";
import { SinceLeft } from "./since-left.js";
import { REGISTRY, WORKTREES, keyOfSpace, keyOfProject, closedProjects, shownNames, startingProjects, folderName, addWorktree, worktreesOf, missingFolders, trimmed, sameProjects } from "./projects.js";
import { sleepingNow, asleepGroups, nameOf, seenNow, conversationOfThread, shownThread, terminalNames, agentKey, SHOWN_LABEL, PROJECT_LABEL, ID_LABEL } from "./roster.js";
import { pollable, activePlaces } from "./background.js";
import { listKey, moveTo, plainKey } from "./listkeys.js";
import { commitLayout, setRail, foldSidebar, railWidth, dropStripDrag } from "./layout.js";
import { afterMount, tryOr } from "./pure.js";
import { commandLoop, MachineRead } from "./sidebar.js";
import { gitFacts, openAhead, AHEAD } from "./sidebar-draw.js";
import { projectRow } from "./project-row.js";
import { computerRow, computerTools } from "./computer-row.js";
import { section } from "./section.js";
import { asleep } from "./asleep.js";
import { machineReaches, asleepLook, withPending, withoutWaking, FORGET_HELD, forgetHeld, holdForget } from "./row-states.js";
import { SLEEP_PENDING, SLEEP_WAKING, SLEEP_FAILED, COULD_NOT_SLEEP, failedTerminals, withoutTerminals, RESUME_LABEL, asleepTerminal } from "./resume.js";
import { tile } from "./tile.js";
import { views, viewSwitch } from "./view-switch.js";
import { pullKey, runPull, canWake, enterOpens, sectionMarkOf, sectionCount, rowDirectory, unnamedComputer, threadWord, threadActions, noProjectsOn, sortOf, foldTail, readWord } from "./sidebar-rows.js";
import { DIALOG, H, G, T, R, W, SIDEBAR, GLIDE, OPACITY, TINT, ARM_MS, alpha, sidebarSides, tokens } from "./ui.js";
import { ELBOW } from "./ui-row.js";
import { button, Armed } from "./ui-button.js";
import { dialog } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { menu, emptyState, skeletonOf, stack, tooltip } from "./kit.js";
import { boundChord, chordOf, hintOf } from "./ui-tooltip.js";
import { contextRows, contextMenu } from "./context-menu.js";
import { menuHeight, RUN_ROWS } from "./ui-menu.js";
import { pieceLines, openPieceMenu, hidePiece } from "./piece-lines.js";
import { toolbar } from "./toolbar.js";
import { header } from "./header.js";
import { pieces, shown, runs, asksPs, setPiece, pieceOf, STORE } from "./pieces.js";
import { machineRecord, canRestore, addArgs, rmArgs, hcError, needsLogin, heldNames, connectedNames, machinePhase, machineOf, visibleSpaces, visibleAgents, pollKeys, machineState, machineHot, machineStop, machineTip, listedMachines } from "./machines.js";
import { Names } from "./alias.js";
import { syncIcon, peerOn, withPeer } from "./sync.js";
import { withNeeds } from "./needs.js";
import { computerMenuItems } from "./computer-menu.js";
import { readSync, saveSync } from "./sync-row.js";
import { createAwake, keepAwake } from "./awake.js";
import { NEEDS_YOU, EMPTY_NOTICE_MS, waitingSignature, sleepingSignature, sameQueue, waitingQueue, nextWaiting, queueState } from "./needs-you.js";
import { queueControl, queueList } from "./needs-you-view.js";
import { Visits, visited, stepped, beside } from "./agent-nav.js";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, nextCommand, focused, home, appHome, pickFolder, knownAgents, notify, keys, updates } from "herdr";
import { sidebarFooter } from "./sidebar-footer.js";
import { ITEM, COLLAPSED, KANSO_SETTINGS, explainRefusal, refusalBlock, settingsEntries, updateLabel } from "./footer-model.js";
import { Updater, STATE as UPDATE_STATE } from "./update.js";
import { explainWith, findExplainer } from "./explain.js";

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
const CONV_ROWS = 11; // the conversation picker's projects show this many, then scroll
// A right click on the item does what a left one does.
const rightToo = (line) => ({ ...line, onSecondaryClick: line.onClick });
// An item's look without its act: a popup measured before it opens.
const sketch = (label, _act, { keep: _keep, ...look } = {}) => ({ ...look, label });
const RAIL_MENU_ROWS = 10; // a rail popup shows this many rows; the rest scroll
const CHILD_PAD = SIDEBAR.guideX + ELBOW.w + SIDEBAR.elbowGap - G.sm; // the icon starts past the elbow, inside the row's padding
// Every height is known before anything is drawn, so a scan (`laidOut`) finds where each pill goes.
// How long after the sidebar folds or opens its sizes are the layout landing, not a drag.
const SETTLE = 1000;
const item = (el, h = null, mark = null) => ({ el, h, mark });
// The space above a later section.
const lift = (h) => item(div().h(h).flex_none(), h);
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
const base = (path) => paths.basename(path);
// Changes made outside Herdr (an editor's save, a commit in another app) are found this often, while the window is in front.
const FALLBACK = 60000;
// A `ps` answers in milliseconds; one still out after this is taken for hung (psRun).
const PS_GIVE_UP_MS = 10000;
// Under the 30 s machine look, so a hung list is free before the next one.
const MACHINE_READ_MS = 20_000;
const HOME_EVERY_MS = 10 * 60_000;
const HOME_PROBE_MS = 8000;
const KNOWN_AGENTS = "kanso.agents.installed";

// The views' names, by key, as the view switch says them.
const VIEWS = Object.fromEntries(views.map(({ key, label }) => [key, label]));
// A project's stored hue, as the Storybook's avatar tone; its keys are the hues new projects take, least used first, in this order.
const HUES = { ansi6: "teal", ansi3: "yellow", ansi4: "blue", ansi5: "violet", ansi2: "green", ansi1: "red" };
// A project's tile shows its first letter, upper case.
const initialOf = (name) => (name?.[0] ?? "?").toUpperCase();
// A computer's phase as its row's state: loading is on, and breathes while it turns on.
const COMPUTER_STATE = { connected: "on", loading: "on", off: "off", unavailable: "unreachable", login: "login" };
// A project's key: its machine and folder.
export const projectKey = (w) => `${w?.machine ?? ""}:${w?.folder || home()}`;
const arrange = (props) => openOverlay({ mod: "kanso-sleep", kind: "dialog", width: DIALOG.wide, props });
// A folder as ~/ when it is under home.
const tilde = (path) => { const base = trimmed(home()); return base && paths.within(path, base) ? `~/${paths.relative(base, path)}` : path; };
const sleepTab = (spaceId, tab) => arrange({ sleep: { scope: "tab", space: spaceId, tab } });
// A settled tab wakes whole; a terminal asleep in a tab still shown wakes alone.
const wakeRow = (z) => arrange({ wake: z.settled ? { space: z.space, tab: z.tabId } : { space: z.space, terminal: z.terminal } });
const reachesRow = (a) => {
  const id = a.space ?? a.asleep?.space;
  if (!id) return true;
  const machine = spaces().find((s) => s.id === id)?.machine;
  if (!machine) return true;
  return machineReaches(machines().find((m) => m.name === machine)?.layout);
};
const openRow = (a) => {
  const open = enterOpens(a);
  if (open?.wake) { if (canWake(a, reachesRow(a))) wakeRow(open.wake); }
  else if (open?.focus) run("pane.focus", { pane: open.focus });
  else if (open?.peek) run("terminal.peek", { terminal: open.peek });
};
const sleepAgent = (spaceId, tab, pane) => arrange({ sleep: { scope: "agent", space: spaceId, tab, pane } });
const sleepProject = (spaceId) => arrange({ sleep: { scope: "project", space: spaceId } });
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
// A sleep's key as a project's (a trailing / never makes two of one place).
const sameKey = (key) => { const i = String(key).indexOf(":"); return `${key.slice(0, i)}:${trimmed(key.slice(i + 1))}`; };
const projectAt = (key) => registry().find((p) => keyOfProject(p) === sameKey(key)) ?? null;
const ROW_SHARED = [REGISTRY, NEEDS_YOU, "strip.state", SLEEP_PENDING, SLEEP_WAKING, SLEEP_FAILED, FORGET_HELD, KNOWN_AGENTS, "kanso.battery", "space.colors"];
const checksOn = () => runs("agents.checks", pieces(shared));
const rowInputs = () => ({ spaces: spaces(), panes: panes(), terminals: terminals(), agents: withNeeds(agents(), terminals(), checksOn()), machines: machines(), focused: focused(), front: window()?.active === true, keys: keys(),
  shared: ROW_SHARED.map((key) => shared(key)), pieces: Object.entries(pieces(shared)).filter(([id]) => id.startsWith("sidebar.")) });
const ROW_STATE = ["hoverRow", "hoverSpace", "hoverHead", "hoverMachine", "pressed", "over", "draggedAgent", "overAgent", "kbd", "navKey", "needsOpen", "needsEmpty", "foldH", "folded",
  "agentsFolded", "sectionsFolded", "asleepOpen", "shelvesOpen", "alive", "git", "held", "custom", "machines", "parked", "waking", "login", "failed", "pulling", "hints", "sync", "hostName"];
const ROW_REPLACED = ["threadsShown", "steps", "since", "tasks"];
const listed = (value) => (value instanceof Set || value instanceof Map ? [...value] : value);
const MINUTE_MS = 60_000;
const BORN_MS = 1500;
const bornBy = (at, now) => now - at > BORN_MS;
const narrowAt = (width) => (width ?? SIDEBAR.w) < SIDEBAR.narrow;
// Kanso's worktrees: beside its database here; on another machine, ~/.kanso/worktrees (the script's default).
const kansoWorktrees = (machine) => (machine ? "" : paths.join(appHome(), WORKTREES));
const spaceAt = (id) => spaces().findIndex((s) => s.id === id);
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

const CUT_DRAW_RETRY_MS = 250;
const CUT_DRAW_RETRY_MAX_MS = 4000;

class RetryingView extends View {
  render() {
    const finished = this.drawsFinished ?? 0;
    const started = (this.drawsStarted ?? 0) + 1;
    this.drawsStarted = started;
    const wait = Math.min(CUT_DRAW_RETRY_MS * 2 ** Math.max(0, started - 1 - finished), CUT_DRAW_RETRY_MAX_MS);
    this.clock.after(wait, (cx) => { if ((this.drawsFinished ?? 0) < started) cx.notify(); });
    try {
      return this.draw();
    } finally {
      this.drawsFinished = Math.max(this.drawsFinished ?? 0, started);
    }
  }
}

class LookView extends RetryingView {
  init(look, cx) {
    this.look = look;
    this.clock = cx.timer;
  }
  update(look) { this.look = look; }
}

const sidebarPart = (owner) => class SidebarPart extends LookView {
  init(look, cx) {
    super.init(look, cx);
    if (look.piece === "switch") owner.makeFind();
  }
  draw() {
    if (this.look.piece === "header") return owner.header(this.look);
    if (this.look.piece === "switch") return owner.switchPart(this.look);
    return owner.rows(this.look);
  }
};

export class SidebarFooter extends LookView {
  init(look, cx) {
    super.init(look, cx);
    this.armed = new Armed();
    this.menuOpen = false;
    this.settingsFocus = cx.focus_handle();
    this.updater = new Updater();
    this.updater.start(cx, { polls: false });
    this.explainer = null;
    this.lookup = null;
    cx.timer.after(0, (later) => this.known(later));
  }

  settingsMenu() {
    if (!this.menuOpen) return null;
    const acts = {
      [ITEM.kanso]: (cx) => { this.setMenu(false, cx); run(KANSO_SETTINGS); },
      [ITEM.herdr]: (cx) => { this.setMenu(false, cx); run("app.settings"); },
      [ITEM.updateHerdr]: (cx) => this.armed.press(ITEM.updateHerdr, cx, () => run("app.update")),
    };
    const { ready, hint } = this.look;
    const entries = settingsEntries({ ready, hint });
    return menu({ title: "Settings", items: entries.map((entry) => (entry.separator ? entry : { ...entry, armed: this.armed.is(entry.key), onClick: acts[entry.key] })) });
  }

  setMenu(open, cx) {
    this.menuOpen = open;
    cx.notify();
  }

  agent() {
    this.lookup ??= findExplainer().then((agent) => {
      this.explainer = agent;
      return agent;
    });
    return this.lookup;
  }

  known(later, use = () => {}) {
    return later.spawn(async (again) => {
      use(await this.agent());
      again.notify();
    });
  }

  explain(why, cx) {
    cx.timer.after(0, (later) => this.known(later, (agent) => explainWith(agent, { name: "Explain the update", folder: appHome(), task: explainRefusal(why) })));
  }

  draw() {
    const { collapsed } = this.look;
    const update = this.updater.available(), busy = Boolean(this.updater.busy);
    const why = update && !busy ? this.updater.refused() : null;
    const install = (cx) => this.updater.install(cx), refused = why ? refusalBlock(why, this.explainer?.name ?? "an agent") : null, menu = this.settingsMenu();
    const machine = shown("footer.machine", true, pieces(shared));
    const presses = { ...(update ? { "refresh-cw": install } : {}), ...(machine ? { server: () => run("mod.open", { name: "kanso-computers" }) } : {}), ...(refused && !collapsed ? { [refused.fix]: install, [`Explain to ${refused.agent}`]: (cx) => this.explain(why, cx) } : {}), ...(menu ? {} : { settings: (cx) => this.setMenu(true, cx) }) };
    return sidebarFooter({ update: update && updateLabel(update, busy), busy, refused, menu, collapsed, machine })(
      "footer", tokens(theme()), { presses, focuses: { settings: this.settingsFocus }, onOpen: (open, cx) => this.setMenu(open, cx) });
  }
}

export default class Spaces extends RetryingView {
  names = new Names(this);

  init(_props, cx) {
    this.clock = cx.timer;
    this.settleUntil = Date.now() + SETTLE;
    // Opened as a row's right-click menu (props().menu): nothing else to run.
    if (props()?.menu || props()?.awayMenu || props()?.railMenu || props()?.spaceMenu || props()?.newAgent || props()?.trees || props()?.worktree || props()?.newConversation || props()?.newProject || props()?.machineMenu) {
      // Nothing is chosen for you: no row lit until the keyboard moves.
      this.armed = new Armed(); this.menuAt = -1; this.handle = cx.focus_handle();
      // A scroll handle is state: made here, never during render (Herdr refuses it there).
      if (props()?.newConversation || props()?.railMenu) this.convScroll = ScrollHandle.new();
      if (props()?.newAgent) this.agentScroll = ScrollHandle.new();
      this.openPopup(cx); return;
    }
    this.loadNames().catch(() => {});
    this.handle = cx.focus_handle(); // the list by keyboard (enterList)
    this.armed = new Armed();
    this.pulling = false;
    this.needsScroll = ScrollHandle.new();
    this.listScroll = ScrollHandle.new();
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
    this.hints = {};
    this.sync = { config: {}, status: {} };
    this.hostName = "";
    // The first frame uses localStorage's copy; the database's answer replaces it when it comes.
    this.panel = new Panel(PREFS, this.leftNavStore());
    this.panelReady = false;
    this.sinceLeft = new SinceLeft(this.leftNavStore().kdb, (cx) => this.redraw(cx));
    this.prSeenAt = shared("kanso.pr.seen")?.at ?? 0;
    this.applyPrefs();
    cx.spawn(async (cx) => {
      this.panelTried = Date.now();
      try { if (await this.panel.load()) this.applyPrefs(); this.panelReady = true; } catch { /* tried again from keepSeen; the copy stays meanwhile */ }
      this.redraw(cx);
    });
    this.orderOpen = null;
    this.threads = null; // terminal -> its conversation (threads.js), once read
    // A pre-2.7 hide choice moves into the pieces map once.
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
    this.awake = createAwake({ now: () => Date.now(), run: (call) => exec(call.command, call.args, { on: call.on, timeout: call.timeout }) });
    this.machineRead = new MachineRead();
    afterMount(cx, (cx) => this.refreshMachines(cx));
    cx.spawn(async (cx) => {
      const rev = this.parkRev ?? 0;
      try {
        const rows = (await this.db().machinesOff()).map((row) => machineRecord(row)).filter(Boolean);
        if ((this.parkRev ?? 0) !== rev) return;
        this.parked = rows;
        await this.settleParked();
      } catch { /* the next look reads it */ }
      this.redraw(cx);
    });
    cx.spawn(async (cx) => {
      try {
        const result = await localService(systemApi).hostname({ short: false });
        const name = String(result?.stdout ?? "").replace(/\r/g, "").trim();
        if (result?.code === 0 && name) { this.hostName = name; this.redraw(cx); }
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
    // Another window's names and projects arrive.
    cx.timer.every(30000, () => this.loadNames(false).catch(() => {}));
    // keys.json: ⌃1-9 and ⌃⌥P/S/T arrive here as commands.
    afterMount(cx, (cx) => cx.spawn((cx) => commandLoop(
      () => nextCommand(),
      () => cx.notify(),
      (command) => this.command(String(command).replace(/^kanso-spaces\./, ""), cx),
      cx.timer,
    )));
    this.mountParts(cx);
  }

  mountParts(cx) {
    const Part = sidebarPart(this);
    this.rowsChanged();
    const looks = this.looks();
    this.parts = { header: cx.new(Part, looks.header), switch: cx.new(Part, looks.switch), rows: cx.new(Part, looks.rows), footer: cx.new(SidebarFooter, looks.footer) };
    this.drawnLooks = looks;
    this.paintTimer = cx.timer;
  }

  looks() {
    const collapsed = shared(COLLAPSED) === true, map = pieces(shared), bindings = keys();
    const switchOn = shown("sidebar.switch", true, map) !== false;
    const view = switchOn ? this.view : "spaces";
    const finding = Boolean(this.finding && !collapsed);
    const orders = { order: this.order, statusOrder: this.statusOrder, threadOrder: this.threadOrder, threadGroup: Boolean(this.threadGroup) };
    const { latest = null, channel = null, tag = null, refused = null, installs = null } = shared(UPDATE_STATE) ?? {};
    return {
      header: { piece: "header", view, collapsed, tools: this.toolsOpen === true, sortOpen: this.orderOpen ?? null, ...orders,
        activity: shown("sidebar.activity", true, map) !== false, away: runs("sidebar.away", map) !== false, switch: switchOn },
      switch: { piece: "switch", view: this.view, collapsed, finding, focused: finding && this.find.focused === true, shown: switchOn && !(collapsed && view === "spaces"),
        open: collapsed && this.viewMenu === true, asks: visibleSpaces(spaces(), this.offNames()).some((s) => s.status === "blocked"),
        chords: Object.fromEntries(Object.keys(VIEWS).map((key) => [key, boundChord(`kanso-spaces.view-${key}`, bindings)])) },
      rows: { piece: "rows", view, collapsed, ...orders, query: finding ? this.find.value() : null, at: this.rowsAt ?? 0 },
      footer: { collapsed, update: { latest, channel, tag, refused, installing: Object.keys(installs ?? {}).toSorted() }, ready: updates()?.app?.ready ?? null, hint: hintOf(KANSO_SETTINGS, bindings) },
    };
  }

  redraw(cx) {
    if (!this.parts) { cx.notify(); return; }
    this.paint();
  }

  rowsShown(now = Date.now()) {
    const fold = this.folding && { ...this.folding, moving: this.unfolded(this.folding.id, false, now) };
    const host = rowInputs(), away = this.sinceLeft;
    const times = [...host.agents.map((a) => [elapsed(a, this.since ?? {}, now), stepOf(a, this.steps, now)]),
      ...Object.values(this.tasks ?? {}).flat().map((x) => duration(Math.max(0, now - x.start)))];
    return JSON.stringify({ ...host, own: ROW_STATE.map((key) => listed(this[key])), fold, away: away?.rows.length ? [away.project, away.expanded, away.target, away.rows] : null,
      remembered: listed(this.panel?.agents), ring: Boolean(this.kbd && this.handle.is_focused()), narrow: narrowAt(this.width),
      born: Object.entries(this.born ?? {}).map(([id, at]) => [id, bornBy(at, now)]), times, minute: Math.floor(now / MINUTE_MS) });
  }

  rowsReplaced() {
    return [...ROW_REPLACED.map((key) => this[key]), this.names.book];
  }

  rowsChanged() {
    const read = this.rowsShown(), replaced = this.rowsReplaced();
    const changed = read !== this.rowsRead || replaced.some((value, i) => value !== this.rowsRefs?.[i]);
    this.rowsRead = read;
    this.rowsRefs = replaced;
    return changed;
  }

  paint() {
    if (this.rowsChanged()) this.rowsAt = (this.rowsAt ?? 0) + 1;
    const next = this.looks();
    Object.entries(next).filter(([name, look]) => JSON.stringify(look) !== JSON.stringify(this.drawnLooks?.[name])).forEach(([name, look]) => this.parts[name].set_props(look));
    this.drawnLooks = next;
  }

  leftNavStore() {
    return (this.navStore ??= new Store(new Kdb(this.clock)));
  }

  // A popup of this mod: what it shows that has to be read first is read here.
  openPopup(cx) {
    const p = props();
    if (p.newProject) {
      this.projectName = new TextField({ placeholder: "Its name" });
      this.projectName.on("submit", (_e, cx) => this.createProject(cx));
      this.projectFolder = null;
      this.projectName.focus();
      return;
    }
    if (p.worktree) {
      this.branch = new TextField({ placeholder: "feat/my-change" });
      this.branch.on("submit", (_e, cx) => this.makeWorktree(cx));
      this.branch.focus();
      return;
    }
    this.handle.focus();
    if (p.newAgent) {
      this.askAgents(p.newAgent, cx);
      if (p.start && p.newAgent.folder && !p.newAgent.tree) {
        worktreesOf(p.newAgent.folder, p.newAgent.machine || null).then((list) => { this.repo = list.length > 0; this.trees = list.filter((x) => !x.main && !x.prunable); this.redraw(cx); });
      }
    }
    const place = p.spaceMenu ? this.menuPlace(p.spaceMenu) : null;
    // A worktree whose folder was deleted (prunable) is only git's note of it: not listed.
    if (place?.folder) {
      worktreesOf(place.folder, place.machine || null).then((list) => { this.trees = list.filter((x) => !x.main && !x.prunable); this.redraw(cx); });
    }
  }

  close() {
    try { this.branch?.release(); this.projectName?.release(); this.convScroll?.release(); this.agentScroll?.release(); this.find?.release(); } catch { /* already gone */ }
  }

  menuPlace(m) {
    const w = m.id ? spaces().find((s) => s.id === m.id) : null;
    return w ? placeOfSpace(w) : m.key ? placeOfKey(m.key) : null;
  }

  // Projects: the database's, read again after each change so every window draws the same.
  async loadProjects(kdb) {
    // Once, when every machine's spaces are in: the spaces open now become your projects.
    // Read here, after the waits before it, so spaces that came in meanwhile are not left out.
    if (!this.projectsIn && !machines().some((m) => m.layout === "loading")) {
      await kdb.migrateProjects(startingProjects(spaces(), home()));
      this.projectsIn = true;
    }
    await this.publishRegistry(kdb);
  }

  async publishRegistry(kdb) {
    const list = await kdb.projects();
    const folders = list.filter((p) => !p.machine).map((p) => p.folder);
    const signature = JSON.stringify([list, folders]), now = Date.now();
    if (signature !== this.folderSignature || now - this.foldersAt >= 300000) {
      this.folderMissing = await missingFolders(folders);
      this.folderSignature = signature;
      this.foldersAt = now;
    }
    const missing = this.folderMissing;
    // Only this computer's folders are looked at: another machine's project is never called gone from here.
    const shown = list.map((p) => ({ id: p.id, name: p.name, folder: p.folder, machine: p.machine ?? "", agent: p.agent ?? null, missing: !p.machine && missing.has(p.folder) }));
    if (JSON.stringify(shown) !== JSON.stringify(registry())) setShared(REGISTRY, shown);
    return shown;
  }

  // The sidebar's own database handle; a popup has its own.
  db() { return this.leftNavStore().kdb; }

  // A project's name and folder, asked in a dialog; `start`: a conversation begins in it once made.
  addProject(start = false) {
    openOverlay({ mod: "kanso-spaces", kind: "dialog", width: DIALOG.sidebar, props: { newProject: { start } } });
  }

  // The click's context ends with the click: the dialog redraws from its own spawned one.
  chooseProjectFolder(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Choose" }).catch(() => null);
      if (!folder) return;
      this.projectFolder = trimmed(folder);
      if (!this.projectName.value().trim()) this.projectName.set_value(folderName(folder));
      this.projectError = null;
      this.redraw(cx);
    });
  }

  createProject(cx) {
    if (this.creating) return;
    const name = this.projectName.value().trim(), folder = this.projectFolder, start = Boolean(props().newProject?.start);
    if (!folder) { this.projectError = "Choose its folder."; this.redraw(cx); return; }
    this.creating = true;
    cx.spawn(async (cx) => {
      try {
        const { row, existed } = await this.db().addProject({ name: name || folderName(folder), folder, machine: "" });
        await this.publishRegistry(this.db());
        const open = spaces().find((w) => keyOfSpace(w, home()) === keyOfProject(row));
        if (existed) notify({ title: `${row.name} is already one of your projects`, level: "info", timeout: 4000 });
        closeOverlay(props().overlay);
        // Then which agent: the ones you have installed, none chosen for you.
        if (start) this.newAgentMenu(open ? placeOfSpace(open) : placeOfKey(keyOfProject(row), row));
        else if (open) run("space.select", { id: open.id });
      } catch (e) { this.projectError = String(e?.message ?? e); }
      finally { this.creating = false; this.redraw(cx); }
    });
  }

  newProjectView(t) {
    const start = Boolean(props().newProject?.start);
    const shown = this.projectFolder ? this.projectFolder.replace(trimmed(home()), "~") : "No folder chosen";
    const c = tokens(t);
    const label = (text) => div().text_size(T.body).text_color(t.muted).child(text);
    return dialog("project-dialog", c, {
      title: start ? "New project with a conversation" : "New project",
      body: [
        label("Folder"),
        h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(T.value).text_color(this.projectFolder ? t.foreground : t.dim).child(shown))
          .child(button("project-choose", this.projectFolder ? "Change\u2026" : "Choose\u2026", (cx) => this.chooseProjectFolder(cx), c, { kind: this.projectFolder ? "tonal" : "solid" })),
        field("project-name", this.projectName, c, { label: "Name, optional" }).pt(G.sm),
      ],
      notes: [{ text: this.projectError ?? (start ? "Then you choose the agent that starts in it." : "It stays in Projects even with nothing open."), tone: this.projectError ? "error" : "dim" }],
      secondary: "Cancel", primary: start ? "Create and choose agent" : "Create project", state: this.creating ? "loading" : this.projectFolder ? "default" : "disabled",
      onCancel: () => closeOverlay(props().overlay), onPrimary: (cx) => this.createProject(cx),
    });
  }


  // Opens at the height its Menu draws.
  newConversationMenu() {
    const height = menuHeight(this.conversationLines(sketch, () => {}));
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height, at: "pointer", props: { newConversation: true } });
  }

  // Every project: the open ones (each space), then the ones you added that have none open.
  conversationEntries() {
    const sp = spaces();
    const closed = closedProjects(registry(), sp, home()).filter((p) => !p.missing);
    const names = shownNames(registry());
    return [
      ...sp.map((w) => ({ id: `conv-${w.id}`, place: placeOfSpace(w), hint: w.machine ?? null })),
      // The shown name tells two alike apart; the space keeps the project's own.
      ...closed.map((p) => ({ id: `conv-${p.id}`, place: placeOfKey(keyOfProject(p), p), hint: p.machine || "closed", label: names.get(p.id) ?? p.name })),
    ];
  }

  // Under the line: a new project, a folder, and Add computer unless it is switched off.
  conversationActions() {
    const machine = shown("footer.machine", true, pieces(shared));
    return [
      { id: "conv-add-project", label: "New project with a conversation\u2026", act: () => this.addProject(true), icon: "folder-plus" },
      { id: "conv-folder", label: "Open a folder, no project\u2026", act: () => run("kanso-spaces.open-folder"), icon: "file" },
      ...(machine ? [{ id: "conv-machine", label: "Add computer\u2026", act: () => run("mod.open", { name: "kanso-computers" }), icon: "server" }] : []),
    ];
  }

  // Every project in a run that scrolls, then the other ways in; a project chosen asks which agent.
  conversationLines(item, start) {
    const entries = this.conversationEntries();
    return {
      title: "New conversation in",
      items: [
        { scroll: entries.map((e) => rightToo(item(e.label ?? e.place.name ?? "~", () => start(e.place), { hint: e.hint, keep: true }))), rows: CONV_ROWS, handle: this.convScroll },
        { separator: true },
        ...this.conversationActions().map(({ label, act, icon }) => item(label, act, { icon })),
      ],
    };
  }

  newConversationView(t) {
    // A project chosen, then which agent, in its own menu: nothing is started for you.
    const start = (place) => { closeOverlay(props().overlay); this.newAgentMenu(place); };
    const { title, items } = this.conversationLines(this.lines(), start);
    this.menuScroll = this.convScroll ? { handle: this.convScroll, count: items[0].scroll.length, from: 0 } : null;
    return this.popup(t, title, items);
  }

  // A project's + : asks which agent, of the ones installed. `start`: the sidebar's own +, whose menu goes on to New project and Arrange.
  newAgentMenu(place, start = false) {
    const failure = () => ({ failure: { text: `Can't list agents on ${place.machine || "this computer"}`, source: "-", fix: "Refresh", agent: "-" } });
    const run = (item) => Array.from({ length: RUN_ROWS }, () => item(""));
    const settled = (state) => menuHeight(this.agentLines(place, { start, repo: start, trees: start ? [place] : [], item: sketch, ...state }));
    const height = Math.max(settled({ pending: true }), settled({ failure }), settled({ agents: run }), settled({ agents: run, failure }));
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height, at: "pointer", props: { newAgent: place, height, ...(start ? { start } : {}) } });
  }

  agentLines(place, { start, agents = null, pending = false, failure = null, repo, trees, item, room = Infinity }) {
    const name = place.tree?.branch ?? place.name ?? "this project";
    const head = [{ heading: place.machine ? `${place.machine} \u00b7 ${name}` : name, mark: this.checking && this.known ? "working" : null },
      item("Terminal", () => this.pickAgent(place, null), { icon: "terminal", hint: chordOf("tab.new") || null, keep: true }), { separator: true }];
    const rows = agents ? agents(item) : [];
    const failed = failure ? [failure()] : [];
    const newTree = () => item("New worktree\u2026", () => this.worktreeDialog(place), { icon: "git-branch" });
    const rest = start ? [item("New project", () => this.addProject(), { icon: "folder-plus" }),
      ...(repo ? [newTree(), ...(trees?.length ? [item("Open worktree\u2026", () => this.treesMenu(place, this.trees), { icon: "git-fork" })] : [])] : []),
      { separator: true }, item("Arrange\u2026", () => run("kanso-strip.arrange"), { icon: "panels-top-left", hint: chordOf("kanso-strip.arrange") || null })]
      : place.tree ? [] : [newTree()];
    const ends = rest.length ? [{ separator: true }, ...rest] : [];
    const row = menuHeight({ items: [sketch("")] }) - menuHeight({ items: [] });
    const fit = Math.max(1, Math.floor((room - menuHeight({ items: [...head, ...failed, ...ends] })) / row));
    const listed = rows.length ? [{ scroll: rows, rows: Math.min(rows.length, fit), handle: this.agentScroll }] : !failure && pending && !agents ? [{ loading: true }, { loading: true }] : [];
    const middle = [...listed, ...failed];
    return { items: [...head, ...middle, ...ends], count: rows.length };
  }

  pickAgent(place, a) {
    if (this.starting) return;
    this.starting = true;
    const project = registry().find((p) => p.id === place.project) ?? null;
    viewerFor(place.machine).then((viewed) => {
      const argv = viewed(a?.run ?? null);
      if (place.tree) openAt(place, place.tree.folder, argv, place.tree.branch);
      else startIn(place, argv);
    });
    this.thenClose(project && a ? this.db().setProjectAgent(project.id, a.key) : null);
  }

  // The toolbar's +, one menu in every view: the open project's agents and Terminal, then a new project, then Arrange. With no project open it asks which.
  startMenu(view) {
    const open = spaces().find((w) => w.active);
    if (open) this.newAgentMenu(placeOfSpace(open), true);
    else if (view === "spaces") this.addProject();
    else this.newConversationMenu();
  }

  inFront() {
    return typeof window === "function" && window()?.active === true;
  }

  // A remote computer's own database, found by its home there.
  storeOn(machine) {
    this.remoteStores ??= new Map();
    if (!this.remoteStores.has(machine)) {
      const store = serviceOn(async (platform, run) => {
        const there = await systemApi(platform, run).userHome();
        if (!there) throw new Error(`${machine}'s home could not be read`);
        return new Store(new Kdb(this.clock, kansoDir(there, platform), machine));
      }, machine);
      store.catch(() => this.remoteStores.delete(machine));
      this.remoteStores.set(machine, store);
    }
    return this.remoteStores.get(machine);
  }

  // Computer names and projects: this computer's database when asked or every two minutes, another's when due (restDue).
  async loadNames(force = true) {
    const now = Date.now(), kdb = this.db(), active = this.inFront();
    const local = force || this.names.pending() || now - (this.namesAt ?? 0) >= 120000;
    const rows = local ? await kdb.aliases(this.names.pending() ?? [], now).catch(() => null) : null;
    if (rows) {
      this.namesAt = now;
      this.names.absorb(rows, now);
      await this.loadProjects(kdb).catch(() => {});
    }
    const due = machinesToAsk(machines(), spaces()).filter((name) => !machineState(this.phaseOf(name))
      && restDue({ readAt: this.remoteAt?.get(name) ?? null, now, active, showing: true }));
    await Promise.all(due.map(async (name) => {
      const store = await this.storeOn(name);
      this.names.took(name, await store.kdb.aliases([this.names.owed(name)].filter(Boolean), now), now);
      (this.remoteAt ??= new Map()).set(name, now);
    }).map((p) => p.catch(() => {})));
  }

  // A space that isn't there is nothing to do, not an error.
  command(c, cx) {
    const space = /^space-(\d)$/.exec(c), view = /^view-(spaces|agents|threads)$/.exec(c);
    if (space) { const i = Number(space[1]); if (i >= 1 && i <= spaces().length) run("space.select", { index: i }); }
    else if (view) { this.setView(view[1], cx); this.paint(); }
    else if (c === "asleep") this.showAsleep(cx);
    else if (c === "needs-you.next") this.nextNeeds(cx);
    else if (c === "agent-up" || c === "agent-down") this.besideAgent(c === "agent-up" ? -1 : 1);
    else if (c === "agent-back" || c === "agent-forward") this.stepAgent(c === "agent-back" ? -1 : 1, cx);
    else if (c.startsWith("retry-machine:") && c.length > "retry-machine:".length) this.retryMachine(c.slice("retry-machine:".length), cx);
    // From a computer's menu, which is gone once clicked: the sidebar holds the computer's state.
    else if (c.startsWith("power-machine:") && c.length > "power-machine:".length) { const m = c.slice("power-machine:".length); this.setPower(m, this.phaseOf(m) === "off", cx); }
    else if (c.startsWith("sync-machine:") && c.length > "sync-machine:".length) this.toggleSync(c.slice("sync-machine:".length), cx);
    else if (c.startsWith("sign-in-machine:") && c.length > "sign-in-machine:".length) this.signIn(c.slice("sign-in-machine:".length));
    else if (c.startsWith("remove-machine:") && c.length > "remove-machine:".length) this.removeMachine(c.slice("remove-machine:".length), cx);
    else if (c.startsWith("restore-machine:") && c.length > "restore-machine:".length) this.restoreMachine(c.slice("restore-machine:".length), cx);
    else if (c === "sidebar") this.toggleRail();
    else if (c === "needs-you.list") this.toggleNeeds(cx);
    else if (c === "away-dismiss") this.sinceLeft?.dismiss(cx);
    else if (c === "away-off") hidePiece("sidebar.away");
    else if (c === "list") this.enterList(cx);
    // From a popup, which is gone once clicked: the sidebar asks for the folder.
    else if (c === "add-project") this.addProject();
    else if (c === "add-project-start") this.addProject(true);
    else if (c === "new-conversation") this.newConversationMenu();
    else if (c === "start") this.startMenu(this.shownView());
    else if (c === "open-folder") pickFolder({ prompt: "Open" }).then((folder) => folder && run("space.new", { folder, machine: "" })).catch(() => {});
    else if (c === "list-up" || c === "list-down") {
      if (this.kbd) this.listKeyDown({ key: c === "list-up" ? "up" : "down", modifiers: {} }, cx);
      // Not on the list any more: the flag was stale; the strip takes it.
      else { setShared("kanso.list", null); run(`kanso-strip.go-${c === "list-up" ? "up" : "down"}`); }
    }
  }

  background(sp = spaces(), ps = panes()) {
    const dozing = this.sleepingNow(sp, terminals(), ps).dozing, layouts = machines();
    return { dozing, layouts, allows: (address) => pollable(address, dozing, layouts) };
  }

  // What the sidebar's own work may touch: the places awake, and the computers that answer.
  activePlacesOf(sp, ps) {
    const background = this.background(sp, ps);
    return { background, allowed: activePlaces(sp, ps, background.dozing, background.layouts) };
  }

  pollingPlaces(sp = spaces(), ps = panes(), places = placesOf(sp, ps)) {
    const { allowed } = this.activePlacesOf(sp, ps);
    return new Map([...places].filter(([id]) => allowed.has(id)));
  }

  refreshNeeds(sp = spaces(), terms = terminals(), asleep = this.sleepingNow(sp, terms)) {
    const list = withNeeds(agents(), terms, checksOn()), layouts = machines();
    const signature = waitingSignature(list, terms, asleep.dozing, NAME_LABEL);
    const layoutSignature = layouts.map((m) => m.layout).join(",");
    const changed = signature !== this.needsSignature || this.threadsShown !== this.needsThreads;
    if (!changed && layoutSignature === this.needsLayoutSignature) return this.needsQueue;
    this.needsSignature = signature;
    this.needsThreads = this.threadsShown;
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

  jumpNeeds(row, cx, rows = this.refreshNeeds().rows) {
    const live = rows.find((a) => a.address === row.address && a.pane === row.pane);
    if (!live) return;
    this.needsCursor = live;
    this.leaveList(cx, false);
    run("agent.focus", { terminal: live.address });
  }

  nextNeeds(cx) {
    const terms = terminals(), asleep = this.sleepingNow(spaces(), terms);
    const rows = waitingQueue(withNeeds(agents(), terms, checksOn()), terms, asleep.dozing, this.refreshNeeds().rows, Date.now(), ["blocked", "done"]);
    const row = nextWaiting(rows, this.needsCursor);
    if (row) { this.jumpNeeds(row, cx, rows); return; }
    this.needsCursor = null;
    this.needsEmpty = true;
    const at = (this.needsEmptyAt ?? 0) + 1;
    this.needsEmptyAt = at;
    cx.timer.after(EMPTY_NOTICE_MS, (cx) => { if (this.needsEmptyAt === at) { this.needsEmpty = false; this.redraw(cx); } });
    this.redraw(cx);
  }

  visit(list = agents()) {
    return Visits.keep(visited(Visits.now, list.find((a) => a.focused)?.address));
  }

  stepAgent(by) {
    const list = agents(), live = new Set(list.map((a) => a.address));
    const step = stepped(this.visit(list), by, (address) => live.has(address));
    if (!step) return;
    Visits.keep(step.visits);
    openRow(list.find((a) => a.address === step.to));
  }

  agentOrder() {
    const sp = visibleSpaces(spaces(), this.offNames()), ps = panes(), terms = terminals(), dozing = this.sleepingNow(sp, terms, ps).dozing;
    const ctx = { terms, alive: this.alive, strip: shared("strip.state") ?? {}, places: placesOf(sp, ps), now: Date.now(), asleep: { rows: [] },
      spaceIds: new Set(sp.map((w) => w.id)), all: this.listed(ps, sp, terms).filter((a) => !dozing.has(a.address)) };
    const view = shown("sidebar.switch", true, pieces(shared)) !== false ? this.view : "spaces";
    const rows = view === "agents" ? this.statusSections(sp, ctx).flatMap((s) => s.entries.map((e) => e.a))
      : view === "threads" ? (this.threads ? threadSections(this.threadRows(ctx), { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} }).flatMap((s) => s.rows.map((r) => r.a)) : [])
      : this.byComputer(this.ordered(sp, ctx.places)).flatMap((r) => nest(this.spaceRows(r.w.id, ctx), terms).map((e) => e.a));
    const live = new Set(agents().map((a) => a.address));
    return rows.filter((a) => !a.sub && live.has(a.address));
  }

  // As machineBlock draws them: this computer's projects, then each other computer's by name.
  byComputer(rows) {
    const remote = [...new Set(rows.map((r) => r.w.machine).filter(Boolean))].toSorted();
    if (!remote.length || !shown("sidebar.computers", true, pieces(shared))) return rows;
    return [null, ...remote].flatMap((m) => rows.filter((r) => (r.w.machine ?? null) === m));
  }

  besideAgent(by) {
    const order = this.agentOrder(), list = agents();
    const to = order.find((a) => a.address === beside(order.map((x) => x.address), list.find((a) => a.focused)?.address, by));
    if (!to) return;
    this.visit(list);
    Visits.keep(visited(Visits.now, to.address));
    openRow(to);
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
    this.redraw(cx);
  }

  needsList(t, queue, now) {
    return queueList(t, queue, (row) => {
      const go = (cx) => this.jumpNeeds(row, cx);
      return { go, selected: this.navMark(`agent:${row.address}`, go) };
    }, (row) => duration(Math.max(0, now - row.at)), this.needsScroll);
  }

  // Rows add themselves as they draw (navMark), in screen order; Esc goes back to the pane you came from.
  // Search opens a field in place of the view switch; the list narrows to what matches, a project kept as context. Esc brings the list back as it was.
  makeFind() {
    this.find = new TextField({ placeholder: "Find" });
    this.find.on("change", () => this.paint());
    this.find.on("focus", () => this.paint());
    this.find.on("blur", () => this.paint());
    this.find.on("submit", (_e, cx) => { this.enterList(cx, true); this.redraw(cx); });
  }

  openFind() {
    if (shared("sidebar.collapsed") === true) { run("mod.open", { name: "picker" }); return; }
    this.finding = true;
    this.find.focus();
    this.paint();
  }

  closeFind() {
    this.finding = false;
    this.find.set_value("");
    this.handle.focus();
    this.paint();
  }

  findField(t) {
    const c = tokens(t);
    return stack({ variant: "sidebar find" }, field("spaces-find-field", this.find, c, { lead: "search", icon: "x", iconTip: "Close", onIcon: () => this.closeFind(), spoken: "Find" }))("spaces-find", c)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.closeFind(); } });
  }

  // What the sidebar already knows, by name, step, branch or folder; a project that matches keeps all its sessions, one that does not stays for the sessions that do.
  narrowed(query, sp, ctx) {
    const has = (...parts) => parts.some((part) => String(part ?? "").toLowerCase().includes(query));
    const own = new Map(sp.map((w) => [w.id, has(w.name, w.folder, this.git[ctx.places.get(w.id)?.key]?.branch)]));
    const hit = (a) => has(this.nameOf(a), a.title, a.activity, a.cwd);
    const rowsBy = new Map(sp.map((w) => [w.id, own.get(w.id) ? ctx.rowsBy.get(w.id) ?? [] : (ctx.rowsBy.get(w.id) ?? []).filter(hit)]));
    const kept = sp.filter((w) => own.get(w.id) || rowsBy.get(w.id).length);
    const registry = ctx.registry.filter((p) => has(p.name, p.folder));
    const all = ctx.all.filter((a) => hit(a) || own.get(this.projectFor(a, ctx)));
    return { sp: kept, ctx: { ...ctx, rowsBy, registry, all, spaceIds: new Set(kept.map((w) => w.id)) }, none: !kept.length && !registry.length && !all.length };
  }

  enterList(cx, first = false) {
    if (shared("sidebar.collapsed") === true || !(this.nav ?? []).length) return;
    const f = focused();
    this.listFrom = f?.pane ?? null;
    const here = (!first && this.nav.find((n) => n.here)) || this.nav[0];
    this.navKey = here.key;
    this.kbd = true;
    this.handle.focus();
    // For the strip: ⌘⌥l (or →) now goes back to that pane.
    setShared("kanso.list", { from: this.listFrom, at: Date.now() });
    this.redraw(cx);
  }

  leaveList(cx, back = true) {
    this.kbd = false;
    if (shared("kanso.list")) setShared("kanso.list", null);
    if (back && this.listFrom) run("pane.focus", { pane: this.listFrom });
    this.redraw(cx);
  }

  // True when the keyboard's ring is on this row; `go` is its click, `here` the row you are in.
  navMark(key, go, here = false) {
    this.navNext = [...(this.navNext ?? []), { key, go, here }];
    return Boolean(this.kbd) && this.navKey === key;
  }

  navRow(a, row) {
    const go = () => openRow(a);
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
    if (!move && plain && (k === "/" || e.key_char === "/")) { this.leaveList(cx, false); this.openFind(); cx.stop_propagation?.(); return; }
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
      this.redraw(cx);
      return;
    }
    const next = moveTo(move, at, nav.length);
    this.navKey = nav[next]?.key ?? this.navKey;
    if (this.needsOpen) this.needsScroll?.scroll_to_item(next);
    this.redraw(cx);
  }

  // One `ps` at a time for checkTasks and checkAlive: `psLook` is the start of the one out. One that has not answered in
  // PS_GIVE_UP_MS is given up on, so a hung `ps` never stops either; its late answer, if any, is dropped,
  // whether or not another has started since (behind, the next may be a minute away).
  psFree(now) {
    return this.psLook == null || now - this.psLook >= PS_GIVE_UP_MS;
  }
  async psRun(now, take) {
    this.psLook = now;
    try {
      const r = await localService(processApi).list();
      if (this.psLook === now && Date.now() - now < PS_GIVE_UP_MS) take(r);
    } catch { /* the last look stands */ }
    finally { if (this.psLook === now) this.psLook = null; }
  }

  // One process table serves tasks and conversation liveness.
  checkTasks(cx, now = Date.now(), active = window().active) {
    if (!this.psFree(now)) return;
    const background = this.background();
    const local = terminals().filter((k) => background.allows(k.address) && !k.address.includes("/"));
    const mine = local.filter((k) => k.state === "live" && k.status && (k.foreground?.pid ?? k.pid));
    const pids = pidsOf(Object.fromEntries(Object.entries(this.threads ?? {}).filter(([address, thread]) => !address.includes("/") && background.allows(address))));
    const foreground = new Set(local.filter((k) => k.state === "live").map((k) => k.foreground?.pid));
    const confirmed = aliveIn(foreground, pids), pending = pids.filter((pid) => !foreground.has(pid));
    const sig = pids.join(","), every = active ? ALIVE_MS : ALIVE_BEHIND_MS;
    if (pids.length && !pending.length) this.sawAlive(confirmed, sig, now, cx);
    const due = pending.length && aliveDue({ sig: this.aliveSig, at: this.aliveAt }, sig, now, every);
    const map = pieces(shared);
    const tasksOn = runs("sidebar.tasks", map);
    const working = mine.some((k) => k.status === "working");
    if (!working && !due) {
      if (!mine.length && Object.keys(this.tasks).length) { this.tasks = {}; this.redraw(cx); }
      return;
    }
    if (!asksPs(map, { working, alive: Boolean(due) })) {
      if (!tasksOn && Object.keys(this.tasks).length) { this.tasks = {}; this.redraw(cx); }
      return;
    }
    if (now - (this.psAt ?? -Infinity) < every) return;
    this.psAt = now;
    if (pids.length) { this.aliveSig = sig; this.aliveAt = now; }
    cx.spawn((cx) => this.psRun(now, (table) => {
      if (pids.length) this.sawAlive(new Set([...confirmed, ...aliveIn(table.byPid, pending)]), sig, now, cx);
      if (!tasksOn) {
        if (Object.keys(this.tasks).length) { this.tasks = {}; this.redraw(cx); }
        return;
      }
      const next = Object.fromEntries(mine.flatMap((k) => {
        const had = this.tasks[k.address] ?? [];
        const list = tasksOf(table, k.foreground?.pid ?? k.pid, Boolean(k.foreground?.pid))
          .map((x) => ({ pid: x.pid, command: x.command, start: had.find((h) => h.pid === x.pid)?.start ?? now - x.ms }));
        return list.length ? [[k.address, list]] : [];
      }));
      const key = (m) => JSON.stringify(Object.entries(m).map(([addr, l]) => [addr, l.map((x) => [x.pid, x.command])]));
      if (key(next) !== key(this.tasks)) { this.tasks = next; this.redraw(cx); }
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
      setRail(true, SIDEBAR.w);
      return;
    }
    // Applied on every start, so older layouts are brought in line.
    if (collapsed) setRail(false, railWidth());
    else setRail(true, shared("sidebar.width") ?? SIDEBAR.w);
  }

  // Opening or folding the sidebar shuts its menus for good: the view menu belongs to the rail, Sort's to the form it opened in.
  shutMenus() {
    this.viewMenu = false;
    this.orderOpen = null;
  }

  // A width the sidebar was dragged to opens it there; the Show sidebar tool opens it as you left it.
  openRail(dragged = null) {
    this.shutMenus();
    const width = dragged != null ? Math.round(dragged) : shared("sidebar.width") ?? SIDEBAR.w;
    this.settleUntil = Date.now() + SETTLE;
    setShared("sidebar.collapsed", false);
    if (dragged != null) setShared("sidebar.width", width);
    setRail(true, width);
  }

  // Remembers how wide you left it open (`width`, when known), to open it the same width.
  foldRail(width) {
    this.shutMenus();
    this.settleUntil = Date.now() + SETTLE;
    if (width != null) setShared("sidebar.width", Math.round(width));
    foldSidebar();
  }

  toggleRail() {
    if (shared("sidebar.collapsed") === true) this.openRail();
    else this.foldRail(this.width >= SIDEBAR.min ? this.width : null);
  }

  // Herdr sizes the sidebar as its edge is dragged: past SIDEBAR.min narrower it folds to the rail, and the rail dragged to SIDEBAR.min or wider opens.
  // The sizes while a fold or an open is still landing, and before the first draw settles, are not a drag.
  sized(w, cx) {
    const was = this.width;
    this.width = w;
    if (w > 0 && Date.now() >= (this.settleUntil ?? 0)) {
      const folded = shared("sidebar.collapsed") === true;
      if (folded && w >= SIDEBAR.min) { this.openRail(w); return; }
      if (!folded && w < SIDEBAR.min) { this.foldRail(null); return; }
    }
    if (narrowAt(was) !== narrowAt(w)) this.redraw(cx);
  }

  checkNew(cx) {
    this.names.paint(cx);
    const now = Date.now();
    const active = window().active;
    if (!active && now - (this.lastLook ?? 0) < 5000) return;
    this.lastLook = now;
    this.takeMoves();
    this.names.take(cx);
    const projects = registry();
    if (!sameProjects(projects, this.projectsSeen)) { this.projectsSeen = projects; this.redraw(cx); }
    this.trackFocus();
    const sp = visibleSpaces(spaces(), this.offNames());
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    if (sp.some((s) => !this.shown.has(s.id))) this.redraw(cx);
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
    if (due.size && this.shownView() === "spaces" && runs("sidebar.git", pieces(shared))) this.refreshGit(due, cx);
    if (now - (this.prunedAt ?? 0) > 30000) { this.prunedAt = now; this.prune(sp, now); }
  }

  trackReturn(sp, ps, active, now, cx) {
    if (this.sinceLeft.busy) return;
    if (!runs("sidebar.away", pieces(shared))) { this.returnSignature = null; this.sinceLeft.leave(); return; }
    const { background, allowed } = this.activePlacesOf(sp, ps);
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
    const places = changed ? livePlaces(live, (agent) => agentTargets(agent, this.seenNow?.get(agent.address), terms.get(agent.address))) : this.returnPlaces;
    const project = active && focus ? sp.find((space) => space.id === focus.space && allowed.has(space.id)) : null;
    const pr = shared("kanso.pr.seen");
    const seenTarget = pr && pr.at > (this.prSeenAt ?? 0) ? targetOf("pr", pr.url) : null;
    this.sinceLeft.update({ project: project ? projectKey(project) : null, target: targets?.get(focus?.terminal) ?? null, seenTarget, snapshots, now }, cx).then(() => {
      this.returnSignature = signature;
      this.returnTargets = targets;
      this.returnPlaces = places;
      if (pr) this.prSeenAt = pr.at;
    }).catch(() => {});
  }

  // While you were away: the Activity card docked under the list, or nothing.
  awayCard(t, space) {
    if (!runs("sidebar.away", pieces(shared)) || !space || !this.sinceLeft?.rows.length || this.sinceLeft.project !== projectKey(space)) return null;
    return this.sinceLeft.render(t, projectKey(space), (key, go) => this.navMark(key, go), (row) => this.returnGo(row), (cx) => this.openAwayMenu(cx));
  }

  returnGo(row) {
    const to = destinationOf(row.target, this.returnPlaces ?? new Map(), this.sleepingRows?.rows ?? []);
    const go = {
      pr: () => commitLayout({ panel: { id: "pr", type: "block", content: { mod: "kanso-panel", props: { panel: "pr", url: to.url, at: Date.now() } } } }),
      agent: () => run("agent.focus", { terminal: to.address }),
      asleep: () => this.openMenu(to.row),
    };
    return to ? go[to.kind] : null;
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
    if (cur) Visits.keep(visited(Visits.now, address));
  }

  trackAgents(now, sp, cx) {
    const background = this.background();
    const list = visibleAgents(agents(), this.offNames()).filter((a) => background.allows(a.address));
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
    if (!next) { if (steps) this.redraw(cx); return; }
    // A turn ended or began: what was said changed.
    if (this.view === "threads") this.threadsAt = 0;
    this.since = next;
    this.panel.set("spaces.since", next);
    this.redraw(cx);
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
    const railOpen = shared("sidebar.collapsed") !== true;
    const opened = railOpen && this.railWasClosed === true;
    this.railWasClosed = !railOpen;
    const forward = Boolean(active) && this.gitBehind === true;
    this.gitBehind = !active;
    // Collapsed or behind: no fallback read. Opening the rail, or coming forward, reads at once.
    const stale = active && railOpen ? [...keys].filter((k) => {
      const asks = this.git[k] || this.unsure.has(k);
      return asks && !this.folded.has(onOf.get(k)) && (opened || forward || now - (this.checked[k] ?? 0) > FALLBACK);
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
    this.machines = listedMachines(result);
    this.preferHome();
    if (this.machines.length && !this.syncSaving) this.sync = await readSync();
    await this.settleParked();
  }

  async preferHome() {
    if (localName() === "windows" || this.homeBusy || Date.now() - (this.homeAt ?? 0) < HOME_EVERY_MS) return;
    this.homeBusy = true;
    this.homeAt = Date.now();
    try {
      const run = (program, args) => exec(program, args, { timeout: HOME_PROBE_MS });
      const peers = (await findTailscale(localName(), run)).net?.peers ?? [];
      if (!peers.length) return;
      const rows = (this.machines ?? []).map(machineRecord).filter(canRestore);
      for (const record of rows) {
        const found = await homeRoute(record, peers, run).catch(() => null);
        if (found?.record) await this.reroute(record, found.record, found.ip);
      }
    } finally {
      this.homeBusy = false;
    }
  }

  async reroute(was, next, ip) {
    await hc(rmArgs(was.name)).catch(() => null);
    if (hcError(await hc(addArgs(next)).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) })))) {
      await hc(addArgs(was)).catch(() => null);
      return;
    }
    notify({ title: `${was.name} now uses your home network`, body: `At ${ip} when you are home, and Tailscale when you are away.`, level: "success" });
  }

  async settleParked() {
    const done = connectedNames(this.parked ?? [], this.machines ?? []);
    if (done.length) {
      const drop = new Set(done);
      this.parked = (this.parked ?? []).filter((row) => !drop.has(row.name));
      for (const name of done) await this.dropMachine(name);
    }
    for (const row of this.parked ?? []) {
      const live = (this.machines ?? []).find((item) => item.name === row.name);
      if (live?.state !== "needs_login") continue;
      this.login.add(row.name);
      this.waking.delete(row.name);
    }
  }

  // One look at a time. A read that never settles is given up, and the next look runs.
  refreshMachines(cx, repeat = false) {
    if (!runs("sidebar.computers", pieces(shared))) { this.holdAwake(cx); return; }
    this.machineRead ??= new MachineRead();
    if (repeat && !this.machineRead.busy && ![...(this.machines ?? []), ...(this.parked ?? []), ...machines()].some((row) => row.name)) return;
    const job = this.machineRead.start(cx.timer, MACHINE_READ_MS, () => this.readMachines());
    if (job) cx.spawn(async (cx) => { await job; this.holdAwake(cx); this.redraw(cx); });
  }

  // The list is read every two minutes behind; the hold still renews on time.
  holdAwake(cx) {
    if (!this.awake) return;
    const rows = (this.machines ?? []).map((row) => ({ name: row.name, phase: this.phaseOf(row.name) }));
    const token = (this.awakeToken ?? 0) + 1;
    this.awakeToken = token;
    cx.spawn(async (cx) => {
      const wait = await keepAwake(this.awake, rows, cx.timer);
      if (wait == null || this.awakeToken !== token) return;
      cx.timer.after(wait, (cx) => { if (this.awakeToken === token) this.holdAwake(cx); });
    });
  }

  setPower(name, on, cx) {
    if (!name || this.powerBusy?.has(name)) return;
    if (on) this.turnOn(name, cx);
    else this.turnOff(name, cx);
  }

  removeMachine(name, cx) {
    const live = (this.machines ?? []).find((row) => row.name === name) ?? null;
    const record = machineRecord(live) ?? machineRecord((this.parked ?? []).find((row) => row.name === name));
    if (!canRestore(record) || this.powerBusy.has(name)) return;
    const title = this.names.title(name);
    this.removed = { ...(this.removed ?? {}), [name]: record };
    this.holdPower(name, cx, async () => {
      if (live) await hc(rmArgs(name)).catch(() => null);
      this.parked = (this.parked ?? []).filter((row) => row.name !== name);
      this.machines = (this.machines ?? []).filter((row) => row.name !== name);
      await this.dropMachine(name);
      notify({ title: `${title} removed`, body: "Click here to add it back.", timeout: 15000, action: { name: `kanso-spaces.restore-machine:${name}` } });
      await this.readMachines();
    });
  }

  restoreMachine(name, cx) {
    const record = this.removed?.[name];
    if (!record || this.powerBusy.has(name)) return;
    this.holdPower(name, cx, async () => {
      const error = hcError(await hc(addArgs(record)).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) })));
      if (error) { notify({ title: `${this.names.title(name)} was not added back`, body: String(error.message ?? ""), level: "error" }); return; }
      this.removed = Object.fromEntries(Object.entries(this.removed ?? {}).filter(([key]) => key !== name));
      await this.readMachines();
    });
  }

  holdPower(name, cx, work) {
    this.powerBusy.add(name);
    this.powerRun(name, cx, work);
  }

  dropMachine(name) {
    this.clearFlags(name);
    return this.db().forgetMachine(name).catch(() => {});
  }

  clearFlags(name) {
    this.login.delete(name);
    this.failed.delete(name);
    this.waking.delete(name);
    this.hints = Object.fromEntries(Object.entries(this.hints ?? {}).filter(([key]) => key !== name));
  }

  markFailed(name, why) {
    this.waking.delete(name);
    const hint = typeof why?.hint === "string" ? why.hint.trim() : "";
    this.hints = { ...(this.hints ?? {}), [name]: hint };
    if (needsLogin(why)) { this.login.add(name); return; }
    this.failed.add(name);
  }

  async unpark(name) {
    this.parked = (this.parked ?? []).filter((row) => row.name !== name);
    await this.db().forgetMachine(name).catch(() => {});
  }

  // The row is already in memory. A remove that lands still offers Retry when it cannot be stored.
  async settleOff(name, record, live, rev) {
    if ((this.parkRev ?? 0) !== rev) return;
    const result = live ? await hc(rmArgs(name)).catch(() => null) : { code: 0 };
    if ((this.parkRev ?? 0) !== rev) return;
    if (result && result.code !== 0) { await this.unpark(name); return; }
    const stored = await this.db().parkMachine(record).then(() => true, () => false);
    if ((this.parkRev ?? 0) !== rev) return;
    if (!stored || !result) this.markFailed(name, null);
  }

  turnOff(name, cx) {
    const live = (this.machines ?? []).find((row) => row.name === name) ?? null;
    const had = (this.parked ?? []).find((row) => row.name === name) ?? null;
    const record = machineRecord(live) ?? machineRecord(had);
    if (!canRestore(record)) return;
    this.parkRev = (this.parkRev ?? 0) + 1;
    const rev = this.parkRev;
    this.powerBusy.add(name);
    this.clearFlags(name);
    this.parked = [...(this.parked ?? []).filter((row) => row.name !== name), record];
    this.powerRun(name, cx, () => this.settleOff(name, record, live, rev));
  }

  // Both power changes: the machine is held awake, the work runs in the background, and the row frees whatever happened.
  powerRun(name, cx, work) {
    this.holdAwake(cx);
    this.redraw(cx);
    cx.spawn(async (spawnCx) => {
      try { await work(spawnCx); }
      finally { this.powerBusy.delete(name); this.holdAwake(spawnCx); this.redraw(spawnCx); }
    });
  }

  turnOn(name, cx) {
    const record = machineRecord((this.parked ?? []).find((row) => row.name === name));
    if (!canRestore(record)) return;
    this.powerBusy.add(name);
    this.clearFlags(name);
    this.waking.add(name);
    this.powerRun(name, cx, async () => {
      const result = await hc(addArgs(record)).catch((error) => ({ code: 1, stdout: "", stderr: String(error) }));
      const why = hcError(result);
      if (!why) { await this.readMachines().catch(() => {}); return; }
      this.markFailed(name, why);
    });
  }

  signIn(name) {
    const known = [...(this.machines ?? []), ...(this.parked ?? [])].find((row) => row.name === name) ?? { name };
    run("terminal.open", signInTab(known, localName()));
  }

  retryMachine(name, cx) {
    const parked = (this.parked ?? []).some((row) => row.name === name);
    const listed = (this.machines ?? []).some((row) => row.name === name);
    if (parked && !listed) this.turnOn(name, cx);
    else this.refreshMachines(cx);
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    if (!runs("sidebar.git", pieces(shared))) return;
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
      this.redraw(cx);
    });
  }

  async check(key, cx) {
    if (!runs("sidebar.git", pieces(shared))) return;
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
      const oid = lines.findLast((line) => line.startsWith("# branch.oid "))?.slice(13) ?? null;
      const upstream = lines.findLast((line) => line.startsWith("# branch.upstream "))?.slice(18) ?? null;
      const [a, b] = ab ? ab.slice(12).split(" ") : [];
      this.git[key] = {
        name, branch: head ? head.slice(14) : null, oid: oid === "(initial)" ? null : oid, upstream,
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
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height: 540, at: "pointer", props: { spaceMenu: { id: w.id } } });
  }

  // The projects you added on machine `m` with no space open.
  closedOn(m, ctx) {
    return closedProjects(ctx.registry.filter((p) => (p.machine || null) === (m ?? null)), ctx.spaces, home()).map((project) => ({ key: keyOfProject(project), project }));
  }

  closedRow(t, { key, project }, names) {
    const name = names.get(project.id) ?? project.name;
    const open = () => openOverlay({ mod: "kanso-spaces", kind: "popup", width: 252, height: 420, at: "pointer", props: { spaceMenu: { key } } });
    const missing = Boolean(project.missing);
    const focus = this.navMark(`closed-project:${key}`, open);
    // A folder gone on this computer is found again here; on another one, its menu says what can be done.
    const on = missing ? { folder: () => (project.machine ? open() : this.locate(project)) } : { plus: () => this.newAgentMenu(placeOfKey(key, project)) };
    return projectRow({ name, dimmed: true, missing, hover: this.hoverSpace === key, focus })(`closed-project-${key}`, tokens(t), {
      on: { ...on, ellipsis: open },
      onClick: (cx) => { open(); this.redraw(cx); },
      onMenu: open,
      onHover: (h, cx) => { if (h ? this.hoverSpace !== key : this.hoverSpace === key) { this.hoverSpace = h ? key : null; this.redraw(cx); } },
    });
  }

  // A project whose folder is gone: pick where it is now; the promise is the pick and the move.
  relocateTo(project) {
    return pickFolder({ prompt: "Use this folder" }).then((folder) => folder && this.db().relocateProject(project.id, trimmed(folder)));
  }

  locate(project) {
    this.relocateTo(project)
      .then(() => this.publishRegistry(this.db()))
      .catch((e) => notify({ title: "The folder was not changed", body: String(e?.message ?? e), level: "error" }));
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

  // A sleeping group's heading: the asleep composition's, named by its tab or project; folded, how many.
  asleepHead(c, group, name = null) {
    const open = this.asleepOpenOf(group.id);
    const focus = this.navMark(`asleep:${group.id}`, (cx) => this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx));
    const [head] = asleep({ names: group.rows.map(agentLabel), open, title: name || group.name || "Asleep", focus });
    return head(`asleep-group-${group.id}`, c, { onClick: (cx) => { this.toggleAsleep(group.id, open, cx); this.redraw(cx); } });
  }

  asleepAgents(group, t, ctx) {
    this.foldH ??= {};
    const open = this.asleepOpenOf(group.id);
    const id = `asleep-${group.id}`;
    if (!this.unfolded(id, open, ctx.now)) return { els: [], h: 0 };
    const drawn = group.rows.map((a) => ({ h: H.line, el: this.asleepLine(a, t) }));
    const h = drawn.reduce((n, r) => n + r.h + SIDEBAR.gap, 0);
    return { els: this.foldBox(id, open, drawn.map((r) => r.el), ctx.now), h: Math.max(0, h - SIDEBAR.gap) };
  }

  asleepStatus(s, t, c, ctx) {
    const tops = s.entries.filter((e) => !e.lines.length);
    return [...Map.groupBy(tops, (e) => e.a.space)].flatMap(([key, list]) => {
      const g = asleepGroups(list.map((e) => e.a), { key }).groups[0];
      if (!g) return [];
      const name = list[0].a.space_name || list[0].a.asleep.spaceName;
      const head = { focused: false, rh: H.line, el: this.asleepHead(c, g, name) };
      const agents = this.asleepAgents(g, t, ctx);
      const box = agents.els.map((el) => ({ focused: false, rh: this.asleepOpenOf(g.id) ? ((this.foldH ?? {})[`asleep-${g.id}`] ?? agents.h) : 0, el }));
      return [head, ...box];
    });
  }

  sleepingNow(sp = spaces(), terms = terminals(), ps = panes()) {
    const kept = this.panel?.agents ?? new Map();
    const signature = sleepingSignature(sp, ps, terms, kept);
    if (signature !== this.sleepingSignature) {
      this.sleepingRows = sleepingNow(sp, ps, terms, kept);
      this.sleepingSignature = signature;
    }
    const pending = (shared(SLEEP_PENDING)?.terminals ?? []).filter((id) => !failedTerminals(shared(SLEEP_FAILED)).includes(id));
    const live = typeof agents === "function" ? agents() : [];
    return withoutWaking(withPending(this.sleepingRows, live, pending), shared(SLEEP_WAKING)?.terminals ?? []);
  }

  undoSleep(a) {
    const address = a.asleep?.terminal ?? a.address;
    setShared(SLEEP_FAILED, withoutTerminals(shared(SLEEP_FAILED), [address]));
    const term = terminals().find((k) => k.address === address);
    if (asleepTerminal(term)) wakeRow({ space: a.space ?? a.asleep?.space, terminal: address, settled: false });
  }

  forgetAsleep(z) {
    hc(["label", z.terminal, `${RESUME_LABEL}=`]).catch(() => {});
    if (z.settled && z.tabId) run("tab.unsettle", { id: z.tabId });
  }

  // Asleep rows follow the awake ones, in the panes' order.
  spaceRows(id, ctx) {
    const mine = orderSessions(this.inStripOrder(ctx.all.filter((a) => this.projectFor(a, ctx) === id), ctx.strip), this.order, this.custom[id] ?? []);
    return [...mine, ...ctx.asleep.rows.filter((a) => a.space === id)];
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

  asleepLine(a, t) {
    const row = this.navRow(a, this.rowFor(a));
    const look = asleepLook({ reachable: reachesRow(a), failed: Boolean(row.failure), armed: Boolean(row.armed) });
    const [, line] = asleep({
      names: [agentLabel(a)], open: true, selected: row.kbd ? 0 : -1, hover: row.hovered ? 0 : -1,
      wake: look.wake, failure: look.failure, armed: look.armed,
    });
    const menu = (cx) => { cx.stop_propagation(); row.menu(cx); };
    const on = { ...(row.wake && look.wake ? { Wake: row.wake } : {}), ...(row.undo && look.undo ? { Undo: row.undo } : {}) };
    return line(`space-agent-${a.address}`, tokens(t), { on, onClick: menu, onMenu: (_e, cx) => menu(cx), onHover: row.hover });
  }

  // A popup's keyboard: j and k or the arrows walk menuActs, Enter runs the lit one, Escape closes.
  menuKeys(el) {
    return el.track_focus(this.handle)
      .on_key_down((e, cx) => {
        const digit = /^[1-9]$/.test(e.key) && plainKey(e) && !e.modifiers?.shift ? this.menuDigits?.[Number(e.key) - 1] : null;
        if (digit) { cx.stop_propagation(); digit(cx); return; }
        const { move, gAt } = listKey(e, this.menuG);
        this.menuG = gAt;
        const acts = this.menuActs ?? [];
        if (!move || (move === "enter" && (!this.handle.is_focused() || !acts[this.menuAt]))) return;
        if (move === "escape") { if (this.sub) { this.sub = null; this.menuAt = -1; } else closeOverlay(props().overlay); }
        else if (move === "enter") acts[this.menuAt]?.(cx);
        else this.menuAt = moveTo(move, this.menuAt, acts.length);
        const inRun = this.menuScroll ? this.menuAt - this.menuScroll.from : -1;
        if (inRun >= 0 && inRun < this.menuScroll.count) this.menuScroll.handle.scroll_to_item(inRun);
        cx.stop_propagation();
        this.redraw(cx);
      });
  }

  // A popup's Menu, walked by the keyboard; Herdr draws its frame.
  popup(t, title, items) { return this.menuKeys(contextMenu("spaces-menu", { title, lines: items }, tokens(t))); }

  actions(item, lines) { return contextRows(lines, item); }

  // The piece lines every right-click menu ends with, as items the keyboard walks like the rest.
  pieceItems(item, id) {
    return pieceLines(id, { named: true }).map((line) => (line.separator ? line : item(line.label, (cx) => line.onClick(cx), { icon: line.icon, selected: line.selected })));
  }

  // A popup's items from the start: the keyboard's list emptied, and the item maker.
  lines() {
    this.menuActs = [];
    return (text, act, opts) => this.menuLine(text, act, opts);
  }

  // One item, added to menuActs as it is made, so the keyboard walks them in screen order.
  // One activation for the keyboard and the mouse: the act, then the popup closes unless `keep`.
  menuLine(text, act, { keep = false, ...look } = {}) {
    const at = this.menuActs.length;
    const go = (cx) => { act(cx); if (!keep) closeOverlay(props().overlay); };
    this.menuActs = [...this.menuActs, go];
    return { ...look, label: text, selected: at === this.menuAt, onClick: (cx) => { go(cx); this.redraw(cx); } };
  }

  // Opens a worktree's folder: where something already runs there it is shown; else a shell starts there.
  openTree(place, x) {
    // A pane's machine is its space's (panes don't name one).
    const machineOf = new Map(spaces().flatMap((w) => (w.tabs ?? []).map((tb) => [tb.id, w.machine ?? ""])));
    const p = panes().find((k) => k.cwd && paths.within(k.cwd, x.path) && (machineOf.get(k.tab) ?? "") === (place.machine ?? ""));
    if (p) run("pane.focus", { pane: p.pane });
    else openAt(place, x.path, null, x.branch);
  }

  worktreeDialog(place) {
    openOverlay({ mod: "kanso-spaces", kind: "dialog", width: DIALOG.worktree, props: { worktree: place } });
  }


  // A popup's write finishes before the popup closes: closed first, the write could be cut off with it.
  thenClose(write, after = () => {}) {
    Promise.resolve(write).then(() => this.publishRegistry(this.db())).catch(() => {})
      .finally(() => { after(); closeOverlay(props().overlay); });
  }

  // Removing a project you have open closes its space too (asked first, with how many tabs go), so it really goes.
  removeProject(project, w) {
    this.thenClose(project ? this.db().removeProject(project.id) : null, () => { if (w) run("space.close", { id: w.id }); });
  }

  spaceMenuView(t) {
    const m = props().spaceMenu;
    const w = m.id ? spaces().find((s) => s.id === m.id) : null;
    const place = this.menuPlace(m);
    const project = place?.project ? registry().find((p) => p.id === place.project) ?? null : null;
    const asleep = w ? [...new Map(sleepingNow([w], panes(), terminals()).rows.map((a) => [a.asleep.id, a.asleep])).values()] : [];
    if (!w && !project) return this.popup(t, null, [{ heading: "This project is no longer here." }]);
    const item = this.lines();
    const active = w?.tabs?.find((x) => x.active);
    const tabs = w?.tabs?.length ?? 0;
    const trees = this.trees ?? [];
    const home_ = trimmed(home()), base = trimmed(kansoWorktrees(place?.machine));
    const where = (path) => base && paths.within(path, base) ? "kans\u014d" : paths.within(path, home_) ? `~/${paths.relative(home_, path).split(/[\\/]/).slice(-2).join("/")}` : path.split(/[\\/]/).slice(-2).join("/");
    // Keeping it: a space's folder (not home) can be a project of yours.
    const keepable = Boolean(w && !project && w.folder && trimmed(w.folder) !== home_);
    const keep = () => this.thenClose(this.db().addProject({ name: folderName(w.folder), folder: trimmed(w.folder), machine: w.machine ?? "" }));
    const locate = () => {
      this.relocateTo(project)
        .catch((e) => notify({ title: "The folder was not changed", body: String(e?.message ?? e), level: "error" }))
        .finally(() => this.thenClose(null));
    };
    const options = () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
    const remove = (cx) => { this.armed.press("remove", cx, () => this.removeProject(project, w)); };
    return this.popup(t, place?.name ?? w?.name ?? null, [
      ...this.actions(item, [
        ...(asleep.length ? [{ heading: "Asleep" }, ...asleep.map((z) => ({ act: "wake-tab", of: [z.tab], does: () => wakeRow(z), hint: z.saved ? since(z.saved) : null }))] : []),
        ...(asleep.length > 1 ? [{ act: "wake-all", of: [asleep.length], does: () => arrange({ wake: { space: w.id } }) }] : []),
        ...(place && !project?.missing ? [{ act: "new-conversation", does: () => this.newAgentMenu(place) }, { act: "new-worktree", does: () => this.worktreeDialog(place) }] : []),
        ...(trees.length ? [{ heading: "Worktrees" }, { scroll: trees.map((x) => ({ act: "worktree", of: [x.branch ?? "detached"], does: () => this.openTree(place, x), hint: where(x.path) })) }] : []),
        ...(w ? [{ act: "rename", does: () => run("space.rename", { id: w.id }) }] : []),
        ...(active ? [{ act: "sleep-tab", does: () => sleepTab(w.id, active.id) }] : []),
        ...(tabs > 1 ? [{ act: "sleep-project", does: () => sleepProject(w.id) }] : []),
        ...(w ? [{ act: "project-options", does: options }] : []),
        ...(keepable ? [{ act: "keep-project", does: keep, keep: true }] : []),
        ...(project?.missing && !project?.machine ? [{ act: "locate", does: locate, keep: true }] : []),
        ...(project || w ? [{ act: "remove-project", does: remove, keep: true, verb: w ? `remove, close ${tabs} tab${tabs === 1 ? "" : "s"}` : "remove it", armed: this.armed.is("remove") }] : []),
      ]),
      ...this.pieceItems(item, "sidebar.git"),
    ]);
  }

  askAgents(place, cx) {
    const on = place.machine || "";
    const kept = shared(KNOWN_AGENTS)?.[on];
    this.known = Array.isArray(kept) ? kept : null;
    this.agentsFailed = null;
    this.checking = true;
    const ask = this.agentsAsked = (this.agentsAsked ?? 0) + 1;
    const settle = (list, failed) => {
      if (ask !== this.agentsAsked || !this.checking) return;
      this.checking = false;
      if (list) { this.known = list; setShared(KNOWN_AGENTS, { ...(shared(KNOWN_AGENTS) ?? {}), [on]: list }); }
      else this.agentsFailed = failed;
      this.redraw(cx);
    };
    if (on && !shared(KNOWN_AGENTS)?.[""]) {
      knownAgents({ on: null }).then((list) => { setShared(KNOWN_AGENTS, { ...(shared(KNOWN_AGENTS) ?? {}), "": JSON.parse(JSON.stringify(list)) }); this.redraw(cx); }).catch(() => {});
    }
    const deadline = cx.timer.after(MACHINE_READ_MS, () => settle(null, "no answer in time"));
    knownAgents({ on: on || null }).then((list) => { deadline.cancel(); settle(JSON.parse(JSON.stringify(list)), null); })
      .catch((e) => { deadline.cancel(); settle(null, String(e?.message ?? e)); });
  }

  explainer() {
    return (shared(KNOWN_AGENTS)?.[""] ?? []).find((a) => a.installed) ?? null;
  }

  explainAgents(place, agent) {
    const where = place.machine || "this computer";
    const ask = { name: `Explain ${where}`, argv: copiesToViewer(localName())(agent.run), task: `kansō could not list the agents installed on ${where}. The error: ${this.agentsFailed}. Explain why, and how to fix it. Do not change anything.` };
    const local = spaces().filter((w) => !w.machine);
    const here = local.find((w) => w.active) ?? local[0];
    tryOr(() => (here ? run("tab.new", { ...ask, space: here.id }) : run("space.new", { ...ask, machine: "", folder: home() })));
  }

  agentsFailure(place) {
    const agent = this.explainer();
    const at = this.menuActs.length;
    this.menuActs = [...this.menuActs, (cx) => { this.askAgents(place, cx); this.redraw(cx); }, ...(agent ? [() => { this.explainAgents(place, agent); closeOverlay(props().overlay); }] : [])];
    const lit = this.menuAt === at ? "fix" : this.menuAt === at + 1 ? "agent" : null;
    return { failure: { text: `Can't list agents on ${place.machine || "this computer"}`, source: this.agentsFailed, fix: "Refresh", onClick: this.menuActs[at],
      agent: agent?.name ?? "", onExplain: agent ? this.menuActs[at + 1] : null, lit } };
  }

  newAgentView(t) {
    const place = props().newAgent, start = Boolean(props().start);
    const installed = (this.known ?? []).filter((a) => a.installed);
    this.menuDigits = installed.slice(0, 9).map((a) => (cx) => { this.pickAgent(place, a); this.redraw(cx); });
    const agents = this.known ? (item) => installed.map((a, i) => item(a.name, () => this.pickAgent(place, a), { icon: a.icon ?? null, hint: i < 9 ? String(i + 1) : null, keep: true })) : null;
    const lines = this.agentLines(place, { start, agents, pending: this.checking, failure: this.agentsFailed ? () => this.agentsFailure(place) : null, repo: this.repo, trees: this.trees,
      item: this.lines(), room: props().height ?? Infinity });
    this.menuScroll = lines.count ? { handle: this.agentScroll, count: lines.count, from: 1 } : null;
    return this.popup(t, null, lines.items);
  }




  treesLines(place, trees, item) {
    return { title: `Worktrees of ${place.name ?? "this project"}`, items: trees.map((x) => item(x.branch ?? "detached", () => this.openTree(place, x), { icon: "git-branch" })) };
  }

  treesMenu(place, trees) {
    const height = menuHeight(this.treesLines(place, trees, sketch));
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height, at: "pointer", props: { trees: { place, trees } } });
  }

  treesView(t) {
    const { place, trees } = props().trees;
    const { title, items } = this.treesLines(place, trees, this.lines());
    return this.popup(t, title, items);
  }


  makeWorktree(cx) {
    if (this.making) return;
    const place = props().worktree, branch = this.branch.value().trim();
    this.making = true;
    this.wtError = null;
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try {
        const r = await addWorktree({ folder: place.folder, machine: place.machine || null, branch, base: kansoWorktrees(place.machine) });
        if (r.error) { this.wtError = r.error; return; }
        if (!r.made) notify({ title: `${branch} already had a worktree`, body: r.path, level: "info", timeout: 5000 });
        closeOverlay(props().overlay);
        // Then which agent starts in it, asked like every other start.
        this.newAgentMenu({ ...place, tree: { folder: r.path, branch } });
      } finally { this.making = false; this.redraw(cx); }
    });
  }

  worktreeView(t) {
    const place = props().worktree;
    const base = kansoWorktrees(place.machine);
    const shownBase = base ? base.replace(trimmed(home()), "~") : "~/.kanso/worktrees";
    const c = tokens(t);
    return dialog("worktree-dialog", c, {
      title: `New agent in a worktree of ${place.name ?? "this project"}`,
      body: field("wt-branch", this.branch, c, { error: Boolean(this.wtError) }),
      notes: [{ text: `A new branch (or one you have), checked out in its own folder under ${shownBase}. The agent starts there.`, tone: "muted" },
        { text: this.wtError ?? (this.making ? "Making the worktree\u2026" : "Enter to make it, Esc to cancel."), tone: this.wtError ? "error" : "dim" }],
      secondary: "Cancel", primary: "Make worktree", state: this.making ? "loading" : "default",
      onCancel: () => closeOverlay(props().overlay), onPrimary: (cx) => this.makeWorktree(cx),
    });
  }

  // Each worktree space moves under its main checkout's.
  ordered(sp, places) {
    const key = (w) => places.get(w.id).key;
    const ready = (w) => this.shown.has(w.id) || key(w) in this.git || bornBy(this.born[w.id] ??= Date.now(), Date.now());
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w) => ({ w, g: this.git[key(w)] ?? null, place: places.get(w.id) })).filter((r) => this.shown.has(r.w.id));
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
  stacked(entries, mine, indent, t, c, space, ctx, heading) {
    const colOf = ({ a }) => { if (this.order !== "screen" || a.pin != null || !a.pane) return null; const col = (ctx.strip[a.tab]?.cols ?? []).find((k) => k.panes?.includes(a.pane)); return col && col.panes.length > 1 ? `${a.tab}:${col.panes[0]}` : null; };
    // Runs of rows in one column; a row in none is a run of its own.
    const keys = entries.map(colOf);
    const starts = keys.flatMap((key, i) => (i === 0 || !keys[i - 1] || key !== keys[i - 1] ? [i] : []));
    const runs = starts.map((i, k) => {
      const span = entries.slice(i, starts[k + 1] ?? entries.length), slab = keys[i] && span.length > 1;
      const rows = span.map((e) => {
        if (e.a.asleep) return { a: e.a, h: H.line, el: this.asleepLine(e.a, t) };
        const m = this.more(e, ctx, unnamedComputer(machineOf(e.a.address), heading));
        return { a: e.a, h: sessionHeight(m), el: agentSession(e.a, indent ? 2 : 1, c, this.navRow(e.a, e.lines.length ? this.rowFor(e.a) : e.a.pane ? this.rowOf(e.a, mine, space) : null), m) };
      });
      return { key: keys[i], rows, slab };
    });
    // Down the rows: where each starts, the list's gap apart, a slab's touching, with the gap after it.
    const { y, focus, focusH } = runs.reduce((acc, run) => {
      const end = run.rows.reduce((s, r) => ({ y: s.y + r.h + (run.slab ? 0 : SIDEBAR.gap), focus: r.a.focused ? s.y : s.focus, focusH: r.a.focused ? r.h : s.focusH }), acc);
      return run.slab ? { ...end, y: end.y + SIDEBAR.gap } : end;
    }, { y: 0, focus: null, focusH: 0 });
    const out = runs.flatMap((run) => (run.slab
      ? [v_flex().id(`stack-${run.key}`).flex_none().mx(-G.sm).px(G.sm).rounded(R.control).bg(alpha(t.foreground, TINT.cell)).children(run.rows.map((r) => r.el))]
      : run.rows.map((r) => r.el)));
    return { out, h: Math.max(0, y - SIDEBAR.gap), focus, focusH };
  }

  // `directory`: in Status and Threads, the project after the name and the computer when not this one.
  more(e, ctx, directory = null) {
    const a = e.a, show = this.showActivity !== false && (!a.sub || a.status === "blocked");
    const timed = (value) => (this.showTime === false ? null : value);
    return {
      label: this.nameOf(a),
      lines: e.lines,
      time: timed(a.sub ? null : elapsed(a, this.since ?? {}, ctx.now)),
      // A message sent to it from Send and not seen yet: who it is from.
      activity: show ? (fromOf(a) ? `Message from ${fromOf(a)}` : activityOf(a)) : null,
      ...this.extras(a, ctx, show),
      directory,
      oneLine: this.narrow,
    };
  }

  extras(a, ctx, show = true) {
    return {
      step: show ? stepOf(a, this.steps, ctx.now) : null,
      tasks: this.showTasks === false || a.sub ? [] : (this.tasks[a.address] ?? []).map((x) => ({ command: x.command, time: duration(Math.max(0, ctx.now - x.start)) })),
    };
  }

  listed(ps, sp, terms) {
    const byAddress = new Map(terms.map((k) => [k.address, k]));
    return withNeeds(visibleAgents(withTerminals(agents(), ps, sp), this.offNames()).map((a) => {
      const k = byAddress.get(a.address), l = k?.labels, pin = l?.[PIN_LABEL];
      return { ...a, parent: k?.parent ?? null, labels: l ?? {}, turn: k?.turn ?? 0, msg: k?.report?.msg ?? null, name: l?.[NAME_LABEL] || undefined, pin: pin != null && pin !== "" && !Number.isNaN(Number(pin)) ? Number(pin) : null };
    }), terms, checksOn());
  }

  setOrder(key, value) {
    this[key] = value;
    this.panel.set(`spaces.${key}`, key === "threadGroup" ? (value ? "on" : "off") : value);
    this.orderOpen = null;
    this.paint();
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
        if (over || hovered) this.redraw(cx);
      },
      pin: () => this.pin(a, mine.map((x) => x.pin).filter((p) => p != null)),
      menu: () => this.openMenu(a),
      drag: section ? {
        target: ok && this.overAgent === a.address ? side() : null,
        down: () => { this.draggedAgent = { address: a.address, space, section, at: mine.indexOf(a) }; this.overAgent = null; },
        up: (cx) => { const d = this.draggedAgent; this.draggedAgent = null; if (ok) this.dropped(d, a, mine, side(), space); this.redraw(cx); },
      } : null,
      ...this.sleepFace(a),
    };
  }

  // With the switch off, the sidebar stays on Spaces.
  setShown(key, on) {
    if (key === "switch" && !on) this.setView("spaces");
    this.hide({ switch: "sidebar.switch", activity: "sidebar.activity", away: AWAY_PIECE }[key], !on);
    this.redraw();
  }

  // Hide stores hide; showing again stores the piece's default.
  hide(id, off) {
    const map = pieces(shared);
    const next = setPiece(map, id, off ? "hide" : (pieceOf(id)?.default ?? "show"));
    if (JSON.stringify(next) === JSON.stringify(map)) return;
    setShared(STORE, next);
  }

  // A view picked any way, by its key too, shuts the collapsed view menu.
  setView(view, cx) {
    this.view = view;
    this.viewMenu = false;
    this.panel.set("spaces.view", view);
    if (view === "threads" && cx) this.refreshThreads(cx);
  }

  showAsleep(cx) {
    this.setView("agents", cx);
    this.sectionsFolded.delete("asleep");
    this.panel.set("spaces.sections", [...this.sectionsFolded]);
    this.redraw();
  }

  checkAlive(cx, now = Date.now(), active = window().active) {
    this.checkTasks(cx, now, active);
  }

  sawAlive(next, sig, at, cx) {
    this.aliveSig = sig;
    this.aliveAt = at;
    const changed = !this.alive || next.size !== this.alive.size || [...next].some((p) => !this.alive.has(p));
    this.alive = next;
    if (changed) this.redraw(cx);
  }

  // A file that hasn't grown isn't read again (threads.js).
  refreshThreads(cx) {
    this.threadsAt = Date.now();
    if (this.readingThreads) return;
    this.readingThreads = true;
    // Agents on this computer (another machine's files are not here).
    const background = this.background();
    const list = agents().filter((a) => !a.address.includes("/") && background.allows(a.address)).map((a) => ({ address: a.address, app: a.app }));
    if (!list.length) { this.readingThreads = false; return; }
    this.threadLocator ??= new ThreadLocator();
    cx.spawn(async (cx) => {
      try {
        const before = this.threads ?? {};
        const next = await findThreads(list, before, terminals(), this.threadLocator);
        const same = this.threads && Object.keys(before).length === Object.keys(next).length && Object.keys(next).every((id) => sameThread(next[id], before[id]));
        this.threads = next;
        if (same) return;
        this.threadsShown = next;
        this.redraw();
      } catch { this.threads ??= {}; this.threadsShown ??= this.threads; }
      finally { this.readingThreads = false; }
    });
  }

  // The Sort menu: the view's orders, the current one ticked, then what the sidebar shows.
  sortMenu(look) {
    const { view, threadGroup, activity, away, switch: switchOn } = look;
    const { orders, current, key, head } = sortOf(view, look, { ORDERS, STATUS_ORDERS, THREAD_ORDERS, DEFAULT_ORDER });
    const ticked = (label, on, onClick) => ({ label, icon: on ? "check" : null, onClick });
    const grouped = view === "threads" ? [ticked("Grouped by project", threadGroup, () => this.setOrder("threadGroup", !threadGroup))] : [];
    return menu({ items: [
      { heading: head },
      ...Object.keys(orders).map((mode) => ticked(orders[mode], mode === current, () => this.setOrder(key, mode))),
      ...grouped,
      { separator: true },
      { heading: "Show" },
      ticked("What each agent is on", activity, () => this.setShown("activity", !activity)),
      ticked(RETURN_LABEL, away, () => this.setShown("away", !away)),
      ticked("Projects, Status and Threads", switchOn, () => this.setShown("switch", !switchOn)),
    ] });
  }

  // The Header composition with its Toolbar: + names what it adds in this view; collapsed, Sort and Search fold under the caret.
  // The window's lights are the block above, so the header has no title row of its own.
  header(look) {
    const { view, collapsed, tools: open, sortOpen } = look;
    const { orders, current, plain } = sortOf(view, look, { ORDERS, STATUS_ORDERS, THREAD_ORDERS, DEFAULT_ORDER });
    const form = collapsed ? "rail" : "bar";
    // Folding the caret, or the sidebar, shuts Sort's menu for good.
    const more = () => { this.toolsOpen = !open; if (open) this.orderOpen = null; this.paint(); };
    const sorting = sortOpen === form && (!collapsed || open);
    const bar = toolbar({ view, column: collapsed, open, sorted: !plain, order: orders[current], sortMenu: sorting ? this.sortMenu(look) : null });
    // Only the tools on show: a name the Toolbar does not draw throws. Collapsed, Search sits under the open caret.
    return header({ collapsed, title: false, toolbar: bar })("spaces-header", tokens(theme()), {
      presses: {
        plus: () => this.startMenu(view),
        "panel-left": () => this.toggleRail(),
        ...(!collapsed || open ? { search: () => (collapsed ? run("mod.open", { name: "picker" }) : this.openFind()) } : {}),
        ...(collapsed ? { [open ? "chevron-up" : "chevron-down"]: more } : {}),
      },
      onOpen: (next) => { this.orderOpen = next ? form : null; this.paint(); },
    });
  }

  grouped(t, collapsed, sp, ps, ctx) {
    const c = tokens(t);
    const rows = this.ordered(sp, ctx.places);
    const live = machines();
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...(this.machines ?? []).map((row) => row.name), ...(this.parked ?? []).map((row) => row.name)])].filter(Boolean).toSorted();
    const heads = shown("sidebar.computers", true, pieces(shared));
    // `first`: the first project under its heading, or in the list, sits right under it.
    const draw = (r, first) => {
      if (collapsed) return item(this.compact(r, t, c, ctx), SIDEBAR.railRow);
      const mine = ctx.rowsBy.get(r.w.id) ?? [];
      const split = asleepGroups(mine, { key: r.w.id });
      const whole = split.groups.find((g) => g.whole) ?? null;
      const entries = nest(whole ? [] : split.live, ctx.terms);
      const open = !this.agentsFolded.has(r.w.id);
      const indent = r.tree ? CHILD_PAD : 0;
      // A group's space between projects (a worktree stays close to its checkout).
      const gap = r.tree || first ? [] : [lift(SIDEBAR.groupGap)];
      // The space's row before its agents': the keyboard's path (navMark) goes in screen order.
      const head = { ...item(this.row(r, t, c, whole ? [] : entries.map((e) => e.a), whole), H.line, r.w.active ? spaceMark(H.line) : null), row: true, tree: Boolean(r.tree) };
      if (whole) {
        const agents = this.asleepAgents(whole, t, ctx);
        const box = agents.els.map((el) => item(el, this.asleepOpenOf(whole.id) ? ((this.foldH ?? {})[`asleep-${whole.id}`] ?? agents.h) : 0));
        return [...gap, head, ...box];
      }
      const show = this.unfolded(r.w.id, open, ctx.now);
      const st = show ? this.stacked(entries, split.live, indent, t, c, r.w.id, ctx, heads && remote.length ? r.w.machine ?? null : undefined) : null;
      // Each head before its rows: the keyboard's path goes in screen order.
      const tabs = show ? split.groups.flatMap((g) => {
        const head = this.asleepHead(c, g);
        return [head, ...this.asleepAgents(g, t, ctx).els];
      }) : [];
      const inner = [...(st?.out ?? []), ...tabs];
      const box = (inner.length ? this.foldBox(r.w.id, open, inner, ctx.now) : [])
        .map((el) => item(el, open ? ((this.foldH ?? {})[r.w.id] ?? st?.h ?? 0) : 0, open && st?.focus != null ? agentMark(st.focus, st.focusH) : null));
      return [...gap, head, ...box];
    };
    const drawAll = (list) => list.flatMap((r, i) => draw(r, i === 0));
    const loading = m => {
      const state = live.find(k => k.name === m)?.layout;
      return state === "loading" || (!state && this.machines.some(k => k.name === m && k.state === "connected"))
        || rows.length < sp.length && sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => item(skeletonOf({ shape: collapsed ? "tile" : "line" })(`machine-loading-${m ?? "local"}`, t), collapsed ? SIDEBAR.railRow : H.line);
    // Projects you added with no space open, on their machine; each keeps a + to start an agent in it.
    const names = shownNames(ctx.registry);
    const closed = (m) => (collapsed ? [] : this.closedOn(m, ctx)).flatMap((entry) => [lift(SIDEBAR.groupGap), item(this.closedRow(t, entry, names), H.line)]);
    if (!remote.length || !heads) {
      const shut = [null, ...(heads ? [] : remote)].flatMap((m) => closed(m));
      return loading(null) && !rows.length && !shut.length ? [loadingRow(null)] : [...drawAll(rows), ...shut];
    }
    const block = { t, c, collapsed, rows, draw: drawAll, closed, loading, loadingRow, ctx, layouts: live };
    return [null, ...remote].flatMap((m, i) => this.machineBlock(m, block, i === 0));
  }

  // A computer's two words: its key in the maps, and the name a person reads.
  machineWords(m) {
    return { key: m ?? "local", title: this.names.title(m) };
  }

  // A computer's menu, drawn by the kit at the pointer; it reads the phase and sync the row had.
  computerMenu(m, phase) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", frame: "none", width: W.menu, at: "pointer", props: {
      machineMenu: { route: m ?? "", shown: this.names.title(m), phase, syncOn: Boolean(m) && peerOn(this.sync.config, m) } } });
  }

  computerMenuView(t) {
    const { route = "", shown: title = "", phase = "connected", syncOn = false } = props().machineMenu;
    const acts = {
      rename: () => this.names.ask(route, title),
      power: () => run(`kanso-spaces.power-machine:${route}`),
      sync: () => run(`kanso-spaces.sync-machine:${route}`),
      retry: () => run(`kanso-spaces.retry-machine:${route}`),
      signin: () => run(`kanso-spaces.sign-in-machine:${route}`),
      remove: () => run(`kanso-spaces.remove-machine:${route}`),
      plus: () => run("space.new", { machine: route }),
      add: () => run("mod.open", { name: "kanso-computers" }),
      hide: () => this.hide("sidebar.computers", true),
      settings: () => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page: "pieces", find: "Computers" } }),
    };
    const rows = computerMenuItems({ remote: Boolean(route), phase, syncOn, addComputer: shown("footer.machine", true, pieces(shared)) });
    const go = (key) => () => { acts[key](); closeOverlay(props().overlay); };
    const acting = rows.filter((row) => row.key);
    this.menuActs = acting.map((row) => go(row.key));
    const lit = acting[this.menuAt]?.key ?? null;
    const lines = rows.map((row) => (row.key ? { ...row, selected: row.key === lit, ...(row.act ? { does: go(row.key) } : { onClick: go(row.key) }) } : row));
    return this.menuKeys(contextMenu("computer-menu", { title, lines, framed: true }, tokens(t)));
  }

  // The icon turns at once; a save that fails turns it back and says so.
  toggleSync(m, cx) {
    if (this.syncSaving) return;
    const before = this.sync.config;
    const on = !peerOn(before, m);
    this.syncSaving = true;
    this.sync = { ...this.sync, config: withPeer(before, m, on) };
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try { this.sync = { ...this.sync, config: await saveSync(m, on) }; }
      catch { this.sync = { ...this.sync, config: before }; notify({ title: `Sync ${m} was not changed`, level: "error" }); }
      finally { this.syncSaving = false; this.redraw(cx); }
    });
  }

  openMachine(m, phase, folded, cx) {
    if (phase === "loading") return;
    if (phase === "off" && m) { this.setPower(m, true, cx); return; }
    if (phase === "unavailable" && m) { this.retryMachine(m, cx); return; }
    if (phase === "login" && m) { this.signIn(m); return; }
    if (phase !== "connected") return;
    if (folded) this.folded.delete(m); else this.folded.add(m);
    this.panel?.set("machines.folded", [...this.folded]);
    this.redraw(cx);
  }

  // Collapsed, a computer is its icon on the rail, its name and state in the tooltip.
  machineTile(m, phase, c) {
    const { key, title } = this.machineWords(m);
    const hint = m ? ((this.hints ?? {})[m] ?? "") : "";
    const go = (cx) => this.openMachine(m, phase, (this.folded ?? new Set()).has(m), cx);
    this.navMark(machineStop(m), go);
    const label = machineTip(title, phase, hint);
    const menu = (_e, cx) => { cx.stop_propagation(); this.computerMenu(m, phase); };
    return tile({ icon: m ? "lu-server" : "lu-monitor", label })(`machine-${key}`, c, {
      onClick: (cx) => { cx.stop_propagation(); go(cx); },
      onMenu: menu,
    }).id(`machine-${key}-row`).cursor_pointer().on_click((_e, cx) => go(cx)).on_mouse_down("right", menu).tooltip(tooltip({ label }));
  }

  // A computer: the computer row composition; what is wrong is its one button, its tools show under the pointer or the keyboard.
  // Each tool it shows is a keyboard stop after the row's, and Enter on one runs its press.
  machineHead(m, phase, t, c, collapsed, folded, tail = null) {
    if (collapsed) return this.machineTile(m, phase, c);
    const { key, title } = this.machineWords(m);
    const syncing = Boolean(m) && phase === "connected" && peerOn(this.sync.config, m);
    const sync = syncing ? syncIcon({ name: m, ...this.sync, now: Date.now() }) : null;
    const cannot = sync?.state === "cannot";
    const hint = m ? ((this.hints ?? {})[m] ?? "") : "";
    const go = (cx) => this.openMachine(m, phase, folded, cx);
    const acts = {
      "lu-power": (cx) => this.setPower(m, this.phaseOf(m) === "off", cx),
      "lu-plus": () => run("space.new", { machine: m ?? "" }),
      "lu-refresh-cw": (cx) => this.retryMachine(m, cx),
      "lu-key": () => this.signIn(m),
      "lu-arrow-right-left": (cx) => this.toggleSync(m, cx),
    };
    // Loading, it breathes until hc answers.
    const look = {
      name: title, remote: Boolean(m), state: COMPUTER_STATE[phase] ?? "on", pending: phase === "loading", sync: sync?.tip ?? null,
      hover: machineHot(m, this.hoverMachine, this.kbd, this.navKey), focus: this.navMark(machineStop(m), go),
    };
    const tools = computerTools(look).map((tool) => tool.icon);
    const rings = tools.map((name) => this.navMark(machineStop(m, name), acts[name]));
    return computerRow({
      ...look, word: cannot ? "Sync can't run" : null, tip: hint || (cannot ? sync.tip : null), lit: tools[rings.indexOf(true)] ?? null,
      status: tail?.mark ?? "none", count: folded ? (tail?.count ?? 0) : 0,
    })(`machine-${key}`, c, {
      on: Object.fromEntries(tools.map((name) => [name, acts[name]])),
      // One press opens, folds or fixes it; two rename it.
      onPress: (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); this.names.rename(m); } else go(cx); },
      onMenu: (_e, cx) => { cx.stop_propagation(); this.computerMenu(m, phase); },
      onHover: (h, cx) => { if (h ? this.hoverMachine !== key : this.hoverMachine === key) { this.hoverMachine = h ? key : null; this.redraw(cx); } },
    });
  }

  machineBlock(m, block, first = false) {
    const { t, c, collapsed, rows, draw, closed, loading, loadingRow, ctx, layouts } = block;
    const phase = this.phaseOf(m, layouts);
    const folded = phase === "connected" && (this.folded ?? new Set()).has(m);
    const mine = rows.filter((r) => (r.w.machine ?? null) === m);
    if (phase === "connected") (this.seenOn ??= {})[m ?? ""] = ctx.now;
    // Folded: the most urgent mark of its sessions and how many projects.
    const tail = folded ? { mark: foldTail(false, mine.flatMap((r) => (ctx.rowsBy.get(r.w.id) ?? []).map((a) => a.status))).mark, count: mine.length + this.closedOn(m, ctx).length } : null;
    // Open, each computer after the first opens its own group, wider apart than the projects in it; the first sits right under the switch.
    const head = item(this.machineHead(m, phase, t, c, collapsed, folded, tail), collapsed ? SIDEBAR.railRow : H.line);
    const heads = collapsed || first ? [head] : [lift(SIDEBAR.computerGap), head];
    if (phase === "loading" && !collapsed) return [...heads, loadingRow(m)];
    // Unreachable: its projects as last read, dim, with when.
    if (phase === "unavailable" && !collapsed && mine.length) {
      const when = readWord(this.seenOn?.[m ?? ""]);
      return [...heads, ...draw(mine).map((it) => ({ ...it, el: it.el.opacity(OPACITY.away).when(Boolean(when), (el) => el.tooltip(tooltip({ label: when }))) }))];
    }
    if (phase !== "connected" || folded) return heads;
    const empty = emptyState({ icon: "folder", text: noProjectsOn(this.names.title(m)), action: "New project" })(`machine-new-${m ?? "local"}`, c, { onClick: () => run("space.new", { machine: m ?? "" }) });
    const kept = this.closedOn(m, ctx).length > 0;
    return [...heads, ...(mine.length ? draw(mine) : kept ? [] : [loading(m) ? loadingRow(m) : item(empty)]), ...closed(m)];
  }

  pull(place, cx) {
    if (!place?.cwd || this.pulling) return;
    this.pulling = pullKey(place.cwd, place.on); this.redraw(cx);
    cx.spawn((spawnCx) => runPull(exec, notify, { folder: place.cwd, on: place.on }).catch(() => null).then((result) => { this.pulling = false; if (result?.code === 0) this.refreshGit(new Set([place.key]), spawnCx); this.redraw(spawnCx); }));
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
    const tick = (cx) => { if (this.folding?.id !== id) return; if (this.folding.phase === 0) this.folding.phase = 1; this.redraw(cx); };
    cx.timer.after(16, tick);
    cx.timer.after(FOLD_MS, (cx) => { if (this.folding?.id === id && !this.folding.open) this.redraw(cx); });
  }

  unfolded(id, open, now) {
    return open || (this.folding?.id === id && !this.folding.open && now - this.folding.at < FOLD_MS);
  }

  // `gap`: the list's own, so the rows sit as they would in it.
  foldBox(id, open, rows, now, gap = SIDEBAR.gap) {
    if (!rows.length) return [];
    this.foldH ??= {};
    const mine = this.folding?.id === id;
    const closing = !open && mine;
    const start = open && mine && this.folding.open && this.folding.phase === 0;
    const h = this.foldH?.[id];
    const inner = v_flex().w_full().flex_none().px(G.sm).gap(gap).children(rows)
      .on_size_change((s, cx) => { if (this.foldH[id] !== s.height) { this.foldH[id] = s.height; this.redraw(cx); } });
    // Out to the list's edges, so the rows' ground is not cut short.
    return [v_flex().id(`fold-${id}`).mx(-G.sm).flex_none().overflow_hidden()
      .h(closing || start ? 0 : h ?? "auto").opacity(closing || start ? 0 : 1)
      .transition("height", GLIDE).transition("opacity", GLIDE)
      .child(inner)];
  }

  // A project's hue, as the avatar's tone.
  avatarTone(w) {
    return HUES[this.colors?.[w.id] ?? "ansi6"] ?? null;
  }

  // One press on a project: its agents fold or unfold (a sleeping group wakes), and the space opens when it is not the one you are in.
  openSpace(w, group, on, away, mine, cx) {
    if (group) this.toggleAsleep(group.id, this.asleepOpenOf(group.id), cx);
    else if (mine.length) this.setAgentsFolded(w.id, on ? !this.agentsFolded.has(w.id) : false, cx);
    if (!on && !away) run("space.select", { id: w.id });
  }

  // A project: the project row composition. A press opens it, folds its sessions, or picks it up to drag; two rename it.
  row({ w, g, tree, place }, t, c, mine = [], group = null) {
    const on = w.active;
    const asleep = Boolean(group);
    // Shown, a settled tab comes back without its agents: a project whose every tab sleeps wakes from its menu.
    const away = asleep && (w.tabs ?? []).every((tb) => tb.settled);
    const focus = this.navMark(`space:${w.id}`, (cx) => this.openSpace(w, group, on, away, mine, cx), on && !mine.some((a) => a.focused));
    const git = g && !asleep && shown("sidebar.git", true, pieces(shared)) ? gitFacts(g, tree, w.name, place, this.pulling) : { sync: [] };
    // Folded, the most urgent mark and how many; a project that sleeps whole, the moon and how many sleep.
    const tail = asleep ? { mark: "asleep", count: group.rows.length } : mine.length ? foldTail(!this.agentsFolded.has(w.id), mine.map((a) => a.status)) : null;
    const presses = { Pull: (cx) => this.pull(place, cx), [AHEAD]: () => openAhead(w) };
    return projectRow({
      name: w.name, folder: git.folder, branch: git.branch, sync: git.sync, pending: git.pending, open: on, ground: false,
      status: tail?.mark ?? "none", count: tail?.count ?? 0, hover: this.hoverSpace === w.id, focus,
      tree: tree ? (tree.last ? "end" : "tee") : null, dimmed: Boolean(tree) && !on,
      drop: this.over === w.id && this.takes(w, tree) ? (spaceAt(this.pressed) < spaceAt(w.id) ? "after" : "before") : null,
    })(`space-${w.id}`, c, {
      on: { plus: () => this.newAgentMenu(placeOfSpace(w)), ellipsis: () => this.menu(w), ...Object.fromEntries(git.sync.map(({ label }) => [label, presses[label]])) },
      onPress: (e) => {
        this.downOn = w.id;
        this.pressed = tree || e.click_count === 2 ? null : w.id;
        this.over = null;
        if (e.click_count === 2) run("space.rename", { id: w.id });
      },
      onMove: (_e, cx) => this.hold(this.takes(w, tree) ? w.id : null, cx),
      // Only a press that began on this row opens it: a tool's press stays on the tool.
      onRelease: (_e, cx) => {
        const from = this.pressed, drop = this.takes(w, tree), mineDown = this.downOn === w.id;
        this.pressed = null;
        this.over = null;
        this.downOn = null;
        if (drop) run("space.move", { id: from, index: spaceAt(w.id) + 1 });
        else if (mineDown && (from === null || from === w.id)) this.openSpace(w, group, on, away, mine, cx);
        this.redraw(cx);
      },
      onMenu: () => this.menu(w),
      onHover: (h, cx) => {
        if (h ? this.hoverSpace !== w.id : this.hoverSpace === w.id) { this.hoverSpace = h ? w.id : null; this.redraw(cx); }
        if (!h && this.over === w.id) this.hold(null, cx);
      },
    });
  }

  // A held project lands only on another top-level project of its own machine.
  takes(w, tree) {
    const from = !tree && this.pressed !== w.id && spaces().find((s) => s.id === this.pressed);
    return Boolean(from) && (from.machine || null) === (w.machine || null);
  }

  hold(over, cx) { if (this.pressed !== null && this.over !== over) { this.over = over; this.redraw(cx); } }

  // Projects, collapsed: one mark per project; a click lists its agents, or goes to it when it has none.
  compact({ w }, t, c, ctx) {
    const rows = (ctx.rowsBy.get(w.id) ?? []).map((a) => this.railRow(a, null, ctx.now));
    return this.railTile(c, `space-${w.id}`, { initial: initialOf(w.name), tone: this.avatarTone(w), rows, label: w.name, open: w.active, space: w.id, menu: () => this.menu(w) });
  }

  // Asleep is a status like the others: those agents are entries too.
  statusSections(sp, ctx) {
    const names = new Map(sp.map((w) => [w.id, w.name]));
    const zz = ctx.asleep.rows.map((a) => ({ a: { ...a, space_name: names.get(a.space) ?? a.asleep.spaceName ?? "" }, lines: [] }));
    const entries = [...nest(this.inStripOrder(ctx.all, ctx.strip), ctx.terms), ...zz];
    const since = { ...(this.since ?? {}), ...Object.fromEntries(zz.map((e) => [e.a.address, { s: "asleep", at: e.a.asleep.saved }])) };
    return bySection(entries, since, this.held?.done ? this.held.address : null, this.statusOrder);
  }

  // Asleep, a conversation keeps its place among the others (by your last message in it).
  threadRows(ctx) {
    return ctx.all
      .filter((a) => !a.address.includes("/") && (this.threads[a.address] || a.program?.agent || a.status))
      .map((a) => ({ a, th: shownThread(this.threads[a.address], this.termBy?.get(a.address), this.alive) }))
      .concat(ctx.asleep.rows.filter((a) => a.asleep.resume).map((a) => ({ a, th: { title: a.title, said: a.asleep.said ?? a.asleep.saved, at: a.asleep.saved } })));
  }

  agentsView(t, sp, ps, ctx) {
    const { c, sections } = this.agentsCtx(t, sp, ctx);
    if (!sections.length) return machines().some((m) => m.layout === "loading") ? [this.loadingRows(t)]
      : [item(emptyState({ icon: "activity", text: "No agents running" })("agents-empty", c))];
    const project = this.projectOf(sp, t);
    return sections.flatMap((s, i) => {
      const id = `section-${s.id}`;
      const open = !this.sectionsFolded.has(s.id);
      const count = s.entries.filter((e) => !e.lines.length).length;
      const head = this.sectionHead(c, id, (cx) => {
        open ? this.sectionsFolded.add(s.id) : this.sectionsFolded.delete(s.id);
        this.panel.set("spaces.sections", [...this.sectionsFolded]);
        this.toggleFold(id, !open, cx);
      }, { title: s.label, status: sectionMarkOf(s.id) ?? "none", count: sectionCount(open, count) });
      const tops = s.entries.reduce((list, e, k) => [...list, e.lines.length ? list[k - 1] : e.a], []);
      const laid = this.unfolded(id, open, ctx.now) ? (s.id === "asleep" ? this.asleepStatus(s, t, c, ctx) : s.entries.map((e, k) => {
        if (e.a.asleep) return { focused: false, rh: H.line, el: this.asleepLine(e.a, t) };
        const where = machineOf(e.a.address);
        const m = this.more(e, ctx, e.lines.length ? unnamedComputer(where, machineOf(tops[k]?.address)) : rowDirectory(project(e.a.space)?.name, where)), rh = sessionHeight(m);
        return { focused: e.a.focused, rh, el: agentSession(e.a, 0, c, this.navRow(e.a, this.rowFor(e.a)), m) };
      })) : [];
      const { h, focus, focusH } = laid.reduce((acc, r) => ({ h: acc.h + r.rh + 1, focus: r.focused ? acc.h : acc.focus, focusH: r.focused ? r.rh : acc.focusH }), { h: 0, focus: null, focusH: 0 });
      const rows = laid.map((r) => r.el);
      const box = this.foldBox(id, open, rows, ctx.now)
        .map((el) => item(el, open ? (this.foldH[id] ?? Math.max(0, h - 1)) : 0, open && focus != null ? agentMark(focus, focusH) : null));
      return [...(i ? [lift(G.lg)] : []), item(head, H.line), ...box];
    });
  }

  // A section: the section composition; a press folds it. `add`: + under the pointer, its label and what it starts.
  sectionHead(c, id, toggle, { title, status = "none", count = null, add = null, hover = false, onHover = null }) {
    return section({ title, status, count: count ?? 0, add: add?.label ?? null, hover })(id, c, {
      on: add ? { plus: add.go } : {}, onClick: (cx) => { toggle(cx); this.redraw(cx); }, onHover: onHover ?? undefined,
    });
  }

  // First read: the kit skeleton at the rows' height.
  loadingRows(t) { return item(skeletonOf({ shape: "row", count: 3 })("kanso-skeleton", t), 3 * H.line); }

  projectOf(sp, t) {
    const byId = new Map(sp.map((s) => [s.id, s]));
    return (id) => { const w = byId.get(id); return w ? { name: w.name, tone: this.avatarTone(w) } : null; };
  }

  openMenu(a, { title = null, session = null } = {}) {
    if (a.asleep) { this.openAsleepMenu({ address: a.address, asleep: a.asleep, name: a.name }); return; }
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height: 460, at: "pointer",
      props: { menu: { address: a.address, view: this.view, title, session } } });
  }

  sleepFace(a) {
    const address = a.asleep?.terminal ?? a.address;
    const failed = failedTerminals(shared(SLEEP_FAILED)).includes(address);
    return {
      failure: failed ? COULD_NOT_SLEEP : null,
      undo: failed ? () => this.undoSleep(a) : null,
      armed: Boolean(a.asleep && forgetHeld(shared(FORGET_HELD), address, Date.now(), ARM_MS)),
    };
  }

  rowFor(a, actions = null, extra = {}) {
    return {
      hovered: this.hoverRow === a.address,
      hover: (h, cx) => { if (h ? this.hoverRow !== a.address : this.hoverRow === a.address) { this.hoverRow = h ? a.address : null; this.redraw(cx); } },
      menu: () => this.openMenu(a, extra),
      wake: canWake(a, reachesRow(a)) ? () => wakeRow(a.asleep) : null,
      ...this.sleepFace(a),
      actions,
    };
  }

  // One group in the collapsed rail (a project, a status, a shelf): the Tile composition. Its lead is a project's initial in its hue, an icon,
  // or the state's mark; beside how many, the most urgent state inside, unless the lead already is it (`urgent: false`).
  // A click (or Enter) lists the group in a popup; a right click opens `menu` (else the same list).
  // `space`: a project's, so its list also offers to go to it; with no rows a click goes there at once.
  railTile(c, id, { rows, space = null, menu = null, urgent = true, status = "none", ...look }) {
    const top = urgent ? mostUrgent(rows.map((r) => ({ status: r.status }))) : null;
    const shown = top === "working" || top === "blocked" || top === "done" || top === "asleep" ? top : status;
    const list = () => (rows.length ? this.railMenu(look.label, rows, space) : space ? run("space.select", { id: space }) : null);
    return tile({ ...look, status: shown, count: rows.length, marked: urgent, strong: rows.some((r) => r.strong) })(id, c, {
      onClick: list,
      onPress: (_e, cx) => cx.stop_propagation(),
      onMenu: (_e, cx) => { cx.stop_propagation(); (menu ?? list)(); },
    });
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
    const height = menuHeight(this.railLines(sketch, { title, rows, space }));
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height, at: "pointer", props: { railMenu: { title, rows, space } } });
  }

  // The rail's list of one group, each row with its state, in a run that scrolls; then the way to its project.
  railLines(item, { title, rows, space }, to = () => () => {}) {
    return {
      title,
      items: [
        { scroll: rows.map((r) => item(r.name, to(r), { mark: r.status, hint: r.hint, badge: r.badge, keep: true })), rows: RAIL_MENU_ROWS, handle: this.convScroll },
        ...(space ? [{ separator: true }, ...this.actions(item, [{ act: "go-project", does: () => run("space.select", { id: space }) }])] : []),
      ],
    };
  }

  // A click goes to the row; an asleep one opens its wake menu.
  railMenuView(t) {
    const m = props().railMenu;
    const to = (r) => (r.asleep ? () => { closeOverlay(props().overlay); this.openAsleepMenu({ address: r.address, asleep: r.asleep, name: r.name }); }
      : () => { closeOverlay(props().overlay); r.pane ? run("pane.focus", { pane: r.pane }) : run("terminal.peek", { terminal: r.address }); });
    // The keyboard brings the row it lights into view.
    this.menuScroll = this.convScroll ? { handle: this.convScroll, count: m.rows.length, from: 0 } : null;
    const { title, items } = this.railLines(this.lines(), m, to);
    return this.popup(t, title, items);
  }

  // Both agents views read the same two things: the kit's colours and the sections' rows.
  agentsCtx(t, sp, ctx) {
    return { c: tokens(t), sections: this.statusSections(sp, ctx) };
  }

  // Status, collapsed: one mark per section.
  agentsRail(t, sp, ctx) {
    const { c, sections } = this.agentsCtx(t, sp, ctx);
    return sections.map((s) => {
      const rows = s.entries.filter((e) => !e.lines.length).map((e) => this.railRow(e.a, e.a.space_name || null, ctx.now));
      const lead = s.id === "other" ? { icon: "lu-layers" } : { status: s.id };
      return item(this.railTile(c, `rail-section-${s.id}`, { ...lead, rows, label: s.label, urgent: false }), SIDEBAR.railRow);
    });
  }

  // Threads, collapsed: one mark per project (or per shelf: Pinned, Snoozed, Settled).
  threadsRail(t, sp, ctx) {
    if (!this.threads) return [];
    const c = tokens(t);
    const sections = threadSections(this.threadRows(ctx), { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} });
    const icons = { pinned: "lu-pin", snoozed: "lu-clock", settled: "lu-check" };
    return sections.map((s) => {
      const p = s.project ? ctx.project(s.project) : null;
      const w = s.project ? sp.find((x) => x.id === s.project) : null;
      const list = s.rows.map(({ a }) => this.railRow(a, p ? null : ctx.project(a.space)?.name ?? null, ctx.now));
      const lead = p ? { initial: initialOf(p.name), tone: p.tone } : { icon: icons[s.id] ?? "lu-message-square" };
      return item(this.railTile(c, `rail-thread-${s.id}`, { ...lead, rows: list, label: p?.name ?? s.label ?? "Conversations", open: Boolean(w?.active), space: w?.id ?? null, menu: w ? () => this.menu(w) : null }), SIDEBAR.railRow);
    });
  }

  // The three views, the View switch composition: a track open; collapsed, the current view's button and its menu.
  // Each tooltip has the view's key; Status carries the dot while someone needs you.
  switchViews({ view, collapsed, open, asks, chords }) {
    const tips = Object.fromEntries(Object.entries(VIEWS).map(([key, label]) => [key, tooltip({ label, chord: chords[key] })]));
    const pick = (next, cx) => { this.setView(next, cx); this.paint(); };
    const toggle = (next) => { this.viewMenu = next; this.paint(); };
    const menu = (_e, cx) => { cx.stop_propagation(); openPieceMenu({ id: "sidebar.switch", title: "Projects, Status, Threads" }); };
    return viewSwitch({ view, column: collapsed, open, asks, carry: true, tips })(collapsed ? "rail-view" : "spaces-view", tokens(theme()),
      collapsed ? { onChange: pick, onOpen: toggle, onMenu: menu } : { onChange: pick, onMenu: menu });
  }

  switchPart(look) {
    const t = theme();
    return stack({ variant: "sidebar switch" }, look.finding ? this.findField(t) : look.shown ? this.switchViews(look) : null)("spaces-switch", tokens(t));
  }

  threadsView(t, sp, ps, ctx) {
    if (!this.threads) return [this.loadingRows(t)];
    const c = tokens(t);
    const project = this.projectOf(sp, t);
    const rows = this.threadRows(ctx);
    if (!rows.length) return [item(emptyState({ icon: "message-square", text: "No conversations yet" })("threads-empty", c))];
    const sections = threadSections(rows, { order: this.threadOrder, group: this.threadGroup, now: ctx.now, since: this.since ?? {} });
    // Under its project's header a conversation is nested: indented, the agent's icon as its mark, and no project line.
    const row = ({ a, th }, nested = false) => {
      if (a.asleep) return { rh: H.line, el: this.asleepLine(a, t) };
      const when = (this.threadOrder === "started" ? th?.began : th?.said ?? th?.at) ?? this.since?.[a.address]?.at;
      const unread = isUnread(a.labels), up = woke(a, ctx.now), settled = Boolean(settledOf(a.labels)) && !backFromSettled(a);
      const unreadable = this.threads[a.address]?.unavailable ?? null;
      // Pin and the rest stay in the menu; under the pointer, Settle or Bring back.
      const acts = { settle: () => label(a.address, SETTLED_LABEL, `${Date.now()}:${a.turn ?? 0}`), unsettle: () => label(a.address, SETTLED_LABEL) };
      const actions = threadActions({ settled, status: a.status, pinned: a.pin != null }).map((x) => ({ ...x, act: acts[x.id] }));
      const word = threadWord({ unreadable: Boolean(unreadable), snoozedUntil: snoozedUntil(a.labels), woke: up, now: ctx.now });
      const more = {
        label: this.nameOf(a),
        time: this.showTime === false || !when || word ? null : duration(Math.max(0, ctx.now - when)),
        directory: word ?? (nested ? null : project(a.space)?.name) ?? machineOf(a.address),
        wordTip: unreadable,
        quiet: Boolean(unreadable),
        refresh: unreadable ? (cx) => this.refreshThreads(cx) : null,
        // What the agent says it is on, or said last; else the last thing you wrote.
        activity: unreadable ? null : said(a) ?? (th?.prompt ? `You: ${th.prompt}` : null),
        oneLine: this.narrow,
        ...this.extras(a, ctx),
      };
      return { rh: sessionHeight(more), el: agentSession(a, nested ? 1 : 0, c, this.navRow(a, this.rowFor(a, actions, { title: th?.title ?? null, session: th?.file ?? null })), more) };
    };
    // Rows of varying height: where each one starts, for the pill.
    const stack = (laid, gap) => laid.reduce((acc, r, k) => ({ h: acc.h + r.rh + (k ? gap : 0), tops: [...acc.tops, acc.h + (k ? gap : 0)] }), { h: 0, tops: [] });
    const quiet = (g, nested) => {
      const zOpen = this.asleepOpenOf(g.id);
      const drawn = this.unfolded(`asleep-${g.id}`, zOpen, ctx.now) ? g.rows.map((r) => row(r, nested)) : [];
      const box = this.foldBox(`asleep-${g.id}`, zOpen, drawn.map((r) => r.el), ctx.now, 6);
      const h = drawn.reduce((n, r, k) => n + r.rh + (k ? 6 : 0), 0);
      const a = g.rows[0].a;
      const name = g.name || project(a.space)?.name || a.asleep.spaceName;
      return [item(this.asleepHead(c, g, name), H.line), ...box.map((el) => item(el, zOpen ? ((this.foldH ?? {})[`asleep-${g.id}`] ?? h) : 0))];
    };
    return sections.flatMap((s, i) => {
      const split = s.id.startsWith("project-") ? asleepGroups(s.rows, { asleepOf: (r) => r.a.asleep ?? null, key: s.project ?? s.id }) : { live: s.rows, groups: [] };
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
      // Alone, the active list is the inbox itself: no header. Asleep rows park at the end, one project each.
      if (s.id === "active" && sections.length === 1) {
        const live = s.rows.filter((r) => !r.a.asleep);
        const groups = [...Map.groupBy(s.rows.filter((r) => r.a.asleep), (r) => r.a.space)]
          .flatMap(([key, list]) => asleepGroups(list, { asleepOf: (r) => r.a.asleep, key }).groups);
        if (!groups.length) return s.rows.map((r) => { const { rh, el } = row(r); return item(el, rh, r.a.focused ? agentMark(0, rh) : null); });
        return [...live.map((r) => { const { rh, el } = row(r); return item(el, rh, r.a.focused ? agentMark(0, rh) : null); }), ...groups.flatMap((g) => quiet(g, false))];
      }
      // A project's conversations: under the pointer its + starts a new one there.
      const w = s.project ? sp.find((x) => x.id === s.project) : null;
      const add = w ? { label: `New conversation in ${w.name}`, go: () => this.newAgentMenu(placeOfSpace(w)) } : null;
      const onHover = w ? (h, cx) => { if (h ? this.hoverHead !== s.id : this.hoverHead === s.id) { this.hoverHead = h ? s.id : null; this.redraw(cx); } } : null;
      const headName = p ? p.name : whole ? whole.rows[0].a.asleep.spaceName : (s.label ?? "Active");
      const head = [...(i ? [lift(G.lg)] : []), item(this.sectionHead(c, `thread-${s.id}`, toggle,
        { title: headName, status: whole ? "asleep" : "none", count: sectionCount(open, s.rows.length), add, hover: this.hoverHead === s.id, onHover }), H.line)];
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
    const item = this.lines();
    const copy = (text) => (cx) => cx.write_to_clipboard?.(text);
    const session = m.session ? paths.basename(m.session).replace(/\.jsonl$/, "").replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, "") : null;
    const title = m.title ?? l[THREAD_LABEL] ?? null;
    // Its project is kept with the agent (conversation key, else its terminal's id); the sidebar holds the database.
    const conversation = session && /^[0-9a-f]{8}-/.test(session) ? session : null;
    const moveKeys = [conversation, l[ID_LABEL] ? `term:${l[ID_LABEL]}` : null].filter(Boolean);
    const movedTo = moveKeys.map((key) => (shared("kanso.projects") ?? {})[key]).find(Boolean) ?? null;
    const shownIn = movedTo ?? sp?.id ?? null;
    // A short queue, so two quick moves both land.
    const moveTo = (project) => setShared("kanso.move", [...(Array.isArray(shared("kanso.move")) ? shared("kanso.move") : []).slice(-15), { address: m.address, project, n: Date.now() + Math.random() }]);
    const kill = (cx) => { this.armed.press("close", cx, () => run("terminal.kill", { terminal: m.address })); };
    const others = spaces().filter((w) => !w.machine && w.id !== shownIn);
    const name = this.subjectOf(m, l, a, title);
    const into = (sub) => () => { this.sub = sub; this.menuAt = -1; };
    // A picker is its own Menu, named for what it acts on; Escape returns to the first.
    if (this.sub === "snooze") return this.popup(t, `Snooze ${name}`, this.actions(item, snoozePresets(now).map((x) => ({ act: "snooze-until", of: [x.label], does: () => label(m.address, SNOOZE_LABEL, x.until), hint: x.when }))));
    if (this.sub === "move") {
      return this.popup(t, `Move ${name} to`, this.actions(item, [...others.map((w) => ({ act: "move-to", of: [w.name], does: () => moveTo(w.id) })),
        ...(movedTo ? [{ act: "move-back", of: [sp?.name ?? "where it runs"], does: () => moveTo(null) }] : [])]));
    }
    if (this.sub === "copy") {
      return this.popup(t, "Copy", this.actions(item, [
        ...(p?.cwd ? [{ act: "copy-folder", does: copy(p.cwd), hint: tilde(p.cwd) }] : []),
        ...(p?.branch ? [{ act: "copy-branch-row", does: copy(p.branch), hint: p.branch }] : []),
        ...(session ? [{ act: "copy-conversation", does: copy(session), hint: `${session.slice(0, 4)}\u2026` }] : []),
      ]));
    }
    const more = { hint: "\u203a", keep: true };
    return this.popup(t, name, [
      ...this.actions(item, [
        ...(p ? [{ act: "open", does: () => run("pane.focus", { pane: p.pane }) }] : []),
        { act: "rename", does: () => renameTerminal(m.address, l[NAME_LABEL] || l[THREAD_LABEL] || title || a?.title || "") },
        { act: pinned ? "unpin-top" : "pin-top", does: () => this.pinThread({ address: m.address, pin: pinned ? 1 : null }) },
        ...(settled ? [{ act: "bring-back", does: () => label(m.address, SETTLED_LABEL) }] : []),
        ...(!settled && free ? [{ act: "settle", does: () => label(m.address, SETTLED_LABEL, `${now}:${k?.turn ?? 0}`) }] : []),
        { act: isUnread(l) ? "mark-read" : "mark-unread", does: () => label(m.address, UNREAD_LABEL, isUnread(l) ? "" : "1") },
        snoozed ? { act: "unsnooze", does: () => label(m.address, SNOOZE_LABEL) } : { act: "snooze", does: into("snooze"), ...more },
        ...(m.address && (others.length || movedTo) ? [{ act: "move", does: into("move"), ...more }] : []),
        ...(p?.cwd || p?.branch || session ? [{ act: "copy-menu", does: into("copy"), ...more }] : []),
        ...(p?.tab && sp && a ? [{ act: "sleep-agent", does: () => sleepAgent(sp.id, p.tab, p.pane) }] : []),
        ...(p?.tab && sp ? [{ act: "sleep-tab", does: () => sleepTab(sp.id, p.tab) }] : []),
        { act: a ? "close-agent" : "close-terminal", does: kill, keep: !this.armed.is("close"), verb: `close ${name}`, armed: this.armed.is("close") },
      ]),
      ...this.pieceItems(item, "sidebar.activity"),
    ]);
  }

  // What a menu names: the conversation's title, else the agent's.
  subjectOf(m, l, a, title) { return l[NAME_LABEL] || l[THREAD_LABEL] || title || a?.title || m.name || "this agent"; }

  zzMenuView(t, m) {
    const { title, items } = this.zzLines(this.lines(), m);
    return this.popup(t, title, items);
  }

  zzLines(item, m) {
    const z = m.asleep;
    const reachable = reachesRow(m);
    const armed = forgetHeld(shared(FORGET_HELD), z.terminal, Date.now(), ARM_MS);
    const forget = (cx) => {
      if (forgetHeld(shared(FORGET_HELD), z.terminal, Date.now(), ARM_MS)) {
        setShared(FORGET_HELD, null);
        this.forgetAsleep(z);
        return;
      }
      setShared(FORGET_HELD, holdForget(z.terminal, Date.now()));
      cx.timer?.after(ARM_MS + 50, (task) => {
        const held = shared(FORGET_HELD);
        if (held?.terminal === z.terminal && !forgetHeld(held, z.terminal, Date.now(), ARM_MS)) setShared(FORGET_HELD, null);
        this.redraw(task);
      });
      this.redraw(cx);
    };
    return { title: z.saved ? `${m.name}, asleep since ${since(z.saved)}` : `${m.name}, asleep`, items: this.actions(item, [
      ...(reachable ? [
        { act: "wake", does: () => arrange({ wake: { space: z.space, terminal: z.terminal } }) },
        ...(z.n > 1 ? [{ act: "wake-all-in", of: [z.n, z.tab], does: () => wakeRow(z) }] : []),
      ] : []),
      { act: "copy-conversation-id", does: (cx) => cx.write_to_clipboard?.(z.resume) },
      { separator: true },
      { act: "forget", does: forget, keep: true, verb: "forget", armed },
      { act: "everything-asleep", does: () => run("kanso-spaces.asleep") },
    ]) };
  }

  openAwayMenu(cx) {
    cx?.stop_propagation?.();
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height: menuHeight({ title: "While you were away", items: [{}, {}] }), at: "pointer", props: { awayMenu: true } });
  }

  awayMenuView(t) {
    return this.popup(t, "While you were away", this.actions(this.lines(), [
      { act: "away-dismiss", does: () => run("kanso-spaces.away-dismiss") },
      { act: "away-off", does: () => run("kanso-spaces.away-off") },
    ]));
  }

  openAsleepMenu(menu) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: W.menu, height: menuHeight(this.zzLines(sketch, menu)), at: "pointer", props: { menu } });
  }

  // Kept in shared "space.colors" so every window agrees; a gone space gives its hue up.
  assignColors(sp) {
    const palette = Object.keys(HUES);
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

  draw() {
    const t = theme();
    if (props()?.awayMenu) return this.awayMenuView(t);
    if (props()?.menu) return this.menuView(t);
    if (props()?.railMenu) return this.railMenuView(t);
    if (props()?.spaceMenu) return this.spaceMenuView(t);
    if (props()?.newAgent) return this.newAgentView(t);
    if (props()?.trees) return this.treesView(t);
    if (props()?.newConversation) return this.newConversationView(t);
    if (props()?.newProject) return this.newProjectView(t);
    if (props()?.worktree) return this.worktreeView(t);
    if (props()?.machineMenu) return this.computerMenuView(t);
    const { header, switch: views, rows, footer } = this.parts;
    if (!this.painting) { this.painting = true; this.paintTimer.after(0, () => { this.painting = false; this.paint(); }); }
    return stack({ variant: "sidebar" }, header, views, rows, footer)("spaces-root", tokens(t)).track_focus(this.handle)
      .on_key_down((e, cx) => this.listKeyDown(e, cx))
      .on_size_change((size, cx) => this.sized(size.width, cx))
      // A pane held in the strip and let go here goes back where it was.
      .on_mouse_up("left", dropStripDrag);
  }

  rows({ view, collapsed, query }) {
    const t = theme();
    if (this.sinceLeft) this.sinceLeft.showing = false;
    this.narrow = !collapsed && narrowAt(this.width);
    // The keyboard left (a click on a pane, say): the ring goes too.
    if (this.kbd && ((!this.needsOpen && collapsed) || !this.handle.is_focused())) { this.kbd = false; if (shared("kanso.list")) setShared("kanso.list", null); }
    this.navNext = [];
    const sp = visibleSpaces(spaces(), this.offNames());
    const ps = panes();
    this.assignColors(sp);
    const active = sp.find((p) => p.active);
    // Read once per draw: each read copies every record.
    const map = pieces(shared);
    this.showSwitch = shown("sidebar.switch", true, map);
    this.showActivity = shown("sidebar.activity", true, map);
    this.showAway = runs("sidebar.away", map);
    this.showTime = shown("sidebar.time", true, map);
    this.showTasks = runs("sidebar.tasks", map);
    const read = { terms: terminals(), alive: this.alive, strip: shared("strip.state") ?? {}, places: placesOf(sp, ps), now: Date.now() };
    // Each terminal now: a conversation read from another process in it is not this one's.
    this.termBy = new Map(read.terms.map((k) => [k.address, k]));
    // Every row built once per draw, for every view.
    const asleep = this.sleepingNow(sp, read.terms, ps);
    const rowsCtx = { ...read, asleep, spaces: sp, registry: registry(), spaceIds: new Set(sp.map((w) => w.id)), all: this.listed(ps, sp, read.terms).filter((a) => !asleep.dozing.has(a.address)) };
    const ctx = { ...rowsCtx, rowsBy: new Map(sp.map((w) => [w.id, this.spaceRows(w.id, rowsCtx)])), project: this.projectOf(sp, t) };
    const queue = this.refreshNeeds(sp, read.terms, asleep);
    const words = (query ?? "").trim();
    const lens = words ? this.narrowed(words.toLowerCase(), sp, ctx) : null;
    const shownSp = lens?.sp ?? sp, shownCtx = lens?.ctx ?? ctx;
    this.seenNow = this.seen(sp, ctx);
    this.seenAt = ctx.now; // when it was seen: a later write of it is no newer
    const needsOn = shown("sidebar.needs", true, map);
    const needsListOpen = this.needsOpen && needsOn && (queue.rows.length > 0 || queue.state !== "ready");
    const rows = stack({ variant: "sidebar rows" },
      shown("sidebar.needs", queue.rows.length > 0 || this.needsEmpty, map) ? queueControl(t, queue, collapsed, this.needsEmpty && !queue.rows.length, (cx) => this.toggleNeeds(cx)) : null,
      needsListOpen ? [this.needsList(t, queue, read.now)] : [this.list(t, collapsed, view,
        lens?.none ? [item(emptyState({ icon: "search", text: `No match for \u201c${words}\u201d` })("spaces-find-empty", tokens(t)), H.line * 3)]
          : view === "agents" ? (collapsed ? this.agentsRail(t, shownSp, shownCtx) : this.agentsView(t, shownSp, ps, shownCtx))
          : view === "threads" ? (collapsed ? this.threadsRail(t, shownSp, shownCtx) : this.threadsView(t, shownSp, ps, shownCtx)) : this.grouped(t, collapsed, shownSp, ps, shownCtx)),
        collapsed ? null : this.awayCard(t, active)])("spaces-rows", tokens(t));
    this.nav = this.navNext;
    // The row the ring was on is gone: it stays at the same place in the list.
    if (this.kbd && this.nav.length && !this.nav.some((n) => n.key === this.navKey)) this.navKey = this.nav[Math.min(this.navAt ?? 0, this.nav.length - 1)].key;
    this.navAt = Math.max(0, this.nav.findIndex((n) => n.key === this.navKey));
    return rows;
  }

  // A pill keeps its identity per view, so a change of view places it rather than sliding it across.
  list(t, collapsed, view, items) {
    const gap = view === "threads" ? SIDEBAR.threadGap : SIDEBAR.gap;
    const { els, space, agent } = laidOut(items, gap);
    const projects = !collapsed && view === "spaces";
    const active = spaces().find((s) => s.active)?.id ?? null;
    if (projects && active !== this.revealed) {
      this.revealed = active;
      const row = items.findLastIndex((it) => it.mark?.kind === "space");
      if (row >= 0) this.listScroll.scroll_to_item((space ? 1 : 0) + (agent ? 1 : 0) + row);
    }
    const pills = collapsed ? [] : [
      ...(space ? [pill("pill-space", space.y, space.h, tokens(t).w12)] : []),
      ...(agent ? [pill(`pill-agent-${view}`, agent.y, agent.h, tokens(t).w7)] : []),
    ];
    // Named, so its scroll position survives every redraw (an unnamed one is placed anew and starts at the top).
    // Open, its sides are the sidebar's gutter: each row's ground reaches out past it by the row's own padding, its content stays on it.
    return v_flex().id(`spaces-list-${collapsed ? "rail" : view}`).relative().flex_1().min_h(0).when(!collapsed, (el) => sidebarSides(el, SIDEBAR.gutter)).gap(collapsed ? 0 : gap).pt(collapsed ? G.sm : 0).pb(G.lg).overflow_y_scrollbar().mode(collapsed ? "hover" : "always")
      .when(projects, (el) => el.track_scroll(this.listScroll))
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; this.draggedAgent = null; this.redraw(cx); })
      // Rows keep their height: shrunk to fit, there would be nothing to scroll.
      .children([...pills, ...els.map((el) => el.flex_none())]);
  }
}
