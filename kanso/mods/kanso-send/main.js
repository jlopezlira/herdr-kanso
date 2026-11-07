// Send to an agent, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A pane's work, handed to another agent: you pick the agent, read and edit
// the message, and Send pastes it into that agent's terminal and presses
// Enter (`hc send`), as if you had typed it there. Nothing goes without you
// pressing Send, nothing is added to what the agent sees but your message,
// and an agent waiting on its own question is never typed into. Then the
// keyboard goes to that agent, so you see it land.
//
// Opened from a pane header's send button, the pane menu or Cmd+Alt+S, with
// props.pane: the pane whose work it is.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { panes, spaces, shared, setShared, hc, run, props, closeOverlay, theme, home } from "herdr";
import { programIcon, givenNames, nameOf } from "./marks.js";

const LAST = "kanso.send.last"; // the agent you sent to last, picked first next time

const tilde = (cwd) => {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

// The agents you can send to: every other pane running one, in any space,
// the one you sent to last first, then the order Herdr lists them in.
export function targetsOf(all, from, last) {
  const list = all.filter((p) => p.pane !== from && p.terminal && (p.program?.agent || p.status));
  const i = list.findIndex((p) => p.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
}

// The message it starts with: where the work is. You edit it before sending.
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
    this.text = draftFor(this.from, shared("kanso.digest")?.[p.pane]);
    this.box = TextareaState.new({ value: this.text, rows: 5 });
    this.box.on("change", (_e, cx) => { this.text = this.box.value(); this.error = null; cx.notify(); });
    this.box.focus();
    cx.timer.after(400, () => this.box.focus());
    this.handle = cx.focus_handle();
    this.sending = false;
    this.error = null;
  }

  send(cx) {
    const text = this.text.trim();
    const target = panes().find((q) => q.terminal === this.to);
    if (!text || !target || this.sending) return;
    if (target.status === "blocked") { this.error = `${nameOf(target, givenNames())} is waiting on its own question. Answer it first, then send.`; cx.notify(); return; }
    this.sending = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["send", target.terminal, text]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      this.sending = false;
      if (r.code !== 0) { this.error = `Not sent: ${(r.stderr || r.stdout || "hc send failed").trim()}`; cx.notify(); return; }
      setShared(LAST, target.terminal);
      closeOverlay(props().overlay);
      run("agent.focus", { terminal: target.terminal });
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const list = targetsOf(panes(), p.pane, shared(LAST));
    if (!list.some((q) => q.terminal === this.to)) this.to = list[0]?.terminal ?? null;
    // Read once per draw: the names you gave, every space.
    const given = givenNames(), sp = spaces();
    const name = (q) => nameOf(q, given);
    const spaceOf = (q) => sp.find((s) => s.tabs.some((x) => x.id === q.tab));
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const dot = (st) => ({ working: t.working, blocked: t.blocked, done: t.done }[st] ?? t.idle);
    const row = (q) => {
      const on = q.terminal === this.to;
      const where = [spaceOf(q)?.name, q.branch].filter(Boolean).join(" on ");
      return h_flex().id(`to-${q.pane}`).flex_none().h(34).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.to = q.terminal; this.error = null; cx.notify(); })
        .child(programIcon(q.program, 15, t.muted) ?? div().size(15))
        .child(div().flex_none().max_w(200).truncate().text_size(12.8).text_color(t.foreground).when(on, (el) => el.font_medium()).child(name(q)))
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
    const ready = Boolean(this.to) && Boolean(this.text.trim()) && !this.sending;
    return v_flex().id("kanso-send").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) { this.send(cx); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Send to an agent"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(from), (el) => el.child(div().pt(4).truncate().text_size(11.5).text_color(t.dim).child(from)))
      .child(label("To"))
      .child(list.length
        // Five rows show, the rest scroll: a set height (rows never shrink
        // to fit it, or there would be nothing to scroll).
        ? v_flex().id("send-list").flex_none().h(Math.min(list.length, 5) * 36 - 2).overflow_y_scrollbar().gap(2).children(list.map(row))
        : div().py(8).text_size(12).text_color(t.muted).child("No other agent is running. Start one in a pane, then send."))
      .child(label("Message"))
      .child(Textarea.new(this.box).px(10).py(8).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(this.error ? t.blocked : t.dim)
        .child(this.error ?? "Pasted into its terminal and sent with Enter, as if you typed it there."))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("send-cancel", "Cancel", false, true, () => closeOverlay(p.overlay)))
        .child(button("send-go", this.sending ? "Sending…" : "Send  ⌘↩", true, ready, (cx) => this.send(cx))));
  }
}
