// Kanso's one database, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// data/kanso/kanso.db (through the sqlite3 command) is the left nav's one
// source of truth: every view (Spaces, Status, Threads) reads it, and
// asleep is one status of an agent, like working, idle or done.
//   spaces  the spaces Herdr has, by id (never by folder: several share one)
//   agents  one row per agent, by its conversation (a terminal's address is
//           reused, and a wake gives it a new one): the name you gave it, its
//           conversation's title, its space and place there, its status;
//           `restore`: a name a wake could not put back on its terminal yet
//   sleeps  each tab put to sleep: what opens again (every pane of it, agent
//           or not), and who holds it now: the sleep writing it (`pending`)
//           or the one wake opening it (`waking`), each with its own token
//   prefs   what you chose in the sidebar
// Every change that needs to hold the row says whether it did, so a window
// that lost it never acts as if it had.
import { exec, appHome } from "herdr";

export const DIR = "data/kanso";
export const VERSION = 1;
export const STALE_MS = 10 * 60_000; // a hold not renewed this long stopped half way
export const GONE_MS = 60_000; // an agent not seen this long, and not asleep, is gone

export const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n = (x) => (x != null && Number.isFinite(Number(x)) ? String(Math.round(Number(x))) : "NULL");
// `col` not among `xs` (always true for none; `NOT IN (NULL)` would be never).
const notIn = (col, xs) => (xs.length ? `${col} NOT IN (${xs.map(q).join(",")})` : "1");
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export const projectKey = (w, home = "") => `${w?.machine ?? ""}:${w?.folder || home}`;
// A conversation's id from its file (Claude's <id>.jsonl, Codex's rollout-…-<id>.jsonl).
export const conversationOf = (file) => String(file ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? null;

// Columns added to agents after its first release: [name, type].
const ADDED = [["project", "TEXT"]];

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, machine TEXT, seen INTEGER NOT NULL, gone INTEGER);
CREATE TABLE IF NOT EXISTS sleeps(id TEXT PRIMARY KEY, name TEXT NOT NULL, space_id TEXT, space_name TEXT, project TEXT NOT NULL, layout TEXT NOT NULL,
  into_tab TEXT, saved INTEGER NOT NULL, pending TEXT, pending_at INTEGER, waking TEXT, waking_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS sleeps_name ON sleeps(project, name);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, program TEXT, cwd TEXT, space_id TEXT, tab_id TEXT, pos INTEGER,
  terminal TEXT, status TEXT NOT NULL DEFAULT 'unknown', since INTEGER, seen INTEGER NOT NULL, sleep_id TEXT, restore TEXT, project TEXT);
