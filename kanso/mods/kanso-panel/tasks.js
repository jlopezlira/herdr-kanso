import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, spaces, home, terminals, window } from "herdr";
import { shownName } from "./marks.js";
import { G, T, PR, tokens } from "./ui.js";
import { row } from "./ui-row.js";
import { section } from "./ui-section.js";
import { stateBlock } from "./ui-state.js";
import { emptyState, skeletonOf } from "./kit.js";
import { scrollPage, pageHeader } from "./ui-page.js";
import { kdbOn, seenAddress } from "./kdb.js";
import { runTodo, todoOn, tellAgents, toldWords } from "./todo-switch.js";
import { tryOrAsync } from "./pure.js";
import { TODO_MS, FOLLOW_MS, DONE, PROJECTS, TODOS, HELD_TODOS, placeOf, withSpaces, ageOf, plansOf, stepState } from "./todo.js";


export class Tasks {
  constructor(db) { this.db = db; }

  saveState() { return { folds: this.folds }; }

  restoreState(state) {
    if (!state || typeof state !== "object") return false;
    this.folds = state.folds && typeof state.folds === "object" ? state.folds : {};
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
    this.front = this.frontPlace();
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

  frontProject() {
    const key = this.frontPlace();
    const holds = (p) => key === placeOf(p.machine, p.folder) || key.startsWith(`${placeOf(p.machine, p.folder)}/`);
    const saved = (this.projects ?? []).filter((p) => !p.auto && holds(p)).toSorted((a, b) => b.folder.length - a.folder.length)[0];
    return (saved ?? (this.projects ?? []).find((p) => placeOf(p.machine, p.folder) === key))?.id ?? null;
  }

  placeOfProject(id) {
    const p = (this.projects ?? []).find((x) => x.id === id);
    return p ? placeOf(p.machine, p.folder) : null;
  }

  scripted(machine) { return Boolean(machine) || window()?.platform !== "windows"; }

  follow(cx) {
    const front = this.frontPlace();
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

  async heldOn(machine, projects) {
    const rows = await tryOrAsync(async () => (await this.dbOn(machine)).read(HELD_TODOS));
    if (!rows) return this.todos.filter((t) => t.on === machine);
    return rows.flatMap(({ folder, ...t }) => {
      const mine = projects.find((p) => p.machine === machine && placeOf(machine, p.folder) === placeOf(machine, folder));
      return mine ? [{ ...t, home: t.project, project: mine.id, on: machine }] : [];
    });
  }

  async read() {
    const [projects, local] = await Promise.all([tryOrAsync(() => this.db.read(PROJECTS)), tryOrAsync(() => this.db.read(TODOS))]);
    const nextProjects = withSpaces(projects ?? this.projects ?? [], spaces(), home());
    const machines = [...new Set(nextProjects.map((p) => p.machine).filter(Boolean))];
    const held = await Promise.all(machines.map((m) => this.heldOn(m, nextProjects)));
    const nextTodos = [...(local ? local.map((t) => ({ ...t, home: t.project, on: "" })) : this.todos.filter((t) => !t.on)), ...held.flat()];
    if (this.projects && JSON.stringify([nextProjects, nextTodos]) === JSON.stringify([this.projects, this.todos])) return false;
    this.projects = withSpaces(nextProjects.filter((p) => !p.auto), spaces(), home());
    this.todos = nextTodos;
    return true;
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try { if (await this.read()) cx.notify(); } finally { this.loading = false; }
    });
  }

  agentName(by, on) {
    if (!by) return "Steps without an agent";
    const address = seenAddress(by, on);
    return terminals().some((k) => k.address === address) ? shownName(address) : "An agent that has ended";
  }

  stepRow(step, c, now) {
    const state = stepState(step);
    return row(`tasks-step-${step.id}`, c, {
      name: step.text, second: step.detail || null, wrap: !step.detail,
      icon: state === "done" ? "check" : state === "next" ? "circle" : null, mark: state === "doing" ? "working" : "none",
      dimmed: state === "done", current: state === "doing",
      meta: ageOf(step.done_at ?? step.started_at ?? step.created, now),
    });
  }

  planBlock(plan, c, now) {
    const key = `${plan.on}:${plan.by ?? ""}`;
    const folded = this.folded(key);
    const steps = plan.steps.filter((s) => stepState(s) !== "done");
    const done = plan.steps.filter((s) => stepState(s) === "done");
    return v_flex().w_full().gap(G.sm)
      .child(section(c, this.agentName(plan.by, plan.on), `${done.length} of ${plan.steps.length} done`))
      .children(steps.map((s) => this.stepRow(s, c, now)))
      .children(done.length ? [row(`tasks-done-${key}`, c, { name: DONE, level: 0, open: !folded, chip: String(done.length), onClick: (cx) => this.fold(key, cx) })] : [])
      .children(folded ? [] : done.map((s) => this.stepRow(s, c, now)));
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
    const front = this.frontProject();
    const plans = plansOf(this.todos, front);
    const body = !this.projects ? this.skeleton(c)
      : v_flex().w_full().gap(G.xl).children([
        ...plans.map((plan) => this.planBlock(plan, c, now)),
        this.emptyBlock(c, plans.length > 0),
      ]);
    return scrollPage("kanso-tasks", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"), []))
      .child(body));
  }
}
