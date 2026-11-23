import test from "node:test";
import assert from "node:assert/strict";
import { load, tape, KIT_NIGHT, timedContext, same } from "./helpers.mjs";

const SECRET = "SECRET-XYZ";
const SITE = "acme.atlassian.net";
const OTHER = "old.atlassian.net";
const LINEAR = "https://api.linear.app/graphql";
const ACCOUNTS = "kanso.issues.accounts";
const shop = { id: "shop", name: "Shop", folder: "/work/shop", machine: null };
const input = (start = {}) => {
  const box = { value: start.value ?? "" };
  return { value: () => box.value, set_value(next) { box.value = next; }, set_masked() {}, on() { return this; }, focus() {}, set_auto_grow() {} };
};
const fields = { TextareaState: { new: input }, InputState: { new: input } };
const http = (body, status = 200) => ({ code: 0, stdout: body + "\n" + status, stderr: "" });
const jiraIssue = (n) => ({ key: "ABC-" + n, fields: { summary: "N" + n, status: { id: "1", name: "Open" }, updated: "2026-11-22T00:00:00Z" } });
const searchBody = (index, last) => JSON.stringify({ issues: [jiraIssue(index)], isLast: index >= last, nextPageToken: String(index + 1) });
const linearNode = (n) => ({ id: "lin-" + n, identifier: "ENG-" + n, title: "L" + n, url: "https://linear.app/acme/issue/ENG-" + n, state: { name: "Todo" }, assignee: { id: "lin-ada" }, creator: { id: "lin-ada" }, updatedAt: "2026-11-22T00:00:00Z", createdAt: "2026-11-22T00:00:00Z" });
const linearPage = (index, last) => JSON.stringify({ data: { issues: { nodes: [linearNode(index)], pageInfo: { hasNextPage: index < last, endCursor: String(index + 1) } } } });
const quiet = async () => ({ code: 0, stdout: "", stderr: "" });
const signedIn = () => ({ [ACCOUNTS]: { jira: { site: SITE, email: "ada@acme.net", name: "Ada", accountId: "acc-1" } } });
const loadSecrets = () => load("kanso-panel/platform-secrets.js", ["secretsApi"]);
const jiraIndex = (body) => { const token = body ? JSON.parse(body).nextPageToken : null; return token ? Number(token) : 0; };
const linearBody = (body) => { const parsed = JSON.parse(body); return { query: parsed.query, after: parsed.variables.after, index: parsed.variables.after ? Number(parsed.variables.after) : 0 }; };
const redraw = (drawn, view, cx) => { drawn.texts.length = 0; view.render(cx); };

const accountHost = (ui, exec, store, extra = {}) => ({
  ...ui.host, ...fields, exec, theme: () => KIT_NIGHT,
  Input: { new: () => ui.host.div() }, Textarea: { new: () => ui.host.div() },
  shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
  window: () => ({ platform: "macos" }), checking: () => false,
  hc: async () => ({ code: 0, stdout: "", stderr: "" }), terminals: () => [], openOverlay() {},
  ...extra,
});
const fillJira = (page, site) => { page.site.set_value(site); page.email.set_value("ada@acme.net"); };
const openAccounts = async (exec, store, extra = {}) => {
  const ui = tape();
  const timers = [];
  const { Accounts } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(ui, exec, store, extra));
  const timed = timedContext(timers);
  const page = new Accounts(timed.cx);
  await timed.drain();
  return { ui, page, timers, ...timed };
};
const loadIssues = (drawn, store, extra) => load("kanso-panel/issues.js", ["Issues"], {
  ...drawn.host, theme: () => KIT_NIGHT, spaces: () => [], home: () => "/home/me", checking: () => false,
  shared: (key) => store[key] ?? null, window: () => ({ platform: "macos" }), ...extra,
});
const mountIssues = async (store, spec = {}) => {
  const drawn = tape();
  const overlays = [];
  const urls = [];
  const runs = [];
  const { Issues } = await loadIssues(drawn, store, { openOverlay: (overlay) => overlays.push(overlay), exec: async () => ({ code: 1, stdout: "", stderr: "" }) });
  const rows = spec.rows ?? [];
  const boards = spec.boards ?? [];
  const links = spec.links ?? [];
  const view = new Issues({
    read: async (sql) => {
      const text = String(sql);
      if (text.includes("issue_boards")) return boards;
      if (text.includes("issue_links")) return links;
      if (text.includes("FROM issues")) return rows;
      return [];
    },
    run: async (sql) => { runs.push(sql); },
  });
  Object.assign(view, {
    filters: { shop: "all" }, folds: {}, projects: [shop], rows, boards, links, logins: {}, places: spec.places ?? {},
    reading: new Set(), open: null, front: null, linking: null, store: spec.store ?? true,
    secrets: { request: async (req) => { urls.push(req.url); return spec.answer ? spec.answer(req) : { status: 200, text: "{}" }; } },
  });
  return { drawn, overlays, urls, runs, view };
};
const finishPrompt = async ({ page, cx, drain, timers, gate }) => {
  await drain();
  gate.gone = true;
  timers.at(-1)[1](cx);
  await drain();
};

