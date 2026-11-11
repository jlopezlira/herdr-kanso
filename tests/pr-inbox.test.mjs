import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { load, context, exec as realExec, temporary } from "./helpers.mjs";

const AUTH = "github.com\n  Logged in to github.com account jj (keyring)\n  - Active account: true\n  - Token: gho_secret\n";
const plain = (value) => JSON.parse(JSON.stringify(value));
const ghArgs = (command, args) => (command === "env" && args?.[1] === "gh" ? args.slice(2) : args);

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
  const run = async (command, args) => {
    assert.equal(command, "env");
    assert.equal(args[0], "GH_HOST=github.com");
    const asked = ghArgs(command, args);
    inflight += 1; max = Math.max(max, inflight);
    inflight -= 1;
    if (asked[0] === "search" && asked.includes("--review-requested=@me")) return { code: 0, stdout: "[]", stderr: "" };
    if (asked[0] === "search") return { code: 0, stdout: "[]", stderr: "" };
    listed += 1;
    if (asked.includes("acme/repo-a")) return { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible" };
    return { code: 0, stdout: JSON.stringify([{ number: 2, title: "Mine", url: "https://github.com/acme/repo-b/pull/2", author: { login: "jj" }, updatedAt: "2026-11-01T00:00:00Z", additions: 1, deletions: 0 }]), stderr: "" };
  };
  const got = await inbox(run, { repos: [{ host: "github.com", owner: "acme", name: "repo-a" }, { host: "github.com", owner: "acme", name: "repo-b" }], login: "jj", now });
  assert.equal(max, 1, "one request at a time");
  assert.equal(listed, 2, "a permission error does not stop the next repository");
  assert.equal(got.complete, false);
  assert.equal(got.items[0].title, "Mine");

  let steps = 0;
  const limited = await inbox(async (command, args) => {
    steps += 1;
    assert.equal(ghArgs(command, args).includes("--author=@me"), false, "a rate limit stops before the second search");
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
    const hosted = command === "env" && args?.[1] === "gh";
    const forwarded = hosted ? args.slice(2) : args;
    calls.push(hosted ? ["gh", ...forwarded, args[0]].join(" ") : [command, ...(args ?? [])].join(" "));
    if (command === "sqlite3" || command === "mkdir") return realExec(command, args, options);
    if (command === "git") return git(args, options);
    if (command === "gh" || hosted) return gh(forwarded, hosted ? args[0] : "");
    return { code: 1, stdout: "", stderr: "" };
  };
  const host = { ...ui, exec, appHome: () => dir, home: () => "/Users/x", key: () => "repo", location: () => ({ cwd: "/work/herdr-kanso", on: null }) };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], host);
  const { Kdb } = await load("kanso-panel/kdb.js", ["Kdb"], host);
  const panel = new PullRequest(new Kdb());
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  return { panel, calls, ui };
}

