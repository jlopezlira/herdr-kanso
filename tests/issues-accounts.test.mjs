import test from "node:test";
import assert from "node:assert/strict";
import { load, tape, KIT_NIGHT, timedContext } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const SECRET = "SECRET-XYZ";
const SITE = "acme.atlassian.net";
const LINEAR = "https://api.linear.app/graphql";
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const input = (start = {}) => {
  let value = start.value ?? "";
  return { value: () => value, set_value(next) { value = next; }, set_masked() {}, on() { return this; }, focus() {}, set_auto_grow() {} };
};
const fields = { TextareaState: { new: input }, InputState: { new: input } };
const http = (body, status = 200) => ({ code: 0, stdout: body + "\n" + status, stderr: "" });
const urlsIn = (calls) => calls.flat(3).flatMap((part) => String(part).match(/https?:\/\/[^\s'"]+/g) ?? []);
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
const allowed = new Set([SITE, "api.linear.app"]);

test("Saving, checking and removing a secret never print it, and a request keeps it out of the command", async () => {
  const { secretsApi } = await load("kanso-panel/platform-secrets.js", ["secretsApi"]);
  const calls = [];
  const ok = async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: "", stderr: "" }; };
  const mac = secretsApi("macos", ok);
  await mac.save("kanso-jira", SITE, SECRET);
  same(calls.at(-1), ["security", ["add-generic-password", "-U", "-s", "kanso-jira", "-a", SITE, "-w", SECRET]]);
  await mac.has("kanso-jira", SITE);
  assert.equal(calls.at(-1)[1][0], "find-generic-password");
  assert.equal(calls.at(-1)[1].includes("-w"), false);
  await mac.remove("kanso-jira", SITE);
  same(calls.at(-1), ["security", ["delete-generic-password", "-s", "kanso-jira", "-a", SITE]]);
  const linux = secretsApi("linux", ok);
  await linux.save("kanso-jira", SITE, SECRET);
  const saved = calls.at(-1);
  assert.equal(saved[0], "sh");
  assert.match(saved[1][1], /printf %s "\$1" \| secret-tool store/);
  assert.equal(saved[1][1].includes(SECRET), false);
  assert.equal(calls.some((call) => call[0] === "secret-tool" && JSON.stringify(call[1]).includes(SECRET)), false);
  const windows = secretsApi("windows", ok);
  await windows.save("kanso-jira", SITE, SECRET);
  assert.equal(calls.at(-1)[0], "cmdkey");
  assert.equal(calls.at(-1)[1][0], "/generic:kanso-jira:" + SITE);
  calls.length = 0;
  const asked = secretsApi("macos", async (cmd, args) => { calls.push([cmd, args]); return http('{"ok":true}', 204); });
  const answer = await asked.request({ service: "kanso-jira", account: SITE, auth: "basic", email: "ada@acme.net", method: "GET", body: "", url: "https://" + SITE + "/rest/api/3/myself" });
  assert.equal(answer.status, 204);
  assert.equal(answer.text, '{"ok":true}');
  same(calls[0][1].slice(3), ["kanso-jira", SITE, "ada@acme.net", "GET", "", "https://" + SITE + "/rest/api/3/myself"]);
  assert.equal(JSON.stringify(calls).includes(SECRET), false);
  const missing = await secretsApi("linux", async () => ({ code: 3, stdout: "", stderr: "" })).request({ service: "kanso-linear", account: "api.linear.app", url: LINEAR });
  assert.equal(missing.signedOut, true);
});

test("A Jira site is only an Atlassian host, the query follows the filter, and a board read stays on that site", async () => {
  const loaded = await load("kanso-panel/issues-jira.js", ["siteOf", "jqlOf", "adfText", "rowsOf", "readJiraBoard", "jiraClient"]);
  assert.equal(loaded.siteOf("https://acme.atlassian.net/jira/software"), SITE);
  assert.equal(loaded.siteOf("http://acme.atlassian.net"), SITE);
  assert.equal(loaded.siteOf("acme.atlassian.net"), SITE);
  assert.equal(loaded.siteOf("https://evil.example"), null);
  assert.equal(loaded.siteOf("https://acme.atlassian.net.evil.com"), null);
  assert.match(loaded.jqlOf("ABC", "assigned"), /assignee = currentUser\(\)/);
  assert.match(loaded.jqlOf("ABC", "created"), /reporter = currentUser\(\)/);
  assert.equal(/assignee = currentUser|reporter = currentUser/.test(loaded.jqlOf("ABC", "all")), false);
  const body = loaded.adfText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }] }] });
  assert.ok(body.includes("Hello"));
  assert.ok(body.includes("- One"));
  const row = loaded.rowsOf([{ key: "ABC-123", fields: { summary: "Ship", status: { id: "1", name: "Open" }, assignee: { emailAddress: "ada@acme.net" } } }], { site: SITE, key: "ABC", project: "shop", statusColumn: { 1: "To Do" }, now: 1 })[0];
  assert.equal(row.status, "To Do");
  assert.equal(row.ticket, "ABC-123");
  assert.equal(row.url, "https://" + SITE + "/browse/ABC-123");
  const urls = [];
  const secrets = { request: async ({ url }) => { urls.push(url); return { status: 200, text: url.includes("search/jql") ? JSON.stringify({ issues: [] }) : JSON.stringify({ values: [] }) }; } };
  const read = await loaded.readJiraBoard(loaded.jiraClient(secrets, { site: SITE, email: "ada@acme.net" }), { site: SITE, key: "ABC", project: "shop", filter: "assigned" });
  assert.equal(read.failure, null);
  assert.ok(urls.every((url) => url.startsWith("https://" + SITE + "/")));
  const refused = await loaded.readJiraBoard(loaded.jiraClient({ request: async () => ({ status: 401, text: "" }) }, { site: SITE, email: "ada@acme.net" }), { site: SITE, key: "ABC", project: "shop", filter: "all" });
  assert.equal(refused.failure.kind, "signed out");
  assert.equal(refused.failure.fix, "Reconnect");
  const limited = await loaded.readJiraBoard(loaded.jiraClient({ request: async () => ({ status: 429, text: "" }) }, { site: SITE, email: "ada@acme.net" }), { site: SITE, key: "ABC", project: "shop", filter: "all" });
  assert.equal(limited.failure.kind, "rate");
  const offline = await loaded.readJiraBoard(loaded.jiraClient({ request: async () => ({ status: 0, text: "", error: "could not resolve host" }) }, { site: SITE, email: "ada@acme.net" }), { site: SITE, key: "ABC", project: "shop", filter: "all" });
  assert.equal(offline.failure.kind, "offline");
});

