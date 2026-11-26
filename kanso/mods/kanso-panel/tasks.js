import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, theme, spaces, home, openOverlay, agents, terminals, knownAgents } from "herdr";
import { deliver } from "./deliver.js";
import { shownName } from "./marks.js";
import { machineOf } from "./remote-file.js";
import { G, PR, DIALOG, tokens } from "./ui.js";
import { row, tool } from "./ui-row.js";
import { section } from "./ui-section.js";
import { stateBlock, undoLine } from "./ui-state.js";
import { emptyState, skeletonOf } from "./kit.js";
import { field, TextField } from "./ui-field.js";
import { scrollPage, pageHeader } from "./ui-page.js";
import { newId } from "./kdb.js";
import { tryOrAsync } from "./pure.js";
import { TODO_MS, DONE, PROJECTS, TODOS, todoText, todosOf, addTodoSql, doneSql, dropTodoSql, placeOf, withSpaces, shownProjects, ageOf } from "./todo.js";

const AGENTS_SWITCH = "Agents keep the to-do";

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
    this.load(cx);
    cx.timer.every(TODO_MS, (next) => this.load(next));
  }

  frontProject() {
    const active = spaces().find((s) => s.active);
    const key = placeOf(active?.machine, active?.folder || home());
    return (this.projects ?? []).find((p) => placeOf(p.machine, p.folder) === key)?.id ?? null;
  }

  async read() {
    const [projects, todos] = await Promise.all([tryOrAsync(() => this.db.read(PROJECTS)), tryOrAsync(() => this.db.read(TODOS))]);
    const nextProjects = withSpaces(projects ?? this.projects ?? [], spaces(), home());
    const nextTodos = todos ?? this.todos;
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

  async ownId(id) {
    const project = (this.projects ?? []).find((p) => p.id === id);
    if (!project?.auto) return id;
    const { row: made } = await this.db.addProject({ name: project.name, folder: project.folder, machine: project.machine ?? "" });
    return made.id;
  }

  write(sql, failed, change, cx, after = () => {}) {
    this.failure = null;
    const op = { ...change };
    this.pending = { ...this.pending, [change.id]: op };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.db.run(await sql());
        after();
      } catch {
        this.failure = { text: failed, retry: (cx) => this.write(sql, failed, change, cx, after) };
      }
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
    const todo = { id: newId(), project, text: words, created: Date.now(), done_at: null };
    this.write(async () => addTodoSql({ ...todo, project: await this.ownId(project) }), `Can't add ${words}`, { id: todo.id, todo }, cx);
  }

  mark(todo, cx) {
    const done_at = todo.done_at == null ? Date.now() : null;
    this.write(async () => doneSql(todo.id, done_at), `Can't change ${todo.text}`, { id: todo.id, todo: { ...todo, done_at } }, cx);
  }

  drop(todo, cx) {
    this.removed = null;
    this.write(async () => dropTodoSql(todo.id), `Can't delete ${todo.text}`, { id: todo.id, gone: true }, cx, () => {
      this.removed = { words: `Deleted ${todo.text}`, undo: (cx) => this.write(async () => `${addTodoSql(todo)}${doneSql(todo.id, todo.done_at)}`, `Can't bring back ${todo.text}`, { id: todo.id, todo }, cx, () => { this.removed = null; }) };
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

  todoRow(todo, c, now) {
    const open = todo.done_at == null;
    return row(`tasks-todo-${todo.id}`, c, {
      name: todo.text, icon: open ? "square" : "check", dimmed: !open, pending: Boolean(todo.pending),
      meta: [todo.by && terminals().some((k) => k.address === todo.by) ? shownName(todo.by) : null, ageOf(todo.done_at ?? todo.created, now)].filter(Boolean).join(" · "),
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

  openSwitch() {
    openOverlay({ mod: "kanso-settings", kind: "dialog", width: DIALOG.settingsW, height: DIALOG.settingsH, props: { page: "pieces", find: AGENTS_SWITCH } });
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
        ...(todos.length ? [] : [emptyState({ text: "Your agents' to-do for each project shows here as they work", action: AGENTS_SWITCH })("tasks-none", c, { onClick: () => this.openSwitch() })]),
      ]);
    return scrollPage("kanso-tasks", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"), []))
      .child(body));
  }
}
