import test from "node:test";
import assert from "node:assert/strict";
import { arg, chain, drawingHost, failure, fieldWith, find, KIT_NIGHT, load, one, press, same, success, tape, texts, timedContext } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const PR_URL = "https://github.com/acme/shop/issues/12";
const REPO = { host: "github.com", owner: "acme", name: "shop" };
const clock = (at) => new Date(at).toTimeString().slice(0, 5);

const issue = (extra = {}) => ({
  url: PR_URL, source: "github", project: "shop", ticket: "#12", number: 12, repo: "acme/shop",
  title: "Ship it", status: "Open", priority: null, labels: "[]", assignees: JSON.stringify(["JJ"]),
  author: "ada", created_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-22T12:00:00Z", body: "The body", read_at: 1,
  ...extra,
});

const node = (status) => ({
  number: 12, title: "Ship it", url: PR_URL, body: "The body",
  createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-22T12:00:00Z",
  author: { login: "ada" }, assignees: { nodes: [{ login: "JJ" }] }, labels: { nodes: [{ name: "bug" }] },
  projectItems: { nodes: [{ project: { field: { options: [{ name: "Open" }, { name: "Done" }] } }, fieldValueByName: status ? { name: status } : {} }] },
});

const payload = (nodes) => ({ code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes } } } }), stderr: "" });
const named = (args, key) => args.some((part) => part === key || String(part).startsWith(key));
const boardRun = async () => {
  const { readBoard } = await load("kanso-panel/issues-github.js", ["readBoard"]);
  return { readBoard, calls: [] };
};
const storeDb = async (t, names) => ({ ...(await temporaryKdb(t)), ...(await load("kanso-panel/issues-store.js", names)) });
const rowsOf = (t) => storeDb(t, ["storeSql", "readIssues"]);

test("Board columns stay in order, an issue with no status sits under Open, empty columns stay, and newer issues come first", async () => {
  const { sectionsOf, OPEN } = await load("kanso-panel/issues-model.js", ["sectionsOf", "OPEN"]);
  const older = issue({ url: "https://github.com/acme/shop/issues/1", title: "Older", updated_at: "2026-11-01T00:00:00Z" });
  const newer = issue({ url: "https://github.com/acme/shop/issues/2", title: "Newer", updated_at: "2026-11-22T00:00:00Z" });
  const loose = issue({ url: "https://github.com/acme/shop/issues/3", title: "Loose", status: null, updated_at: "2026-10-01T00:00:00Z" });
  const sections = sectionsOf([older, newer, loose], ["Done", "Open", "Review"]);
  same(sections.map((section) => section.status), ["Done", "Open", "Review"]);
  assert.equal(sections.find((section) => section.status === "Review").rows.length, 0);
  same(sections.find((section) => section.status === OPEN).rows.map((row) => row.title), ["Newer", "Older", "Loose"]);
});

test("Done is folded unless a stored fold says otherwise", async () => {
  const { isFolded, foldKey, DONE } = await load("kanso-panel/issues-model.js", ["isFolded", "foldKey", "DONE"]);
  assert.equal(isFolded({}, "shop", DONE), true);
  assert.equal(isFolded({}, "shop", "Open"), false);
  assert.equal(isFolded({ [foldKey("shop", DONE)]: false }, "shop", DONE), false);
  assert.equal(isFolded({ [foldKey("shop", "Open")]: true }, "shop", "Open"), true);
});

test("Assigned matches the assignee list ignoring case, created matches the author, and all matches every row", async () => {
  const { matches } = await load("kanso-panel/issues-model.js", ["matches"]);
  const row = issue();
  assert.equal(matches(row, "assigned", "jj"), true);
  assert.equal(matches(row, "assigned", "ada"), false);
  assert.equal(matches(row, "created", "ada"), true);
  assert.equal(matches(row, "created", "jj"), false);
  assert.equal(matches(issue({ assignees: "[]", author: "other" }), "all", "jj"), true);
});

test("The front project is listed before the others", async () => {
  const { projectsInOrder } = await load("kanso-panel/issues-model.js", ["projectsInOrder"]);
  const projects = [{ id: "acme", name: "Acme" }, { id: "shop", name: "Shop" }, { id: "zoo", name: "Zoo" }];
  same(projectsInOrder(projects, "shop").map((project) => project.id), ["shop", "acme", "zoo"]);
});

test("An age is minutes, then hours, then days", async () => {
  const { ageOf } = await load("kanso-panel/issues-model.js", ["ageOf"]);
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(ageOf("2026-11-22T11:55:00Z", now), "5m");
  assert.equal(ageOf("2026-11-22T09:00:00Z", now), "3h");
  assert.equal(ageOf("2026-11-18T12:00:00Z", now), "4d");
});

test("The text sent to an agent has the ticket, the title, the link and the body", async () => {
  const { sendText } = await load("kanso-panel/issues-model.js", ["sendText"]);
  assert.equal(sendText(issue()), ["#12 Ship it", PR_URL, "The body"].join("\n\n"));
});

test("A board read keeps the status columns, and the filter query names the login only for assigned or created", async () => {
  const { readBoard, calls } = await boardRun();
  const run = async (cmd, args) => { calls.push(args); return payload([node("Open")]); };
  const board = await readBoard(run, { repo: REPO, project: "shop", filter: "assigned", login: "jj" });
  same(board.columns, ["Open", "Done"]);
  assert.equal(board.rows[0].status, "Open");
  assert.equal(board.rows[0].ticket, "#12");
  assert.equal(named(calls[0], "assignee=jj"), true);
  assert.equal(named(calls[0], "author=jj"), false);
  calls.length = 0;
  await readBoard(run, { repo: REPO, project: "shop", filter: "created", login: "jj" });
  assert.equal(named(calls[0], "author=jj"), true);
  assert.equal(named(calls[0], "assignee=jj"), false);
  calls.length = 0;
  await readBoard(run, { repo: REPO, project: "shop", filter: "all", login: "jj" });
  assert.equal(named(calls[0], "assignee=jj"), false);
  assert.equal(named(calls[0], "author=jj"), false);
});

test("A missing project scope is read again without project items, and that read says there is no project", async () => {
  const { readBoard, calls } = await boardRun();
  const answers = [
    { code: 1, stdout: "", stderr: "INSUFFICIENT_SCOPES: read:project" },
    payload([node(null)]),
  ];
  const run = async (_cmd, args) => { calls.push(args); return answers.shift(); };
  const board = await readBoard(run, { repo: REPO, project: "shop", filter: "all", who: "jj" });
  assert.equal(board.noProjects, true);
  assert.equal(calls[1].some((part) => String(part).includes("projectItems")), false);
  assert.equal(board.rows[0].status, null);
});

test("A rate limit names when to retry, and an offline read is offline", async () => {
  const { readBoard } = await boardRun();
  const now = 1_700_000_000_000;
  const reset = Math.floor(now / 1000) + 180;
  const limited = await readBoard(async () => ({ code: 1, stdout: "", stderr: "rate limit exceeded\nX-RateLimit-Reset: " + reset }), { repo: REPO, project: "shop", filter: "all", who: "jj", now });
  same(limited.failure, { kind: "rate", text: "GitHub is limiting requests", retryAt: reset * 1000 });
  const offline = await readBoard(async () => ({ code: 1, stdout: "", stderr: "could not resolve host" }), { repo: REPO, project: "shop", filter: "all", who: "jj", now });
  assert.equal(offline.failure.kind, "offline");
});

test("A detail read keeps the comments and the linked pull requests", async () => {
  const { readDetail } = await load("kanso-panel/issues-github.js", ["readDetail"]);
  const body = { data: { repository: { issue: { body: "The body", comments: { nodes: [{ author: { login: "ada" }, body: "Looks good", createdAt: "2026-11-22T01:00:00Z" }] }, closedByPullRequestsReferences: { nodes: [{ number: 9, title: "Fix", url: "https://github.com/acme/shop/pull/9", state: "OPEN" }] } } } } };
  const detail = await readDetail(async () => ({ code: 0, stdout: JSON.stringify(body), stderr: "" }), { repo: REPO, number: 12 });
  same(JSON.parse(detail.comments), [{ author: "ada", body: "Looks good", at: "2026-11-22T01:00:00Z" }]);
  same(JSON.parse(detail.prs), [{ number: 9, title: "Fix", url: "https://github.com/acme/shop/pull/9", state: "OPEN" }]);
});

