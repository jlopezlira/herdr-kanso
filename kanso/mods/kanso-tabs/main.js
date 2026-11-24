import { localService, localName } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Derived from the `tabs` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: segmented tab pill, outlined Files and Changes buttons, no bar background.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-tabs; a Specs panel button with the pending count and a needs-you dot (sdd.badge).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-tabs; tabs and panel buttons without outlines; side panels mounted on demand (only the open one exists); Spend and Worktrees built in, Specs and Changes dropped; panel buttons are icons with their name on hover, dragged into any order, and hidden from Pieces (right-click one); trackpad scrolling moves one tab per swipe.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.
import { View, div } from "gpui-kit";
import { Popover } from "gpui-base";
import { spaces, panes, run, openOverlay, props, theme, window, shared, setShared, layout, appHome, exec, watchFolder, nextCommand, home, machines, notify, checking, terminals } from "herdr";
import { walkLayout, commitLayout, sidebarBack, foldSidebar, dropStripDrag } from "./layout.js";
import { Updater } from "./update.js";
import { arriveOnLinux, herdrIsTerminal } from "./linux-arrival.js";
import { tryOr, readCommands, bounded, afterMount } from "./pure.js";
import { openArrange } from "./open.js";
import { DIALOG, G, T, glyphOf, tokens } from "./ui.js";
import { pressAgain, Armed } from "./ui-button.js";
import { TextField } from "./ui-field.js";
import { plus, tooltip } from "./kit.js";
import { tabBarRoom } from "./ui-stack.js";
import { tabBar } from "./tab-bar.js";
import { boundChord } from "./ui-tooltip.js";
import { contextMenu } from "./context-menu.js";
import { TAB_NAME_LIMIT } from "./ui-tab.js";
import { pieceLines } from "./piece-lines.js";
import { tabMark, tabName, barState, foldTabs, renameWaits, landing, heldOn, dropMarks } from "./tab-bar-model.js";
import { Kdb, projectKey } from "./kdb.js";
import { projectOpen, OPEN } from "./panel-state.js";
import { TOOLS, PROBE_MS, probeTools, available, UNKNOWN_TOOLS, FAILED_TOOLS } from "./sim-registration.js";
import { commandOn, machineKey, offered, toolsFor, toolKey, withoutNegatives, forgetting, ASK_MS, RETRY_MS } from "./panel-tools.js";
import { pieces, runs, shown, setPiece, STORE, choice } from "./pieces.js";
import { reconcileSchedules, RUN_FAILURES } from "./schedules.js";
import { reconcileResumes } from "./clock.js";

const SCHEDULES_MS = 60_000;

function storedObject(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

// Mounted on demand: closing removes the block, so Herdr ends that mod (its timers, watches and processes stop).
const PANELS = {
  files: { mod: "kanso-panel", props: { panel: "files" } }, pr: { mod: "kanso-panel", props: { panel: "pr" } },
  issues: { mod: "kanso-panel", props: { panel: "issues" } },
  shipped: { mod: "kanso-panel", props: { panel: "shipped" } },
  caffeine: { mod: "kanso-panel", props: { panel: "caffeine" } },
  worktrees: { mod: "kanso-panel", props: { panel: "worktrees" } },
  ports: { mod: "kanso-panel", props: { panel: "ports" } },
  look: { mod: "kanso-panel", props: { panel: "look" } },
  containers: { mod: "kanso-containers" },
  insights: { mod: "kanso-spend" },
  memory: { mod: "kanso-guard" },
  sim: { mod: "kanso-sim" },
  dojo: { mod: "kanso-dojo" },
};

function customPanels() {
  const list = shared("kanso.panels");
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.mod === "string" && !(p.id in PANELS)) : [];
}

// A settled tab (put to sleep, say) is not on the bar.
export const shownTabs = (tabs) => (tabs ?? []).filter((c) => !c.settled);
const chooseTab = (id) => tryOr(() => run("tab.select", { id }));

