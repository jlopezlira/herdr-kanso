// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Where sleeping tabs are kept: a local SQLite database
// (data/kanso-sleep/sleep.db, through the sqlite3 command), one row per tab,
// keyed by the project it sleeps in and its name. A row is written
// `pending` before its agents leave and settled once they have; a wake
// claims it (`waking`) so one window at a time wakes it.
import { exec, appHome } from "herdr";

export const STORE_DIR = "data/kanso-sleep";
const STALE_MS = 10 * 60_000; // a sleep or wake that long under way stopped half way

export const sqlText = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);

export const SCHEMA = `CREATE TABLE IF NOT EXISTS asleep(
  project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL,
  PRIMARY KEY(project, name));`;

// A tab's row: what it opens (columns, panes, each Claude agent's
// conversation) as JSON.
export function saveSql(project, a, replace = true) {
  const layout = JSON.stringify({ per: a.per ?? null, cols: a.cols ?? [], ...(a.space ? { space: a.space } : {}), ...(a.pending ? { pending: a.pending } : {}) });
  return `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO asleep(project,name,layout,saved) VALUES(${sqlText(project)},${sqlText(a.name)},${sqlText(layout)},${int(a.saved ?? Date.now())});`;
}
export const deleteSql = (project, name) => `DELETE FROM asleep WHERE project=${sqlText(project)} AND name=${sqlText(name)};`;

// Rows as tabs, each with the project it sleeps in (`from`), newest first.
export function rowsOf(rows) {
  const out = [];
  for (const r of rows ?? []) {
    let l;
    try { l = JSON.parse(r.layout); } catch { continue; }
    if (!Array.isArray(l?.cols)) continue;
    out.push({ from: r.project, name: r.name, per: l.per ?? null, cols: l.cols, saved: Number(r.saved) || 0,
      ...(l.space ? { space: l.space } : {}), ...(l.pending ? { pending: l.pending } : {}), ...(l.waking ? { waking: l.waking } : {}) });
  }
  return out.sort((a, b) => b.saved - a.saved);
}

export class Store {
  constructor() {
    this.dir = `${appHome()}/${STORE_DIR}`;
    this.db = `${this.dir}/sleep.db`;
    this.ready = null;
  }

  async sql(text, json = false) {
    const r = await exec("sqlite3", [...(json ? ["-json"] : []), this.db, text]);
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return json ? (r.stdout.trim() ? JSON.parse(r.stdout) : []) : r.stdout;
  }

  open() {
    return (this.ready ??= (async () => {
      let ok = null;
      try { ok = await exec("sqlite3", ["-version"]); } catch { /* reported below */ }
      if (ok?.code !== 0) { this.ready = null; throw new Error("Install sqlite3 to put tabs to sleep."); }
      await exec("mkdir", ["-p", this.dir]);
      await this.sql(SCHEMA);
    })());
  }

  // The tabs asleep. Not one going to sleep or waking right now, unless that
  // was so long ago it stopped half way (then it is shown, to be woken).
  async asleep(all = false) {
    await this.open();
    const now = Date.now();
    return rowsOf(await this.sql("SELECT project, name, layout, saved FROM asleep;", true))
      .filter((a) => all || (!(a.pending > now - STALE_MS) && !(a.waking > now - STALE_MS)));
  }
  // Written going to sleep, never over another sleeping tab of that name.
  async sleep(project, a) {
    await this.open();
    const r = await this.sql(`${saveSql(project, { ...a, pending: Date.now() }, false).replace(/;$/, "")} RETURNING name;`, true);
    if (!r.length) throw new Error(`a tab named ${a.name} is already asleep in this project`);
    return this.asleep();
  }
  async settle(project, name) {
    await this.open();
    await this.sql(`UPDATE asleep SET layout=json_remove(layout,'$.pending') WHERE project=${sqlText(project)} AND name=${sqlText(name)};`);
    return this.asleep();
  }
  // Taken by one wake at a time: false when another holds it.
  async claim(project, name) {
    await this.open();
    const now = Date.now();
    const r = await this.sql(`UPDATE asleep SET layout=json_set(layout,'$.waking',${now}) WHERE project=${sqlText(project)} AND name=${sqlText(name)}
      AND (json_extract(layout,'$.waking') IS NULL OR json_extract(layout,'$.waking') < ${now - STALE_MS}) RETURNING name;`, true);
    return r.length > 0;
  }
  async release(project, name) {
    await this.open();
    await this.sql(`UPDATE asleep SET layout=json_remove(layout,'$.waking') WHERE project=${sqlText(project)} AND name=${sqlText(name)};`);
    return this.asleep();
  }
  // What did not wake stays asleep: the row keeps only those panes.
  async keep(project, a) {
    await this.open();
    await this.sql(`${deleteSql(project, a.name)}\n${saveSql(project, a, true)}`);
    return this.asleep();
  }
  async woke(project, name) { await this.open(); await this.sql(deleteSql(project, name)); return this.asleep(); }
}
