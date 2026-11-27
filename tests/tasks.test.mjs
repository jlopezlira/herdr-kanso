import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  all, arg, calls, databaseTimer, drawingHost, exec, failure, find, KIT_NIGHT, load,
  nativePlatform, nativeWindow, one, same, success, svgsOf, temporary, texts, timedContext,
} from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const shop = { id: "shop", name: "Shop", folder: "/work/shop", machine: null };
const acme = { id: "acme", name: "Acme", folder: "/work/acme", machine: null };
const remoteShop = { ...shop, machine: "light" };
const remoteShopWithSlash = { ...remoteShop, folder: `${remoteShop.folder}/` };
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
  const click = (id) => {
    const target = control(page(), id);
    assert.ok(target, id);
    one(target, "on_click")(null, cx);
  };
  return { view, cx, drain, pending, page, click };
};

const storedTodo = (project, extra = {}) => ({ id: project, project, text: TODO_WORDS, created: 1000, ...extra });
const writeTodo = async (db, { id, project, text, created, by, detail, started_at, done_at }) => {
  const { q } = await load("kanso-panel/kdb.js", ["q"]);
  const values = [id, project, text, created, by, detail, started_at, done_at].map(q).join(",");
  await db.run(`INSERT INTO todos(id,project,text,created,by,detail,started_at,done_at) VALUES(${values});`);
};
const stepId = ({ id }) => `tasks-step-${id}`;
const sentTo = (hc) => hc.mock.calls.map(({ arguments: [argv] }) => argv).filter(([verb]) => verb === "send");
const followWithin = (every, cx) => {
  for (const { arguments: [ms, tick] } of every.mock.calls) if (ms <= FOLLOW_MS) tick(cx);
};
const polledTasks = async (t, db, host = {}) => {
  const every = t.mock.fn(() => ({ cancel() {} }));
  const notify = t.mock.fn();
  const tasks = await startTasks(db, host, { every, notify });
  const tick = every.mock.calls.find(({ arguments: [ms] }) => ms === 4000)?.arguments[1];
  assert.equal(typeof tick, "function", "Tasks schedules the to-do poll every four seconds");
  return {
    ...tasks, notify,
    follow: () => followWithin(every, tasks.cx),
    poll: async () => { tick(tasks.cx); await tasks.drain(); },
  };
};

const shopKdb = async (t) => {
  const { db } = await temporaryKdb(t);
  return { db, ...(await saveProject(db, shop)) };
};

test("The to-do poll redraws when an agent changes the list but keeps the same rows when nothing changed.", async (t) => {
  const { db, id } = await shopKdb(t);
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
  const step = storedTodo(id);
  await writeTodo(db, step);
  await poll();
  assert.ok(wordsAt(page(), stepId(step)).includes(step.text));
});

test("Tasks follows a newly opened unsaved project and shows its empty state within 300 ms.", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = t.mock.fn(activeSpace(shop));
  const { view, page, follow } = await polledTasks(t, db, { spaces });
  assert.equal(view.frontProject(), `:${shop.folder}`);
  spaces.mock.mockImplementation(activeSpace(acme));
  follow();

  assert.equal(view.frontProject(), `:${acme.folder}`);
  assert.ok(control(page(), "tasks-none"));
  same(await db.projects(), []);
});

test("Tasks shows the saved repository's to-do from an unsaved space in a subfolder.", async (t) => {
  const { db } = await temporaryKdb(t);
  const repo = { ...shop, folder: "/work/repo" };
  const mobile = { id: "mobile", name: "Mobile", folder: `${repo.folder}/mobile` };
  const { id } = await saveProject(db, repo);
  const todo = storedTodo(id);
  await writeTodo(db, todo);

  const { page } = await startTasks(db, { spaces: activeSpace(mobile) });
  assert.ok(wordsAt(page(), stepId(todo)).includes(TODO_WORDS), "The repository's to-do is visible in Mobile");
});

