// Shipped's store, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A local SQLite database (data/kanso-panel/shipped.db, through the sqlite3
// command) of statistics only: for each commit of yours, its repository, hash,
// time, lines added and removed and the machine it was read on; for each
// repository, GitHub's weekly sums. No messages, file names or code.
//
// Three sources fill it, each asked only for what changed:
// - this machine's git: every branch of the repositories in your panes and
//   spaces and under ~/Apps, ~/Projects and the like, by any of your
//   identities, so commits GitHub can't link to you count too;
// - your other machines: each one publishes its commits to a private gist of
//   yours ("Kanso Shipped stats", one file per machine) and reads the others';
//   a commit on several machines counts once, by its hash;
// - GitHub's weekly contributor statistics, for what no machine has cloned.
// A repository's week counts the larger of what the machines and GitHub saw.
import { exec, appHome, home, spaces, panes, writeTextFile } from "herdr";
import { range, tryOrAsync, mapSeries } from "./pure.js";

export const STORE_DIR = "data/kanso-panel";
const GIST_DESCRIPTION = "Kanso Shipped stats";
const ROOTS = ["Apps", "Projects", "Developer", "code", "src", "dev", "work", "repos", "git", "github"];
const HASH = 12; // enough to tell commits apart, and short
export const WEEK0 = 3 * 86400; // 4 Jan 1970, the first Sunday: GitHub's weeks start on Sunday, UTC
export const weekOf = (sec) => Math.floor((sec - WEEK0) / 604800) * 604800 + WEEK0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS commits(repo TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL, adds INTEGER NOT NULL, dels INTEGER NOT NULL, machine TEXT NOT NULL, PRIMARY KEY(repo, hash));
CREATE INDEX IF NOT EXISTS commits_at ON commits(at);
CREATE TABLE IF NOT EXISTS gh_weeks(repo TEXT NOT NULL, week INTEGER NOT NULL, adds INTEGER NOT NULL, dels INTEGER NOT NULL, commits INTEGER NOT NULL, PRIMARY KEY(repo, week));
CREATE TABLE IF NOT EXISTS gh_repos(repo TEXT PRIMARY KEY, pushed TEXT, fetched INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS scans(path TEXT PRIMARY KEY, repo TEXT NOT NULL, refs TEXT NOT NULL, scanned INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`;

export const sqlText = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const int = (n) => String(Math.round(Number(n) || 0));

// A repository's name from its remote: owner/name on GitHub, host/path
// elsewhere, local/<folder> without one.
export function repoName(url, folder) {
  const u = String(url ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const gh = /github\.com[:/]+([^/]+\/[^/]+)$/i.exec(u);
  if (gh) return gh[1];
  const other = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]+(.+)$/i.exec(u);
  if (other) return `${other[1]}/${other[2]}`;
  return `local/${String(folder ?? "").replace(/\/+$/, "").split("/").at(-1) || "repository"}`;
}

// `git log --format='%x1e%H %at' --shortstat` as [{ hash, at (s), add, del }].
export function parseLog(stdout) {
  return String(stdout).split("\x1e").slice(1).map((chunk) => {
    const [head, ...rest] = chunk.trim().split("\n");
    const [hash, at] = head.trim().split(/\s+/);
    const stat = rest.join(" ");
    return {
      hash: hash.slice(0, HASH), at: Number(at),
      add: Number(/(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? 0),
      del: Number(/(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? 0),
    };
  });
}

// SQL that adds commits, once each (a hash already read on another machine is kept as it was).
export function insertCommits(repo, commits, machine) {
  const rows = commits.map((c) => `(${sqlText(repo)},${sqlText(c.hash)},${int(c.at)},${int(c.add)},${int(c.del)},${sqlText(machine)})`);
  // 500 rows a statement.
  return range(Math.ceil(rows.length / 500)).map((k) => `INSERT OR IGNORE INTO commits(repo,hash,at,adds,dels,machine) VALUES ${rows.slice(k * 500, k * 500 + 500).join(",")};`).join("\n");
}

// This machine's file in the gist: its commits, compact, and the identities it signs with.
export function machineFile(machine, identities, rows) {
  // Each repository's name once, in the order first met; a commit points to it by its place.
  const repos = [...new Set(rows.map((r) => r.repo))];
  const index = new Map(repos.map((repo, i) => [repo, i]));
  const commits = rows.map((r) => [index.get(r.repo), r.hash, r.at, r.adds, r.dels]);
  return { v: 1, machine, updated: Math.floor(Date.now() / 1000), identities, repos, commits };
}

export function readMachineFile(text) {
  try {
    const f = JSON.parse(text);
    if (f?.v !== 1 || !Array.isArray(f.commits) || !Array.isArray(f.repos)) return null;
    return { machine: String(f.machine ?? "another machine"), identities: Array.isArray(f.identities) ? f.identities.map(String) : [], commits: f.commits.map(([r, hash, at, add, del]) => ({ repo: f.repos[r], hash, at, add, del })).filter((c) => c.repo && c.hash) };
  } catch { return null; }
}

// Repository-weeks with the larger of the machines' and GitHub's sums: { repo: { weeks: [[week ms, adds, dels, commits]] } }.
export const WEEKLY = `WITH l AS (SELECT repo, (at - ${WEEK0}) / 604800 * 604800 + ${WEEK0} AS week, SUM(adds) a, SUM(dels) d, COUNT(*) c FROM commits GROUP BY repo, week),
u AS (SELECT repo, week, a, d, c FROM l UNION ALL SELECT repo, week, adds, dels, commits FROM gh_weeks)
SELECT repo, week, MAX(a) a, MAX(d) d, MAX(c) c FROM u GROUP BY repo, week ORDER BY repo, week;`;

export function weeklyStats(rows) {
  const repos = Object.fromEntries([...Map.groupBy(rows, (r) => r.repo)].map(([repo, list]) => [repo, { weeks: list.map((r) => [r.week * 1000, r.a, r.d, r.c]) }]));
  return { repos };
}

export class Store {
  constructor() {
    this.dir = `${appHome()}/${STORE_DIR}`;
    this.db = `${this.dir}/shipped.db`;
    this.batches = 0;
  }

  async sql(text, json = false) {
    const r = await exec("sqlite3", [...(json ? ["-json"] : []), this.db, text]);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return json ? (r.stdout.trim() ? JSON.parse(r.stdout) : []) : r.stdout;
  }

  // Large writes go through a file: an argument can't hold thousands of rows.
  async script(text) {
    if (!text.trim()) return;
    const n = this.batches;
    this.batches = n + 1;
    const path = `${this.dir}/.batch-${Date.now()}-${n}.sql`;
    await writeTextFile(path, `BEGIN;\n${text}\nCOMMIT;\n`, null);
    try {
      const r = await exec("sqlite3", [this.db, `.read '${path}'`]);
      if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    } finally { await exec("rm", ["-f", path]).catch(() => {}); }
  }

  async open() {
    const ok = await tryOrAsync(() => exec("sqlite3", ["-version"]));
    if (ok?.code !== 0) throw new Error("Install sqlite3 to keep Shipped's statistics.");
    await exec("mkdir", ["-p", this.dir]);
    await this.sql(SCHEMA);
    await exec("rm", ["-f", `${this.dir}/shipped.json`]).catch(() => {}); // the cache before the database
  }

  async meta(k) { return (await this.sql(`SELECT v FROM meta WHERE k=${sqlText(k)};`, true))[0]?.v ?? null; }
  async setMeta(k, v) { await this.sql(`INSERT OR REPLACE INTO meta(k,v) VALUES(${sqlText(k)},${sqlText(v)});`); }

  async machine() {
    if (this.name) return this.name;
    const stored = await this.meta("machine");
    // The first time: this computer's short host name, kept.
    const named = async () => {
      const r = await exec("hostname", ["-s"]).catch(() => null);
      const name = (r?.stdout ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-") || `machine-${Date.now().toString(36)}`;
      await this.setMeta("machine", name);
      return name;
    };
    const name = stored || await named();
    this.name = name;
    return name;
  }

  async weekly() { return weeklyStats(await this.sql(WEEKLY, true)); }

  // When and where you ship, from the commits read (local and synced) in [start, end) (s).
  async rhythm(start, end) {
    const span = `at >= ${int(start)} AND at < ${int(end)}`;
    const [hours, machines] = await Promise.all([
      this.sql(`SELECT CAST(strftime('%H', at, 'unixepoch', 'localtime') AS INTEGER) h, COUNT(*) n FROM commits WHERE ${span} GROUP BY h;`, true),
      this.sql(`SELECT machine, COUNT(*) n, SUM(adds) a, SUM(dels) d FROM commits WHERE ${span} GROUP BY machine ORDER BY n DESC;`, true),
    ]);
    const counts = new Map(hours.map((r) => [r.h, r.n]));
    const byHour = range(24).map((h) => (counts.has(h) ? counts.get(h) : 0));
    return { hours: byHour, machines };
  }

  // ---- GitHub's weekly sums ----

  async ghRepos() { return this.sql("SELECT repo, pushed, fetched, pending FROM gh_repos;", true); }

  async saveGithub(entries) {
    const out = entries.flatMap((e) => [
      `INSERT OR REPLACE INTO gh_repos(repo,pushed,fetched,pending) VALUES(${sqlText(e.repo)},${sqlText(e.pushed)},${int(e.fetched)},${e.pending ? 1 : 0});`,
      // A repository GitHub is still counting keeps the weeks it had.
      ...(e.pending ? [] : [
        `DELETE FROM gh_weeks WHERE repo=${sqlText(e.repo)};`,
        ...e.weeks.map(([w, a, d, c]) => `INSERT INTO gh_weeks(repo,week,adds,dels,commits) VALUES(${sqlText(e.repo)},${int(w / 1000)},${int(a)},${int(d)},${int(c)});`),
      ]),
    ]);
    await this.script(out.join("\n"));
  }

  // ---- this machine's git ----

  // Your repositories here, once each: where your panes and spaces are, the
  // ones read before, and those under the usual folders (4 levels deep).
  async localRepos() {
    const known = [
      ...panes().filter((p) => p.cwd && !String(p.pane).includes("/")).map((p) => p.cwd),
      ...spaces().filter((s) => !s.machine && s.folder).map((s) => s.folder),
      ...(await this.sql("SELECT path FROM scans;", true)).map((r) => r.path),
    ];
    const found = await exec("sh", ["-c", 'for d in "$@"; do [ -d "$d" ] && find "$d" -maxdepth 4 -name .git -prune 2>/dev/null; done', "sh", ...ROOTS.map((r) => `${home()}/${r}`)]).catch(() => null);
    const list = [...new Set([...known, ...(found?.stdout ?? "").split("\n").filter((line) => line.trim()).map((line) => line.trim().replace(/\/\.git$/, ""))])];
    // Eight folders at a time: each one's repository, by its git folder.
    const read = await mapSeries(range(Math.ceil(list.length / 8)), (k) => Promise.all(list.slice(k * 8, k * 8 + 8).map(async (folder) => {
      const r = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir --show-toplevel && (git config --get remote.origin.url || echo) && git for-each-ref --format="%(objectname)" | cksum', "sh", folder]).catch(() => null);
      if (r?.code !== 0) return [];
      const [common, top, url, refs] = r.stdout.split("\n").map((s) => s.trim());
      if (!common) return [];
      const main = common.endsWith("/.git") ? common.slice(0, -5) : top;
      return [{ common, path: main, repo: repoName(url, main), refs: refs ?? "" }];
    })));
    // A repository reached from several folders (its worktrees) counts once, as first read.
    return [...Map.groupBy(read.flat(2), (r) => r.common).values()].map(([{ path, repo, refs }]) => ({ path, repo, refs }));
  }

  // Reads the commits of every repository whose branches moved since the last read.
  async scanLocal(identities, progress) {
    const machine = await this.machine();
    const seen = new Map((await this.sql("SELECT path, refs FROM scans;", true)).map((r) => [r.path, r.refs]));
    const repos = (await this.localRepos()).filter((r) => seen.get(r.path) !== r.refs);
    await mapSeries(repos, async (r, i) => {
      const log = await exec("git", ["log", "--all", "--no-merges", "-F", ...identities.map((w) => `--author=${w}`), "--format=%x1e%H %at", "--shortstat"], { cwd: r.path }).catch(() => null);
      if (log?.code === 0) {
        await this.script(`${insertCommits(r.repo, parseLog(log.stdout), machine)}
INSERT OR REPLACE INTO scans(path,repo,refs,scanned) VALUES(${sqlText(r.path)},${sqlText(r.repo)},${sqlText(r.refs)},${int(Date.now() / 1000)});`);
      }
      progress?.(i + 1, repos.length);
    });
    return repos.length;
  }

  // ---- your other machines ----

  // Publishes this machine's commits to the gist and reads the other machines'.
  // Returns the identities they sign with.
  async syncMachines(identities) {
    const machine = await this.machine();
    const stored = await this.meta("gist");
    // Not kept here yet: the gist another machine made, found by its description.
    const listed = async () => {
      const list = await exec("gh", ["api", "gists?per_page=100", "--paginate", "--jq", `.[] | select(.description == "${GIST_DESCRIPTION}") | .id`]);
      return list.code === 0 ? list.stdout.split("\n").map((s) => s.trim()).find(Boolean) ?? null : null;
    };
    const id = stored || await listed();
    const mine = machineFile(machine, identities, await this.sql(`SELECT repo, hash, at, adds, dels FROM commits WHERE machine=${sqlText(machine)};`, true));
    const name = `shipped-${machine}.json`;
    const body = id ? { files: { [name]: { content: JSON.stringify(mine) } } } : { description: GIST_DESCRIPTION, public: false, files: { [name]: { content: JSON.stringify(mine) } } };
    const path = `${this.dir}/.gist-${Date.now()}.json`;
    await writeTextFile(path, JSON.stringify(body), null);
    const send = async () => {
      try { return await exec("gh", ["api", ...(id ? ["-X", "PATCH", `gists/${id}`] : ["-X", "POST", "gists"]), "--input", path]); }
      finally { await exec("rm", ["-f", path]).catch(() => {}); }
    };
    const sent = await send();
    if (sent.code !== 0) throw new Error((sent.stderr || "the gist could not be written").trim().split("\n")[0]);
    const gist = JSON.parse(sent.stdout);
    const gistId = id || gist.id;
    await this.setMeta("gist", gistId);
    // The other machines' files, one at a time: each one's commits stored.
    const read = await mapSeries(Object.entries(gist.files ?? {}), async ([file, f]) => {
      if (file === name || !file.startsWith("shipped-")) return null;
      const fetched = async () => { const r = await exec("curl", ["-fsSL", "--max-time", "25", f.raw_url]).catch(() => null); return r?.code === 0 ? r.stdout : null; };
      const text = f.truncated && f.raw_url ? await fetched() : f.content;
      const other = text && readMachineFile(text);
      if (!other) return null;
      await this.script([...Map.groupBy(other.commits, (c) => c.repo)].map(([repo, commits]) => insertCommits(repo, commits, other.machine)).join("\n"));
      return other;
    });
    const others = read.filter(Boolean);
    return { gist: gistId, machines: others.map((o) => o.machine), identities: [...new Set(others.flatMap((o) => o.identities))] };
  }
}
