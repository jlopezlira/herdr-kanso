// hjkl dōjō, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { exec, appHome } from "herdr";
import { tryOrAsync } from "./pure.js";

export const STORE_DIR = "data/kanso-dojo";
const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);

export const SCHEMA = `CREATE TABLE IF NOT EXISTS rounds(
  at INTEGER NOT NULL, level INTEGER NOT NULL, score INTEGER NOT NULL,
  rings INTEGER NOT NULL, fewest INTEGER NOT NULL, streak INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export const roundSql = (r) => `INSERT INTO rounds(at,level,score,rings,fewest,streak) VALUES(${int(r.at)},${int(r.level)},${int(r.score)},${int(r.rings)},${int(r.fewest)},${int(r.streak)});`;

// `first` is in ms; `days` are "YYYY-MM-DD".
export function totalsOf(rows, days) {
  const sum = (rows ?? []).reduce((acc, r) => ({
    bests: { ...acc.bests, [r.level]: Math.max(acc.bests[r.level] ?? 0, Number(r.best) || 0) },
    rounds: acc.rounds + (Number(r.rounds) || 0),
    rings: acc.rings + (Number(r.rings) || 0),
    fewest: acc.fewest + (Number(r.fewest) || 0),
    longest: Math.max(acc.longest, Number(r.longest) || 0),
    first: r.first == null ? acc.first : acc.first == null ? Number(r.first) : Math.min(acc.first, Number(r.first)),
  }), { bests: {}, rounds: 0, rings: 0, fewest: 0, longest: 0, first: null });
  return { ...sum, days: (days ?? []).map((d) => d.day) };
}

export class Store {
  constructor() {
    this.db = `${appHome()}/${STORE_DIR}/dojo.db`;
    this.ready = null;
  }

  async sql(text, json = false) {
    const r = await exec("sqlite3", ["-cmd", ".timeout 5000", ...(json ? ["-json"] : []), this.db, text]);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return json ? (r.stdout.trim() ? JSON.parse(r.stdout) : []) : r.stdout;
  }

  open() {
    return (this.ready ??= (async () => {
      const ok = await tryOrAsync(() => exec("sqlite3", ["-version"])); // null: no sqlite3, below
      if (ok?.code !== 0) { this.ready = null; throw new Error("Install sqlite3 to keep your rounds."); }
      await exec("mkdir", ["-p", `${appHome()}/${STORE_DIR}`]);
      await this.sql(SCHEMA);
    })());
  }

  async add(round) { await this.open(); await this.sql(roundSql(round)); }

  async totals() {
    await this.open();
    const rows = await this.sql("SELECT level, MAX(score) AS best, COUNT(*) AS rounds, SUM(rings) AS rings, SUM(fewest) AS fewest, MAX(streak) AS longest, MIN(at) AS first FROM rounds GROUP BY level;", true);
    const days = await this.sql("SELECT DISTINCT date(at/1000,'unixepoch','localtime') AS day FROM rounds ORDER BY day;", true);
    return totalsOf(rows, days);
  }

  async level() {
    await this.open();
    const [r] = await this.sql("SELECT value FROM prefs WHERE key='level';", true);
    return r ? Number(r.value) || 1 : 1;
  }
  async setLevel(n) { await this.open(); await this.sql(`INSERT OR REPLACE INTO prefs(key,value) VALUES('level','${int(n)}');`); }
}