test("The origin remote is the repository", async () => {
  const { repoOf } = await load("kanso-panel/issues-github.js", ["repoOf"]);
  const { repo } = await repoOf(async (_cmd, args) => ({ code: 0, stdout: args?.includes("-v") ? "origin\tgit@github.com:acme/shop.git (fetch)\n" : "", stderr: "" }), "/work/shop");
  assert.equal(repo.owner, "acme");
  assert.equal(repo.name, "shop");
  assert.equal(repo.host, "github.com");
});

const keptRow = (url, extra) => issue({ url, ...extra });

test("A stored read writes the rows and the board, and a later read drops only the rows of that filter", async (t) => {
  const { db, storeSql, readIssues } = await rowsOf(t);
  const assigned = keptRow("https://github.com/acme/shop/issues/1", { ticket: "#1", title: "Assigned", assignees: JSON.stringify(["JJ"]), author: "ada" });
  const other = keptRow("https://github.com/acme/shop/issues/2", { ticket: "#2", title: "Created", assignees: "[]", author: "ada" });
  const stale = keptRow("https://github.com/acme/shop/issues/3", { ticket: "#3", title: "Gone", assignees: JSON.stringify(["jj"]), author: "ada" });
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [assigned, other, stale], columns: ["Open", "Done"], kept: [], now: 10 }));
  const first = await readIssues(db, ["shop"]);
  assert.equal(first.rows.length, 3);
  assert.equal(first.boards[0].filter, "assigned");
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [assigned], columns: ["Open", "Done"], kept: first.rows, now: 12 }));
  const next = await readIssues(db, ["shop"]);
  same(next.rows.map((row) => row.title).toSorted(), ["Assigned", "Created"]);
});

test("A failed read keeps the rows and the last time, and records the failure", async (t) => {
  const { db, storeSql, readIssues } = await rowsOf(t);
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [issue()], columns: ["Open"], kept: [], now: 20 }));
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", rows: [], columns: [], failure: { kind: "offline", text: "GitHub can't be reached" }, now: 99 }));
  const read = await readIssues(db, ["shop"]);
  assert.equal(read.rows.length, 1);
  assert.equal(read.boards[0].read_at, 20);
  same(JSON.parse(read.boards[0].failure), { kind: "offline", text: "GitHub can't be reached" });
});

test("A detail write adds the comments and the pull requests, and a read returns both", async (t) => {
  const { db, storeSql, detailSql, readIssues } = await storeDb(t, ["storeSql", "detailSql", "readIssues"]);
  await db.run(storeSql({ project: "shop", source: "github", filter: "all", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [issue()], columns: ["Open"], kept: [], now: 1 }));
  await db.run(detailSql("shop", PR_URL, { body: "The body", comments: JSON.stringify([{ author: "ada", body: "Yes", at: "2026-11-22T01:00:00Z" }]), prs: JSON.stringify([{ number: 9, title: "Fix", url: "https://github.com/acme/shop/pull/9", state: "OPEN" }]) }));
  const read = await readIssues(db, ["shop"]);
  same(JSON.parse(read.rows[0].comments), [{ author: "ada", body: "Yes", at: "2026-11-22T01:00:00Z" }]);
  same(JSON.parse(read.rows[0].prs), [{ number: 9, title: "Fix", url: "https://github.com/acme/shop/pull/9", state: "OPEN" }]);
  assert.equal(read.boards[0].project, "shop");
});

const world = { calls: [], answer: async () => ({ code: 1, stdout: "", stderr: "" }) };
const drawn = tape();
const overlays = [];
const viewHost = {
  ...drawn.host,
  svg: drawn.host.div,
  image: drawn.host.div,
  TextView: { new: () => drawn.host.div(), markdown: () => drawn.host.div() },
  theme: () => KIT_NIGHT,
  spaces: () => [{ active: true, folder: "/work/shop", machine: null, tabs: [] }],
  home: () => "/Users/jj",
  openOverlay: (spec) => overlays.push(spec),
  openUrl: () => {},
  shared: () => null,
  window: () => ({ platform: "macos" }),
  exec: async (cmd, args) => { world.calls.push([cmd, args]); return world.answer(cmd, args); },
};

const mount = async (extra = {}) => {
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], viewHost);
  const tables = { issues: extra.rows, issue_boards: extra.boards, issue_links: extra.links };
  const read = async (sql) => tables[sql.match(/\bFROM (\w+)/)?.[1]] ?? [];
  return Object.assign(new Issues({ read, run: async () => {} }), {
    projects: [], rows: [], boards: [], links: [], places: {}, folds: {}, filters: {}, logins: {},
    reading: new Set(), open: null, front: "shop", ...extra,
  });
};

const draw = (view) => {
  drawn.texts.length = 0;
  view.render({ notify() {}, spawn() { return { cancel() {} }; }, timer: { after() { return { cancel() {} }; } } });
  return drawn.texts;
};

const shop = { id: "shop", name: "Shop", folder: "/work/shop", machine: null };
const acme = { id: "acme", name: "Acme", folder: "/work/acme", machine: null };

const GITHUB_REMOTE = "origin\tgit@github.com:acme/shop.git (fetch)\n";
const GITHUB_LOGIN = "github.com\n  Logged in to github.com account jj\n  Active account: true\n";
const githubAnswer = (tickets) => async (cmd, args) => {
  if (cmd === "git") return success(GITHUB_REMOTE);
  if (cmd === "gh") return success(GITHUB_LOGIN);
  if (cmd === "env" && args.includes("graphql")) return payload(tickets);
  return failure("Unexpected command");
};
const githubLink = (project) => ({ project, source: "github", ref: "issues", name: "GitHub issues" });
const shopBoard = { projects: [shop], links: [githubLink(shop.id)] };
const linkBoard = async (db, board) => {
  const { linkSql } = await load("kanso-panel/issues-store.js", ["linkSql"]);
  await db.run(linkSql(board, true));
};
const linkGithub = (db, project) => linkBoard(db, githubLink(project));
const kdbWithShop = async (t, linked = true) => {
  const { db } = await temporaryKdb(t);
  const { row } = await db.addProject({ name: shop.name, folder: shop.folder });
  if (linked) await linkGithub(db, row.id);
  return { db, project: row };
};

const NO_BOARDS = "Follow the GitHub issues, Jira projects and Linear teams you choose, or keep a to-do list";
const ADD_ACTION = "issues-none-action";
const control = (panel, id) => find(panel, (el) => el.tag === id || arg(el, "id") === id);
const wordsAt = (panel, id) => {
  const element = control(panel, id);
  return element ? texts(element) : [];
};
const issueLinks = (db) => db.read("SELECT project, source, ref, name FROM issue_links;");
const removeGithub = (id) => `issues-remove-${id}-github`;
const expectGithubBoard = async (db, id, panel) => {
  same(await issueLinks(db), [githubLink(id)]);
  assert.ok(control(panel, removeGithub(id)));
};
const clickIssues = (panel, id, cx) => one(control(panel, id), "on_click")(null, cx);
const startIssues = async (db, host = {}, { timers = [], ...context } = {}) => {
  const ui = drawingHost();
  const { Issues, DIALOG } = await load("kanso-panel/issues.js", ["Issues", "DIALOG"], {
    ...viewHost,
    ...ui,
    TextView: { markdown: ui.div },
    spaces: () => [],
    checking: () => true,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    ...host,
  });
  const { cx, drain } = timedContext(timers, context);
  const view = new Issues(db);
  view.init(cx);
  await drain();
  const page = () => view.render(cx);
  return { view, cx, drain, DIALOG, page, click: (id) => clickIssues(page(), id, cx) };
};
const openProjectStep = async (db, host) => {
  const tasks = await startIssues(db, host);
  tasks.click(ADD_ACTION);
  return tasks;
};

test("Opening Tasks in a project draws without asking for a redraw while it draws, then reads that project", async (t) => {
  const { db } = await kdbWithShop(t);
  const exec = t.mock.fn(async () => failure(""));
  const notify = t.mock.fn();
  const timers = [];
  const spaces = () => [{ ...shop, active: true, tabs: [] }];
  const { view, cx, drain } = await startIssues(db, { exec, spaces }, { timers, notify });
  const before = exec.mock.callCount();
  const redraws = notify.mock.callCount();
  view.render(cx);
  assert.equal(notify.mock.callCount(), redraws);
  const [, later] = timers.find(([ms]) => ms === 0);
  later(cx);
  await drain();
  assert.ok(exec.mock.callCount() > before);
});

