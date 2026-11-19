import { paths } from "./platform-paths.js";
// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Props: sleep { scope: "agent" | "tab" | "project", space, tab, pane }, wake { space, tab, terminal }.
// Asleep is Herdr's own state: each Claude terminal keeps its conversation id as a label, and its tab is settled.
import { View } from "gpui-kit";
import { spaces, panes, terminals, shared, hc, run, props, closeOverlay, theme, home } from "herdr";
import { isClaude, promptEmpty, asksToExit, RESUME_LABEL, isSessionId, resumeLine, asleepTerminal } from "./resume.js";
import { tilde, describe, spaceBeside } from "./tabkit.js";
import { focusOn, bounded } from "./pure.js";
import { tokens } from "./ui.js";
import { dialog, statusNotes } from "./ui-dialog.js";
import { skeletonOf, row, stack } from "./kit.js";

export const CLEAR_MS = 3000;
export const RESEND_MS = 5000;
export const EXIT_MS = 45_000;
const TICK_MS = 600;
// What each scope stops, and how Wake brings it back.
const WHAT_SLEEPS = Object.freeze({
  project: "Every tab's agents exit and the tabs are put away. Wake brings them back, each agent on its conversation.",
  agent: "It exits and its pane stays as a shell. Wake starts it there again, on its conversation.",
  tab: "Its agents exit and the tab is put away. Wake brings it back, each agent on its conversation.",
});

export function sleepBlocker(recs) {
  const r = [...recs].map(([, x]) => x).find((x) => x?.status?.state === "working" || x?.status?.state === "blocked");
  return r ? `${r.labels?.["kanso.name"] || r.title || r.address} is ${r.status.state === "working" ? "working" : "waiting on you"}` : null;
}

// At its own shell's prompt: another shell in front (a script, say) counts as running.
export const atPrompt = (x) => Boolean(x) && (!x.foreground?.pid || x.foreground.pid === x.pid);
export const labelArgs = (terminal, session = "") => ["label", terminal, `${RESUME_LABEL}=${isSessionId(session) ? session : ""}`];

// The tabs settle; what was shown moves to a tab still awake, else to the project beside.
export function hideCommands(space, ids, all) {
  const settle = ids.map((id) => ["tab.settle", { id }]);
  const tabs = space?.tabs ?? [];
  if (!space?.active || !tabs.some((t) => t.active && ids.includes(t.id))) return settle;
  const tab = tabs.find((t) => !t.settled && !ids.includes(t.id));
  const other = tab ? null : spaceBeside(space.id, all);
  return [...settle, ...(tab ? [["tab.select", { id: tab.id }]] : other ? [["space.select", { id: other.id }]] : [])];
}

// reads: each terminal as read ({ terminal, resume, running }). An agent alone exits and its tab stays.
export function sleepPlan(scope, space, ids, reads, all) {
  return {
    exits: reads.filter((r) => r.resume),
    interrupts: scope === "agent" ? [] : reads.filter((r) => !r.resume && r.running).map((r) => r.terminal),
    after: scope === "agent" ? [] : hideCommands(space, ids, all),
  };
}

export function wakePlan(space, ids, terminal, ps, terms) {
  const tabs = (space?.tabs ?? []).filter((t) => ids.includes(t.id));
  const term = new Map(terms.map((k) => [k.address, k]));
  const asleep = (terminal ? [terminal] : ps.filter((p) => ids.includes(p.tab)).map((p) => p.terminal)).filter((t) => asleepTerminal(term.get(t)));
  return {
    commands: [...tabs.filter((t) => t.settled).map((t) => ["tab.unsettle", { id: t.id }]),
      ...(space && !space.active ? [["space.select", { id: space.id }]] : []), ...(tabs[0] ? [["tab.select", { id: tabs[0].id }]] : [])],
    sessions: asleep.map((t) => {
      const record = term.get(t);
      return {
        name: record.labels?.["kanso.name"] || record.title || t,
        resume: ["send", t, resumeLine(record.labels[RESUME_LABEL])],
        clear: labelArgs(t),
      };
    }),
  };
}

const wakeFailure = (rows) => `${rows.map((row) => row.note).join("; ")}.`;

const ending = (trace) => trace.filter((row) => row.step === "/exit" || row.step === "Enter");
const mayClear = (trace) => ending(trace).every((row) => row.outcome === "refused");
const unconfirmed = (name, detail) => `${name}'s exit was not confirmed: ${detail}`;
const unreadable = (name, step) => `${name}'s ${step} could not be read`;

