import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { load, context, exec as realExec, temporary } from "./helpers.mjs";

const AUTH = "github.com\n  Logged in to github.com account jj (keyring)\n  - Active account: true\n  - Token: gho_secret\n";
const plain = (value) => JSON.parse(JSON.stringify(value));

test("remotes parse as SSH or HTTPS, and a token in the URL is not kept", async () => {
  const { parseRemote, publicUrl, parseRemotes, parseAuth } = await load("kanso-panel/pr-remote.js", ["parseRemote", "publicUrl", "parseRemotes", "parseAuth"], {});
  assert.deepEqual(plain(parseRemote("git@github.com:amtelser/eres-admin-app.git")), { host: "github.com", owner: "amtelser", name: "eres-admin-app" });
  assert.deepEqual(plain(parseRemote("ssh://git@github.com:22/o/r.git")), { host: "github.com", owner: "o", name: "r" });
  assert.deepEqual(plain(parseRemote("https://github.com/o/r.git")), { host: "github.com", owner: "o", name: "r" });
  assert.deepEqual(plain(parseRemote("https://gitlab.com/group/sub/repo.git")), { host: "gitlab.com", owner: "group/sub", name: "repo" });
  assert.equal(parseRemote("https://github.com/only"), null);
  assert.equal(parseRemote(""), null);
  assert.deepEqual(plain(parseRemotes("origin\tgit@github.com:o/r.git (fetch)\norigin\tgit@github.com:o/r.git (push)\n")), ["git@github.com:o/r.git"]);
  assert.equal(publicUrl("https://gho_secret@github.com/o/r.git").includes("gho_secret"), false);
  assert.equal(publicUrl("https://user:gho_secret@github.com/o/r.git").includes("gho_secret"), false);
  const hosts = parseAuth(AUTH);
  assert.deepEqual(plain(hosts), [{ host: "github.com", login: "jj", active: true }]);
  assert.equal(JSON.stringify(hosts).includes("gho_secret"), false);
});

