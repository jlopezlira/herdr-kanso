import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, theme, spaces, home, agents, terminals, knownAgents, window } from "herdr";
import { deliver } from "./deliver.js";
import { shownName } from "./marks.js";
import { machineOf } from "./remote-file.js";
import { G, T, PR, tokens } from "./ui.js";
import { row, tool } from "./ui-row.js";
import { section } from "./ui-section.js";
import { stateBlock, undoLine } from "./ui-state.js";
import { emptyState, skeletonOf } from "./kit.js";
import { field, TextField } from "./ui-field.js";
import { scrollPage, pageHeader } from "./ui-page.js";
import { kdbOn, newId, seenAddress } from "./kdb.js";
import { runTodo, todoOn, tellAgents, toldWords } from "./todo-switch.js";
import { tryOrAsync } from "./pure.js";
import { TODO_MS, FOLLOW_MS, DONE, PROJECTS, TODOS, HELD_TODOS, todoText, todosOf, addTodoSql, doneSql, dropTodoSql, placeOf, withSpaces, shownProjects, ageOf } from "./todo.js";


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
    this.pending = {};
    this.fields = {};
    this.sending = null;
    this.removed = null;
    this.failure = null;
    this.timer = cx.timer;
    this.remote = {};
    this.agentsOn = {};
    this.turning = false;
    this.turned = null;
    this.front = this.frontPlace();
    this.switchOn(this.frontMachine(), cx);
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
    return (this.projects ?? []).find((p) => placeOf(p.machine, p.folder) === key)?.id ?? null;
  }

  follow(cx) {
    const front = this.frontPlace();
    if (front === this.front) return;
    this.front = front;
    this.turned = null;
    this.switchOn(this.frontMachine(), cx);
    cx.notify();
  }

  switchOn(machine, cx) {
    if (window()?.platform === "windows" || machine in this.agentsOn) return;
    this.agentsOn = { ...this.agentsOn, [machine]: null };
    cx.spawn(async (cx) => { this.agentsOn = { ...this.agentsOn, [machine]: await todoOn(machine || null) }; cx.notify(); });
  }

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
    this.projects = nextProjects;
    this.todos = nextTodos;
    this.fieldsFor(this.projects.map((p) => p.id));
    return true;
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try { if (await this.read()) cx.notify(); } finally { this.loading = false; }
    });
  }

  fieldsFor(projects) {
    const made = projects.filter((project) => !this.fields[project]).map((project) => {
      const text = new TextField({ placeholder: "Add a to-do" });
      text.on("submit", (_e, cx) => this.add(project, text, cx));
      return [project, text];
    });
    if (made.length) this.fields = { ...this.fields, ...Object.fromEntries(made) };
  }

  async homeOf(id) {
    const project = (this.projects ?? []).find((p) => p.id === id);
    if (project?.machine) {
      const there = await this.dbOn(project.machine);
      const held = (await there.read(PROJECTS)).find((p) => !p.machine && placeOf("", p.folder) === placeOf("", project.folder));
      return held?.id ?? (await there.addProject({ name: project.name, folder: placeOf("", project.folder).slice(1), machine: "" })).row.id;
    }
    if (!project?.auto) return id;
    return (await this.db.addProject({ name: project.name, folder: project.folder, machine: "" })).row.id;
  }

  write(on, sql, failed, change, cx, after = () => {}) {
    this.failure = null;
    const op = { ...change };
    this.pending = { ...this.pending, [change.id]: op };
    cx.notify();
    const done = (this.queued?.[change.id] ?? Promise.resolve()).then(async () => {
      try {
        await (await this.dbOn(on)).run(await sql());
        after();
      } catch {
        this.failure = { text: failed, retry: (cx) => this.write(on, sql, failed, change, cx, after) };
      }
    });
    this.queued = { ...this.queued, [change.id]: done };
    cx.spawn(async (cx) => {
      await done;
      if (this.queued[change.id] === done) this.queued = Object.fromEntries(Object.entries(this.queued).filter(([id]) => id !== change.id));
      await this.read();
      this.pending = Object.fromEntries(Object.entries(this.pending).filter(([id, held]) => id !== change.id || held !== op));
      cx.notify();
    });
  }

  shown() {
    const kept = this.todos.filter((t) => !this.pending[t.id]?.gone).map((t) => (this.pending[t.id] ? { ...t, ...this.pending[t.id].todo, pending: true } : t));
    const added = Object.values(this.pending).filter((p) => p.todo && !kept.some((t) => t.id === p.id)).map((p) => ({ ...p.todo, pending: true }));
    return [...kept, ...added];
  }

  add(project, text, cx) {
    const words = todoText(text.value());
    if (!words) return;
    text.set_value("");
    const on = (this.projects ?? []).find((p) => p.id === project)?.machine ?? "";
    const todo = { id: newId(), project, text: words, created: Date.now(), done_at: null, on };
    this.write(on, async () => addTodoSql({ ...todo, project: await this.homeOf(project) }), `Can't add ${words}`, { id: todo.id, todo }, cx);
  }

  mark(todo, cx) {
    const done_at = todo.done_at == null ? Date.now() : null;
    this.write(todo.on, async () => doneSql(todo.id, done_at), `Can't change ${todo.text}`, { id: todo.id, todo: { ...todo, done_at } }, cx);
  }

  drop(todo, cx) {
    this.removed = null;
    this.write(todo.on, async () => dropTodoSql(todo.id), `Can't delete ${todo.text}`, { id: todo.id, gone: true }, cx, () => {
      this.removed = { words: `Deleted ${todo.text}`, undo: (cx) => this.write(todo.on, async () => `${addTodoSql({ ...todo, project: todo.home ?? await this.homeOf(todo.project) })}${doneSql(todo.id, todo.done_at)}`, `Can't bring back ${todo.text}`, { id: todo.id, todo }, cx, () => { this.removed = null; }) };
    });
  }

  openSend(todo, cx) {
    if (this.sending?.id === todo.id) { this.sending = null; cx.notify(); return; }
    const project = (this.projects ?? []).find((p) => p.id === todo.project);
    this.sending = { id: todo.id, known: null };
    cx.notify();
    cx.spawn(async (cx) => {
      const known = await knownAgents({ on: project?.machine || null }).catch(() => []);
      if (this.sending?.id !== todo.id) return;
      this.sending = { id: todo.id, known: JSON.parse(JSON.stringify(known)).filter((a) => a.installed) };
      cx.notify();
    });
  }

  agentsIn(project) {
    const folder = String(project.folder ?? "").replace(/[\\/]+$/, "");
    const inside = (k) => (machineOf(k.address) ?? "") === (project.machine ?? "") && [folder, `${folder}/`, `${folder}\\`].some((at, i) => (i ? String(k.cwd ?? "").startsWith(at) : k.cwd === at));
    const held = new Set(terminals().filter(inside).map((k) => k.address));
    return agents().filter((a) => held.has(a.address));
  }

  sendTo(todo, address, cx) {
    this.sending = null;
    this.failure = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const sent = await deliver(cx.timer, address, todo.text, "you").catch(() => ({ code: 1 }));
      if (sent.code !== 0) this.failure = { text: `Can't send ${todo.text}`, retry: (cx) => this.sendTo(todo, address, cx) };
      cx.notify();
    });
  }

  startWith(todo, project, agent, cx) {
    this.sending = null;
    const argv = [...agent.run, todo.text];
    const place = placeOf(project.machine, project.folder);
    const open = spaces().filter((s) => placeOf(s.machine, s.folder || home()) === place);
    if (open.some((s) => s.active)) run("terminal.open", { argv, folder: project.folder, place: "right" });
    else if (open.length) run("tab.new", { space: open[0].id, name: agent.name, folder: project.folder, argv });
    else run("space.new", { name: project.name, folder: project.folder, machine: project.machine ?? "", argv });
    cx.notify();
  }

  sendRows(todo, project, c) {
    if (this.sending?.id !== todo.id) return [];
    const known = this.sending.known;
    const running = this.agentsIn(project).map((a) => row(`tasks-to-${todo.id}-${a.address}`, c, { name: shownName(a.address), icon: a.program?.icon ? a.program : "terminal", depth: 1, onClick: (cx) => this.sendTo(todo, a.address, cx) }));
    const fresh = known ? known.map((a) => row(`tasks-new-${todo.id}-${a.key}`, c, { name: `New conversation · ${a.name}`, icon: a.icon ? a : "plus", depth: 1, onClick: (cx) => this.startWith(todo, project, a, cx) }))
      : [skeletonOf({ shape: "two lines", count: 1 })(`tasks-new-bones-${todo.id}`, c)];
    return [...(running.length ? [section(c, "In this project", String(running.length)), ...running] : []), ...fresh];
  }

  liveBy(todo) {
    const address = todo.by ? seenAddress(todo.by, todo.on) : null;
    return address && terminals().some((k) => k.address === address) ? shownName(address) : null;
  }

  todoRow(todo, c, now) {
    const open = todo.done_at == null;
    return row(`tasks-todo-${todo.id}`, c, {
      name: todo.text, icon: open ? "square" : "check", dimmed: !open, pending: Boolean(todo.pending),
      meta: [this.liveBy(todo), ageOf(todo.done_at ?? todo.created, now)].filter(Boolean).join(" · "),
      tools: [{ icon: "send", label: "Send to agent", onClick: (cx) => this.openSend(todo, cx) }, { icon: "x", label: "Delete", onClick: (cx) => this.drop(todo, cx) }].map(tool(`tasks-todo-${todo.id}`, c)),
      onClick: (cx) => this.mark(todo, cx),
    });
  }

  folded(project) { return this.folds[project] ?? true; }

  fold(project, cx) {
    this.folds = { ...this.folds, [project]: !this.folded(project) };
    cx.notify();
  }

  projectBlock(project, todos, c, now) {
    const { open, done } = todosOf(todos, project.id);
    const folded = this.folded(project.id);
    const listed = (list) => list.flatMap((todo) => [this.todoRow(todo, c, now), ...this.sendRows(todo, project, c)]);
    return v_flex().w_full().gap(G.sm)
      .child(section(c, project.name, `${open.length} open`))
      .children(this.fields[project.id] ? [field(`tasks-field-${project.id}`, this.fields[project.id], c, { lead: "plus", spoken: "Add a to-do" })] : [])
      .children(listed(open))
      .children(done.length ? [row(`tasks-done-${project.id}`, c, { name: DONE, level: 0, open: !folded, chip: String(done.length), onClick: (cx) => this.fold(project.id, cx) })] : [])
      .children(folded ? [] : listed(done));
  }

  turnOn(cx) {
    if (this.turning) return;
    this.turning = true;
    this.turned = null;
    cx.notify();
    const machine = this.frontMachine();
    cx.spawn(async (cx) => {
      const r = this.agentsOn[machine] ? { code: 0 } : await runTodo("install", machine || null);
      this.agentsOn = { ...this.agentsOn, [machine]: await todoOn(machine || null) };
      const told = await tellAgents(cx.timer, machine || null);
      const warned = r.code === 0 ? "" : String(r.stderr || r.stdout || "It could not be turned on").trim().split("\n").at(-1);
      this.turned = { text: [warned, toldWords(told, this.agentsOn[machine] === true, machine || null)].filter(Boolean).join(" "), failed: Boolean(warned) || told.failed };
      this.turning = false;
      cx.notify();
    });
  }

  emptyBlock(c) {
    if (window()?.platform === "windows") return emptyState({ text: "Each project's to-do shows here" })("tasks-none", c);
    const agentsOn = this.agentsOn[this.frontMachine()];
    const action = this.turning ? "" : agentsOn ? "Tell running agents" : "Turn on for my agents";
    const text = agentsOn ? "Your agents add each step here as they work" : "Turn this on and Claude Code, Codex and Pi add each step of their work here";
    return v_flex().w_full().gap(G.sm)
      .child(emptyState({ text, action })("tasks-none", c, { onClick: (cx) => this.turnOn(cx) }))
      .children(this.turned ? [this.turned.failed ? stateBlock("tasks-turned", c, { text: this.turned.text }) : div().text_size(T.body).text_color(c.dim).text_center().child(this.turned.text)] : []);
  }

  notes(c) {
    return [
      ...(this.failure ? [stateBlock("tasks-failed", c, { text: this.failure.text, fix: "Retry", onClick: this.failure.retry })] : []),
      ...(this.removed ? [undoLine("tasks-removed", this.removed.words, this.removed.undo, c)] : []),
    ];
  }

  skeleton(c) { return skeletonOf({ shape: "two lines", count: 4 })("kanso-skeleton", c); }

  render() {
    const c = tokens(theme()), now = Date.now();
    const todos = this.shown();
    const listed = this.projects ? shownProjects(this.projects, todos, this.frontProject()) : [];
    const body = !this.projects ? this.skeleton(c)
      : v_flex().w_full().gap(G.xl).children([
        ...this.notes(c),
        ...listed.map((p) => this.projectBlock(p, todos, c, now)),
        ...(todos.length ? [] : [this.emptyBlock(c)]),
      ]);
    return scrollPage("kanso-tasks", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"), []))
      .child(body));
  }
}