const remoteShop = { ...shop, machine: "light" };
const remoteKanso = {
  id: "kanso-space", name: "kansō", machine: "light", folder: "/Users/jj/Apps/herdr/herdr-kanso",
};
const homeSpace = { id: "home-space", name: "Home", machine: null, folder: "/Users/jj" };
const projectHeading = (panel, id) => find(panel, (el) => arg(el, "id") === `issues-project-${id}`);
const projectChoice = (panel, id) => control(panel, `issues-add-project-${id}`);

test("Tasks reads a GitHub board only after I add it, and Remove stops following it", async (t) => {
  const { db, project } = await kdbWithShop(t, false);
  const { id, name } = project;
  const ticket = node("Open");
  const exec = t.mock.fn(githubAnswer([ticket]));
  const { cx, drain, page } = await startIssues(db, { exec });
  const githubReads = () => exec.mock.calls.filter(({ arguments: [cmd, args] }) =>
    cmd === "git" || cmd === "gh" || (cmd === "env" && args.includes("gh")));
  const links = () => issueLinks(db);
  const expectEmpty = (panel) => {
    const words = texts(panel);
    for (const text of ["Tasks", NO_BOARDS, "Add a board"]) assert.ok(words.includes(text), text);
    assert.equal(projectHeading(panel, id), null);
    assert.equal(words.includes("GitHub issues"), false);
  };

  expectEmpty(page());
  assert.equal(githubReads().length, 0);

  for (const action of [ADD_ACTION, "issues-add"]) {
    const panel = page();
    assert.equal(arg(control(panel, action), "accessibility_label"), "Add a board");
    clickIssues(panel, action, cx);
    const chooser = projectChooser(page);
    assert.ok(texts(projectChoice(chooser, id)).includes(name));
    if (action === ADD_ACTION) clickIssues(chooser, "issues-add-close", cx);
  }
  one(projectChoice(page(), id), "on_click")(null, cx);
  const sources = page();
  assert.ok(texts(sources).includes(`Add a board to ${name}`));
  assert.equal(githubReads().length, 0);
  assert.equal((await links()).length, 0);
  clickIssues(sources, "issues-add-github", cx);
  await drain();

  const linked = page();
  const link = githubLink(id);
  same(await links(), [link]);
  assert.ok(projectHeading(linked, id));
  for (const text of [link.name, ticket.title, "Remove"]) assert.ok(texts(linked).includes(text), text);
  assert.ok(githubReads().some(({ arguments: [cmd, args] }) => cmd === "env" && args.includes("graphql")));

  clickIssues(linked, removeGithub(id), cx);
  await drain();
  same(await links(), []);
  expectEmpty(page());
});

const projectChooser = (page) => {
  const chooser = page();
  assert.ok(texts(chooser).includes("Add a board: choose a project"));
  return chooser;
};
const withoutIssues = (db) => startIssues(db, { exec: githubAnswer([]) });

const TODO_WORDS = "Pack the release notes";
const todoLink = (project) => ({ project, source: "todo", ref: "list", name: "To-do" });
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
const todoTasks = async (t, { linked = true, ...host } = {}) => {
  const { db, project: { id } } = await kdbWithShop(t, false);
  if (linked) await linkBoard(db, todoLink(id));
  const tasks = await startIssues(db, { ...todoInputHost(t), ...host }, { stop_propagation() {} });
  const input = () => {
    const editor = labelledControl(tasks.page(), "Add a to-do");
    assert.ok(editor, "Tasks shows an Add a to-do field");
    return arg(editor, "state");
  };
  const submit = async (words = TODO_WORDS) => {
    const state = input();
    const event = state.on.mock.calls.find(({ arguments: [name] }) => name === "submit");
    assert.ok(event, "Enter submits the to-do");
    state.set_value(words);
    event.arguments[1]({}, tasks.cx);
    await tasks.drain();
    return input().value();
  };
  const saved = () => db.read("SELECT id, project, text, done_at FROM todos;");
  const todoRowId = async () => {
    const [row] = await saved();
    assert.ok(row, "The to-do is in SQLite");
    return `issues-todo-${row.id}`;
  };
  return { ...tasks, db, id, submit, saved, todoRowId };
};

const chooseBoardProject = ({ id, click }, action = ADD_ACTION) => {
  click(action);
  click(`issues-add-project-${id}`);
};

const removeLastBoard = async ({ db, click, drain }, remove) => {
  click(remove);
  await drain();
  same(await issueLinks(db), []);
};

const addTodoBoard = async (tasks, action) => {
  const { page, click, drain } = tasks;
  chooseBoardProject(tasks, action);
  const choice = "issues-add-todo";
  assert.ok(wordsAt(page(), choice).includes("To-do list kept here"), "Add a board offers a to-do list");
  click(choice);
  await drain();
};

test("Opening a To-do board draws without creating native input state during render.", async (t) => {
  const host = todoInputHost(t);
  const createInput = t.mock.method(host.InputState, "new");
  const { page } = await todoTasks(t, host);
  const before = createInput.mock.callCount();
  assert.ok(labelledControl(page(), "Add a to-do"), "Tasks draws the To-do input");
  assert.equal(createInput.mock.callCount(), before, "Herdr forbids InputState.new() during render");
});

