import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  arg, chain, databaseTimer, drawingHost, exec, failure, fieldWith, find, keyboard, KIT_NIGHT, load,
  nativePlatform, nativeWindow, one, same, success, temporary, texts, timedContext,
} from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const shop = { id: "shop", name: "Shop", folder: "/work/shop", machine: null };
const acme = { id: "acme", name: "Acme", folder: "/work/acme", machine: null };
const remoteShop = { ...shop, machine: "light" };
const remoteShopWithSlash = { ...remoteShop, folder: `${remoteShop.folder}/` };
const terminalPlacements = () => {
  const { folder, machine } = remoteShop;
  const samePlace = { id: "shop-on-light", folder, machine };
  const anotherComputer = { ...samePlace, id: "shop-local", machine: null, active: true };
  return [
    [[{ ...samePlace, active: true }], "terminal.open", { folder, place: "right" }],
    [[anotherComputer, samePlace], "tab.new", { folder, space: samePlace.id }],
    [[anotherComputer], "space.new", { folder, machine }],
  ];
};

const TURN_ON = "Turn on for my agents";
const TELL = "Tell running agents";
const TOLD_ONE = "Told 1 running agent. New conversations read it when they start.";
const TODO_APP_HOME = "/app";
const TODO_SCRIPT = `${TODO_APP_HOME}/mods/kanso-panel/kanso-todo`;
const TODO_WORDS = "Pack the release notes";
const FOLLOW_MS = 300;
const terminalId = "t42";

const saveProject = async (db, { name, folder, machine }) => (await db.addProject({ name, folder, machine: machine ?? undefined })).row;
const activeSpace = (project) => () => [{ ...project, active: true }];
const selectProject = (project) => () => [shop, acme].map((p) => ({ ...p, active: p === project }));

const control = (panel, id) => find(panel, (el) => el.tag === id || arg(el, "id") === id);
const wordsAt = (panel, id) => {
  const element = control(panel, id);
  return element ? texts(element) : [];
};
const startTasks = async (
  db, { exec: hostExec, todoExec = async () => success("off\n"), ...host } = {}, { every, ...context } = {},
) => {
  const { Tasks } = await load("kanso-panel/tasks.js", ["Tasks"], {
    ...drawingHost(),
    theme: () => KIT_NIGHT,
    spaces: () => [],
    home: () => "/Users/jj",
    appHome: () => TODO_APP_HOME,
    exec: (program, args, options) => program === "sh" && args[0] === TODO_SCRIPT
      ? todoExec(args[1])
      : hostExec?.(program, args, options) ?? Promise.resolve(failure("Unexpected command")),
    ...host,
  });
  const { cx, drain, pending } = timedContext([], context);
  const view = new Tasks(db);
  view.init(every ? { ...cx, timer: { ...cx.timer, every } } : cx);
  await drain();
  const page = () => view.render();
  const press = (id) => {
    const target = control(page(), id);
    assert.ok(target, id);
    const handler = one(target, "on_click");
    return () => handler(null, cx);
  };
  const click = (id) => press(id)();
  return { view, cx, drain, pending, page, click, press };
};

const storedTodo = (project, extra = {}) => ({ id: project, project, text: TODO_WORDS, created: 1000, ...extra });
const writeTodo = async (db, todo) => {
  const { addTodoSql } = await load("kanso-panel/todo.js", ["addTodoSql"]);
  await db.run(addTodoSql(todo));
};
const followWithin = (every, cx) => {
  for (const { arguments: [ms, tick] } of every.mock.calls) if (ms <= FOLLOW_MS) tick(cx);
};
const polledTasks = async (t, db, host = {}) => {
  const every = t.mock.fn(() => ({ cancel() {} }));
  const notify = t.mock.fn();
  const tasks = await startTasks(db, { ...todoInputHost(t), ...host }, { every, notify });
  const tick = every.mock.calls.find(({ arguments: [ms] }) => ms === 4000)?.arguments[1];
  assert.equal(typeof tick, "function", "Tasks schedules the to-do poll every four seconds");
  return {
    ...tasks, notify,
    follow: () => followWithin(every, tasks.cx),
    poll: async () => { tick(tasks.cx); await tasks.drain(); },
  };
};

test("The to-do poll redraws when an agent changes the list but keeps the same rows when nothing changed.", async (t) => {
  const { db } = await temporaryKdb(t);
  const { id } = await saveProject(db, shop);
  const { view, page, notify, poll } = await polledTasks(t, db, { spaces: activeSpace(shop) });
  const redraws = notify.mock.callCount();
  const before = view.todos;
  await writeTodo(db, storedTodo(id));
  await poll();
  assert.notEqual(view.todos, before);
  assert.ok(texts(page()).includes(TODO_WORDS));
  assert.equal(notify.mock.callCount(), redraws + 1);
  const after = view.todos;
  await poll();
  assert.equal(view.todos, after);
  assert.equal(notify.mock.callCount(), redraws + 1);
});

test("The to-do poll finds an agent's first item in a newly saved project.", async (t) => {
  const { db } = await temporaryKdb(t);
  const { page, poll } = await polledTasks(t, db, { spaces: activeSpace(acme) });
  assert.ok(control(page(), "tasks-none"));
  const { id } = await saveProject(db, acme);
  await writeTodo(db, storedTodo(id));
  await poll();
  const words = texts(page());
  for (const word of [acme.name, TODO_WORDS]) assert.ok(words.includes(word), word);
});