// Both shared, so every bar agrees. A panel set to Hide is not mounted.
const ORDER = "kanso.panels.order";
const openSettings = (page) => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });
const BUILTIN = [
  { id: "files", label: "Files", icon: "lu-file" },
  { id: "insights", label: "Spend", icon: "lu-chart-column" },
  { id: "pr", label: "PR", icon: "lu-git-pull-request" },
  { id: "issues", label: "Tasks", icon: "lu-circle-dot" },
  { id: "shipped", label: "Shipped", icon: "lu-trophy" },
  { id: "caffeine", label: "Caffeine", icon: "lu-coffee" },
  { id: "worktrees", label: "Worktrees", icon: "lu-git-fork" },
  { id: "ports", label: "Ports", icon: "lu-plug" },
  { id: "containers", label: "Containers", icon: "lu-container" },
  { id: "memory", label: "Memory", icon: "lu-memory-stick" },
  { id: "look", label: "Images", icon: "lu-image" },
  { id: "sim", label: "Simulator", icon: "lu-smartphone" },
  { id: "dojo", label: "hjkl dōjō", icon: "lu-gamepad-2" },
];
const list = (key) => { const v = shared(key); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
const simulatorRoster = () => JSON.stringify([list(ORDER), choice("panel.sim", pieces(shared)), customPanels()]);

// Panels you never placed keep their catalog place after the ones you dragged.
// Simulator is not listed on a computer with neither Xcode nor the Android SDK.
function roster() {
  const all = [...BUILTIN, ...customPanels().map((p) => ({ id: p.id, label: p.label ?? p.id, icon: p.icon }))];
  const order = list(ORDER);
  const rank = new Map(all.map((p, i) => [p.id, order.includes(p.id) ? order.indexOf(p.id) : order.length + i]));
  return all.toSorted((a, b) => rank.get(a.id) - rank.get(b.id));
}

function panelList(tools) {
  const map = pieces(shared);
  return roster().filter((p) => offered(p.id, { sim: shared(TOOLS), ...tools })).map((p) => ({ ...p, on: runs(`panel.${p.id}`, map) }));
}

const drawnPanels = (all) => all.filter((p) => p.on);
const caffeineOn = () => Object.values(shared("kanso.caffeine") ?? {}).some((look) => look?.on);

function movePanel(from, to, tools) {
  const seen = drawnPanels(panelList(tools)).map((p) => p.id), i = seen.indexOf(from), j = seen.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  const moved = seen.toSpliced(i, 1).toSpliced(j, 0, from);
  setShared(ORDER, roster().map((p) => (seen.includes(p.id) ? moved[seen.indexOf(p.id)] : p.id)));
}

function setPanelOn(id, on) {
  setShared(STORE, setPiece(pieces(shared), `panel.${id}`, on ? "show" : "hide"));
}

function panelContent(id) {
  if (id === "preview") return { mod: "kanso-panel", props: { panel: "preview" } };
  if (PANELS[id]) return { ...PANELS[id] };
  const custom = customPanels().find((p) => p.id === id);
  if (!custom) return null;
  return custom.props !== undefined ? { mod: custom.mod, props: custom.props } : { mod: custom.mod };
}

// A size reported after layout: the sizes with it, or the same ones when it moved less than half a pixel.
const withSize = (sizes, key, width) => (Math.abs((sizes[key] ?? 0) - width) < 0.5 ? sizes : { ...sizes, [key]: width });
const closeKey = (tab) => `close-${tab.id}`;
const GLYPH_SHARE = 0.57;
const nameWidth = (label) => Math.ceil(String(label).length * T.value * GLYPH_SHARE) + G.md;
const measured = (id, onSize) => (el) => div().id(id).flex_none().on_size_change(onSize).child(el);

// Reads and removes the paths waiting in the inbox; returns the newest.
export async function takeOpens(dir) {
  const r = await localService(fileApi).drain(dir);
  const opened = (r.stdout ?? "").split("\0").map((p) => p.trim()).filter(paths.isAbsolute);
  return opened.at(-1) ?? null;
}

export default class Tabs extends View {
  tabW = {};
  barW = {};
  doorW = {};
  toolW = {};
  hoverPanel = null;
  armed = new Armed();
  tabMenu = null;
  panelMenu = null;
  dropAt = null;
  renaming = null;
  renamed = null;
  moreOpen = false;
  asking = new Set();
  answers = {};
  here = "";
  visit = null;

  init(_props, cx) {
    this.endDrags();
    // Opened as the Panels popup: this copy draws the list, not the bar.
    const given = tryOr(() => props()); // null on a host without props
    this.arrange = Boolean(given?.arrange);
    this.panels = storedObject("panels");
    this.db = null;
    this.holding = false;
    this.openRow = undefined;
    if (!this.arrange && cx) {
      afterMount(cx, (later) => later.spawn(() => Promise.all([arriveOnLinux(localName()), herdrIsTerminal(localName())]).catch(() => false)));
      this.db = new Kdb(cx.timer);
      this.watchOpens(cx);
      this.watchSchedules(cx);
      // The bar is always on screen and the sidebar's footer may not be, so the bar polls for releases.
      this.updater = new Updater();
      this.updater.start(cx);
      cx.timer.after(0, (next) => this.probeSimulator(next));
      readCommands(cx, () => nextCommand(), (c, cx) => this.barCommand(c, cx));
    }
  }

  // keys.json: tab-N and panel-N arrive here as commands.
  async barCommand(c, cx) {
    const name = String(c).replace(/^kanso-tabs\./, "");
    if (name === "update") this.updater.install(cx);
    else if (name === "check") await this.updater.check(cx, true, true);
    else if (name === "settings" || name.startsWith("settings-")) {
      const asked = name.slice(9);
      openSettings(!asked || asked === "mods" ? "pieces" : asked);
    }
    else this.command(name);
    cx.notify();
  }

  probeSimulator(cx) {
    const signature = simulatorRoster();
    if (this.simSignature === signature || this.simRunning) return;
    this.simSignature = signature;
    if (!runs("panel.sim", pieces(shared))) return;
    this.simRunning = true;
    this.simProbe = (this.simProbe ?? 0) + 1;
    this.simSettled = false;
    const probe = this.simProbe;
    const finish = (tools, done) => {
      if (this.simProbe !== probe || this.simSettled) return;
      this.simSettled = true;
      setShared(TOOLS, tools); done.notify();
      if (tools.state) done.timer.after(RETRY_MS, () => { if (this.simProbe === probe) this.simSignature = null; });
    };
    const deadline = cx.timer.after(PROBE_MS, (late) => { this.simRunning = false; finish(UNKNOWN_TOOLS, late); });
    cx.spawn(async (task) => {
      const tools = await probeTools(window()?.platform ?? "macos", home(), exec, () => this.simProbe === probe && !this.simSettled).catch(() => FAILED_TOOLS);
      if (this.simProbe === probe) this.simRunning = false;
      deadline.cancel(); finish(tools, task); task.notify();
    });
  }

  commandsHere() {
    return { commands: this.answers, machine: this.here };
  }

  askCommands(cx, space) {
    if (this.arrange || !cx) return;
    const visit = `${space?.id ?? ""}\t${this.here}`;
    if (visit !== this.visit) {
      this.visit = visit; this.answers = withoutNegatives(this.answers);
      if (this.simSettled && !available(shared(TOOLS))) this.simSignature = null;
    }
    const tools = toolsFor(this.here).filter((tool) => !this.asking.has(toolKey(tool)) && !(toolKey(tool) in this.answers));
    if (!tools.length) return;
    const keys = tools.map(toolKey);
    this.asking = new Set([...this.asking, ...keys]);
    cx.timer.after(0, (next) => next.spawn(async (task) => {
      const found = await Promise.all(tools.map((tool) => bounded(commandOn(tool), task.timer, ASK_MS)));
      const answers = keys.map((key, i) => [key, typeof found[i] === "boolean" ? found[i] : null]);
      this.answers = { ...this.answers, ...Object.fromEntries(answers) };
      this.asking = new Set([...this.asking].filter((key) => !keys.includes(key)));
      const failed = answers.filter(([, answer]) => answer === null).map(([key]) => key);
      if (failed.length) task.timer.after(RETRY_MS, () => { this.answers = forgetting(this.answers, failed); });
      task.notify();
    }));
  }

  command(name) {
    const tab = /^tab-(\d)$/.exec(name), panel = /^panel-(\d)$/.exec(name);
    // Herdr passes a mod command no arguments, so the path rides in its name: `herdr-app do 'kanso-tabs.look <path>'`.
    // `at` makes each one new props, so an open Images starts over on it. (`gallery`, its old command, too).
    const look = /^(?:look|gallery)(?:[\s:]+([\s\S]+))?$/.exec(name);
    if (look) this.show("look", look[1]?.trim() ? { panel: "look", path: look[1].trim(), at: Date.now() } : { panel: "look" });
    else if (tab) {
      const shown = shownTabs(spaces().find((s) => s.active)?.tabs)[Number(tab[1]) - 1];
      if (shown) chooseTab(shown.id);
    } else if (name === "memory") {
      const tree = layout();
      if (this.openPanel(walkLayout(tree, "panel"), walkLayout(tree, "panel-body")) !== "memory") this.mount("memory");
    } else if (name === "sim" || name === "dojo" || panel) {
      const id = panel ? panelList(this.commandsHere()).filter((x) => x.on)[Number(panel[1]) - 1]?.id : name;
      if (!id || !panelList(this.commandsHere()).some((item) => item.id === id && item.on)) return;
      const tree = layout(), now = this.openPanel(walkLayout(tree, "panel"), walkLayout(tree, "panel-body"));
      this.mount(now === id ? null : id);
    }
  }

  // markdown-handler.sh leaves .md paths opened from outside in data/kanso-open; the newest shows in the preview.
  watchSchedules(cx) {
    if (checking()) return;
    const reconcile = (next) => next.spawn(async () => {
      const failed = await reconcileSchedules(this.db).catch(() => null);
      if (failed && JSON.stringify(failed) !== JSON.stringify(shared(RUN_FAILURES) ?? [])) setShared(RUN_FAILURES, failed);
      await reconcileResumes(terminals()).catch(() => null);
    });
    cx.timer.after(0, reconcile);
    cx.timer.every(SCHEDULES_MS, reconcile);
  }

  watchOpens(cx) {
    const dir = paths.join(appHome(), "data", "kanso-open");
    cx.spawn(async (cx) => {
      try {
        await localService(fileApi).mkdir(dir);
        for (;;) {
          const path = await takeOpens(dir);
          if (path) this.preview(path);
          await watchFolder(dir);
        }
      } catch { /* no inbox: nothing opens from outside */ }
    });
  }

  preview(path) { this.show("preview", { panel: "preview", path, on: null }); }

  // A kanso-panel panel with what to show in it: the preview's file, Look's.
  show(id, props) {
    if (!walkLayout(layout(), "panel-body")) return;
    this.want = id;
    this.mountedAt = Date.now();
    commitLayout({ panel: { id, type: "block", content: { mod: "kanso-panel", props } } });
  }

  // Herdr folds a single-child wrapper: the node that hides is the "panel" wrapper if the layout has one, else the stack.
  openPanel(panel, body) {
    const box = panel ?? body, child = body?.children?.[0];
    return !box || box.hidden || !child || child.hidden ? null : child.id;
  }

  mount(id, extra) {
    const content = id ? panelContent(id) : null;
    if (id && !content) return;
    if (!walkLayout(layout(), "panel-body")) return;
    const props = content?.props ? { ...content.props, ...(extra ?? {}) } : content?.props;
    const block = content ? { ...content, ...(props ? { props } : {}) } : null;
    this.want = id;
    this.mountedAt = Date.now();
    commitLayout({ panel: id ? { id, type: "block", content: block } : null });
  }

  keepRail(tree) {
    if (this.arrange) return;
    const back = sidebarBack(tree, this.railBack);
    this.railBack = back.acted;
    if (back.fold) foldSidebar();
  }

  // A change just sent hasn't landed yet: don't read the old state as a choice.
  inFlight(now) {
    return this.want !== undefined && now !== this.want && Date.now() - this.mountedAt < 1000;
  }

  // Hidden means unmounted, shown means mounted: stays honest when a key or a panel's own button changed it.
  reconcile(space, panel, body, now) {
    if (!body || this.inFlight(now)) return;
    const child = body.children?.[0];
    const hidden = (panel ?? body).hidden || Boolean(child?.hidden), mounted = (body.children ?? []).length > 0;
    if (hidden && mounted) this.mount(null);
    else if (!hidden && !mounted && this.openRow) this.mount(this.openRow);
    // A panel kept from an older Kanso whose mod was renamed (Spend was token-spend): remount with this version's.
    else if (mounted && child?.id) {
      const want = panelContent(child.id);
      // A panel this Kanso no longer has closes; "preview" is opened by Files or Open with, not by a button.
      if (!want) { if (child.id !== "preview") this.mount(null); return; }
      if (want?.mod && child.content?.mod && child.content.mod !== want.mod) this.mount(hidden ? null : child.id);
    }
  }

  syncPanel(space, now, enabled) {
    if (this.arrange || !this.db || !space || this.inFlight(now)) return;
    const project = tryOr(() => projectKey(space, home()));
    if (!project) return;
    if (project !== this.project) {
      const first = this.project === undefined;
      this.project = project;
      this.holding = true;
      this.restoreOpen(project, space, now, enabled, first);
      return;
    }
    if (this.holding) {
      if ((now ?? null) === (this.openRow ?? null)) this.holding = false;
      else return;
    }
    const next = now ?? null;
    if (this.openRow === next) return;
    this.openRow = next;
    this.db.savePanelState(project, OPEN, { id: next }).catch(() => {});
  }

  restoreOpen(project, space, now, enabled, first) {
    const legacy = this.panels?.[space.id];
    this.db.panelState(project, OPEN).then((record) => {
      if (this.project !== project) return;
      const decision = projectOpen({ record, legacy: typeof legacy === "string" ? legacy : undefined, enabled, now, first });
      this.openRow = decision.save ?? null;
      if (decision.adopt) {
        this.holding = false;
        this.db.savePanelState(project, OPEN, { id: this.openRow }).catch(() => {});
        return;
      }
      // A new `at` makes Herdr build the panel again, so it reads this project's state even when the same one was open.
      this.mount(decision.mount, decision.mount ? { at: Date.now() } : undefined);
      if ((decision.mount ?? null) === (now ?? null)) this.holding = false;
      if (record === undefined) this.db.savePanelState(project, OPEN, { id: this.openRow }).catch(() => {});
    }).catch(() => { if (this.project === project) this.holding = false; });
  }

  // A trackpad sends dozens of small events per swipe: add them up so one swipe moves one tab.
  wheel(e) {
    // A mouse wheel reports lines: one notch, one tab.
    if (Math.abs(e.delta_lines?.y ?? 0) >= 1) { run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next"); return; }
    const dy = e.delta.y;
    const now = Date.now();
    if (now - (this.wheelAt ?? 0) > 300) this.wheelSum = 0;
    this.wheelAt = now;
    this.wheelSum = (this.wheelSum ?? 0) + dy;
    if (Math.abs(this.wheelSum) < 40) return;
    run(this.wheelSum > 0 ? "tab.prev" : "tab.next");
    this.wheelSum = 0;
  }

  // A size that moved draws again.
  sized(sizes, key, width, cx) {
    const next = withSize(sizes, key, width);
    if (next !== sizes) cx.notify();
    return next;
  }

  // Double-click renames in place, the name selected; Enter or leaving keeps it, Escape restores it.
  startRename(tab, cx) {
    const text = new TextField({ value: tab.name }, { limit: TAB_NAME_LIMIT });
    text.set_selected_range({ start: 0, end: tab.name.length });
    text.on("submit", (_e, cx) => this.endRename(cx, true));
    text.on("blur", (_e, cx) => this.endRename(cx, true));
    this.renaming = { id: tab.id, from: tab.name, text };
    text.focus();
    cx.timer?.after(0, () => this.renaming?.text.focus());
    cx.notify();
  }

  endRename(cx, keep) {
    const renaming = this.renaming;
    if (!renaming) return;
    this.renaming = null;
    const name = renaming.text.value().trim();
    renaming.text.release();
    if (keep && name !== renaming.from) this.rename(renaming, name);
    cx.notify();
  }

  // The new name draws at once and waits, on another computer, until the tab carries it.
  rename({ id, from }, name) {
    this.renamed = { id, from, name };
    try { run("tab.rename", { id, name }); } catch { this.refuseRename(); }
  }

  refuseRename() {
    const { from } = this.renamed;
    this.renamed = null;
    notify({ title: `Couldn't rename ${from}`, level: "error" });
  }

  // Confirmed when the tab carries the name; refused when its computer cannot be reached.
  settleRename(tabs, state) {
    if (!this.renamed) return;
    if (state === "unreachable") this.refuseRename();
    else if (!renameWaits(this.renamed, tabs)) this.renamed = null;
  }

  // A tab holding an agent asks twice; a plain shell closes on one press.
  closeTab(tab, ps, cx) {
    const close = () => run("tab.close", { id: tab.id });
    if (ps.some((p) => p.tab === tab.id && p.program?.agent)) this.armed.press(closeKey(tab), cx, close);
    else close();
  }

  pressTab(tab, e, cx) {
    if (e.click_count === 2) { this.pressed = null; this.startRename(tab, cx); return; }
    this.pressed = tab.id;
  }

  // While a tab is held, the one under the pointer is where it lands.
  landed(from, at, id, hovered, cx) {
    const next = from ? landing(at, id, hovered) : at;
    if (next !== at) cx.notify();
    return next;
  }

  endDrags() {
    this.pressed = null;
    this.dropAt = null;
    this.dragPanel = null;
    this.dropPanel = null;
  }

  dropTab(tab, space) {
    const from = this.pressed;
    if (from && from !== tab.id) run("tab.move", { id: from, index: space.tabs.findIndex((other) => other.id === tab.id) + 1 });
  }

  // What the tab draws now: its mark, the press that arms it, the rename in place or waiting, the hold while it is dragged.
  tabLook(tab, ps) {
    // Armed only while its × is there to press again: the chosen tab.
    const armed = tab.active && this.armed.is(closeKey(tab));
    const waiting = this.renamed?.id === tab.id;
    return {
      key: tab.id, label: waiting ? this.renamed.name : tabName(tab, ps), mark: shown("tabs.state", true, pieces(shared)) ? tabMark(tab) : null, armed, pending: waiting,
      tip: armed ? pressAgain(`close ${tabName(tab, ps)}`) : null,
      held: heldOn(tab.id, this.pressed, this.dropAt),
      editing: this.renaming?.id === tab.id ? this.renaming.text : null,
    };
  }

  tabWire(c, tab, { space, ps, connected }) {
    const box = measured(`tab-box-${tab.id}`, (s, cx) => { this.tabW = this.sized(this.tabW, tab.id, s.width, cx); });
    return (el) => {
      const wired = connected ? el
        .on_mouse_down("left", (e, cx) => this.pressTab(tab, e, cx))
        .on_hover((hovered, cx) => { this.dropAt = this.landed(this.pressed, this.dropAt, tab.id, hovered, cx); })
        .on_mouse_up("left", () => this.dropTab(tab, space))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.armed.clear(); this.tabMenu = tab.id; cx.notify(); })
        .on_key_down((e, cx) => { if (this.renaming?.id === tab.id && e.key === "escape") { cx.stop_propagation(); this.endRename(cx, false); } }) : el;
      return box(this.tabMenu === tab.id ? this.tabMenuPopover(c, wired, tab, { space, ps }) : wired);
    };
  }

  toolBox(key) {
    return measured(`tool-box-${key}`, (s, cx) => { this.toolW = this.sized(this.toolW, key, s.width, cx); });
  }

  doorWire(c, p) {
    return (el) => {
      const wired = measured(`door-box-${p.id}`, (s, cx) => { this.doorW = this.sized(this.doorW, p.id, s.width, cx); })(el)
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.dragPanel = p.id; })
        .on_hover((hovered, cx) => {
          this.hoverPanel = hovered ? p.id : this.hoverPanel === p.id ? null : this.hoverPanel;
          this.dropPanel = this.landed(this.dragPanel, this.dropPanel, p.id, hovered, cx);
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.dragPanel;
          this.dragPanel = null;
          this.dropPanel = null;
          if (from && from !== p.id) movePanel(from, p.id, this.commandsHere());
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.panelMenu = p.id; cx.notify(); });
      return this.panelMenu === p.id ? this.panelMenuPopover(c, wired, p) : wired;
    };
  }
  // Right-click on a panel's button: its name, Hide, Settings, and the whole list of panels.
  panelMenuPopover(c, trigger, panel) {
    const shut = (cx) => { this.panelMenu = null; cx.notify(); };
    const lines = [
      ...pieceLines(`panel.${panel.id}`, { done: shut }).slice(1),
      { separator: true },
      { act: "panels", does: (cx) => { shut(cx); openSettings("pieces"); } },
    ];
    return Popover.new(`panel-menu-${panel.id}`).trigger(trigger).open(true).on_open_change((open, cx) => { if (!open) shut(cx); })
      .content(contextMenu(`panel-menu-list-${panel.id}`, { title: `${panel.label} panel`, lines, framed: true }, c));
  }

  // Right-click: its name, Rename, New tab, Sleep, Close (twice with agents in it), then the piece lines.
  tabMenuPopover(c, trigger, tab, { space, ps }) {
    const shut = (cx) => { this.tabMenu = null; cx.notify(); };
    const agents = ps.filter((p) => p.tab === tab.id && p.program?.agent).length;
    const verb = `close ${agents} agent${agents === 1 ? "" : "s"}`;
    const armed = agents > 0 && this.armed.is(closeKey(tab));
    const lines = [
        { act: "rename", does: (cx) => { shut(cx); this.startRename(tab, cx); } },
        { act: "new-tab", does: (cx) => { shut(cx); run("tab.new", { space: space.id }); } },
        { act: "sleep-tab", does: (cx) => { shut(cx); openOverlay({ mod: "kanso-sleep", kind: "dialog", width: DIALOG.wide, props: { sleep: { scope: "tab", space: space.id, tab: tab.id } } }); } },
        { separator: true },
        { act: "close-tab", armed, verb: agents ? verb : null,
          does: (cx) => (agents ? this.armed.press(closeKey(tab), cx, () => { shut(cx); run("tab.close", { id: tab.id }); }) : (shut(cx), run("tab.close", { id: tab.id }))) },
      ...pieceLines("tabs.state", { named: true, done: shut }),
    ];
    return Popover.new(`tab-menu-${tab.id}`).trigger(trigger).open(true).on_open_change((open, cx) => { if (!open) shut(cx); })
      .content(contextMenu(`tab-menu-list-${tab.id}`, { title: tabName(tab, ps), lines, framed: true }, c));
  }

  render(cx) {
    const space = spaces().find(p => p.active);
    this.here = machineKey(space);
    this.askCommands(cx, space);
    if (!this.arrange && cx && !this.simQueued && this.simSignature !== simulatorRoster()) {
      this.simQueued = true;
      cx.timer.after(0, (next) => { this.simQueued = false; this.probeSimulator(next); });
    }
    const openTabs = shownTabs(space?.tabs);
    // Each live-data read copies the whole list: read once per render.
    const ps = panes();
    const tree = layout();
    const c = tokens(theme());
    this.tabW = Object.fromEntries(Object.entries(this.tabW).filter(([id]) => openTabs.some((tab) => tab.id === id)));
    const state = barState(space, machines());
    const connected = state === "connected";
    this.settleRename(openTabs, state);
    const panel = walkLayout(tree, "panel"), body = walkLayout(tree, "panel-body");
    const now = this.openPanel(panel, body);
    if (this.db && space) {
      const project = tryOr(() => projectKey(space, home()));
      if (project && project !== this.project) this.openRow = undefined;
    }
    const allPanels = panelList(this.commandsHere());
    const shownPanels = drawnPanels(allPanels);
    const enabled = shownPanels.map((p) => p.id);
    const roster = allPanels.map((p) => ({ id: p.id, label: p.label, icon: p.icon ? glyphOf(p.icon.replace(/^lu-/, "")) : null, on: p.on }));
    if (JSON.stringify(roster) !== JSON.stringify(shared("kanso.panels.all") ?? null)) setShared("kanso.panels.all", roster);
    const arrange = shown("tabs.arrange", true, pieces(shared));
    this.reconcile(space, panel, body, now);
    this.syncPanel(space, now, enabled);
    // A panel turned off while open closes (a file's preview has no button to turn off).
    if (now && now !== "preview" && !enabled.includes(now) && !this.inFlight(now)) this.mount(null);
    const windows = Boolean(window()?.buttons);
    const doors = connected ? shownPanels : [];
    const tools = connected ? [this.toolW.plus ?? null, ...(arrange ? [this.toolW.arrange ?? null] : [])] : [];
    const fixed = Array.from({ length: 1 + (windows ? 3 : 0) }, () => null);
    const room = this.barW.bar === undefined ? null : tabBarRoom(this.barW.bar, { tools, doors: [...doors.map((p) => this.doorW[p.id] ?? null), ...fixed] });
    if (this.hoverPanel && !doors.some((p) => p.id === this.hoverPanel)) this.hoverPanel = null;
    const { shown: kept, folded } = connected ? foldTabs({ widths: openTabs.map((tab) => this.tabW[tab.id]), chosen: openTabs.findIndex((tab) => tab.active), room, gap: G.hair, more: (this.barW.more ?? 0) + G.sm })
      : { shown: openTabs.map((_, i) => i), folded: [] };
    const drawn = kept.map((i) => openTabs[i]);
    const drops = dropMarks(drawn.map((tab) => tab.id), this.pressed, this.dropAt);
    const doorDrops = dropMarks(doors.map((p) => p.id), this.dragPanel, this.dropPanel);
    const items = drawn.map((tab) => ({ ...this.tabLook(tab, ps), closable: openTabs.length > 1, drop: drops[tab.id] ?? false }));
    const more = plus(folded.length);
    const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    const tips = {
      "New tab": tooltip({ label: "New tab", chord: boundChord("kanso-spaces.start") }),
      Arrange: tooltip({ label: "Arrange", chord: boundChord("kanso-strip.arrange") }),
      "kansō help": tooltip({ label: "kansō help", chord: boundChord("mod.open:kanso-help") }),
      ...Object.fromEntries(doors.map((p, i) => [p.label, tooltip({ label: p.label, chord: boundChord(`kanso-tabs.panel-${i + 1}`) })])),
    };
    const presses = {
      "circle-question-mark": () => run("mod.open", { name: "kanso-help" }),
      ...(connected ? { plus: () => run("kanso-spaces.start") } : {}),
      ...(connected && arrange ? { "panels-top-left": () => openArrange() } : {}),
      ...(windows ? { minus: () => run("window.minimize"), square: () => run("window.maximize"), x: () => run("window.close") } : {}),
      ...Object.fromEntries(doors.map((p) => [`panel:${p.id}`, () => this.mount(now === p.id ? null : p.id)])),
    };
    const wires = {
      ...Object.fromEntries(drawn.map((tab) => [`tab:${tab.id}`, this.tabWire(c, tab, { space, ps, connected })])),
      ...Object.fromEntries(doors.map((p) => [`panel:${p.id}`, this.doorWire(c, p)])),
      plus: (el) => this.toolBox("plus")(stop(el).on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openArrange(); })),
      "panels-top-left": (el) => this.toolBox("arrange")(stop(el)),
      ...Object.fromEntries(["circle-question-mark", "minus", "square", "x"].map((key) => [key, stop])),
      [more]: measured("tab-bar-more-box", (s, cx) => { this.barW = this.sized(this.barW, "more", s.width, cx); }),
    };
    const bar = tabBar({
      items, value: openTabs.find((tab) => tab.active)?.id ?? null, folded: folded.map((i) => ({ key: openTabs[i].id, label: tabName(openTabs[i], ps), mark: tabMark(openTabs[i]) })),
      overflow: this.moreOpen, panel: now,
      panels: doors.map((p) => ({ key: p.id, label: p.label, icon: p.icon, reveal: { shown: !p.icon || now === p.id || this.hoverPanel === p.id || (p.id === "caffeine" && caffeineOn()), width: nameWidth(p.label) }, held: heldOn(p.id, this.dragPanel, this.dropPanel), drop: doorDrops[p.id] ?? false })), state, arrange, help: true, tips, windows,
    });
    return bar("tab-bar", c, {
      presses, wires,
      onChange: (key, cx) => { this.armed.clear(); this.moreOpen = false; chooseTab(key); cx.notify(); },
      onClose: (key, cx) => { const tab = openTabs.find((other) => other.id === key); if (tab) this.closeTab(tab, ps, cx); },
      onOpen: (open, cx) => { this.moreOpen = open; cx.notify(); },
      onSize: (s, cx) => { this.barW = this.sized(this.barW, "bar", s.width, cx); this.keepRail(layout()); },
      onRelease: (e, cx) => { dropStripDrag(e, cx); this.endDrags(); cx.notify(); },
      onOver: (hovered, cx) => { if (!hovered && (this.pressed || this.dragPanel)) { this.endDrags(); cx.notify(); } },
      onWheel: (e) => this.wheel(e),
    });
  }
}