test("GitHub matches only a host gh is signed into, and the inbox keeps reviews, yours, and neither a team request", async () => {
  const { github, combineInbox, inbox, searchArgs, listArgs } = await load(
    "kanso-panel/pr-github.js",
    ["github", "combineInbox", "inbox", "searchArgs", "listArgs"],
    {},
  );
  assert.equal(github.id, "github");
  assert.deepEqual(plain(github.capabilities), { read: false, diff: false, threads: false, comment: false, review: false });
  assert.equal(github.match("git@gitlab.com:group/sub/repo.git", ["github.com"]), null);
  assert.deepEqual(plain(github.match("git@github.com:o/r.git", ["github.com"])), { host: "github.com", owner: "o", name: "r" });
  assert.equal(github.match("https://github.com/o/r.git", ["ghe.example.com"]), null);
  assert.deepEqual(plain(github.match("git@ghe.example.com:o/r.git", ["ghe.example.com"])), { host: "ghe.example.com", owner: "o", name: "r" });
  assert.deepEqual(plain(searchArgs("reviews").slice(0, 3)), ["search", "prs", "--review-requested=@me"]);
  assert.equal(searchArgs("authored").includes("--author=@me"), true);
  assert.equal(listArgs({ host: "github.com", owner: "acme", name: "app" })[3], "acme/app");
  assert.equal(listArgs({ host: "ghe.example.com", owner: "acme", name: "app" })[3], "ghe.example.com/acme/app");

  const both = combineInbox({
    reviews: [{ number: 1, title: "Mine too", url: "https://github.com/acme/app/pull/1", author: { login: "jj" }, repository: { nameWithOwner: "acme/app" }, updatedAt: "2026-11-02T00:00:00Z", isDraft: false }],
    authored: [{ number: 1, title: "Mine too", url: "https://github.com/acme/app/pull/1", author: { login: "jj" }, repository: { nameWithOwner: "acme/app" }, updatedAt: "2026-11-02T00:00:00Z" }],
    login: "jj",
  });
  assert.equal(both.length, 1);
  assert.equal(both[0].role, "both");
  assert.equal(both.filter((item) => item.role === "author").length, 0, "a review you also opened stays under Needs you");

  const team = combineInbox({
    listed: [{ number: 2, title: "Team", url: "https://github.com/acme/app/pull/2", author: { login: "other" }, reviewRequests: [{ name: "eng", slug: "eng" }], owner: "acme", name: "app", host: "github.com" }],
    login: "jj",
  });
  assert.equal(team.length, 0);

  const fromList = combineInbox({
    listed: [{ number: 9, title: "Behind search", url: "https://github.com/amtelser/eres-admin-app/pull/9", author: { login: "ada" }, reviewRequests: [{ __typename: "User", login: "jj" }], additions: 12, deletions: 3, owner: "amtelser", name: "eres-admin-app", host: "github.com", updatedAt: "2026-11-09T00:00:00Z" }],
    login: "jj",
  });
  assert.equal(fromList[0].role, "reviewer");
  assert.equal(fromList[0].additions, 12);

  let inflight = 0, max = 0, listed = 0;
  const now = 1_700_000_000_000;
  const run = async (_command, args) => {
    inflight += 1; max = Math.max(max, inflight);
    inflight -= 1;
    if (args[0] === "search" && args.includes("--review-requested=@me")) return { code: 0, stdout: "[]", stderr: "" };
    if (args[0] === "search") return { code: 0, stdout: "[]", stderr: "" };
    listed += 1;
    if (args.includes("acme/repo-a")) return { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible" };
    return { code: 0, stdout: JSON.stringify([{ number: 2, title: "Mine", url: "https://github.com/acme/repo-b/pull/2", author: { login: "jj" }, updatedAt: "2026-11-01T00:00:00Z", additions: 1, deletions: 0 }]), stderr: "" };
  };
  const got = await inbox(run, { repos: [{ host: "github.com", owner: "acme", name: "repo-a" }, { host: "github.com", owner: "acme", name: "repo-b" }], login: "jj", now });
  assert.equal(max, 1, "one request at a time");
  assert.equal(listed, 2, "a permission error does not stop the next repository");
  assert.equal(got.complete, false);
  assert.equal(got.items[0].title, "Mine");

  let steps = 0;
  const limited = await inbox(async (_command, args) => {
    steps += 1;
    assert.equal(args.includes("--author=@me"), false, "a rate limit stops before the second search");
    return { code: 1, stdout: "", stderr: "HTTP 429\nX-RateLimit-Reset: 1700000000" };
  }, { repos: [{ host: "github.com", owner: "acme", name: "app" }], login: "jj", now });
  assert.equal(steps, 1);
  assert.equal(limited.rate.retryAt, 1_700_000_000_000);
  assert.equal(limited.complete, false);
});

test("a fresh inbox is not fetched, and a hidden panel does not touch the network", async (t) => {
  const { fetchDue, FRESH_MS } = await load("kanso-panel/pr-remote.js", ["fetchDue", "FRESH_MS"], {});
  const now = 5_000_000;
  assert.equal(fetchDue({ fetched_at: now - 1000 }, now), false);
  assert.equal(fetchDue({ fetched_at: now - FRESH_MS }, now), true);
  assert.equal(fetchDue({ fetched_at: now }, now, { force: true }), true);
  assert.equal(fetchDue(null, now, { shown: false }), false);
  assert.equal(fetchDue({ fetched_at: 0 }, now, { force: true, shown: false }), false);
  assert.equal(fetchDue({ fetched_at: 0, retry_at: now + 1000 }, now, { force: true }), false);

  const dir = await temporary(t);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: realExec, appHome: () => dir });
  const db = new Kdb();
  await db.open();
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/o/r/pull/1','github','github.com','o','r',1,'Cached','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1);");
  const { refreshInbox } = await load("kanso-panel/pr-inbox.js", ["refreshInbox"], { exec: realExec, appHome: () => dir });
  const session = { status: "ok", login: "jj", hosts: [{ host: "github.com", login: "jj", active: true }] };
  const provider = { id: "github", inbox() { throw new Error("network"); } };
  const model = await refreshInbox({ db, run: () => { throw new Error("network"); }, provider, session, shown: false, now });
  assert.equal(model.needs[0].title, "Cached");
});

