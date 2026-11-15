import { localService } from "./platform-host.js";
import { systemApi } from "./platform-system.js";
// Derived from the `workspace-chrome` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: brand bar, solid sidebar footer with Settings, Add machine and an account chip.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-chrome.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-chrome; sidebar footer as centred squares when collapsed, one icon set (icons/), a title bar of the lights only; an "Update Kanso" row for Kanso's own releases (update.js); Settings opens one menu (footer.js).
import { View, div } from "gpui-kit";
import { theme, run, props, shared, setShared, updates, keys, settings, nextCommand, openOverlay, appHome, notify } from "herdr";
import { Updater } from "./update.js";
import { tryOrAsync, afterMount } from "./pure.js";
import { loadPieces, pieces, shown } from "./pieces.js";
import { outOfMemory } from "./notices.js";
import { glyphs } from "./marks.js";
import { tokens } from "./ui.js";
import { Armed } from "./ui-button.js";
import { ROW, ITEM, COLLAPSED, footerRows, settingsChord, settingsEntries } from "./footer-model.js";
import { sidebarFooter } from "./footer.js";

const SAMPLE_MS = 120_000;
const openSettings = (page = "pieces") => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });

// The runtime out of memory says so, or, with no room left for the error itself, throws null:
// a mod then "did not load: Null "null"".
export const exhausted = (e) => /out of memory|\bNull\b\s*["'“]?null/i.test(String(e));

export default class WorkspaceChrome extends View {
  // Only the footer copy has an Updater (update.js), and it does not poll: the tab bar,
  // always on screen, looks for releases; the footer shows what it found and installs on a click.
  init(_props, cx) {
    // The one migration. A later read must not write, or every mod draws again.
    loadPieces(shared, setShared);
    if (!props()?.footer) return;
    this.armed = new Armed();
    this.menuOpen = false;
    this.updater = new Updater();
    this.updater.start(cx, { polls: false });
    // Command names stay kanso-tabs.* for keys bound to them before.
    afterMount(cx, (cx) => cx.spawn(async (cx) => {
      for (;;) {
        const next = await tryOrAsync(async () => { const c = await nextCommand(); cx.notify(); return { c }; });
        if (!next) break; // a replaced build (hot reload, update) stops here, before acting
        const { c } = next;
        if (c === "update") this.updater.install(cx);
        else if (c === "check") { await this.updater.check(cx, true, true); this.updater.fit(); cx.notify(); }
        else if (c === "settings") openSettings();
        else if (c === "settings-mods") openSettings("pieces");
        else if (c === "settings-news") openSettings("news");
        else if (c === "restart") this.restart();
      }
    }));
    cx.timer.every(SAMPLE_MS, (cx) => this.watch(cx));
    this.power(cx);
    cx.timer.every(SAMPLE_MS, (cx) => this.power(cx));
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

  rows() {
    const update = this.updater?.available() ?? null;
    const acts = { [ROW.update]: (cx) => this.updater.install(cx) };
    return footerRows({ update, busy: Boolean(this.updater?.busy) })
      .map((entry) => ({ ...entry, onClick: acts[entry.key] ?? null }));
  }

  // Read only while the menu is open: Herdr's waiting update and the key bound to kansō settings.
  settingsMenu() {
    const setOpen = (open, cx) => { this.menuOpen = open; cx.notify(); };
    const acts = {
      [ITEM.kanso]: (cx) => { setOpen(false, cx); openSettings(); },
      [ITEM.herdr]: (cx) => { setOpen(false, cx); run("app.settings"); },
      [ITEM.updateHerdr]: (cx) => this.armed.press(ITEM.updateHerdr, cx, () => run("app.update")),
    };
    const chord = this.menuOpen ? settingsChord(keys()) : null;
    const entries = this.menuOpen ? settingsEntries({ ready: updates().app.ready, hint: chord && glyphs(chord) }) : [];
    const items = entries.map((entry) => (entry.separator ? entry : { ...entry, armed: this.armed.is(entry.key), onClick: acts[entry.key] }));
    return { open: this.menuOpen, onOpenChange: setOpen, items };
  }

  refusal() {
    const why = this.updater?.available() && !this.updater.busy ? this.updater.refused() : null;
    return why && { why, retry: (cx) => this.updater.install(cx), font: settings().font_family ?? null };
  }

  render() {
    const t = theme();
    // The title bar holds the window's own lights, nothing else.
    if (!props()?.footer) return div().size_full().bg(t.chrome);
    const collapsed = shared(COLLAPSED) === true;
    return sidebarFooter(tokens(t), { collapsed, rows: this.rows(), settings: this.settingsMenu(), refused: this.refusal() });
  }
}