test("Tasks shows a newly opened unsaved project and its editor within 300 ms.", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = t.mock.fn(activeSpace(shop));
  const { page, follow } = await polledTasks(t, db, { spaces });
  assert.ok(texts(page()).includes(shop.name));
  spaces.mock.mockImplementation(activeSpace(acme));
  follow();

  const panel = page();
  assert.ok(texts(panel).includes(acme.name));
  assert.ok(labelledControl(panel, "Add a to-do"));
  same(await db.projects(), []);
});

test("Tasks redraws for the sidebar's active project within 300 ms even when no to-dos change.", async (t) => {
  const { db } = await temporaryKdb(t);
  const reads = t.mock.method(db, "read");
  const spaces = t.mock.fn(selectProject(shop));
  const { page, follow, drain, notify } = await polledTasks(t, db, { spaces });
  const visibleProjects = () => texts(page()).filter((word) => [shop.name, acme.name].includes(word));

  assert.deepEqual(visibleProjects(), [shop.name]);
  const before = { redraws: notify.mock.callCount(), reads: reads.mock.callCount() };
  spaces.mock.mockImplementation(selectProject(acme));
  follow();
  assert.ok(notify.mock.callCount() > before.redraws, "Switching spaces requests a redraw without waiting on I/O");
  await drain();
  assert.equal(reads.mock.callCount(), before.reads, "Following the active space does not reread to-dos");
  assert.deepEqual(visibleProjects(), [acme.name]);
});

test("Tasks shows to-dos for saved projects but not for removed projects.", async (t) => {
  const { db } = await temporaryKdb(t);
  const current = await saveProject(db, shop);
  const removed = await saveProject(db, acme);
  await writeTodo(db, storedTodo(current.id));
  await writeTodo(db, storedTodo(removed.id, { text: "An item from a removed project" }));
  await db.removeProject(removed.id);

  const { page, view } = await startTasks(db, { spaces: activeSpace(shop) });
  assert.ok(texts(page()).includes(TODO_WORDS));
  assert.equal(view.todos.some((todo) => todo.project === removed.id), false);
});

test("Tasks shows only the viewed project even when another project has an open to-do.", async (t) => {
  const { db } = await temporaryKdb(t);
  const other = await saveProject(db, acme);
  await writeTodo(db, storedTodo(other.id));
  const { page } = await startTasks(db, { ...todoInputHost(t), spaces: activeSpace(shop) });
  const panel = page();
  const words = texts(panel);
  assert.deepEqual(words.filter((word) => [shop.name, acme.name, TODO_WORDS].includes(word)), [shop.name]);
  assert.deepEqual(wordsAt(panel, "tasks-none-action"), [TURN_ON]);
});

test("Open spaces count once per project, preferring saved projects and skipping the local home.", async () => {
  const { withSpaces } = await load("kanso-panel/todo.js", ["withSpaces"]);
  const home = "/Users/jj";
  const remoteHome = { name: "Remote home", folder: home, machine: "light" };
  const open = [remoteShop, remoteShopWithSlash, shop, { name: "Home", folder: home }, remoteHome];
  const projects = withSpaces([shop], open, home);
  same(projects.map(({ name, folder, machine, auto }) => [name, folder, machine, Boolean(auto)]), [
    [shop.name, shop.folder, shop.machine, false],
    [remoteShop.name, remoteShop.folder, remoteShop.machine, true],
    [remoteHome.name, remoteHome.folder, remoteHome.machine, true],
  ]);
});

test("Empty Tasks turns on the to-do rule and can tell running agents on this computer again without reinstalling.", async (t) => {
  let installed = false;
  const rule = "Keep the project to-do up to date.";
  const todoExec = t.mock.fn(async (verb) => {
    if (verb === "rule") return success(rule + "\n");
    if (verb === "install") installed = true;
    return success(installed ? "on\n" : "off\n");
  });
  const local = "t1";
  const refused = "t2";
  const hc = t.mock.fn(async ([verb, address]) =>
    verb === "send" && address === refused ? failure("Agent disconnected") : success(""));
  const agents = () => [
    { address: local, status: "working" },
    { address: refused, status: "idle" },
    { address: "t3", status: "blocked" },
    { address: "light/t4", status: "working" },
  ];
  const { page, click, drain } = await todoTasks(t, { todoExec, agents, hc });
  const action = "tasks-none-action";
  for (const label of [TURN_ON, TELL]) {
    assert.deepEqual(wordsAt(page(), action), [label]);
    click(action);
    await drain();
    const note = "Told 1 of 2 running agents. 1 could not be reached."
      + " 1 is waiting on its own question; answer, then tell agents again. New conversations read it when they start.";
    assert.ok(texts(page()).includes(note));
  }
  assert.deepEqual(todoVerbs(todoExec), [
    "status", "install", "status", "rule", "status", "rule",
  ]);
  same(sentTo(hc), [local, refused, local, refused].map((address) => ["send", address, rule]));
});

test("Tasks shows what could not be installed alongside the note about who was told.", async (t) => {
  const skipped = "Codex already has developer instructions.";
  const replies = [success("off\n"), failure(skipped), success("on\n"), success("Keep your to-do up to date.")].values();
  const { page, click, drain } = await todoTasks(t, {
    todoExec: async () => replies.next().value,
    agents: () => [{ address: terminalId, status: "working" }],
    hc: async () => success(""),
  });

  click("tasks-none-action");
  await drain();
  const panel = page();
  const words = texts(panel).join("\n");
  assert.ok(words.includes(TOLD_ONE), "Tasks still confirms that a running agent was told");
  assert.ok(words.includes(skipped), "Tasks shows the install warning even when the switch is on");
  assert.deepEqual(wordsAt(panel, "tasks-none-action"), [TELL]);
});

