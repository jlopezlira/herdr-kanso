import { localService } from "./platform-host.js";
import { systemApi } from "./platform-system.js";
// Derived from the `workspace-chrome` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: brand bar, solid sidebar footer with Settings, Add machine and an account chip.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-chrome.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-chrome; sidebar footer as centred squares when collapsed, one icon set (icons/), a title bar of the lights and, in Dawn Mode, its sky and pill (header.js); an "Update Kanso" row for Kanso's own releases (update.js); Settings opens one menu (sidebar-footer.js).
import { View, div } from "gpui-kit";
import { theme, run, props, shared, setShared, updates, keys, nextCommand, openOverlay, appHome, notify } from "herdr";
import { explainWith, findExplainer } from "./explain.js";
import { Updater } from "./update.js";
import { tryOrAsync, readCommands } from "./pure.js";
import { loadPieces, pieces, shown } from "./pieces.js";
import { undoHide } from "./piece-lines.js";
import { outOfMemory } from "./notices.js";
import { glyphs } from "./marks.js";
import { tokens, DAWN_W, G, H } from "./ui.js";
import { DAWN_RING_MS, RING_FRAMES } from "./ui-dawn.js";
import { Armed } from "./ui-button.js";
import { menu } from "./kit.js";
import { channelOf } from "./release.js";
import { ITEM, COLLAPSED, explainRefusal, refusalBlock, settingsChord, settingsEntries, updateLabel } from "./footer-model.js";
import { header } from "./header.js";
import { sidebarFooter } from "./sidebar-footer.js";

const SAMPLE_MS = 120_000;
const openSettings = (page = "pieces") => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });

