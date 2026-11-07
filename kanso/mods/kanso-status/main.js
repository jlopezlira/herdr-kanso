// Derived from the `workspace-status` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: no background or top border.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-status.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-status; one quiet line; agents working and agents that need you (a click goes to the next one, as Cmd+J).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, props, shared } from "herdr";
import { stateMark } from "./marks.js";


export default class WorkspaceStatus extends View {
  render() {
    const t = theme();
    // Two copies share the row (the strip's minimap sits between): side says which half this one draws.
    const side = props()?.side;
    const left = side !== "right", right = side !== "left";
    const space = left ? spaces().find(s => s.active) : null;
    const list = right ? agents() : [];
    const needs = list.filter(a => a.status === "blocked").length;
    const working = list.filter(a => a.status === "working").length;
    const label = (icon, text) => h_flex().gap(6).items_center().min_w(0)
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(13).flex_none()).child(div().truncate().child(text));
    const mac = window()?.platform === "macos";
    const hidden = new Set(Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []);
    const agentsText = list.length === 0 ? "No agents"
      : working > 0 ? `${working} of ${list.length} working` : `${list.length} ${list.length === 1 ? "agent" : "agents"} idle`;
    return h_flex().size_full().px(12).gap(18).items_center().text_size(11.5).text_color(t.muted)
      .when(right && !left, el => el.justify_end())
      .when(left, el => el.child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
        .when(Boolean(space?.branch), el => el.child(label("branch", space.branch))))
      .when(left && right, el => el.child(div().flex_1()))
      .when(right && needs > 0, el => el.child(h_flex().id("needs-you").gap(6).items_center().text_color(t.blocked)
        .cursor_pointer().tooltip(mac ? "Go to it  ⌘J" : "Go to it  Ctrl+J").on_click(() => run("kanso-strip.next-needs-you"))
        .child(stateMark(t, "blocked", 12))
        .child(needs === 1 ? "1 agent needs you" : `${needs} agents need you`)))
      .when(right && !hidden.has("status.agents"), el => el.child(h_flex().gap(6).items_center()
        .child(stateMark(t, working > 0 ? "working" : "idle", 12, { idle: true }))
        .child(agentsText)))
      .when(right && !hidden.has("status.palette"), el => el.child(div().id("palette").px(6).py(2).rounded(6).cursor_pointer()
        .hover(s => s.bg(t.foreground + "0a").text_color(t.muted))
        .on_click(() => run("app.palette"))
        .child(mac ? "⌘⇧P" : "Ctrl+Shift+P")
        .tooltip("Command palette")));
  }
}