const tryTodoInstallWithConflict = async (t) => {
  const warning = "Codex already has developer instructions.";
  const rule = "Keep the project to-do up to date.";
  const todoExec = async (verb) => {
    if (verb === "install") return failure(warning);
    return success(verb === "rule" ? rule : "off");
  };
  const hc = t.mock.fn(async () => success(""));
  const host = { agents: () => [{ address: terminalId, status: "idle" }], hc };
  const tasks = await todoTasks(t, { ...host, todoExec });
  tasks.click("tasks-none-action");
  await tasks.drain();

  const { agentsTodo } = await load("kanso-settings/script-switch.js", ["agentsTodo"], {
    ...host, ...drawingHost(), appHome: () => TODO_APP_HOME,
    exec: async (_program, [, verb]) => todoExec(verb),
  });
  const { cx, drain } = timedContext([]);
  const setting = agentsTodo(cx);
  await drain();
  setting.set(true, cx);
  await drain();

  const notices = [tasks.page(), setting.row({}, "")].map((page) => texts(page).join("\n"));
  return { tasks, setting, hc, warning, rule, notices };
};

test("Tasks and Settings tell running agents even when the to-do rule cannot be installed.", async (t) => {
  const { tasks, setting, hc, warning, rule, notices } = await tryTodoInstallWithConflict(t);
  for (const words of notices) assert.ok(words.includes(warning), "The installation warning remains visible");
  assert.deepEqual(wordsAt(tasks.page(), "tasks-none-action"), [TURN_ON]);
  assert.equal(setting.on, false);
  same(sentTo(hc), Array.from({ length: 2 }, () => ["send", terminalId, rule]));
  for (const words of notices) assert.match(words, /Told 1 running agent/);
});

test("Tasks and Settings do not promise the rule to new conversations when setup stays off.", async (t) => {
  const { notices } = await tryTodoInstallWithConflict(t);
  assert.deepEqual(notices.filter((words) => /new conversations read it/i.test(words)), []);
});

const deliverTodoTo = async (addresses, status = "idle") => {
  const { promise: unanswered } = Promise.withResolvers();
  const outcomes = {
    refused: failure("Agent disconnected"),
    silent: unanswered,
  };
  const { tellAgents, toldWords } = await load("kanso-panel/todo-switch.js", ["tellAgents", "toldWords"], {
    appHome: () => TODO_APP_HOME,
    exec: async () => success("Keep your to-do up to date."),
    agents: () => addresses.map((address) => ({ address, status })),
    hc: async ([, address]) => outcomes[address] ?? success(""),
  });
  const deadlines = [];
  const { cx } = timedContext(deadlines);
  const delivery = tellAgents(cx.timer);
  await nextTurn();
  for (const [, expire] of deadlines) expire();
  const result = await delivery;
  return { result, text: toldWords(result) };
};

test("Telling running agents distinguishes a refusal, an unanswered send, and no running agents.", async () => {
  for (const [addresses, expected, words] of [
    [["refused"], { tried: 1, sent: 0, unsure: 0, failed: false }, /Told 0 of 1.*1 could not be reached/],
    [["silent"], { tried: 1, sent: 0, unsure: 1, failed: false }, /Told 0 of 1.*1 did not answer/],
    [[], { tried: 0, sent: 0, unsure: 0, failed: false }, /No agent is running here now/],
  ]) {
    const { result, text } = await deliverTodoTo(addresses);
    assert.match(text, words);
    same(result, { ...expected, waiting: 0 });
  }
});

test("Telling agents on light names light when no agents are running there.", async () => {
  const { toldWords } = await load("kanso-panel/todo-switch.js", ["toldWords"]);
  assert.equal(toldWords({}, false, remoteShop.machine), "No agent is running on light now.");
});

test("Telling running agents skips an agent waiting for my answer and says to answer before trying again.", async () => {
  const { result, text } = await deliverTodoTo([terminalId], "blocked");
  assert.match(text, /No agent was told\. 1 is waiting on its own question; answer, then tell agents again/);
  same(result, { tried: 0, sent: 0, unsure: 0, waiting: 1, failed: false });
});

test("Telling running agents counts unanswered sends separately from refusals.", async () => {
  const { text } = await deliverTodoTo(["confirmed", "silent", "refused"]);
  assert.match(text, /Told 1 of 3 running agents/);
  assert.match(text, /1 did not answer; look at it before telling again/);
  assert.match(text, /1 could not be reached/);
});

test("Empty Tasks on Windows tells me where to-dos appear without offering an unavailable switch.", async (t) => {
  const { page } = await todoTasks(t, { window: () => ({ platform: "windows" }) });
  const panel = page();
  const empty = "tasks-none";
  assert.ok(wordsAt(panel, empty).length, "Windows still shows an empty-state message");
  assert.ok(!control(panel, `${empty}-action`), "Windows does not offer the agent switch");
});

test("A to-do names the agent while its terminal is live, and keeps just the age after it leaves.", async (t) => {
  const name = "Release agent";
  const terminals = t.mock.fn(() => [{ address: terminalId, labels: { "kanso.shown": name } }]);
  const { Tasks } = await load("kanso-panel/tasks.js", ["Tasks"], { ...drawingHost(), terminals });
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const view = new Tasks();
  const todo = storedTodo(shop.id, { by: terminalId });
  const metadata = () => texts(view.todoRow(todo, tokens(KIT_NIGHT), todo.created + 5 * 60_000));
  assert.ok(metadata().includes(`${name} · 5m`));
  terminals.mock.mockImplementation(() => []);
  const words = metadata();
  assert.ok(words.includes("5m"));
  assert.equal(words.some((word) => word.includes(name)), false);
});

