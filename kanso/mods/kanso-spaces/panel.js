// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The sidebar's own state, in its own SQLite database
// (data/kanso-spaces/panel.db, through the sqlite3 command):
//   prefs   what you chose here: the view, each view's order, what is folded
//   agents  what it last knew of each agent: the name it showed (the same in
//           every view), its conversation's title and last message, its
//           space and its place in that space's list. An agent that sleeps
//           keeps both, so it stays where it was, by the same name.
// Read once at start. Each change is written as it happens, one at a time,
// in order. localStorage keeps a copy of the prefs only so the first frame
// after a start is already right (the database answers a moment later and
// is what counts).
import { exec, appHome } from "herdr";

export const PANEL_DIR = "data/kanso-spaces";
export const FORGET_MS = 14 * 24 * 3600_000; // an agent gone this long, and not asleep, is forgotten

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : "NULL");

export const SCHEMA = `CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents(address TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, space TEXT, project TEXT, at INTEGER, program TEXT, seen INTEGER NOT NULL);`;

// What is kept of an agent, by field, so a change is a change of these only.
export const AGENT_FIELDS = ["name", "title", "said", "space", "project", "at", "program"];
export const sameAgent = (x, y) => Boolean(x && y) && AGENT_FIELDS.every((f) => (x[f] ?? null) === (y[f] ?? null));

export function upsertSql(address, a, now) {
  return `INSERT INTO agents(address,name,title,said,space,project,at,program,seen) VALUES(${q(address)},${q(a.name)},${q(a.title)},${n(a.said)},${q(a.space)},${q(a.project)},${n(a.at)},${q(a.program)},${n(now)})
ON CONFLICT(address) DO UPDATE SET name=excluded.name,title=excluded.title,said=excluded.said,space=excluded.space,project=excluded.project,at=excluded.at,program=excluded.program,seen=excluded.seen;`;
}

export class Panel {
  // `seed`: the prefs' keys, read from localStorage for the first frame.
  constructor(seed = []) {
    this.db = `${appHome()}/${PANEL_DIR}/panel.db`;
    this.cache = new Map();
    this.agents = new Map(); // address -> { name, title, said, space, project, at, program, seen }
    this.chain = Promise.resolve();
    this.ready = null;
    for (const k of seed) { try { const v = localStorage.getItem(k); if (v != null) this.cache.set(k, v); } catch { /* not there */ } }
  }

  async sql(text, json = false) {
    const r = await exec("sqlite3", ["-cmd", ".timeout 5000", ...(json ? ["-json"] : []), this.db, text]);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return json ? (r.stdout.trim() ? JSON.parse(r.stdout) : []) : r.stdout;
  }

  open() {
    return (this.ready ??= (async () => {
      await exec("mkdir", ["-p", `${appHome()}/${PANEL_DIR}`]);
      await this.sql(SCHEMA);
    })());
  }

  // Each write after the one before, never in parallel; a failed one is let be.
  write(text) {
    this.chain = this.chain.then(() => this.open()).then(() => this.sql(text)).catch(() => {});
    return this.chain;
  }

  // The database's state into memory. The first time (no prefs yet), what
  // localStorage held moves in. True when a pref differs from the first frame's.
  async load() {
    await this.open();
    const [prefs, agents] = await Promise.all([this.sql("SELECT key, value FROM prefs;", true), this.sql("SELECT * FROM agents;", true)]);
    for (const r of agents) this.agents.set(r.address, { name: r.name, title: r.title, said: r.said, space: r.space, project: r.project, at: r.at, program: r.program, seen: r.seen });
    if (!prefs.length) {
      const rows = [...this.cache].map(([k, v]) => `INSERT OR REPLACE INTO prefs(key,value) VALUES(${q(k)},${q(v)});`);
      if (rows.length) await this.write(`BEGIN;${rows.join("")}COMMIT;`);
      return false;
    }
    let changed = false;
    for (const r of prefs) if (this.cache.get(r.key) !== r.value) { this.cache.set(r.key, r.value); changed = true; this.mirror(r.key, r.value); }
    return changed;
  }

  mirror(key, value) { try { localStorage.setItem(key, value); } catch { /* the database has it */ } }

  get(key) { return this.cache.get(key) ?? null; }
  // A JSON pref, when it is the same shape as `fallback`.
  json(key, fallback) {
    try {
      const v = JSON.parse(this.cache.get(key) ?? "null");
      return v !== null && typeof v === "object" && Array.isArray(v) === Array.isArray(fallback) ? v : fallback;
    } catch { return fallback; }
  }
  set(key, value) {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    this.mirror(key, v);
    this.write(`INSERT INTO prefs(key,value) VALUES(${q(key)},${q(v)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  }

  // What the sidebar sees of each agent now (address -> fields): the ones
  // that changed are written, all in one go.
  remember(seen, now = Date.now()) {
    const rows = [];
    for (const [address, a] of seen) {
      const was = this.agents.get(address);
      // Still the same: its `seen` moves on once an hour, not every look.
      if (sameAgent(was, a) && now - (was.seen ?? 0) < 3600_000) continue;
      this.agents.set(address, { ...a, seen: now });
      rows.push(upsertSql(address, a, now));
    }
    if (rows.length) this.write(`BEGIN;${rows.join("")}COMMIT;`);
  }

  // Agents gone for FORGET_MS that are not asleep (`keep`: addresses still needed).
  prune(keep, now = Date.now()) {
    const old = [...this.agents].filter(([address, a]) => !keep.has(address) && now - (a.seen ?? 0) > FORGET_MS).map(([address]) => address);
    if (!old.length) return;
    for (const address of old) this.agents.delete(address);
    this.write(`DELETE FROM agents WHERE address IN (${old.map(q).join(",")});`);
  }
}