test("I can add a To-do board, remove it without losing my to-dos, and add it again.", async (t) => {
  const tasks = await todoTasks(t, { linked: false });
  const { db, id, page, submit, saved } = tasks;
  const remove = `issues-remove-${id}-todo:list`;
  await addTodoBoard(tasks, ADD_ACTION);
  same(await issueLinks(db), [todoLink(id)]);
  assert.ok(control(page(), remove));

  await submit();
  const before = await saved();
  assert.equal(before[0].text, TODO_WORDS);

  await removeLastBoard(tasks, remove);
  assert.deepEqual(await saved(), before);
  assert.equal(texts(page()).includes(TODO_WORDS), false);

  await addTodoBoard(tasks, "issues-add");
  assert.ok(texts(page()).includes(TODO_WORDS));
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

test("A submitted to-do appears pending before it is saved.", async (t) => {
  const { db, page, submit, saved, todoRowId } = await todoTasks(t);
  const write = Promise.withResolvers();
  const run = db.run.bind(db);
  t.mock.method(db, "run", async (sql) => {
    await write.promise;
    return run(sql);
  });
  const submitted = submit();
  const marker = (el) => String(arg(el, "id")).startsWith("issues-todo-") && arg(el, "id").endsWith("-pending");
  try {
    const pending = page();
    assert.ok(texts(pending).includes(TODO_WORDS), "The to-do appears before SQLite replies");
    assert.ok(find(pending, marker), "The row is marked pending");
    assert.equal((await saved()).length, 0);
  } finally {
    write.resolve();
    await submitted;
  }
  const confirmed = control(page(), await todoRowId());
  assert.ok(confirmed);
  assert.equal(find(confirmed, marker), null);
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
  const done = `issues-todo-done-${id}`;
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

const clickTodoTool = (tasks, rowId, label) => {
  const { page, cx } = tasks;
  const row = control(page(), rowId);
  assert.ok(row);
  arg(row, "on_hover")?.(true, cx);
  const tool = labelledControl(control(page(), rowId), label);
  assert.ok(tool, `Hovering a to-do offers ${label}`);
  one(tool, "on_click")(null, cx);
};

test("Deleting a done to-do removes it, and Undo brings it back still done.", async (t) => {
  const tasks = await finishedTodoTasks(t);
  const { id, page, click, drain, saved, row } = tasks;
  const before = await saved();
  click(`issues-todo-done-${id}`);

  clickTodoTool(tasks, row, "Delete");
  await drain();
  same(await saved(), []);
  assert.equal(control(page(), row), null);
  assert.deepEqual(wordsAt(page(), "issues-removed"), [`Deleted ${TODO_WORDS}`, "Undo"]);

  click("issues-removed-undo");
  await drain();
  assert.deepEqual(await saved(), before);
  assert.ok(wordsAt(page(), row).includes(TODO_WORDS));
});

test("Send to agent opens kanso-send with the to-do text without changing the to-do.", async (t) => {
  const openOverlay = t.mock.fn();
  const tasks = await todoTasks(t, { openOverlay });
  await tasks.submit();
  clickTodoTool(tasks, await tasks.todoRowId(), "Send to agent");
  await tasks.drain();

  assert.equal(openOverlay.mock.callCount(), 1);
  const [dialog] = openOverlay.mock.calls[0].arguments;
  assert.equal(dialog.mod, "kanso-send");
  assert.equal(dialog.props.text, TODO_WORDS);
  assert.equal((await tasks.saved())[0].done_at, null);
});

test("A project with only a To-do board shows its count but no issue filter or empty issue message.", async (t) => {
  const { id, page } = await todoTasks(t);
  const panel = page();
  assert.equal(Boolean(control(panel, `issues-filter-${id}`)), false, "There is no provider filter");
  assert.equal(texts(panel).some((word) => word.startsWith("No open issues")), false);
  assert.ok(texts(panel).includes("0 open"));
});

test("Refreshing a To-do board never dispatches a provider read.", async (t) => {
  const exec = t.mock.fn(async () => failure("Unexpected provider command"));
  const { view, click, drain } = await todoTasks(t, { exec });
  const readBoard = t.mock.method(view, "readBoard");
  click("issues-refresh");
  await drain();
  assert.equal(readBoard.mock.callCount(), 0);
  assert.equal(exec.mock.callCount(), 0);
});

const GH_BOARD = { source: "ghproject", ref: "PVT_REPO", name: "Release board" };
const PROJECT_SOURCE = `${GH_BOARD.source}:${GH_BOARD.ref}`;
const GITHUB_PROJECTS_CHOICE = "issues-add-ghproject";
const PROJECT_SCOPE_ERROR = failure("INSUFFICIENT_SCOPES: read:project");
const projectEntry = (id, title, closed = false) => ({ id, title, closed });
const ghProjectList = () => {
  const repo = projectEntry(GH_BOARD.ref, GH_BOARD.name);
  const owner = projectEntry("PVT_OWNER", "Owner board");
  const closed = projectEntry("PVT_CLOSED", "Closed board", true);
  return success(JSON.stringify({ data: { repository: {
    projectsV2: { nodes: [repo, closed] },
    owner: { projectsV2: { nodes: [repo, owner, closed] } },
  } } }));
};
const GH_PROJECT_URL = "https://github.com/orgs/acme/projects/2";
const projectItem = (id, name, content, databaseId = null) => ({ id, databaseId, fieldValueByName: { name }, content });
const PROJECT_COLUMNS = ["Review", "Backlog", "Done"];
const ghProjectPage = (nodes = [], pageInfo = { hasNextPage: false }, totalCount = nodes.length) => success(JSON.stringify({
  data: { node: {
    url: GH_PROJECT_URL,
    field: { options: PROJECT_COLUMNS.map((name) => ({ name })) },
    items: { nodes, pageInfo, totalCount },
  } },
}));

const projectIssue = (extra = {}) => ({
  ...node(), __typename: "Issue", title: "Assigned ticket", repository: { nameWithOwner: "another/tool" },
  url: "https://github.com/another/tool/issues/12",
  ...extra,
});
const ghProjectTasks = async (t, { links = [GH_BOARD], board = ghProjectPage(), picker = ghProjectList(), detail, ...host } = {}) => {
  const { db, project: { id } } = await kdbWithShop(t, false);
  for (const link of links) await linkBoard(db, { ...link, project: id });
  const github = githubAnswer([node("Open")]);
  const exec = t.mock.fn(async (cmd, args) => {
    if (cmd === "env" && args.includes("graphql")) {
      if (named(args, "id=")) return board;
      const query = args.find((arg) => arg.startsWith("query="));
      if (query?.includes("projectsV2(")) return picker;
      if (detail && named(args, "number=")) return detail;
    }
    return github(cmd, args);
  });
  const tasks = await startIssues(db, { exec, ...host });
  return { ...tasks, db, id, exec, projectChoiceId: `issues-link-${id}-${GH_BOARD.ref}` };
};

const openGhProjectPicker = async (tasks) => {
  chooseBoardProject(tasks);
  assert.deepEqual(wordsAt(tasks.page(), GITHUB_PROJECTS_CHOICE), ["GitHub Projects…"]);
  tasks.click(GITHUB_PROJECTS_CHOICE);
  await tasks.drain();
};

test("The GitHub Projects picker lists open repository and owner projects once, and the board can be removed and restored.", async (t) => {
  const tasks = await ghProjectTasks(t, { links: [] });
  const { db, id, page, click, drain, projectChoiceId } = tasks;
  await openGhProjectPicker(tasks);
  const names = [GH_BOARD.name, "Owner board"];
  const choices = texts(page()).filter((word) => [...names, "Closed board"].includes(word));
  assert.deepEqual(choices, names);

  click(projectChoiceId);
  await drain();
  const link = { project: id, ...GH_BOARD };
  same(await issueLinks(db), [link]);
  click("issues-add-close");
  const remove = `issues-remove-${id}-${PROJECT_SOURCE}`;

  await removeLastBoard(tasks, remove);
  assert.equal(control(page(), remove), null);
  assert.deepEqual(wordsAt(page(), "issues-removed"), [`Removed ${GH_BOARD.name}`, "Undo"]);

  click("issues-removed-undo");
  await drain();
  same(await issueLinks(db), [link]);
  assert.ok(control(page(), remove));
});

test("A GitHub Projects picker and a linked board both offer Allow access when read:project is missing.", async (t) => {
  const run = t.mock.fn();
  for (const linked of [false, true]) {
    const tasks = await ghProjectTasks(t, {
      run, links: linked ? [GH_BOARD] : [], board: PROJECT_SCOPE_ERROR, picker: PROJECT_SCOPE_ERROR,
    });
    if (!linked) await openGhProjectPicker(tasks);
    const action = linked ? `issues-state-${tasks.id}-${PROJECT_SOURCE}-fix` : `issues-link-failure-${tasks.id}-fix`;
    assert.deepEqual(wordsAt(tasks.page(), action), ["Allow access"]);
    tasks.click(action);
  }
  same(run.mock.calls.map(({ arguments: [command, opts] }) => [command, opts.argv]),
    Array.from({ length: 2 }, () => ["space.new", ["gh", "auth", "refresh", "-s", "read:project"]]));
});

test("A GitHub Project keeps Status order, labels drafts, skips empty items and filters by assignee or author.", async (t) => {
  const rows = [
    projectItem("PVTI_ASSIGN", "Review", projectIssue(), 21),
    projectItem("PVTI_DRAFT", "Backlog", {
      __typename: "DraftIssue", title: "Written draft", creator: { login: "JJ" },
    }, 22),
    projectItem("PVTI_EMPTY", "Done", null),
  ];
  const { db, id, page, click, drain } = await ghProjectTasks(t, { board: ghProjectPage(rows) });
  const section = (value) => `issues-section-${id}-${PROJECT_SOURCE}-${value}`;
  const chooseFilter = async (value) => {
    click(`issues-filter-${id}-${value}`);
    await drain();
    return texts(page());
  };
  const assigned = texts(page());
  assert.ok(assigned.includes("Assigned ticket"));
  assert.equal(assigned.includes("Written draft"), false);
  assert.deepEqual(assigned.filter((word) => PROJECT_COLUMNS.includes(word)), PROJECT_COLUMNS);

  const created = await chooseFilter("created");
  assert.ok(created.includes("Written draft"));
  assert.ok(created.includes("Draft"));
  assert.equal(created.includes("Assigned ticket"), false);

  const all = await chooseFilter("all");
  for (const title of ["Assigned ticket", "Written draft"]) assert.ok(all.includes(title), title);
  assert.deepEqual(wordsAt(page(), section("Done")), ["Done", "0"]);
  const urls = await db.read("SELECT url FROM issues ORDER BY url;");
  same(urls.map(({ url }) => url), [21, 22].map((itemId) => `${GH_PROJECT_URL}?pane=issue&itemId=${itemId}`));
});

test("An issue on a GitHub Project loads detail from the issue's own repository.", async (t) => {
  const detail = success(JSON.stringify({ data: { repository: { issue: { body: "Expanded body" } } } }));
  const board = ghProjectPage([projectItem("PVTI_ASSIGN", "Review", projectIssue())]);
  const { page, cx, drain, exec } = await ghProjectTasks(t, { board, detail });
  const item = find(page(), (el) => arg(el, "on_click") && texts(el).includes("Assigned ticket"));
  assert.ok(item, "The assigned GitHub Project issue is visible");
  one(item, "on_click")(null, cx);
  await drain();

  const query = exec.mock.calls.find(({ arguments: [_cmd, args] }) => named(args, "number="));
  assert.ok(query, "Opening the issue requests its detail");
  const [, args] = query.arguments;
  for (const variable of ["owner=another", "name=tool", "number=12"]) assert.ok(args.includes(variable), variable);
});

test("The same issue can appear on GitHub issues and a GitHub Project for the same kansō project.", async (t) => {
  const shared = projectIssue({ url: PR_URL, repository: { nameWithOwner: "acme/shop" } });
  const board = ghProjectPage([projectItem("PVTI_SHARED", "Review", shared, 23)]);
  const { id, page, click, drain } = await ghProjectTasks(t, { links: [githubLink(shop.id), GH_BOARD], board });
  const list = page();
  const repoSection = `issues-section-${id}-github-Open`;
  const projectSection = `issues-section-${id}-${PROJECT_SOURCE}-Review`;
  assert.deepEqual({
    repository: wordsAt(list, repoSection),
    projectBoard: wordsAt(list, projectSection),
  }, { repository: ["Open", "1"], projectBoard: ["Review", "1"] });
  assert.ok(control(list, `issue-${PR_URL}`));
  assert.ok(control(list, `issue-${GH_PROJECT_URL}?pane=issue&itemId=23`));

  click(`issues-remove-${id}-${PROJECT_SOURCE}`);
  await drain();
  assert.deepEqual(wordsAt(page(), repoSection), ["Open", "1"]);
});

const readGhProjectBoard = async (run) => {
  const { readProjectBoard } = await load("kanso-panel/issues-ghprojects.js", ["readProjectBoard"]);
  return readProjectBoard(run, { host: REPO.host, ref: GH_BOARD.ref, project: shop.id });
};

test("A GitHub Project keeps the first page's item links and Status columns when the next page fails.", async () => {
  const rows = [projectItem("PVTI_FIRST", "Review", projectIssue(), 23)];
  const first = ghProjectPage(rows, { hasNextPage: true, endCursor: "next" }, 2);
  const board = await readGhProjectBoard(async (_cmd, args) => afterOf(args) ? failure("connection refused") : first);

  assert.equal(board.failure?.kind, "offline");
  assert.equal(board.complete, false);
  same(board.rows.map(({ url }) => url), [`${GH_PROJECT_URL}?pane=issue&itemId=23`]);
  same(board.columns, PROJECT_COLUMNS);
  assert.equal(board.total, 2);
});

test("A GitHub Project stops reading items at the page cap and keeps the copy incomplete.", async (t) => {
  const { PAGES } = await load("kanso-panel/issues-github.js", ["PAGES"]);
  const run = t.mock.fn(async () => {
    const cursor = run.mock.callCount() + 1;
    const next = { hasNextPage: true, endCursor: `page-${cursor}` };
    const content = projectIssue({ url: `${PR_URL}/${cursor}` });
    return ghProjectPage([projectItem(`PVTI_${cursor}`, "Review", content, cursor)], next, 800);
  });
  const board = await readGhProjectBoard(run);
  const cursors = run.mock.calls.map(({ arguments: [_cmd, args] }) => afterOf(args));
  assert.deepEqual(cursors, Array.from({ length: PAGES }, (_, i) => i ? `after=page-${i}` : null));
  assert.equal(board.rows.length, PAGES);
  assert.equal(board.complete, false);
  assert.equal(board.total, 800);
});

test("Pressing the header + leaves the issue detail and asks me to choose a project.", async (t) => {
  const { db } = await kdbWithShop(t);
  const { page, click, drain } = await startIssues(db, { exec: githubAnswer([node("Open")]) });
  click(`issue-${PR_URL}`);
  await drain();
  assert.ok(control(page(), "issues-back"));

  click("issues-add");
  assert.equal(control(projectChooser(page), "issues-back"), null);
});

test("GitHub issues shows Adding… and offers Retry when the board cannot be added.", async (t) => {
  const { db, project: { id } } = await kdbWithShop(t, false);
  const { page, click, drain } = await withoutIssues(db);
  const write = Promise.withResolvers();
  t.mock.method(db, "run", async () => {
    await write.promise;
    throw new Error("The link could not be saved");
  }, { times: 1 });
  const githubChoice = "issues-add-github";
  const retry = "issues-save-failed-fix";

  click("issues-add");
  click(`issues-add-project-${id}`);
  click(githubChoice);
  const pending = wordsAt(page(), githubChoice);
  write.resolve();
  await drain();

  const refused = page();
  const error = "Can't add GitHub issues";
  assert.deepEqual({
    pending,
    error: texts(refused).includes(error),
    retry: wordsAt(refused, retry),
  }, { pending: ["GitHub issues", "Adding…"], error: true, retry: ["Retry"] });
  same(await issueLinks(db), []);

  click(retry);
  await drain();
  await expectGithubBoard(db, id, page());
});

test("Removing the last board leaves Add a board beside Undo, and Undo brings the board back.", async (t) => {
  const { db, project: { id } } = await kdbWithShop(t);
  const { page, click, drain } = await withoutIssues(db);
  const undo = "issues-removed-undo";

  click(removeGithub(id));
  await drain();
  const empty = page();
  assert.deepEqual(wordsAt(empty, "issues-removed"), ["Removed GitHub issues", "Undo"]);
  assert.deepEqual(wordsAt(empty, ADD_ACTION), ["Add a board"]);

  click(undo);
  await drain();
  const restored = page();
  await expectGithubBoard(db, id, restored);
  assert.equal(control(restored, undo), null);
});

test("Tasks lists each open project once, skips the home space, and prefers a saved project at the same place", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = () => [homeSpace, remoteKanso, { ...remoteKanso, id: "second-space" }];
  const { view, cx, drain } = await openProjectStep(db, { spaces });
  const openId = `light:${remoteKanso.folder}`;
  const open = view.render(cx);
  assert.ok(projectChoice(open, openId));
  const words = texts(open);
  assert.equal(words.filter((word) => word === remoteKanso.name).length, 1);
  assert.equal(words.includes(homeSpace.name), false);

  const { row } = await db.addProject({ ...remoteKanso, name: "Saved kansō" });
  view.load(cx);
  await drain();
  const saved = view.render(cx);
  assert.ok(texts(projectChoice(saved, row.id)).includes(row.name));
  assert.equal(projectChoice(saved, openId), null);
});

test("Tasks skips the local home but keeps a project at the same path on another computer", async (t) => {
  const { db } = await temporaryKdb(t);
  const remote = { ...homeSpace, id: "remote-home", name: "Project on light", machine: "light" };
  const { view, cx } = await openProjectStep(db, { spaces: () => [homeSpace, remote] });
  const words = texts(view.render(cx));
  assert.ok(words.includes(remote.name));
  assert.equal(words.includes(homeSpace.name), false);
});

test("Tasks picks up a project space opened after the panel mounted", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = t.mock.fn(() => [homeSpace]);
  const { view, cx, drain } = await openProjectStep(db, { spaces });
  assert.equal(texts(view.render(cx)).includes(remoteKanso.name), false);
  spaces.mock.mockImplementation(() => [homeSpace, remoteKanso]);
  view.render(cx);
  await drain();
  assert.ok(texts(view.render(cx)).includes(remoteKanso.name));
});

test("With no projects, New project opens the sidebar's New project dialog", async (t) => {
  const { db } = await temporaryKdb(t);
  const openOverlay = t.mock.fn();
  const { view, cx, DIALOG } = await openProjectStep(db, { openOverlay });
  const page = view.render(cx);
  assert.ok(texts(page).includes("Add a project first"));
  assert.ok(texts(page).includes("New project"));
  press(page, "issues-add-none-action");
  const opened = openOverlay.mock.calls.map((call) => call.arguments);
  assert.deepEqual(structuredClone(opened), [[{
    mod: "kanso-spaces",
    kind: "dialog",
    width: DIALOG.sidebar,
    props: { newProject: { start: false } },
  }]]);
});

test("An Issues panel that mounted without projects shows a newly registered project", async (t) => {
  const { db } = await temporaryKdb(t);
  const shared = t.mock.fn(() => null);
  const { view, cx, drain } = await startIssues(db, { shared });
  assert.ok(texts(view.render(cx)).includes(NO_BOARDS));
  const { row } = await db.addProject({ name: shop.name, folder: shop.folder });
  await linkGithub(db, row.id);
  shared.mock.mockImplementation((key) => key === "kanso.registry" ? [{ id: row.id }] : null);
  view.render(cx);
  await drain();
  const words = texts(view.render(cx));
  assert.ok(words.includes(shop.name));
  assert.equal(words.includes(NO_BOARDS), false);
});

test("Issues keeps showing the project when a later projects read fails", async (t) => {
  const { db } = await kdbWithShop(t);
  const { view, cx, drain } = await startIssues(db);
  const originalRead = db.read.bind(db);
  const unavailable = t.mock.fn(async () => { throw new Error("Projects are unavailable"); });
  t.mock.method(db, "read", (sql) => /\bFROM projects\b/.test(sql) ? unavailable() : originalRead(sql));
  view.load(cx);
  await drain();
  assert.equal(unavailable.mock.callCount(), 1);
  assert.ok(texts(view.render(cx)).includes(shop.name));
});

test("Two projects are drawn with the front project first, each section shows its count, and Done stays folded", async () => {
  const view = await mount({
    projects: [acme, shop],
    links: [acme, shop].map(({ id }) => githubLink(id)),
    boards: [{ project: "shop", source: "github", filter: "all", columns: JSON.stringify(["Open", "Done", "Review"]), read_at: 1, failure: null }],
    filters: { shop: "all" },
    rows: [
      issue({ project: "shop", title: "Ship it" }),
      issue({ project: "shop", url: "https://github.com/acme/shop/issues/8", title: "Old ticket", status: "Done", updated_at: "2026-11-21T00:00:00Z" }),
    ],
  });
  const texts = draw(view);
  assert.ok(texts.indexOf("Shop") < texts.indexOf("Acme"));
  assert.ok(texts.includes("Ship it"));
  assert.equal(texts.includes("Old ticket"), false);
  assert.ok(texts.includes("Done"));
  assert.ok(texts.includes("Review"));
  assert.ok(texts.includes("1"));
  assert.ok(texts.includes("0"));
});

test("Switching the filter stores it and reads the issues again", async () => {
  world.calls = [];
  world.answer = githubAnswer([]);
  const view = await mount({
    ...shopBoard,
    boards: [{ project: "shop", source: "github", filter: "assigned", columns: "[]", read_at: Date.now(), failure: null }],
    logins: { ":github": { status: "ok", login: "jj" } },
  });
  const { cx, drain } = timedContext([]);
  view.choose("shop", "created", cx);
  await drain();
  assert.equal(view.filters.shop, "created");
  assert.ok(world.calls.some((call) => call[0] === "env" && named(call[1], "author=jj")));
});

test("A failed read still shows the cached issues and when that copy was read", async () => {
  const at = Date.parse("2026-11-22T15:04:00Z");
  const view = await mount({
    ...shopBoard,
    boards: [{ project: "shop", source: "github", filter: "assigned", columns: JSON.stringify(["Open"]), read_at: at, failure: JSON.stringify({ kind: "offline", text: "GitHub can't be reached" }) }],
    filters: { shop: "all" },
    rows: [issue({ title: "Cached issue" })],
  });
  const texts = draw(view);
  assert.ok(texts.includes("Cached issue"));
  assert.ok(texts.includes("Showing the copy read at " + clock(at)));
});

test("A signed-out project shows Sign in, and a project without a GitHub remote says so", async () => {
  const signed = await mount({ ...shopBoard, places: { "shop\u0000github": { kind: "signed out", text: "Sign in to GitHub to see your issues" } } });
  assert.ok(draw(signed).includes("Sign in"));
  const remote = await mount({ ...shopBoard, places: { "shop\u0000github": { kind: "no remote", text: "No GitHub remote" } } });
  assert.ok(draw(remote).includes("No GitHub remote"));
});

const signedOut = () => failure("You are not logged into any GitHub hosts.");
const githubTasks = async (t, answer, host = {}) => {
  const { db } = await temporaryKdb(t);
  const { row } = await db.addProject(remoteShop);
  await linkGithub(db, row.id);
  const exec = t.mock.fn(answer);
  const tasks = await startIssues(db, { exec, ...host });
  return {
    ...tasks, exec,
    action: `issues-state-${row.id}-github-fix`,
  };
};

test("GitHub sign-in uses a pane in the active project space, a tab in an inactive one, or a new space on that computer", async (t) => {
  const samePlace = { id: "shop-on-light", folder: shop.folder, machine: remoteShop.machine };
  const anotherComputer = { ...samePlace, id: "shop-local", machine: null, active: true };
  const spaces = t.mock.fn(() => []);
  const run = t.mock.fn();
  const answer = async (cmd) => cmd === "git" ? success(GITHUB_REMOTE) : signedOut();
  const { page, action } = await githubTasks(t, answer, { spaces, run });
  const argv = ["gh", "auth", "login"];
  const folder = shop.folder;
  const cases = [
    [[{ ...samePlace, active: true }], "terminal.open", { folder, place: "right" }],
    [[anotherComputer, samePlace], "tab.new", { folder, space: samePlace.id }],
    [[anotherComputer], "space.new", { folder, machine: remoteShop.machine }],
  ];
  for (const [open, command, expected] of cases) {
    spaces.mock.mockImplementation(() => open);
    run.mock.resetCalls();
    press(page(), action);
    assert.equal(run.mock.callCount(), 1);
    const [actual, options] = run.mock.calls[0].arguments;
    assert.equal(actual, command);
    same(options.argv, argv);
    for (const [key, value] of Object.entries(expected)) assert.equal(options[key], value, key);
  }
});

test("When the GitHub CLI is missing, Tasks opens its download page instead of offering sign-in", async (t) => {
  const answer = async (cmd) => cmd === "git" ? success(GITHUB_REMOTE) : failure("gh: command not found", 127);
  const { page, action, exec } = await githubTasks(t, answer);
  const panel = page();
  const words = texts(panel);
  assert.ok(words.includes("GitHub CLI not installed"));
  assert.ok(words.includes("Get the GitHub CLI"));
  assert.equal(words.includes("Sign in"), false);
  press(panel, action);
  const [command, args] = exec.mock.calls.at(-1).arguments;
  assert.equal(command, "open");
  same(args, ["https://cli.github.com"]);
});

test("Tasks lets me retry a Git read failure but says there is no GitHub remote outside a repository", async (t) => {
  const git = t.mock.fn(() => failure("fatal: could not open .git/config: Permission denied", 128));
  const answer = async (cmd) => cmd === "git" ? git() : signedOut();
  const { page, action, cx, drain } = await githubTasks(t, answer);
  const panel = page();
  const words = texts(panel);
  assert.ok(words.includes("Git could not read this project"));
  assert.ok(words.includes("Refresh"));
  assert.equal(words.includes("No GitHub remote"), false);

  git.mock.mockImplementation(() => failure("fatal: not a git repository (or any parent directory): .git", 128));
  clickIssues(panel, action, cx);
  await drain();
  const retried = texts(page());
  assert.ok(retried.includes("No GitHub remote"));
  assert.equal(retried.includes("Git could not read this project"), false);
});

test("Send to agent opens the send dialog with the issue text", async () => {
  const { sendText } = await load("kanso-panel/issues-model.js", ["sendText"]);
  const row = issue();
  const view = await mount({ projects: [shop], rows: [row], open: row.url });
  overlays.length = 0;
  view.sendToAgent(row);
  assert.equal(overlays[0].mod, "kanso-send");
  assert.equal(overlays[0].props.text, sendText(row));
});

test("A draft passed in as text is the message", async () => {
  const text = ["#12 Ship it", PR_URL, "The body"].join("\n\n");
  const field = (value) => ({ value: () => value, on() { return this; }, focus() {}, set_auto_grow() {}, set_value() {} });
  const { Send } = await load("kanso-send/main.js", ["Send"], {
    props: () => ({ text, pane: "p1" }),
    panes: () => [{ pane: "p1", cwd: "/work/acme", branch: "feat" }],
    terminals: () => [], machines: () => [], spaces: () => [], shared: () => null,
    TextareaState: { new: (start) => field(start?.value ?? "") },
    InputState: { new: (start) => field(start?.value ?? "") },
  });
  const view = new Send();
  view.init({}, { timer: { after() {} }, focus_handle: () => ({}) });
  assert.equal(view.text, text);
  assert.equal(view.text.includes("/work/acme"), false);
});

const pageOf = (n, cursor, more) => ({
  code: 0,
  stdout: JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: more, endCursor: cursor }, nodes: [{ number: n, title: "N" + n, url: "https://github.com/acme/shop/issues/" + n, body: "", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z", author: { login: "ada" }, assignees: { nodes: [{ login: "jj" }] }, labels: { nodes: [] }, projectItems: { nodes: [] } }] } } } }),
  stderr: "",
});
const afterOf = (args) => args.find((part) => String(part).startsWith("after=")) ?? null;

test("A fresh Issues list shows stored assigned rows from the board's who, and a detail read uses the board's stored repo", async () => {
  const row = issue({ assignees: JSON.stringify(["jj"]) });
  const sql = [];
  const view = await mount({
    projects: [shop], rows: [row], logins: {},
    links: [githubLink(shop.id)],
    boards: [{ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", columns: JSON.stringify(["Open"]), read_at: 1, failure: null }],
  });
  view.db = { read: async () => ({ rows: view.rows, boards: view.boards }), run: async (text) => { sql.push(text); } };
  assert.ok(draw(view).includes("Ship it"));
  assert.equal(draw(view).includes("No open issues"), false);
  world.calls = [];
  world.answer = async () => ({ code: 0, stdout: JSON.stringify({ data: { repository: { issue: { body: "The body", comments: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] } } } } }), stderr: "" });
  const { cx, drain } = timedContext([]);
  view.show(row, cx);
  await drain();
  assert.ok(world.calls.some((call) => call[0] === "env" && named(call[1], "owner=acme") && named(call[1], "name=shop")));
  assert.ok(sql.some((text) => text.includes("project=") && text.includes(PR_URL)));
});

test("A board read follows the next page cursor up to the page cap, and an unfinished read deletes nothing", async (t) => {
  const { readBoard, PAGES } = await load("kanso-panel/issues-github.js", ["readBoard", "PAGES"]);
  const seen = [];
  let n = 0;
  const followed = await readBoard(async (_cmd, args) => { seen.push(afterOf(args)); n += 1; return pageOf(n, "c" + n, n < 2); }, { repo: REPO, project: "shop", filter: "all", who: "jj" });
  assert.equal(seen[0], null);
  assert.equal(seen[1], "after=c1");
  assert.equal(followed.rows.length, 2);
  assert.equal(followed.complete, true);
  const capped = [];
  const limited = await readBoard(async (_cmd, args) => { capped.push(afterOf(args)); return pageOf(capped.length, "p" + capped.length, true); }, { repo: REPO, project: "shop", filter: "all", who: "jj" });
  assert.equal(capped.length, PAGES);
  assert.equal(limited.complete, false);
  const { db, storeSql, readIssues } = await rowsOf(t);
  const kept = [issue({ url: "https://github.com/acme/shop/issues/1", title: "Kept" }), issue({ url: "https://github.com/acme/shop/issues/2", title: "Extra", assignees: JSON.stringify(["jj"]) })];
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", complete: true, rows: kept, columns: ["Open"], kept: [], now: 1 }));
  await db.run(storeSql({ project: "shop", source: "github", filter: "assigned", who: "jj", repo: "github.com/acme/shop", complete: false, rows: [kept[0]], columns: ["Open"], kept, now: 2 }));
  const next = await readIssues(db, ["shop"]);
  same(next.rows.map((row) => row.title).toSorted(), ["Extra", "Kept"]);
  assert.equal(next.boards[0].who, "jj");
  assert.equal(next.boards[0].repo, "github.com/acme/shop");
});

test("The same issue address stored for two projects keeps both rows", async (t) => {
  const { db, storeSql, readIssues } = await rowsOf(t);
  const shared = issue({ title: "Shared" });
  await db.run(storeSql({ project: "shop", source: "github", filter: "all", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [shared], columns: ["Open"], kept: [], now: 1 }));
  await db.run(storeSql({ project: "acme", source: "github", filter: "all", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [{ ...shared, project: "acme" }], columns: ["Open"], kept: [], now: 2 }));
  const read = await readIssues(db, ["shop", "acme"]);
  same(read.rows.map((row) => row.project).toSorted(), ["acme", "shop"]);
});

const fieldState = (start) => ({ value: () => start?.value ?? "", on() { return this; }, focus() {}, set_auto_grow() {}, set_value(next) { if (start) start.value = next; } });
const agentHost = (props, panes, calls) => {
  const list = [panes].flat();
  return {
    props: () => props, panes: () => list, shared: () => null, machines: () => [],
    terminals: () => list.map((pane) => ({ address: pane.terminal, status: pane.status, program: pane.program, labels: { "kanso.shown": pane.program?.name || "Claude" } })),
    spaces: () => [{ name: "Shop", tabs: list.map((pane) => ({ id: pane.tab })) }],
    hc: async (args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
    closeOverlay() {}, run() {}, TextareaState: { new: fieldState }, InputState: { new: fieldState },
  };
};
const holdCx = () => {
  const timers = [];
  const pending = [];
  return { timers, pending, cx: sendCx(timers, pending) };
};
const sendCx = (timers, pending) => {
  const cx = { notify() {}, focus_handle: () => ({}), timer: { after(_ms, fn) { timers.push(fn); return { cancel() {} }; } } };
  cx.spawn = (fn) => { pending.push(fn(cx)); return { cancel() {} }; };
  return cx;
};

test("Send holds a working recipient until that agent is done, and without the wait it sends at once", async () => {
  const pane = { pane: "p1", terminal: "t1", tab: "tab1", status: "working", program: { name: "Claude", agent: true } };
  const held = [];
  const props = { text: "Ship it", whenWaiting: true };
  const { Send } = await load("kanso-send/main.js", ["Send"], agentHost(props, pane, held));
  const waiting = new Send();
  const { timers, pending, cx } = holdCx();
  waiting.init({}, cx);
  waiting.send(cx, waiting.state());
  assert.equal(held.length, 0);
  assert.equal(waiting.note, "Sends when Claude waits for you.");
  pane.status = "done";
  timers.at(-1)(cx);
  await Promise.all(pending);
  assert.equal(held.filter((call) => call[0] === "send").length, 1);
  const immediate = [];
  props.whenWaiting = false;
  const { Send: Plain } = await load("kanso-send/main.js", ["Send"], agentHost(props, { ...pane, status: "working" }, immediate));
  const now = new Plain();
  now.init({}, { ...cx, spawn(fn) { pending.push(fn(cx)); return { cancel() {} }; } });
  now.send(cx, now.state());
  await Promise.all(pending);
  assert.equal(immediate.filter((call) => call[0] === "send").length, 1);
  assert.equal(now.note, null);
});

test("A GitHub remote named origin wins, otherwise another GitHub remote is used, and a non-GitHub origin is not a repository", async () => {
  const { remoteOf } = await load("kanso-panel/issues-github.js", ["remoteOf"]);
  const origin = remoteOf("origin https://github.com/acme/shop.git (fetch)\nupstream https://gitlab.com/acme/shop.git (fetch)\n", ["github.com"]);
  assert.equal(origin.owner, "acme");
  assert.equal(origin.name, "shop");
  const upstream = remoteOf("upstream https://github.com/acme/other.git (fetch)\n", ["github.com"]);
  assert.equal(upstream.name, "other");
  assert.equal(remoteOf("origin https://gitlab.com/acme/shop.git (fetch)\n", ["github.com"]), null);
});

test("A logged-out probe is not kept, a later signed-in probe is used, and a probe error shows the copy instead of Sign in", async () => {
  const { issuesGithub } = await load("kanso-panel/issues-github.js", ["issuesGithub"]);
  const answers = [
    { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. Run gh auth login" },
    success(GITHUB_LOGIN),
  ];
  world.calls = [];
  world.answer = async () => answers.shift();
  const view = await mount({ projects: [shop] });
  const first = await view.loginOn(null, issuesGithub);
  const second = await view.loginOn(null, issuesGithub);
  assert.equal(first.status, "logged_out");
  assert.equal(second.status, "ok");
  assert.equal(second.login, "jj");
  assert.equal(world.calls.filter((call) => call[0] === "gh").length, 2);
  const at = Date.parse("2026-11-22T15:04:00Z");
  const board = { project: "shop", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), read_at: at, failure: null };
  const failed = await mount({
    ...shopBoard,
    rows: [issue({ title: "Cached issue" })],
    filters: { shop: "all" },
    boards: [board],
  });
  world.answer = async (cmd) => cmd === "git"
    ? success(GITHUB_REMOTE) : failure("temporary failure");
  const { cx, drain } = timedContext([]);
  failed.readBoard(shop, "github", cx);
  await drain();
  const texts = draw(failed);
  assert.ok(texts.some((text) => text.includes("Showing the copy read at " + clock(at))));
  assert.equal(texts.includes("Sign in"), false);
});

test("The five-minute tick does not read a board read less than a minute ago", async () => {
  const calls = [];
  const ticks = [];
  const pending = [];
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], {
    ...viewHost,
    exec: async (cmd, args) => { calls.push([cmd, args]); return { code: 1, stdout: "", stderr: "not logged" }; },
  });
  const readAt = Date.now();
  const db = {
    read: async (sql) => {
      if (sql.includes("FROM projects")) return [shop];
      if (sql.includes("issue_links")) return [githubLink(shop.id)];
      if (String(sql).includes("issue_boards")) return [{ project: "shop", source: "github", filter: "assigned", who: "jj", read_at: readAt, columns: "[]", failure: null }];
      return [];
    },
    run: async () => {},
  };
  const cx = { notify() {}, spawn(fn) { pending.push(fn(cx)); return { cancel() {} }; }, timer: { every(_ms, fn) { ticks.push(fn); return { cancel() {} }; }, after() { return { cancel() {} }; } } };
  new Issues(db).init(cx);
  const settle = async () => {
    const waiting = pending.splice(0);
    if (!waiting.length) return;
    await Promise.all(waiting);
    await settle();
  };
  await settle();
  const before = calls.length;
  ticks[0](cx);
  await Promise.all(pending);
  assert.equal(calls.length, before);
});

test("An issue with no status shows Open in its row", async () => {
  const updated = new Date(Date.now() - 5 * 60_000).toISOString();
  const view = await mount({
    projects: [shop], filters: { shop: "all" },
    links: [githubLink(shop.id)],
    boards: [{ project: "shop", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), read_at: 1, failure: null }],
    rows: [issue({ status: null, title: "Unboarded", updated_at: updated })],
  });
  assert.ok(draw(view).includes("Open · 5m"));
});

test("A first page with a next cursor, then a rate limit, keeps those rows and records the limit without a new read time", async (t) => {
  const { readBoard, syncBoard } = await load("kanso-panel/issues-github.js", ["readBoard", "syncBoard"]);
  const now = 1_700_000_000_000 + 0;
  const reset = Math.floor(now / 1000) + 180;
  let n = 0;
  const run = async () => {
    n += 1;
    if (n === 1) return pageOf(1, "c1", true);
    return { code: 1, stdout: "", stderr: "rate limit exceeded\nX-RateLimit-Reset: " + reset };
  };
  const board = await readBoard(run, { repo: REPO, project: "shop", filter: "all", login: "jj", now });
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].title, "N1");
  assert.equal(board.failure.kind, "rate");
  const { db, storeSql, readIssues } = await rowsOf(t);
  await db.run(storeSql({ project: "shop", source: "github", filter: "all", who: "jj", repo: "github.com/acme/shop", complete: true, rows: [], columns: ["Open"], kept: [], now: 20 }));
  n = 0;
  await syncBoard(db, run, { repo: REPO, project: "shop", filter: "all", login: "jj", kept: [], now });
  const stored = await readIssues(db, ["shop"]);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.boards[0].read_at, 20);
  assert.equal(stored.boards[0].retry_at, reset * 1000);
  same(JSON.parse(stored.boards[0].failure), { kind: "rate", text: "GitHub is limiting requests", retryAt: reset * 1000 });
});

