// Derived from the `workspace-status` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: no background or top border.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-status.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-status; one quiet line; who is waiting and what they ask (a click goes there, as Cmd+J); low memory from the guard's file.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, machines, theme, run, window, props, shared, appHome, readTextFile } from "herdr";
import { stateMark } from "./marks.js";
import { afterMount, tryOrAsync } from "./pure.js";
import { paths } from "./platform-paths.js";
import { MEMORY_MS, computerOf, needsItem, questionOf, memoryLow } from "./model.js";
import { pieces, shown } from "./pieces.js";

const GUARD_NOW = ["data", "kanso-guard", "now.json"];

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    if (props()?.side === "left") return;
    afterMount(cx, () => this.readMemory(cx));
    cx.timer.every(MEMORY_MS, (cx) => this.readMemory(cx));
  }

  // The guard already writes this file. The bar only reads it.
  readMemory(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (readCx) => {
      const text = await tryOrAsync(() => readTextFile(paths.join(appHome(), ...GUARD_NOW)));
      this.reading = false;
      const next = text ?? null;
      const stamp = JSON.stringify(memoryLow(next));
      if (next === this.memoryText && stamp === this.memoryStamp) return;
      this.memoryText = next;
      this.memoryStamp = stamp;
      readCx.notify();
    });
  }

  render() {
    const t = theme();
    // Two copies share the row (the strip's minimap sits between): side says which half this one draws.
    const side = props()?.side;
    const left = side !== "right", right = side !== "left";
    const space = left ? spaces().find((s) => s.active) : null;
    const list = right ? agents() : [];
    const terms = right ? terminals() : [];
    const byAgent = new Map(list.map((agent) => [agent.address, agent]));
    const byTerm = new Map(terms.map((term) => [term.address, term]));
    const rows = right ? (shared("kanso.needs-you")?.rows ?? []) : [];
    const questions = Object.fromEntries(rows.flatMap((row) => {
      const agent = byAgent.get(row?.address);
      return row?.status === "blocked" ? [[row.address, questionOf({
        msg: byTerm.get(row.address)?.report?.msg, title: agent?.title, name: row.name, program: agent?.program,
      })]] : [];
    }));
    const needs = needsItem(rows, questions);
    const low = right ? memoryLow(this.memoryText) : null;
    const computer = left ? computerOf(space, machines()) : null;
    const working = list.filter((agent) => agent.status === "working").length;
    const chip = (icon, text) => h_flex().gap(6).items_center().min_w(0)
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(13).flex_none()).child(div().truncate().child(text));
    const act = (el, id, tip, command) => el.id(id).cursor_pointer().tooltip(tip)
      .hover((s) => s.bg(t.foreground + "0a")).on_click(() => run(command));
    const mac = window()?.platform === "macos";
    const map = pieces(shared);
    const agentsText = list.length === 0 ? "No agents"
      : working > 0 ? `${working} of ${list.length} working` : `${list.length} ${list.length === 1 ? "agent" : "agents"} idle`;
    return h_flex().size_full().px(12).gap(18).items_center().text_size(11.5).text_color(t.muted)
      .when(right && !left, (el) => el.justify_end())
      .when(left && shown("status.computer", true, map), (el) => el.child(computer.command
        ? act(chip(computer.icon, computer.words).text_color(t[computer.tone]), "status-computer", computer.tooltip, computer.command)
        : chip(computer.icon, computer.words))
        .when(Boolean(space?.branch), (row) => row.child(chip("branch", space.branch))))
      .when(left && right, (el) => el.child(div().flex_1()))
      .when(right && needs, (el) => el.child(act(h_flex().gap(6).items_center().min_w(0), "needs-you", needs.tooltip, needs.command)
        .child(stateMark(t, needs.mark, 12))
        .child(div().flex_none().font_medium().text_color(t[needs.nameTone]).child(needs.name))
        .when(needs.question, (row) => row.child(div().max_w(needs.questionWidth).min_w(0).truncate().text_color(t[needs.questionTone]).child(needs.question)))
        .when(needs.more, (row) => row.child(div().flex_none().text_color(t[needs.moreTone]).child(needs.more)))))
      .when(right && low, (el) => el.child(act(h_flex().gap(6).items_center().text_color(t[low.tone]), "status-memory", low.tooltip, low.command)
        .child(low.words)))
      .when(right && shown("status.agents", true, map), (el) => el.child(h_flex().gap(6).items_center()
        .child(stateMark(t, working > 0 ? "working" : "idle", 12, { idle: true }))
        .child(agentsText)))
      .when(right && shown("status.palette", true, map), (el) => el.child(act(div().px(6).py(2).rounded(6), "palette", "Command palette", "app.palette")
        .child(mac ? "⌘⇧P" : "Ctrl+Shift+P")));
  }
}