const focused = { number: 4, title: "Focused", url: "https://github.com/jlopezlira/herdr-kanso/pull/4", state: "OPEN", author: { login: "jj" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-01T00:00:00Z", files: [], additions: 1, deletions: 1, changedFiles: 1, body: "Short." };

function gitAt(remotes) {
  return (args) => {
    if (args[0] === "-C" && args[2] === "remote") {
      const slug = remotes[args[1]];
      if (!slug) return { code: 1, stdout: "", stderr: "no" };
      const remote = slug.includes("@") || slug.includes("://") ? slug : `git@github.com:${slug}.git`;
      return { code: 0, stdout: `origin\t${remote} (fetch)\n`, stderr: "" };
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
  assert.equal(panel.inboxOpen, false, "an unseen review stays on this branch");
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
  assert.equal(panel.inboxOpen, false, "the review stays behind the pill");
});

test("a rate limit keeps the cache and is not asked again until it resets", async (t) => {
  const { dir, db, file } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Kept','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  const reset = Math.floor(Date.now() / 1000) + 3600;
  let searches = 0;
  let views = 0;
  const { panel, ui } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search") { searches += 1; return { code: 1, stdout: "", stderr: `HTTP 429\nX-RateLimit-Reset: ${reset}` }; }
      if (args[1] === "view") { views += 1; return { code: 0, stdout: JSON.stringify(focused), stderr: "" }; }
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(searches, 1);
  assert.equal(panel.inbox.needs[0].title, "Kept");
  assert.equal(panel.inbox.limitedUntil, reset * 1000);
  panel.inboxPage(tone);
  assert.ok(ui.texts.some((text) => /GitHub (is limiting requests|asks to wait) until \d{2}:\d{2}/.test(text)));
  const row = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT retry_at FROM pr_fetches WHERE key='inbox:github:github.com';"])).stdout);
  assert.equal(row[0].retry_at, reset * 1000);
  const seen = views;
  panel.inboxForce = true;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(searches, 1, "manual refresh waits out the limit");
  assert.equal(views, seen, "the panel's own poll waits too");
});

test("a seen review opens today's pull request; an unseen one stays on the branch", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  const seenAt = Date.now();
  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at,seen_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/3','github','github.com','amtelser','eres-admin-app',3,'Seen','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1,${seenAt});`);
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  const { panel, ui } = await panelFor(t, {
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
  assert.equal(panel.inboxOpen, false);
  assert.equal(panel.pr.number, 4, "the branch stays in front");
  assert.equal(panel.reviewCount(), 1);
  ui.texts.length = 0;
  panel.header(tone, false);
  assert.ok(ui.texts.includes("1 to review"));
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
  assert.equal(panel.inboxOpen, false);
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

test("a host that fails to sign in leaves the hosts that did", async () => {
  const { probe } = await load("kanso-panel/pr-github.js", ["probe"], {});
  const text = [
    "github.com",
    "  Logged in to github.com account jj (keyring)",
    "  - Active account: true",
    "  - Token: gho_secret",
    "ghe.example.com",
    "  X Failed to log in to ghe.example.com account ent (keyring)",
  ].join("\n");
  const got = await probe(async () => ({ code: 1, stdout: text, stderr: "" }));
  assert.equal(got.status, "ok");
  assert.equal(got.login, "jj");
  assert.deepEqual(plain(got.hosts), [{ host: "github.com", login: "jj", active: true }]);
  assert.equal(JSON.stringify(got).includes("gho_secret"), false);
});

test("each signed-in host is read as its own account", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "app", folder: "/work/app" });
  await db.addProject({ name: "ent", folder: "/work/ent" });
  const auth = [
    "github.com",
    "  Logged in to github.com account jj (keyring)",
    "  - Active account: true",
    "ghe.example.com",
    "  Logged in to ghe.example.com account ent (keyring)",
    "  - Active account: false",
  ].join("\n");
  const { panel, calls, ui } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/app": "acme/app", "/work/ent": "git@ghe.example.com:acme/ent.git" }),
    gh: async (args, hostEnv = "") => {
      if (args[0] === "auth") return { code: 0, stdout: auth, stderr: "" };
      if (args[1] === "list" && args.includes("ghe.example.com/acme/ent")) {
        return { code: 0, stdout: JSON.stringify([
          { number: 1, title: "For ent", url: "https://ghe.example.com/acme/ent/pull/1", author: { login: "ada" }, reviewRequests: [{ login: "ent" }], updatedAt: "2026-11-09T00:00:00Z" },
          { number: 2, title: "For jj", url: "https://ghe.example.com/acme/ent/pull/2", author: { login: "ada" }, reviewRequests: [{ login: "jj" }], updatedAt: "2026-11-09T00:00:00Z" },
        ]), stderr: "" };
      }
      if (args[0] === "search" && hostEnv === "GH_HOST=github.com" && args.includes("--author=@me")) {
        return { code: 0, stdout: JSON.stringify([{ number: 3, title: "Mine on github", url: "https://github.com/acme/app/pull/3", author: { login: "jj" }, repository: { nameWithOwner: "acme/app" }, updatedAt: "2026-11-08T00:00:00Z" }]), stderr: "" };
      }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(calls.some((call) => call.startsWith("gh search") && call.endsWith("GH_HOST=github.com")), true);
  assert.equal(calls.some((call) => call.startsWith("gh search") && call.endsWith("GH_HOST=ghe.example.com")), true);
  assert.equal(calls.some((call) => call.includes(" -R ghe.example.com/acme/ent ") && call.endsWith("GH_HOST=ghe.example.com")), true);
  assert.equal(panel.inbox.needs.some((item) => item.title === "For ent"), true);
  assert.equal(panel.inbox.needs.some((item) => item.title === "For jj"), false);
  assert.equal(panel.inbox.yours.some((item) => item.title === "Mine on github"), true);
  assert.deepEqual(plain(panel.inbox.logins).toSorted(), ["ent", "jj"]);
  panel.inboxTab = "yours";
  panel.inboxPage(tone);
  assert.ok(ui.texts.some((text) => text.includes(" · you")));
});

test("past 20 repositories, a listed one drops its stale review and an unlisted one keeps it", async (t) => {
  const { dir, db, file } = await database(t);
  const folders = {};
  for (let n = 1; n <= 21; n++) {
    const name = `repo-${String(n).padStart(2, "0")}`;
    const folder = `/work/${name}`;
    await db.addProject({ name, folder });
    folders[folder] = `acme/${name}`;
  }
  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES
    ('https://github.com/acme/repo-01/pull/1','github','github.com','acme','repo-01',1,'Stale one','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1),
    ('https://github.com/acme/repo-21/pull/21','github','github.com','acme','repo-21',21,'Stale last','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1);`);
  let searches = 0;
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt(folders),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search") { searches += 1; return { code: 0, stdout: "[]", stderr: "" }; }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  const left = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT name FROM pr_items ORDER BY name;"])).stdout);
  assert.deepEqual(left.map((row) => row.name), ["repo-21"]);
  assert.equal(panel.inbox.needs.some((item) => item.title === "Stale one"), false);
  assert.equal(panel.inbox.needs.some((item) => item.title === "Stale last"), true);
  const fetch = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT fetched_at FROM pr_fetches WHERE key='inbox:github:github.com';"])).stdout);
  assert.ok(fetch[0].fetched_at);
  assert.equal(searches, 2);
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(searches, 2, "an empty list still counts as fresh");
});