test("A capped read stores the total, and the list says it is showing the newest of that total", async (t) => {
  const { readBoard, syncBoard, PAGES } = await load("kanso-panel/issues-github.js", ["readBoard", "syncBoard", "PAGES"]);
  let n = 0;
  const run = async () => {
    n += 1;
    const page = pageOf(n, "p" + n, true);
    const body = JSON.parse(page.stdout);
    body.data.repository.issues.totalCount = 1082;
    return { ...page, stdout: JSON.stringify(body) };
  };
  const capped = await readBoard(run, { repo: REPO, project: "shop", filter: "all", login: "jj" });
  assert.equal(n, PAGES);
  assert.equal(capped.complete, false);
  assert.equal(capped.total, 1082);
  const { db, readIssues } = await rowsOf(t);
  n = 0;
  await syncBoard(db, run, { repo: REPO, project: "shop", filter: "all", login: "jj", kept: [] });
  const stored = await readIssues(db, ["shop"]);
  assert.equal(stored.boards[0].total, 1082);
  const listed = await mount({
    projects: [shop],
    links: [githubLink(shop.id)],
    filters: { shop: "all" },
    rows: [issue({ title: "Newest" })],
    boards: [{ project: "shop", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), total: 1082, read_at: 1, failure: null }],
  });
  assert.ok(draw(listed).includes("Showing the newest 1 of 1082"));
});