test("Linear filters name the person, workflow states become columns in position order, and every request uses the Linear API", async () => {
  const { issueFilter, readLinearBoard, linearClient } = await load("kanso-panel/issues-linear.js", ["issueFilter", "readLinearBoard", "linearClient"]);
  assert.equal(issueFilter("team-1", "assigned").assignee.isMe.eq, true);
  assert.equal(issueFilter("team-1", "created").creator.isMe.eq, true);
  assert.equal(issueFilter("team-1", "all").assignee, undefined);
  assert.equal(issueFilter("team-1", "all").creator, undefined);
  const urls = [];
  const secrets = { request: async ({ url, body }) => {
    urls.push(url);
    const query = JSON.parse(body).query;
    if (query.includes("states")) return { status: 200, text: JSON.stringify({ data: { team: { states: { nodes: [{ name: "Done", position: 2 }, { name: "Todo", position: 0 }, { name: "Doing", position: 1 }] } } } }) };
    return { status: 200, text: JSON.stringify({ data: { issues: { nodes: [] } } }) };
  } };
  const board = await readLinearBoard(linearClient(secrets), { team: "team-1", project: "shop", filter: "all" });
  same(board.columns, ["Todo", "Doing", "Done"]);
  assert.ok(urls.every((url) => url === LINEAR));
});

const accountHost = (ui, exec, store) => ({
  ...ui.host, ...fields, exec, theme: () => KIT_NIGHT,
  Input: { new: () => ui.host.div() }, Textarea: { new: () => ui.host.div() },
  shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
  window: () => ({ platform: "macos" }),
});