test("A prompt never carries the secret, and available, has, remove and request never print it", async () => {
  const { secretsApi } = await loadSecrets();
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: "\n204", stderr: "" }; };
  const mac = secretsApi("macos", run);
  const linux = secretsApi("linux", quiet);
  const windows = secretsApi("windows", run);
  assert.equal(mac.save, undefined);
  assert.equal(linux.save, undefined);
  assert.equal(windows.save, undefined);
  const macPrompt = mac.prompt("kanso-jira", SITE, "kansō Jira", "Paste your Jira API token");
  assert.equal(macPrompt[2].endsWith("-w"), true);
  assert.equal(macPrompt.includes(SECRET), false);
  const linuxPrompt = linux.prompt("kanso-jira", SITE, "kansō Jira", "Paste");
  assert.match(linuxPrompt[2], /secret-tool store --label="\$4" service "\$2" account "\$3"/);
  assert.equal(linuxPrompt.includes(SECRET), false);
  same(windows.prompt("kanso-jira", SITE, "kansō Jira", "Paste"), ["cmdkey", "/generic:kanso-jira:" + SITE, "/user:" + SITE, "/pass"]);
  await mac.available();
  await mac.has("kanso-jira", SITE);
  await mac.remove("kanso-jira", SITE);
  await mac.request({ service: "kanso-jira", account: SITE, auth: "basic", email: "ada@acme.net", method: "GET", url: "https://" + SITE + "/rest/api/3/myself" });
  assert.equal(JSON.stringify(calls).includes(SECRET), false);
  assert.equal(calls.some((call) => call[1]?.includes("-w")), false);
});

test("A Jira site is only an Atlassian host, and a row keeps the account id when the person has no email", async () => {
  const loaded = await load("kanso-panel/issues-jira.js", ["siteOf", "jqlOf", "adfText", "rowsOf", "jiraRef"]);
  const { matches } = await load("kanso-panel/issues-model.js", ["matches"]);
  assert.equal(loaded.siteOf("https://acme.atlassian.net/jira/software"), SITE);
  assert.equal(loaded.siteOf("https://evil.example"), null);
  assert.match(loaded.jqlOf("ABC", "assigned"), /assignee = currentUser\(\)/);
  assert.equal(/assignee = currentUser|reporter = currentUser/.test(loaded.jqlOf("ABC", "all")), false);
  const body = loaded.adfText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] });
  assert.ok(body.includes("Hello"));
  const row = loaded.rowsOf([{ key: "ABC-1", fields: { summary: "Ship", status: { id: "1", name: "Open" }, assignee: { accountId: "acc-1", displayName: "Ada" }, reporter: { accountId: "acc-1", displayName: "Ada" } } }], { site: SITE, key: "ABC", project: "shop", statusColumn: { 1: "To Do" }, now: 1 })[0];
  assert.equal(row.source, "jira:" + loaded.jiraRef(SITE, "ABC"));
  assert.equal(row.assignees, JSON.stringify(["acc-1"]));
  assert.equal(row.author, "acc-1");
  assert.equal(JSON.stringify(row).includes("ada@"), false);
  assert.equal(matches(row, "assigned", "acc-1"), true);
  assert.equal(matches(row, "created", "acc-1"), true);
});