function recorder() {
  const texts = [];
  const ids = [];
  const node = () => {
    const api = new Proxy({}, {
      get(_target, prop) {
        if (prop === "child") return (child) => {
          if (typeof child === "string" || typeof child === "number") texts.push(String(child));
          return api;
        };
        if (prop === "children") return (list) => {
          for (const child of list ?? []) if (typeof child === "string") texts.push(child);
          return api;
        };
        if (prop === "when") return (cond, fn) => (cond ? fn(api) : api);
        return () => api;
      },
    });
    return api;
  };
  return {
    texts, ids, div: node, svg: node, v_flex: node, h_flex: node,
    Button: { new: (id) => { ids.push(id); return node(); } },
    Popover: { new: () => node() },
    Input: { new: () => node() },
    InputState: { new: () => ({}) },
    TextView: { markdown: () => node() },
  };
}

const tone = new Proxy({}, { get: () => "#888" });

async function database(t) {
  const dir = await temporary(t);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: realExec, appHome: () => dir });
  const db = new Kdb();
  await db.open();
  return { dir, db, file: join(dir, "data/kanso/kanso.db") };
}

async function panelFor(t, { gh, git, dir }) {
  const ui = recorder();
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push([command, ...(args ?? [])].join(" "));
    if (command === "sqlite3" || command === "mkdir") return realExec(command, args, options);
    if (command === "git") return git(args, options);
    if (command === "gh") return gh(args);
    return { code: 1, stdout: "", stderr: "" };
  };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], { ...ui, exec, appHome: () => dir, key: () => "repo", location: () => ({ cwd: "/work/herdr-kanso", on: null }) });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  return { panel, calls, ui };
}

