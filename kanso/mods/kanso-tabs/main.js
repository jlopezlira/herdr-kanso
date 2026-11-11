import { localPlatform, paths } from "./platform.js";
// Derived from the `tabs` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: segmented tab pill, outlined Files and Changes buttons, no bar background.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-tabs; a Specs panel button with the pending count and a needs-you dot (sdd.badge).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-tabs; tabs and panel buttons without outlines; side panels mounted on demand (only the open one exists); Spend and Worktrees built in, Specs and Changes dropped; panel buttons are icons with their name on hover, dragged into any order, and turned on or off in a Panels popup (right-click one); trackpad scrolling moves one tab per swipe.
// Modified by Iván Campaña (https://github.com/icampana): layout writers set the tree only when it is Kanso's, so a switch from another layout never saves that layout into kanso.json.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, props, theme, window, shared, setShared, layout, appHome, exec, watchFolder, nextCommand, home } from "herdr";
import { stateMark, programIcon } from "./marks.js";
import { walkLayout, commitLayout } from "./layout.js";
import { Updater } from "./update.js";
import { tryOr, tryOrAsync } from "./pure.js";
import { Kdb, projectKey } from "./kdb.js";
import { projectOpen, OPEN } from "./panel-state.js";

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
};

function customPanels() {
  const list = shared("kanso.panels");
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.mod === "string" && !(p.id in PANELS)) : [];
}

// A tab put to sleep leaves the bar in the same turn.
export function shownTabs(tabs, hidden) {
  const away = new Set((hidden ?? []).flatMap((h) => h.settle ?? []));
  return (tabs ?? []).filter((c) => !c.settled && !away.has(c.id));
}

// Both shared, so the Panels popup and every bar agree.
const ORDER = "kanso.panels.order", OFF = "kanso.panels.off";
const ICON = "mods/kanso-chrome/icons/";
const openSettings = (page) => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });
const BUILTIN = [
  { id: "files", label: "Files", icon: `${ICON}file.svg` },
  { id: "insights", label: "Spend", icon: `${ICON}chart.svg` },
  { id: "pr", label: "PR", icon: `${ICON}pull-request.svg` },
  { id: "shipped", label: "Shipped", icon: `${ICON}trophy.svg` },
  { id: "worktrees", label: "Worktrees", icon: `${ICON}worktree.svg` },
  { id: "ports", label: "Ports", icon: `${ICON}plug.svg` },
  { id: "containers", label: "Containers", icon: `${ICON}container.svg` },
  { id: "memory", label: "Memory", icon: `${ICON}memory.svg` },
  { id: "look", label: "Images", icon: `${ICON}eye.svg` },
];
const list = (key) => { const v = shared(key); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };

// Panels you never placed keep their catalog place after the ones you dragged.
function panelList() {
  const all = [...BUILTIN, ...customPanels().map((p) => ({ id: p.id, label: p.label ?? p.id, icon: p.icon }))];
  const order = list(ORDER), off = new Set(list(OFF));
  const rank = new Map(all.map((p, i) => [p.id, order.includes(p.id) ? order.indexOf(p.id) : order.length + i]));
  return all.toSorted((a, b) => rank.get(a.id) - rank.get(b.id)).map((p) => ({ ...p, on: !off.has(p.id) }));
}

function movePanel(from, to) {
  const ids = panelList().map((p) => p.id), i = ids.indexOf(from), j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  setShared(ORDER, ids.toSpliced(i, 1).toSpliced(j, 0, from));
}

function setPanelOn(id, on) {
  const off = new Set(list(OFF));
  setShared(OFF, on ? [...off].filter((x) => x !== id) : [...new Set([...off, id])]);
}

const openArrange = () => openOverlay({ mod: "kanso-arrange", kind: "dialog", width: 480 });

function panelContent(id) {
  if (id === "preview") return { mod: "kanso-panel", props: { panel: "preview" } };
  if (PANELS[id]) return { ...PANELS[id] };
  const custom = customPanels().find((p) => p.id === id);
  if (!custom) return null;
  return custom.props !== undefined ? { mod: custom.mod, props: custom.props } : { mod: custom.mod };
}