test("Settings Accounts hides Sign in without a secret store, and a bad Jira site is rejected before anything is saved", async () => {
  const { tokens } = await load("kanso-settings/ui.js", ["tokens"]);
  const c = tokens(KIT_NIGHT);
  const none = tape();
  const { Accounts } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(none, async () => ({ code: 1, stdout: "", stderr: "" }), {}));
  const { cx, drain } = timedContext([]);
  const missing = new Accounts(cx);
  await drain();
  missing.page(c);
  assert.ok(none.texts.includes("This computer has no secret store, so Jira and Linear can't sign in here. GitHub keeps working."));
  assert.equal(none.texts.some((text) => text.includes("Sign in")), false);
  const calls = [];
  const ui = tape();
  const { Accounts: Ready } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(ui, async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: "", stderr: "" }; }, {}));
  const page = new Ready(cx);
  await drain();
  page.site.set_value("not-a-site");
  page.email.set_value("ada@acme.net");
  page.jiraToken.set_value(SECRET);
  page.signInJira(cx);
  page.page(c);
  assert.ok(ui.texts.includes("Enter your Jira Cloud site, such as your-site.atlassian.net"));
  assert.equal(calls.some((call) => call[1]?.[0] === "add-generic-password"), false);
});

test("A Jira sign-in stores the site, email and name and clears the token, a refused check removes the secret, and Sign out clears both", async () => {
  const calls = [];
  const store = {};
  let refuse = false;
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "sh" && String(args.at(-1)).includes("myself")) return refuse ? http("", 401) : http(JSON.stringify({ displayName: "Ada" }));
    return { code: 0, stdout: "", stderr: "" };
  };
  const ui = tape();
  const { Accounts } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(ui, exec, store));
  const { cx, drain } = timedContext([]);
  const page = new Accounts(cx);
  await drain();
  page.site.set_value("https://" + SITE + "/jira");
  page.email.set_value("ada@acme.net");
  page.jiraToken.set_value(SECRET);
  page.signInJira(cx);
  await drain();
  same(store["kanso.issues.accounts"].jira, { site: SITE, email: "ada@acme.net", name: "Ada" });
  assert.equal(page.jiraToken.value(), "");
  assert.equal(JSON.stringify(store).includes(SECRET), false);
  page.signOut("jira", cx);
  await drain();
  assert.equal(store["kanso.issues.accounts"].jira, undefined);
  assert.ok(calls.some((call) => call[1]?.[0] === "delete-generic-password"));
  refuse = true;
  page.site.set_value(SITE);
  page.email.set_value("ada@acme.net");
  page.jiraToken.set_value(SECRET);
  const before = calls.length;
  page.signInJira(cx);
  await drain();
  assert.equal(store["kanso.issues.accounts"].jira, undefined);
  assert.ok(calls.slice(before).some((call) => call[1]?.[0] === "delete-generic-password"));
});

const ticket = (source, key, title, status) => ({
  url: source.startsWith("linear") ? "https://linear.app/acme/issue/" + key : "https://" + SITE + "/browse/" + key,
  source, project: "shop", ticket: key, title, status, assignees: "[]", author: "ada", labels: "[]",
  updated_at: "2026-11-22T00:00:00Z",
});