const todoInputHost = (t) => ({
  Input: { new: (state) => chain("Input").state(state) },
  InputState: { new: ({ value = "" } = {}) => {
    const read = t.mock.fn(() => value);
    return {
      ...fieldWith({ value }), value: read, on: t.mock.fn(),
      set_value: (next) => read.mock.mockImplementation(() => next),
    };
  } },
});
const labelledControl = (panel, label) => find(panel, (el) => arg(el, "accessibility_label") === label);
const todoRowIdOf = ({ id }) => `tasks-todo-${id}`;
const remoteTodoHost = async (t, Kdb, machine, todoExec = async () => success("off\n")) => {
  const home = await temporary(t);
  const config = nativePlatform === "windows" ? ["AppData", "Roaming"] : [".config"];
  const app = join(home, ...config, "herdr-app");
  const script = join(app, "mods", "kanso-panel", "kanso-todo");
  const db = new Kdb(databaseTimer, join(app, "data", "kanso"));
  await db.open();
  const run = async (command, args, options) => {
    assert.equal(options?.on, machine);
    if (args.at(-1)?.includes("OSVersion.Platform")) {
      return nativePlatform === "windows" ? success("Win32NT\n") : failure("Command not found", 127);
    }
    if (args.at(-1)?.endsWith("$HOME") || args.at(-1) === 'printf %s "$HOME"') return success(home);
    if (command === "sh" && args[0] === script) return todoExec(args[1]);
    return exec(command, args, options);
  };
  return { db, host: { exec: run, window: nativeWindow } };
};

const todoTasks = async (t, { project = shop, unsaved = false, ...host } = {}) => {
  const { db, Kdb } = await temporaryKdb(t);
  const remote = project.machine ? await remoteTodoHost(t, Kdb, project.machine) : null;
  const savedProject = unsaved ? null : await saveProject(db, project);
  const stop_propagation = t.mock.fn();
  const makeButton = t.mock.fn(drawingHost().Button.new);
  const tasks = await startTasks(db, {
    ...todoInputHost(t), spaces: activeSpace(project), Button: { new: makeButton }, ...remote?.host, ...host,
  }, { stop_propagation });
  const input = () => {
    const editor = labelledControl(tasks.page(), "Add a to-do");
    assert.ok(editor, "Tasks shows an Add a to-do field");
    return arg(editor, "state");
  };
  const enterTodo = (words) => {
    const state = input();
    const event = state.on.mock.calls.find(({ arguments: [name] }) => name === "submit");
    assert.ok(event, "Enter submits the to-do");
    state.set_value(words);
    event.arguments[1]({}, tasks.cx);
  };
  const submit = async (words = TODO_WORDS) => {
    enterTodo(words);
    await tasks.drain();
    return input().value();
  };
  const saved = () => (remote?.db ?? db).read("SELECT id, project, text, done_at FROM todos;");
  const todoRowId = async () => {
    const [row] = await saved();
    assert.ok(row, "The to-do is in SQLite");
    return todoRowIdOf(row);
  };
  return { ...tasks, db, remoteDb: remote?.db, id: savedProject?.id, enterTodo, submit, saved, todoRowId, makeButton };
};

const tasksOnLight = async (t, remoteExec, { todoExec, ...host } = {}) => {
  const { db, Kdb } = await temporaryKdb(t);
  const remote = await remoteTodoHost(t, Kdb, remoteShop.machine, remoteExec);
  return startTasks(db, {
    ...todoInputHost(t), ...remote.host, window: () => ({ platform: "macos" }),
    spaces: activeSpace(remoteShop), todoExec, ...host,
  });
};
const todoVerbs = (mock) => mock.mock.calls.flatMap(({ arguments: args }) => args);

test("One press in Tasks turns on the to-do on light and tells only light's running agents.", async (t) => {
  const rule = "Keep the project to-do up to date.";
  let installed = false;
  const remote = t.mock.fn(async (verb) => {
    if (verb === "install") installed = true;
    return success(verb === "rule" ? rule : installed ? "on\n" : "off\n");
  });
  const local = t.mock.fn(async (verb) => success(verb === "rule" ? "Local to-do rule" : "off\n"));
  const running = `${remoteShop.machine}/t3`;
  const agents = () => [
    ...[terminalId, "grey/t2", running].map((address) => ({ address, status: "working" })),
    { address: `${remoteShop.machine}/t4`, status: "blocked" },
  ];
  const hc = t.mock.fn(async () => success(""));
  const { click, drain } = await tasksOnLight(t, remote, { todoExec: local, agents, hc });
  click("tasks-none-action");
  await drain();

  same(
    { light: todoVerbs(remote), local: todoVerbs(local), sent: sentTo(hc) },
    { light: ["status", "install", "status", "rule"], local: [], sent: [["send", running, rule]] },
  );
});

test("Empty Tasks reads light's switch rather than this computer's switch.", async (t) => {
  const { page } = await tasksOnLight(t, async () => success("on\n"), {
    todoExec: async () => success("off\n"),
  });
  assert.deepEqual(wordsAt(page(), "tasks-none-action"), [TELL]);
});