test("cached reviews show while GitHub is still being asked, and a failed ask keeps them", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "eres-admin-app", folder: "/work/eres-admin-app" });
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Cached','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let hit;
  const opened = new Promise((resolve) => { hit = resolve; });
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search" && args.includes("--review-requested=@me")) { hit(); await gate; return { code: 0, stdout: "[]", stderr: "" }; }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx);
  await opened;
  assert.equal(panel.inboxOn, true);
  assert.equal(panel.inbox.needs[0].title, "Cached");
  release();
  await drain();

  await db.run("DELETE FROM pr_fetches;");
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Cached','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  const failed = await panelFor(t, {
    dir,
    git: gitAt({ "/work/eres-admin-app": "amtelser/eres-admin-app" }),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[0] === "search") throw new Error("gh died");
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  failed.panel.refresh(cx); await drain();
  assert.equal(failed.panel.inbox.needs[0].title, "Cached");
  assert.match(failed.panel.note, /gh died/);
});

test("a removed project no longer takes a repository slot", async (t) => {
  const { dir, db, file } = await database(t);
  const folders = {};
  let removed;
  for (let n = 1; n <= 21; n++) {
    const name = `repo-${String(n).padStart(2, "0")}`;
    const folder = `/work/${name}`;
    const added = await db.addProject({ name, folder });
    folders[folder] = `acme/${name}`;
    if (n === 1) removed = added.row.id;
  }
  await db.removeProject(removed);
  await db.run(`INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|repo-01','github','github.com','acme','repo-01',id,'/work/repo-01','','git@github.com:acme/repo-01.git',1 FROM projects WHERE folder='/work/repo-01';`);
  const listed = [];
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt(folders),
    gh: async (args) => {
      if (args[0] === "auth") return { code: 0, stdout: AUTH, stderr: "" };
      if (args[1] === "list" && args.includes("-R")) listed.push(args[args.indexOf("-R") + 1]);
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(listed.includes("acme/repo-01"), false);
  assert.equal(listed.includes("acme/repo-21"), true);
  assert.equal(listed.length, 20);
  const repos = JSON.parse((await realExec("sqlite3", ["-json", file, "SELECT name FROM pr_repos ORDER BY name;"])).stdout);
  assert.equal(repos.some((row) => row.name === "repo-01"), false);
  assert.equal(repos.some((row) => row.name === "repo-21"), true);
  assert.equal(panel.inboxOn, true);
});

test("signing out brings back copy, open, and the repository list", async (t) => {
  const { dir, db } = await database(t);
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/149','github','github.com','amtelser','eres-admin-app',149,'Review me','OPEN',0,'ada','reviewer','2026-11-09T00:00:00Z',1);");
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  let signed = true;
  const { panel, ui } = await panelFor(t, {
    dir,
    git: gitAt({}),
    gh: async (args) => {
      if (args[0] === "auth") return signed
        ? { code: 0, stdout: AUTH, stderr: "" }
        : { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify(focused), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    },
  });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.inboxOpen, false);
  panel.inboxOpen = true;
  ui.ids.length = 0;
  panel.header(tone, false);
  assert.equal(ui.ids.includes("pr-reviews"), true);
  assert.equal(ui.ids.includes("pr-copy"), false);
  assert.equal(ui.ids.includes("pr-web"), false);
  assert.equal(ui.ids.includes("pr-switch"), false);
  signed = false;
  panel.inboxOpen = false;
  ui.ids.length = 0;
  panel.loading = false;
  panel.refresh(cx); await drain();
  panel.header(tone, false);
  assert.equal(panel.inboxOn, true, "signing out waits for the next account check");
  assert.equal(ui.ids.includes("pr-reviews"), true);
  const { AUTH_MS } = await load("kanso-panel/pr-poll.js", ["AUTH_MS"], {});
  panel.auth.at = Date.now() - AUTH_MS - 1;
  ui.ids.length = 0;
  panel.loading = false;
  panel.refresh(cx); await drain();
  panel.header(tone, false);
  assert.equal(panel.inboxOn, false);
  assert.equal(panel.inboxOpen, null);
  assert.equal(ui.ids.includes("pr-reviews"), false);
  assert.equal(ui.ids.includes("pr-copy"), true);
  assert.equal(ui.ids.includes("pr-web"), true);
  assert.equal(ui.ids.includes("pr-switch"), true);
});
