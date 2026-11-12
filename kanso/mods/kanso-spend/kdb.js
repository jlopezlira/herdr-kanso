import { paths, pathApi, appHomeDir } from "./platform-paths.js";
// Kanso's one database, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Agents are keyed by conversation: a terminal's address is reused.
// Every change that needs to hold the row says whether it did, so a window that lost it never acts as if it had.
import { appHome } from "herdr";
import { mapSeries, parseOr } from "./pure.js";
import { Database, lostCall } from "./platform-database.js";
import { sqliteLimit, CALL_MS } from "./platform-sqlite.js";
export { CALL_MS };

export const DIR = "data/kanso";
export const VERSION = 1;
export const GONE_MS = 60_000; // an agent not seen this long is gone
export const forgetAgentsSql = () => "DELETE FROM agents WHERE status='gone' AND project_at IS NULL;";
export const REST_MS = 60_000; // a remote database, while this window is in front and nothing was ordered

export const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n = (x) => (x != null && Number.isFinite(Number(x)) ? String(Math.round(Number(x))) : "NULL");
// `col` not among `xs` (always true for none; `NOT IN (NULL)` would be never).
const notIn = (col, xs) => (xs.length ? `${col} NOT IN (${xs.map(q).join(",")})` : "1");
export const pruneSinceSql = (now, { cap, keepMs }) => `DELETE FROM since_events WHERE at < ${n(now - keepMs)} OR id NOT IN (SELECT id FROM since_events ORDER BY id DESC LIMIT ${n(cap)});
  DELETE FROM since_observed WHERE at < ${n(now - keepMs)};`;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export const projectKey = (w, home = "") => `${w?.machine ?? ""}:${w?.folder || home}`;
// The other computer's default app home plus data/kanso. A custom HERDR_APP_HOME there is not followed.
export const kansoDir = (home, platform) => {
  const api = pathApi(platform === "windows" ? "windows" : "macos");
  return api.join(appHomeDir(platform, home), DIR);
};

// What this window calls a terminal ("light/t90") and what that computer stores ("t90").
export function seenAddress(local, machine) {
  if (local == null || local === "") return local ?? null;
  return machine ? `${machine}/${local}` : String(local);
}
export function localAddress(seen, machine) {
  if (seen == null || seen === "") return seen ?? null;
  const text = String(seen);
  if (!machine) return text.includes("/") ? null : text;
  const prefix = `${machine}/`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : null;
}
// Computers Herdr lists, plus any that still have a space open. The sidebar and the dialog both ask this list.
export function machinesToAsk(known, spaces) {
  const names = [...(known ?? []).map((row) => row?.name), ...(spaces ?? []).map((row) => row?.machine)];
  return [...new Set(names.filter(Boolean))];
}

// A remote database is read once when its spaces show, on this window's own order, and every minute in front.
export function restDue({ readAt = null, ordered = false, now = 0, active = false, showing = false } = {}) {
  if (!showing || (!ordered && !active)) return false;
  if (ordered || readAt == null) return true;
  return now - readAt >= REST_MS;
}
export function asOfText(at, now) {
  if (at == null) return null;
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 60) return `as of ${sec}s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `as of ${min} min` : `as of ${Math.round(min / 60)} h`;
}
// A conversation's id from its file (Claude's <id>.jsonl, Codex's rollout-…-<id>.jsonl).
export const conversationOf = (file) => String(file ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ?? null;

// Columns added after a table's first release: [table, name, type].
const ADDED = [["agents", "project", "TEXT"], ["agents", "project_at", "INTEGER"], ["picture_scans", "mark", "TEXT"], ["since_events", "did", "TEXT"]];
// What the old Sleep kept, dropped once: a sleep is now a label on its terminal.
const DROPPED = ["sleep_id", "restore", "step", "step_at", "sent_at", "nudged_at", "why"];
const DROP_SLEEPS = `DROP TRIGGER IF EXISTS agents_one_sleep;DROP TABLE IF EXISTS sleeps;DROP TABLE IF EXISTS spaces;
DELETE FROM since_events WHERE kind IN ('sleep_finished','sleep_failed');DELETE FROM meta WHERE key LIKE 'moved:%' OR key LIKE 'replacing:%';`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, program TEXT, cwd TEXT, space_id TEXT, tab_id TEXT, pos INTEGER,
  terminal TEXT, status TEXT NOT NULL DEFAULT 'unknown', since INTEGER, seen INTEGER NOT NULL, project TEXT, project_at INTEGER);
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
CREATE TABLE IF NOT EXISTS since_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, did TEXT);
CREATE INDEX IF NOT EXISTS since_events_project ON since_events(project, id);
CREATE TABLE IF NOT EXISTS since_observed(source TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS panel_state(project TEXT NOT NULL, panel TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(project, panel));
CREATE TABLE IF NOT EXISTS machines_off(name TEXT PRIMARY KEY, target TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT '', session TEXT NOT NULL DEFAULT '', temporary INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS computer_alias(route TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL, pending INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO meta(key,value) VALUES('version','${VERSION}');`;
// hc once stored the words false and null for a plain ssh machine.
const CLEAN_OFF = `UPDATE machines_off SET via=CASE WHEN via IN ('false','null') THEN '' ELSE via END, session=CASE WHEN session IN ('false','null') THEN '' ELSE session END WHERE via IN ('false','null') OR session IN ('false','null');`;

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

