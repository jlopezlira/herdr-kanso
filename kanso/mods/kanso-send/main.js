// Send to an agent, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// props.pane: the pane whose work the draft is about.
import { View } from "gpui-kit";
import { panes, spaces, terminals, machines, shared, setShared, run, props, closeOverlay, theme } from "herdr";
import { givenNames, nameOf } from "./marks.js";
import { deliver, sendKey, waitingNote, NOT_CONFIRMED, MAY_HAVE_ARRIVED } from "./deliver.js";
import { sendState, targetsOf } from "./send-model.js";
import { shortFolder } from "./folder.js";
import { tokens } from "./ui.js";
import { dialog } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { row, stack, emptyState } from "./kit.js";

const LAST = "kanso.send.last";
const HOLD_MS = 1000;
const UNSEEN = "Can't see the agents right now.";

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
    this.toProject = null;
    this.to = targetsOf(panes(), p.pane, shared(LAST), machines())[0]?.terminal ?? this.state("").groups[0]?.recipients[0]?.terminal ?? null;
    this.query = new TextField({ placeholder: "Find an agent or a project" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.text = typeof p.text === "string" && p.text.trim() ? p.text : draftFor(this.from, shared("kanso.digest")?.[p.pane]);
    this.box = new TextField({ value: this.text }, { multiline: true });
    this.box.on("change", (_e, cx) => this.pick(cx, () => { this.text = this.box.value(); }));
    this.box.focus();
    cx.timer.after(400, () => this.box.focus());
    this.handle = cx.focus_handle();
    this.sending = false;
    this.unsure = [];
    this.error = null;
    this.note = null;
    this.held = null;
  }

  pick(cx, choose) {
    choose();
    this.error = null;
    cx.notify();
  }

  state(query = this.query?.value() ?? "") {
    const given = givenNames();
    return sendState({ terms: terminals(), ps: panes(), spaces: spaces(), computers: machines(), from: this.from?.terminal ?? null,
      to: this.to, toProject: this.toProject, query, last: shared(LAST), nameOf: (q) => nameOf(q, given) });
  }

  press(cx, drawn) {
    const now = this.state();
    const aim = (state) => JSON.stringify([state.recipients, state.waiting].map((list) => list.map((x) => x.terminal).toSorted()));
    if (aim(now) !== aim(drawn)) { cx.notify(); return; }
    this.send(cx, now);
  }

  hold(cx) {
    const now = this.state();
    const live = (x) => now.recipients.find((r) => r.terminal === x.terminal) ?? x;
    if (this.held.some((x) => live(x).status === "working")) { cx.timer.after(HOLD_MS, (next) => this.hold(next)); return; }
    const ready = this.held.map(live);
    this.held = null; this.note = null;
    this.send(cx, { recipients: ready, waiting: [] });
  }

  send(cx, { recipients: ready, waiting }) {
    const text = this.text.trim();
    if (!text || this.sending || this.held || (!ready.length && !waiting.length)) return;
    if (!ready.length) { this.error = waitingNote(waiting.map((x) => x.label)); cx.notify(); return; }
    if ((props() ?? {}).whenWaiting && ready.some((x) => x.status === "working")) {
      this.held = ready; this.error = null;
      this.note = `Sends when ${ready.filter((x) => x.status === "working").map((x) => x.label).join(", ")} waits for you.`;
      cx.notify();
      cx.timer.after(HOLD_MS, (next) => this.hold(next));
      return;
    }
    const sender = this.from?.terminal ? terminals().find((k) => k.address === this.from.terminal)?.labels?.["kanso.shown"] || nameOf(this.from, givenNames()) : "you";
    this.sending = true; this.error = null; this.unsure = []; cx.notify();
    cx.spawn(async (cx) => {
      const results = await Promise.all(ready.map(async (x) => ({ x, r: await deliver(cx.timer, x.terminal, text, sender) })));
      this.sending = false;
      const unsure = results.filter(({ r }) => r.unconfirmed), refused = results.filter(({ r }) => r.code !== 0 && !r.unconfirmed);
      this.unsure = unsure.map(({ x }) => x.terminal);
      const said = [
        refused.length ? `Not sent to ${refused.map(({ x, r }) => `${x.label} (${(r.stderr || r.stdout || "hc send failed").trim()})`).join(", ")}.` : "",
        unsure.length ? `${NOT_CONFIRMED} for ${unsure.map(({ x }) => x.label).join(", ")}: ${MAY_HAVE_ARRIVED}.` : "",
        waiting.length ? `${waiting.map((x) => x.label).join(", ")} waited on ${waiting.length === 1 ? "its" : "their"} own question and got nothing.` : "",
      ].filter(Boolean).join(" ");
      if (refused.length || unsure.length) { this.error = said; cx.notify(); return; }
      if (said) { this.error = `Sent. ${said}`; cx.notify(); return; }
      if (!this.toProject) setShared(LAST, ready[0].terminal);
      closeOverlay(props().overlay);
      if (ready.length === 1) run("agent.focus", { terminal: ready[0].terminal });
    });
  }

  render() {
    const c = tokens(theme());
    const p = props() ?? {};
    const name = (q) => nameOf(q, givenNames());
    const state = this.state();
    const head = (g) => {
      const on = this.toProject === g.project, n = g.recipients.length;
      return row({ name: g.project, heading: true, current: on, meta: on ? `All ${n}` : n > 1 ? `Send to all ${n}` : null })(
        `to-project-${g.project}`, c, { onClick: (cx) => this.pick(cx, () => { this.toProject = on ? null : g.project; }) });
    };
    const meta = (q) => (this.unsure.includes(q.terminal) ? { text: NOT_CONFIRMED, tone: "blocked" }
      : q.state === "unreachable" ? { text: "Unreachable", tone: "blocked" }
        : q.state === "gone" || q.state === "unknown" ? { text: "Unknown", tone: "blocked" }
          : q.state === "shell" ? { text: q.program?.name || "Unknown", tone: "blocked" }
            : q.status === "blocked" ? { text: "Needs you", tone: "blocked" } : null);
    // A program with no art of its own takes the terminal's, so every name starts at the same place.
    const agent = (q) => row({
      icon: q.program?.icon ? q.program : "terminal", tone: "muted", name: q.title, detail: q.pane?.branch ?? null,
      meta: meta(q), mark: q.status, current: !this.toProject && q.terminal === this.to,
    })(`to-${q.terminal}`, c, { onClick: (cx) => this.pick(cx, () => { this.to = q.terminal; this.toProject = null; }) });
    const from = this.from ? `From ${name(this.from)}${this.from.cwd ? `, in ${shortFolder(this.from.cwd)}` : ""}` : "";
    const ready = (state.recipients.length > 0 || state.waiting.length > 0) && Boolean(this.text.trim());
    const rows = state.groups.flatMap((g) => [head(g), ...g.agents.map(agent)]);
    const empty = { unknown: UNSEEN, "no match": "No agent or project by that name.", none: "No other agent is running. Start one in a pane, then send." }[state.empty];
    const close = () => closeOverlay(p.overlay);
    return dialog("kanso-send", c, {
      title: "Send to an agent", scope: from,
      body: [
        field("send-to", this.query, c, { label: "To" }),
        (rows.length ? stack({ variant: "dialog list", scroll: true }, rows) : emptyState({ text: empty }))("send-list", c),
        field("send-message", this.box, c, { label: "Message" }),
      ],
      notes: [{ text: this.error ?? this.note ?? "Pasted into its terminal and sent with Enter, as if you typed it there.", tone: this.error ? "error" : "dim" },
        ...(rows.length && !state.complete ? [{ text: UNSEEN, tone: "dim" }] : [])],
      secondary: "Cancel", primary: state.label,
      state: this.sending ? "loading" : ready ? "default" : "disabled",
      onCancel: close, onPrimary: (cx) => this.press(cx, state), focusHandle: this.handle,
      onKey: (e, cx) => { if (sendKey(e)) { this.press(cx, state); cx.stop_propagation(); } },
    });
  }
}
