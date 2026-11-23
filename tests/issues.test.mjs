import test from "node:test";
import assert from "node:assert/strict";
import { load, tape, KIT_NIGHT, timedContext } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
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
  const board = await readBoard(run, { repo: REPO, project: "shop", filter: "all", login: "jj" });
  assert.equal(board.noProjects, true);
  assert.equal(calls[1].some((part) => String(part).includes("projectItems")), false);
  assert.equal(board.rows[0].status, null);
});

test("A rate limit names when to retry, and an offline read is offline", async () => {
  const { readBoard } = await boardRun();
  const now = 1_700_000_000_000;
  const reset = Math.floor(now / 1000) + 180;
  const limited = await readBoard(async () => ({ code: 1, stdout: "", stderr: "rate limit exceeded\nX-RateLimit-Reset: " + reset }), { repo: REPO, project: "shop", filter: "all", login: "jj", now });
  same(limited.failure, { kind: "rate", text: "GitHub is limiting requests", retryAt: reset * 1000 });
  const offline = await readBoard(async () => ({ code: 1, stdout: "", stderr: "could not resolve host" }), { repo: REPO, project: "shop", filter: "all", login: "jj", now });
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
  const repo = await repoOf(async (_cmd, args) => ({ code: 0, stdout: args?.includes("-v") ? "origin\tgit@github.com:acme/shop.git (fetch)\n" : "", stderr: "" }), "/work/shop");
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
  theme: () => KIT_NIGHT,
  spaces: () => [{ active: true, folder: "/work/shop", machine: null, tabs: [] }],
  home: () => "/Users/jj",
  openOverlay: (spec) => overlays.push(spec),
  openUrl: () => {},
  exec: async (cmd, args) => { world.calls.push([cmd, args]); return world.answer(cmd, args); },
};

const mount = async (extra = {}) => {
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], viewHost);
  return Object.assign(new Issues({ read: async () => [], run: async () => {} }), {
    projects: [], rows: [], boards: [], places: {}, folds: {}, filters: {}, logins: {},
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
  const signed = await mount({ projects: [shop], places: { shop: { kind: "signed out", text: "Sign in to GitHub to see your issues" } } });
  assert.ok(draw(signed).includes("Sign in"));
  const remote = await mount({ projects: [shop], places: { shop: { kind: "no remote", text: "No GitHub remote" } } });
  assert.ok(draw(remote).includes("No GitHub remote"));
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
  const followed = await readBoard(async (_cmd, args) => { seen.push(afterOf(args)); n += 1; return pageOf(n, "c" + n, n < 2); }, { repo: REPO, project: "shop", filter: "all", login: "jj" });
  assert.equal(seen[0], null);
  assert.equal(seen[1], "after=c1");
  assert.equal(followed.rows.length, 2);
  assert.equal(followed.complete, true);
  const capped = [];
  const limited = await readBoard(async (_cmd, args) => { capped.push(afterOf(args)); return pageOf(capped.length, "p" + capped.length, true); }, { repo: REPO, project: "shop", filter: "all", login: "jj" });
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

const agentHost = (props, pane, calls) => ({
  props: () => props,
  panes: () => [pane],
  terminals: () => [{ address: pane.terminal, status: pane.status, program: pane.program, labels: { "kanso.shown": "Claude" } }],
  machines: () => [], spaces: () => [{ name: "Shop", tabs: [{ id: pane.tab }] }], shared: () => null,
  hc: async (args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  closeOverlay() {}, run() {},
  TextareaState: { new: (start) => ({ value: () => start?.value ?? "", on() { return this; }, focus() {}, set_auto_grow() {}, set_value() {} }) },
  InputState: { new: (start) => ({ value: () => start?.value ?? "", on() { return this; }, focus() {}, set_auto_grow() {}, set_value() {} }) },
});

test("Send holds a working recipient until that agent is done, and without the wait it sends at once", async () => {
  const pane = { pane: "p1", terminal: "t1", tab: "tab1", status: "working", program: { name: "Claude", agent: true } };
  const held = [];
  const props = { text: "Ship it", whenWaiting: true };
  const { Send } = await load("kanso-send/main.js", ["Send"], agentHost(props, pane, held));
  const waiting = new Send();
  const timers = [];
  const pending = [];
  const cx = { notify() {}, focus_handle: () => ({}), spawn(fn) { pending.push(fn(cx)); return { cancel() {} }; }, timer: { after(_ms, fn) { timers.push(fn); return { cancel() {} }; } } };
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
  const failed = await mount({
    projects: [shop],
    rows: [issue({ title: "Cached issue" })],
    filters: { shop: "all" },
    boards: [{ project: "shop", source: "github", filter: "all", who: "jj", columns: JSON.stringify(["Open"]), read_at: at, failure: null }],
  });
  world.answer = async () => ({ code: 1, stdout: "", stderr: "temporary failure" });
  const { cx, drain } = timedContext([]);
  failed.readProject(shop, cx);
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
  await pending.shift();
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
