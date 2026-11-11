import { sqliteApi } from "./platform-sqlite.js";
import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Kanso's one database, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Agents are keyed by conversation: a terminal's address is reused, and a wake gives it a new one.
// Every change that needs to hold the row says whether it did, so a window that lost it never acts as if it had.
import { exec, appHome } from "herdr";
import { mapSeries, parseOr } from "./pure.js";

export const DIR = "data/kanso";
export const VERSION = 1;
export const STALE_MS = 10 * 60_000; // a wake's hold not renewed this long stopped half way
export const ABANDON_MS = 3 * 60_000; // a sleep's: it renews its hold before each agent leaves, and one leaves in under a minute
export const GONE_MS = 60_000; // an agent not seen this long, and not asleep, is gone
export const LEASE_MS = 20_000; // a sleep's owner (sleepwork.js) not heard from this long is gone: another window takes the row

export const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n = (x) => (x != null && Number.isFinite(Number(x)) ? String(Math.round(Number(x))) : "NULL");
// `col` not among `xs` (always true for none; `NOT IN (NULL)` would be never).
const notIn = (col, xs) => (xs.length ? `${col} NOT IN (${xs.map(q).join(",")})` : "1");
export const pruneSinceSql = (now, { cap, keepMs }) => `DELETE FROM since_events WHERE at < ${n(now - keepMs)} OR id NOT IN (SELECT id FROM since_events ORDER BY id DESC LIMIT ${n(cap)});
  DELETE FROM since_observed WHERE at < ${n(now - keepMs)};`;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export const projectKey = (w, home = "") => `${w?.machine ?? ""}:${w?.folder || home}`;
// A conversation's id from its file (Claude's <id>.jsonl, Codex's rollout-…-<id>.jsonl).
export const conversationOf = (file) => String(file ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? null;

// Columns added after a table's first release: [table, name, type].
const ADDED = [["agents", "project", "TEXT"], ["agents", "project_at", "INTEGER"], ["agents", "step", "TEXT"], ["agents", "step_at", "INTEGER"],
  ["agents", "sent_at", "INTEGER"], ["agents", "nudged_at", "INTEGER"], ["agents", "why", "TEXT"], ["sleeps", "state", "TEXT"], ["sleeps", "why", "TEXT"],
  ["picture_scans", "mark", "TEXT"]];
// A sleep the sidebar works on: sleeping or undoing (held by its owner), stuck (waiting on you). NULL or asleep: done.
const DONE = "(state IS NULL OR state='asleep')";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, machine TEXT, seen INTEGER NOT NULL, gone INTEGER);
CREATE TABLE IF NOT EXISTS sleeps(id TEXT PRIMARY KEY, name TEXT NOT NULL, space_id TEXT, space_name TEXT, project TEXT NOT NULL, layout TEXT NOT NULL,
  into_tab TEXT, saved INTEGER NOT NULL, pending TEXT, pending_at INTEGER, waking TEXT, waking_at INTEGER, state TEXT, why TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS sleeps_name ON sleeps(project, name);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, program TEXT, cwd TEXT, space_id TEXT, tab_id TEXT, pos INTEGER,
  terminal TEXT, status TEXT NOT NULL DEFAULT 'unknown', since INTEGER, seen INTEGER NOT NULL, sleep_id TEXT, restore TEXT, project TEXT, project_at INTEGER,
  step TEXT, step_at INTEGER, sent_at INTEGER, nudged_at INTEGER, why TEXT);