test("Linear rows match the assignee and creator ids, and a board follows the next page", async () => {
  const { rowsOf, readLinearBoard, linearClient } = await load("kanso-panel/issues-linear.js", ["rowsOf", "readLinearBoard", "linearClient"]);
  const { matches } = await load("kanso-panel/issues-model.js", ["matches"]);
  const row = rowsOf([linearNode(1)], { team: "team-1", project: "shop", now: 1 })[0];
  assert.equal(matches(row, "assigned", "lin-ada"), true);
  assert.equal(matches(row, "created", "lin-ada"), true);
  const seen = [];
  const secrets = { request: async ({ url, body }) => {
    seen.push(url);
    const asked = linearBody(body);
    if (asked.query.includes("states")) return { status: 200, text: JSON.stringify({ data: { team: { states: { nodes: [{ name: "Todo", position: 0 }] } } } }) };
    const index = asked.index;
    return { status: 200, text: linearPage(index, 1) };
  } };
  const board = await readLinearBoard(linearClient(secrets), { ref: "team-1", project: "shop", filter: "all" });
  assert.equal(board.complete, true);
  assert.equal(board.rows.length, 2);
  assert.equal(seen.filter((url) => url === LINEAR).length >= 2, true);
});

test("Jira and Linear page until the last page, and a capped read stores rows without deleting a cached one", async () => {
  const { readJiraBoard, jiraClient } = await load("kanso-panel/issues-jira.js", ["readJiraBoard", "jiraClient"]);
  const { readLinearBoard, linearClient } = await load("kanso-panel/issues-linear.js", ["readLinearBoard", "linearClient"]);
  const { syncLinkedBoard, LINKED } = await load("kanso-panel/issues-linked.js", ["syncLinkedBoard", "LINKED"]);
  const searches = [];
  const jira = jiraClient({ request: async ({ url, body }) => {
    if (!String(url).includes("search/jql")) return { status: 200, text: JSON.stringify({ values: [] }) };
    const index = jiraIndex(body);
    searches.push(index);
    return { status: 200, text: searchBody(index, 1) };
  } }, { site: SITE, email: "ada@acme.net" });
  const two = await readJiraBoard(jira, { ref: SITE + "/ABC", project: "shop", filter: "all", now: 1 });
  assert.equal(searches.length, 2);
  assert.equal(two.rows.length, 2);
  assert.equal(two.complete, true);
  const capped = [];
  const many = jiraClient({ request: async ({ url, body }) => {
    if (!String(url).includes("search/jql")) return { status: 200, text: JSON.stringify({ values: [{ id: 4 }] }) };
    const index = jiraIndex(body);
    capped.push(index);
    return { status: 200, text: searchBody(index, 99) };
  } }, { site: SITE, email: "ada@acme.net" });
  const sql = [];
  await syncLinkedBoard({ run: async (text) => { sql.push(text); } }, LINKED.jira, many, {
    kind: "jira", ref: SITE + "/ABC", project: "shop", filter: "all", who: "acc-1",
    kept: [{ project: "shop", source: "jira:" + SITE + "/ABC", url: "https://" + SITE + "/browse/GONE", assignees: "[]", author: null }], now: 2,
  });
  assert.equal(capped.length, 10);
  assert.equal(sql.some((text) => text.includes("DELETE")), false);
  const later = [];
  const stalled = await readJiraBoard(jiraClient({ request: async ({ url, body }) => {
    if (!String(url).includes("search/jql")) return { status: 200, text: "{}" };
    const token = body ? JSON.parse(body).nextPageToken : null;
    later.push(token ?? "first");
    return token ? { status: 429, text: "" } : { status: 200, text: searchBody(0, 99) };
  } }, { site: SITE, email: "ada@acme.net" }), { ref: SITE + "/ABC", project: "shop", filter: "all", now: 3 });
  assert.equal(stalled.rows.length, 1);
  assert.equal(stalled.failure.kind, "rate");
  assert.equal(stalled.complete, false);
  const teams = [];
  const listed = await linearClient({ request: async ({ body }) => {
    const teamPage = linearBody(body).index;
    teams.push(teamPage);
    return { status: 200, text: JSON.stringify({ data: { teams: { nodes: [{ id: "t" + teamPage, key: "T" + teamPage, name: "Team" }], pageInfo: { hasNextPage: teamPage < 1, endCursor: String(teamPage + 1) } } } }) };
  } }).projects();
  assert.equal(teams.length, 2);
  assert.equal(listed.list.length, 2);
  const linearSeen = [];
  const linearBoard = await readLinearBoard(linearClient({ request: async ({ body }) => {
    const asked = linearBody(body);
    if (asked.query.includes("states")) return { status: 200, text: JSON.stringify({ data: { team: { states: { nodes: [] } } } }) };
    linearSeen.push(asked.index);
    return { status: 200, text: linearPage(asked.index, 99) };
  } }), { ref: "team-1", project: "shop", filter: "all" });
  assert.equal(linearSeen.length, 10);
  assert.equal(linearBoard.complete, false);
});

