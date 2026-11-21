import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { clone as plain, exec, failure, gitOk, load, nativePlatform, refreshedContext, success, temporary } from "./helpers.mjs";
import { loadPullRequest, temporaryKdb } from "./mod-fixtures.mjs";
import { blankPanel, openedPanel, recorder, SIGNED_IN } from "./pr-fixtures.mjs";

const git = gitOk();

const pull = (owner, name, number, extra = {}) => ({
  url: `https://github.com/${owner}/${name}/pull/${number}`,
  provider: "github",
  host: "github.com",
  owner,
  name,
  number,
  title: `${name} ${number}`,
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

const repo = (owner, name) => ({ provider: "github", host: "github.com", owner, name });

test("Each repository is one block, this folder's come first, and a pull request in both lists is counted once in each", async () => {
  const { boardOf } = await load("kanso-panel/pr-board.js", ["boardOf"], {});
  const shared = pull("acme", "here", 1, { checks: "fail", createdAt: "2026-03-01T00:00:00Z" });
  const earlier = pull("acme", "here", 2, { checks: "pending", createdAt: "2026-01-01T00:00:00Z" });
  const yoursOnly = pull("acme", "here", 3, { checks: "fail", createdAt: "2020-01-01T00:00:00Z" });
  const scope = { kind: "folder", repos: [repo("acme", "here"), repo("acme", "also")] };
  const blocks = boardOf({
    needs: [shared, earlier, pull("zed", "many", 1), pull("zed", "many", 2), pull("zed", "many", 3)],
    yours: [shared, yoursOnly, pull("acme", "also", 4, { checks: "pass", createdAt: "2026-02-01T00:00:00Z" })],
  }, scope);
  const here = blocks.find((block) => block.title === "acme/here");
  assert.deepEqual(plain(blocks.map((block) => block.title)), ["acme/here", "acme/also", "zed/many"]);
  assert.equal(new Set(blocks.map((block) => block.key)).size, blocks.length);
  assert.equal(here.needs.filter((item) => item.url === shared.url).length, 1);
  assert.equal(here.yours.filter((item) => item.url === shared.url).length, 1);
  assert.equal(here.failing, 2);
  assert.equal(here.oldest, Date.parse("2026-01-01T00:00:00Z"));
});

test("A single block is open, a repository starts on its own, and opening or folding starts from that", async () => {
  const { isOpen, toggled } = await load("kanso-panel/pr-board.js", ["isOpen", "toggled"], {});
  const only = [{ key: "only", here: false }];
  assert.equal(isOpen(null, "only", only, null), true);
  const blocks = [{ key: "own", here: true }, { key: "other", here: false }];
  const repository = { kind: "repo" };
  const folder = { kind: "folder" };
  assert.equal(isOpen(null, "own", blocks, repository), true);
  assert.equal(isOpen(null, "other", blocks, repository), false);
  assert.equal(isOpen(null, "own", blocks, folder), false);
  assert.equal(isOpen(null, "other", blocks, null), false);
  assert.deepEqual(plain(toggled(null, "other", blocks, folder)), ["other"]);
  assert.deepEqual(plain(toggled(["other"], "other", blocks, folder)), []);
  assert.deepEqual(plain(toggled(null, "own", blocks, repository)), []);
  assert.deepEqual(plain(toggled(null, "other", blocks, repository)), ["own", "other"]);
});

test("Only a remote with an owner and a name is kept", async () => {
  const { scopeRepos } = await load("kanso-panel/pr-board.js", ["scopeRepos"], {});
  const kept = scopeRepos([
    { folder: "/work/app", remote: "git@github.com:acme/app.git" },
    { folder: "/work/empty", remote: "" },
    { folder: "/work/plain", remote: "not a remote" },
    { folder: "/work/short", remote: "https://github.com/only" },
  ]);
  assert.deepEqual(plain(kept), [{ provider: "github", host: "github.com", owner: "acme", name: "app", folder: "/work/app" }]);
});

test("A folder's repositories are found, including one with no remote, and a plain folder is not", async (t) => {
  const root = await temporary(t);
  const withRemote = join(root, "with-remote");
  const noRemote = join(root, "no-remote");
  const origin = "https://github.com/acme/with-remote.git";
  await mkdir(withRemote);
  await mkdir(noRemote);
  await mkdir(join(root, "plain"));
  await git(withRemote, "init", "-b", "main");
  await git(withRemote, "remote", "add", "origin", origin);
  await git(noRemote, "init", "-b", "main");
  const { repositoryApi } = await load("kanso-panel/platform-repositories.js", ["repositoryApi"], { exec });
  const found = await repositoryApi(nativePlatform, exec).children(root);
  const byName = Object.fromEntries(found.map((row) => [row.folder.split(/[/\\]/).at(-1), row.remote]));
  assert.deepEqual(byName, { "with-remote": origin, "no-remote": "" });
});

test("Repositories in this folder are read before the ones already known", async (t) => {
  const { dir, db } = await temporaryKdb(t);
  await db.addProject({ name: "known", folder: "/work/known" });
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) SELECT 'github|github.com|acme|known','github','github.com','acme','known',id,'/work/known','','git@github.com:acme/known.git',1 FROM projects WHERE folder='/work/known';");
  const { refreshInbox } = await load("kanso-panel/pr-inbox.js", ["refreshInbox"], { exec, appHome: () => dir });
  let walked = null;
  const provider = {
    id: "github",
    async inbox(_run, { repos }) {
      walked = repos.map((row) => String(row.name));
      return { items: [], complete: true, searchOk: true, queried: repos, error: null, rate: null };
    },
  };
  const session = SIGNED_IN;
  const extra = [repo("acme", "extra-b"), repo("acme", "extra-a")];
  await refreshInbox({ db, run: async () => failure("no"), provider, session, extra, facts: false, now: 5_000_000 });
  assert.deepEqual(plain(walked), ["extra-b", "extra-a", "known"]);
});

test("Two repositories of one project are two blocks", async () => {
  const { boardOf } = await load("kanso-panel/pr-board.js", ["boardOf"], {});
  const project = { id: "p1", name: "app", folder: "/work/app" };
  const repos = ["one", "two"].map((name) => ({
    id: `github|github.com|acme|${name}`, provider: "github", host: "github.com", owner: "acme", name, project_id: "p1",
  }));
  const blocks = boardOf({ needs: [pull("acme", "one", 1), pull("acme", "two", 2)], yours: [], repos, projects: [project] });
  assert.deepEqual(plain(blocks.map((block) => block.title)), ["acme/one", "acme/two"]);
  assert.equal(new Set(blocks.map((block) => block.key)).size, 2);
});

test("A folder's repository with no GitHub remote is dimmed, says No GitHub remote, and counts in the repositories here", async () => {
  const { folderScope, boardOf, blockFacts, scopeLine } = await load("kanso-panel/pr-board.js", ["folderScope", "boardOf", "blockFacts", "scopeLine"], {});
  const scope = folderScope([
    { folder: "/work/app", remote: "git@github.com:acme/app.git" },
    { folder: "/work/local", remote: "" },
  ]);
  const blocks = boardOf({ needs: [], yours: [] }, scope);
  const local = blocks.find((block) => block.title === "local");
  assert.equal(local.remote, false);
  assert.deepEqual(plain(blockFacts(local)), [{ text: "No GitHub remote", tone: "dim" }]);
  assert.equal(scopeLine(scope), "2 repositories here");
});

const AUTH = "github.com\n  Logged in to github.com account jj (keyring)\n  - Active account: true\n";
const tone = new Proxy({}, { get: () => "#888" });

test("A second read of a folder keeps the fresh cache and does not ask GitHub again", async (t) => {
  const root = await temporary(t);
  const child = join(root, "app");
  await mkdir(child);
  await git(child, "init", "-b", "main");
  await git(child, "remote", "add", "origin", "https://github.com/acme/app.git");
  const { dir, db } = await temporaryKdb(t);
  await db.run(`INSERT INTO pr_fetches(key,fetched_at) VALUES('inbox:github:github.com',${Date.now()});`);
  const readFolder = async () => {
    const calls = [];
    const here = { cwd: root, on: null };
    const host = {
      exec: async (command, args, options) => {
        const hosted = command === "env" && args?.[1] === "gh";
        if (command === "gh" || hosted) {
          const forwarded = hosted ? args.slice(2) : args;
          calls.push(["gh", ...forwarded].join(" "));
          if (forwarded[0] === "auth") return success(AUTH);
          return failure("should not be called");
        }
        return exec(command, args, options);
      },
      appHome: () => dir,
      home: () => "/Users/x",
      location: () => here,
      key: () => JSON.stringify(here),
    };
    const panel = await openedPanel(host);
    await refreshedContext(panel);
    return { calls, panel };
  };
  await readFolder();
  const second = await readFolder();
  assert.equal(second.panel.session.outside, true);
  assert.equal(second.panel.session.scope?.kind, "folder");
  assert.equal(second.panel.session.scope.repos.length, 1);
  assert.equal(second.calls.some((call) => call.startsWith("gh search") || call.includes(" -R ")), false);
});

test("Outside a repository with no signed-in provider, the verdict offers Sign in", async () => {
  const { verdictOf } = await load("kanso-panel/pr-verdict.js", ["verdictOf"], {});
  const view = verdictOf({ kind: "outside", signedOut: true, place: "~" });
  assert.equal(String(view.primary?.label), "Sign in");
});

test("Hiding failing checks and the oldest wait leaves those facts off the block", async () => {
  const ui = recorder();
  const store = {};
  const { PullRequest } = await loadPullRequest({ ...ui, shared: (key) => (key === "kanso.pieces" ? store : undefined) });
  const panel = blankPanel(PullRequest, {});
  panel.session.inbox = {
    needs: [pull("acme", "here", 1, { checks: "fail", createdAt: "2026-01-01T00:00:00Z" })],
    yours: [],
    login: "jj",
  };
  panel.session.scope = { kind: "folder", repos: [repo("acme", "here")], local: [] };
  panel.inboxPage(tone);
  assert.equal(ui.texts.some((text) => text.includes("failing")), true);
  assert.equal(ui.texts.some((text) => text.includes("oldest")), true);
  store["pr.checks"] = "hide";
  store["pr.wait"] = "hide";
  ui.texts.length = 0;
  panel.inboxPage(tone);
  assert.equal(ui.texts.some((text) => text.includes("failing")), false);
  assert.equal(ui.texts.some((text) => text.includes("oldest")), false);
  assert.equal(ui.texts.some((text) => text.includes("Needs you")), true);
});
