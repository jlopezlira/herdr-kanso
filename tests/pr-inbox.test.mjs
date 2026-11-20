import { temporaryKdb, loadPullRequest, loadPanelKdb, loadGroupInbox, loadAuthTiming } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { databaseTimer, load, context, callContext, exec as realExec, success, failure, clone as plain, refreshedContext } from "./helpers.mjs";
import { blankPanel, refreshAgain, openInbox, drawOpenBoard, SIGNED_IN, SIGNED_OUT } from "./pr-fixtures.mjs";

const AUTH = "github.com\n  Logged in to github.com account jj (keyring)\n  - Active account: true\n  - Token: gho_secret\n";

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
    if (asked[0] === "search" && asked.includes("--review-requested=@me")) return success("[]");
    if (asked[0] === "search") return success("[]");
    listed += 1;
    if (asked.includes("acme/repo-a")) return failure("HTTP 403: Resource not accessible");
    return success(JSON.stringify([{ number: 2, title: "Mine", url: "https://github.com/acme/repo-b/pull/2", author: { login: "jj" }, updatedAt: "2026-11-01T00:00:00Z", additions: 1, deletions: 0 }]));
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
    return failure("HTTP 429\nX-RateLimit-Reset: 1700000000");
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

  const { dir, db } = await database(t);
  await db.run(itemRow("https://github.com/o/r/pull/1", "o", "r", 1, "Cached", "2026-11-01T00:00:00Z"));
  const { refreshInbox } = await load("kanso-panel/pr-inbox.js", ["refreshInbox"], { exec: realExec, appHome: () => dir });
  const session = SIGNED_IN;
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
const ITEM_COLUMNS = "url,provider,host,owner,name,number,title,state,draft,author,role,updated_at,fetched_at";
const ERES = { "/work/eres-admin-app": "amtelser/eres-admin-app" };
const ERES_URL = "https://github.com/amtelser/eres-admin-app/pull/149";

const itemRow = (url, owner, name, number, title, updated) => `INSERT INTO pr_items(${ITEM_COLUMNS}) VALUES('${url}','github','github.com','${owner}','${name}',${number},'${title}','OPEN',0,'ada','reviewer','${updated}',1);`;
const eresItem = (title) => itemRow(ERES_URL, "amtelser", "eres-admin-app", 149, title, "2026-11-09T00:00:00Z");
const markFresh = (db) => db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
const ERES_PROJECT = { name: "eres-admin-app", folder: "/work/eres-admin-app" };
const reviewWaiting = async (db) => {
  await db.run(eresItem("Review me"));
  await markFresh(db);
};
const rows = async (file, sql) => JSON.parse((await realExec("sqlite3", ["-json", file, sql])).stdout);

async function database(t, ...projects) {
  const { dir, db } = await temporaryKdb(t);
  for (const project of projects) await db.addProject(project);
  return { dir, db, file: join(dir, "data/kanso/kanso.db") };
}

const cachedReview = async (t) => {
  const { dir, db } = await database(t, ERES_PROJECT);
  await db.run(eresItem("Cached"));
  return { dir, db };
};

async function panelFor(t, { gh, git, dir, host: more = {}, state }) {
  const ui = recorder(), calls = [];
  const exec = async (command, args, options) => {
    const hosted = command === "env" && args?.[1] === "gh";
    const forwarded = hosted ? args.slice(2) : args;
    calls.push(hosted ? ["gh", ...forwarded, args[0]].join(" ") : [command, ...(args ?? [])].join(" "));
    if (command === "sqlite3" || command === "mkdir") return realExec(command, args, options);
    if (command === "git") return git(args, options);
    if (command === "gh" || hosted) return gh(forwarded, hosted ? args[0] : "");
    return failure("");
  };
  const host = { ...ui, exec, appHome: () => dir, home: () => "/Users/x", key: () => "repo", location: () => ({ cwd: "/work/herdr-kanso", on: null }), ...more };
  const { PullRequest } = await loadPullRequest(host);
  const { Kdb } = await loadPanelKdb(host);
  return { panel: blankPanel(PullRequest, new Kdb(databaseTimer), state), calls, ui };
}