test("Jira projects follow startAt until the last page", async () => {
  const { jiraClient } = await load("kanso-panel/issues-jira.js", ["jiraClient"]);
  const starts = [];
  const found = await jiraClient({ request: async ({ url }) => {
    const start = Number(new URL(url).searchParams.get("startAt") ?? 0);
    starts.push(start);
    const values = start === 0 ? Array.from({ length: 100 }, (_v, i) => ({ key: "P" + i, name: "N" })) : [{ key: "LAST", name: "Last" }];
    return { status: 200, text: JSON.stringify({ values, isLast: start !== 0 }) };
  } }, { site: SITE, email: "ada@acme.net" }).projects();
  same(starts, [0, 100]);
  assert.equal(found.list.length, 101);
  assert.equal(found.list.at(-1).ref, SITE + "/LAST");
});

test("Settings shows it is looking before the secret store answers, and a bad site is rejected before a prompt", async () => {
  const { tokens } = await load("kanso-settings/ui.js", ["tokens"]);
  const c = tokens(KIT_NIGHT);
  const ui = tape();
  const calls = [];
  const { Accounts } = await load("kanso-settings/accounts.js", ["Accounts"], accountHost(ui, async (cmd, args) => { calls.push([cmd, args]); return { code: 1, stdout: "", stderr: "" }; }, {}));
  const { cx } = timedContext([]);
  const looking = new Accounts(cx);
  looking.page(c);
  assert.ok(ui.texts.includes("Looking for this computer's secret store…"));
  assert.equal(ui.texts.some((text) => text.includes("Sign in")), false);
  const rejected = await openAccounts(async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: "", stderr: "" }; }, {});
  fillJira(rejected.page, "not-a-site");
  rejected.page.signInJira(rejected.cx);
  rejected.page.page(c);
  assert.ok(rejected.ui.texts.includes("Enter your Jira Cloud site, such as your-site.atlassian.net"));
  assert.equal(calls.some((call) => call[0] === "hc" || String(call[1]?.[0]).includes("add-generic-password")), false);
});

