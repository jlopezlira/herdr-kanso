import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, spaces, home, terminals, agents, window } from "herdr";
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
import { TODO_MS, FOLLOW_MS, SWITCH_MS, DONE, PROJECTS, TODOS, HELD_TODOS, placeOf, withSpaces, ageOf, plansOf, stepState } from "./todo.js";


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
    this.checked = {};
    this.unread = {};
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
    const under = (seen) => new Set([...seen, ...terminals().filter((k) => seen.has(k.parent)).map((k) => k.address)]);
    return under(under(top));
  }

  shownSteps() {
    const active = spaces().find((s) => s.active);
    const foldered = Boolean(active?.folder) && (Boolean(active.machine) || placeOf(null, active.folder) !== placeOf(null, home()));
    const mine = this.spaceAgents();
    const ours = (t) => Boolean(t.by) && mine.has(seenAddress(t.by, t.on));
    const places = new Set([...this.todos.filter(ours).map((t) => t.place), ...(foldered ? [this.frontProject()] : [])]);
    return this.todos.filter((t) => ours(t) || places.has(t.place));
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
      try { if (await this.read()) cx.notify(); } finally { this.loading = false; }
    });
  }

  liveAt(by, on) {
    const address = seenAddress(by, on);
    return terminals().find((k) => k.address === address) ?? null;
  }

  withAgents(todos) {
    return todos.map((t) => {
      const k = t.by ? this.liveAt(t.by, t.on) : null;
      return { ...t, gone: Boolean(t.by) && (!k || t.created < (k.created_ms ?? 0)) };
    });
  }

  agentName(plan) {
    if (!plan.by) return "Steps without an agent";
    if (plan.gone) return "An agent that has ended";
    const address = seenAddress(plan.by, plan.on), k = this.liveAt(plan.by, plan.on);
    return shownName(address, { terminal: address, program: k?.program, title: k?.title });
  }

  stepRow(step, c, now, gone) {
    const state = stepState(step);
    const working = state === "doing" && !gone;
    return row(`tasks-step-${step.id}`, c, {
      name: step.text, second: step.detail || null, wrap: true, wrapSecond: true,
      icon: state === "done" ? "check" : working ? null : "circle", mark: working ? "working" : "none",
      dimmed: state === "done", current: working,
      meta: ageOf(step.done_at ?? step.started_at ?? step.created, now),
    });
  }

  planBlock(plan, c, now) {
    const key = `${plan.on}:${plan.by ?? ""}:${plan.gone ? "gone" : ""}`;
    const folded = this.folded(key);
    const steps = plan.steps.filter((s) => stepState(s) !== "done");
    const done = plan.steps.filter((s) => stepState(s) === "done");
    return v_flex().w_full().gap(G.sm)
      .child(section(c, this.agentName(plan), `${done.length} of ${plan.steps.length} done`))
      .children(steps.map((s) => this.stepRow(s, c, now, plan.gone)))
      .children(done.length ? [row(`tasks-done-${key}`, c, { name: DONE, level: 0, open: !folded, chip: String(done.length), onClick: (cx) => this.fold(key, cx) })] : [])
      .children(folded ? [] : done.map((s) => this.stepRow(s, c, now, plan.gone)));
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
    const plans = plansOf(this.withAgents(this.shownSteps()));
    const machine = this.frontMachine(), unread = Boolean(machine) && this.unread[machine];
    const warned = unread ? [stateBlock("tasks-unread", c, { text: plans.length ? `Could not reach ${machine}; these steps may be out of date` : `Could not reach ${machine} to read its plans` })] : [];
    const body = !this.projects ? this.skeleton(c)
      : v_flex().w_full().gap(G.xl).children([
        ...warned,
        ...plans.map((plan) => this.planBlock(plan, c, now)),
        ...(unread && !plans.length ? [] : [this.emptyBlock(c, plans.length > 0)]),
      ]);
    return scrollPage("kanso-tasks", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"), []))
      .child(body));
  }
}
