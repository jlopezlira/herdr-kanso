// Send to an agent, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// props.pane: the pane whose work the draft is about.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { panes, spaces, terminals, shared, setShared, run, props, closeOverlay, theme } from "herdr";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";
import { shortFolder } from "./folder.js";
import { G, H, ICON_ROW, tokens } from "./ui.js";
import { dialog } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { row } from "./ui-row.js";

const LAST = "kanso.send.last";
// Rows the list shows before it scrolls.
const LIST_ROWS = 6;

export function targetsOf(all, from, last) {
  const list = all.filter((p) => p.pane !== from && p.terminal && isAgent(p));
  const i = list.findIndex((p) => p.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
}

// `nameOf(pane)` and `projectOf(pane)` name one Kanso has not labelled yet.
export function everyone(terms, ps, { from = null, last = null, query = "", nameOf = () => null, projectOf = () => null } = {}) {
  const paneOf = new Map(ps.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const mine = from ? terms.find((k) => k.address === from)?.labels?.["kanso.project"] ?? projectOf(paneOf.get(from)) : null;
  const q = query.trim().toLowerCase();
  const list = terms
    .filter((k) => k.address !== from && !String(k.address).includes("/") && (!k.state || k.state === "live") && isAgent(k, paneOf.get(k.address)))
    .map((k) => {
      const pane = paneOf.get(k.address) ?? null;
      return { terminal: k.address, pane, status: k.status ?? pane?.status ?? null, program: k.program ?? pane?.program ?? null,
        name: k.labels?.["kanso.shown"] || (pane ? nameOf(pane) : null) || k.address,
        project: k.labels?.["kanso.project"] || (pane ? projectOf(pane) : null) || "Other" };
    })
    .filter((x) => !q || x.name.toLowerCase().includes(q) || x.project.toLowerCase().includes(q));
  const order = [...new Set([mine, ...list.map((x) => x.project).toSorted((a, b) => a.localeCompare(b))].filter((p) => p && list.some((x) => x.project === p)))];
  return order.map((project) => {
    const group = list.filter((x) => x.project === project);
    const i = group.findIndex((x) => x.terminal === last);
    return { project, agents: i > 0 ? [group[i], ...group.toSpliced(i, 1)] : group };
  });
}

export function draftFor(p, digest) {
  if (!p?.cwd) return "Review the latest changes.";
  const where = shortFolder(p.cwd);
  const head = p.branch ? `Review the changes on branch ${p.branch} in ${where}.` : `Review the changes in ${where}.`;
  return digest?.pr ? `${head} Its pull request is #${digest.pr.number}.` : head;
}

export default class Send extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.from = panes().find((q) => q.pane === p.pane) ?? null;
    this.to = targetsOf(panes(), p.pane, shared(LAST))[0]?.terminal ?? null;
    this.toProject = null;
    this.query = new TextField({ placeholder: "Find an agent or a project" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.text = draftFor(this.from, shared("kanso.digest")?.[p.pane]);
    this.box = new TextField({ value: this.text }, { multiline: true });
    this.box.on("change", (_e, cx) => { this.text = this.box.value(); this.error = null; cx.notify(); });
    this.box.focus();
    cx.timer.after(400, () => this.box.focus());
    this.handle = cx.focus_handle();
    this.sending = false;
    this.error = null;
  }

  send(cx, groups) {
    const text = this.text.trim();
    const all = groups.flatMap((g) => g.agents);
    const targets = this.toProject ? (groups.find((g) => g.project === this.toProject)?.agents ?? []) : all.filter((x) => x.terminal === this.to);
    if (!text || !targets.length || this.sending) return;
    const waiting = targets.filter((x) => x.status === "blocked"), ready = targets.filter((x) => x.status !== "blocked");
    if (!ready.length) { this.error = waitingNote(waiting.map((x) => x.name)); cx.notify(); return; }
    const sender = this.from?.terminal ? terminals().find((k) => k.address === this.from.terminal)?.labels?.["kanso.shown"] || nameOf(this.from, givenNames()) : "you";
    this.sending = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const results = await Promise.all(ready.map(async (x) => ({ x, r: await deliver(x.terminal, text, sender) })));
      this.sending = false;
      const failed = results.filter(({ r }) => r.code !== 0);
      const skipped = waiting.length ? ` ${waiting.map((x) => x.name).join(", ")} waited on ${waiting.length === 1 ? "its" : "their"} own question and got nothing.` : "";
      if (failed.length) { this.error = `Not sent to ${failed.map(({ x, r }) => `${x.name} (${(r.stderr || r.stdout || "hc send failed").trim()})`).join(", ")}.${skipped}`; cx.notify(); return; }
      if (skipped) { this.error = `Sent.${skipped}`; cx.notify(); return; }
      if (!this.toProject) setShared(LAST, ready[0].terminal);
      closeOverlay(props().overlay);
      if (ready.length === 1) run("agent.focus", { terminal: ready[0].terminal });
    });
  }

  render() {
    const t = theme(), c = tokens(t);
    const p = props() ?? {};
    const given = givenNames(), sp = spaces();
    const name = (q) => nameOf(q, given);
    const spaceOf = (q) => sp.find((s) => s.tabs.some((x) => x.id === q.tab));
    const groups = everyone(terminals(), panes(), { from: this.from?.terminal ?? null, last: shared(LAST), query: this.query.value(),
      nameOf: name, projectOf: (q) => spaceOf(q)?.name ?? null });
    const list = groups.flatMap((g) => g.agents);
    // A search that hides the chosen project drops it, so Send always means what is shown.
    if (this.toProject && !groups.some((g) => g.project === this.toProject)) this.toProject = null;
    if (!this.toProject && !list.some((q) => q.terminal === this.to)) this.to = list[0]?.terminal ?? null;
    const head = (g) => {
      const on = this.toProject === g.project;
      return row(`to-project-${g.project}`, c, {
        name: g.project, heading: true, current: on, meta: on ? `All ${g.agents.length}` : g.agents.length > 1 ? `Send to all ${g.agents.length}` : null,
        onClick: (cx) => { this.toProject = on ? null : g.project; this.error = null; cx.notify(); },
      }).flex_none();
    };
    const agent = (q) => row(`to-${q.terminal}`, c, {
      start: [programIcon(q.program, ICON_ROW, c.muted) ?? div().size(ICON_ROW)], name: q.name, detail: q.pane?.branch ?? null,
      meta: q.status === "blocked" ? { text: "Needs you", tone: "blocked" } : null, mark: q.status, current: !this.toProject && q.terminal === this.to,
      onClick: (cx) => { this.to = q.terminal; this.toProject = null; this.error = null; cx.notify(); },
    }).flex_none();
    const from = this.from ? `From ${name(this.from)}${this.from.cwd ? `, in ${shortFolder(this.from.cwd)}` : ""}` : "";
    const ready = Boolean(this.toProject || this.to) && Boolean(this.text.trim());
    const rows = groups.flatMap((g) => [head(g), ...g.agents.map(agent)]);
    const close = () => closeOverlay(p.overlay);
    return dialog("kanso-send", c, {
      title: "Send to an agent", scope: from,
      body: [
        field("send-to", this.query, c, { label: "To" }).pb(G.sm),
        rows.length
          // A set height, rows that never shrink: past it, the list scrolls.
          ? v_flex().id("send-list").flex_none().h(Math.min(rows.length, LIST_ROWS) * H.line).mx(-G.sm).px(G.sm).overflow_y_scrollbar().children(rows)
          : div().py(8).text_size(12).text_color(t.muted).child(this.query.value().trim() ? "No agent or project by that name." : "No other agent is running. Start one in a pane, then send."),
        field("send-message", this.box, c, { label: "Message" }).pt(G.lg),
      ],
      notes: [{ text: this.error ?? "Pasted into its terminal and sent with Enter, as if you typed it there.", tone: this.error ? "error" : "dim" }],
      secondary: "Cancel", primary: this.toProject ? `Send to ${this.toProject}  ⌘↩` : "Send  ⌘↩",
      state: this.sending ? "loading" : ready ? "default" : "disabled",
      onCancel: close, onPrimary: (cx) => this.send(cx, groups), focusHandle: this.handle,
      onKey: (e, cx) => { if (sendKey(e)) { this.send(cx, groups); cx.stop_propagation(); } },
    });
  }
}