test("Sign in waits for the hidden prompt, stores the account id, and a missing or refused token does not sign in", async () => {
  const opened = [];
  const gate = { gone: false, myself: { displayName: "Ada", accountId: "acc-1" }, status: 200 };
  const calls = [];
  const exec = async (cmd, args = []) => {
    calls.push([cmd, args]);
    if (cmd === "sh" && String(args.at(-1)).includes("/myself")) return gate.status === 200 ? http(JSON.stringify(gate.myself), 200) : http("", gate.status);
    if (cmd === "sh" && String(args.at(-1)).includes("api.linear.app")) return http(JSON.stringify({ data: { viewer: { id: "lin-1", name: "Ada", email: "ada@acme.net" } } }));
    if (cmd === "security" && args[0] === "delete-generic-password") return { code: 0, stdout: "", stderr: "" };
    return { code: gate.status === 0 ? 3 : 0, stdout: "", stderr: "" };
  };
  const store = {};
  const { page, cx, drain, timers } = await openAccounts(exec, store, {
    hc: async () => ({ code: 0, stdout: '{"address":"t9"}', stderr: "" }),
    terminals: () => (gate.gone ? [] : [{ address: "t9" }]),
    openOverlay: (overlay) => opened.push(overlay),
  });
  fillJira(page, "https://" + SITE + "/jira");
  page.signInJira(cx);
  await drain();
  assert.equal(opened[0].layout.children[0].content.terminal, "t9");
  await finishPrompt({ page, cx, drain, timers, gate });
  same(store[ACCOUNTS].jira, { site: SITE, email: "ada@acme.net", name: "Ada", accountId: "acc-1" });
  gate.gone = false;
  page.signInLinear(cx);
  await finishPrompt({ page, cx, drain, timers, gate });
  assert.equal(store[ACCOUNTS].linear.id, "lin-1");
  const { tokens } = await load("kanso-settings/ui.js", ["tokens"]);
  const missed = {};
  const missingGate = { gone: false };
  const missing = await openAccounts(async (cmd, args = []) => {
    if (cmd === "sh") return { code: 3, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }, missed, {
    hc: async () => ({ code: 0, stdout: '{"address":"t9"}', stderr: "" }),
    terminals: () => (missingGate.gone ? [] : [{ address: "t9" }]),
    openOverlay() {},
  });
  fillJira(missing.page, SITE);
  missing.page.signInJira(missing.cx);
  await finishPrompt({ ...missing, gate: missingGate });
  missing.page.page(tokens(KIT_NIGHT));
  assert.ok(missing.ui.texts.includes("No token was saved"));
  assert.equal(missed[ACCOUNTS], undefined);
  const refused = {};
  const removed = [];
  const deniedGate = { gone: false };
  const denied = await openAccounts(async (cmd, args = []) => {
    removed.push([cmd, args]);
    if (cmd === "sh" && String(args.at(-1)).includes("/myself")) return http("", 401);
    return { code: 0, stdout: "", stderr: "" };
  }, refused, {
    hc: async () => ({ code: 0, stdout: '{"address":"t9"}', stderr: "" }),
    terminals: () => (deniedGate.gone ? [] : [{ address: "t9" }]),
    openOverlay() {},
  });
  fillJira(denied.page, SITE);
  denied.page.signInJira(denied.cx);
  await finishPrompt({ ...denied, gate: deniedGate });
  denied.page.page(tokens(KIT_NIGHT));
  assert.ok(denied.ui.texts.includes("Jira did not accept your credentials"));
  assert.ok(removed.some((call) => call[1]?.[0] === "delete-generic-password"));
});

test("Sign out keeps the account when the secret remains, and clears it once the secret is gone", async () => {
  const gate = { present: true };
  const store = { [ACCOUNTS]: { jira: { site: SITE, email: "ada@acme.net", name: "Ada", accountId: "acc-1" } } };
  const { page, cx, drain } = await openAccounts(async (cmd, args = []) => {
    if (cmd === "security" && args[0] === "delete-generic-password") return { code: 1, stdout: "", stderr: "" };
    if (cmd === "security" && args[0] === "find-generic-password") return { code: gate.present ? 0 : 1, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }, store);
  const { tokens } = await load("kanso-settings/ui.js", ["tokens"]);
  page.signOut("jira", cx);
  await drain();
  page.page(tokens(KIT_NIGHT));
  assert.equal(store[ACCOUNTS].jira.accountId, "acc-1");
  assert.ok(page.errors.jira.includes("The secret store kept the token"));
  gate.present = false;
  page.signOut("jira", cx);
  await drain();
  assert.equal(store[ACCOUNTS].jira, undefined);
});

test("A Jira source on another site is not read, and opening it asks for no detail", async () => {
  const source = "jira:" + OTHER + "/ABC";
  const row = { project: "shop", source, url: "https://" + OTHER + "/browse/ABC-1", ticket: "ABC-1", title: "Old", status: "To Do", assignees: "[]", author: "acc-old", labels: "[]" };
  const { drawn, urls, runs, view } = await mountIssues(signedIn(),
    { rows: [row], links: [{ project: "shop", source: "jira", ref: OTHER + "/ABC", name: "ABC · Alpha" }] },
  );
  const { cx, drain } = timedContext([]);
  view.readBoard(shop, source, cx);
  await drain();
  view.render(cx);
  assert.equal(urls.length, 0);
  assert.ok(drawn.texts.some((text) => text.includes("Signed in to another Jira site")));
  view.show(row, cx);
  await drain();
  assert.equal(urls.length, 0);
  assert.equal(runs.some((sql) => sql.includes("UPDATE")), false);
});

test("Without a secret store the panel names that and offers no reconnect, and a forced reconnect reads past a future retry", async () => {
  const source = "jira:" + SITE + "/ABC";
  const store = signedIn();
  const none = await mountIssues(store, { store: false, links: [{ project: "shop", source: "jira", ref: SITE + "/ABC", name: "ABC · Alpha" }] });
  const { cx, drain } = timedContext([]);
  none.view.readBoard(shop, source, cx);
  await drain();
  none.view.render(cx);
  assert.ok(none.drawn.texts.includes("This computer has no secret store, so Jira and Linear can't sign in here. GitHub keeps working."));
  assert.equal(none.drawn.texts.includes("Reconnect"), false);
  assert.equal(none.drawn.texts.some((text) => text.includes("Link Jira")), false);
  assert.equal(none.urls.length, 0);
  const failures = [
    { kind: "signed out", text: "Sign in to Jira in Settings to see these tickets" },
    { kind: "offline", text: "Jira can't be reached" },
    { kind: "rate", text: "Jira is limiting requests" },
  ];
  const shown = await mountIssues(store, { links: [{ project: "shop", source: "jira", ref: SITE + "/ABC", name: "ABC · Alpha" }] });
  for (const failure of failures) {
    shown.view.places = { ["shop\u0000" + source]: failure };
    redraw(shown.drawn, shown.view, cx);
    assert.ok(shown.drawn.texts.includes("Reconnect"), failure.kind);
  }
  const { DIALOG } = await load("kanso-settings/ui.js", ["DIALOG"]);
  shown.view.places = { ["shop\u0000" + source]: failures[0] };
  redraw(shown.drawn, shown.view, cx);
  shown.drawn.handlers.get("issues-state-shop-" + source + "-fix")(null, cx);
  const opened = shown.overlays.at(-1);
  assert.equal(opened.mod, "kanso-settings");
  assert.equal(opened.width, DIALOG.settingsW);
  assert.equal(opened.height, DIALOG.settingsH);
  const later = Date.now() + 60_000;
  const waiting = await mountIssues(store, {
    links: [{ project: "shop", source: "jira", ref: SITE + "/ABC", name: "ABC · Alpha" }],
    boards: [{ project: "shop", source, filter: "all", retry_at: later, read_at: 1, columns: "[]", failure: JSON.stringify({ kind: "rate", text: "Jira is limiting requests", retryAt: later }) }],
  });
  waiting.view.refresh(cx);
  await drain();
  assert.equal(waiting.urls.length, 0);
  waiting.view.render(cx);
  waiting.drawn.handlers.get("issues-state-shop-" + source + "-fix")(null, cx);
  await drain();
  assert.ok(waiting.urls.some((url) => url.includes(SITE)));
});

test("Windows falls back from pwsh to powershell, and the request refuses redirects", async () => {
  const calls = [];
  const { secretsApi } = await loadSecrets();
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "pwsh") { const error = new Error("spawn pwsh ENOENT"); error.code = "ENOENT"; throw error; }
    return { code: 0, stdout: "\n200", stderr: "" };
  };
  const api = secretsApi("windows", exec);
  await api.has("kanso-jira", SITE);
  await api.request({ service: "kanso-jira", account: SITE, method: "GET", url: "https://" + SITE + "/rest/api/3/myself" });
  const commands = calls.map((call) => call[0]);
  assert.ok(commands.includes("pwsh"));
  assert.ok(commands.includes("powershell"));
  const script = calls.filter((call) => call[0] === "powershell").map((call) => call[1].at(-1)).join("\n");
  assert.match(script, /-MaximumRedirection 0/);
});