// The runtime out of memory says so, or, with no room left for the error itself, throws null:
// a mod then "did not load: Null "null"".
export const exhausted = (e) => /out of memory|\bNull\b\s*["'“]?null/i.test(String(e));

const DAWN_START_MS = 34;

export default class WorkspaceChrome extends View {
  // Only the footer copy has an Updater (update.js), and it does not poll: the tab bar,
  // always on screen, looks for releases; the footer shows what it found and installs on a click.
  init(_props, cx) {
    // The one migration. A later read must not write, or every mod draws again.
    loadPieces(shared, setShared);
    if (!props()?.footer) return;
    this.armed = new Armed();
    this.menuOpen = false;
    // Settings' own focus handle: shut it is a row or a Button, open the menu's trigger, so Escape gives the keyboard back to it.
    this.settingsFocus = cx.focus_handle();
    this.updater = new Updater();
    this.updater.start(cx, { polls: false });
    this.explainer = null;
    cx.spawn(async (later) => {
      this.explainer = await findExplainer();
      later.notify();
    });
    // Command names stay kanso-tabs.* for keys bound to them before.
    readCommands(cx, () => nextCommand(), (c, cx) => this.command(c, cx));
    cx.timer.every(SAMPLE_MS, (cx) => this.watch(cx));
    this.power(cx);
    cx.timer.every(SAMPLE_MS, (cx) => this.power(cx));
  }

  async command(c, cx) {
    if (c === "update") this.updater.install(cx);
    else if (c === "check") { await this.updater.check(cx, true, true); this.updater.fit(); cx.notify(); }
    else if (c === "settings") openSettings();
    else if (c === "settings-mods") openSettings("pieces");
    else if (c === "settings-news") openSettings("news");
    else if (c === "restart") this.restart();
    else if (c === "piece-undo") undoHide();
  }

  // Written only when it changes: every mod draws again on a shared write.
  power(cx) {
    cx.spawn(async () => {
      const on = await localService(systemApi).battery().catch(() => null);
      if (on === null) return;
      if (shared("kanso.battery") !== on) setShared("kanso.battery", on);
    });
  }

  // Hot reloads (each update is some) leak mod-runtime memory until the window restarts; terminals live in herdr-core and survive it.
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      const status = await tryOrAsync(async () => {
        const r = await localService(systemApi).status(appHome());
        return { errors: JSON.parse(r.stdout).errors ?? [] };
      });
      this.watching = false;
      if (!status) return;
      const { errors } = status;
      if (!errors.some(exhausted)) { this.warned = false; return; }
      if (this.warned) return;
      this.warned = true;
      if (!shown("toast.memory", true, pieces(shared))) return;
      notify(outOfMemory());
    });
  }

  // Started detached, so the new window survives this one quitting.
  restart() {
    localService(systemApi).restart(appHome()).catch(() => {});
    run("app.quit");
  }

  // Read only while the menu is open: Herdr's waiting update and the key bound to kansō settings.
  settingsMenu() {
    if (!this.menuOpen) return null;
    const acts = {
      [ITEM.kanso]: (cx) => { this.setMenu(false, cx); openSettings(); },
      [ITEM.herdr]: (cx) => { this.setMenu(false, cx); run("app.settings"); },
      [ITEM.updateHerdr]: (cx) => this.armed.press(ITEM.updateHerdr, cx, () => run("app.update")),
    };
    const chord = settingsChord(keys());
    const entries = settingsEntries({ ready: updates().app.ready, hint: chord && glyphs(chord) });
    return menu({ title: "Settings", items: entries.map((entry) => (entry.separator ? entry : { ...entry, armed: this.armed.is(entry.key), onClick: acts[entry.key] })) });
  }

  setMenu(open, cx) {
    this.menuOpen = open;
    cx.notify();
  }

  // The Footer composition: kansō's update while one is offered (quiet once pressed, its refusal under it), then Settings and its menu.
  footer(collapsed) {
    const update = this.updater?.available() ?? null, busy = Boolean(this.updater?.busy);
    const why = update && !busy ? this.updater.refused() : null;
    const install = (cx) => this.updater.install(cx), refused = why ? refusalBlock(why, this.explainer?.name ?? "an agent") : null, menu = this.settingsMenu();
    // Only the targets on show: the update's icon while one is offered, the refusal's fix while it shows (not in the rail),
    // and Settings while its menu is shut (open, Herdr's popover owns the next press).
    const presses = { ...(update ? { "refresh-cw": install } : {}), ...(refused && !collapsed ? { [refused.fix]: install, [`Explain to ${refused.agent}`]: () => this.explain(why) } : {}), ...(menu ? {} : { settings: (cx) => this.setMenu(true, cx) }) };
    return sidebarFooter({ update: update && updateLabel(update, busy), busy, refused, menu, collapsed })(
      "footer", tokens(theme()), { presses, focuses: { settings: this.settingsFocus }, onOpen: (open, cx) => this.setMenu(open, cx) });
  }

  explain(why) {
    explainWith(this.explainer, { name: "Explain the update", folder: appHome(), task: explainRefusal(why) });
  }

  render(cx) {
    const collapsed = shared(COLLAPSED) === true;
    if (props()?.footer) return this.footer(collapsed);
    // The title bar: Herdr's own lights, and in Dawn Mode the sky behind them and, open, the pill that says the mode.
    const dawn = channelOf(shared("kanso.update")?.channel) === "beta";
    const c = tokens(theme());
    if (this.brandDawn !== dawn) { this.brandDawn = dawn; cx.timer.after(0, () => run("layout.resize", { id: "brand", px: dawn ? H.tabBar + G.lg : H.tabBar })); }
    if (!dawn) return header({ collapsed, dawn })("brand", c);
    if (!this.dawnScheduled) { this.dawnScheduled = true; cx.timer.after(0, (later) => this.rise(later)); }
    const sky = { width: this.width ?? DAWN_W, run: this.dawnRun ?? 0, rising: Boolean(this.dawnRising), ring: this.dawnRing ?? 0 };
    return div().id("brand-sky").size_full().relative().on_size_change((size, later) => { this.width = size.width; later.notify(); })
      .child(header({ collapsed, dawn })("brand", { ...c, dawn: { ...c.dawn, sky } }, { presses: collapsed ? {} : { "Dawn Mode": (later) => this.rise(later) } }));
  }

  // The sunrise from its first frame: the night, then the Storybook's keyframes, the ring stepping round as its dash moves.
  rise(cx) {
    for (const task of this.dawnTasks ?? []) task?.cancel?.();
    this.dawnRun = (this.dawnRun ?? 0) + 1;
    this.dawnRising = false;
    this.dawnRing = 0;
    this.dawnTasks = [cx.timer.after(DAWN_START_MS, (later) => { this.dawnRising = true; later.notify(); }),
      ...Array.from({ length: RING_FRAMES }, (_, i) => cx.timer.after(DAWN_RING_MS(i + 1), (later) => { this.dawnRing = i + 1; later.notify(); }))];
    cx.notify();
  }
}
