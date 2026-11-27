import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, spaces, home, terminals, agents, window, run } from "herdr";
import { shownName } from "./marks.js";
import { G, T, PR, tokens } from "./ui.js";
import { row } from "./ui-row.js";
import { section } from "./ui-section.js";
import { stateBlock } from "./ui-state.js";
import { emptyState, skeletonOf } from "./kit.js";
import { scrollPage, pageHeader } from "./ui-page.js";
import { kdbOn, seenAddress, q } from "./kdb.js";
import { runTodo, todoOn, tellAgents, toldWords } from "./todo-switch.js";
import { tryOrAsync } from "./pure.js";
import { TODO_MS, FOLLOW_MS, SWITCH_MS, DONE, PROJECTS, TODOS, HELD_TODOS, placeOf, withSpaces, ageOf, plansOf, stepState } from "./todo.js";


const NEXT_SHOWN = 3;
const seconds = (ms) => Math.floor(ms / 1000);

export class Tasks {
  constructor(db) { this.db = db; }

  saveState() { return { folds: this.folds, more: this.more, opened: this.opened, ended: this.ended }; }
  restoreState(state) {
    if (!state || typeof state !== "object") return false;
    const kept = (field) => (state[field] && typeof state[field] === "object" ? state[field] : {});
    this.folds = kept("folds");
    this.more = kept("more");
    this.opened = kept("opened");
    this.ended = kept("ended");
    return true;
  }

  init(cx) {
    this.folds ??= {};
    this.projects = null;
    this.todos = [];
    this.timer = cx.timer;
    this.remote = {};
    this.agentsOn = {};
    this.asked = {};
    this.turns = {};
    this.checked = {};
    this.unread = {};
    this.more ??= {};
    this.opened ??= {};
    this.ended ??= {};
    this.named = new Set();
    this.cleared = null;
    this.front = this.frontKey();
    this.frontOn = this.frontMachine();
    this.switchOn(this.frontOn, cx);
    this.load(cx);
    cx.timer.every(TODO_MS, (next) => this.load(next));
    cx.timer.every(FOLLOW_MS, (next) => this.follow(next));
  }

  frontPlace() {
    const active = spaces().find((s) => s.active);
    return placeOf(active?.machine, active?.folder || home());
  }

  frontMachine() { return spaces().find((s) => s.active)?.machine ?? ""; }

  frontKey() { return `${spaces().find((s) => s.active)?.id ?? ""}|${this.frontPlace()}`; }

  spaceAgents() {
    const id = spaces().find((s) => s.active)?.id;
    const top = new Set(agents().filter((a) => id && a.space === id).map((a) => a.address));
    const under = (seen) => {
      const next = new Set([...seen, ...terminals().filter((k) => seen.has(k.parent)).map((k) => k.address)]);
      return next.size === seen.size ? seen : under(next);
    };
    return under(top);
  }

  viewedPlace() {
    const active = spaces().find((s) => s.active);
    if (active?.folder && (active.machine || placeOf(null, active.folder) !== placeOf(null, home()))) return this.frontProject();
    const mine = this.spaceAgents();
    const touched = (t) => Math.max(t.created ?? 0, t.started_at ?? 0, t.done_at ?? 0);
    return this.todos.filter((t) => t.by && mine.has(seenAddress(t.by, t.on))).toSorted((a, b) => touched(b) - touched(a))[0]?.place ?? null;
  }

  shownSteps(place = this.viewedPlace()) {
    return place ? this.todos.filter((t) => t.place === place) : [];
  }

  frontProject() {
    const key = this.frontPlace();
    const holds = (place) => key === place || key.startsWith(`${place}/`);
    const places = [...(this.projects ?? []).filter((p) => !p.auto).map((p) => placeOf(p.machine, p.folder)), ...this.todos.map((t) => t.place)];
    return places.filter(holds).toSorted((a, b) => b.length - a.length)[0] ?? key;
  }