test("A project linked to two Jira projects and one Linear team shows each board by source, and a Jira detail offers Open in Jira without a secret", async () => {
  const drawn = tape();
  const overlays = [];
  const store = { "kanso.issues.accounts": { jira: { site: SITE, email: "ada@acme.net", name: "Ada" }, linear: { name: "Ada", email: "ada@acme.net" } } };
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], {
    ...drawn.host, theme: () => KIT_NIGHT, spaces: () => [], home: () => "/home/me",
    shared: (key) => store[key] ?? null, openOverlay: (overlay) => overlays.push(overlay),
    window: () => ({ platform: "macos" }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  const { sendText } = await load("kanso-panel/issues-model.js", ["sendText"]);
  const rows = [
    ticket("jira:ABC", "ABC-1", "Alpha ship", "To Do"),
    ticket("jira:DEF", "DEF-2", "Beta ship", "In Progress"),
    ticket("linear:team-1", "ENG-3", "Linear ship", "Todo"),
  ];
  const boards = [
    { project: "shop", source: "jira:ABC", filter: "all", columns: JSON.stringify(["To Do", "In Progress"]), read_at: 1, failure: null },
    { project: "shop", source: "jira:DEF", filter: "all", columns: JSON.stringify(["In Progress", "Done"]), read_at: 1, failure: null },
    { project: "shop", source: "linear:team-1", filter: "all", columns: JSON.stringify(["Todo", "Doing", "Done"]), read_at: 1, failure: null },
  ];
  const links = [
    { project: "shop", source: "jira", ref: "ABC", name: "ABC · Alpha" },
    { project: "shop", source: "jira", ref: "DEF", name: "DEF · Beta" },
    { project: "shop", source: "linear", ref: "team-1", name: "ENG · Eng" },
  ];
  const view = new Issues({ read: async () => ({ rows, boards, links: [] }), run: async () => {} });
  Object.assign(view, { filters: { shop: "all" }, folds: {}, projects: [{ id: "shop", name: "Shop", folder: "/work/shop", machine: null }], rows, boards, links, logins: {}, places: {}, reading: new Set(), open: null, front: null, linking: null });
  view.render({ notify() {} });
  const texts = drawn.texts;
  assert.ok(texts.indexOf("Jira · ABC · Alpha") < texts.indexOf("To Do"));
  assert.ok(texts.indexOf("To Do") < texts.indexOf("In Progress"));
  assert.ok(texts.includes("Jira · DEF · Beta"));
  assert.ok(texts.indexOf("Linear · ENG · Eng") < texts.indexOf("Todo"));
  assert.ok(texts.indexOf("Todo") < texts.indexOf("Doing"));
  assert.ok(texts.includes("Link Jira projects…"));
  view.open = rows[0].url;
  drawn.texts.length = 0;
  view.render({ notify() {} });
  assert.ok(drawn.texts.includes("Open in Jira"));
  view.sendToAgent(rows[0]);
  assert.equal(overlays[0].props.text, sendText(rows[0]));
  assert.equal(overlays[0].props.text.includes(SECRET), false);
});

test("A Jira and Linear sign-in and board read keep the secret out of the database, the log, shared state, the draft and every request host", async (t) => {
  const logs = [];
  const keep = {};
  for (const name of ["log", "info", "warn", "error", "debug"]) { keep[name] = console[name]; console[name] = (...args) => logs.push(args); }
  try {
    const calls = [];
    const vault = new Map();
    const exec = async (cmd, args = []) => {
      calls.push([cmd, args]);
      if (cmd === "security" && args[0] === "add-generic-password") { vault.set(args[args.indexOf("-a") + 1], args[args.indexOf("-w") + 1]); return { code: 0, stdout: "", stderr: "" }; }
      if (cmd === "security" && args.includes("-w")) return { code: 0, stdout: (vault.get(args[args.indexOf("-a") + 1]) ?? "") + "\n", stderr: "" };
      if (cmd === "security") return { code: 0, stdout: "", stderr: "" };
      if (cmd !== "sh") return { code: 0, stdout: "", stderr: "" };
      const url = String(args.at(-1));
      if (url.includes("/myself")) return http(JSON.stringify({ displayName: "Ada", emailAddress: "ada@acme.net" }));
      if (url.includes("search/jql")) return http(JSON.stringify({ issues: [{ key: "ABC-1", fields: { summary: "Ship it", status: { id: "1", name: "To Do" }, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plain body" }] }] } } }] }));
      if (url.includes("/board?")) return http(JSON.stringify({ values: [{ id: 4 }] }));
      if (url.includes("/configuration")) return http(JSON.stringify({ columnConfig: { columns: [{ name: "To Do", statuses: [{ id: "1" }] }] } }));
      if (url.includes("api.linear.app")) return http(JSON.stringify({ data: { viewer: { name: "Ada", email: "ada@acme.net" }, issues: { nodes: [{ id: "lin-1", identifier: "ENG-1", title: "Linear ship", url: "https://linear.app/acme/issue/ENG-1", state: { name: "Todo" }, description: "Plain body" }] }, team: { states: { nodes: [{ name: "Todo", position: 0 }] } } } }));
      return http("{}");
    };
    const store = {};
    const ui = tape();
    const { Accounts } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(ui, exec, store));
    const { cx, drain } = timedContext([]);
    const page = new Accounts(cx);
    await drain();
    page.site.set_value(SITE);
    page.email.set_value("ada@acme.net");
    page.jiraToken.set_value(SECRET);
    page.signInJira(cx);
    await drain();
    page.linearKey.set_value(SECRET);
    page.signInLinear(cx);
    await drain();
    const { db } = await temporaryKdb(t);
    const { secretsApi } = await load("kanso-panel/platform-secrets.js", ["secretsApi"], { exec });
    const { jiraClient } = await load("kanso-panel/issues-jira.js", ["jiraClient"], { exec });
    const { linearClient } = await load("kanso-panel/issues-linear.js", ["linearClient"], { exec });
    const { syncJiraBoard, syncLinearBoard } = await load("kanso-panel/issues-linked.js", ["syncJiraBoard", "syncLinearBoard"]);
    const { sendText } = await load("kanso-panel/issues-model.js", ["sendText"]);
    const secrets = secretsApi("macos", exec);
    await syncJiraBoard(db, jiraClient(secrets, { site: SITE, email: "ada@acme.net" }), { site: SITE, key: "ABC", project: "shop", filter: "all", who: "ada@acme.net", kept: [], now: 5 });
    await syncLinearBoard(db, linearClient(secrets), { team: "team-1", project: "shop", filter: "all", who: "ada@acme.net", kept: [], now: 6 });
    const names = await db.read("SELECT name FROM sqlite_master WHERE type='table'");
    for (const table of names) {
      const rows = await db.read("SELECT * FROM " + table.name);
      assert.equal(JSON.stringify(rows).includes(SECRET), false, table.name);
    }
    const kept = await db.read("SELECT * FROM issues");
    for (const row of kept) assert.equal(sendText(row).includes(SECRET), false);
    assert.equal(JSON.stringify(store).includes(SECRET), false);
    assert.equal(JSON.stringify(logs).includes(SECRET), false);
    const hosts = urlsIn(calls).map(hostOf);
    assert.ok(hosts.length > 0);
    assert.ok(hosts.every((host) => allowed.has(host)), hosts.join(","));
  } finally {
    Object.assign(console, keep);
  }
});

test("Link Jira projects lists the projects, and a click stores the link and reads that board", async (t) => {
  const drawn = tape();
  const urls = [];
  const store = { "kanso.issues.accounts": { jira: { site: SITE, email: "ada@acme.net", name: "Ada" } } };
  const { Issues } = await load("kanso-panel/issues.js", ["Issues"], {
    ...drawn.host, theme: () => KIT_NIGHT, spaces: () => [], home: () => "/home/me",
    shared: (key) => store[key] ?? null, window: () => ({ platform: "macos" }),
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });
  const { db } = await temporaryKdb(t);
  const view = new Issues(db);
  Object.assign(view, {
    filters: { shop: "all" }, folds: {}, projects: [{ id: "shop", name: "Shop", folder: "/work/shop", machine: null }],
    rows: [], boards: [], links: [], logins: {}, places: {}, reading: new Set(), open: null, front: null, linking: null,
    secrets: { request: async ({ url }) => {
      urls.push(url);
      if (url.includes("project/search")) return { status: 200, text: JSON.stringify({ values: [{ key: "ABC", name: "Alpha" }] }) };
      if (url.includes("search/jql")) return { status: 200, text: JSON.stringify({ issues: [] }) };
      return { status: 200, text: JSON.stringify({ values: [] }) };
    } },
  });
  const { cx, drain } = timedContext([]);
  view.render(cx);
  drawn.handlers.get("issues-link-jira-shop")(null, cx);
  await drain();
  view.render(cx);
  assert.ok(drawn.texts.includes("ABC · Alpha"));
  drawn.handlers.get("issues-link-shop-ABC")(null, cx);
  await drain();
  const links = await db.read("SELECT ref FROM issue_links");
  same(links.map((row) => row.ref), ["ABC"]);
  assert.ok(urls.some((url) => url.includes("search/jql")));
});