const focused = { number: 4, title: "Focused", url: "https://github.com/jlopezlira/herdr-kanso/pull/4", state: "OPEN", author: { login: "jj" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-01T00:00:00Z", files: [], additions: 1, deletions: 1, changedFiles: 1, body: "Short." };

function gitAt(remotes) {
  return (args) => {
    if (args[0] === "-C" && args[2] === "remote") {
      const slug = remotes[args[1]];
      if (!slug) return failure("no");
      const remote = slug.includes("@") || slug.includes("://") ? slug : `git@github.com:${slug}.git`;
      return success(`origin\t${remote} (fetch)\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return success("/work/herdr-kanso\n");
    if (args[0] === "branch") return success("feat\n");
    if (args[0] === "remote") return success("git@github.com:jlopezlira/herdr-kanso.git\n");
    return failure("");
  };
}

// gh signed in as `auth`: `answer` goes first, then the focused pull request, then an empty list.
const signedIn = (answer = () => undefined, auth = AUTH) => async (args, hostEnv) => {
  if (args[0] === "auth") return success(auth);
  return (await answer(args, hostEnv)) ?? success(args[1] === "view" ? JSON.stringify(focused) : "[]");
};

// A panel on the projects in `remotes`, already refreshed once.
const shownPanel = async (t, dir, remotes, gh) => {
  const shown = await panelFor(t, { dir, git: gitAt(remotes), gh });
  return { ...shown, ...await refreshedContext(shown.panel) };
};

// One past the 20 repositories read: 21 projects, each on its own GitHub repository.
async function manyRepos(db) {
  const added = [];
  for (let n = 1; n <= 21; n++) {
    const name = `repo-${String(n).padStart(2, "0")}`;
    added.push({ folder: `/work/${name}`, slug: `acme/${name}`, project: await db.addProject({ name, folder: `/work/${name}` }) });
  }
  return { folders: Object.fromEntries(added.map(({ folder, slug }) => [folder, slug])), first: added[0].project.row.id };
}

const listedFrom = (listed) => (args) => {
  if (args[1] === "list" && args.includes("-R")) listed.push(args[args.indexOf("-R") + 1]);
};

test("a signed-out GitHub is absent: no inbox, no line, no link", async (t) => {
  const { dir } = await database(t);
  const gh = async (args) => args[0] === "auth"
    ? failure(SIGNED_OUT)
    : args[1] === "view"
      ? success(JSON.stringify(focused))
      : args[1] === "list"
        ? success("[]")
        : success("jj\n");
  const { panel, calls, ui } = await shownPanel(t, dir, {}, gh);
  panel.header(tone, false);
  panel.body(tone, true);
  assert.equal(panel.session.inboxOn, false);
  assert.equal(panel.session.pr.number, 4, "the focused page stays");
  assert.equal(calls.some((call) => call.includes("search")), false);
  assert.equal(ui.ids.some((id) => /inbox|reviews|login/.test(id)), false);
  assert.equal(ui.texts.some((text) => /not logged|not installed|Needs you|glab/.test(text)), false);
});

test("gh missing is absent too", async (t) => {
  const { dir } = await database(t);
  const gh = async (args) => {
    if (args[0] === "auth") { const error = new Error("spawn gh ENOENT"); error.code = "ENOENT"; throw error; }
    return failure("");
  };
  const { panel, ui } = await panelFor(t, { dir, gh, git: () => (failure("not a git repository", 128)) });
  await refreshedContext(panel);
  panel.body(tone, true);
  assert.equal(panel.session.outside, true);
  assert.equal(panel.session.inboxOn, false);
  assert.equal(ui.ids.some((id) => /inbox|login/.test(id)), false);
  assert.equal(ui.texts.some((text) => /not installed|Needs you/.test(text)), false);
});

test("Needs you groups another project apart from the focused one, and skips the network while fresh", async (t) => {
  const { dir, db, file } = await database(t);
  const eres = await db.addProject(ERES_PROJECT);
  const kanso = await db.addProject({ name: "herdr-kanso", folder: "/work/herdr-kanso" });
  await db.run(`INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,draft,author,role,additions,deletions,updated_at,fetched_at) VALUES
    ('${ERES_URL}','github','github.com','amtelser','eres-admin-app',149,'Review me','OPEN',0,'ada','reviewer',12,3,'2026-11-09T00:00:00Z',1),
    ('https://github.com/jlopezlira/herdr-kanso/pull/7','github','github.com','jlopezlira','herdr-kanso',7,'My work','OPEN',0,'jj','author',4,1,'2026-11-08T00:00:00Z',1);`);
  await db.run(`INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES('inbox:github:github.com',${Date.now()},NULL,NULL);`);
  const { panel, calls, ui } = await shownPanel(t, dir, { ...ERES, "/work/herdr-kanso": "jlopezlira/herdr-kanso" }, signedIn((args) => {
    if (args[0] === "search" || (args[1] === "list" && args.includes("-R"))) return failure("should not be called");
    if (args[0] === "api") return success("jj\n");
  }));
  assert.equal(calls.some((call) => call.startsWith("gh search") || call.includes(" -R ")), false, "fresh cache skips the network");
  assert.equal(panel.session.inboxOpen, false, "an unseen review stays on this branch");
  const { groupInbox } = await loadGroupInbox();
  const needs = groupInbox(panel.session.inbox.needs, panel.session.inbox);
  assert.deepEqual(plain(needs.map((group) => group.title)), ["eres-admin-app"]);
  assert.equal(needs[0].rows[0].title, "Review me");
  assert.notEqual(eres.row.folder, kanso.row.folder);
  await drawOpenBoard(panel, tone);
  assert.ok(ui.texts.includes("Needs you"));
  assert.ok(ui.texts.includes("Yours"));
  assert.ok(ui.texts.includes("eres-admin-app"));
  assert.ok(ui.texts.includes("herdr-kanso"), "every repository has its block, the focused one's too");
  assert.ok(ui.texts.some((text) => text.includes(" · new")));
  assert.ok(ui.texts.some((text) => text.includes("+12")));
  const stored = await realExec("sqlite3", ["-json", file, "SELECT detail FROM pr_providers;"]);
  assert.equal(stored.stdout.includes("gho_secret"), false);
  assert.equal(stored.stdout.includes("signed in"), true);

  const yours = groupInbox(panel.session.inbox.yours, panel.session.inbox);
  assert.deepEqual(plain(yours.map((group) => group.title)), ["herdr-kanso"]);
});

test("a review search missed still shows from the project list, at most 20 repositories", async (t) => {
  const { dir, db } = await database(t);
  const { folders } = await manyRepos(db);
  const listed = [];
  const list = listedFrom(listed);
  const { panel } = await shownPanel(t, dir, folders, signedIn((args) => {
    list(args);
    if (args.includes("acme/repo-09")) return success(JSON.stringify([{ number: 9, title: "From the repo", url: "https://github.com/acme/repo-09/pull/9", author: { login: "ada" }, reviewRequests: [{ login: "jj" }], additions: 2, deletions: 1, updatedAt: "2026-11-09T00:00:00Z", isDraft: true }]));
  }));
  assert.equal(listed.length, 20);
  assert.equal(listed.includes("acme/repo-21"), false);
  assert.equal(listed.includes("acme/repo-09"), true);
  assert.equal(panel.session.inbox.needs.some((item) => item.title === "From the repo" && item.draft), true);
  assert.equal(panel.session.inboxOpen, false, "the review stays behind the pill");
});

test("a rate limit keeps the cache and is not asked again until it resets", async (t) => {
  const { dir, db, file } = await database(t, ERES_PROJECT);
  await db.run(eresItem("Kept"));
  const reset = Math.floor(Date.now() / 1000) + 3600;
  let searches = 0;
  let views = 0;
  const { panel, ui, cx, drain } = await shownPanel(t, dir, ERES, signedIn((args) => {
    if (args[0] === "search") { searches += 1; return failure(`HTTP 429\nX-RateLimit-Reset: ${reset}`); }
    if (args[1] === "view") views += 1;
  }));
  assert.equal(searches, 1);
  assert.equal(panel.session.inbox.needs[0].title, "Kept");
  assert.equal(panel.session.inbox.limitedUntil, reset * 1000);
  panel.inboxPage(tone);
  assert.ok(ui.texts.some((text) => /GitHub (is limiting requests|asks to wait) until \d{2}:\d{2}/.test(text)));
  const row = await rows(file, "SELECT retry_at FROM pr_fetches WHERE key='inbox:github:github.com';");
  assert.equal(row[0].retry_at, reset * 1000);
  const seen = views;
  panel.session.inboxForce = true;
  await refreshAgain(panel, cx, drain);
  assert.equal(searches, 1, "manual refresh waits out the limit");
  assert.equal(views, seen, "the panel's own poll waits too");
});

test("a seen review opens today's pull request; an unseen one stays on the branch", async (t) => {
  const { dir, db } = await database(t, ERES_PROJECT);
  const seenAt = Date.now();
  await db.run(`INSERT INTO pr_items(${ITEM_COLUMNS},seen_at) VALUES('https://github.com/amtelser/eres-admin-app/pull/3','github','github.com','amtelser','eres-admin-app',3,'Seen','OPEN',0,'ada','reviewer','2026-11-01T00:00:00Z',1,${seenAt});`);
  await markFresh(db);
  const { panel, ui, cx, drain } = await shownPanel(t, dir, ERES, signedIn());
  assert.equal(panel.session.inboxOpen, false);
  assert.equal(panel.session.pr.number, 4);

  await db.run("UPDATE pr_items SET seen_at=NULL, updated_at='2099-01-01T00:00:00Z';");
  panel.session.context = null;
  await refreshAgain(panel, cx, drain);
  assert.equal(panel.session.inboxOpen, false);
  assert.equal(panel.session.pr.number, 4, "the branch stays in front");
  assert.equal(panel.reviewCount(), 1);
  ui.texts.length = 0;
  panel.header(tone, false);
  assert.ok(ui.texts.includes("1 to review"));
});

test("a failed read does not mark the review seen", async (t) => {
  const { dir, db, file } = await database(t, ERES_PROJECT);
  await reviewWaiting(db);
  const { panel, cx, drain } = await shownPanel(t, dir, ERES, signedIn((args) => {
    if (args[1] === "view" && args[2] === ERES_URL) return failure("HTTP 500");
  }));
  assert.equal(panel.session.inboxOpen, false);
  panel.openInboxItem(panel.session.inbox.needs[0], cx);
  await drain();
  const row = await rows(file, "SELECT seen_at FROM pr_items;");
  assert.equal(row[0].seen_at, null);
});

test("nothing waiting is a note, and two projects of one name show the parent", async (t) => {
  const { dir, db } = await database(t);
  await db.addProject({ name: "app", folder: "/work/one/app" });
  await db.addProject({ name: "app", folder: "/work/two/app" });
  await markFresh(db);
  const { panel, ui } = await shownPanel(t, dir, {}, signedIn());
  openInbox(panel);
  panel.inboxPage(tone);
  assert.ok(ui.texts.includes("Nothing waiting on you."));
  assert.equal(ui.ids.some((id) => /login|install|http/.test(id)), false);

  await db.run(itemRow("https://github.com/acme/one/pull/1", "acme", "one", 1, "First", "2026-11-09T00:00:00Z"));
  await db.run(itemRow("https://github.com/acme/two/pull/2", "acme", "two", 2, "Second", "2026-11-08T00:00:00Z"));
  for (const name of ["one", "two"]) {
    await db.run(`INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|${name}','github','github.com','acme','${name}',id,'/work/${name}/app','','git@github.com:acme/${name}.git',1 FROM projects WHERE folder='/work/${name}/app';`);
  }
  const { groupInbox } = await loadGroupInbox();
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
  const text = [AUTH.trimEnd(), "ghe.example.com", "  X Failed to log in to ghe.example.com account ent (keyring)"].join("\n");
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
    AUTH.split("\n").slice(0, 3).join("\n"),
    "ghe.example.com",
    "  Logged in to ghe.example.com account ent (keyring)",
    "  - Active account: false",
  ].join("\n");
  const { panel, calls, ui } = await shownPanel(t, dir, { "/work/app": "acme/app", "/work/ent": "git@ghe.example.com:acme/ent.git" }, signedIn((args, hostEnv) => {
    if (args[1] === "list" && args.includes("ghe.example.com/acme/ent")) {
      return success(JSON.stringify([
        { number: 1, title: "For ent", url: "https://ghe.example.com/acme/ent/pull/1", author: { login: "ada" }, reviewRequests: [{ login: "ent" }], updatedAt: "2026-11-09T00:00:00Z" },
        { number: 2, title: "For jj", url: "https://ghe.example.com/acme/ent/pull/2", author: { login: "ada" }, reviewRequests: [{ login: "jj" }], updatedAt: "2026-11-09T00:00:00Z" },
      ]));
    }
    if (args[0] === "search" && hostEnv === "GH_HOST=github.com" && args.includes("--author=@me")) {
      return success(JSON.stringify([{ number: 3, title: "Mine on github", url: "https://github.com/acme/app/pull/3", author: { login: "jj" }, repository: { nameWithOwner: "acme/app" }, updatedAt: "2026-11-08T00:00:00Z" }]));
    }
  }, auth));
  const searched = (host) => calls.some((call) => call.startsWith("gh search") && call.endsWith(`GH_HOST=${host}`));
  assert.equal(searched("github.com"), true);
  assert.equal(searched("ghe.example.com"), true);
  assert.equal(calls.some((call) => call.includes(" -R ghe.example.com/acme/ent ") && call.endsWith("GH_HOST=ghe.example.com")), true);
  const titled = (list, title) => list.some((item) => item.title === title);
  assert.equal(titled(panel.session.inbox.needs, "For ent"), true);
  assert.equal(titled(panel.session.inbox.needs, "For jj"), false);
  assert.equal(titled(panel.session.inbox.yours, "Mine on github"), true);
  assert.deepEqual(plain(panel.session.inbox.logins).toSorted(), ["ent", "jj"]);
  await drawOpenBoard(panel, tone);
  assert.ok(ui.texts.some((text) => text.includes(" · you")));
});

test("past 20 repositories, a listed one drops its stale review and an unlisted one keeps it", async (t) => {
  const { dir, db, file } = await database(t);
  const { folders } = await manyRepos(db);
  await db.run(itemRow("https://github.com/acme/repo-01/pull/1", "acme", "repo-01", 1, "Stale one", "2026-11-01T00:00:00Z"));
  await db.run(itemRow("https://github.com/acme/repo-21/pull/21", "acme", "repo-21", 21, "Stale last", "2026-11-01T00:00:00Z"));
  let searches = 0;
  const { panel, cx, drain } = await shownPanel(t, dir, folders, signedIn((args) => {
    if (args[0] === "search") { searches += 1; return success("[]"); }
  }));
  const left = await rows(file, "SELECT name FROM pr_items ORDER BY name;");
  assert.deepEqual(left.map((row) => row.name), ["repo-21"]);
  const needs = (title) => panel.session.inbox.needs.some((item) => item.title === title);
  assert.equal(needs("Stale one"), false);
  assert.equal(needs("Stale last"), true);
  const fetch = await rows(file, "SELECT fetched_at FROM pr_fetches WHERE key='inbox:github:github.com';");
  assert.ok(fetch[0].fetched_at);
  assert.equal(searches, 2);
  await refreshAgain(panel, cx, drain);
  assert.equal(searches, 2, "an empty list still counts as fresh");
});

test("cached reviews show while GitHub is still being asked, and a failed ask keeps them", async (t) => {
  const { dir, db } = await cachedReview(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let hit;
  const opened = new Promise((resolve) => { hit = resolve; });
  const { panel } = await panelFor(t, {
    dir,
    git: gitAt(ERES),
    gh: signedIn(async (args) => {
      if (args[0] === "search" && args.includes("--review-requested=@me")) { hit(); await gate; return success("[]"); }
    }),
  });
  const { cx, drain } = context();
  panel.refresh(cx);
  await opened;
  assert.equal(panel.session.inboxOn, true);
  assert.equal(panel.session.inbox.needs[0].title, "Cached");
  release();
  await drain();

  await db.run("DELETE FROM pr_fetches;");
  await db.run(eresItem("Cached"));
  const failed = await panelFor(t, {
    dir,
    git: gitAt(ERES),
    gh: signedIn((args) => {
      if (args[0] === "search") throw new Error("gh died");
    }),
  });
  failed.panel.refresh(cx); await drain();
  assert.equal(failed.panel.session.inbox.needs[0].title, "Cached");
  assert.equal(failed.panel.session.note.text, "Could not keep pull requests");
  assert.match(failed.panel.session.note.source, /gh died/);
});

test("a removed project no longer takes a repository slot", async (t) => {
  const { dir, db, file } = await database(t);
  const { folders, first } = await manyRepos(db);
  await db.removeProject(first);
  await db.run(`INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|repo-01','github','github.com','acme','repo-01',id,'/work/repo-01','','git@github.com:acme/repo-01.git',1 FROM projects WHERE folder='/work/repo-01';`);
  const listed = [];
  const { panel } = await shownPanel(t, dir, folders, signedIn(listedFrom(listed)));
  assert.equal(listed.includes("acme/repo-01"), false);
  assert.equal(listed.includes("acme/repo-21"), true);
  assert.equal(listed.length, 20);
  const repos = await rows(file, "SELECT name FROM pr_repos ORDER BY name;");
  assert.equal(repos.some((row) => row.name === "repo-01"), false);
  assert.equal(repos.some((row) => row.name === "repo-21"), true);
  assert.equal(panel.session.inboxOn, true);
});

test("signing out brings back copy, open, and the repository list", async (t) => {
  const { dir, db } = await database(t);
  await reviewWaiting(db);
  let signed = true;
  const gh = signedIn();
  const { panel, ui, cx, drain } = await shownPanel(t, dir, {}, (args, hostEnv) => args[0] === "auth" && !signed ? failure(SIGNED_OUT) : gh(args, hostEnv));
  openInbox(panel);
  const headerIds = async () => {
    ui.ids.length = 0;
    await refreshAgain(panel, cx, drain);
    panel.header(tone, false);
    return ui.ids;
  };
  ui.ids.length = 0;
  panel.header(tone, false);
  assert.equal(ui.ids.includes("pr-reviews"), true);
  assert.equal(ui.ids.includes("pr-copy"), false);
  assert.equal(ui.ids.includes("pr-web"), false);
  assert.equal(ui.ids.includes("pr-switch"), false);
  signed = false;
  panel.session.inboxOpen = false;
  const waiting = await headerIds();
  assert.equal(panel.session.inboxOn, true, "signing out waits for the next account check");
  assert.equal(waiting.includes("pr-reviews"), true);
  const { AUTH_MS } = await loadAuthTiming();
  panel.auth.at = Date.now() - AUTH_MS - 1;
  const out = await headerIds();
  assert.equal(panel.session.inboxOn, false);
  assert.equal(panel.session.inboxOpen, null);
  assert.equal(out.includes("pr-reviews"), false);
  assert.equal(out.includes("pr-copy"), true);
  assert.equal(out.includes("pr-web"), true);
  assert.equal(out.includes("pr-switch"), true);
});

test("a forced inbox read after the call that asked has returned keeps no stale context", async (t) => {
  const { dir } = await database(t, ERES_PROJECT);
  const asked = { number: 149, title: "Asked for", url: ERES_URL, author: { login: "ada" }, repository: { nameWithOwner: "amtelser/eres-admin-app" }, updatedAt: "2026-11-09T00:00:00Z", isDraft: false };
  const { panel } = await panelFor(t, {
    dir, git: gitAt(ERES),
    gh: signedIn((args) => (args[0] === "search" && args.includes("--review-requested=@me") ? success(JSON.stringify([asked])) : undefined)),
  });
  const warm = context();
  panel.refresh(warm.cx); await warm.drain();
  assert.equal(panel.session.note, null);
  const call = callContext();
  panel.again(call.cx);
  call.end();
  await call.drain();
  assert.equal(panel.session.note, null, panel.session.note?.source);
  assert.equal(panel.session.error, null);
  assert.equal(panel.session.inbox.needs[0].title, "Asked for");
});

const panelWithShared = async (t, setShared) => {
  const { dir } = await cachedReview(t);
  return panelFor(t, {
    dir, git: gitAt(ERES), gh: signedIn(), host: { setShared },
    state: { context: "repo", pr: focused, inboxOpen: false },
  });
};

test("a rejected inbox step shows its card and leaves Refresh working", async (t) => {
  const { panel, calls } = await panelWithShared(t, () => { throw new Error("shared state is closed"); });
  const { cx, drain } = await refreshedContext(panel);
  assert.equal(panel.session.loading, false, "a rejected step releases the refresh");
  assert.equal(panel.session.note.text, "Could not keep pull requests");
  assert.match(panel.session.note.source, /shared state is closed/);
  const before = calls.length;
  panel.again(cx); await drain();
  assert.ok(calls.length > before, "Refresh asks again");
});

test("a recovered refresh retires the inbox card and keeps an unrelated failure", async (t) => {
  let broken = true;
  const { panel } = await panelWithShared(t, () => { if (broken) throw new Error("shared state is closed"); });
  const { cx, drain } = await refreshedContext(panel);
  assert.equal(panel.session.note.text, "Could not keep pull requests");
  broken = false;
  panel.again(cx); await drain();
  assert.equal(panel.session.note, null, "the card goes once the inbox reads again");

  panel.session.note = { text: "Merge failed", source: "not allowed" };
  panel.again(cx); await drain();
  assert.equal(panel.session.note.text, "Merge failed");
});
