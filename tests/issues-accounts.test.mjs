import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as realExec, failure, load, tape, KIT_NIGHT, timedContext, same, success, temporary } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const SECRET = "SECRET-XYZ";
const SITE = "acme.atlassian.net";
const OTHER = "old.atlassian.net";
const LINEAR = "https://api.linear.app/graphql";
const ACCOUNTS = "kanso.issues.accounts";
const NO_STORE = [
  "This computer has no secret store, so Jira and Linear can't sign in here.",
  "GitHub keeps working.",
].join(" ");
const JIRA_ME = { displayName: "Ada", accountId: "acc-1" };
const LINEAR_ME = { id: "lin-1", name: "Ada", email: "ada@acme.net" };
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
const jiraAccount = () => signedIn()[ACCOUNTS].jira;
const bothAccounts = () => ({ [ACCOUNTS]: { jira: jiraAccount(), linear: LINEAR_ME } });
const jiraRef = (key) => SITE + "/" + key;
const sourceOf = (link) => link.source + ":" + link.ref;
const linkTo = (source, ref, name) => ({ project: "shop", source, ref, name });
const stateId = (source) => "issues-state-shop-" + source;
const click = (drawn, id, cx) => drawn.handlers.get(id)(null, cx);
const drawIssues = (view) => {
  const timed = timedContext([]);
  view.render(timed.cx);
  return timed;
};
const sendDraft = (drawn, overlays, cx) => {
  click(drawn, "issues-send", cx);
  return overlays.at(-1).props.text;
};
const settingsColors = async () => {
  const { tokens } = await load("kanso-settings/ui.js", ["tokens"]);
  return tokens(KIT_NIGHT);
};
const okJson = (body) => ({ status: 200, text: JSON.stringify(body) });
const linearData = (data) => ({ data });
const jiraColumns = (name) => ({ columnConfig: { columns: [{ name, statuses: [{ id: "1" }] }] } });
const linearStates = (...states) => linearData({ team: { states: { nodes: states } } });
const loadSecrets = (host) => load("kanso-panel/platform-secrets.js", ["secretsApi"], host);
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
const beginJira = ({ page, cx }, site = SITE) => {
  fillJira(page, site);
  page.signInJira(cx);
};
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
  const { Issues } = await loadIssues(drawn, store, {
    openOverlay: (overlay) => overlays.push(overlay), exec: async () => failure("Not available"),
    TextView: { markdown: () => drawn.host.div() }, ...spec.host,
  });
  const rows = spec.rows ?? [];
  const boards = spec.boards ?? [];
  const links = spec.links ?? [];
  const view = new Issues(spec.db ?? {
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
    secrets: spec.secrets ?? { request: async (req) => { urls.push(req.url); return spec.answer ? spec.answer(req) : okJson({}); } },
  });
  return { drawn, overlays, urls, runs, view };
};
const promptHost = (gate, launch = () => {}) => ({
  hc: async (args) => {
    gate.gone = false;
    launch(args);
    return success('{"address":"t9"}');
  },
  terminals: () => (gate.gone ? [] : [{ address: "t9" }]),
});
const finishPrompt = async ({ cx, drain, timers }, gate, submit = () => {}) => {
  await drain();
  submit();
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

test("The macOS secret store reports a missing token only for exit 44", async (t) => {
  const { secretsApi } = await loadSecrets();
  const lookup = t.mock.fn(quiet);
  const api = secretsApi("macos", lookup);
  assert.equal(await api.gone("kanso-jira", SITE), false);
  for (const [code, absent] of [[1, false], [44, true]]) {
    lookup.mock.mockImplementation(async () => failure("Keychain lookup failed", code));
    assert.equal(await api.gone("kanso-jira", SITE), absent, String(code));
  }
  same(lookup.mock.calls[0].arguments, ["security", ["find-generic-password", "-s", "kanso-jira", "-a", SITE]]);
});

test("The Linux secret store reports a missing token only for a silent exit 1", { skip: process.platform === "win32" }, async (t) => {
  const { secretsApi } = await loadSecrets();
  const dir = await temporary(t);
  const script = '#!/bin/sh\nprintf "%s" "$LOOKUP_OUT"\nprintf "%s" "$LOOKUP_ERR" >&2\nexit "$LOOKUP_CODE"\n';
  await writeFile(join(dir, "secret-tool"), script, { mode: 0o755 });
  const lookups = [
    { code: 0, output: "present", absent: false },
    { code: 1, absent: true },
    { code: 1, error: "Access denied", absent: false },
    { code: 1, output: "Unexpected output", absent: false },
    { code: 2, absent: false },
  ];
  for (const { code, output = "", error = "", absent } of lookups) {
    const env = { PATH: dir, LOOKUP_CODE: String(code), LOOKUP_OUT: output, LOOKUP_ERR: error };
    const linux = secretsApi("linux", (cmd, args) => realExec("/bin/" + cmd, args, { env }));
    assert.equal(await linux.gone("kanso-jira", SITE), absent, JSON.stringify({ code, output, error }));
  }
});

test("The Windows secret store distinguishes a missing credential from an access error", async (t) => {
  const { secretsApi } = await loadSecrets();
  const credentialRead = t.mock.fn(quiet);
  const windows = secretsApi("windows", credentialRead);
  assert.equal(await windows.gone("kanso-jira", SITE), true);
  const [command, args] = credentialRead.mock.calls[0].arguments;
  assert.equal(command, "pwsh");
  const script = args.at(-1);
  assert.match(script, /if\(\[KansoCred\]::Missing\('kanso-jira:acme\.atlassian\.net'\)\)\{exit 0\}else\{exit 3\}/);
  assert.match(script, /if\(CredReadW\(n,1,0,out p\)\)\{CredFree\(p\);return false;\}return Marshal.GetLastWin32Error\(\)==1168;/);
  credentialRead.mock.mockImplementation(async () => failure("Access denied", 3));
  assert.equal(await windows.gone("kanso-jira", SITE), false);
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

const emptyBoardCases = [
  {
    kind: "jira", ref: jiraRef("ABC"), columns: ["To Do"],
    requestOf: ({ url }) => new URL(url).pathname.split("/").at(-1),
    steps: ["jql", "board", "configuration"],
    payloads: { jql: { issues: [] }, board: { values: [{ id: 4 }] }, configuration: jiraColumns("To Do") },
  },
  {
    kind: "linear", ref: "team-1", columns: ["Todo", "Done"],
    requestOf: ({ body }) => (linearBody(body).query.includes("states") ? "states" : "issues"),
    steps: ["issues", "states"],
    payloads: {
      issues: linearData({ issues: { nodes: [] } }),
      states: linearStates({ name: "Done", position: 2 }, { name: "Todo", position: 0 }),
    },
  },
];

for (const { kind, ref, columns, requestOf, steps, payloads } of emptyBoardCases) {
  test(`An empty assigned ${kind} board still gets its columns, but a failed first page does not ask for them`, async (t) => {
    const { LINKED } = await load("kanso-panel/issues-linked.js", ["LINKED"]);
    const provider = LINKED[kind];
    const spec = { ref, project: shop.id, filter: "assigned" };
    const request = t.mock.fn(async (req) => okJson(payloads[requestOf(req)]));
    const client = provider.client({ request }, jiraAccount());
    const requests = () => request.mock.calls.map(({ arguments: [req] }) => requestOf(req));

    const empty = await provider.readBoard(client, spec);
    same(empty.rows, []);
    same(empty.columns, columns);
    assert.equal(empty.failure, null);
    same(requests(), steps);

    request.mock.resetCalls();
    request.mock.mockImplementation(async () => ({ status: 429, text: "" }));
    const failed = await provider.readBoard(client, spec);
    same(failed.rows, []);
    same(failed.columns, []);
    assert.equal(failed.failure.kind, "rate");
    same(requests(), steps.slice(0, 1));
  });
}

const pickerCases = [
  {
    kind: "jira", things: "projects", lastRef: jiraRef("P1099"),
    pageOf: ({ url }) => Number(new URL(url).searchParams.get("startAt")) / 100,
    items: (n) => ({ key: "P" + n, name: "Project" }),
    payload: (values, next) => ({ values, isLast: !next }),
  },
  {
    kind: "linear", things: "teams", lastRef: "team-1099",
    pageOf: ({ body }) => linearBody(body).index,
    items: (n) => ({ id: "team-" + n, key: "T" + n, name: "Team" }),
    payload: (nodes, next, endCursor) => linearData({ teams: { nodes, pageInfo: { hasNextPage: next, endCursor } } }),
  },
];

for (const { kind, things, lastRef, pageOf, items, payload } of pickerCases) {
  test(`The ${kind} picker loads all 11 pages and warns when it stops at 50`, async (t) => {
    const { LINKED } = await load("kanso-panel/issues-linked.js", ["LINKED"]);
    const answer = (pages) => async (req) => {
      const page = pageOf(req);
      const list = Array.from({ length: 100 }, (_, i) => items(page * 100 + i));
      return okJson(payload(list, page + 1 < pages, String(page + 1)));
    };
    const pageNumbers = (request) => request.mock.calls.map(({ arguments: [req] }) => pageOf(req));
    const sequence = (length) => Array.from({ length }, (_, i) => i);

    const request = t.mock.fn(answer(11));
    const all = await LINKED[kind].client({ request }, jiraAccount()).projects();
    same(pageNumbers(request), sequence(11));
    assert.equal(all.complete, true);
    assert.equal(all.list.length, 1100);
    assert.equal(all.list.at(-1).ref, lastRef);

    const capped = t.mock.fn(answer(51));
    const { drawn, view } = await mountIssues(bothAccounts(), { answer: capped });
    const { cx, drain } = drawIssues(view);
    click(drawn, `issues-link-${kind}-shop`, cx);
    await drain();
    redraw(drawn, view, cx);
    same(pageNumbers(capped), sequence(50));
    assert.equal(view.linking.complete, false);
    assert.ok(drawn.texts.includes(`Showing the first 5000 ${things}`));
  });
}

test("Settings shows it is looking before the secret store answers, and a bad site is rejected before a prompt", async () => {
  const c = await settingsColors();
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

test("Sign in waits for the hidden prompt and stores the Jira and Linear account ids", async (t) => {
  const gate = { gone: true };
  const exec = async (cmd, args) => {
    if (cmd !== "sh") return success("");
    if (args.at(-1) === LINEAR) return http(JSON.stringify(linearData({ viewer: LINEAR_ME })));
    return http(JSON.stringify(JIRA_ME));
  };
  const store = {};
  const openOverlay = t.mock.fn();
  const settings = await openAccounts(exec, store, { ...promptHost(gate), openOverlay });
  beginJira(settings, "https://" + SITE + "/jira");
  await settings.drain();
  const [overlay] = openOverlay.mock.calls[0].arguments;
  assert.equal(overlay.layout.children[0].content.terminal, "t9");
  assert.equal(store[ACCOUNTS], undefined);
  await finishPrompt(settings, gate);
  same(store[ACCOUNTS].jira, jiraAccount());

  settings.page.signInLinear(settings.cx);
  await finishPrompt(settings, gate);
  same(store[ACCOUNTS].linear, LINEAR_ME);
});

const tryJiraPrompt = async (exec, store) => {
  const gate = { gone: true };
  const settings = await openAccounts(exec, store, promptHost(gate));
  beginJira(settings);
  await finishPrompt(settings, gate);
  settings.page.page(await settingsColors());
  return settings.ui;
};

const credentialsCommand = (exec, operation) =>
  exec.mock.calls.findIndex(({ arguments: [cmd, args] }) => cmd === "security" && args[0] === operation);

const assertRemovedThenChecked = (exec) => {
  const removal = credentialsCommand(exec, "delete-generic-password");
  assert.ok(removal >= 0 && credentialsCommand(exec, "find-generic-password") > removal);
};

test("Cancelling the hidden prompt reports that no token was saved without deleting a credential", async (t) => {
  const store = {};
  const exec = t.mock.fn(async (cmd) => (cmd === "sh" ? failure("", 3) : success("")));
  const ui = await tryJiraPrompt(exec, store);
  assert.ok(ui.texts.includes("No token was saved"));
  assert.equal(store[ACCOUNTS], undefined);
  assert.equal(credentialsCommand(exec, "delete-generic-password"), -1);
});

const hadAccessError = () => failure("User interaction is not allowed");
const noCredential = () => failure("The specified item could not be found", 44);

const signInFailures = [
  { status: 401, reason: "Jira did not accept your credentials", lookup: noCredential },
  { status: 0, reason: "Jira can't be reached", lookup: noCredential },
  { status: 429, reason: "Jira is limiting requests", lookup: noCredential },
  { status: 0, reason: "Jira can't be reached", lookup: hadAccessError },
];

for (const { status, reason, lookup } of signInFailures) {
  const result = lookup === noCredential
    ? "The token was not kept"
    : "The secret store kept the token; remove it there or sign in again";
  test(`A failed sign-in says "${reason}. ${result}" and does not store the account`, async (t) => {
    const store = {};
    const exec = t.mock.fn(async (cmd, args) => {
      if (cmd === "sh") return http("", status);
      if (args[0] === "find-generic-password") return lookup();
      return success("");
    });
    const ui = await tryJiraPrompt(exec, store);
    assert.ok(ui.texts.includes(`${reason}. ${result}`));
    assert.equal(store[ACCOUNTS], undefined);
    assertRemovedThenChecked(exec);
  });
}

test("Sign out keeps the account when a failed removal cannot be checked, and clears it once the token is missing", async (t) => {
  const store = signedIn();
  const reply = (lookup) => async (_cmd, [operation]) => {
    if (operation === "delete-generic-password") return failure("Could not delete token");
    if (operation === "find-generic-password") return lookup();
    return success("");
  };
  const exec = t.mock.fn(reply(hadAccessError));
  const { ui, page, cx, drain } = await openAccounts(exec, store);
  page.signOut("jira", cx);
  await drain();
  page.page(await settingsColors());
  same(store[ACCOUNTS].jira, jiraAccount());
  assert.ok(ui.texts.includes("The secret store kept the token, so you are still signed in"));
  assertRemovedThenChecked(exec);

  exec.mock.mockImplementation(reply(noCredential));
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

const alphaLink = linkTo("jira", jiraRef("ABC"), "ABC · Alpha");
const betaLink = linkTo("jira", jiraRef("DEF"), "DEF · Beta");
const teamLink = linkTo("linear", "team-1", "ENG · Eng");

test("Without a secret store the panel shows one page notice until a linked source has its own notice", async () => {
  const { cx, drain } = timedContext([]);
  const unavailable = { store: false };
  const empty = await mountIssues(signedIn(), unavailable);
  empty.view.render(cx);
  const notices = (ui) => ui.texts.filter((text) => text === NO_STORE).length;
  assert.equal(notices(empty.drawn), 1);
  assert.ok(empty.drawn.ids.includes("issues-no-store"));

  const source = sourceOf(alphaLink);
  const linked = await mountIssues(signedIn(), { ...unavailable, links: [alphaLink] });
  linked.view.readBoard(shop, source, cx);
  await drain();
  linked.view.render(cx);
  assert.equal(notices(linked.drawn), 1);
  assert.ok(linked.drawn.ids.includes(stateId(source)));
  assert.equal(linked.drawn.ids.includes("issues-no-store"), false);
  assert.equal(linked.drawn.texts.includes("Reconnect"), false);
  assert.equal(linked.drawn.texts.some((text) => text.includes("Link Jira")), false);
  assert.equal(linked.urls.length, 0);
});

test("Jira sign-in, offline and rate states offer Reconnect, and the sign-in action opens Settings", async () => {
  const source = sourceOf(alphaLink);
  const failures = [
    { kind: "signed out", text: "Sign in to Jira in Settings to see these tickets" },
    { kind: "offline", text: "Jira can't be reached" },
    { kind: "rate", text: "Jira is limiting requests" },
  ];
  const { cx } = timedContext([]);
  const { drawn, overlays, view } = await mountIssues(signedIn(), { links: [alphaLink] });
  const key = shop.id + "\u0000" + source;
  for (const failure of failures) {
    view.places = { [key]: failure };
    redraw(drawn, view, cx);
    assert.ok(drawn.texts.includes("Reconnect"), failure.kind);
  }
  const { DIALOG } = await load("kanso-settings/ui.js", ["DIALOG"]);
  view.places = { [key]: failures[0] };
  redraw(drawn, view, cx);
  click(drawn, stateId(source) + "-fix", cx);
  const opened = overlays.at(-1);
  assert.equal(opened.mod, "kanso-settings");
  assert.equal(opened.props.page, "accounts");
  assert.equal(opened.width, DIALOG.settingsW);
  assert.equal(opened.height, DIALOG.settingsH);
});

test("The header refresh leaves waiting boards alone, but Jira Reconnect reads only its source", async (t) => {
  const now = Date.now();
  const later = now + 60_000;
  const source = sourceOf(alphaLink);
  const board = (source, waiting) => ({
    project: shop.id, source, filter: "all", read_at: now, columns: "[]", retry_at: waiting ? later : null,
    failure: waiting ? JSON.stringify({ kind: "rate", text: "Requests are limited", retryAt: later }) : null,
  });
  const exec = t.mock.fn(async () => failure("GitHub read"));
  const answer = ({ url }) => okJson(url.endsWith("/jql") ? { issues: [] } : { values: [] });
  const { drawn, urls, runs, view } = await mountIssues(signedIn(), {
    links: [alphaLink, betaLink],
    boards: [board("github", true), board(source, true), board(sourceOf(betaLink), false)],
    host: { exec }, answer,
  });
  const { cx, drain } = drawIssues(view);
  click(drawn, "issues-refresh", cx);
  await drain();
  const onlyBoard = (requests, key) => same(requests.map((url) => new URL(url).searchParams.get("projectKeyOrId")).filter(Boolean), [key]);
  onlyBoard(urls, "DEF");
  assert.equal(exec.mock.callCount(), 0);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].includes(sourceOf(betaLink)));

  const before = urls.length;
  click(drawn, stateId(source) + "-fix", cx);
  await drain();
  onlyBoard(urls.slice(before), "ABC");
  assert.equal(exec.mock.callCount(), 0);
  assert.equal(runs.length, 2);
  assert.ok(runs[1].includes(source));
});

const markedIssue = (link, ticket, title, status) => ({
  project: shop.id, source: sourceOf(link), ticket, title, status, assignees: "[]", labels: "[]",
  url: link.source === "jira" ? "https://" + SITE + "/browse/" + ticket : "https://linear.app/acme/issue/" + ticket,
});
const assertNoSecret = (value, place) => assert.equal(JSON.stringify(value).includes(SECRET), false, place);

test("One project shows two Jira boards and one Linear board by source, and the Jira detail can open or send the issue", async () => {
  const links = [alphaLink, betaLink, teamLink];
  const rows = [
    markedIssue(alphaLink, "ABC-1", "Alpha ship", "To Do"),
    markedIssue(betaLink, "DEF-2", "Beta ship", "In Progress"),
    markedIssue(teamLink, "ENG-3", "Linear ship", "Todo"),
  ];
  const columns = [["To Do", "In Progress"], ["In Progress", "Done"], ["Todo", "Doing", "Done"]];
  const boards = links.map((link, i) => ({
    project: shop.id, source: sourceOf(link), filter: "all", columns: JSON.stringify(columns[i]),
    read_at: 1, failure: null,
  }));
  const { drawn, overlays, view } = await mountIssues(bothAccounts(), { links, rows, boards });
  const { cx, drain } = drawIssues(view);
  const headings = ["Jira · ABC · Alpha", "Jira · DEF · Beta", "Linear · ENG · Eng"];
  const boardText = headings.flatMap((heading, i) => [
    heading, ...columns[i].flatMap((column) => [column, ...(column === rows[i].status ? [rows[i].title] : [])]),
  ]);
  same(drawn.texts.filter((word) => boardText.includes(word)), boardText);
  assert.ok(drawn.texts.includes("Link Jira projects…"));
  assert.ok(drawn.texts.includes("Link Linear teams…"));

  const first = rows[0];
  click(drawn, "issue-" + first.url, cx);
  await drain();
  redraw(drawn, view, cx);
  assert.ok(drawn.texts.includes("Open in Jira"));
  const draft = sendDraft(drawn, overlays, cx);
  assert.equal(draft, first.ticket + " " + first.title + "\n\n" + first.url);
  assertNoSecret(draft, "Jira detail draft");
});

const jiraFixture = (url) => {
  if (url.endsWith("/myself")) return JIRA_ME;
  if (url.endsWith("/jql")) return { issues: [jiraIssue(1)] };
  if (url.includes("/board?")) return { values: [{ id: 4 }] };
  if (url.endsWith("/configuration")) return jiraColumns("To Do");
  return { fields: { description: { type: "text", text: "Plain Jira body" } } };
};

const linearFixture = (body) => {
  const { query } = linearBody(body);
  if (query.includes("viewer")) return linearData({ viewer: LINEAR_ME });
  if (query.includes("states")) return linearStates({ name: "Todo", position: 0 });
  if (query.includes("issues(")) return linearData({ issues: { nodes: [linearNode(1)] } });
  return linearData({ issue: { description: "Plain Linear body" } });
};

test("Signing in and reading Jira and Linear boards keeps the token out of SQLite, logs, shared state, drafts and requests", async (t) => {
  const capture = t.mock.fn();
  const logHost = { console: Object.fromEntries(["log", "info", "warn", "error", "debug"].map((name) => [name, capture])) };
  const vault = new Map();
  const exec = t.mock.fn(async (cmd, args) => {
    if (cmd === "security" && args[0] === "list-keychains") return success("");
    if (cmd !== "sh") return failure("Unexpected command");
    const [service, account, , , body, url] = args.slice(3);
    if (vault.get(service + ":" + account) !== SECRET) return failure("", 3);
    return http(JSON.stringify(url === LINEAR ? linearFixture(body) : jiraFixture(url)));
  });
  const store = {};
  const gate = { gone: true };
  const prompt = t.mock.fn();
  const settings = await openAccounts(exec, store, { ...logHost, ...promptHost(gate, prompt) });
  const submit = (service, account) => () => {
    const [argv] = prompt.mock.calls.at(-1).arguments;
    same(argv.slice(-3, -1), [service, account]);
    vault.set(service + ":" + account, SECRET);
  };
  beginJira(settings);
  await finishPrompt(settings, gate, submit("kanso-jira", SITE));
  settings.page.signInLinear(settings.cx);
  await finishPrompt(settings, gate, submit("kanso-linear", "api.linear.app"));
  same(store, bothAccounts());

  const { db } = await temporaryKdb(t);
  const { linkSql } = await load("kanso-panel/issues-store.js", ["linkSql"], logHost);
  const links = [alphaLink, teamLink];
  for (const link of links) await db.run(linkSql(link, true));
  const { secretsApi } = await loadSecrets(logHost);
  const { view, drawn, overlays } = await mountIssues(store, { db, secrets: secretsApi("macos", exec), host: logHost });
  const { cx, drain } = timedContext([]);
  await view.reload();
  for (const link of links) {
    view.readBoard(shop, sourceOf(link), cx);
    await drain();
  }

  same(view.rows.map((row) => row.ticket).toSorted(), ["ABC-1", "ENG-1"]);
  same(view.boards.map((board) => board.source).toSorted(), links.map(sourceOf).toSorted());
  for (const row of view.rows) {
    redraw(drawn, view, cx);
    click(drawn, "issue-" + row.url, cx);
    await drain();
    redraw(drawn, view, cx);
    const draft = sendDraft(drawn, overlays, cx);
    assert.ok(draft.includes(row.url));
    assert.ok(draft.includes(row.source.startsWith("jira:") ? "Plain Jira body" : "Plain Linear body"));
    assertNoSecret(draft, row.ticket + " draft");
    click(drawn, "issues-back", cx);
  }

  const tables = await db.read("SELECT name FROM sqlite_master WHERE type='table'");
  assert.ok(tables.some(({ name }) => name === "issues"));
  for (const { name } of tables) {
    const identifier = '"' + name.replaceAll('"', '""') + '"';
    assertNoSecret(await db.read("SELECT * FROM " + identifier), "kanso.db " + name);
  }
  assertNoSecret(capture.mock.calls.map(({ arguments: args }) => args), "Console");
  assertNoSecret(store, "Shared state");
  assertNoSecret(prompt.mock.calls.map(({ arguments: args }) => args), "Prompt command");
  const requests = exec.mock.calls.map(({ arguments: args }) => args).filter(([cmd]) => cmd === "sh");
  assertNoSecret(requests, "Provider commands");
  const urls = requests.map(([, args]) => new URL(args.at(-1)));
  assert.ok(urls.every((url) => url.protocol === "https:"));
  same([...new Set(urls.map((url) => url.host))].toSorted(), [SITE, "api.linear.app"]);
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