const CACHE_MS = 30_000;
// Files whose schema is in place. Plain values only: a view's queue and cache die with the view.
class Schemas {
  constructor() { this.files = new Set(); }
  has(file) { return this.files.has(file); }
  made(file) { this.files.add(file); }
}
const schemas = new Schemas();

export class Kdb extends Database {
  constructor(timer, dir = paths.join(appHome(), DIR), machine = null) {
    super(timer, paths.join(dir, "kanso.db"), machine || null);
    this.dir = dir;
    this.chain = Promise.resolve();
    this.queue = [];
    this.cache = new Map();
    this.cachedAt = Date.now();
  }

  get machine() { return this.on; }

  execute(text) { return super.execute(statements(text), { json: true }); }

  async sql(text) {
    const r = await this.bound(this.execute(text), sqliteLimit(text));
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return rowsOfOutput(r.stdout);
  }

  // Ready once per file; a failure is tried again on the next call, never kept.
  schemaKey() { return this.machine ? `${this.machine}\0${this.file}` : this.file; }

  open() {
    const key = this.schemaKey();
    if (this.ready) return this.ready;
    const pending = schemas.has(key) ? Promise.resolve() : this.create().then(() => schemas.made(key), (error) => {
      if (this.ready === pending) this.ready = null; // a newer open may already be in its place
      throw error;
    });
    this.ready = pending;
    return pending;
  }

