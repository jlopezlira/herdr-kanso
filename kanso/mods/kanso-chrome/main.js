// Derived from the `workspace-chrome` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: brand bar, solid sidebar footer with Settings, Add machine and an account chip.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-chrome.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-chrome; sidebar footer as centred squares when collapsed, one icon set (icons/), Herdr's mark beside the traffic lights; an "Update Kanso" row for Kanso's own releases (update.js).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, shared, setShared, updates, agents, home, window, nextCommand, openOverlay, exec, appHome, notify } from "herdr";
import { Updater } from "./update.js";
import { tryOrAsync } from "./pure.js";

const basename = (path) => path.replace(/\/+$/, "").split("/").at(-1);
const openSettings = (page = "keys") => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page } });
const hidden = () => new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);

// The runtime out of memory says so, or, with no room left for the error itself, throws null:
// a mod then "did not load: Null "null"".
export const exhausted = (e) => /out of memory|\bNull\b\s*["'“]?null/i.test(String(e));

export default class WorkspaceChrome extends View {
  // Only the footer copy looks for Kanso releases (update.js); the top bar's never does.
  init(_props, cx) {
    if (!props()?.footer) return;
    this.updater = new Updater();
    this.updater.start(cx);
    // Command names stay kanso-tabs.* for keys bound to them before.
    cx.spawn(async (cx) => {
      for (;;) {
        const next = await tryOrAsync(async () => { const c = await nextCommand(); cx.notify(); return { c }; });
        if (!next) break; // a replaced build (hot reload, update) stops here, before acting
        const { c } = next;
        if (c === "update") this.updater.install(cx);
        else if (c === "check") { await this.updater.check(cx, true, true); this.updater.fit(); cx.notify(); }
        else if (c === "settings") openSettings();
        else if (c === "settings-mods") openSettings("mods");
        else if (c === "settings-news") openSettings("news");
        else if (c === "restart") this.restart();
      }
    });
    cx.timer.every(60000, (cx) => this.watch(cx));
    this.power(cx);
    cx.timer.every(30000, (cx) => this.power(cx));
  }

  // Written only when it changes: every mod draws again on a shared write.
  power(cx) {
    cx.spawn(async () => {
      const r = await exec("pmset", ["-g", "ps"]).catch(() => null);
      if (r?.code !== 0) return;
      const on = /Battery Power/.test(r.stdout);
      if (shared("kanso.battery") !== on) setShared("kanso.battery", on);
    });
  }

  // Hot reloads (each update is some) leak mod-runtime memory until the window restarts; terminals live in herdr-core and survive it.
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      const status = await tryOrAsync(async () => {
        const r = await exec("sh", ["-c", 'HERDR_APP_HOME="$1" herdr-app status', "_", appHome()]);
        return { errors: JSON.parse(r.stdout).errors ?? [] };
      });
      this.watching = false;
      if (!status) return;
      const { errors } = status;
      if (!errors.some(exhausted)) { this.warned = false; return; }
      if (this.warned) return;
      this.warned = true;
      notify({ title: "Herdr's mod runtime is out of memory", level: "error", action: { name: "kanso-chrome.restart" },
        body: "Panels and bars won't load again until the window restarts. Click to restart it now; your terminals and agents stay in herdr-core." });
    });
  }

  // Started detached, so the new window survives this one quitting.
  restart() {
    exec("sh", ["-c", '(sleep 1; HERDR_APP_HOME="$1" nohup herdr-app >/dev/null 2>&1 &) >/dev/null 2>&1', "_", appHome()]).catch(() => {});
    run("app.quit");
  }

  render() {
    const t = theme();
    const collapsed = shared("sidebar.collapsed") === true;
    if (props()?.footer) {
      const row = (id, icon, label, action) => h_flex().id(id).relative().h(34).flex_none().items_center().rounded(6)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(icon).size(17).flex_none())
        .when(collapsed, el => el.w(34).justify_center().tooltip(label))
        .when(!collapsed, el => el.px(10).gap(10).child(div().flex_1().child(label)));
      const dot = () => div().size(6).rounded_full().bg(t.accent).flex_none();
      const who = basename(home()) || "me";
      const n = agents().length;
      const count = `${n} ${n === 1 ? "agent" : "agents"}`;
      const avatar = div().size(collapsed ? 28 : 32).flex_none().rounded(6).bg(t.selected).flex().items_center().justify_center()
        .font_semibold().text_size(13).text_color(t.foreground).child(who[0].toUpperCase());
      const chip = h_flex().id("account").h(collapsed ? 40 : 48).flex_none().items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click(() => run("app.settings")).child(avatar)
        .when(collapsed, el => el.w(40).justify_center().tooltip(`${who} · ${count}`))
        .when(!collapsed, el => el.px(8).gap(10).child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).font_medium().text_color(t.foreground).child(who))
          .child(div().truncate().text_size(11.5).text_color(t.muted).child(count))));
      const ready = Boolean(updates().app.ready);
      const kanso = this.updater?.available();
      const busy = this.updater?.busy;
      const kansoLabel = busy ? "Updating kansō..." : `Update kansō to ${kanso}`;
      return v_flex().size_full().bg(t.chrome).px(collapsed ? 0 : 8).pt(8).pb(12).gap(2).text_size(13).justify_end()
        .when(collapsed, el => el.items_center())
        .when(Boolean(kanso), el => el.child(row("kanso-update", "mods/kanso-chrome/icons/refresh.svg", kansoLabel,
          (_e, cx) => this.updater.install(cx))
          .when(!busy && !collapsed, el => el.child(dot()))
          .when(!busy && collapsed, el => el.child(dot().absolute().top(6).right(6)))))
        .child(row("settings", "mods/kanso-chrome/icons/settings.svg", ready ? "Settings · update ready" : "Settings", () => run("app.settings"))
          .when(ready && !collapsed, el => el.child(dot()))
          .when(ready && collapsed, el => el.child(dot().absolute().top(6).right(6))))
        // A server, not a second "+": the rail already has one for New space.
        .when(!hidden().has("footer.machine"), el => el.child(row("machine", "mods/kanso-chrome/icons/server.svg", "Add machine", () => run("mod.open", { name: "machine-add" }))))
        .child(div().h(8).flex_none())
        .child(chip);
    }
    const lights = window()?.platform === "macos" ? 76 : 14;
    return h_flex().size_full().bg(t.chrome).items_center().justify_end().pl(lights).pr(14).gap(8)
      .when(!collapsed, el => el.child(image("frame/welcome/herdr.png").size(20).rounded(6))
        .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Herdr")));
  }
}