const selectAt = (tasks, spaces) => (project) => {
  spaces.mock.mockImplementation(activeSpace(project));
  tasks.view.follow(tasks.cx);
};

test("Tasks rereads light's switch when returning from a project on this computer.", async (t) => {
  let turnedOn = true;
  const spaces = t.mock.fn(activeSpace(remoteShop));
  const tasks = await tasksOnLight(t, async () => success(turnedOn ? "on\n" : "off\n"), { spaces });
  const visit = selectAt(tasks, spaces);
  const label = () => wordsAt(tasks.page(), "tasks-none-action");
  assert.deepEqual(label(), [TELL]);

  visit(shop);
  await tasks.drain();
  turnedOn = false;
  visit(remoteShop);
  await tasks.drain();

  assert.deepEqual(label(), [TURN_ON]);
});

test("A late status reply from light cannot overwrite a successful Turn on.", { timeout: 10000 }, async (t) => {
  const stale = Promise.withResolvers();
  const reading = Promise.withResolvers();
  let installed = false;
  const remote = async (verb) => {
    if (verb === "status" && !installed) {
      reading.resolve();
      return stale.promise;
    }
    if (verb === "install") installed = true;
    return success(verb === "rule" ? "Keep the to-do up to date." : "on\n");
  };
  const spaces = t.mock.fn(activeSpace(shop));
  const tasks = await tasksOnLight(t, remote, { spaces });
  const action = "tasks-none-action";
  selectAt(tasks, spaces)(remoteShop);
  await reading.promise;
  try {
    tasks.click(action);
    await tasks.pending.at(-1);
    assert.deepEqual(wordsAt(tasks.page(), action), [TELL]);
  } finally {
    stale.resolve(success("off\n"));
    await tasks.drain();
  }
  assert.deepEqual(wordsAt(tasks.page(), action), [TELL]);
});

test("Opening Tasks shows a skeleton before its first load.", async () => {
  const { Panel } = await load("kanso-panel/main.js", ["Panel"], {
    ...drawingHost(),
    props: () => ({ panel: "issues" }),
    spaces: () => [],
    appHome: () => "/app",
    theme: () => KIT_NIGHT,
  });
  const { cx } = timedContext([]);
  const panel = new Panel();
  panel.init({}, cx);
  assert.ok(control(panel.render(cx), "kanso-skeleton"));
});

test("Opening Tasks draws without creating native input state during render.", async (t) => {
  const host = todoInputHost(t);
  const createInput = t.mock.method(host.InputState, "new");
  const { page } = await todoTasks(t, host);
  const before = createInput.mock.callCount();
  assert.ok(labelledControl(page(), "Add a to-do"), "Tasks draws the To-do input");
  assert.equal(createInput.mock.callCount(), before, "Herdr forbids InputState.new() during render");
});

test("Submitting a to-do saves it, clears the field, and shows it first; blank text saves nothing.", async (t) => {
  const now = t.mock.fn(() => 1_800_000_000_000);
  const Date = class extends globalThis.Date { static now() { return now(); } };
  const { id, page, submit, saved } = await todoTasks(t, { Date });
  assert.equal(await submit(`  ${TODO_WORDS}  `), "");
  same((await saved()).map(({ project, text }) => ({ project, text })), [{ project: id, text: TODO_WORDS }]);
  assert.ok(texts(page()).includes("1 open"));
  await submit("  ");
  assert.equal((await saved()).length, 1);

  const newer = "Publish the beta";
  now.mock.mockImplementation(() => 1_800_000_000_001);
  await submit(newer);
  const words = texts(page());
  assert.deepEqual(words.filter((word) => [TODO_WORDS, newer].includes(word)), [newer, TODO_WORDS]);
});

test("Adding a to-do in an unsaved connected space saves its project there and shows the item.", async (t) => {
  const { db, remoteDb, page, submit, saved } = await todoTasks(t, { project: remoteShopWithSlash, unsaved: true });
  same(await remoteDb.projects(), []);
  assert.equal(await submit(), "");
  const [project] = await remoteDb.projects();
  assert.ok(project.id);
  const { name, folder, machine } = project;
  assert.deepEqual({ name, folder, machine }, { name: shop.name, folder: shop.folder, machine: "" });
  same((await saved()).map((row) => [row.project, row.text]), [[project.id, TODO_WORDS]]);
  same(await db.projects(), []);
  assert.ok(texts(page()).includes(TODO_WORDS));
});

test("Adding a to-do with a trailing slash reuses the connected computer's project.", async (t) => {
  const { remoteDb, submit, saved } = await todoTasks(t, { project: remoteShopWithSlash });
  const home = await saveProject(remoteDb, shop);
  await submit();

  const [todo] = await saved();
  assert.equal(todo?.project, home.id, "Add writes to the existing project, not a duplicate");
  assert.equal((await remoteDb.projects()).length, 1);
});

const pendingTodo = (el) => /^tasks-todo-.*-pending$/.test(arg(el, "id"));

test("A submitted to-do appears pending before it is saved.", async (t) => {
  const { db, page, submit, saved, todoRowId } = await todoTasks(t);
  const write = Promise.withResolvers();
  const run = db.run.bind(db);
  t.mock.method(db, "run", async (sql) => {
    await write.promise;
    return run(sql);
  });
  const submitted = submit();
  try {
    const pending = page();
    assert.ok(texts(pending).includes(TODO_WORDS), "The to-do appears before SQLite replies");
    assert.ok(find(pending, pendingTodo), "The row is marked pending");
    assert.equal((await saved()).length, 0);
  } finally {
    write.resolve();
    await submitted;
  }
  const confirmed = control(page(), await todoRowId());
  assert.ok(confirmed);
  assert.equal(find(confirmed, pendingTodo), null);
});