async function exitOne(cx, agent) {
  const kept = await host(cx, labelArgs(agent.terminal, agent.resume));
  if (kept.outcome !== "ok") return said(agent.name, kept);
  const why = await leave(cx, agent);
  if (!why) return null;
  if (!mayClear(why.trace)) return unconfirmed(agent.name, why.detail);
  const back = await host(cx, labelArgs(agent.terminal));
  return back.outcome === "ok" ? why.text : `${why.text}; ${said(agent.name, back)}`;
}

async function wakeOne(cx, session) {
  const resumed = await host(cx, session.resume);
  if (resumed.outcome === "unanswered") return { note: `${session.name}'s send was not confirmed` };
  if (resumed.outcome === "refused") return { note: `${session.name} did not come back` };
  const cleared = await host(cx, session.clear);
  if (cleared.outcome === "ok") return null;
  if (cleared.outcome === "unanswered") return { note: `${session.name} is awake, but the label was not confirmed` };
  return { note: `${session.name} is awake, but still looks asleep` };
}

// One look at a Claude on its way out: what to press, or why it could not leave. st: { pid, name, at, sent, last }.
export function exitStep(st, x, screen, now) {
  if (atPrompt(x)) return { done: true };
  if (x && x.foreground?.pid !== st.pid) return { fail: `${st.name}'s terminal changed` };
  if (x == null || screen == null) return { unknown: true };
  if (st.sent != null && now - st.sent > EXIT_MS) return { fail: `${st.name} did not exit` };
  if (st.sent == null) {
    if (promptEmpty(screen)) return { act: "exit", st: { ...st, sent: now, last: now } };
    return now - st.at > CLEAR_MS ? { fail: `${st.name}'s prompt could not be cleared` } : { st };
  }
  if (asksToExit(screen)) return { act: "enter", st };
  if (promptEmpty(screen) && now - st.last > RESEND_MS) return { act: "exit", st: { ...st, last: now } };
  return { st };
}

