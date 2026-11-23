import test from "node:test";
import assert from "node:assert/strict";
import { arg, drawingHost, failure, find, KIT_NIGHT, load, one, press, same, success, tape, texts, timedContext } from "./helpers.mjs";
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
  return Object.assign(new Issues({ read: async () => [], run: async () => {} }), {
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

const NO_PROJECTS = "Add a project to see its tasks";
const startIssues = async (db, host = {}) => {
  const { Issues, DIALOG } = await load("kanso-panel/issues.js", ["Issues", "DIALOG"], {
    ...viewHost,
    ...drawingHost(),
    spaces: () => [],
    checking: () => true,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    ...host,
  });
  const { cx, drain } = timedContext([]);
  const view = new Issues(db);
  view.init(cx);
  await drain();
  return { view, cx, drain, DIALOG };
};

test("Opening Tasks in a project draws without asking for a redraw while it draws, then reads that project", async (t) => {
  const { db } = await temporaryKdb(t);
  await db.addProject({ name: shop.name, folder: shop.folder });
  const exec = t.mock.fn(async () => ({ code: 1, stdout: "", stderr: "" }));
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], {
    ...viewHost, ...drawingHost(), checking: () => true, exec,
    spaces: () => [{ active: true, folder: shop.folder, machine: null, tabs: [] }],
  });
  const drawing = { now: false };
  const timers = [];
  const { cx, drain } = timedContext(timers, { notify() { if (drawing.now) throw new Error("cx.notify() during render"); } });
  const view = new Issues(db);
  view.init(cx);
  await drain();
  const before = exec.mock.callCount();
  drawing.now = true;
  view.render(cx);
  drawing.now = false;
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

test("The empty Tasks panel tells me to add a project to see its tasks", async (t) => {
  const { db } = await temporaryKdb(t);
  const { view, cx } = await startIssues(db);
  const words = texts(view.render(cx));
  assert.ok(words.includes("Tasks"));
  assert.ok(words.includes(NO_PROJECTS));
});

test("Tasks lists each open project once, skips the home space, and prefers a saved project at the same place", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = () => [homeSpace, remoteKanso, { ...remoteKanso, id: "second-space" }];
  const { view, cx, drain } = await startIssues(db, { spaces });
  const openId = `light:${remoteKanso.folder}`;
  const open = view.render(cx);
  assert.ok(projectHeading(open, openId));
  const words = texts(open);
  assert.equal(words.filter((word) => word === remoteKanso.name).length, 1);
  assert.equal(words.includes(homeSpace.name), false);

  const { row } = await db.addProject({ ...remoteKanso, name: "Saved kansō" });
  view.load(cx);
  await drain();
  const saved = view.render(cx);
  assert.ok(texts(projectHeading(saved, row.id)).includes(row.name));
  assert.equal(projectHeading(saved, openId), null);
});

test("Tasks skips the local home but keeps a project at the same path on another computer", async (t) => {
  const { db } = await temporaryKdb(t);
  const remote = { ...homeSpace, id: "remote-home", name: "Project on light", machine: "light" };
  const { view, cx } = await startIssues(db, { spaces: () => [homeSpace, remote] });
  const words = texts(view.render(cx));
  assert.ok(words.includes(remote.name));
  assert.equal(words.includes(homeSpace.name), false);
});

test("Linking a Jira board from an open space saves the project and links the board to that saved project", async (t) => {
  const { db } = await temporaryKdb(t);
  const addProject = t.mock.method(db, "addProject");
  const { view, cx, drain } = await startIssues(db, { spaces: () => [remoteKanso] });
  const { name, folder, machine } = remoteKanso;
  const item = { ref: "acme.atlassian.net/ABC", name: "ABC · Alpha" };
  view.link(`${machine}:${folder}`, "jira", item, true, cx);
  await drain();

  assert.equal(addProject.mock.callCount(), 1);
  const [call] = addProject.mock.calls;
  same(call.arguments, [{ name, folder, machine }]);
  const { row } = await call.result;
  same(await db.read("SELECT project, source, ref, name FROM issue_links;"), [
    { project: row.id, source: "jira", ...item },
  ]);
});

test("Tasks picks up a project space opened after the panel mounted", async (t) => {
  const { db } = await temporaryKdb(t);
  const spaces = t.mock.fn(() => [homeSpace]);
  const { view, cx, drain } = await startIssues(db, { spaces });
  assert.equal(texts(view.render(cx)).includes(remoteKanso.name), false);
  spaces.mock.mockImplementation(() => [homeSpace, remoteKanso]);
  view.render(cx);
  await drain();
  assert.ok(texts(view.render(cx)).includes(remoteKanso.name));
});

test("With no projects, New project opens the sidebar's New project dialog", async (t) => {
  const { db } = await temporaryKdb(t);
  const openOverlay = t.mock.fn();
  const { view, cx, DIALOG } = await startIssues(db, { openOverlay });
  const page = view.render(cx);
  assert.ok(texts(page).includes(NO_PROJECTS));
  assert.ok(texts(page).includes("New project"));
  press(page, "issues-none-action");
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
  assert.ok(texts(view.render(cx)).includes(NO_PROJECTS));
  const { row } = await db.addProject({ name: shop.name, folder: shop.folder });
  shared.mock.mockImplementation((key) => key === "kanso.registry" ? [{ id: row.id }] : null);
  view.render(cx);
  await drain();
  const words = texts(view.render(cx));
  assert.ok(words.includes(shop.name));
  assert.equal(words.includes(NO_PROJECTS), false);
});

test("Issues keeps showing the project when a later projects read fails", async (t) => {
  const { db } = await temporaryKdb(t);
  await db.addProject({ name: shop.name, folder: shop.folder });
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
  world.answer = async (cmd) => {
    if (cmd === "git") return { code: 0, stdout: "origin\tgit@github.com:acme/shop.git (fetch)\n", stderr: "" };
    if (cmd === "gh") return { code: 0, stdout: "github.com\n  Logged in to github.com account jj\n  Active account: true\n", stderr: "" };
    return payload([]);
  };
  const view = await mount({
    projects: [shop],
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
    projects: [shop],
    boards: [{ project: "shop", source: "github", filter: "assigned", columns: JSON.stringify(["Open"]), read_at: at, failure: JSON.stringify({ kind: "offline", text: "GitHub can't be reached" }) }],
    filters: { shop: "all" },
    rows: [issue({ title: "Cached issue" })],
  });
  const texts = draw(view);
  assert.ok(texts.includes("Cached issue"));
  assert.ok(texts.includes("Showing the copy read at " + clock(at)));
});

test("A signed-out project shows Sign in, and a project without a GitHub remote says so", async () => {
  const signed = await mount({ projects: [shop], places: { "shop\u0000github": { kind: "signed out", text: "Sign in to GitHub to see your issues" } } });
  assert.ok(draw(signed).includes("Sign in"));
  const remote = await mount({ projects: [shop], places: { "shop\u0000github": { kind: "no remote", text: "No GitHub remote" } } });
  assert.ok(draw(remote).includes("No GitHub remote"));
});

const GITHUB_REMOTE = "origin\tgit@github.com:acme/shop.git (fetch)\n";
const signedOut = () => failure("You are not logged into any GitHub hosts.");
const githubTasks = async (t, answer, host = {}) => {
  const { db } = await temporaryKdb(t);
  const { row } = await db.addProject(remoteShop);
  const exec = t.mock.fn(answer);
  const tasks = await startIssues(db, { exec, ...host });
  return {
    ...tasks, exec,
    page: () => tasks.view.render(tasks.cx),
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
  one(find(panel, (el) => el.tag === action), "on_click")(null, cx);
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
  const signed = "github.com\n  Logged in to github.com account jj\n  Active account: true\n";
  const answers = [
    { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. Run gh auth login" },
    { code: 0, stdout: signed, stderr: "" },
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
    projects: [shop],
    rows: [issue({ title: "Cached issue" })],
    filters: { shop: "all" },
    boards: [board],
  });
  failed.db = { read: async (sql) => String(sql).includes("issue_boards") ? [board] : String(sql).includes("FROM issues") ? failed.rows : [], run: async () => {} };
  world.answer = async (cmd) => cmd === "git"
    ? { code: 0, stdout: "origin\tgit@github.com:acme/shop.git (fetch)\n", stderr: "" }
    : { code: 1, stdout: "", stderr: "temporary failure" };
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
      if (String(sql).includes("FROM projects")) return [shop];
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
  const view = await mount({ projects: [shop], rows: [], boards: [] });
  const { cx, drain } = timedContext([]);
  view.readBoard(shop, "github", cx);
  await drain();
  const texts = draw(view);
  assert.ok(texts.includes("No GitHub remote"));
  assert.equal(texts.includes("Sign in"), false);
});