CREATE INDEX IF NOT EXISTS agents_space ON agents(space_id, status);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT NOT NULL, machine TEXT NOT NULL DEFAULT '', added INTEGER NOT NULL, removed INTEGER, agent TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS projects_place ON projects(machine, folder);
CREATE TABLE IF NOT EXISTS picture_scans(file TEXT PRIMARY KEY, size INTEGER NOT NULL, mark TEXT);
CREATE TABLE IF NOT EXISTS pictures(file TEXT NOT NULL, path TEXT NOT NULL, ord INTEGER NOT NULL, color TEXT, there INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(file, path));
CREATE INDEX IF NOT EXISTS pictures_ord ON pictures(file, ord);
CREATE TABLE IF NOT EXISTS pr_providers(provider TEXT NOT NULL, host TEXT NOT NULL, login TEXT, status TEXT NOT NULL, detail TEXT, checked_at INTEGER NOT NULL, PRIMARY KEY(provider, host));
CREATE TABLE IF NOT EXISTS pr_repos(id TEXT PRIMARY KEY, provider TEXT NOT NULL, host TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, project_id TEXT, folder TEXT, machine TEXT, remote TEXT, seen_at INTEGER);
CREATE INDEX IF NOT EXISTS pr_repos_project ON pr_repos(project_id);
CREATE TABLE IF NOT EXISTS pr_items(url TEXT PRIMARY KEY, provider TEXT NOT NULL, host TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, state TEXT, draft INTEGER NOT NULL DEFAULT 0, author TEXT, role TEXT NOT NULL, head TEXT, base TEXT, review_decision TEXT, additions INTEGER, deletions INTEGER, updated_at TEXT, fetched_at INTEGER NOT NULL, seen_at INTEGER);
CREATE INDEX IF NOT EXISTS pr_items_repo ON pr_items(provider, host, owner, name);
CREATE TABLE IF NOT EXISTS pr_fetches(key TEXT PRIMARY KEY, fetched_at INTEGER, retry_at INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS since_focus(project TEXT PRIMARY KEY, focused_at INTEGER NOT NULL, pending_json TEXT, dismissed_to INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS since_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS since_events_project ON since_events(project, id);
CREATE TABLE IF NOT EXISTS since_observed(source TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS panel_state(project TEXT NOT NULL, panel TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(project, panel));
CREATE TABLE IF NOT EXISTS machines_off(name TEXT PRIMARY KEY, target TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT '', session TEXT NOT NULL DEFAULT '', temporary INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO meta(key,value) VALUES('version','${VERSION}');`;
// Kept on its own: the trigger body has its own ";".
// hc once stored the words false and null for a plain ssh machine.
const CLEAN_OFF = `UPDATE machines_off SET via=CASE WHEN via IN ('false','null') THEN '' ELSE via END, session=CASE WHEN session IN ('false','null') THEN '' ELSE session END WHERE via IN ('false','null') OR session IN ('false','null');`;

export const ONE_SLEEP = `CREATE TRIGGER IF NOT EXISTS agents_one_sleep BEFORE UPDATE OF sleep_id ON agents
  WHEN OLD.sleep_id IS NOT NULL AND NEW.sleep_id IS NOT NULL AND OLD.sleep_id != NEW.sleep_id
  BEGIN SELECT RAISE(ABORT, 'that agent is already asleep'); END;`;

export function statements(text) {
  if (Array.isArray(text)) return text;
  const { out, cur } = [...text].reduce(({ out, cur, quoted }, ch) => {
    const inside = ch === "'" ? !quoted : quoted;
    const next = cur + ch;
    if (ch !== ";" || inside) return { out, cur: next, quoted: inside };
    return { out: next.trim() !== ";" ? [...out, next.trim()] : out, cur: "", quoted: inside };
  }, { out: [], cur: "", quoted: false });
  return cur.trim() ? [...out, cur.trim()] : out;
}

// sqlite3 -json prints one array per statement; a raw newline never appears inside JSON, so "]\n[" only parts them.
export const rowsOfOutput = (out) => (out.trim() ? JSON.parse(`[${out.trim().replace(/\r\n?/g, "\n").replace(/\]\n\[/g, "],[")}]`).flat() : []);

// By id only: a space of the same folder and name may have stood beside it; pre-id rows match only when exactly one fits.
export function spaceFor(place, spaces, home = "") {
  if (place.spaceId) return spaces.find((w) => w.id === place.spaceId) ?? null;
  const same = spaces.filter((w) => projectKey(w, home) === place.project);
  const named = place.spaceName ? same.filter((w) => w.name === place.spaceName) : same;
  return named.length === 1 ? named[0] : null;
}

export function inPlace(a, place, spaces, home = "") {
  const w = spaceFor({ spaceId: a.spaceId, spaceName: a.space, project: a.from }, spaces, home);
  return place.space ? w?.id === place.space : !w && a.from === place.from;
}

const STEP_FIELDS = ["step", "step_at", "sent_at", "nudged_at", "why", "title", "cwd", "program"];
const CLEAR_STEP = "step=NULL,step_at=NULL,sent_at=NULL,nudged_at=NULL,why=NULL";
const restoreSql = (restores, mine) => restores.map(([c, name]) => `UPDATE agents SET restore=${q(name)} WHERE id=${q(c)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});`).join("");

const free = (col, now) => `(${col} IS NULL OR ${col}_at IS NULL OR ${col}_at < ${n(now - STALE_MS)})`;
// The same, read: a token renewed within STALE_MS holds the row.
export const isHeld = (token, at, now, within = STALE_MS) => token != null && at != null && at >= now - within;

// A sleep's layout without the panes of these conversations; a column left empty goes, the rest share its width.
export function layoutWithout(layout, ids) {
  const cols = (layout?.cols ?? []).map((c) => ({ ...c, panes: (c.panes ?? []).filter((p) => !ids.includes(p.resume)) })).filter((c) => c.panes.length);
  const total = cols.reduce((sum, c) => sum + (Number(c.w) || 0), 0);
  return { ...layout, cols: cols.map((c) => ({ ...c, w: total > 0 ? (Number(c.w) || 0) / total : 1 / cols.length })) };
}

const CACHE_MS = 30_000;
// Files whose schema is in place. Plain values only: a view's queue and cache die with the view.
class Schemas {
  constructor() { this.files = new Set(); }
  has(file) { return this.files.has(file); }
  made(file) { this.files.add(file); }
}
const schemas = new Schemas();

export class Kdb {
  constructor(dir = paths.join(appHome(), DIR)) {
    this.dir = dir;
    this.file = paths.join(dir, "kanso.db");
    this.ready = null;
    this.chain = Promise.resolve();
    this.queue = [];
    this.cache = new Map();
    this.cachedAt = Date.now();
  }

  execute(text) {
    return localService(sqliteApi).unchecked(this.file, statements(text), { json: true });
  }

  async sql(text) {
    const r = await this.execute(text);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return rowsOfOutput(r.stdout);
  }

  // Ready once per file; a failure is tried again on the next call, never kept.
  open() {
    return (this.ready ??= schemas.has(this.file) ? Promise.resolve() : this.create().then(() => schemas.made(this.file), (e) => { this.ready = null; throw e; }));
  }

  async create() {
    const ok = await exec("sqlite3", ["-version"]).catch(() => null);
    if (ok?.code !== 0) throw new Error("Install sqlite3 to keep the sidebar's state.");
    await localService(fileApi).mkdir(this.dir);
    await this.sql([...statements(SCHEMA), ONE_SLEEP]);
    // CREATE TABLE IF NOT EXISTS leaves an older table as it was, so later columns are added here.
    const has = { agents: (await this.sql("PRAGMA table_info(agents);")).map((c) => c.name), sleeps: (await this.sql("PRAGMA table_info(sleeps);")).map((c) => c.name), picture_scans: (await this.sql("PRAGMA table_info(picture_scans);")).map((c) => c.name) };
    const missing = ADDED.filter(([table, name]) => !has[table].includes(name));
    if (missing.length) await this.sql(missing.map(([table, name, type]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${type};`).join(""));
  }

  enqueue(text) {
    return new Promise((resolve, reject) => {
      this.queue = [...this.queue, { text, resolve, reject }];
      if (this.queue.length === 1) Promise.resolve().then(() => this.flush());
    });
  }

  flush() {
    const batch = this.queue;
    this.queue = [];
    const work = () => this.sendBatch(batch);
    this.chain = this.chain.then(work, work);
  }

  async sendBatch(batch) {
    const marker = `kanso-${newId()}`;
    try {
      const text = batch.flatMap((call, i) => [...statements(call.text), `.print ${marker}:${i}`]);
      const result = await this.execute(text);
      const chunks = String(result.stdout ?? "").split(new RegExp(`^${marker}:[0-9]+\\r?$`, "gm"));
      const completed = chunks.length - 1;
      chunks.slice(0, completed).forEach((chunk, i) => batch[i].resolve(rowsOfOutput(chunk)));
      if (completed === batch.length) return;
      batch[completed].reject(new Error((result.stderr || "sqlite3 failed").trim().split("\n")[0]));
      if (completed + 1 < batch.length) await this.sendBatch(batch.slice(completed + 1));
    } catch (error) { for (const call of batch) call.reject(error); }
  }

  // Drops a call the host lost, so later calls start afresh instead of waiting behind it.
  abandon() {
    this.ready = null;
    this.queue = [];
    this.chain = Promise.resolve();
    this.invalidate();
  }

  invalidate() {
    this.cache.clear();
    this.cachedAt = Date.now();
  }

  run(text) {
    if (/\b(?:prefs|panel_state)\b/i.test(Array.isArray(text) ? text.join(" ") : text)) this.invalidate();
    return this.read(text);
  }
  async held(text) { return (await this.run(text)).length > 0; }
  async read(text) { await this.open(); return this.enqueue(text); }

  async cached(text) {
    if (Date.now() - this.cachedAt >= CACHE_MS) this.invalidate();
    if (!this.cache.has(text)) {
      const result = this.read(text).catch((error) => { if (this.cache.get(text) === result) this.cache.delete(text); throw error; });
      this.cache.set(text, result);
    }
    return (await this.cache.get(text)).map((row) => ({ ...row }));
  }

  // Enough to add a remote machine back. hc machine rm forgets it here; its terminals keep running there.
  machinesOff() {
    return this.run(CLEAN_OFF).then(() => this.read("SELECT name, target, via, session, temporary FROM machines_off ORDER BY name;")).then((rows) => rows.map((row) => ({
      name: row.name, target: row.target ?? "", via: row.via ?? "", session: row.session ?? "", temporary: Boolean(row.temporary),
    })));
  }
  parkMachine(row) {
    const temporary = row.temporary ? 1 : 0;
    return this.run(`INSERT INTO machines_off(name,target,via,session,temporary) VALUES(${q(row.name)},${q(row.target ?? "")},${q(row.via ?? "")},${q(row.session ?? "")},${temporary})
      ON CONFLICT(name) DO UPDATE SET target=excluded.target,via=excluded.via,session=excluded.session,temporary=excluded.temporary;`);
  }
  forgetMachine(name) { return this.run(`DELETE FROM machines_off WHERE name=${q(name)};`); }

  // The migrated marker is checked inside the write lock by every statement, so two windows never both take the old data in.
  migrate({ sleeps = [], prefs = [] } = {}) {
    const todo = "NOT EXISTS(SELECT 1 FROM meta WHERE key='migrated')";
    const prefRows = prefs.map((p) => `INSERT OR IGNORE INTO prefs(key,value) SELECT ${q(p.key)},${q(p.value)} WHERE ${todo};`);
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

  // A space no longer listed is marked gone, never deleted: what sleeps in it still finds its way back.
  syncSpaces(spaces, now = Date.now()) {
    const rows = spaces.map((w) => `INSERT INTO spaces(id,name,folder,machine,seen,gone) VALUES(${q(w.id)},${q(w.name)},${q(w.folder)},${q(w.machine)},${n(now)},NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,folder=excluded.folder,machine=excluded.machine,seen=excluded.seen,gone=NULL;`);
    return this.run(`BEGIN;${rows.join("")}UPDATE spaces SET gone=${n(now)} WHERE gone IS NULL AND ${notIn("id", spaces.map((w) => w.id))};COMMIT;`);
  }
  adoptSpaces(found) {
    const rows = found.map(({ sleep, space }) => `UPDATE sleeps SET space_id=${q(space)} WHERE id=${q(sleep)} AND space_id IS NULL;
      UPDATE agents SET space_id=${q(space)} WHERE sleep_id=${q(sleep)} AND space_id IS NULL;`);
    return rows.length ? this.run(`BEGIN;${rows.join("")}COMMIT;`) : Promise.resolve([]);
  }

  // Records the replacement so a wake still holding the old id finds the new space.
  moveSpace(from, to, token = null) {
    const mine = token ? ` AND EXISTS(SELECT 1 FROM meta WHERE key=${q(`replacing:${from}`)} AND value LIKE ${q(`${token}|%`)})` : "";
    return this.run(`BEGIN;UPDATE sleeps SET space_id=${q(to)} WHERE space_id=${q(from)}${mine};UPDATE agents SET space_id=${q(to)} WHERE space_id=${q(from)} AND sleep_id IS NOT NULL${mine};
      INSERT INTO meta(key,value) SELECT ${q(`moved:${from}`)},${q(to)} WHERE 1${mine} ON CONFLICT(key) DO UPDATE SET value=excluded.value;DELETE FROM meta WHERE key=${q(`replacing:${from}`)}${mine};COMMIT;`);
  }
  async replacement(from) { return (await this.read(`SELECT value FROM meta WHERE key=${q(`moved:${from}`)};`))[0]?.value ?? null; }
  // True only for the one window that may make the space in place of a gone one.
  replacing(from, token, now = Date.now()) {
    return this.held(`INSERT INTO meta(key,value) VALUES(${q(`replacing:${from}`)},${q(`${token}|${now}`)})
      ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(substr(meta.value, instr(meta.value,'|')+1) AS INTEGER) < ${n(now - STALE_MS)} RETURNING key;`);
  }
  unreplacing(from, token) { return this.run(`DELETE FROM meta WHERE key=${q(`replacing:${from}`)} AND value LIKE ${q(`${token}|%`)};`); }

  // A sighting older than what is kept never overwrites it, and an asleep agent is not changed by one.
  observe(agents, now = Date.now()) {
    const rows = agents.filter((a) => a.conversation).map((a) => `INSERT INTO agents(id,name,title,said,program,cwd,space_id,tab_id,pos,terminal,status,since,seen)
      VALUES(${q(a.conversation)},${q(a.given)},${q(a.title)},${n(a.said)},${q(a.program)},${q(a.cwd)},${q(a.space)},${q(a.tab)},${n(a.pos)},${q(a.terminal)},${q(a.status || "unknown")},${n(a.since)},${n(now)})
      ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.name IS NULL AND restore IS NOT NULL THEN name ELSE excluded.name END,
        restore=CASE WHEN excluded.name IS NOT NULL THEN NULL ELSE restore END,title=COALESCE(excluded.title,title),said=COALESCE(excluded.said,said),program=COALESCE(excluded.program,program),
        cwd=excluded.cwd,space_id=excluded.space_id,tab_id=excluded.tab_id,pos=excluded.pos,terminal=excluded.terminal,status=excluded.status,since=excluded.since,seen=excluded.seen
      WHERE sleep_id IS NULL AND excluded.seen >= seen;`);
    return this.run(`BEGIN;${rows.join("")}UPDATE agents SET status='gone',terminal=NULL WHERE sleep_id IS NULL AND status!='gone' AND seen < ${n(now - GONE_MS)};COMMIT;`);
  }
  // A name the wake could not put back on the new terminal yet; observe clears it once it is there.
  toRestore(conversation, name) { return this.run(`UPDATE agents SET restore=${q(name)} WHERE id=${q(conversation)};`); }
  rename(conversation, name) { return this.run(`UPDATE agents SET name=${q(name)} WHERE id=${q(conversation)};`); }
  // Every agent a person ever moved stays, even while away, so it comes back where it was put.
  agents() { return this.read("SELECT * FROM agents WHERE status!='gone' OR project_at IS NOT NULL;"); }
  // Set by a person; a sighting never changes it. `at`: the latest choice wins, a clearing too.
  setProject(id, project, at = Date.now()) {
    return this.run(`INSERT INTO agents(id,status,seen,project,project_at) VALUES(${q(id)},'unknown',${n(at)},${q(project)},${n(at)})
      ON CONFLICT(id) DO UPDATE SET project=excluded.project,project_at=excluded.project_at WHERE project_at IS NULL OR excluded.project_at >= project_at;`);
  }

  // Throws when a tab of that name sleeps there already, or an agent of it sleeps in another sleep.
  // `requested`: the sidebar does the work (sleepwork.js), and any window may take it; else the caller holds `token`.
  async sleepTab({ name, space, project, layout, into = null, agents, saved = Date.now(), now = Date.now(), requested = false }) {
    const id = newId(), token = newId();
    // An agent still held by a sleep that stopped half way (pending, not renewed for ABANDON_MS, no wake on it) is
    // let go first, so the tab can sleep now; that sleep keeps the rest under a token its window never had, or goes.
    const ids = agents.filter((a) => a.conversation).map((a) => q(a.conversation)).join(",") || "NULL";
    const gone = `state IS NULL AND pending IS NOT NULL AND pending_at < ${n(now - ABANDON_MS)} AND ${free("waking", now)}`;
    const letGo = `UPDATE sleeps SET pending=${q(newId())} WHERE ${gone} AND id IN (SELECT sleep_id FROM agents WHERE id IN (${ids}));
      UPDATE agents SET status='unknown',sleep_id=NULL WHERE id IN (${ids}) AND sleep_id IN (SELECT id FROM sleeps WHERE ${gone});
      DELETE FROM sleeps WHERE ${gone} AND NOT EXISTS(SELECT 1 FROM agents WHERE sleep_id=sleeps.id);`;
    const step = requested ? `'requested',${n(now)}` : "NULL,NULL";
    const marks = agents.filter((a) => a.conversation).map((a) => `INSERT INTO agents(id,name,cwd,space_id,tab_id,pos,status,seen,sleep_id,step,step_at)
      VALUES(${q(a.conversation)},${q(a.given)},${q(a.cwd)},${q(space?.id)},${q(a.tab)},${n(a.pos)},'asleep',${n(saved)},${q(id)},${step})
      ON CONFLICT(id) DO UPDATE SET status='asleep',sleep_id=excluded.sleep_id,terminal=NULL,seen=excluded.seen,space_id=excluded.space_id,name=excluded.name,
        tab_id=COALESCE(excluded.tab_id,tab_id),pos=COALESCE(excluded.pos,pos),cwd=COALESCE(excluded.cwd,cwd),step=excluded.step,step_at=excluded.step_at,sent_at=NULL,nudged_at=NULL,why=NULL;`);
    await this.run(`BEGIN IMMEDIATE;${letGo}INSERT INTO sleeps(id,name,space_id,space_name,project,layout,into_tab,saved,pending,pending_at,state)
      VALUES(${q(id)},${q(name)},${q(space?.id)},${q(space?.name)},${q(project)},${q(JSON.stringify(layout))},${q(into && JSON.stringify(into))},${n(saved)},${requested ? "NULL" : q(token)},${n(now)},${requested ? "'sleeping'" : "NULL"});${marks.join("")}COMMIT;`)
      .catch((e) => {
        throw new Error(/UNIQUE/.test(e.message) ? `a tab named ${name} is already asleep in this project`
          : /already asleep/.test(e.message) ? "an agent of it is already asleep in another sleep; if that one is stuck, retry or undo it from Asleep" : e.message);
      });
    return { id, token };
  }
  // False once the sleep no longer holds the row: then it changes nothing more, its agents included.
  holdSleep(id, token, now = Date.now()) { return this.held(`UPDATE sleeps SET pending_at=${n(now)} WHERE id=${q(id)} AND pending=${q(token)} AND waking IS NULL RETURNING id;`); }
  settle(id, token) { return this.held(`UPDATE sleeps SET pending=NULL,pending_at=NULL WHERE id=${q(id)} AND pending=${q(token)} AND waking IS NULL RETURNING id;`); }
  drop(id, token) {
    const mine = `id=${q(id)} AND pending=${q(token)} AND waking IS NULL`;
    return this.held(`BEGIN;UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }

  // A sleep that stopped half way loses its token here for good; its `pending_at` stays, so the wake looks for agents of it still running.
  async claim(id, now = Date.now()) {
    const token = newId();
    const [row] = await this.run(`UPDATE sleeps SET waking=${q(token)},waking_at=${n(now)},pending=NULL WHERE id=${q(id)} AND ${DONE} AND ${free("pending", now)} AND ${free("waking", now)} RETURNING *;`);
    return row ? { ...row, token } : null;
  }
  renew(id, token, now = Date.now()) { return this.held(`UPDATE sleeps SET waking_at=${n(now)} WHERE id=${q(id)} AND waking=${q(token)} RETURNING id;`); }
  release(id, token) { return this.held(`UPDATE sleeps SET waking=NULL,waking_at=NULL WHERE id=${q(id)} AND waking=${q(token)} RETURNING id;`); }
  // `restores` ride in the same write so a name is never lost in between.
  woke(id, token, restores = []) {
    const mine = `id=${q(id)} AND waking=${q(token)}`;
    return this.held(`BEGIN;${restoreSql(restores, mine)}UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }
  // `wait`: a pane may still be starting, so the sleep is not offered to wake until that would have long settled.
  narrow(id, layout, keep, hold, { space = null, wait = false, restores = [], now = Date.now() } = {}) {
    const mine = hold.wake ? `id=${q(id)} AND waking=${q(hold.wake)}` : `id=${q(id)} AND pending=${q(hold.sleep)} AND waking IS NULL`;
    const after = wait ? `pending=${q(hold.wake ?? hold.sleep)},pending_at=${n(now)},waking=NULL,waking_at=NULL` : hold.wake ? "waking=NULL,waking_at=NULL,pending=NULL,pending_at=NULL" : "pending=NULL,pending_at=NULL";
    return this.held(`BEGIN;${restoreSql(restores, mine)}UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(id)} AND ${notIn("id", keep)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      ${space ? `UPDATE agents SET space_id=${q(space)} WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});` : ""}
      UPDATE sleeps SET layout=${q(JSON.stringify(layout))},${space ? `space_id=${q(space)},` : ""}${after} WHERE ${mine} RETURNING id;COMMIT;`);
  }
  // Unless a wake holds it: its agents are then left alone.
  forget(id, now = Date.now()) {
    const mine = `id=${q(id)} AND (${DONE.slice(1, -1)} OR state='stuck') AND ${free("waking", now)}`;
    return this.held(`BEGIN;UPDATE agents SET status='gone',sleep_id=NULL WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;COMMIT;`);
  }

  // An agent of a sleep seen running again (resumed by hand, or before this Kanso) is awake:
  // the sleep lets it go, and ends once no agent of it is left asleep. A sleep or wake in progress
  // is left alone: its agents still run while it ends them. Only a process other than the one put
  // to sleep counts, except for a sleep that stopped half way (its window closed, say): its row is
  // still pending once no one has held it for STALE_MS, the process it meant to end still runs, and
  // the agent would otherwise stay "asleep" for good, so no tab with it could sleep again. A settled
  // sleep saw every agent leave, so a sighting of the old pid after it is a late one, never a wake.
  async awake(live, now = Date.now()) {
    const running = new Map(live.filter((a) => a.conversation && a.terminal && a.program && a.pid != null).map((a) => [a.conversation, a.pid]));
    if (!running.size) return [];
    const slept = (s) => new Map(parseOr(s.layout, { cols: [] }).cols?.flatMap((c) => c.panes ?? []).map((p) => [p.resume, p.pid]) ?? []);
    const held = (s) => isHeld(s.pending, s.pending_at, now, ABANDON_MS) || isHeld(s.waking, s.waking_at, now);
    const abandoned = (s) => s.pending != null && !held(s);
    const awakeIn = (s) => { const pids = slept(s); return s.agents.filter((a) => running.has(a.id) && (abandoned(s) || running.get(a.id) !== pids.get(a.id))).map((a) => a.id); };
    // A sleep the sidebar is working on (or stuck) is its own: its agents still run while they leave.
    const ours = (await this.sleeps()).filter((s) => (s.state == null || s.state === "asleep") && s.saved < now && !held(s) && awakeIn(s).length);
    return mapSeries(ours, async (s) => {
      const gone = awakeIn(s);
      const layout = layoutWithout(parseOr(s.layout, { cols: [] }), gone);
      // Only the layout read here is changed: another window that changed it first wins, and the next sighting looks again.
      // Freeing by the slept pid holds only while the row is the abandoned one read: a window that resumed
      // and settled the sleep meanwhile (pending NULL, every agent gone) keeps it, and the next sighting looks again.
      const same = abandoned(s) ? ` AND pending=${q(s.pending)} AND pending_at=${n(s.pending_at)}` : "";
      const mine = `id=${q(s.id)} AND ${DONE} AND layout=${q(s.layout)} AND saved < ${n(now)} AND ${free("pending", now)} AND ${free("waking", now)}${same}`;
      // An abandoned sleep let go of in part gets a token its window never had: back after all, it must not
      // end and settle what is no longer in the sleep. The time stays, so the sleep stays abandoned for the rest.
      const after = gone.length < s.agents.length && layout.cols.length
        ? `UPDATE sleeps SET layout=${q(JSON.stringify(layout))}${abandoned(s) ? `,pending=${q(newId())}` : ""} WHERE ${mine} RETURNING id;`
        : `DELETE FROM sleeps WHERE ${mine} RETURNING id;`;
      const freed = await this.held(`BEGIN;UPDATE agents SET status='unknown',sleep_id=NULL WHERE sleep_id=${q(s.id)} AND id IN (${gone.map(q).join(",")}) AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
        ${after}COMMIT;`);
      return freed ? s.id : null;
    }).then((ids) => ids.filter(Boolean));
  }

  // The sidebar's sleep work (sleepwork.js). Every write holds only while `me` owns the row in the state it was read in.
  holdWork(id, me, now = Date.now()) {
    return this.held(`UPDATE sleeps SET pending=${q(me)},pending_at=${n(now)} WHERE id=${q(id)} AND state IN ('sleeping','undoing') AND waking IS NULL
      AND (pending IS NULL OR pending=${q(me)} OR pending_at IS NULL OR pending_at < ${n(now - LEASE_MS)}) RETURNING id;`);
  }
  // True while `me` owns the row in `state`: checked right before an act that writes nothing first.
  stillMine(id, me, state, now = Date.now()) {
    return this.held(`UPDATE sleeps SET pending_at=${n(now)} WHERE id=${q(id)} AND pending=${q(me)} AND state=${q(state)} AND waking IS NULL RETURNING id;`);
  }
  // `from`: the agent's step as read; another window that moved it meanwhile wins.
  stepAgent(id, me, state, conversation, from, fields) {
    const set = Object.entries(fields).filter(([k]) => STEP_FIELDS.includes(k)).map(([k, v]) => `${k}=${typeof v === "number" ? n(v) : q(v)}`).join(",");
    return this.held(`UPDATE agents SET ${set} WHERE id=${q(conversation)} AND sleep_id=${q(id)} AND step IS ${q(from)}
      AND EXISTS(SELECT 1 FROM sleeps WHERE id=${q(id)} AND pending=${q(me)} AND state=${q(state)}) RETURNING id;`);
  }
  // Stuck lets go of the row: nothing moves until you retry or undo it (or the agent goes on its own).
  setWorkState(id, me, from, to, why = null, now = Date.now(), fact = null) {
    const event = this.sinceSleep(id, fact, `pending=${q(me)} AND state=${q(from)}`, now);
    const owner = to === "stuck" ? "pending=NULL,pending_at=NULL" : `pending_at=${n(now)}`;
    return this.held(`BEGIN;${event}UPDATE sleeps SET state=${q(to)},why=${q(why)},${owner} WHERE id=${q(id)} AND state=${q(from)} AND pending=${q(me)} RETURNING id;COMMIT;`);
  }
  // A stuck agent seen gone has left; once none is stuck the sleep goes on. True when it does.
  unstick(id, conversation = null, now = Date.now()) {
    const left = conversation ? `UPDATE agents SET step='left',why=NULL WHERE id=${q(conversation)} AND sleep_id=${q(id)} AND step='stuck'
      AND EXISTS(SELECT 1 FROM sleeps WHERE id=${q(id)} AND state='stuck');` : "";
    return this.held(`BEGIN;${left}UPDATE sleeps SET state='sleeping',why=NULL,pending=NULL,pending_at=${n(now)} WHERE id=${q(id)} AND state='stuck'
      AND NOT EXISTS(SELECT 1 FROM agents WHERE sleep_id=${q(id)} AND step='stuck') RETURNING id;COMMIT;`);
  }
  // sent_at stays: an /exit that went may still land, and an undo needs to know it went.
  retry(id, now = Date.now()) {
    return this.held(`BEGIN;UPDATE agents SET step='saving',step_at=${n(now)},nudged_at=NULL,why=NULL WHERE sleep_id=${q(id)} AND step='stuck'
      AND EXISTS(SELECT 1 FROM sleeps WHERE id=${q(id)} AND state='stuck');
      UPDATE sleeps SET state='sleeping',why=NULL,pending=NULL,pending_at=${n(now)} WHERE id=${q(id)} AND state='stuck' RETURNING id;COMMIT;`);
  }
  // From sleeping too: an owner mid-step then finds the state changed and does nothing more of the sleep.
  undo(id, now = Date.now()) {
    return this.held(`UPDATE sleeps SET state='undoing',why=NULL,pending_at=CASE WHEN pending IS NULL THEN ${n(now)} ELSE pending_at END
      WHERE id=${q(id)} AND state IN ('sleeping','stuck') AND waking IS NULL RETURNING id;`);
  }
  finishSleep(id, me, why = null, now = Date.now(), fact = null) {
    const mine = `id=${q(id)} AND pending=${q(me)} AND state='sleeping'`;
    return this.held(`BEGIN;${this.sinceSleep(id, fact, `pending=${q(me)} AND state='sleeping'`, now)}UPDATE agents SET ${CLEAR_STEP} WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      UPDATE sleeps SET state='asleep',why=${q(why)},pending=NULL,pending_at=NULL WHERE ${mine} RETURNING id;COMMIT;`);
  }
  sinceSleep(id, fact, guard, now) {
    if (!fact) return "";
    return `INSERT INTO since_events(project,target,kind,text,at) SELECT project,${q(fact.target)},${q(fact.kind)},name,${n(now)} FROM sleeps WHERE id=${q(id)} AND ${guard};${pruneSinceSql(now, fact)}`;
  }
  // An undo's agent that is back (or never left) is awake.
  freeAgent(id, me, conversation) {
    return this.held(`UPDATE agents SET status='unknown',sleep_id=NULL,${CLEAR_STEP} WHERE id=${q(conversation)} AND sleep_id=${q(id)}
      AND EXISTS(SELECT 1 FROM sleeps WHERE id=${q(id)} AND pending=${q(me)} AND state='undoing') RETURNING id;`);
  }
  // `layout`: what did not come back, asleep; null: all did, and the row goes.
  endUndo(id, me, layout) {
    const mine = `id=${q(id)} AND pending=${q(me)} AND state='undoing'`;
    const end = layout ? `UPDATE agents SET ${CLEAR_STEP} WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      UPDATE sleeps SET layout=${q(JSON.stringify(layout))},state='asleep',why=NULL,pending=NULL,pending_at=NULL WHERE ${mine} RETURNING id;`
      : `UPDATE agents SET status='unknown',sleep_id=NULL,${CLEAR_STEP} WHERE sleep_id=${q(id)} AND EXISTS(SELECT 1 FROM sleeps WHERE ${mine});
      DELETE FROM sleeps WHERE ${mine} RETURNING id;`;
    return this.held(`BEGIN;${end}COMMIT;`);
  }

  async sleeps(spaces = null, now = Date.now()) {
    const [, rows, agents] = await Promise.all([
      spaces ? this.syncSpaces(spaces, now) : Promise.resolve(),
      this.read("SELECT * FROM sleeps;"), this.read("SELECT * FROM agents WHERE sleep_id IS NOT NULL;"),
    ]);
    return rows.map((r) => ({ ...r, agents: agents.filter((a) => a.sleep_id === r.id) }));
  }

  // Projects you added stay when their last agent closes; removed ones are kept as removed, so no window brings them back.
  projects() { return this.read("SELECT * FROM projects WHERE removed IS NULL ORDER BY added, name;"); }
  // Once for every window: the spaces open when this came in (and the places that sleep) are your projects; home is not one.
  migrateProjects(places, now = Date.now()) {
    const todo = "NOT EXISTS(SELECT 1 FROM meta WHERE key='projects')";
    const rows = places.filter((p) => p.folder).map((p) => `INSERT OR IGNORE INTO projects(id,name,folder,machine,added) SELECT ${q(newId())},${q(p.name)},${q(p.folder)},${q(p.machine ?? "")},${n(now)} WHERE ${todo};`);
    return this.run(["BEGIN IMMEDIATE;", ...rows, `INSERT OR IGNORE INTO meta(key,value) VALUES('projects','${n(now)}');`, "COMMIT;"]);
  }
  // A place added again comes back (with its name) instead of standing twice; `existed`: it was there already.
  async addProject({ name, folder, machine = "" }, now = Date.now()) {
    const was = (await this.read(`SELECT * FROM projects WHERE machine=${q(machine)} AND folder=${q(folder)};`))[0] ?? null;
    const [row] = await this.run(`INSERT INTO projects(id,name,folder,machine,added) VALUES(${q(newId())},${q(name)},${q(folder)},${q(machine)},${n(now)})
      ON CONFLICT(machine,folder) DO UPDATE SET name=CASE WHEN projects.removed IS NULL THEN projects.name ELSE excluded.name END, removed=NULL RETURNING *;`);
    return { row, existed: Boolean(was && was.removed == null) };
  }
  removeProject(id, now = Date.now()) { return this.held(`UPDATE projects SET removed=${n(now)} WHERE id=${q(id)} AND removed IS NULL RETURNING id;`); }
  // Throws when another project is already there.
  relocateProject(id, folder) {
    // A project you removed from there does not hold the place.
    return this.run(`BEGIN;DELETE FROM projects WHERE removed IS NOT NULL AND folder=${q(folder)} AND machine=(SELECT machine FROM projects WHERE id=${q(id)});
      UPDATE projects SET folder=${q(folder)} WHERE id=${q(id)};COMMIT;`)
      .catch((e) => { throw new Error(/UNIQUE/.test(e.message) ? "That folder is already a project." : e.message); });
  }
  setProjectAgent(id, agent) { return this.run(`UPDATE projects SET agent=${q(agent)} WHERE id=${q(id)};`); }

  prefs() { return this.cached("SELECT key, value FROM prefs;"); }
  setPref(key, value) { return this.run(`INSERT INTO prefs(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`); }

  // Images keeps what a transcript already said, so the next read starts at `size`. `mark` is the cksum of those bytes.
  async pictures(file) {
    const scan = (await this.read(`SELECT size, mark FROM picture_scans WHERE file=${q(file)};`))[0];
    const rows = await this.read(`SELECT path, ord, color, there FROM pictures WHERE file=${q(file)} ORDER BY ord;`);
    return { size: scan ? String(scan.size) : "0", mark: scan?.mark ?? "", rows };
  }
  savePictures(file, size, rows, mark = null) {
    const drop = notIn("path", rows.map((r) => r.path));
    const writes = rows.map((r) => `INSERT INTO pictures(file,path,ord,color,there) VALUES(${q(file)},${q(r.path)},${n(r.ord)},${q(r.color)},1)
      ON CONFLICT(file,path) DO UPDATE SET ord=excluded.ord,there=1,color=COALESCE(pictures.color,excluded.color);`).join("");
    return this.run(`BEGIN;DELETE FROM pictures WHERE file=${q(file)} AND ${drop};${writes}INSERT INTO picture_scans(file,size,mark) VALUES(${q(file)},${n(size)},${q(mark)}) ON CONFLICT(file) DO UPDATE SET size=excluded.size, mark=excluded.mark;COMMIT;`);
  }
  setPictureColor(file, path, color) {
    return this.run(`UPDATE pictures SET color=${q(color)} WHERE file=${q(file)} AND path=${q(path)};`);
  }

  // One row per project and panel. No row reads as undefined; a closed panel is `{ id: null }`.
  async panelState(project, panel) {
    const rows = await this.cached(`SELECT state_json FROM panel_state WHERE project=${q(project)} AND panel=${q(panel)};`);
    if (!rows.length) return undefined;
    const parsed = parseOr(rows[0].state_json, null);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  }
  savePanelState(project, panel, state, now = Date.now()) {
    return this.run(`INSERT INTO panel_state(project,panel,state_json,updated_at) VALUES(${q(project)},${q(panel)},${q(JSON.stringify(state))},${n(now)})
      ON CONFLICT(project,panel) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at;`);
  }
  clearPanelState(project, panel) {
    return this.run(`DELETE FROM panel_state WHERE project=${q(project)} AND panel=${q(panel)};`);
  }
}