const PRESS = { exit: (t) => ["send", t, "/exit"], enter: (t) => ["keys", t, "enter"] };
const CALL_MS = 30_000;
const stepOf = (args) => {
  if (args[0] === "keys" && args[2] === "enter") return "Enter";
  if (args[0] === "keys" && args[2] === "ctrl+c") return "Ctrl+C";
  if (args[0] === "send" && String(args[2] ?? "").startsWith("/exit")) return "/exit";
  if (args[0] === "file") return "read";
  return args[0];
};
const parsed = (r) => { try { return r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };
const host = async (cx, args) => {
  const step = stepOf(args);
  const result = await bounded(hc(args).then((value) => value, () => ({ rejected: true })), cx?.timer, CALL_MS);
  if (result?.late) return { outcome: "unanswered", step };
  if (result?.rejected || result?.code !== 0) return { outcome: "refused", step };
  return { outcome: "ok", step, result };
};
const detail = (call) => `${call.step} ${call.outcome === "unanswered" ? "did not answer" : "was refused"}`;
const said = (name, call) => `${name}'s ${detail(call)}`;
const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

// Claude's own record of a process: ~/.claude/sessions/<pid>.json, on the terminal's computer.
async function sessionOf(cx, terminal, pid) {
  const machine = machineOf(terminal), rel = [".claude", "sessions", `${pid}.json`];
  const args = machine ? ["file", "read", "--on", machine, rel.join("/")] : ["file", "read", paths.join(home(), ...rel)];
  return host(cx, args);
}

// Ends a Claude the way you would: its draft cleared, /exit, yes when it asks. Null once its shell is back, else why not.
async function leave(cx, { terminal, pid, name }) {
  const now = () => (typeof cx.now === "function" ? cx.now() : Date.now());
  const sent = async (trace, args) => {
    const call = await host(cx, args);
    return { call, trace: [...trace, { step: stepOf(args), outcome: call.outcome }] };
  };
  const stop = (trace, call, words) => ({ trace, text: `${name}: ${words ?? detail(call)}`, detail: words ?? detail(call) });
  const opened = await sent([], ["keys", terminal, "ctrl+c"]);
  if (opened.call.outcome !== "ok") return stop(opened.trace, opened.call);
  const look = async (st, trace) => {
    await cx.sleep(TICK_MS);
    const got = await host(cx, ["get", terminal, "--json"]);
    if (got.outcome !== "ok") return stop(trace, got);
    const record = parsed(got.result);
    if (record == null) return stop(trace, got, "get could not be read");
    const screen = await host(cx, ["read", terminal]);
    if (screen.outcome !== "ok") return stop(trace, screen);
    const step = exitStep(st, record, screen.result?.stdout ?? "", now());
    if (step.done) return null;
    if (step.unknown) return stop(trace, got, "get could not be read");
    if (step.fail) return { trace, text: step.fail, detail: step.fail };
    if (!step.act) return look(step.st ?? st, trace);
    if (step.act === "enter") {
      const again = await host(cx, ["get", terminal, "--json"]);
      if (again.outcome !== "ok") return stop(trace, again);
      const fresh = parsed(again.result);
      if (fresh == null) return stop(trace, again, "get could not be read");
      if (atPrompt(fresh)) return null;
    }
    const pressed = await sent(trace, PRESS[step.act](terminal));
    if (pressed.call.outcome !== "ok") return stop(pressed.trace, pressed.call);
    return look(step.st, pressed.trace);
  };
  return look({ pid, name, at: now(), sent: null, last: null }, opened.trace);
}

export default class Sleep extends View {
  init(_props, cx) {
    this.handle = focusOn(cx);
    const ask = props() ?? {};
    this.order = ask.sleep ?? null;
    this.space = spaces().find((s) => s.id === (ask.sleep ?? ask.wake)?.space) ?? spaces().find((s) => s.active) ?? null;
    this.reads = null;
    this.busy = null;
    this.error = null;
    if (ask.wake) this.wake(cx, ask.wake);
    else if (this.order) cx.spawn(async (cx) => { await this.read(cx); if (this.order.scope !== "project") await this.sleep(cx); });
  }

  tabIds() {
    const tabs = this.space?.tabs ?? [];
    if (this.order?.scope === "project") return tabs.map((t) => t.id);
    return [this.order?.tab ?? tabs.find((t) => t.active)?.id].filter(Boolean);
  }

  // Each terminal as it is now: a Claude with its conversation, anything else running, or a shell at rest.
  async read(cx) {
    const ids = this.tabIds(), only = this.order.scope === "agent" ? this.order.pane : null;
    const mine = panes().filter((p) => p.terminal && ids.includes(p.tab) && (!only || p.pane === only));
    const looked = await Promise.all(mine.map(async (p) => [p.terminal, await host(cx, ["get", p.terminal, "--json"])]));
    const recs = new Map(looked.map(([terminal, got]) => [terminal, got.outcome === "ok" ? parsed(got.result) : null]));
    const names = shared("kanso.names") ?? {};
    this.reads = await Promise.all(mine.map(async (p) => {
      const got = looked.find(([terminal]) => terminal === p.terminal)?.[1];
      const record = got?.outcome === "ok" ? parsed(got.result) : null;
      const x = record, fg = x?.foreground;
      const claude = Boolean(fg?.pid) && isClaude(fg.argv);
      const file = claude ? await sessionOf(cx, p.terminal, fg.pid) : null;
      const ses = file?.outcome === "ok" ? parsed(file.result) : null;
      const name = names[p.terminal] || x?.labels?.["kanso.name"] || ses?.name || x?.title || p.terminal;
      const problem = got?.outcome !== "ok" ? said(p.terminal, got)
        : record == null ? unreadable(p.terminal, "get")
        : claude && file?.outcome !== "ok" ? said(name, file)
        : claude && ses == null ? unreadable(name, "read")
        : claude && (!isSessionId(ses?.sessionId) || ses.pid !== fg.pid) ? `${name}'s conversation was not found, so it could not wake on it`
        : only && !claude ? "only a Claude agent can sleep on its own; this pane runs something else" : null;
      return { terminal: p.terminal, name, pid: fg?.pid ?? null, argv: fg?.argv ?? null, cwd: fg?.cwd ?? p.cwd ?? null,
        resume: claude && isSessionId(ses?.sessionId) ? ses.sessionId : null, running: Boolean(x) && !atPrompt(x), problem };
    }));
    const stop = sleepBlocker(recs) ?? this.reads.find((r) => r.problem)?.problem
      ?? (this.reads.some((r) => r.resume) ? null : "nothing here keeps a conversation to wake on");
    this.error = stop ? `It can't sleep now: ${stop}.` : null;
    cx.notify();
  }

  async sleep(cx) {
    if (this.busy || this.error || !this.reads) return;
    const plan = sleepPlan(this.order.scope, this.space, this.tabIds(), this.reads, spaces());
    this.busy = "Going to sleep";
    cx.notify();
    const say = (why) => {
      if (!why.length) return false;
      this.error = `It can't sleep: ${why.join("; ")}.`;
      return true;
    };
    try {
      const failed = (await Promise.all(plan.exits.map((r) => exitOne(cx, r)))).filter(Boolean);
      if (say(failed)) return;
      const stopped = (await Promise.all(plan.interrupts.map(async (t) => {
        const outcome = await host(cx, ["interrupt", t]);
        if (outcome.outcome === "ok") return null;
        const name = this.reads.find((r) => r.terminal === t)?.name ?? t;
        return outcome.outcome === "refused" ? `${name} could not be stopped` : said(name, outcome);
      }))).filter(Boolean);
      if (say(stopped)) return;
      for (const [cmd, args] of plan.after) run(cmd, args);
      closeOverlay(props()?.overlay);
    } finally {
      this.busy = null;
      cx.notify();
    }
  }

  // A whole project wakes only its tabs that hold an asleep terminal: a tab you settled yourself stays away.
  wake(cx, { tab, terminal }) {
    if (this.busy) return;
    const ps = panes(), terms = terminals(), term = new Map(terms.map((k) => [k.address, k]));
    const asleepTabs = new Set(ps.filter((p) => asleepTerminal(term.get(p.terminal))).map((p) => p.tab));
    const ids = tab ? [tab] : terminal ? [ps.find((p) => p.terminal === terminal)?.tab].filter(Boolean)
      : (this.space?.tabs ?? []).map((t) => t.id).filter((id) => asleepTabs.has(id));
    const plan = wakePlan(this.space, ids, terminal ?? null, ps, terms);
    if (!plan.sessions.length && !plan.commands.some(([cmd]) => cmd === "tab.unsettle")) { this.error = "That is no longer asleep."; return; }
    this.busy = "Waking";
    for (const [cmd, args] of plan.commands) run(cmd, args);
    cx.spawn(async (task) => {
      try {
        const failed = (await Promise.all(plan.sessions.map((session) => wakeOne(task, session)))).filter(Boolean);
        if (!failed.length) { closeOverlay(props()?.overlay); return; }
        this.error = wakeFailure(failed);
      } finally {
        this.busy = null;
        task.notify();
      }
    });
  }

  render() {
    const close = () => closeOverlay(props()?.overlay);
    const scope = this.order?.scope ?? null;
    const c = tokens(theme());
    const shell = { focusHandle: this.handle, held: Boolean(this.busy), onCancel: close };
    if (!scope) return dialog("kanso-sleep", c, { ...shell, title: "Wake", notes: statusNotes(this) });
    const project = this.space?.name ?? tilde(this.space?.folder);
    const list = (this.reads ?? []).filter((r) => r.resume || r.running);
    const others = [...new Set(list.filter((r) => !r.resume).map((r) => describe(r.argv)))];
    // What keeps its conversation, by name; anything else that will stop, dimmed, by what it runs, its folder giving way first.
    const line = (r) => (r.resume ? row({ name: r.name, meta: "keeps its conversation" }) : row({ name: describe(r.argv), detail: tilde(r.cwd), dimmed: true }));
    return dialog("kanso-sleep", c, {
      ...shell,
      title: scope === "project" ? `Sleep ${project}` : scope === "agent" ? "Sleep this agent" : "Sleep this tab",
      body: [
        this.reads === null && !this.error ? skeletonOf({ shape: "list row", count: 3 })("kanso-skeleton", c) : null,
        list.length ? stack({ variant: "dialog list" }, list.map(line))("sl", c) : null,
      ],
      notes: [{ text: WHAT_SLEEPS[scope] ?? WHAT_SLEEPS.tab }, ...(others.length ? [{ text: `${others.join(", ")} will stop now.` }] : []), ...statusNotes(this)],
      primary: scope === "project" ? "Sleep" : null,
      state: this.busy ? "loading" : !this.reads || this.error ? "disabled" : "default",
      onPrimary: (cx) => cx.spawn(async (cx) => this.sleep(cx)),
    });
  }
}