  scripted(machine) { return machine ? this.agentsOn[machine] !== "windows" : window()?.platform !== "windows"; }

  follow(cx) {
    const front = this.frontKey();
    if (front === this.front) return;
    this.front = front;
    if (this.projects) this.projects = withSpaces(this.projects.filter((p) => !p.auto), spaces(), home());
    const machine = this.frontMachine();
    if (machine !== this.frontOn) this.switchOn(machine, cx, true);
    this.frontOn = machine;
    cx.notify();
  }

  switchOn(machine, cx, again = false) {
    if (!this.scripted(machine) || this.turnOf(machine).busy || (!again && this.agentsOn[machine] != null)) return;
    const asked = (this.asked[machine] ?? 0) + 1;
    this.asked = { ...this.asked, [machine]: asked };
    this.checked = { ...this.checked, [machine]: Date.now() };
    cx.spawn(async (cx) => {
      const on = await todoOn(machine || null);
      if (this.asked[machine] !== asked) return;
      this.agentsOn = { ...this.agentsOn, [machine]: on };
      cx.notify();
    });
  }

  turnOf(machine) { return this.turns[machine] ?? {}; }

  setTurn(machine, turn) { this.turns = { ...this.turns, [machine]: turn }; }

  dbOn(machine) {
    if (!machine) return Promise.resolve(this.db);
    if (!this.remote[machine]) {
      const made = kdbOn(this.timer, machine);
      made.catch(() => { this.remote = Object.fromEntries(Object.entries(this.remote).filter(([m]) => m !== machine)); });
      this.remote = { ...this.remote, [machine]: made };
    }
    return this.remote[machine];
  }

  async heldOn(machine) {
    const rows = await tryOrAsync(async () => (await this.dbOn(machine)).read(HELD_TODOS));
    return rows ? rows.map(({ folder, ...t }) => ({ ...t, home: t.project, place: placeOf(machine, folder), on: machine })) : null;
  }

  async read() {
    const [projects, local] = await Promise.all([tryOrAsync(() => this.db.read(PROJECTS)), tryOrAsync(() => this.db.read(TODOS))]);
    const nextProjects = withSpaces(projects ?? this.projects ?? [], spaces(), home());
    const machines = [...new Set(nextProjects.map((p) => p.machine).filter(Boolean))];
    const held = await Promise.all(machines.map((m) => this.heldOn(m)));
    const unread = Object.fromEntries(machines.map((m, i) => [m, !held[i]]));
    const kept = machines.flatMap((m, i) => held[i] ?? this.todos.filter((t) => t.on === m));
    const nextTodos = [...(local ? local.map(({ folder, machine, ...t }) => ({ ...t, home: t.project, place: placeOf(machine, folder), on: "" })) : this.todos.filter((t) => !t.on)), ...kept];
    if (this.projects && JSON.stringify([nextProjects, nextTodos, unread]) === JSON.stringify([this.projects, this.todos, this.unread])) return false;
    this.projects = withSpaces(nextProjects.filter((p) => !p.auto), spaces(), home());
    this.todos = nextTodos;
    this.unread = unread;
    return true;
  }

