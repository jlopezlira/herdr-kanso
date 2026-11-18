import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Derived from the `tabs` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: segmented tab pill, outlined Files and Changes buttons, no bar background.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-tabs; a Specs panel button with the pending count and a needs-you dot (sdd.badge).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-tabs; tabs and panel buttons without outlines; side panels mounted on demand (only the open one exists); Spend and Worktrees built in, Specs and Changes dropped; panel buttons are icons with their name on hover, dragged into any order, and hidden from Pieces (right-click one); trackpad scrolling moves one tab per swipe.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.
import { View, div, svg } from "gpui-kit";
import { h_flex, Popover } from "gpui-base";
import { spaces, panes, run, openOverlay, props, theme, window, shared, setShared, layout, appHome, exec, watchFolder, nextCommand, home, machines, notify } from "herdr";
import { walkLayout, commitLayout, sidebarBack, foldSidebar, dropStripDrag } from "./layout.js";
import { Updater } from "./update.js";
import { tryOr, readCommands } from "./pure.js";
import { openArrange } from "./open.js";
import { G, H, R, T, W, ICON as ICON_SIZE, CLEAR, EASE, GLIDE, TINT, alpha, tokens } from "./ui.js";
import { button, iconButton, pressAgain, Armed } from "./ui-button.js";
import { TextField } from "./ui-field.js";
import { menu } from "./ui-menu.js";
import { tabSkeleton } from "./ui-skeleton.js";
import { tooltip } from "./kit.js";
import { boundChord } from "./ui-tooltip.js";
import { tabItem, tabInsertion, tabPill, TAB_NAME_LIMIT } from "./ui-tab.js";
import { tabMark, barState, foldTabs, pillAt, dropSide, renameWaits } from "./tab-bar-model.js";
import { Kdb, projectKey } from "./kdb.js";
import { projectOpen, OPEN } from "./panel-state.js";
import { TOOLS, PROBE_MS, available, probeTools } from "./sim-registration.js";
import { pieces, runs, shown, setPiece, STORE, choice } from "./pieces.js";

function storedObject(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

// Mounted on demand: closing removes the block, so Herdr ends that mod (its timers, watches and processes stop).
const PANELS = {
  files: { mod: "kanso-panel", props: { panel: "files" } }, pr: { mod: "kanso-panel", props: { panel: "pr" } },
  shipped: { mod: "kanso-panel", props: { panel: "shipped" } },
  worktrees: { mod: "kanso-panel", props: { panel: "worktrees" } },
  ports: { mod: "kanso-panel", props: { panel: "ports" } },
  look: { mod: "kanso-panel", props: { panel: "look" } },
  containers: { mod: "kanso-containers" },
  insights: { mod: "kanso-spend" },
  memory: { mod: "kanso-guard" },
  sim: { mod: "kanso-sim" },
};

function customPanels() {
  const list = shared("kanso.panels");
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.mod === "string" && !(p.id in PANELS)) : [];
}

// A settled tab (put to sleep, say) is not on the bar.
export const shownTabs = (tabs) => (tabs ?? []).filter((c) => !c.settled);

