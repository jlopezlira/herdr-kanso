// Send to an agent, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// props.pane: the pane whose work the draft is about.
import { View } from "gpui-kit";
import { panes, spaces, terminals, machines, shared, setShared, run, props, closeOverlay, theme } from "herdr";
import { givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote, NOT_CONFIRMED, MAY_HAVE_ARRIVED } from "./deliver.js";
import { shortFolder } from "./folder.js";
import { tokens } from "./ui.js";
import { dialog } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { row, stack, emptyState } from "./kit.js";

const LAST = "kanso.send.last";

export function targetsOf(all, from, last) {
  const list = all.filter((p) => p.pane !== from && p.terminal && isAgent(p));
  const i = list.findIndex((p) => p.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
}

const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);
export const unreachable = (address, computers = []) => {
  const at = machineOf(address);
  const layout = at ? computers.find((m) => m?.name === at)?.layout : "ready";
  return !layout || layout === "unavailable";
};

// `nameOf(pane)` and `projectOf(pane)` name one Kanso has not labelled yet.
export function everyone(terms, ps, { from = null, last = null, query = "", nameOf = () => null, projectOf = () => null, computers = [] } = {}) {
  const paneOf = new Map(ps.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const mine = from ? terms.find((k) => k.address === from)?.labels?.["kanso.project"] ?? projectOf(paneOf.get(from)) : null;
  const q = query.trim().toLowerCase();
  const known = new Set(terms.map((k) => k.address));
  const list = [...terms, ...[...paneOf.keys()].filter((address) => !known.has(address)).map((address) => ({ address }))]
    .filter((k) => k.address !== from && (!k.state || k.state === "live") && isAgent(k, paneOf.get(k.address)))
    .map((k) => {
      const pane = paneOf.get(k.address) ?? null;
      return { terminal: k.address, pane, status: k.status ?? pane?.status ?? null, program: k.program ?? pane?.program ?? null,
        name: k.labels?.["kanso.shown"] || (pane ? nameOf(pane) : null) || k.address,
        project: k.labels?.["kanso.project"] || (pane ? projectOf(pane) : null) || "Other", away: unreachable(k.address, computers) };
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
    this.box.on("change", (_e, cx) => this.pick(cx, { text: this.box.value() }));
    this.box.focus();
    cx.timer.after(400, () => this.box.focus());
    this.handle = cx.focus_handle();
    this.sending = false;
    this.unsure = [];
    this.again = false;
    this.error = null;
  }

  pick(cx, change) {
    Object.assign(this, change, { error: null, again: false });
    cx.notify();
  }

  send(cx, groups) {
    const text = this.text.trim();
    const all = groups.flatMap((g) => g.agents);
    const targets = this.toProject ? (groups.find((g) => g.project === this.toProject)?.agents ?? []) : all.filter((x) => x.terminal === this.to);
    if (!text || !targets.length || this.sending) return;
    const waiting = targets.filter((x) => x.status === "blocked"), ready = targets.filter((x) => x.status !== "blocked");
    if (!ready.length) { this.error = waitingNote(waiting.map((x) => x.name)); cx.notify(); return; }
    if (ready.some((x) => this.unsure.includes(x.terminal)) && !this.again) { this.again = true; cx.notify(); return; }
    const sender = this.from?.terminal ? terminals().find((k) => k.address === this.from.terminal)?.labels?.["kanso.shown"] || nameOf(this.from, givenNames()) : "you";
    this.sending = true; this.error = null; this.again = false; this.unsure = []; cx.notify();
    cx.spawn(async (cx) => {
      const results = await Promise.all(ready.map(async (x) => ({ x, r: await deliver(cx.timer, x.terminal, text, sender) })));
      this.sending = false;
      const unsure = results.filter(({ r }) => r.unconfirmed), refused = results.filter(({ r }) => r.code !== 0 && !r.unconfirmed);
      this.unsure = unsure.map(({ x }) => x.terminal);
      const said = [
        refused.length ? `Not sent to ${refused.map(({ x, r }) => `${x.name} (${(r.stderr || r.stdout || "hc send failed").trim()})`).join(", ")}.` : "",
        unsure.length ? `${NOT_CONFIRMED} for ${unsure.map(({ x }) => x.name).join(", ")}: ${MAY_HAVE_ARRIVED}.` : "",
        waiting.length ? `${waiting.map((x) => x.name).join(", ")} waited on ${waiting.length === 1 ? "its" : "their"} own question and got nothing.` : "",
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
    const given = givenNames(), sp = spaces();
    const name = (q) => nameOf(q, given);
    const spaceOf = (q) => sp.find((s) => s.tabs.some((x) => x.id === q.tab));
    const roster = (query) => everyone(terminals(), panes(), { from: this.from?.terminal ?? null, last: shared(LAST), query,
      nameOf: name, projectOf: (q) => spaceOf(q)?.name ?? null, computers: machines() });
    const groups = roster(this.query.value());
    const list = groups.flatMap((g) => g.agents);
    // A search that hides the chosen project drops it, so Send always means what is shown.
    if (this.toProject && !groups.some((g) => g.project === this.toProject)) this.toProject = null;
    if (!this.toProject && !list.some((q) => q.terminal === this.to)) {
      const gone = this.to !== null && !roster("").some((g) => g.agents.some((q) => q.terminal === this.to));
      this.to = gone ? null : list[0]?.terminal ?? this.to;
    }
    const head = (g) => {
      const on = this.toProject === g.project;
      return row({ name: g.project, heading: true, current: on, meta: on ? `All ${g.agents.length}` : g.agents.length > 1 ? `Send to all ${g.agents.length}` : null })(
        `to-project-${g.project}`, c, { onClick: (cx) => this.pick(cx, { toProject: on ? null : g.project }) });
    };
    // A program with no art of its own takes the terminal's, so every name starts at the same place.
    const agent = (q) => row({
      icon: q.program?.icon ? q.program : "terminal", tone: "muted", name: q.name, detail: q.pane?.branch ?? null,
      meta: this.unsure.includes(q.terminal) ? { text: NOT_CONFIRMED, tone: "blocked" } : q.away ? { text: "Unreachable", tone: "blocked" }
        : q.status === "blocked" ? { text: "Needs you", tone: "blocked" } : null,
      mark: q.status, current: !this.toProject && q.terminal === this.to,
    })(`to-${q.terminal}`, c, { onClick: (cx) => this.pick(cx, { to: q.terminal, toProject: null }) });
    const from = this.from ? `From ${name(this.from)}${this.from.cwd ? `, in ${shortFolder(this.from.cwd)}` : ""}` : "";
    const ready = Boolean(this.toProject || list.some((q) => q.terminal === this.to)) && Boolean(this.text.trim());
    const rows = groups.flatMap((g) => [head(g), ...g.agents.map(agent)]);
    const close = () => closeOverlay(p.overlay);
    return dialog("kanso-send", c, {
      title: "Send to an agent", scope: from,
      body: [
        field("send-to", this.query, c, { label: "To" }),
        (rows.length ? stack({ variant: "dialog list", scroll: true }, rows)
          : emptyState({ text: this.query.value().trim() ? "No agent or project by that name." : "No other agent is running. Start one in a pane, then send." }))("send-list", c),
        field("send-message", this.box, c, { label: "Message" }),
      ],
      notes: [{ text: this.error ?? "Pasted into its terminal and sent with Enter, as if you typed it there.", tone: this.error ? "error" : "dim" }],
      secondary: "Cancel", primary: this.toProject ? `Send to ${this.toProject}  ⌘↩` : "Send  ⌘↩",
      state: this.sending ? "loading" : !ready ? "disabled" : this.again ? "armed" : "default",
      onCancel: close, onPrimary: (cx) => this.send(cx, groups), focusHandle: this.handle,
      onKey: (e, cx) => { if (sendKey(e)) { this.send(cx, groups); cx.stop_propagation(); } },
    });
  }
}