  load(cx) {
    const machine = this.frontMachine();
    if (Date.now() - (this.checked[machine] ?? 0) >= SWITCH_MS) this.switchOn(machine, cx, true);
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (await this.read()) cx.notify();
        await this.keepNames();
      } finally { this.loading = false; }
    });
  }

  async keepNames() {
    const live = plansOf(this.withAgents(this.todos.filter((t) => t.by))).filter((plan) => !plan.gone)
      .map((plan) => ({ plan, name: this.agentName(plan), steps: plan.steps }))
      .map((it) => ({ ...it, stale: it.steps.filter((s) => s.by_name !== it.name) }))
      .filter(({ stale, plan, name }) => stale.length && !this.named.has(`${plan.on}:${name}:${stale.map((s) => s.id).join(",")}`));
    await Promise.all(live.map(async ({ plan, name, stale }) => {
      const key = `${plan.on}:${name}:${stale.map((s) => s.id).join(",")}`;
      this.named.add(key);
      const sql = `UPDATE todos SET by_name=${q(name)} WHERE id IN (${stale.map((s) => q(s.id)).join(",")}) AND by=${q(plan.by)};`;
      try { await (await this.dbOn(plan.on || null)).sql(sql); } catch { this.named.delete(key); }
    }));
  }

  liveAt(by, on) {
    const address = seenAddress(by, on);
    return terminals().find((k) => k.address === address) ?? null;
  }

  withAgents(todos) {
    return todos.map((t) => {
      const k = t.by ? this.liveAt(t.by, t.on) : null;
      return { ...t, gone: Boolean(t.by) && (!k || seconds(t.created) < seconds(k.created_ms ?? 0)) };
    });
  }

  agentName(plan) {
    if (!plan.by) return "Steps without an agent";
    if (plan.gone) return plan.steps.find((s) => s.by_name)?.by_name ?? "";
    const address = seenAddress(plan.by, plan.on), k = this.liveAt(plan.by, plan.on);
    return shownName(address, { terminal: address, program: k?.program, title: k?.title });
  }

  goTo(plan) {
    run("pane.focus", { terminal: seenAddress(plan.by, plan.on) });
  }

  stepRow(step, c, now, gone, { lead = false, open = false } = {}) {
    const state = stepState(step);
    const working = state === "doing" && !gone;
    const told = lead || open;
    return row(`tasks-step-${step.id}`, c, {
      name: step.text, second: told ? step.detail || null : null, wrap: told, wrapSecond: told,
      icon: state === "done" ? "check" : working ? null : "circle", mark: working ? "working" : "none",
      dimmed: state === "done" || (!lead && !open && state === "next"), current: working,
      meta: ageOf(step.done_at ?? step.started_at ?? step.created, now),
      onClick: lead || !step.detail ? null : (cx) => this.toggle("opened", step.id, cx),
    });
  }

  toggle(field, key, cx) {
    this[field] = { ...this[field], [key]: !this[field][key] };
    cx.notify();
  }

  planBlock(plan, c, now, place) {
    const key = `${plan.on}:${plan.by ?? ""}:${plan.gone ? "gone" : ""}`;
    const kept = `${place}|${key}`;
    const done = plan.steps.filter((s) => stepState(s) === "done");
    const open = plan.steps.filter((s) => stepState(s) !== "done");
    const started = open.filter((s) => stepState(s) === "doing").toSorted((a, b) => b.started_at - a.started_at);
    const lead = started[0] ?? open[0];
    const rest = open.filter((s) => s !== lead);
    const more = Boolean(this.more[kept]);
    const shown = more ? rest : rest.slice(0, NEXT_SHOWN);
    const folded = this.folded(kept);
    const progress = `${done.length} of ${plan.steps.length} done`;
    const opened = (s) => ({ open: Boolean(this.opened[s.id]) });
    const extra = rest.length > NEXT_SHOWN
      ? [row(`tasks-more-${key}`, c, { name: more ? "Fewer steps" : `${rest.length - shown.length} more ${rest.length - shown.length === 1 ? "step" : "steps"}`, level: 0, open: more, onClick: (cx) => this.toggle("more", kept, cx) })]
      : [];
    return v_flex().w_full().gap(G.sm)
      .child(this.agentHeader(plan, c, progress))
      .children(lead ? [this.stepRow(lead, c, now, plan.gone, { lead: true })] : [])
      .children(shown.map((s) => this.stepRow(s, c, now, plan.gone, opened(s))))
      .children(extra)
      .children(done.length ? [row(`tasks-done-${key}`, c, { name: DONE, level: 0, open: !folded, chip: String(done.length), onClick: (cx) => this.fold(kept, cx) })] : [])
      .children(folded ? [] : done.map((s) => this.stepRow(s, c, now, plan.gone, opened(s))));
  }

  agentHeader(plan, c, progress) {
    if (!plan.by) return section(c, this.agentName(plan), progress);
    return row(`tasks-agent-${plan.on}:${plan.by}`, c, {
      name: this.agentName(plan), group: true, meta: progress,
      action: { label: "Go to agent", kind: "quiet", onClick: () => this.goTo(plan) },
    });
  }

  subjectOf(plan) { return plan.steps[0]?.text ?? ""; }

  endedPlan(plan, c, now, place) {
    const kept = `${place}|${plan.on}:${plan.by ?? ""}:gone:${plan.steps[0]?.id ?? ""}`;
    const open = Boolean(this.ended[kept]);
    const who = this.agentName(plan), what = this.subjectOf(plan);
    const done = plan.steps.filter((s) => stepState(s) === "done").length;
    const last = Math.max(...plan.steps.map((s) => s.done_at ?? s.started_at ?? s.created));
    return v_flex().w_full().gap(G.xs)
      .child(row(`tasks-ended-${kept}`, c, {
        name: who || what, second: who ? what : null, level: 0, open, meta: ageOf(last, now),
        chip: done === plan.steps.length ? "Done" : `Stopped at ${done} of ${plan.steps.length}`,
        onClick: (cx) => this.toggle("ended", kept, cx),
      }))
      .children(open ? plan.steps.map((s) => this.stepRow(s, c, now, true, { open: Boolean(this.opened[s.id]) })) : []);
  }

  earlierBlock(ended, c, now, place) {
    const key = `${place}|earlier`;
    const open = Boolean(this.ended[key]);
    const cleared = this.cleared?.place === place ? this.cleared : null;
    if (!ended.length && !cleared) return div();
    return v_flex().w_full().gap(G.sm)
      .children(ended.length ? [row("tasks-earlier", c, {
        name: "Earlier", level: 0, open, chip: String(ended.length),
        action: open ? { label: "Clear", kind: "quiet", onClick: (cx) => this.clear(ended, place, cx) } : null,
        onClick: (cx) => this.toggle("ended", key, cx),
      })] : [])
      .children(open ? ended.map((plan) => this.endedPlan(plan, c, now, place)) : [])
      .children(cleared ? [row("tasks-cleared", c, {
        name: `Cleared ${cleared.plans} earlier ${cleared.plans === 1 ? "plan" : "plans"}`, icon: "check", dimmed: true,
        action: { label: "Undo", kind: "quiet", onClick: (cx) => this.undoClear(cx) },
      })] : []);
  }

  byMachine(steps, each) {
    return Promise.all([...new Set(steps.map((s) => s.on))].map(async (on) => {
      const mine = steps.filter((s) => s.on === on);
      await tryOrAsync(async () => (await this.dbOn(on || null)).sql(each(mine)));
    }));
  }

  queued(cx, work) {
    this.writing = (this.writing ?? Promise.resolve()).then(work).catch(() => null);
    cx.spawn(async (cx) => {
      await this.writing;
      if (await this.read()) cx.notify();
    });
  }

  clear(ended, place, cx) {
    const steps = ended.flatMap((plan) => plan.steps);
    this.cleared = { place, plans: ended.length, steps };
    this.todos = this.todos.filter((t) => !steps.some((s) => s.id === t.id && s.on === t.on));
    cx.notify();
    this.queued(cx, () => this.byMachine(steps, (mine) => `DELETE FROM todos WHERE id IN (${mine.map((s) => q(s.id)).join(",")});`));
  }

  undoClear(cx) {
    const { steps } = this.cleared ?? { steps: [] };
    this.cleared = null;
    cx.notify();
    const cols = ["id", "project", "text", "created", "done_at", "by", "detail", "started_at", "by_name"];
    const value = (v) => (typeof v === "number" ? String(Math.round(v)) : q(v ?? null));
    this.queued(cx, () => this.byMachine(steps, (mine) => mine.map((s) => `INSERT OR IGNORE INTO todos(${cols.join(",")}) VALUES(${cols.map((k) => value(s[k])).join(",")});`).join("\n")));
  }

  folded(project) { return this.folds[project] ?? true; }

  fold(project, cx) {
    this.folds = { ...this.folds, [project]: !this.folded(project) };
    cx.notify();
  }

  turnOn(cx) {
    const machine = this.frontMachine();
    if (this.turnOf(machine).busy) return;
    this.setTurn(machine, { busy: true });
    this.asked = { ...this.asked, [machine]: (this.asked[machine] ?? 0) + 1 };
    cx.notify();
    cx.spawn(async (cx) => {
      const fresh = await runTodo("steps", machine || null);
      if (fresh.code !== 0 && /usage: kanso-todo/.test(fresh.stderr ?? "")) {
        this.setTurn(machine, { text: `${machine || "This computer"} has an older kansō: update it there, then turn this on again.`, failed: true });
        cx.notify();
        return;
      }
      const r = await runTodo("install", machine || null);
      const on = await todoOn(machine || null);
      this.agentsOn = { ...this.agentsOn, [machine]: on };
      const told = await tellAgents(cx.timer, machine || null);
      const warned = r.code === 0 ? "" : String(r.stderr || r.stdout || "It could not be turned on").trim().split("\n").at(-1);
      this.setTurn(machine, { text: [warned, toldWords(told, on === true, machine || null)].filter(Boolean).join(" "), failed: Boolean(warned) || told.failed });
      cx.notify();
    });
  }

  emptyBlock(c, listed) {
    const machine = this.frontMachine(), turn = this.turnOf(machine), agentsOn = this.agentsOn[machine];
    if (!this.scripted(machine)) return listed ? div() : emptyState({ text: "Each agent's plan for this project shows here" })("tasks-none", c);
    const action = turn.busy ? "" : agentsOn ? "Tell running agents" : "Turn on for my agents";
    const text = agentsOn ? "No agent has a plan for this project yet" : "Turn this on and Claude Code, Codex and Pi show here what they will do, step by step";
    const control = listed
      ? (action ? row("tasks-switch", c, { name: action, icon: agentsOn ? "send" : "power", onClick: (cx) => this.turnOn(cx) }) : div())
      : emptyState({ text, action })("tasks-none", c, { onClick: (cx) => this.turnOn(cx) });
    return v_flex().w_full().gap(G.sm)
      .child(control)
      .children(turn.text ? [turn.failed ? stateBlock("tasks-turned", c, { text: turn.text }) : div().text_size(T.body).text_color(c.dim).text_center().child(turn.text)] : []);
  }

  skeleton(c) { return skeletonOf({ shape: "two lines", count: 4 })("kanso-skeleton", c); }

  render() {
    const c = tokens(theme()), now = Date.now();
    const place = this.viewedPlace();
    const plans = plansOf(this.withAgents(this.shownSteps(place)));
    const machine = this.frontMachine(), unread = Boolean(machine) && this.unread[machine];
    const warned = unread ? [stateBlock("tasks-unread", c, { text: plans.length ? `Could not reach ${machine}; these steps may be out of date` : `Could not reach ${machine} to read its plans` })] : [];
    const body = !this.projects ? this.skeleton(c)
      : v_flex().w_full().gap(G.xl).children([
        ...warned,
        ...plans.filter((plan) => !plan.gone).map((plan) => this.planBlock(plan, c, now, place)),
        this.earlierBlock(plans.filter((plan) => plan.gone), c, now, place),
        ...(unread && !plans.length ? [] : [this.emptyBlock(c, plans.length > 0)]),
      ]);
    return scrollPage("kanso-tasks", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"), []))
      .child(body));
  }
}