test("Selecting the second project's copy of a shared issue opens that project's detail", async () => {
  const url = "https://github.com/acme/shop/issues/1";
  const alpha = { id: "a", name: "Alpha", folder: "/work/a", machine: null };
  const beta = { id: "b", name: "Beta", folder: "/work/b", machine: null };
  const view = await mount({
    projects: [alpha, beta],
    links: [alpha, beta].map(({ id }) => githubLink(id)),
    filters: { a: "all", b: "all" },
    rows: [issue({ project: "a", url, ticket: "#1", title: "From Alpha" }), issue({ project: "b", url, ticket: "#1", title: "From Beta" })],
    boards: [
      { project: "a", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), read_at: 1, failure: null },
      { project: "b", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), read_at: 1, failure: null },
    ],
  });
  view.show(view.rows[1], { notify() {}, spawn() { return { cancel() {} }; } });
  const texts = draw(view);
  assert.ok(texts.includes("#1 · Beta"));
  assert.equal(texts.includes("#1 · Alpha"), false);
});

test("A held send keeps the confirmed draft and the held recipient, and a blocked one is named instead of sent", async () => {
  const first = { pane: "p1", terminal: "t1", tab: "tab1", status: "working", program: { name: "Claude", agent: true } };
  const second = { pane: "p2", terminal: "t2", tab: "tab2", status: "done", program: { name: "Codex", agent: true } };
  const calls = [];
  const props = { text: "first draft", whenWaiting: true };
  const { Send } = await load("kanso-send/main.js", ["Send"], agentHost(props, [first, second], calls));
  const view = new Send();
  const { timers, pending, cx } = holdCx();
  view.init({}, cx);
  view.to = first.terminal;
  view.send(cx, view.state());
  view.text = "replacement";
  view.to = second.terminal;
  first.status = "done";
  timers.at(-1)(cx);
  await Promise.all(pending);
  assert.equal(calls.filter((call) => call[0] === "send").length, 1);
  assert.equal(calls.find((call) => call[0] === "send")[2], "first draft");
  assert.equal(calls.find((call) => call[0] === "send")[1], first.terminal);
  const blocked = [];
  const blockedPane = { ...first, status: "working" };
  const { Send: Held } = await load("kanso-send/main.js", ["Send"], agentHost({ text: "wait for it", whenWaiting: true }, blockedPane, blocked));
  const later = new Held();
  const again = [];
  const blockedCx = sendCx(again, []);
  later.init({}, blockedCx);
  later.to = "t1";
  later.send(blockedCx, later.state());
  blockedPane.status = "blocked";
  again.at(-1)(blockedCx);
  assert.equal(blocked.some((call) => call[0] === "send"), false);
  assert.match(later.error, /Claude is waiting on its own question/);
});

test("A project with no GitHub remote shows that, even when GitHub is signed out", async () => {
  world.answer = async (cmd) => cmd === "git"
    ? { code: 0, stdout: "", stderr: "" }
    : { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. Run gh auth login" };
  const view = await mount(shopBoard);
  const { cx, drain } = timedContext([]);
  view.readBoard(shop, "github", cx);
  await drain();
  const texts = draw(view);
  assert.ok(texts.includes("No GitHub remote"));
  assert.equal(texts.includes("Sign in"), false);
});
