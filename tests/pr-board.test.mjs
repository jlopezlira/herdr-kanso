import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { clone as plain, exec, failure, load, nativePlatform, temporary } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";
import { SIGNED_IN } from "./pr-fixtures.mjs";

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
  const git = async (cwd, args) => {
    const result = await exec("git", args, { cwd });
    assert.equal(result.code, 0, result.stderr);
  };
  await git(withRemote, ["init", "-b", "main"]);
  await git(withRemote, ["remote", "add", "origin", origin]);
  await git(noRemote, ["init", "-b", "main"]);
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