test("Tasks redraws for the sidebar's active project within 300 ms even when no to-dos change.", async (t) => {
  const { db } = await temporaryKdb(t);
  const textsByProject = [TODO_WORDS, "Review the migration"];
  for (const [index, project] of [shop, acme].entries()) {
    const { id } = await saveProject(db, project);
    await writeTodo(db, storedTodo(id, { text: textsByProject[index] }));
  }
  const reads = t.mock.method(db, "read");
  const spaces = t.mock.fn(selectProject(shop));
  const { page, follow, drain, notify } = await polledTasks(t, db, { spaces });
  const visibleSteps = () => texts(page()).filter((word) => textsByProject.includes(word));

  assert.deepEqual(visibleSteps(), [textsByProject[0]]);
  const before = { redraws: notify.mock.callCount(), reads: reads.mock.callCount() };
  spaces.mock.mockImplementation(selectProject(acme));
  follow();
  assert.ok(notify.mock.callCount() > before.redraws, "Switching spaces requests a redraw without waiting on I/O");
  await drain();
  assert.equal(reads.mock.callCount(), before.reads, "Following the active space does not reread to-dos");
  assert.deepEqual(visibleSteps(), [textsByProject[1]]);
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
  const { page } = await startTasks(db, { spaces: activeSpace(shop) });
  const panel = page();
  assert.ok(!texts(panel).includes(TODO_WORDS));
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

test("Empty Tasks installs the rule before telling running agents, even if the switch is already on.", async (t) => {
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
    "status", "steps", "install", "status", "rule", "steps", "install", "status", "rule",
  ]);
  same(sentTo(hc), [local, refused, local, refused].map((address) => ["send", address, rule]));
});

