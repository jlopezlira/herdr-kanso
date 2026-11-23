import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, exec, temporary, clone, nativeWindow, success, openedKdb, textFiles } from "./helpers.mjs";

const names = ["Store", "repoName", "parseLog", "insertCommits", "machineFile", "readMachineFile", "weekOf", "weeklyStats", "WEEK0"];
const store = (host = {}, exports = names) => load("kanso-panel/shipped-store.js", exports, host);
const loadSha256 = async () => (await load("kanso-panel/sha256.js", ["sha256"])).sha256;
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sealedFixture = (key, normalized) => digest(`${key}\n${normalized}`);

test("Shipped's SHA-256 matches Node for empty, padded, multi-block and UTF-8 inputs", async () => {
  const sha256 = await loadSha256();
  for (const input of ["", "abc", ...[55, 56, 63, 64, 1000].map((length) => "a".repeat(length)), "ñ", "日本", "🐈"]) {
    assert.equal(sha256(input), digest(input), `input ${JSON.stringify(input.slice(0, 8))}, length ${input.length}`);
  }
});

test("Shipped's SHA-256 matches Node for a lone surrogate", async () => {
  const sha256 = await loadSha256();
  const input = "\uD800";
  assert.equal(sha256(input), digest(input));
});

test("Shipped's store names repositories by their remote", async () => {
  const { repoName } = await store();
  assert.equal(repoName("git@github.com:org/app.git", "/x/app"), "org/app");
  assert.equal(repoName("https://github.com/org/app", "/x/app"), "org/app");
  assert.equal(repoName("https://gitlab.com/group/sub/app.git", "/x/app"), "gitlab.com/group/sub/app");
  assert.equal(repoName("", "/Users/me/Apps/scratch"), "local/scratch");
});

test("Shipped's store keeps statistics only, and machines share them by hash", async () => {
  const { parseLog, machineFile, readMachineFile, weekOf, WEEK0 } = await store();
  const log = "\x1eaaaaaaaaaaaaaaaaaaaa 1793500000\n\n 3 files changed, 40 insertions(+), 2 deletions(-)\n\x1ebbbbbbbbbbbbbbbbbbbb 1793400000\n\n 1 file changed, 1 deletion(-)\n";
  const commits = clone(parseLog(log));
  assert.deepEqual(commits, [{ hash: "aaaaaaaaaaaa", at: 1793500000, add: 40, del: 2 }, { hash: "bbbbbbbbbbbb", at: 1793400000, add: 0, del: 1 }], "12-character hashes");
  const key = "g1", repo = "org/app", repoSeal = sealedFixture(key, repo);
  const file = clone(machineFile("box", ["me@example.invalid"], [
    { repo, hash: "aaaaaaaaaaaa", at: 1, adds: 2, dels: 3 },
    { repo, hash: "cccccccccccc", at: 4, adds: 5, dels: 6 },
  ], key));
  assert.deepEqual(file.repos, [repoSeal]);
  assert.deepEqual(file.commits[1], [0, "cccccccccccc", 4, 5, 6]);
  assert.ok(!JSON.stringify(file).match(/message|subject|path/), "no messages, files or code");
  assert.equal(readMachineFile(JSON.stringify(file), new Map([[repoSeal, repo]])).commits[1].repo, repo);
  assert.equal(readMachineFile("not json"), null);
  assert.equal(new Date(WEEK0 * 1000).getUTCDay(), 0, "GitHub's weeks start on Sunday");
  assert.equal(weekOf(Date.UTC(2026, 10, 3, 12) / 1000), Date.UTC(2026, 10, 1) / 1000);
});

test("Shipped resolves known v2 repository seals and still reads v1 files", async () => {
  const { readMachineFile } = await store();
  const key = "g1", repo = "org/tool", unknown = sealedFixture(key, "org/elsewhere");
  const knownSeal = sealedFixture(key, repo), identitySeal = sealedFixture(key, "mequexample.invalid");
  const text = JSON.stringify({
    v: 2, machine: "other", identities: [identitySeal], repos: [knownSeal, unknown],
    commits: [[0, "aaaaaaaaaaaa", 1, 2, 3], [1, "bbbbbbbbbbbb", 4, 5, 6]],
  });
  const actual = clone(readMachineFile(text, new Map([[knownSeal, repo]])));
  assert.deepEqual(actual, {
    machine: "other", identities: [], seals: [identitySeal],
    commits: [
      { repo, hash: "aaaaaaaaaaaa", at: 1, add: 2, del: 3 },
      { repo: `other/${unknown.slice(0, 7)}`, hash: "bbbbbbbbbbbb", at: 4, add: 5, del: 6 },
    ],
  });

  const legacy = clone(readMachineFile(JSON.stringify({ v: 1, machine: "box", identities: ["me@example.invalid"], repos: [repo], commits: [[0, "aaaaaaaaaaaa", 1, 2, 3]] })));
  assert.deepEqual(legacy, { machine: "box", identities: ["me@example.invalid"], seals: [], commits: [actual.commits[0]] });
});

