import { paths } from "./platform-paths.js";
// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Props: sleep { scope: "agent" | "tab" | "project", space, tab, pane }, wake { space, tab, terminal }.
// Asleep is Herdr's own state: each Claude terminal keeps its conversation id as a label, and its tab is settled.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, shared, hc, run, props, closeOverlay, theme, home } from "herdr";
import { isClaude, promptEmpty, asksToExit, RESUME_LABEL, resumeLine, asleepTerminal } from "./resume.js";
import { tilde, describe, spaceBeside } from "./tabkit.js";
import { skeleton, breathe } from "./ui.js";

export const CLEAR_MS = 3000;
export const RESEND_MS = 5000;
export const EXIT_MS = 45_000;
const TICK_MS = 600;

export function sleepBlocker(recs) {
  const r = [...recs].map(([, x]) => x).find((x) => x?.status?.state === "working" || x?.status?.state === "blocked");
  return r ? `${r.labels?.["kanso.name"] || r.title || r.address} is ${r.status.state === "working" ? "working" : "waiting on you"}` : null;
}

// At its own shell's prompt: another shell in front (a script, say) counts as running.
export const atPrompt = (x) => Boolean(x) && (!x.foreground?.pid || x.foreground.pid === x.pid);
export const labelArgs = (terminal, session = "") => ["label", terminal, `${RESUME_LABEL}=${session}`];

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

// Each settled tab comes back and is shown; each asleep terminal in it is cleared first (the claim), then resumed.
export function wakePlan(space, ids, terminal, ps, terms) {
  const tabs = (space?.tabs ?? []).filter((t) => ids.includes(t.id));
  const term = new Map(terms.map((k) => [k.address, k]));
  const asleep = (terminal ? [terminal] : ps.filter((p) => ids.includes(p.tab)).map((p) => p.terminal)).filter((t) => asleepTerminal(term.get(t)));
  return {
    commands: [...tabs.filter((t) => t.settled).map((t) => ["tab.unsettle", { id: t.id }]),
      ...(space && !space.active ? [["space.select", { id: space.id }]] : []), ...(tabs[0] ? [["tab.select", { id: tabs[0].id }]] : [])],
    hc: asleep.flatMap((t) => [labelArgs(t), ["send", t, resumeLine(term.get(t).labels[RESUME_LABEL])]]),
  };
}

// One look at a Claude on its way out: what to press, or why it could not leave. st: { pid, name, at, sent, last }.
export function exitStep(st, x, screen, now) {
  if (atPrompt(x)) return { done: true };
  if (x && x.foreground?.pid !== st.pid) return { fail: `${st.name}'s terminal changed` };
  if (st.sent == null) {
    if (promptEmpty(screen)) return { act: "exit", st: { ...st, sent: now, last: now } };
    return now - st.at > CLEAR_MS ? { fail: `${st.name}'s prompt could not be cleared` } : { st };
  }
  if (asksToExit(screen)) return { act: "enter", st };
  if (now - st.sent > EXIT_MS) return { fail: `${st.name} did not exit` };
  if (promptEmpty(screen) && now - st.last > RESEND_MS) return { act: "exit", st: { ...st, last: now } };
  return { st };
}