test("A to-do marked done while it is being added stays done and pending until that mark is saved.", async (t) => {
  const { db, id, view, page, pending, enterTodo, click, drain, saved } = await todoTasks(t);
  const insert = Promise.withResolvers();
  const mark = Promise.withResolvers();
  const write = db.run.bind(db);
  t.mock.method(db, "run", async (sql) => {
    await (sql.startsWith("INSERT") ? insert : mark).promise;
    return write(sql);
  });

  enterTodo(TODO_WORDS);
  const [adding] = pending;
  const row = todoRowIdOf(view.shown()[0]);
  const done = `tasks-done-${id}`;
  try {
    click(row);
    click(done);
    assert.ok(find(control(page(), row), pendingTodo), "The mark appears pending in Done");

    insert.resolve();
    await adding;
    assert.equal((await saved())[0].done_at, null, "Only the insert has reached SQLite");
    const panel = page();
    assert.deepEqual(wordsAt(panel, done), ["Done", "1"], "Finishing the insert does not reopen the row");
    assert.ok(find(control(panel, row), pendingTodo), "The later mark is still pending");
  } finally {
    insert.resolve();
    await adding;
    mark.resolve();
    await drain();
  }
  assert.ok((await saved())[0].done_at > 0);
  assert.equal(find(control(page(), row), pendingTodo), null);
});

const holdTodoHome = (t, view) => {
  const lookup = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const homeOf = view.homeOf.bind(view);
  t.mock.method(view, "homeOf", async (id) => {
    reached.resolve();
    await lookup.promise;
    return homeOf(id);
  });
  return { lookup, reached };
};

test("Marking a new to-do done while it looks up a connected project saves it as done.", async (t) => {
  const { view, enterTodo, click, drain, saved } = await todoTasks(t, { project: remoteShop, unsaved: true });
  const { lookup, reached } = holdTodoHome(t, view);
  const db = await view.dbOn(remoteShop.machine);
  const run = db.run.bind(db);
  const writes = [];
  t.mock.method(db, "run", async (sql) => {
    if (/^(INSERT OR IGNORE INTO|UPDATE) todos\b/.test(sql)) writes.push(sql.split(" ")[0]);
    return run(sql);
  });

  enterTodo(TODO_WORDS);
  try {
    await reached.promise;
    click(todoRowIdOf(view.shown()[0]));
    await nextTurn();
  } finally {
    lookup.resolve();
    await drain();
  }
  assert.deepEqual(writes, ["INSERT", "UPDATE"]);
  const [row] = await saved();
  assert.equal(row?.text, TODO_WORDS);
  assert.ok(row.done_at > 0, "The done mark persists on the connected computer");
});

const finishedTodoTasks = async (t) => {
  const tasks = await todoTasks(t);
  await tasks.submit();
  const row = await tasks.todoRowId();
  tasks.click(row);
  await tasks.drain();
  return { ...tasks, row };
};

test("Clicking a to-do moves it into folded Done and clicking it there brings it back.", async (t) => {
  const { id, page, click, drain, saved, row } = await finishedTodoTasks(t);
  const done = `tasks-done-${id}`;
  const [finished] = await saved();
  const folded = page();
  assert.ok(finished.done_at > 0);
  assert.ok(texts(folded).includes("0 open"));
  assert.deepEqual(wordsAt(folded, done), ["Done", "1"]);
  assert.equal(control(folded, row), null);

  click(done);
  assert.ok(wordsAt(page(), row).includes(TODO_WORDS));
  click(row);
  await drain();
  const reopened = page();
  assert.equal((await saved())[0].done_at, null);
  assert.equal(control(reopened, done), null);
  for (const word of ["1 open", TODO_WORDS]) assert.ok(texts(reopened).includes(word), word);
});

const todoTool = ({ page, makeButton }, rowId, label) => {
  const panel = page();
  const row = control(panel, rowId);
  assert.ok(row);
  const tool = labelledControl(row, label);
  assert.ok(tool, `The to-do offers ${label} without hover`);
  assert.ok(makeButton.mock.calls.some(({ result }) => result === tool), `${label} is a button`);
  assert.ok(keyboard(panel).stops.includes(tool), `Tab reaches ${label}`);
  return tool;
};
const pressTodoTool = (tasks, rowId, label) => {
  const { cx } = tasks;
  const tool = todoTool(tasks, rowId, label);
  const before = cx.stop_propagation.mock.callCount();
  one(tool, "on_click")(null, cx);
  assert.equal(cx.stop_propagation.mock.callCount(), before + 1, `${label} does not pass the press to the row`);
};