const focused = { number: 4, title: "Focused", url: "https://github.com/jlopezlira/herdr-kanso/pull/4", state: "OPEN", author: { login: "jj" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-01T00:00:00Z", files: [], additions: 1, deletions: 1, changedFiles: 1, body: "Short." };

function gitAt(remotes) {
  return (args) => {
    if (args[0] === "-C" && args[2] === "remote") {
      const slug = remotes[args[1]];
      return { code: slug ? 0 : 1, stdout: slug ? `origin\tgit@github.com:${slug}.git (fetch)\n` : "", stderr: slug ? "" : "no" };
    }
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: "/work/herdr-kanso\n", stderr: "" };
    if (args[0] === "branch") return { code: 0, stdout: "feat\n", stderr: "" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:jlopezlira/herdr-kanso.git\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
}

test("a signed-out GitHub is absent: no inbox, no line, no link", async (t) => {
  const { dir } = await database(t);
  const gh = async (args) => args[0] === "auth"
    ? { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" }
    : args[1] === "view"
      ? { code: 0, stdout: JSON.stringify(focused), stderr: "" }
      : args[1] === "list"
        ? { code: 0, stdout: "[]", stderr: "" }
        : { code: 0, stdout: "jj\n", stderr: "" };
  const { panel, calls, ui } = await panelFor(t, { dir, gh, git: gitAt({}) });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  panel.header(tone, false);
  panel.body(tone, true);
  assert.equal(panel.inboxOn, false);
  assert.equal(panel.pr.number, 4, "the focused page stays");
  assert.equal(calls.some((call) => call.includes("search")), false);
  assert.equal(ui.ids.some((id) => /inbox|reviews|login/.test(id)), false);
  assert.equal(ui.texts.some((text) => /not logged|not installed|Needs you|glab/.test(text)), false);
});

test("gh missing is absent too", async (t) => {
  const { dir } = await database(t);
  const gh = async (args) => {
    if (args[0] === "auth") { const error = new Error("spawn gh ENOENT"); error.code = "ENOENT"; throw error; }
    return { code: 1, stdout: "", stderr: "" };
  };
  const { panel, ui } = await panelFor(t, { dir, gh, git: () => ({ code: 128, stdout: "", stderr: "not a git repository" }) });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  panel.body(tone, true);
  assert.equal(panel.outside, true);
  assert.equal(panel.inboxOn, false);
  assert.equal(ui.ids.some((id) => /inbox|login/.test(id)), false);
  assert.equal(ui.texts.some((text) => /not installed|Needs you/.test(text)), false);
});

test("Needs you groups another project apart from the focused one, and skips the network while fresh", async (t) => {
  const { dir, db, file } = await database(t);
  const eres = await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  const kanso = await db.addProject({ name: "herdr-kanso", folder: "/work/herdr-kanso" });
  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,additions,deletions,updated_at,fetched_at) VALUES
    ('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Review me','OPEN',0,'ada','reviewer',12,3,'2026-11-09T00:00:00Z',1),
    ('https://github.com/jlopezlira/herdr-kanso/pull/7','github','github.com','jlopezlira','herdr-kanso',7,'My work','OPEN',0,'jj','author',4,1,'2026-11-08T00:00:00Z',1);`);
  await db.run(`INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES('inbox:github:github.com',${Date.now()},NULL,NULL);`);
  const { panel, calls, ui } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app", "/work/herdr-kanso": "jlopezlira/herdr-kanso" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search" || (args[1] === "list" && args.includes("-R"))) return { code: 1, stdout: "", stderr: "should not be called" };
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      if (args[0] === "api") return { code: 0, stdout: "jj\n", stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(calls.some((call) => call.startsWith("gh search") || call.includes(" -R ")), false, "fresh cache skips the network");
  assert.equal(panel.inboxOpen, true);
  assert.equal(panel.inboxTab, "needs");
  const { groupInbox } = await load("kanso-panel/pr-inbox.js", ["groupInbox"], {});
  const needs = groupInbox(panel.inbox.needs, panel.inbox);
  assert.deepEqual(plain(needs.map((group) => group.title)), ["eres-admin-app"]);
  assert.equal(needs[0].rows[0].title, "Review me");
  assert.notEqual(eres.row.folder, kanso.row.folder);
  panel.inboxPage(tone);
  assert.ok(ui.texts.includes("Needs you"));
  assert.ok(ui.texts.includes("Yours"));
  assert.ok(ui.texts.includes("eres-admin-app"));
  assert.equal(ui.texts.includes("herdr-kanso"), false, "the focused repository is not this group");
  assert.ok(ui.texts.some((text) => text.includes(" · new")));
  assert.ok(ui.texts.some((text) => text.includes("+12")));
  const stored = await realExec("sqlite3", ["-json", file, "SELECT detail FROM pr_providers;"]);
  assert.equal(stored.stdout.includes("gho_secret"), false);
  assert.equal(stored.stdout.includes("signed in"), true);

  panel.inboxTab = "yours";
  const yours = groupInbox(panel.inbox.yours, panel.inbox);
  assert.deepEqual(plain(yours.map((group) => group.title)), ["herdr-kanso"]);
});

test("a review search missed still shows from the project list, at most 20 repositories", async (t) => {
  const { dir, db } = await database(t);
  const folders = {};
  for (let n = 1; n <= 21; n++) {
    const name = `repo-${String(n).padStart(2, "0")}`;
    const folder = `/work/${name}`;
    await db.addProject({ name, folder });
    folders[folder] = `acme/${name}`;
  }
  const listed = [];
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt(folders),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search") return { code: 0, stdout: "[]", stderr: "" };
      if (args[1] === "list" && args.includes("-R")) {
        listed.push(args[args.indexOf("-R") + 1]);
        if (args.includes("acme/repo-09")) return { code: 0, stdout: JSON.stringify([{ number: 9, title: "From the repo", url: "https://github.com/acme/repo-09/pull/9", author: { login: "ada" }, reviewRequests: [{ login: "jj" }], additions: 2, deletions: 1, updatedAt: "2026-11-09T00:00:00Z", isDraft: true }]), stderr: "" };
        return { code: 0, stdout: "[]", stderr: "" };
      }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(listed.length, 20);
  assert.equal(listed.includes("acme/repo-21"), false);
  assert.equal(listed.includes("acme/repo-09"), true);
  assert.equal(panel.inbox.needs.some((item) => item.title === "From the repo" && item.draft), true);
  assert.equal(panel.inboxOpen, true);
});

test("a rate limit keeps the cache and is not asked again until it resets", async (t) => {
  const { dir, db, file } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Kept','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  const reset = Math.floor(Date.now() / 1000) + 3600;
  let searches = 0;
  const { panel, ui } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search") { searches += 1; return { code: 1, stdout: "", stderr: `HTTP 429\nX-RateLimit-Reset: ${reset}` }; }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(searches, 1);
  assert.equal(panel.inbox.needs[0].title, "Kept");
  assert.equal(panel.inbox.limitedUntil, reset * 1000);
  panel.inboxPage(tone);
  assert.ok(ui.texts.some((text) => text.startsWith("GitHub is limiting requests until ")));
  const row = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT retry_at FROM pr_fetches WHERE key='inbox:github:github.com';"])).stdout);
  assert.equal(row[0].retry_at, reset * 1000);
  panel.inboxForce = true;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(searches, 1, "manual refresh waits out the limit");
});

test("a seen review opens today's pull request; an unseen one opens Needs you", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  const seenAt = Date.now();
  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at,seen_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/3','github','github.com','amtelser','eres-admin-app',3,'Seen','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1,${seenAt});`);
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.inboxOpen, false);
  assert.equal(panel.pr.number, 4);

  await db.run("UPDATE pr_items SET seen_at=NULL, updated_at='2099-01-01T00:00:00Z';");
  panel.context = null;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(panel.inboxOpen, true);
  assert.equal(panel.inboxTab, "needs");
});

test("a failed read does not mark the review seen", async (t) => {
  const { dir, db, file } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Review me','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[1] === "view" && args[2] === "https://github.com/amtelser/eres-admin-app/pull/149") return { code: 1, stdout: "", stderr: "HTTP 500" };
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.inboxOpen, true);
  panel.openInboxItem(panel.inbox.needs[0], cx);
  await drain();
  const row = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT seen_at FROM pr_items;"])).stdout);
  assert.equal(row[0].seen_at, null);
});

