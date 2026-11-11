import { paths } from "./platform-paths.js";
// Send to an agent, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// props.pane: the pane whose work the draft is about.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { panes, spaces, terminals, shared, setShared, run, props, closeOverlay, theme, home } from "herdr";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";

const LAST = "kanso.send.last";

const tilde = (cwd) => {
  if (!cwd) return "";
  return paths.shorten(cwd, home());
};

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
  const where = tilde(p.cwd);
  const head = p.branch ? `Review the changes on branch ${p.branch} in ${where}.` : `Review the changes in ${where}.`;
  return digest?.pr ? `${head} Its pull request is #${digest.pr.number}.` : head;
}

export default class Send extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.from = panes().find((q) => q.pane === p.pane) ?? null;
    this.to = targetsOf(panes(), p.pane, shared(LAST))[0]?.terminal ?? null;
    this.toProject = null;
    this.query = InputState.new({ placeholder: "Find an agent or a project" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.text = draftFor(this.from, shared("kanso.digest")?.[p.pane]);
    this.box = TextareaState.new({ value: this.text, rows: 5 });
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
    const t = theme();
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
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const dot = (st) => ({ working: t.working, blocked: t.blocked, done: t.done }[st] ?? t.idle);
    const head = (g) => {
      const on = this.toProject === g.project;
      return h_flex().id(`to-project-${g.project}`).flex_none().h(28).px(10).gap(8).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.toProject = on ? null : g.project; this.error = null; cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.muted).child(g.project))
        .child(div().flex_none().text_size(11).text_color(on ? t.foreground : t.dim).child(on ? `All ${g.agents.length}` : g.agents.length > 1 ? `Send to all ${g.agents.length}` : ""));
    };
    const row = (q) => {
      const on = !this.toProject && q.terminal === this.to;
      const where = q.pane?.branch ?? "";
      return h_flex().id(`to-${q.terminal}`).flex_none().h(34).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.to = q.terminal; this.toProject = null; this.error = null; cx.notify(); })
        .child(programIcon(q.program, 15, t.muted) ?? div().size(15))
        .child(div().flex_none().max_w(200).truncate().text_size(12.8).text_color(t.foreground).when(on, (el) => el.font_medium()).child(q.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where))
        .child(h_flex().flex_none().gap(6).items_center().text_size(11.5).text_color(q.status === "blocked" ? t.blocked : t.dim)
          .when(q.status === "blocked", (el) => el.child("Needs you"))
          .child(div().size(6).rounded_full().bg(dot(q.status))));
    };
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .child(text);
    const from = this.from ? `From ${name(this.from)}${this.from.cwd ? `, in ${tilde(this.from.cwd)}` : ""}` : "";
    const ready = Boolean(this.toProject || this.to) && Boolean(this.text.trim()) && !this.sending;
    const rows = groups.flatMap((g) => [head(g), ...g.agents.map(row)]);
    return v_flex().id("kanso-send").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (sendKey(e)) { this.send(cx, groups); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Send to an agent"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(from), (el) => el.child(div().pt(4).truncate().text_size(11.5).text_color(t.dim).child(from)))
      .child(label("To"))
      .child(div().h(30).flex_none().mb(6).px(8).flex().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.query).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(rows.length
        // A set height, rows that never shrink: past it, the list scrolls.
        ? v_flex().id("send-list").flex_none().h(Math.min(rows.length * 34, 6 * 34)).overflow_y_scrollbar().gap(1).children(rows)
        : div().py(8).text_size(12).text_color(t.muted).child(this.query.value().trim() ? "No agent or project by that name." : "No other agent is running. Start one in a pane, then send."))
      .child(label("Message"))
      .child(Textarea.new(this.box).px(10).py(8).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(this.error ? t.blocked : t.dim)
        .child(this.error ?? "Pasted into its terminal and sent with Enter, as if you typed it there."))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("send-cancel", "Cancel", false, true, () => closeOverlay(p.overlay)))
        .child(button("send-go", this.sending ? "Sending…" : this.toProject ? `Send to ${this.toProject}  ⌘↩` : "Send  ⌘↩", true, ready, (cx) => this.send(cx, groups))));
  }
}