const PROJECT_AGENT = "light/t1";
const INSTALLED_AGENTS = [
  { key: "claude", name: "Claude Code", run: ["claude"], installed: true },
  { key: "pi", name: "Pi", run: ["pi", "--model", "sol"], installed: true },
];
const conversationLabel = (name) => `New conversation · ${name}`;
const todoSendTasks = async (t, host = {}) => {
  const { folder } = remoteShop;
  const terminals = [
    [PROJECT_AGENT, folder, "Shop agent"],
    ["light/t2", `${folder}/src`, "Nested agent"],
    ["light/t3", "/work/acme", "Other project agent"],
    ["light/t4", `${folder}-other`, "Similar folder agent"],
    ["t5", folder, "Other computer agent"],
    ["light/t6", folder, "Shell only"],
  ].map(([address, cwd, name]) => ({ address, cwd, labels: { "kanso.shown": name } }));
  const knownAgents = t.mock.fn(async () => [...INSTALLED_AGENTS, { key: "absent", name: "Uninstalled", installed: false }]);
  const openOverlay = t.mock.fn();
  const tasks = await todoTasks(t, {
    project: remoteShop, knownAgents, openOverlay, terminals: () => terminals,
    agents: () => terminals.slice(0, -1).map(({ address }) => ({ address })),
    ...host,
  });
  await tasks.submit();
  const [todo] = await tasks.saved();
  const row = todoRowIdOf(todo);
  const recipient = `tasks-to-${todo.id}-${PROJECT_AGENT}`;
  const fresh = (agent) => `tasks-new-${todo.id}-${agent.key}`;
  const openSend = async () => {
    pressTodoTool(tasks, row, "Send to agent");
    await tasks.drain();
  };
  return { ...tasks, todo: { ...todo }, row, recipient, fresh, openSend, knownAgents, openOverlay };
};
const sentTo = (hc) => hc.mock.calls.map(({ arguments: [argv] }) => argv).filter(([verb]) => verb === "send");
const expectedSend = ["send", PROJECT_AGENT, TODO_WORDS];

test("The Tasks privacy notice says who receives the text when I send a to-do.", async () => {
  const html = await readFile(new URL("../site/privacy.html", import.meta.url), "utf8");
  const disclosure = html.match(/<li><strong>Tasks<\/strong>([^<]*)<\/li>/)?.[1] ?? "";
  assert.match(disclosure, /\bsends\b[^.]*\btext\b[^.]*\bonly to the agent you send it to\b/);
});

const sendChoices = ["In this project", "Shop agent", "Nested agent", ...INSTALLED_AGENTS.map(({ name }) => conversationLabel(name))];
const expectTodoSendChoices = (panel, row) => {
  const todoRow = control(panel, row);
  assert.ok(todoRow, "Opening Send does not move the to-do to another column");
  const siblings = todoRow.parent.kids;
  const start = siblings.indexOf(todoRow) + 1;
  assert.deepEqual(siblings.slice(start, start + sendChoices.length).map((el) => texts(el)[0]),
    sendChoices, "The send choices appear directly below their to-do");
};

test("Send opens choices under the to-do for this project's agents and installed agents, then sends and closes.", async (t) => {
  const hc = t.mock.fn(async () => success(""));
  const { todo, row, recipient, page, click, drain, saved, openSend, knownAgents, openOverlay } = await todoSendTasks(t, { hc });
  await openSend();

  const panel = page();
  expectTodoSendChoices(panel, row);
  for (const absent of ["Other project agent", "Similar folder agent", "Other computer agent", "Shell only", conversationLabel("Uninstalled")]) {
    assert.equal(texts(panel).includes(absent), false, absent);
  }
  assert.equal(openOverlay.mock.callCount(), 0);
  same(knownAgents.mock.calls.map(({ arguments: args }) => args), [[{ on: remoteShop.machine }]]);
  assert.deepEqual(sentTo(hc), []);

  click(recipient);
  await drain();
  same(sentTo(hc), [expectedSend]);
  assert.equal(texts(page()).some((word) => sendChoices.includes(word)), false, "The send choices close");
  same(await saved(), [todo]);
});

test("New conversation starts the chosen agent with the to-do in the project's terminal, tab, or space.", async (t) => {
  const spaces = t.mock.fn(activeSpace(remoteShop));
  const run = t.mock.fn();
  const { page, press, openSend, fresh } = await todoSendTasks(t, { spaces, run });
  const agent = INSTALLED_AGENTS[1];
  const choice = fresh(agent);
  for (const [open, command, options] of terminalPlacements()) {
    await openSend();
    assert.deepEqual(wordsAt(page(), choice), [conversationLabel(agent.name)]);
    const start = press(choice);
    spaces.mock.mockImplementation(() => open);
    start();
    spaces.mock.mockImplementation(activeSpace(remoteShop));
    const name = command === "tab.new" ? agent.name : command === "space.new" ? remoteShop.name : null;
    same(run.mock.calls.at(-1).arguments, [command, { ...options, ...(name ? { name } : {}), argv: [...agent.run, TODO_WORDS] }]);
    assert.equal(control(page(), choice), null);
  }
  assert.equal(run.mock.callCount(), terminalPlacements().length);
});

test("A failed send says Can't send and Retry sends the same to-do to the same agent.", async (t) => {
  const hc = t.mock.fn(async () => success(""));
  hc.mock.mockImplementationOnce(async () => failure("Agent disconnected"));
  const { page, click, drain, recipient, openSend } = await todoSendTasks(t, { hc });
  await openSend();
  assert.ok(control(page(), recipient), "Send offers the running agent");
  click(recipient);
  await drain();

  const failed = "tasks-failed";
  const retry = `${failed}-fix`;
  assert.ok(wordsAt(page(), failed).includes(`Can't send ${TODO_WORDS}`));
  assert.deepEqual(wordsAt(page(), retry), ["Retry"]);
  same(sentTo(hc), [expectedSend]);
  click(retry);
  await drain();
  same(sentTo(hc), [expectedSend, expectedSend]);
  assert.equal(control(page(), failed), null);
});