const PRESS = { exit: (t) => ["send", t, "/exit"], enter: (t) => ["keys", t, "enter"] };
const ok = async (args) => (await hc(args).catch(() => null))?.code === 0;
const parsed = (r) => { try { return r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };
const json = async (args) => parsed(await hc(args).catch(() => null));
const screenOf = async (t) => { const r = await hc(["read", t]).catch(() => null); return r?.code === 0 ? r.stdout : null; };
const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

// Claude's own record of a process: ~/.claude/sessions/<pid>.json, on the terminal's computer.
function sessionOf(terminal, pid) {
  const machine = machineOf(terminal), rel = [".claude", "sessions", `${pid}.json`];
  return json(machine ? ["file", "read", "--on", machine, rel.join("/")] : ["file", "read", paths.join(home(), ...rel)]);
}

// Ends a Claude the way you would: its draft cleared, /exit, yes when it asks. Null once its shell is back, else why not.
async function leave(cx, { terminal, pid, name }) {
  if (!(await ok(["keys", terminal, "ctrl+c"]))) return `${name} could not be reached`;
  const look = async (st) => {
    await cx.sleep(TICK_MS);
    const step = exitStep(st, await json(["get", terminal, "--json"]), await screenOf(terminal), Date.now());
    if (step.done) return null;
    if (step.fail) return step.fail;
    if (step.act) await hc(PRESS[step.act](terminal)).catch(() => null);
    return look(step.st);
  };
  return look({ pid, name, at: Date.now(), sent: null, last: null });
}

export default class Sleep extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
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
    const recs = new Map(await Promise.all(mine.map(async (p) => [p.terminal, await json(["get", p.terminal, "--json"])])));
    const names = shared("kanso.names") ?? {};
    this.reads = await Promise.all(mine.map(async (p) => {
      const x = recs.get(p.terminal), fg = x?.foreground;
      const claude = Boolean(fg?.pid) && isClaude(fg.argv);
      const ses = claude ? await sessionOf(p.terminal, fg.pid) : null;
      const name = names[p.terminal] || x?.labels?.["kanso.name"] || ses?.name || x?.title || p.terminal;
      const problem = !x ? `${p.terminal} could not be read`
        : claude && (!ses?.sessionId || ses.pid !== fg.pid) ? `${name}'s conversation was not found, so it could not wake on it`
        : only && !claude ? "only a Claude agent can sleep on its own; this pane runs something else" : null;
      return { terminal: p.terminal, name, pid: fg?.pid ?? null, argv: fg?.argv ?? null, cwd: fg?.cwd ?? p.cwd ?? null,
        resume: claude ? ses?.sessionId ?? null : null, running: Boolean(x) && !atPrompt(x), problem };
    }));
    const stop = sleepBlocker(recs) ?? this.reads.find((r) => r.problem)?.problem
      ?? (this.reads.some((r) => r.resume) ? null : "nothing here keeps a conversation to wake on");
    this.error = stop ? `It can't sleep now: ${stop}.` : null;
    cx.notify();
  }

  // A failed exit takes its label back and nothing settles: the dialog says why.
  async sleep(cx) {
    if (this.busy || this.error || !this.reads) return;
    const plan = sleepPlan(this.order.scope, this.space, this.tabIds(), this.reads, spaces());
    this.busy = "Going to sleep"; cx.notify();
    const failed = (await Promise.all(plan.exits.map(async (r) => {
      if (!(await ok(labelArgs(r.terminal, r.resume)))) return `${r.name}'s conversation could not be kept`;
      const why = await leave(cx, r);
      if (why) await hc(labelArgs(r.terminal)).catch(() => null);
      return why;
    }))).filter(Boolean);
    this.busy = null;
    if (failed.length) { this.error = `It can't sleep: ${failed.join("; ")}.`; cx.notify(); return; }
    await Promise.all(plan.interrupts.map((t) => hc(["interrupt", t]).catch(() => null)));
    for (const [cmd, args] of plan.after) run(cmd, args);
    closeOverlay(props()?.overlay);
  }

  // A whole project wakes only its tabs that hold an asleep terminal: a tab you settled yourself stays away.
  wake(cx, { tab, terminal }) {
    const ps = panes(), terms = terminals(), term = new Map(terms.map((k) => [k.address, k]));
    const asleepTabs = new Set(ps.filter((p) => asleepTerminal(term.get(p.terminal))).map((p) => p.tab));
    const ids = tab ? [tab] : terminal ? [ps.find((p) => p.terminal === terminal)?.tab].filter(Boolean)
      : (this.space?.tabs ?? []).map((t) => t.id).filter((id) => asleepTabs.has(id));
    const plan = wakePlan(this.space, ids, terminal ?? null, ps, terms);
    if (!plan.hc.length && !plan.commands.some(([cmd]) => cmd === "tab.unsettle")) { this.error = "That is no longer asleep."; return; }
    for (const [cmd, args] of plan.commands) run(cmd, args);
    this.busy = "Waking";
    cx.spawn(async () => {
      for (const args of plan.hc) await hc(args).catch(() => null);
      closeOverlay(props()?.overlay);
    });
  }

  sleepBones(t) {
    const { line } = skeleton({ border: t.border });
    return breathe(v_flex().id("kanso-skeleton").w_full().pt(14).gap(10))
      .children([0, 1, 2].map((i) => h_flex().w_full().gap(10).items_center().child(line([140, 110, 160][i], 12)).child(div().flex_1()).child(line(80, 11))));
  }

  render() {
    const t = theme();
    const close = () => closeOverlay(props()?.overlay);
    const scope = this.order?.scope ?? null;
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .child(text);
    const note = (text, tone) => div().pt(10).text_size(11.5).line_height(1.45).text_color(tone ?? t.dim).child(text);
    const shell = v_flex().id("kanso-sleep").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key !== "escape" || this.busy) return; cx.stop_propagation(); close(); });
    if (!scope) {
      return shell.child(div().text_size(15).font_semibold().child("Wake"))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)));
    }
    const project = this.space?.name ?? tilde(this.space?.folder);
    const list = (this.reads ?? []).filter((r) => r.resume || r.running);
    const others = [...new Set(list.filter((r) => !r.resume).map((r) => describe(r.argv)))];
    const line = (r, i) => h_flex().id(`sl-${i}`).w_full().gap(10).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(r.resume ? t.foreground : t.muted).child(r.resume ? r.name : describe(r.argv)))
      .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(r.resume ? "keeps its conversation" : tilde(r.cwd)));
    return shell
      .child(v_flex().gap(4)
        .child(h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().child(scope === "project" ? `Sleep ${project}` : scope === "agent" ? "Sleep this agent" : "Sleep this tab"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child(scope === "project" ? "Every tab's agents exit and the tabs are put away. Wake brings them back, each agent on its conversation."
          : scope === "agent" ? "It exits and its pane stays as a shell. Wake starts it there again, on its conversation."
          : "Its agents exit and the tab is put away. Wake brings it back, each agent on its conversation.")))
      .when(this.reads === null && !this.error, (el) => el.child(this.sleepBones(t)))
      .child(v_flex().pt(14).gap(4).children(list.map(line)))
      .when(others.length > 0, (el) => el.child(note(`${others.join(", ")} will stop now.`)))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("sl-back", "Cancel", false, !this.busy, () => close()))
        .when(scope === "project", (el) => el.child(button("sl-go", "Sleep", true, Boolean(this.reads) && !this.busy && !this.error, (cx) => cx.spawn(async (cx) => this.sleep(cx))))));
  }
}