  async create() {
    await this.prepare(this.dir, "Install sqlite3 to keep the sidebar's state.");
    await this.sql(["BEGIN;", ...statements(SCHEMA), "COMMIT;"]);
    // CREATE TABLE IF NOT EXISTS leaves an older table as it was, so later columns are added here.
    const has = Object.fromEntries(await mapSeries([...new Set(ADDED.map(([table]) => table))], async (table) => [table, (await this.sql(`PRAGMA table_info(${table});`)).map((c) => c.name)]));
    const missing = ADDED.filter(([table, name]) => !has[table].includes(name));
    const dropped = DROPPED.filter((name) => has.agents.includes(name));
    const changes = [...missing.map(([table, name, type]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${type};`), ...(dropped.length ? statements(DROP_SLEEPS) : []), ...dropped.map((name) => `ALTER TABLE agents DROP COLUMN ${name};`)];
    if (changes.length) await this.sql(["BEGIN;", ...changes, "COMMIT;"]);
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
    if (!batch.length) return;
    const epoch = this.epoch;
    const work = () => {
      if (epoch !== this.epoch) {
        for (const call of batch) call.reject(lostCall());
        return;
      }
      return this.sendBatch(batch);
    };
    this.chain = this.chain.then(work, work);
  }

  async sendBatch(batch) {
    const marker = `kanso-${newId()}`;
    try {
      const text = batch.flatMap((call, i) => [...statements(call.text), `.print ${marker}:${i}`]);
      const result = await this.bound(this.execute(text), sqliteLimit(text));
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
    const dropped = this.queue;
    super.abandon();
    this.queue = [];
    this.chain = Promise.resolve();
    this.invalidate();
    for (const call of dropped) call.reject(lostCall());
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
  migrate({ prefs = [] } = {}) {
    const todo = "NOT EXISTS(SELECT 1 FROM meta WHERE key='migrated')";
    const prefRows = prefs.map((p) => `INSERT OR IGNORE INTO prefs(key,value) SELECT ${q(p.key)},${q(p.value)} WHERE ${todo};`);
    return this.run(["BEGIN IMMEDIATE;", ...prefRows, `INSERT OR IGNORE INTO meta(key,value) VALUES('migrated','${Date.now()}');`, "COMMIT;"]);
  }
  async migrated() { return (await this.read("SELECT 1 AS x FROM meta WHERE key='migrated';")).length > 0; }

  // A sighting older than what is kept never overwrites it.
  observe(agents, now = Date.now()) {
    const rows = agents.filter((a) => a.conversation).map((a) => `INSERT INTO agents(id,name,title,said,program,cwd,space_id,tab_id,pos,terminal,status,since,seen)
      VALUES(${q(a.conversation)},${q(a.given)},${q(a.title)},${n(a.said)},${q(a.program)},${q(a.cwd)},${q(a.space)},${q(a.tab)},${n(a.pos)},${q(a.terminal)},${q(a.status || "unknown")},${n(a.since)},${n(now)})
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,title=COALESCE(excluded.title,title),said=COALESCE(excluded.said,said),program=COALESCE(excluded.program,program),
        cwd=excluded.cwd,space_id=excluded.space_id,tab_id=excluded.tab_id,pos=excluded.pos,terminal=excluded.terminal,status=excluded.status,since=excluded.since,seen=excluded.seen
      WHERE excluded.seen >= seen;`);
    return this.run(`BEGIN;${rows.join("")}UPDATE agents SET status='gone',terminal=NULL WHERE status!='gone' AND seen < ${n(now - GONE_MS)};${forgetAgentsSql()}COMMIT;`);
  }
  rename(conversation, name) { return this.run(`UPDATE agents SET name=${q(name)} WHERE id=${q(conversation)};`); }
  // Every agent a person ever moved stays, even while away, so it comes back where it was put.
  agents() { return this.read("SELECT * FROM agents WHERE status!='gone' OR project_at IS NOT NULL;"); }
  // Set by a person; a sighting never changes it. `at`: the latest choice wins, a clearing too.
  setProject(id, project, at = Date.now()) {
    return this.run(`INSERT INTO agents(id,status,seen,project,project_at) VALUES(${q(id)},'unknown',${n(at)},${q(project)},${n(at)})
      ON CONFLICT(id) DO UPDATE SET project=excluded.project,project_at=excluded.project_at WHERE project_at IS NULL OR excluded.project_at >= project_at;`);
  }

  // The writer's clock: a row ahead of it keeps its later time and takes this name.
  aliasSql(row, now) {
    const route = String(row?.route ?? "");
    const name = String(row?.name ?? "").trim();
    const at = Math.round(Number(row?.at) || 0);
    const pending = row?.pending ? 1 : 0;
    const writerNow = Math.round(Number(now) || 0);
    return `INSERT INTO computer_alias(route,name,at,pending) VALUES(${q(route)},${q(name)},${n(at)},${pending}) ON CONFLICT(route) DO UPDATE SET name=excluded.name,at=CASE WHEN computer_alias.at > excluded.at THEN computer_alias.at ELSE excluded.at END,pending=excluded.pending WHERE excluded.at >= computer_alias.at OR (computer_alias.at > ${n(writerNow)} AND excluded.at >= ${n(writerNow)}) RETURNING name,at,pending;`;
  }
  saveAlias(row, now = Date.now()) { return this.run(this.aliasSql(row, now)); }

  // `write`: alias rows to keep first, in the same sqlite3 call as the read, so a retry stays in this read's process.
  async aliases(write = [], now = Date.now()) {
    const sql = write.map((row) => this.aliasSql({ ...row, route: row.route ?? "" }, now)).join("");
    const [, rows] = await Promise.all([sql ? this.run(sql) : [], this.read("SELECT route, name, at, pending FROM computer_alias;")]);
    return rows;
  }

  // Projects you added stay when their last agent closes; removed ones are kept as removed, so no window brings them back.
  projects() { return this.read("SELECT * FROM projects WHERE removed IS NULL ORDER BY added, name;"); }
  // Once for every window: the spaces open when this came in are your projects; home is not one.
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