// Both shared, so every bar agrees. A panel set to Hide is not mounted.
const ORDER = "kanso.panels.order";
const ICON = "mods/kanso-chrome/icons/";
const openSettings = (page) => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });
const BUILTIN = [
  { id: "files", label: "Files", icon: `${ICON}file.svg` },
  { id: "insights", label: "Spend", icon: `${ICON}chart-column.svg` },
  { id: "pr", label: "PR", icon: `${ICON}git-pull-request.svg` },
  { id: "shipped", label: "Shipped", icon: `${ICON}trophy.svg` },
  { id: "worktrees", label: "Worktrees", icon: `${ICON}git-fork.svg` },
  { id: "ports", label: "Ports", icon: `${ICON}plug.svg` },
  { id: "containers", label: "Containers", icon: `${ICON}container.svg` },
  { id: "memory", label: "Memory", icon: `${ICON}memory-stick.svg` },
  { id: "look", label: "Images", icon: `${ICON}eye.svg` },
  { id: "sim", label: "Simulator", icon: `${ICON}smartphone.svg` },
];
const list = (key) => { const v = shared(key); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
const simulatorRoster = () => JSON.stringify([list(ORDER), choice("panel.sim", pieces(shared)), customPanels()]);

// Panels you never placed keep their catalog place after the ones you dragged.
// Simulator is not listed on a computer with neither Xcode nor the Android SDK.
function panelList() {
  const map = pieces(shared);
  const all = [...BUILTIN, ...customPanels().map((p) => ({ id: p.id, label: p.label ?? p.id, icon: p.icon }))].filter((p) => p.id !== "sim" || available(shared(TOOLS)));
  const order = list(ORDER);
  const rank = new Map(all.map((p, i) => [p.id, order.includes(p.id) ? order.indexOf(p.id) : order.length + i]));
  return all.toSorted((a, b) => rank.get(a.id) - rank.get(b.id)).map((p) => ({ ...p, on: runs(`panel.${p.id}`, map) }));
}

function movePanel(from, to) {
  const ids = panelList().map((p) => p.id), i = ids.indexOf(from), j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  setShared(ORDER, ids.toSpliced(i, 1).toSpliced(j, 0, from));
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

// Reads and removes the paths waiting in the inbox; returns the newest.
export async function takeOpens(dir) {
  const r = await localService(fileApi).drain(dir);
  const opened = (r.stdout ?? "").split("\0").map((p) => p.trim()).filter(paths.isAbsolute);
  return opened.at(-1) ?? null;
}

export default class Tabs extends View {
  tabW = {};
  barW = {};
  armed = new Armed();
  dropAt = null;
  renaming = null;
  renamed = null;
  moreOpen = false;

  init(_props, cx) {
    this.pressed = null;
    this.dragPanel = null;
    this.hoverPanel = null;
    // Opened as the Panels popup: this copy draws the list, not the bar.
    const given = tryOr(() => props()); // null on a host without props
    this.arrange = Boolean(given?.arrange);
    this.panels = storedObject("panels");
    this.db = null;
    this.holding = false;
    this.openRow = undefined;
    if (!this.arrange && cx) {
      this.db = new Kdb(cx.timer);
      this.watchOpens(cx);
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
    else if (name === "check") { await this.updater.check(cx, true, true); this.updater.fit(); }
    else if (name === "settings" || name.startsWith("settings-")) {
      const asked = name.slice(9);
      openSettings(!asked || asked === "mods" ? "pieces" : asked);
    }
    else this.command(name);
    cx.notify();
  }

  probeSimulator(cx) {
    const signature = simulatorRoster();
    if (this.simSignature === signature) return;
    this.simSignature = signature;
    if (!runs("panel.sim", pieces(shared))) return;
    this.simProbe = (this.simProbe ?? 0) + 1;
    this.simSettled = false;
    const probe = this.simProbe;
    const finish = (tools) => {
      if (this.simProbe !== probe || this.simSettled) return;
      this.simSettled = true;
      setShared(TOOLS, tools); cx.notify();
    };
    const deadline = cx.timer.after(PROBE_MS, () => finish({}));
    cx.spawn(async () => {
      const tools = await probeTools(window()?.platform ?? "macos", home(), exec).catch(() => ({}));
      deadline.cancel(); finish(tools);
    });
  }

  command(name) {
    const tab = /^tab-(\d)$/.exec(name), panel = /^panel-(\d)$/.exec(name);
    // Herdr passes a mod command no arguments, so the path rides in its name: `herdr-app do 'kanso-tabs.look <path>'`.
    // `at` makes each one new props, so an open Images starts over on it. (`gallery`, its old command, too).
    const look = /^(?:look|gallery)(?:[\s:]+([\s\S]+))?$/.exec(name);
    if (look) this.show("look", look[1]?.trim() ? { panel: "look", path: look[1].trim(), at: Date.now() } : { panel: "look" });
    else if (tab) {
      const tabs = spaces().find((s) => s.active)?.tabs ?? [];
      if (Number(tab[1]) <= tabs.length) run("tab.select", { index: Number(tab[1]) });
    } else if (name === "memory") {
      const tree = layout();
      if (this.openPanel(walkLayout(tree, "panel"), walkLayout(tree, "panel-body")) !== "memory") this.mount("memory");
    } else if (name === "sim" || panel) {
      const id = panel ? panelList().filter((x) => x.on)[Number(panel[1]) - 1]?.id : "sim";
      if (!id || !panelList().some((item) => item.id === id && item.on)) return;
      const tree = layout(), now = this.openPanel(walkLayout(tree, "panel"), walkLayout(tree, "panel-body"));
      this.mount(now === id ? null : id);
    }
  }

  // markdown-handler.sh leaves .md paths opened from outside in data/kanso-open; the newest shows in the preview.
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
  hoverTab(tab, hovered, cx) {
    if (!this.pressed) return;
    const next = hovered ? tab.id : (this.dropAt === tab.id ? null : this.dropAt);
    if (next === this.dropAt) return;
    this.dropAt = next;
    cx.notify();
  }

  dropTab(tab, space) {
    const from = this.pressed;
    if (from && from !== tab.id) run("tab.move", { id: from, index: space.tabs.findIndex((other) => other.id === tab.id) + 1 });
  }

  // What the tab draws now: its mark, the press that arms it, the rename in place or waiting, the hold while it is dragged.
  tabLook(tab) {
    // Armed only while its × is there to press again: the chosen tab.
    const armed = tab.active && this.armed.is(closeKey(tab));
    const waiting = this.renamed?.id === tab.id;
    return {
      key: tab.id, label: waiting ? this.renamed.name : tab.name, mark: tabMark(tab), armed, pending: waiting,
      tip: armed ? pressAgain(`close ${tab.name}`) : null,
      held: this.pressed === tab.id && Boolean(this.dropAt) && this.dropAt !== tab.id,
      editing: this.renaming?.id === tab.id ? this.renaming.text : null,
    };
  }

  tabBox(c, tab, { space, openTabs, ps, connected, glide, index, count }) {
    const from = openTabs.findIndex((other) => other.id === this.pressed), to = openTabs.findIndex((other) => other.id === tab.id);
    const target = this.dropAt === tab.id && from >= 0 && from !== to;
    const item = tabItem(`tab-${tab.id}`, this.tabLook(tab), c, {
      on: tab.active, disabled: !connected, size: "md", track: false, index, count, fill: !glide, nameWidth: W.tabLabel,
      onChange: () => { this.armed.clear(); run("tab.select", { id: tab.id }); },
      onClose: openTabs.length > 1 ? (cx) => this.closeTab(tab, ps, cx) : null,
      onPress: (e, cx) => this.pressTab(tab, e, cx),
    });
    const wired = connected ? item
      .on_hover((hovered, cx) => this.hoverTab(tab, hovered, cx))
      .on_mouse_up("left", () => this.dropTab(tab, space))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: space.id } } }))
      .on_key_down((e, cx) => { if (this.renaming?.id === tab.id && e.key === "escape") { cx.stop_propagation(); this.endRename(cx, false); } }) : item;
    const landing = target ? tabInsertion(c).absolute().top((H.icon - H.badge) / 2) : null;
    return div().id(`tab-box-${tab.id}`).relative().flex_none()
      .on_size_change((s, cx) => { this.tabW = this.sized(this.tabW, tab.id, s.width, cx); })
      .child(wired)
      .when(Boolean(landing), (box) => box.child(dropSide(from, to) === "before" ? landing.left(-G.hair) : landing.right(-G.hair)));
  }

  // Tabs that do not fit fold behind +N, a Menu of them with their marks; a pick chooses the tab.
  moreTabs(c, folded) {
    const pick = (tab) => (cx) => { this.moreOpen = false; run("tab.select", { id: tab.id }); cx.notify(); };
    const trigger = button("tab-more", `+${folded.length}`, null, c, { kind: "quiet", active: this.moreOpen });
    const pop = Popover.new("tab-more-menu").trigger(trigger).open(this.moreOpen)
      .on_open_change((open, cx) => { this.moreOpen = open; cx.notify(); });
    const items = folded.map((tab) => ({ label: tab.name, mark: tabMark(tab), onClick: pick(tab) }));
    return div().id("tab-more-box").flex_none().on_size_change((s, cx) => { this.barW = this.sized(this.barW, "more", s.width, cx); })
      .child(this.moreOpen ? pop.content(menu("tab-more-list", { items }, c)) : pop);
  }

  // The tabs and +N, then new tab and Arrange. Connecting: a breathing skeleton per known tab; unreachable: the tabs step down, no tools.
  tabArea(c, { space, openTabs, ps, state, tools }) {
    const area = h_flex().id("tab-area").flex_1().min_w(0).h_full().items_center().gap(G.sm)
      .on_size_change((s, cx) => { this.barW = this.sized(this.barW, "area", s.width, cx); });
    if (state === "connecting") return area.children(Array.from({ length: Math.max(openTabs.length, 1) }, (_, i) => tabSkeleton(`tab-skeleton-${i}`, c, i)));
    const connected = state === "connected";
    const room = this.barW.area ? this.barW.area - tools.length * (H.icon + G.sm) : 0;
    const { shown, folded } = foldTabs({ widths: openTabs.map((tab) => this.tabW[tab.id]), chosen: openTabs.findIndex((tab) => tab.active), room, gap: G.hair, more: (this.barW.more ?? 0) + G.sm });
    const drawn = shown.map((i) => openTabs[i]);
    const pill = pillAt(drawn.map((tab) => this.tabW[tab.id]), drawn.findIndex((tab) => tab.active), G.hair);
    const group = h_flex().flex_none().min_w(0).gap(G.hair).items_center().relative()
      .when(Boolean(pill), (el) => el.child(tabPill(c).id("tab-pill").absolute().top(0).left(pill.left).w(pill.width).transition("left", GLIDE).transition("width", GLIDE)))
      .children(drawn.map((tab, index) => this.tabBox(c, tab, { space, openTabs, ps, connected, glide: Boolean(pill), index, count: drawn.length })));
    return area.child(group)
      .when(folded.length > 0 && connected, (el) => el.child(this.moreTabs(c, folded.map((i) => openTabs[i]))))
      .children(tools);
  }

  render(cx) {
    if (!this.arrange && cx && !this.simQueued && this.simSignature !== simulatorRoster()) {
      this.simQueued = true;
      cx.timer.after(0, (next) => { this.simQueued = false; this.probeSimulator(next); });
    }
    const t = theme();
    const space = spaces().find(p => p.active);
    const openTabs = shownTabs(space?.tabs);
    // Each live-data read copies the whole list: read once per render.
    const ps = panes();
    const tree = layout();
    const stop = (_e, cx) => cx.stop_propagation();
    const c = tokens(t);
    // A press on a tool never starts a window drag.
    const tool = (id, icon, tip, action) => iconButton(id, icon, tip, action, c).on_mouse_down("left", stop);
    // Tab widths are measured as they draw: the chosen fill glides to its tab and what does not fit folds.
    this.tabW = Object.fromEntries(Object.entries(this.tabW).filter(([id]) => openTabs.some((tab) => tab.id === id)));
    const state = barState(space, machines());
    this.settleRename(openTabs, state);
    const panel = walkLayout(tree, "panel"), body = walkLayout(tree, "panel-body");
    const now = this.openPanel(panel, body);
    if (this.db && space) {
      const project = tryOr(() => projectKey(space, home()));
      if (project && project !== this.project) this.openRow = undefined;
    }
    const allPanels = panelList();
    const shownPanels = allPanels.filter((p) => p.on);
    const enabled = shownPanels.map((p) => p.id);
    // Kanso settings lists the panels from here (it can't import this file).
    const roster = allPanels.map((p) => ({ id: p.id, label: p.label, icon: p.icon ?? null, on: p.on }));
    if (JSON.stringify(roster) !== JSON.stringify(shared("kanso.panels.all") ?? null)) setShared("kanso.panels.all", roster);
    const map = pieces(shared);
    const tools = state === "connected" ? [
      tool("tab-new", "plus", "New", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openArrange(); }),
      shown("tabs.arrange", true, map) ? tool("tab-arrange", "layers", tooltip({ label: "Arrangements", chord: boundChord("kanso-strip.arrange") }), () => openArrange()) : null,
    ].filter(Boolean) : [];
    this.reconcile(space, panel, body, now);
    this.syncPanel(space, now, enabled);
    // A panel turned off while open closes (a file's preview has no button to turn off).
    if (now && now !== "preview" && !enabled.includes(now) && !this.inFlight(now)) this.mount(null);
    const panelButton = (p, k) => {
      const on = now === p.id, target = this.dragPanel && this.dragPanel !== p.id;
      const named = !p.icon || on || this.hoverPanel === p.id;
      // About 0.57 of the text size a character: the name's box eases open to this width.
      const wide = Math.ceil(String(p.label).length * T.value * 0.57) + G.md;
      const name = div().id(`panel-name-${p.id}`).h_full().flex().items_center().overflow_hidden().flex_none()
        .w(named ? wide : 0).opacity(named ? 1 : 0)
        .transition("width", EASE)
        .transition("opacity", EASE)
        .child(div().pl(G.xs).pr(G.xs).whitespace_nowrap().child(p.label));
      return h_flex().id(`panel-${p.id}`).h(H.icon).min_w(H.icon).px(G.xs).flex_none().items_center().justify_center().rounded(R.control)
        .text_size(T.value).bg(on ? c.w12 : CLEAR)
        .text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(target ? alpha(t.foreground, TINT.faint) : on ? c.w12 : c.w7).text_color(t.foreground))
        .on_hover((hovered, cx) => {
          if (hovered) this.hoverPanel = p.id; else if (this.hoverPanel === p.id) this.hoverPanel = null;
          cx.notify();
        })
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.dragPanel = p.id; cx.notify(); })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.dragPanel; this.dragPanel = null;
          if (from && from !== p.id) movePanel(from, p.id);
          else if (from === p.id) this.mount(on ? null : p.id);
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openSettings("pieces"); })
        .when(Boolean(p.icon), (el) => el.child(svg(p.icon).size(ICON_SIZE)))
        .child(name);
    };
    // No background and no line of its own: it sits on the frame.
    return h_flex().id("tab-bar").size_full().min_w(0).px(G.md).gap(G.sm).items_center()
      .on_size_change(() => this.keepRail(layout()))
      // A pane held in the strip and let go here goes back where it was.
      .on_mouse_up("left", dropStripDrag)
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.dropAt = null; this.dragPanel = null; cx.notify(); })
      // A held tab let go outside the bar lands nowhere.
      .on_hover((hovered, cx) => { if (!hovered && this.pressed) { this.pressed = null; this.dropAt = null; cx.notify(); } })
      .on_scroll_wheel(e => this.wheel(e))
      .child(this.tabArea(c, { space, openTabs, ps, state, tools }))
      .child(h_flex().flex_none().gap(G.hair).items_center().children(shownPanels.map(panelButton))
        .child(tool("kanso-help", "circle-question-mark", tooltip({ label: "kansō help", chord: boundChord("mod.open:kanso-help") }), () => run("mod.open", { name: "kanso-help" })).ml(4)))
      .when(window()?.buttons, el => el.child(tool("minimize", "minus", "Minimize", () => run("window.minimize")))
        .child(tool("maximize", "square", "Maximize", () => run("window.maximize")))
        .child(tool("close-window", "x", "Close", () => run("window.close"))));
  }
}