const TAB_H = 26; // inside the 2px padding of the pill, so the pill is 30px
const CLEAR = "#00000000";
const GLIDE = { duration: 220, easing: "ease-out" }; // the pill under the chosen tab, as the sidebar's

// Reads and removes the paths waiting in the inbox; returns the newest.
export async function takeOpens(dir) {
  const r = await localPlatform().files.drain(dir);
  const opened = (r.stdout ?? "").split("\0").map((p) => p.trim()).filter(paths.isAbsolute);
  return opened.at(-1) ?? null;
}

export default class Tabs extends View {
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
      this.db = new Kdb();
      this.watchOpens(cx);
      // The bar is always on screen and the sidebar's footer may not be, so the bar polls for releases.
      this.updater = new Updater();
      this.updater.start(cx);
      // keys.json: tab-N and panel-N arrive here as commands.
      cx.spawn(async (cx) => {
        for (;;) {
          const next = await tryOrAsync(async () => { const c = await nextCommand(); cx.notify(); return { c }; });
          if (!next) break; // a replaced build (hot reload, update) stops here, before acting
          const name = String(next.c).replace(/^kanso-tabs\./, "");
          if (name === "update") this.updater.install(cx);
          else if (name === "check") { await this.updater.check(cx, true, true); this.updater.fit(); }
          else if (name === "settings" || name.startsWith("settings-")) openSettings(name.slice(9) || "keys"); // settings-mods, -news, -credits
          else this.command(name);
          cx.notify();
        }
      });
    }
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
    } else if (panel) {
      const p = panelList().filter((x) => x.on)[Number(panel[1]) - 1];
      if (!p) return;
      const tree = layout(), now = this.openPanel(walkLayout(tree, "panel"), walkLayout(tree, "panel-body"));
      this.mount(now === p.id ? null : p.id);
    }
  }

  // markdown-handler.sh leaves .md paths opened from outside in data/kanso-open; the newest shows in the preview.
  watchOpens(cx) {
    const dir = paths.join(appHome(), "data", "kanso-open");
    cx.spawn(async (cx) => {
      try {
        await localPlatform().files.mkdir(dir);
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

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = shownTabs(space?.tabs, shared("kanso.sleep.hidden"));
    // Each live-data read copies the whole list: read once per render.
    const ps = panes();
    const tree = layout();
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.foreground + "0a").text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // The pill under the chosen tab glides to it; tab widths are measured as they draw.
    this.tabW ??= {};
    for (const id of Object.keys(this.tabW)) if (!shown.some((c) => c.id === id)) delete this.tabW[id];
    const { at } = shown.reduce((acc, c) => {
      const w = this.tabW[c.id];
      return { at: c.active && w ? { left: acc.x, width: w } : acc.at, x: acc.x + (w ?? 0) + 2 };
    }, { at: null, x: 0 });
    const tabPill = at && shown.every((c) => this.tabW[c.id])
      ? div().id("tab-pill").absolute().top(0).left(at.left).w(at.width).h(TAB_H).rounded(6).bg(t.foreground + "12").transition("left", GLIDE).transition("width", GLIDE)
      : null;
    const item = (c, i) => {
      const program = ps.find(p => p.tab === c.id && p.program?.agent)?.program ?? ps.find(p => p.tab === c.id)?.program;
      const name = c.name;
      return h_flex().id(`tab-${c.id}`).h(TAB_H).px(10).gap(6).rounded(6).items_center().flex_none().text_size(12.5)
        .text_color(c.active ? t.foreground : t.muted)
        // Until every tab is measured there is no pill: the chosen tab wears the wash itself.
        .when(c.active && !tabPill, el => el.bg(t.foreground + "12"))
        .hover(s => s.bg(t.foreground + "0a").text_color(t.foreground))
        .on_size_change((s, cx) => { if (Math.abs((this.tabW[c.id] ?? 0) - s.width) >= 0.5) { this.tabW[c.id] = s.width; cx.notify(); } })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }))
        .when(Boolean(program?.icon), el => el.child(programIcon(program, 15, t.muted).opacity(c.active ? 1 : 0.8)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(["working", "blocked", "done"].includes(c.status), el => el.child(stateMark(t, c.status)))
        .when(c.active && shown.length > 1, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).hover(s => s.text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/kanso-chrome/icons/close.svg").size(13))));
    };
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
    const hidden = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    const update = this.updater?.available() ?? null;
    this.reconcile(space, panel, body, now);
    this.syncPanel(space, now, enabled);
    // A panel turned off while open closes (a file's preview has no button to turn off).
    if (now && now !== "preview" && !enabled.includes(now) && !this.inFlight(now)) this.mount(null);
    const panelButton = (p, k) => {
      const on = now === p.id, target = this.dragPanel && this.dragPanel !== p.id;
      const named = !p.icon || on || this.hoverPanel === p.id;
      // 6.8 px a character at size 12: the name's box eases open to this width.
      const wide = Math.ceil(String(p.label).length * 6.8) + 10;
      const name = div().id(`panel-name-${p.id}`).h_full().flex().items_center().overflow_hidden().flex_none()
        .w(named ? wide : 0).opacity(named ? 1 : 0)
        .transition("width", { duration: 180, easing: "ease-out" })
        .transition("opacity", { duration: 180, easing: "ease-out" })
        .child(div().pl(6).pr(4).whitespace_nowrap().child(p.label));
      return h_flex().id(`panel-${p.id}`).h(TAB_H).min_w(TAB_H).px(p.icon ? 5.5 : 4).flex_none().items_center().justify_center().rounded(6)
        .text_size(12).bg(on ? t.foreground + "12" : CLEAR)
        .text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(target ? t.foreground + "1a" : on ? t.foreground + "12" : t.foreground + "0a").text_color(t.foreground))
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
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openSettings("mods"); })
        .when(Boolean(p.icon), (el) => el.child(svg(p.icon).size(15)))
        .child(name);
    };
    // No background and no line of its own: it sits on the frame.
    return h_flex().size_full().min_w(0).px(12).gap(2).items_center()
      // A pane held in the strip and let go here goes back where it was.
      .on_mouse_up("left", () => { if (shared("strip.drag")) { setShared("strip.drop", null); setShared("strip.drag", null); } })
      .on_mouse_up("left", () => { this.pressed = null; this.dragPanel = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(6).overflow_x_scrollbar()
        .child(h_flex().flex_none().gap(2).items_center().relative().when(Boolean(tabPill), (el) => el.child(tabPill)).children(shown.map(item)))
        .child(button("tab-new", svg("mods/kanso-chrome/icons/plus.svg").size(16), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openArrange(); }))
        .when(!hidden.has("tabs.arrange"), (el) => el.child(button("tab-arrange", svg("mods/kanso-chrome/icons/layers.svg").size(15), () => openArrange())
          .tooltip(window()?.platform === "macos" ? "Arrangements  ⌥⌘T" : "Arrangements"))))
      .child(h_flex().flex_none().gap(2).items_center().children(shownPanels.map(panelButton))
        // Help and settings, alike and side by side: not panels, never dragged nor turned off.
        .child(button("kanso-help", svg("mods/kanso-chrome/icons/help.svg").size(15), () => run("mod.open", { name: "kanso-help" }))
          .ml(4).tooltip(window()?.platform === "macos" ? "kansō help  ⌘⇧/" : "kansō help  Ctrl+Shift+/"))
        // The dot means a release waits.
        .child(button("kanso-settings", div().relative().child(svg("mods/kanso-chrome/icons/settings.svg").size(15))
            .when(Boolean(update), (el) => el.child(div().absolute().top(-2).right(-3).size(6).rounded_full().bg(t.accent))),
          () => openSettings(update ? "news" : "keys"))
          .tooltip(update ? `kansō ${update} is available` : window()?.platform === "macos" ? "kansō settings  ⌃⇧," : "kansō settings  Ctrl+Shift+,")))
      .when(window()?.buttons, el => el.child(button("minimize", "−", () => run("window.minimize")))
        .child(button("maximize", "□", () => run("window.maximize")))
        .child(button("close-window", svg("mods/kanso-chrome/icons/close.svg").size(13), () => run("window.close"))));
  }
}
