// Derived from the `workspace-status` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: no background or top border.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-status.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-status; one quiet line; who is waiting and what they ask (a click goes there, as Cmd+J); low memory from the guard's file; stand-ins that show only while their home is out of sight.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, machines, theme, run, props, shared, appHome, readTextFile } from "herdr";
import { G, T, tokens } from "./ui.js";
import { iconButton } from "./ui-button.js";
import { failureLine, tooltip } from "./kit.js";
import { boundChord } from "./ui-tooltip.js";
import { statusItem, needsItem } from "./ui-status.js";
import { afterMount, aliasText, tryOrAsync } from "./pure.js";
import { paths } from "./platform-paths.js";
import { MEMORY_MS, PALETTE_COMMAND, computerOf, computerShown, waitingItem, questionOf, memoryLow, workingItem } from "./model.js";
import { pieces, shown } from "./pieces.js";

const GUARD_NOW = ["data", "kanso-guard", "now.json"];
const SIDEBAR_COLLAPSED = "sidebar.collapsed";
const go = (command) => () => run(command);

const computerItem = (computer, c) => (computer.fix
  ? failureLine({ text: computer.words, fix: computer.fix, detail: computer.tooltip })("status-computer", c, { onClick: go(computer.command) })
  : statusItem("status-computer", c, { icon: computer.icon, text: computer.words, pending: computer.pending }));

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
    const c = tokens(theme());
    // Two copies share the row (the strip's minimap sits between): side says which half this one draws.
    const side = props()?.side;
    const left = side !== "right", right = side !== "left";
    const map = pieces(shared);
    const space = left ? spaces().find((s) => s.active) : null;
    const computer = left && shown("status.computer", true, map)
      ? computerOf(space, machines(), aliasText(shared("kanso.alias"), space?.machine || "")) : null;
    const list = right ? agents() : [];
    const byAgent = new Map(list.map((agent) => [agent.address, agent]));
    const byTerm = new Map((right ? terminals() : []).map((term) => [term.address, term]));
    const rows = right ? (shared("kanso.needs-you")?.rows ?? []) : [];
    const questions = Object.fromEntries(rows.flatMap((row) => {
      const agent = byAgent.get(row?.address);
      return row?.status === "blocked" ? [[row.address, questionOf({
        msg: byTerm.get(row.address)?.report?.msg, title: agent?.title, name: row.name, program: agent?.program,
      })]] : [];
    }));
    const needs = waitingItem(rows, questions);
    const low = right ? memoryLow(this.memoryText) : null;
    const working = workingItem(list);
    return h_flex().size_full().px(G.md).gap(G.lg).items_center().text_size(T.body).text_color(c.muted)
      .when(right && !left, (el) => el.justify_end())
      .when(computerShown(computer, shared(SIDEBAR_COLLAPSED)), (el) => el.child(computerItem(computer, c)))
      .when(left && right, (el) => el.child(div().flex_1()))
      .when(Boolean(needs), (el) => el.child(needsItem("needs-you", c,
        { name: needs.name, question: needs.question, more: needs.more, tip: needs.tooltip, onClick: go(needs.command) })))
      .when(Boolean(low), (el) => el.child(statusItem("status-memory", c, { text: low.words, tone: low.tone, tip: low.tooltip, onClick: go(low.command) })))
      .when(right && shown("status.agents", working.count > 0, map), (el) => el.child(statusItem("status-working", c,
        { mark: working.mark, text: working.words, tip: working.tooltip, onClick: go(working.command) })))
      .when(right && shown("status.palette", true, map), (el) => el.child(iconButton("palette", "command", tooltip({ label: "Command palette", chord: boundChord(PALETTE_COMMAND) }), go(PALETTE_COMMAND), c, { size: "sm" })));
  }
}