test("Tasks shows what could not be installed alongside the note about who was told.", async (t) => {
  const skipped = "Codex already has developer instructions.";
  const replies = [success("off\n"), success("add start done list\n"), failure(skipped), success("on\n"), success("Keep your to-do up to date.")].values();
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

const remoteTodoHost = async (t, Kdb, machine, {
  todoExec = async () => success("off\n"), readPlans = () => undefined,
} = {}) => {
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
    if (command === "sqlite3" && args.some((arg) => arg.includes("SELECT todos.*"))) {
      const reply = readPlans();
      if (reply) return reply;
    }
    return exec(command, args, options);
  };
  return { db, host: { exec: run, window: nativeWindow } };
};

const todoTasks = async (t, host = {}) => {
  const { db } = await temporaryKdb(t);
  return startTasks(db, { spaces: activeSpace(shop), ...host });
};

const tasksOnLight = async (t, remoteExec, { todoExec, heldProject, readPlans, ...host } = {}) => {
  const { db, Kdb } = await temporaryKdb(t);
  const remote = await remoteTodoHost(t, Kdb, remoteShop.machine, { todoExec: remoteExec, readPlans });
  if (heldProject) {
    const { id } = await saveProject(remote.db, heldProject);
    await writeTodo(remote.db, storedTodo(id));
  }
  return polledTasks(t, db, {
    ...remote.host, window: () => ({ platform: "macos" }),
    spaces: activeSpace(remoteShop), todoExec, ...host,
  });
};
const todoVerbs = (mock) => mock.mock.calls.flatMap(({ arguments: args }) => args);
const LIGHT_TODO_RULE = "Keep the project to-do up to date.";

const switchScript = (installed = false) => {
  const script = (verb) => {
    if (verb === "install") installed = true;
    return success(verb === "rule" ? LIGHT_TODO_RULE : installed ? "on\n" : "off\n");
  };
  script.turnOff = () => { installed = false; };
  return script;
};

const lightTodoSwitch = async (t, { initiallyOn = false, ...host } = {}) => {
  const remote = t.mock.fn(async (verb) => script(verb));
  const script = switchScript(initiallyOn);
  const tasks = await tasksOnLight(t, remote, host);
  const installFrom = async (action, label) => {
    assert.deepEqual(wordsAt(tasks.page(), action), [label]);
    const before = remote.mock.callCount();
    tasks.click(action);
    await tasks.drain();
    assert.deepEqual(todoVerbs(remote).slice(before), ["steps", "install", "status", "rule"]);
  };
  return { ...tasks, remote, installFrom, turnOff: script.turnOff };
};

test("Tasks can turn on agents on light when the project already has a to-do.", async (t) => {
  const { page, installFrom } = await lightTodoSwitch(t, { heldProject: shop });
  assert.ok(texts(page()).includes(TODO_WORDS), "The project already shows a to-do");
  await installFrom("tasks-switch", TURN_ON);
});

test("Tasks on Windows can turn on agents for the active project on light.", async (t) => {
  const { installFrom } = await lightTodoSwitch(t, { window: () => ({ platform: "windows" }) });
  await installFrom("tasks-none-action", TURN_ON);
});

test("Tell running agents turns the rule back on when it was turned off on light.", async (t) => {
  const { view, cx, drain, installFrom, turnOff } = await lightTodoSwitch(t, { initiallyOn: true });
  turnOff();
  view.follow(cx);
  view.load(cx);
  await drain();

  await installFrom("tasks-none-action", TELL);
});

test("One press in Tasks turns on the to-do on light and tells only light's running agents.", async (t) => {
  const local = t.mock.fn(async (verb) => success(verb === "rule" ? "Local to-do rule" : "off\n"));
  const running = `${remoteShop.machine}/t3`;
  const agents = () => [
    ...[terminalId, "grey/t2", running].map((address) => ({ address, status: "working" })),
    { address: `${remoteShop.machine}/t4`, status: "blocked" },
  ];
  const hc = t.mock.fn(async () => success(""));
  const { click, drain, remote } = await lightTodoSwitch(t, { todoExec: local, agents, hc });
  click("tasks-none-action");
  await drain();

  same(
    { light: todoVerbs(remote), local: todoVerbs(local), sent: sentTo(hc) },
    { light: ["status", "steps", "install", "status", "rule"], local: [], sent: [["send", running, LIGHT_TODO_RULE]] },
  );
});

test("Empty Tasks reads light's switch rather than this computer's switch.", async (t) => {
  const { page } = await tasksOnLight(t, async () => success("on\n"), {
    todoExec: async () => success("off\n"),
  });
  assert.deepEqual(wordsAt(page(), "tasks-none-action"), [TELL]);
});

test("Turn on tells me to update light's older kansō without installing or reading the rule.", async (t) => {
  const unsupported = failure('kanso-todo: usage: kanso-todo add "<step>" "<detail>"');
  const remote = t.mock.fn(async (verb) => verb === "steps" ? unsupported : success("off\n"));
  const { click, drain, page } = await tasksOnLight(t, remote);
  const action = "tasks-none-action";
  assert.deepEqual(wordsAt(page(), action), [TURN_ON]);
  click(action);
  await drain();

  const notice = "light has an older kansō: update it there, then turn this on again.";
  assert.ok(wordsAt(page(), "tasks-turned").includes(notice));
  assert.deepEqual(todoVerbs(remote), ["status", "steps"]);
});

test("Tasks offers no Turn on button when light runs Windows.", async (t) => {
  const windows = async (program, args, { on }) => {
    assert.equal(on, remoteShop.machine);
    const command = args.at(-1);
    if (command.includes("OSVersion.Platform")) return success("Win32NT");
    if (command.endsWith("$HOME")) return success("C:\\Users\\agent");
    if (program === "sqlite3") return success(args.filter((arg) => arg.startsWith(".print ")).map((arg) => arg.slice(7)).join("\n"));
    return program === "pwsh" ? success("") : failure("Command not found");
  };
  const { page } = await todoTasks(t, { spaces: activeSpace(remoteShop), exec: windows });
  const panel = page();
  assert.ok(wordsAt(panel, "tasks-none").length, "The Windows project has loaded");
  assert.equal(control(panel, "tasks-none-action"), null);
});

test("Tasks refreshes light's switch after 15 seconds without leaving the project.", async (t) => {
  let now = 1_800_000_000_000;
  const { page, poll, remote, turnOff } = await lightTodoSwitch(t, {
    initiallyOn: true,
    Date: class extends globalThis.Date { static now() { return now; } },
  });
  const label = () => wordsAt(page(), "tasks-none-action");
  assert.deepEqual(label(), [TELL]);
  turnOff();

  now += 14_999;
  await poll();
  assert.deepEqual(label(), [TELL]);
  now += 1;
  await poll();
  assert.deepEqual(label(), [TURN_ON]);
  assert.deepEqual(todoVerbs(remote), ["status", "status"]);
});

const unreachablePlans = () => failure("Connection to light failed");

test("Tasks says it cannot read light's plans and hides Turn on when it has no cached steps.", async (t) => {
  const { page } = await tasksOnLight(t, undefined, { readPlans: unreachablePlans });
  const panel = page();
  assert.ok(wordsAt(panel, "tasks-unread").includes("Could not reach light to read its plans"));
  assert.ok(!texts(panel).includes(TURN_ON));
});

test("Tasks keeps light's cached steps and warns they may be out of date after a failed read.", async (t) => {
  let reachable = true;
  const { page, poll } = await tasksOnLight(t, undefined, {
    heldProject: shop,
    readPlans: () => reachable ? undefined : unreachablePlans(),
  });
  assert.ok(texts(page()).includes(TODO_WORDS));
  assert.equal(control(page(), "tasks-unread"), null);

  reachable = false;
  await poll();
  const panel = page();
  assert.ok(texts(panel).includes(TODO_WORDS));
  assert.ok(wordsAt(panel, "tasks-unread").includes("Could not reach light; these steps may be out of date"));
});

test("Tasks shows the plan kept in light's saved repository from an unsaved subfolder on light.", async (t) => {
  const repo = { ...shop, folder: "/repo" };
  const spaces = activeSpace({ ...remoteShop, folder: `${repo.folder}/pkg` });
  const { page } = await tasksOnLight(t, undefined, { heldProject: repo, spaces });
  assert.ok(texts(page()).includes(TODO_WORDS));
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
  let held = false;
  const script = switchScript();
  const remote = async (verb) => {
    if (verb === "status" && !held) {
      held = true;
      reading.resolve();
      return stale.promise;
    }
    return script(verb);
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


test("Tasks groups plan steps by computer and agent, in creation order, with work in progress first.", async () => {
  const { plansOf, stepState } = await load("kanso-panel/todo.js", ["plansOf", "stepState"]);
  const step = (id, created, props = {}) => ({ place: "shop", ...storedTodo(shop.id, { id, created, by: terminalId, ...props }) });
  const todos = [
    step("next", 30),
    step("remote", 90, { on: remoteShop.machine }),
    step("finished", 10, { started_at: 11, done_at: 15 }),
    step("doing", 20, { started_at: 25 }),
    step("other agent", 80, { by: "t2" }),
    step("other project", 100, { project: acme.id, place: "acme", started_at: 101 }),
  ];
  same(plansOf(todos.filter((s) => s.place === "shop")).map(({ on, by, steps }) => [on, by, steps.map((s) => [s.id, stepState(s)])]), [
    ["", terminalId, [["finished", "done"], ["doing", "doing"], ["next", "next"]]],
    [remoteShop.machine, terminalId, [["remote", "next"]]],
    ["", "t2", [["other agent", "next"]]],
  ]);
});

const iconsIn = (element) => svgsOf(element).map((path) => path.split("/").at(-1));

test("Tasks puts a step created before a terminal was reused under the ended agent without the working mark.", async (t) => {
  const { db, id } = await shopKdb(t);
  const earlier = storedTodo(id, { by: terminalId, started_at: 1200 });
  const name = "Current agent";
  await writeTodo(db, earlier);
  const { page } = await startTasks(db, {
    spaces: activeSpace(shop),
    terminals: () => [{ address: terminalId, created_ms: 2000, labels: { "kanso.shown": name } }],
  });

  const panel = page();
  const item = control(panel, stepId(earlier));
  assert.ok(item, "The ended agent's step still shows");
  assert.ok(texts(item.parent).includes("An agent that has ended"));
  assert.ok(!iconsIn(item).includes("working.svg"));
});

test("A Tasks step wraps its detail instead of truncating it.", async (t) => {
  const { db, id } = await shopKdb(t);
  const detail = "Read the upgrade guide and check that each supported version can still open the project.";
  const step = storedTodo(id, { detail });
  await writeTodo(db, step);
  const { page } = await startTasks(db, { spaces: activeSpace(shop) });

  const item = control(page(), stepId(step));
  assert.ok(item, "The step is visible");
  const second = find(item, (element) => arg(element, "child") === detail);
  assert.ok(second, "The row shows the entire detail");
  assert.equal(calls(second, "truncate").length, 0);
});

test("Tasks shows each agent's read-only plan with detail, progress, and finished steps under Done.", async (t) => {
  const { db, id } = await shopKdb(t);
  const name = "Release agent";
  const now = 1_800_000_000_000;
  const ago = (minutes) => now - minutes * 60_000;
  const makeStep = (key, text, detail, props) =>
    storedTodo(id, { id: key, text, detail, by: terminalId, created: ago(15), ...props });
  const finished = makeStep("finished", "Read the notes", "Find any breaking changes", { started_at: ago(9), done_at: ago(7) });
  const doing = makeStep("doing", "Write the summary", "Call out user-facing changes", { started_at: ago(3) });
  const next = makeStep("next", "Publish the beta", "Wait for the macOS checks", { created: ago(10) });
  const ended = makeStep("ended", "Check Linux", "Read the last build log", { by: "t8", created: ago(14) });
  const anonymous = makeStep("anonymous", "Check Windows", "Confirm the installer signed", { by: null });
  for (const step of [finished, doing, next, ended, anonymous]) await writeTodo(db, step);

  const makeInput = t.mock.fn();
  const makeCheckbox = t.mock.fn();
  const { page, click } = await startTasks(db, {
    spaces: activeSpace(shop),
    terminals: () => [{ address: terminalId, labels: { "kanso.shown": name } }],
    Date: class extends globalThis.Date { static now() { return now; } },
    Input: { new: makeInput }, InputState: { new: makeInput }, Checkbox: { new: makeCheckbox },
  });

  const panel = page();
  const headings = all(panel, ({ kids }) => {
    const note = kids.length === 2 && arg(kids[1], "child");
    return typeof note === "string" && /^\d+ of \d+ done$/.test(note);
  });
  assert.deepEqual(headings.map(texts), [
    [name, "1 of 3 done"],
    ["An agent that has ended", "0 of 1 done"],
    ["Steps without an agent", "0 of 1 done"],
  ]);
  const [livePlan, endedPlan, anonymousPlan] = headings.map(({ parent }) => parent);
  const checkStep = (plan, step, time, icon) => {
    const item = control(plan, stepId(step));
    assert.ok(item, step.text);
    const [first, second] = item.kids[0].kids;
    assert.deepEqual(texts(first), [step.text, time]);
    assert.deepEqual(texts(second), [step.detail]);
    assert.deepEqual(iconsIn(item), [icon]);
    assert.equal(arg(item, "on_click"), undefined, "A step is not a toggle");
  };
  checkStep(livePlan, doing, "3m", "working.svg");
  checkStep(livePlan, next, "10m", "circle.svg");
  checkStep(endedPlan, ended, "14m", "circle.svg");
  checkStep(anonymousPlan, anonymous, "15m", "circle.svg");
  const done = `tasks-done-:${terminalId}:`;
  assert.deepEqual(wordsAt(livePlan, done), ["Done", "1"]);
  assert.equal(control(panel, stepId(finished)), null);

  click(done);
  const expanded = page();
  checkStep(expanded, finished, "7m", "check.svg");
  click(done);
  assert.equal(control(page(), stepId(finished)), null);

  assert.equal(makeInput.mock.callCount(), 0);
  assert.equal(makeCheckbox.mock.callCount(), 0);
  assert.ok(!iconsIn(expanded).includes("square.svg"), "The plan does not draw a checkbox");
});

test("Tasks follows a project on light by folder, and names the agent from light's live terminal.", async (t) => {
  const { db, Kdb } = await temporaryKdb(t);
  const remote = await remoteTodoHost(t, Kdb, remoteShop.machine);
  const home = await saveProject(remote.db, shop);
  const saved = await saveProject(db, remoteShopWithSlash);
  assert.notEqual(home.id, saved.id);

  const name = "Release agent on light";
  const terminals = () => [
    { address: terminalId, labels: { "kanso.shown": "Local agent" } },
    { address: `${remoteShop.machine}/${terminalId}`, labels: { "kanso.shown": name } },
  ];
  const spaces = () => [{ ...remoteShopWithSlash, active: true }];
  const { page, poll } = await polledTasks(t, db, { ...remote.host, terminals, spaces });
  assert.ok(control(page(), "tasks-none"));

  const step = storedTodo(home.id, { by: terminalId, detail: "Assemble the tested changes" });
  await writeTodo(remote.db, step);
  await poll();
  const panel = page();
  const words = texts(panel);
  assert.ok(words.includes(name));
  assert.ok(!words.includes("Local agent"));
  for (const word of [step.text, step.detail]) assert.ok(wordsAt(panel, stepId(step)).includes(word), word);
  same(await db.read("SELECT * FROM todos;"), []);
});

const shopAndAcme = async (t) => {
  const { db, id } = await shopKdb(t);
  return { db, id, other: await saveProject(db, acme) };
};

test("Tasks shows, per agent, the plans of the agents in a space that has no folder, and of their helpers.", async (t) => {
  const { db, id, other } = await shopAndAcme(t);
  const steps = [
    storedTodo(id, { id: "lead", text: "Plan the release", detail: "Order the work", by: "t1", created: 10 }),
    storedTodo(id, { id: "helper", text: "Write the tests", detail: "One per fix", by: "t2", created: 20 }),
    storedTodo(id, { id: "earlier", text: "Earlier work", detail: "From a session that ended", by: "t9", created: 5 }),
    storedTodo(other.id, { id: "elsewhere", text: "Another project", detail: "Not in this space", by: "t7", created: 30 }),
    storedTodo(other.id, { id: "lead-elsewhere", text: "Old acme step", detail: "Another project of the same agent", by: "t1", created: 1 }),
    storedTodo(id, { id: "deep", text: "Check one fix", detail: "A helper's helper", by: "t3", created: 25 }),
  ];
  for (const step of steps) await writeTodo(db, step);
  const { page } = await startTasks(db, {
    spaces: () => [{ id: "kanso", name: "herdr-kanso", folder: "", machine: null, active: true }, { id: "acme", name: "Acme", folder: "", machine: null, active: false }],
    agents: () => [{ address: "t1", space: "kanso", status: "working" }, { address: "t7", space: "acme", status: "working" }],
    terminals: () => [
      { address: "t1", labels: { "kanso.shown": "Lead" } },
      { address: "t2", parent: "t1", labels: { "kanso.shown": "Tester" } },
      { address: "t3", parent: "t2", labels: { "kanso.shown": "Checker" } },
      { address: "t7", labels: { "kanso.shown": "Other" } },
    ],
  });
  const panel = page();
  for (const step of [...steps.slice(0, 3), steps[5]]) assert.ok(control(panel, stepId(step)), step.text);
  for (const step of steps.slice(3, 5)) assert.equal(control(panel, stepId(step)), null, step.text);
  const words = texts(panel);
  for (const name of ["Lead", "Tester", "Checker", "An agent that has ended"]) assert.ok(words.includes(name), name);
  assert.ok(!words.includes("Other"));
});

test("Tasks for a space with a folder leaves out its agents' steps in other projects.", async (t) => {
  const { db, id, other } = await shopAndAcme(t);
  const here = storedTodo(id, { id: "here", text: "Shop plan", detail: "In this project", by: "t1", created: 10 });
  const away = storedTodo(other.id, { id: "away", text: "Old acme step", detail: "Another project", by: "t1", created: 20 });
  for (const step of [here, away]) await writeTodo(db, step);
  const { page } = await startTasks(db, {
    spaces: () => [{ ...shop, id: "shop-space", active: true }],
    agents: () => [{ address: "t1", space: "shop-space", status: "working" }],
    terminals: () => [{ address: "t1", labels: { "kanso.shown": "Lead" } }],
  });
  assert.ok(control(page(), stepId(here)));
  assert.equal(control(page(), stepId(away)), null);
});