CREATE INDEX IF NOT EXISTS agents_space ON agents(space_id, status);
INSERT OR IGNORE INTO meta(key,value) VALUES('version','${VERSION}');`;
// An agent is in one sleep at a time (one statement: its body has its own ";").
export const ONE_SLEEP = `CREATE TRIGGER IF NOT EXISTS agents_one_sleep BEFORE UPDATE OF sleep_id ON agents
  WHEN OLD.sleep_id IS NOT NULL AND NEW.sleep_id IS NOT NULL AND OLD.sleep_id != NEW.sleep_id
  BEGIN SELECT RAISE(ABORT, 'that agent is already asleep'); END;`;

// SQL text as its statements, split at each ";" outside a quoted string.
export function statements(text) {
  if (Array.isArray(text)) return text;
  // Character by character: `cur` the statement so far, `quoted` inside a
  // string; an empty statement (a lone ";") is dropped.
  const { out, cur } = [...text].reduce(({ out, cur, quoted }, ch) => {
    const inside = ch === "'" ? !quoted : quoted;
    const next = cur + ch;
    if (ch !== ";" || inside) return { out, cur: next, quoted: inside };
    return { out: next.trim() !== ";" ? [...out, next.trim()] : out, cur: "", quoted: inside };
  }, { out: [], cur: "", quoted: false });
  return cur.trim() ? [...out, cur.trim()] : out;
}

// sqlite3 -json prints one array per statement that returns rows (a raw
// newline never appears inside a JSON string, so "]\n[" only parts them).
export const rowsOfOutput = (out) => (out.trim() ? JSON.parse(`[${out.trim().replace(/\]\n\[/g, "],[")}]`).flat() : []);

// The space a stored place belongs to: by id, and only by id (a space of
// the same folder and name is not that one: it may have stood beside it
// all along; a wake that makes a new one for it moves what slept there,
// moveSpace). A row from before ids: the one space of that folder and
// name, and only when exactly one fits. Never the first that shares a folder.
export function spaceFor(place, spaces, home = "") {
  if (place.spaceId) return spaces.find((w) => w.id === place.spaceId) ?? null;
  const same = spaces.filter((w) => projectKey(w, home) === place.project);
  const named = place.spaceName ? same.filter((w) => w.name === place.spaceName) : same;
  return named.length === 1 ? named[0] : null;
}

// Is a sleeping row (`a`: { spaceId, space, from }) in `place`: a space
// ({ space: its id }) by the rule above, or (no space: { from }) a project
// that has no space it fits?
export function inPlace(a, place, spaces, home = "") {
  const w = spaceFor({ spaceId: a.spaceId, spaceName: a.space, project: a.from }, spaces, home);
  return place.space ? w?.id === place.space : !w && a.from === place.from;
}

// Names to put back later ([conversation, name]), only while `mine` holds.
const restoreSql = (restores, mine) => restores.map(([c, name]) => `UPDATE agents SET restore=${q(name)} WHERE id=${q(c)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});`).join("");

const free = (col, now) => `(${col} IS NULL OR ${col}_at IS NULL OR ${col}_at < ${n(now - STALE_MS)})`;

export class Kdb {
  constructor(dir = `${appHome()}/${DIR}`) {
    this.dir = dir;
    this.file = `${dir}/kanso.db`;
    this.ready = null;
    this.chain = Promise.resolve();
  }

  // One sqlite3 run, each statement its own argument: -bail then stops at
  // the first that fails, and a transaction it was in is rolled back when
  // the process ends, never committed. (Statements in one argument would
  // run on past an error, up to the COMMIT.)
  async sql(text) {
    const r = await exec("sqlite3", ["-bail", "-cmd", ".timeout 5000", "-json", this.file, ...statements(text)]);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return rowsOfOutput(r.stdout);
  }

  // Ready once; a failure is tried again on the next call, never kept.
  open() {
    return (this.ready ??= (async () => {
      const ok = await exec("sqlite3", ["-version"]).catch(() => null);
      if (ok?.code !== 0) throw new Error("Install sqlite3 to keep the sidebar's state.");
      await exec("mkdir", ["-p", this.dir]);
      await this.sql([...statements(SCHEMA), ONE_SLEEP]);
      // A database made before a column existed gets it (CREATE TABLE IF
      // NOT EXISTS leaves an older table as it was).
      const cols = (await this.sql("PRAGMA table_info(agents);")).map((c) => c.name);
      const missing = ADDED.filter(([name]) => !cols.includes(name));
      if (missing.length) await this.sql(missing.map(([name, type]) => `ALTER TABLE agents ADD COLUMN ${name} ${type};`).join(""));
    })().catch((e) => { this.ready = null; throw e; }));
  }

  // In order, one after the other (a failed one fails its caller only).
  run(text) {
    const done = this.chain.then(() => this.open()).then(() => this.sql(text));
    this.chain = done.catch(() => {});
    return done;
  }
  // True when the statement that returns rows touched one.
  async held(text) { return (await this.run(text)).length > 0; }
  async read(text) { await this.open(); return this.sql(text); }

  // ---- What was there before this database, taken in once, all or nothing
  // (store.js reads the old files and plans it: `sleeps`, each with its
  // `agents`; `prefs`). The marker is checked inside the write lock, by
  // every statement, so two windows never both take them in.
  migrate({ sleeps = [], prefs = [] } = {}) {
    const todo = "NOT EXISTS(SELECT 1 FROM meta WHERE key='migrated')";
    const prefRows = prefs.map((p) => `INSERT OR IGNORE INTO prefs(key,value) SELECT ${q(p.key)},${q(p.value)} WHERE ${todo};`);
    // Each sleep, then its agents.
    const sleepRows = sleeps.flatMap((r) => [
      `INSERT OR IGNORE INTO sleeps(id,name,space_id,space_name,project,layout,into_tab,saved,pending,pending_at,waking,waking_at)
        SELECT ${q(r.id)},${q(r.name)},NULL,${q(r.space)},${q(r.project)},${q(JSON.stringify(r.layout))},${q(r.into && JSON.stringify(r.into))},${n(r.saved)},
          ${r.pendingAt == null ? "NULL" : "'legacy'"},${n(r.pendingAt)},${r.wakingAt == null ? "NULL" : "'legacy'"},${n(r.wakingAt)} WHERE ${todo};`,
      ...r.agents.map((g) => `INSERT INTO agents(id,name,cwd,status,seen,sleep_id) SELECT ${q(g.conversation)},${q(g.name)},${q(g.cwd)},'asleep',${n(r.saved)},${q(r.id)}
        WHERE ${todo} AND EXISTS(SELECT 1 FROM sleeps WHERE id=${q(r.id)}) ON CONFLICT(id) DO UPDATE SET status='asleep',sleep_id=excluded.sleep_id,terminal=NULL;`),
    ]);
    return this.run(["BEGIN IMMEDIATE;", ...prefRows, ...sleepRows, `INSERT OR IGNORE INTO meta(key,value) VALUES('migrated','${Date.now()}');`, "COMMIT;"]);
  }
  async migrated() { return (await this.read("SELECT 1 AS x FROM meta WHERE key='migrated';")).length > 0; }

  // ---- Spaces: the ones Herdr has now, by id; one no longer listed is
  // marked gone, never deleted (what sleeps in it still finds its way back).
  syncSpaces(spaces, now = Date.now()) {
    const rows = spaces.map((w) => `INSERT INTO spaces(id,name,folder,machine,seen,gone) VALUES(${q(w.id)},${q(w.name)},${q(w.folder)},${q(w.machine)},${n(now)},NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,folder=excluded.folder,machine=excluded.machine,seen=excluded.seen,gone=NULL;`);
    return this.run(`BEGIN;${rows.join("")}UPDATE spaces SET gone=${n(now)} WHERE gone IS NULL AND ${notIn("id", spaces.map((w) => w.id))};COMMIT;`);
  }
  // What sleeps without a space id (from before ids) and now fits one space: kept by that id.
  adoptSpaces(found) {
    const rows = found.map(({ sleep, space }) => `UPDATE sleeps SET space_id=${q(space)} WHERE id=${q(sleep)} AND space_id IS NULL;
      UPDATE agents SET space_id=${q(space)} WHERE sleep_id=${q(sleep)} AND space_id IS NULL;`);
    return rows.length ? this.run(`BEGIN;${rows.join("")}COMMIT;`) : Promise.resolve([]);
  }

  // A space gone (`from`) and the one a wake made in its place (`to`):
  // what else slept in it is in that one now, by id, and a wake that still
  // has the old id finds the new one (replacement).
  // `token`: only while that wake holds the making of it (replacing).
  moveSpace(from, to, token = null) {
    const mine = token ? ` AND EXISTS(SELECT 1 FROM meta WHERE key=${q(`replacing:${from}`)} AND value LIKE ${q(`${token}|%`)})` : "";
    return this.run(`BEGIN;UPDATE sleeps SET space_id=${q(to)} WHERE space_id=${q(from)}${mine};UPDATE agents SET space_id=${q(to)} WHERE space_id=${q(from)} AND sleep_id IS NOT NULL${mine};
      INSERT INTO meta(key,value) SELECT ${q(`moved:${from}`)},${q(to)} WHERE 1${mine} ON CONFLICT(key) DO UPDATE SET value=excluded.value;DELETE FROM meta WHERE key=${q(`replacing:${from}`)}${mine};COMMIT;`);
  }
  async replacement(from) { return (await this.read(`SELECT value FROM meta WHERE key=${q(`moved:${from}`)};`))[0]?.value ?? null; }
  // One window at a time makes the space in place of a gone one: true when
  // this one (`token`) may (no other is at it, or the other stopped long ago).
  replacing(from, token, now = Date.now()) {
    return this.held(`INSERT INTO meta(key,value) VALUES(${q(`replacing:${from}`)},${q(`${token}|${now}`)})
      ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(substr(meta.value, instr(meta.value,'|')+1) AS INTEGER) < ${n(now - STALE_MS)} RETURNING key;`);
  }
  unreplacing(from, token) { return this.run(`DELETE FROM meta WHERE key=${q(`replacing:${from}`)} AND value LIKE ${q(`${token}|%`)};`); }

  // ---- Agents seen now: { conversation, terminal, given (the name you gave
  // it), title, said, program, cwd, space, tab, pos, status, since }, only
  // those whose conversation is known. The name you gave it is what its
  // terminal says now (none: the automatic one again), unless a wake could
  // not put it back there yet (`restore`): then it is kept. A sighting older
  // than what is kept never overwrites it, and an asleep agent is not
  // changed by one. One not seen for GONE_MS (and not asleep) is gone.
  observe(agents, now = Date.now()) {
    const rows = agents.filter((a) => a.conversation).map((a) => `INSERT INTO agents(id,name,title,said,program,cwd,space_id,tab_id,pos,terminal,status,since,seen)
      VALUES(${q(a.conversation)},${q(a.given)},${q(a.title)},${n(a.said)},${q(a.program)},${q(a.cwd)},${q(a.space)},${q(a.tab)},${n(a.pos)},${q(a.terminal)},${q(a.status || "unknown")},${n(a.since)},${n(now)})
      ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.name IS NULL AND restore IS NOT NULL THEN name ELSE excluded.name END,
        restore=CASE WHEN excluded.name IS NOT NULL THEN NULL ELSE restore END,title=COALESCE(excluded.title,title),said=COALESCE(excluded.said,said),program=COALESCE(excluded.program,program),
        cwd=excluded.cwd,space_id=excluded.space_id,tab_id=excluded.tab_id,pos=excluded.pos,terminal=excluded.terminal,status=excluded.status,since=excluded.since,seen=excluded.seen
      WHERE sleep_id IS NULL AND excluded.seen >= seen;`);
    return this.run(`BEGIN;${rows.join("")}UPDATE agents SET status='gone',terminal=NULL WHERE sleep_id IS NULL AND status!='gone' AND seen < ${n(now - GONE_MS)};COMMIT;`);
  }
  // A name a wake could not put back on the agent's new terminal: kept, and
  // put back by the sidebar when it can (observe clears it once it is there).
  toRestore(conversation, name) { return this.run(`UPDATE agents SET restore=${q(name)} WHERE id=${q(conversation)};`); }
  // The name you gave an agent, kept with it (Rename).
  rename(conversation, name) { return this.run(`UPDATE agents SET name=${q(name)} WHERE id=${q(conversation)};`); }
  // The agents seen lately, and every one a person moved to a project
  // (kept while it is away, so it comes back where it was put).
  agents() { return this.read("SELECT * FROM agents WHERE status!='gone' OR project IS NOT NULL;"); }
  // The project an agent works on (a space's id), set by a person: kept
  // with the agent (its conversation, or its terminal's own id), whatever
  // space its terminal is in; null: the space it is in. A sighting never
  // changes it.
  setProject(id, project, now = Date.now()) {
    return this.run(`INSERT INTO agents(id,status,seen,project) VALUES(${q(id)},'unknown',${n(now)},${q(project)})
      ON CONFLICT(id) DO UPDATE SET project=excluded.project;`);
  }

  // ---- Sleep, a status: the sleep's row (every pane: `layout`, each with
  // the name it showed) and each of its agents (`agents`: { conversation,
  // given: the name you gave it, read from its terminal now; cwd, tab,
  // pos }) asleep, in
  // the space it slept in. Its token holds the row until it settles. Throws
  // when a tab of that name sleeps there already, or an agent of it is
  // asleep in another sleep.
  async sleepTab({ name, space, project, layout, into = null, agents, saved = Date.now(), now = Date.now() }) {
    const id = newId(), token = newId();
    const marks = agents.filter((a) => a.conversation).map((a) => `INSERT INTO agents(id,name,cwd,space_id,tab_id,pos,status,seen,sleep_id)
      VALUES(${q(a.conversation)},${q(a.given)},${q(a.cwd)},${q(space?.id)},${q(a.tab)},${n(a.pos)},'asleep',${n(saved)},${q(id)})
      ON CONFLICT(id) DO UPDATE SET status='asleep',sleep_id=excluded.sleep_id,terminal=NULL,seen=excluded.seen,space_id=excluded.space_id,name=excluded.name,
        tab_id=COALESCE(excluded.tab_id,tab_id),pos=COALESCE(excluded.pos,pos),cwd=COALESCE(excluded.cwd,cwd);`);
    await this.run(`BEGIN IMMEDIATE;INSERT INTO sleeps(id,name,space_id,space_name,project,layout,into_tab,saved,pending,pending_at)
      VALUES(${q(id)},${q(name)},${q(space?.id)},${q(space?.name)},${q(project)},${q(JSON.stringify(layout))},${q(into && JSON.stringify(into))},${n(saved)},${q(token)},${n(now)});${marks.join("")}COMMIT;`)
      .catch((e) => { throw new Error(/UNIQUE/.test(e.message) ? `a tab named ${name} is already asleep in this project` : e.message); });
    return { id, token };
  }
  // The sleep still holds its row (renewed while its agents leave), or not:
  // then it changes nothing more, its agents included.
  holdSleep(id, token, now = Date.now()) { return this.held(`UPDATE sleeps SET pending_at=${n(now)} WHERE id=${q(id)} AND pending=${q(token)} AND waking IS NULL RETURNING id;`); }
  // The sleep is done: its agents have left. False when it no longer held the row.
  settle(id, token) { return this.held(`UPDATE sleeps SET pending=NULL,pending_at=NULL WHERE id=${q(id)} AND pending=${q(token)} AND waking IS NULL RETURNING id;`); }
  // A sleep given up (its agents came back): its row goes, its agents are awake again.
  drop(id, token) {
    const mine = `id=${q(id)} AND pending=${q(token)} AND waking IS NULL`;
    return this.held(`BEGIN;UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }

  // ---- Wake: one window at a time holds the row (its token, renewed while it
  // works); the row as it is now, or null when another holds it or it is gone.
  // A sleep that stopped half way loses its token here, for good (its
  // `pending_at` stays, so the wake knows to look for agents of it still
  // running): it can never act on the row again.
  async claim(id, now = Date.now()) {
    const token = newId();
    const [row] = await this.run(`UPDATE sleeps SET waking=${q(token)},waking_at=${n(now)},pending=NULL WHERE id=${q(id)} AND ${free("pending", now)} AND ${free("waking", now)} RETURNING *;`);
    return row ? { ...row, token } : null;
  }
  renew(id, token, now = Date.now()) { return this.held(`UPDATE sleeps SET waking_at=${n(now)} WHERE id=${q(id)} AND waking=${q(token)} RETURNING id;`); }
  release(id, token) { return this.held(`UPDATE sleeps SET waking=NULL,waking_at=NULL WHERE id=${q(id)} AND waking=${q(token)} RETURNING id;`); }
  // Awake: its agents take the status they are seen with, the row goes.
  // `restores`: [conversation, name] its terminal could not be given yet,
  // kept in the same write so the name is never lost in between.
  woke(id, token, restores = []) {
    const mine = `id=${q(id)} AND waking=${q(token)}`;
    return this.held(`BEGIN;${restoreSql(restores, mine)}UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }
  // Part of it stays asleep: the panes kept (`layout`), the agents kept
  // (`keep`: conversations); the others are awake. `hold`: the sleep's
  // ({ sleep: token }) or the wake's ({ wake: token }); it is let go after,
  // unless `wait` (one may still be starting: not offered to wake until that
  // would have long settled). `space`: where it is now.
  narrow(id, layout, keep, hold, { space = null, wait = false, restores = [], now = Date.now() } = {}) {
    const mine = hold.wake ? `id=${q(id)} AND waking=${q(hold.wake)}` : `id=${q(id)} AND pending=${q(hold.sleep)} AND waking IS NULL`;
    const after = wait ? `pending=${q(hold.wake ?? hold.sleep)},pending_at=${n(now)},waking=NULL,waking_at=NULL` : hold.wake ? "waking=NULL,waking_at=NULL,pending=NULL,pending_at=NULL" : "pending=NULL,pending_at=NULL";
    return this.held(`BEGIN;${restoreSql(restores, mine)}UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND ${notIn("id", keep)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      ${space ? `UPDATE agents SET space_id=${q(space)} WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});` : ""}
      UPDATE sleeps SET layout=${q(JSON.stringify(layout))},${space ? `space_id=${q(space)},` : ""}${after} WHERE ${mine} RETURNING id;COMMIT;`);
  }
  // Forgotten by hand, unless a wake holds it: its agents are gone.
  forget(id, now = Date.now()) {
    const mine = `id=${q(id)} AND ${free("waking", now)}`;
    return this.held(`BEGIN;UPDATE agents SET status='gone',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }

  // What sleeps: each row with its agents as the left nav keeps them.
  async sleeps() {
    await this.open();
    const [rows, agents] = [await this.sql("SELECT * FROM sleeps;"), await this.sql("SELECT * FROM agents WHERE sleep_id IS NOT NULL;")];
    return rows.map((r) => ({ ...r, agents: agents.filter((a) => a.sleep_id === r.id) }));
  }

  // ---- Prefs.
  prefs() { return this.read("SELECT key, value FROM prefs;"); }
  setPref(key, value) { return this.run(`INSERT INTO prefs(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`); }
}
