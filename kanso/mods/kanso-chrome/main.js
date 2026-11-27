import { localService } from "./platform-host.js";
import { systemApi } from "./platform-system.js";
// Derived from the `workspace-chrome` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: brand bar, solid sidebar footer with Settings, Add machine and an account chip.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-chrome.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-chrome; sidebar footer as centred squares when collapsed, one icon set (icons/), a title bar of the lights and, in Dawn Mode, its sky and pill (header.js); an "Update Kanso" row for Kanso's own releases; Settings opens one menu. The footer now draws in kanso-spaces.
import { View, div } from "gpui-kit";
import { theme, run, props, shared, setShared, nextCommand, appHome, notify } from "herdr";
import { tryOrAsync, readCommands } from "./pure.js";
import { loadPieces, pieces, shown } from "./pieces.js";
import { undoHide } from "./piece-lines.js";
import { outOfMemory } from "./notices.js";
import { tokens, DAWN_W, G, H } from "./ui.js";
import { DAWN_RING_MS, RING_FRAMES } from "./ui-dawn.js";
import { channelOf, installedRelease } from "./release.js";
import { whenInstalled } from "./installed.js";
import { COLLAPSED } from "./footer-model.js";
import { header } from "./header.js";

const SAMPLE_MS = 120_000;
const TAB_BAR_COMMANDS = new Set(["update", "check", "settings", "settings-mods", "settings-news"]);

// The runtime out of memory says so, or, with no room left for the error itself, throws null:
// a mod then "did not load: Null "null"".
export const exhausted = (e) => /out of memory|\bNull\b\s*["'“]?null/i.test(String(e));

const DAWN_START_MS = 34;

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    // The one migration. A later read must not write, or every mod draws again.
    loadPieces(shared, setShared);
    if (props()?.footer) return;
    this.readInstalled(cx);
    // Command names stay kanso-tabs.* for keys bound to them before.
    readCommands(cx, () => nextCommand(), (c) => this.command(c));
    cx.timer.every(SAMPLE_MS, (cx) => this.watch(cx));
    this.power(cx);
    cx.timer.every(SAMPLE_MS, (cx) => this.power(cx));
  }

  command(c) {
    const name = String(c).replace(/^kanso-chrome\./, "");
    if (TAB_BAR_COMMANDS.has(name)) run(`kanso-tabs.${name}`);
    else if (name === "restart") this.restart();
    else if (name === "piece-undo") undoHide();
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

  readInstalled(cx) {
    if (this.reading) return;
    this.reading = true;
    whenInstalled(cx, (version) => { this.installed = version; this.reading = false; });
  }

  // Started detached, so the new window survives this one quitting.
  restart() {
    localService(systemApi).restart(appHome()).catch(() => {});
    run("app.quit");
  }

  render(cx) {
    if (props()?.footer) return div();
    const collapsed = shared(COLLAPSED) === true;
    // The title bar: Herdr's own lights, and in Dawn Mode the sky behind them and, open, the pill that names the installed version.
    const dawn = channelOf(shared("kanso.update")?.channel) === "beta";
    const c = tokens(theme());
    if (this.brandDawn !== dawn) { this.brandDawn = dawn; cx.timer.after(0, () => run("layout.resize", { id: "brand", px: dawn ? H.tabBar + G.lg : H.tabBar })); }
    if (!dawn) return header({ collapsed, dawn })("brand", c);
    if (this.installed == null) this.readInstalled(cx);
    const version = installedRelease(this.installed, shared("kanso.update")?.tag);
    if (!this.dawnScheduled) { this.dawnScheduled = true; cx.timer.after(0, (later) => this.rise(later)); }
    const sky = { width: this.width ?? DAWN_W, run: this.dawnRun ?? 0, rising: Boolean(this.dawnRising), ring: this.dawnRing ?? 0 };
    return div().id("brand-sky").size_full().relative().on_size_change((size, later) => { this.width = size.width; later.notify(); })
      .child(header({ collapsed, dawn, version })("brand", { ...c, dawn: { ...c.dawn, sky } }, { presses: collapsed || !version ? {} : { [version]: (later) => this.rise(later) } }));
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