async function setup(t, { otherMachine = null, rawUrl = null } = {}) {
  const root = await temporary(t);
  const home = join(root, "home"), app = join(root, "app"), repo = join(home, "Apps", "tool");
  await mkdir(repo, { recursive: true });
  const git = async (...args) => { const r = await exec("git", args, { cwd: repo }); assert.equal(r.code, 0, r.stderr); return r.stdout; };
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Me"); await git("config", "user.email", "me@example.invalid");
  await git("config", "commit.gpgsign", "false"); await git("config", "core.hooksPath", repo);
  await git("remote", "add", "origin", "git@github.com:org/tool.git");
  const commit = async (file, lines, who) => {
    await writeFile(join(repo, file), "x\n".repeat(lines));
    await git("add", "-A");
    await git(...(who ? ["-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`] : []), "commit", "-q", "-m", file);
  };
  await commit("a.txt", 10);
  await commit("b.txt", 20, { name: "JJ", email: "mequexample.invalid" }); // a typo on another machine
  await commit("c.txt", 999, { name: "Colleague", email: "them@example.invalid" });
  await git("checkout", "-q", "-b", "wip");
  await commit("d.txt", 5);

  const content = JSON.stringify(otherMachine);
  const otherFile = rawUrl ? { truncated: true, raw_url: rawUrl } : { content };
  let gist = otherMachine ? { id: "g1", files: { "shipped-other.json": otherFile } } : null;
  const sent = [], curl = [];
  const host = {
    window: nativeWindow,
    appHome: () => app, home: () => home, spaces: () => [], panes: () => [],
    ...textFiles,
    exec: async (command, args, options) => {
      if (command === "curl") { curl.push(args); return success(content); }
      if (command !== "gh") return exec(command, args, options);
      if (args[1].startsWith("gists?")) return success(gist ? `${gist.id}\n` : "");
      const body = JSON.parse(await readFile(args[args.indexOf("--input") + 1], "utf8"));
      const request = args.indexOf("-X");
      sent.push({ method: args[request + 1], resource: args[request + 2], body });
      gist = { id: gist?.id ?? "new", files: { ...(gist?.files ?? {}), ...Object.fromEntries(Object.entries(body.files).map(([k, v]) => [k, { content: v.content }])) } };
      return success(JSON.stringify(gist));
    },
  };
  const mod = await store(host);
  return { ...mod, app, repo, commit, sent, curl, gist: () => gist };
}

// The fixture with its store open.
const opened = async (t, options) => {
  const s = await setup(t, options);
  const db = await openedKdb(s.Store);
  await db.setMeta("machine", "this-box");
  return { s, db };
};

test("Shipped's store reads every branch of your repositories, by every identity of yours", async (t) => {
  const { s, db } = await opened(t);
  const scanned = await db.scanLocal(["me@example.invalid"], null);
  assert.equal(scanned, 1, "found under ~/Apps");
  let rows = await db.sql("SELECT repo, adds FROM commits ORDER BY adds;", true);
  assert.deepEqual(clone(rows.map((r) => [r.repo, r.adds])), [["org/tool", 5], ["org/tool", 10]], "both branches, not the colleague, not yet the typo");
  assert.equal(await db.scanLocal(["me@example.invalid"], null), 0, "nothing moved: nothing read");

  // An identity learned from another machine: the next read finds those commits too.
  await db.sql("DELETE FROM scans;");
  await db.scanLocal(["me@example.invalid", "mequexample.invalid"], null);
  rows = await db.sql("SELECT adds FROM commits ORDER BY adds;", true);
  assert.deepEqual(clone(rows.map((r) => r.adds)), [5, 10, 20]);

  const weekly = clone(await db.weekly());
  assert.equal(weekly.repos["org/tool"].weeks.reduce((n, w) => n + w[1], 0), 35);
  const rhythm = clone(await db.rhythm(0, Date.now() / 1000 + 60));
  assert.equal(rhythm.hours.reduce((a, b) => a + b, 0), 3);
  assert.equal(rhythm.machines.length, 1);
});

test("Shipped's store keeps the larger of a repository's week, from git or from GitHub", async (t) => {
  const { s, db } = await opened(t);
  await db.scanLocal(["me@example.invalid"], null); // 15 lines this week in org/tool
  const week = s.weekOf(Math.floor(Date.now() / 1000)) * 1000;
  await db.saveGithub([
    { repo: "org/tool", pushed: "2026-01-01T00:00:00Z", fetched: 1, weeks: [[week, 100, 1, 2]] },
    { repo: "org/remote-only", pushed: "2026-01-01T00:00:00Z", fetched: 1, weeks: [[week, 7, 0, 1]] },
    { repo: "org/slow", pushed: null, fetched: 0, pending: true },
  ]);
  const weekly = clone(await db.weekly());
  assert.deepEqual(weekly.repos["org/tool"].weeks.find((w) => w[0] === week).slice(1), [100, 1, 2], "GitHub saw more there");
  assert.ok(weekly.repos["org/remote-only"], "a repository no machine has cloned");
  assert.equal((await db.ghRepos()).find((r) => r.repo === "org/slow").pending, 1);
});

const contents = ({ body }) => JSON.parse(Object.values(body.files)[0].content);

test("Shipped's store shares your commits between machines through a private gist", async (t) => {
  const other = { v: 1, machine: "other", updated: 1, identities: ["mequexample.invalid"], repos: ["org/tool", "org/elsewhere"],
    commits: [[1, "eeeeeeeeeeee", 1793000000, 300, 3], [0, "ffffffffffff", 1793000000, 1, 0]] };
  const { s, db } = await opened(t, { otherMachine: other });
  await db.scanLocal(["me@example.invalid"], null);
  const synced = clone(await db.syncMachines(["me@example.invalid"]));
  assert.deepEqual(synced.machines, ["other"]);
  assert.deepEqual(synced.identities, ["mequexample.invalid"], "learned, for the next local read");
  const mine = s.sent[0];
  assert.equal(mine.method, "PATCH", "the existing gist");
  const name = Object.keys(mine.body.files)[0];
  assert.match(name, /^shipped-.+\.json$/);
  assert.equal(contents(mine).commits.length, 2, "this machine's commits only");
  const rows = await db.sql("SELECT machine, COUNT(*) n FROM commits GROUP BY machine ORDER BY machine;", true);
  assert.deepEqual(rows.find((r) => r.machine === "other").n, 2);

  // Again: the same commits are not counted twice.
  await db.syncMachines(["me@example.invalid"]);
  assert.equal((await db.sql("SELECT COUNT(*) n FROM commits;", true))[0].n, 4);
});

test("Shipped creates an empty private gist, then publishes stats sealed with its new id", async (t) => {
  const { s, db } = await opened(t);
  const identity = "me@example.invalid", repo = "org/tool", id = "new";
  await db.scanLocal([identity], null);
  await db.syncMachines([identity]);
  assert.deepEqual(s.sent.map(({ method, resource }) => [method, resource]), [["POST", "gists"], ["PATCH", `gists/${id}`]]);
  const [post, patch] = s.sent;
  assert.equal(post.body.public, false);
  assert.equal(post.body.description, "Kanso Shipped stats");
  const empty = contents(post);
  assert.deepEqual([empty.commits, empty.identities, empty.repos], [[], [], []]);
  const full = contents(patch);
  assert.equal(full.commits.length, 2);
  assert.deepEqual(full.identities, [sealedFixture(id, identity)]);
  assert.deepEqual(full.repos, [sealedFixture(id, repo)]);
  assert.equal(await db.meta("gist"), id);
});

test("Shipped posts only seals for identities and repository names", async (t) => {
  const { s, db } = await opened(t, { otherMachine: { v: 1, repos: [], commits: [] } });
  const identity = "me@example.invalid", alias = "bare-alias", repo = "org/tool", id = "g1";
  await db.scanLocal([identity], null);
  await db.syncMachines([" Me@Example.INVALID ", " Bare-Alias "]);

  const request = s.sent[0];
  const body = JSON.stringify(request.body);
  for (const plaintext of ["@", repo, identity, alias]) assert.ok(!body.toLowerCase().includes(plaintext), plaintext);
  const { seal } = await store({}, ["seal"]);
  const { identities, repos } = contents(request);
  const expected = [identity, alias, repo].map((value) => seal(id, value));
  assert.deepEqual([...identities, ...repos], expected);
  for (const value of expected) assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(seal(id, " Me@Example.INVALID "), sealedFixture(id, identity));
});

test("Shipped imports sealed commits under known or abbreviated repository names without recounting them", async (t) => {
  const key = "g1", repo = "org/tool", identity = "unmatched@example.invalid";
  const otherRepo = sealedFixture(key, "org/elsewhere");
  const other = {
    v: 2, machine: "other", identities: [sealedFixture(key, "mequexample.invalid")],
    repos: [sealedFixture(key, repo), otherRepo],
    commits: [[0, "ffffffffffff", 1793000000, 1, 0], [1, "eeeeeeeeeeee", 1793000000, 300, 3]],
  };
  const { db } = await opened(t, { otherMachine: other });
  await db.scanLocal([identity], null);

  const readCommits = async () => clone(await db.sql("SELECT repo, hash FROM commits ORDER BY hash;", true));
  assert.deepEqual(await readCommits(), []);
  const first = clone(await db.syncMachines([identity]));
  const after = await readCommits();
  assert.deepEqual(first.seals, other.identities);
  assert.deepEqual(first.identities, []);
  assert.deepEqual(after, [
    { repo: `other/${otherRepo.slice(0, 7)}`, hash: "eeeeeeeeeeee" },
    { repo, hash: "ffffffffffff" },
  ]);
  await db.syncMachines([identity]);
  assert.deepEqual(await readCommits(), after);
});

test("Shipped moves a peer commit to its repository name once that name becomes known", async (t) => {
  const repo = "org/newly-known", hash = "abababababab", adds = 7;
  const repoSeal = sealedFixture("g1", repo);
  const other = { v: 2, machine: "other", identities: [], repos: [repoSeal], commits: [[0, hash, 1793000000, adds, 0]] };
  const { db } = await opened(t, { otherMachine: other });
  const rows = async () => clone(await db.sql("SELECT repo, hash, adds FROM commits ORDER BY repo;", true));

  await db.syncMachines([]);
  assert.deepEqual(await rows(), [{ repo: `other/${repoSeal.slice(0, 7)}`, hash, adds }]);
  await db.saveGithub([{ repo, pushed: null, fetched: 1, weeks: [] }]);
  await db.syncMachines([]);
  assert.deepEqual(await rows(), [{ repo, hash, adds }]);
});

const additions = async (db) => clone((await db.sql("SELECT adds FROM commits ORDER BY adds;", true)).map((row) => row.adds));

test("Shipped finds commits by a sealed author identity not in the plain list", async (t) => {
  const { db } = await opened(t);
  const identities = ["me@example.invalid"], key = "g1";
  await db.scanLocal(identities, null);
  assert.deepEqual(await additions(db), [5, 10]);
  await db.sql("DELETE FROM scans;");
  await db.scanLocal(identities, null, { key, seals: [sealedFixture(key, "mequexample.invalid")] });
  assert.deepEqual(await additions(db), [5, 10, 20]);
});

test("Shipped credits exact sealed author emails and names, not longer matches", async (t) => {
  const { s, db } = await opened(t);
  await s.commit("longer-email.txt", 33, { name: "Different Author", email: "prefix-mequexample.invalid" });
  await s.commit("longer-name.txt", 44, { name: "JJ Other", email: "another@example.invalid" });
  const key = "g1", identities = ["me@example.invalid"];
  const scanAs = async (normalized) => {
    await db.sql("DELETE FROM scans; DELETE FROM commits;");
    await db.scanLocal(identities, null, { key, seals: [sealedFixture(key, normalized)] });
    return additions(db);
  };
  const actual = { email: await scanAs("mequexample.invalid"), name: await scanAs("jj") };
  assert.deepEqual(actual, { email: [5, 10, 20], name: [5, 10, 20] });
});

test("Shipped fetches truncated gist files over HTTPS only, including redirects", async (t) => {
  const rawUrl = "https://gist.example.invalid/raw";
  const other = { v: 1, machine: "other", identities: [], repos: [], commits: [] };
  const { s, db } = await opened(t, { otherMachine: other, rawUrl });
  const result = await db.syncMachines([]);
  assert.deepEqual(clone(result.machines), ["other"]);
  assert.equal(s.curl.length, 1);
  const [args] = s.curl;
  assert.equal(args.at(-1), rawUrl);
  for (const option of ["--proto", "--proto-redir"]) {
    assert.ok(args.includes(option), option);
    assert.equal(args[args.indexOf(option) + 1], "=https", option);
  }
});