const deleteTodo = async (tasks, row) => {
  pressTodoTool(tasks, row, "Delete");
  await tasks.drain();
};
const undoRemoval = async ({ click, drain }) => {
  click("tasks-removed-undo");
  await drain();
};

test("Tasks shows a connected computer's agent to-do and keeps changes on that computer.", async (t) => {
  const name = "Release agent on light";
  const terminals = () => [{ address: `${remoteShop.machine}/${terminalId}`, labels: { "kanso.shown": name } }];
  const tasks = await todoTasks(t, { project: remoteShop, terminals });
  const { db, remoteDb, id, view, cx, drain, click, page, submit } = tasks;
  const home = await saveProject(remoteDb, shop);
  assert.notEqual(home.id, id);
  const todo = storedTodo(home.id, { by: terminalId });
  await writeTodo(remoteDb, todo);
  view.load(cx);
  await drain();

  const row = todoRowIdOf(todo);
  const words = wordsAt(page(), row);
  assert.ok(words.includes(todo.text), "The viewer finds the agent's to-do by project folder, not by its local project ID");
  assert.ok(words.some((word) => word.startsWith(`${name} · `)), "The viewer names the agent on the connected computer");

  const saved = () => remoteDb.read("SELECT * FROM todos ORDER BY created;");
  click(row);
  await drain();
  const beforeDelete = await saved();
  assert.ok(beforeDelete[0]?.done_at > 0);
  click(`tasks-done-${id}`);
  await deleteTodo(tasks, row);
  assert.equal((await saved()).length, 0, "Delete removes the item from the connected database");
  await undoRemoval(tasks);
  assert.deepEqual(await saved(), beforeDelete, "Undo restores the original project, author and completion");

  const added = "Publish the beta from light";
  await submit(added);
  const [, manual] = await saved();
  assert.equal(manual?.project, home.id);
  assert.equal(manual?.text, added);
  assert.ok(texts(page()).includes(added));
  same(await db.read("SELECT * FROM todos;"), []);
});

for (const state of ["open", "done"]) {
  test(`Send and Delete are available on ${state} to-dos without hover, and neither toggles completion.`, async (t) => {
    const tasks = await todoSendTasks(t);
    const { id, page, click, drain, saved, row, openSend } = tasks;
    if (state === "done") {
      click(row);
      await drain();
      click(`tasks-done-${id}`);
    }
    const before = await saved();
    assert.equal(before[0].done_at != null, state === "done");
    todoTool(tasks, row, "Delete");

    await openSend();
    expectTodoSendChoices(page(), row);
    assert.deepEqual(await saved(), before);

    await deleteTodo(tasks, row);
    same(await saved(), []);
    assert.equal(control(page(), row), null);
    assert.deepEqual(wordsAt(page(), "tasks-removed"), [`Deleted ${TODO_WORDS}`, "Undo"]);

    await undoRemoval(tasks);
    assert.deepEqual(await saved(), before);
    assert.ok(wordsAt(page(), row).includes(TODO_WORDS));
  });
}

test("Tasks hides another project's deletion feedback and offers Undo when I return.", async (t) => {
  const spaces = t.mock.fn(activeSpace(shop));
  const tasks = await todoTasks(t, { spaces });
  const visit = selectAt(tasks, spaces);
  const note = `Deleted ${TODO_WORDS}`;
  const feedback = () => wordsAt(tasks.page(), "tasks-removed");
  await tasks.submit();
  await deleteTodo(tasks, await tasks.todoRowId());
  assert.ok(feedback().includes(note));

  visit(acme);
  await tasks.drain();
  assert.deepEqual(feedback(), []);

  visit(shop);
  await tasks.drain();
  assert.ok(feedback().includes(note));
  await undoRemoval(tasks);
  assert.ok(texts(tasks.page()).includes(TODO_WORDS));
});

test("Undo restores a to-do deleted while it was finding its connected project.", async (t) => {
  const tasks = await todoTasks(t, { project: remoteShop, unsaved: true });
  const { view, enterTodo, drain, remoteDb, saved, page } = tasks;
  const { lookup, reached } = holdTodoHome(t, view);

  enterTodo(TODO_WORDS);
  let row;
  try {
    await reached.promise;
    const pending = view.shown()[0];
    assert.equal(pending.home, undefined, "Delete acts on a row without a remote project ID");
    row = todoRowIdOf(pending);
    pressTodoTool(tasks, row, "Delete");
  } finally {
    lookup.resolve();
    await drain();
  }
  assert.equal((await saved()).length, 0, "Delete reaches the connected database before Undo");
  assert.equal(control(page(), row), null);
  await undoRemoval(tasks);

  const [home] = await remoteDb.projects();
  const [restored] = await saved();
  assert.equal(restored?.project, home.id, "Undo saves the row under the connected computer's project ID");
  assert.ok(wordsAt(page(), row).includes(TODO_WORDS));
});

test("Undo after deleting an agent's to-do keeps its author.", async (t) => {
  const tasks = await todoTasks(t);
  const { db, id, view, cx, drain } = tasks;
  const todo = storedTodo(id, { by: terminalId });
  await db.run(`INSERT INTO todos(id,project,text,created,by)
    VALUES('${todo.id}','${todo.project}','${todo.text}',${todo.created},'${todo.by}');`);
  view.load(cx);
  await drain();

  await deleteTodo(tasks, todoRowIdOf(todo));
  const authors = () => db.read("SELECT by FROM todos;");
  same(await authors(), []);
  await undoRemoval(tasks);
  assert.equal((await authors())[0]?.by, terminalId);
});