test("nothing waiting is a note, and two projects of one name show the parent", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "app", folder: "/work/one/app" });
  await db.addProject({ name: "app", folder: "/work/two/app" });
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  const { panel, ui } = await panelFor(t, {
    dir,
    git: gitAt({}),
    gh: async (args) => args[0] === "auth" ? { code: 0, stdout: AUTH, stderr: "" } : { code: 0, stdout: args[1] === "view" ? JSON.stringify(focused) : "[]", stderr: "" },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.inboxOpen, false);
  panel.inboxOpen = true;
  panel.inboxPage(tone);
  assert.ok(ui.texts.includes("Nothing waiting on you."));
  assert.equal(ui.ids.some((id) => /login|install|http/.test(id)), false);

  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES
    ('https://github.com/acme/one/pull/1','github','github.com','acme','one',1,'First','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1),
    ('https://github.com/acme/two/pull/2','github','github.com','acme','two',2,'Second','OPEN',0,'ada','reviewer','2026-11-08T00:00:00Z',1);`);
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|one','github','github.com','acme','one',id,'/work/one/app','','git@github.com:acme/one.git',1 FROM projects WHERE folder='/work/one/app';");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|two','github','github.com','acme','two',id,'/work/two/app','','git@github.com:acme/two.git',1 FROM projects WHERE folder='/work/two/app';");
  const { groupInbox } = await load("kanso-panel/pr-inbox.js", ["groupInbox"], {});
  const projects = await db.read("SELECT id, name, folder, machine FROM projects;");
  const repos = await db.read("SELECT * FROM pr_repos;");
  const items = [
    { provider: "github", host: "github.com", owner: "acme", name: "one", title: "First", updatedAt: "2026-11-09T00:00:00Z" },
    { provider: "github", host: "github.com", owner: "acme", name: "two", title: "Second", updatedAt: "2026-11-08T00:00:00Z" },
  ];
  assert.deepEqual(plain(groupInbox(items, { repos, projects }).map((group) => group.title)), ["one/app", "two/app"]);
});
