// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Where arrangements are kept: a local SQLite database
// (data/kanso-arrange/arrange.db, through the sqlite3 command), one row per
// arrangement, keyed by the project it was saved in and its name, so saving
// under a name that exists overwrites it. The JSON file earlier versions
// wrote (data/kanso-arrange.json) is read into it once and left in place.
import { exec, appHome, readTextFile } from "herdr";

export const STORE_DIR = "data/kanso-arrange";
const OLD_FILE = "data/kanso-arrange.json";
const STALE_MS = 10 * 60_000; // a sleep or wake that long under way stopped half way

export const sqlText = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);

export const SCHEMA = `CREATE TABLE IF NOT EXISTS arrangements(
  project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL,
  PRIMARY KEY(project, name));
CREATE TABLE IF NOT EXISTS asleep(
  project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL,
  PRIMARY KEY(project, name));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`;

// An arrangement's row: what it opens (columns, panes per view) as JSON.
// `asleep` holds the tabs put to sleep: the same shape, each Claude pane with
// the conversation it resumes (`resume`).
export function saveSql(project, a, replace = true, table = "arrangements") {
  const layout = JSON.stringify({ per: a.per ?? null, cols: a.cols ?? [], ...(a.space ? { space: a.space } : {}), ...(a.pending ? { pending: a.pending } : {}) });
  return `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO ${table === "asleep" ? "asleep" : "arrangements"}(project,name,layout,saved) VALUES(${sqlText(project)},${sqlText(a.name)},${sqlText(layout)},${int(a.saved ?? Date.now())});`;
}
export const deleteSql = (project, name, table = "arrangements") => `DELETE FROM ${table === "asleep" ? "asleep" : "arrangements"} WHERE project=${sqlText(project)} AND name=${sqlText(name)};`;

// Rows as { project: [arrangement] }, each project's in the order saved.
export function projectsOf(rows) {
  const out = {};
  for (const r of rows ?? []) {
    let layout;
    try { layout = JSON.parse(r.layout); } catch { continue; }
    if (!Array.isArray(layout?.cols)) continue;
    (out[r.project] ??= []).push({ name: r.name, per: layout.per ?? null, cols: layout.cols, saved: Number(r.saved) || 0, ...(layout.space ? { space: layout.space } : {}),
      ...(layout.pending ? { pending: layout.pending } : {}), ...(layout.waking ? { waking: layout.waking } : {}) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.saved - b.saved);
  return out;
}

// The old JSON file's arrangements as inserts that never overwrite a row.
export function importSql(text) {
  let v = null;
  try { v = text ? JSON.parse(text) : null; } catch { return ""; }
  return Object.entries(v?.projects ?? {})
    .flatMap(([project, list]) => (Array.isArray(list) ? list : [])
      .filter((a) => a?.name && Array.isArray(a.cols))
      .map((a) => saveSql(project, a, false)))
    .join("\n");
}

export class Store {
  constructor() {
    this.dir = `${appHome()}/${STORE_DIR}`;
    this.db = `${this.dir}/arrange.db`;
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
      if (ok?.code !== 0) { this.ready = null; throw new Error("Install sqlite3 to keep arrangements."); }
      await exec("mkdir", ["-p", this.dir]);
      await this.sql(SCHEMA);
      const done = await this.sql(`SELECT v FROM meta WHERE k='imported';`, true);
      if (!done.length) {
        const old = importSql(await readTextFile(`${appHome()}/${OLD_FILE}`).catch(() => null));
        await this.sql(`BEGIN;\n${old}\nINSERT OR REPLACE INTO meta(k,v) VALUES('imported','${Date.now()}');\nCOMMIT;`);
      }
    })());
  }

  async all() {
    await this.open();
    return projectsOf(await this.sql("SELECT project, name, layout, saved FROM arrangements;", true));
  }

  async save(project, a) { await this.open(); await this.sql(saveSql(project, a)); return this.all(); }
  async remove(project, name) { await this.open(); await this.sql(deleteSql(project, name)); return this.all(); }

  // The tabs asleep, newest first, each with the project it sleeps in
  // (`from`). Not one going to sleep or waking right now, unless that was
  // so long ago it stopped half way (then it is shown, to be woken).
  async asleep(all = false) {
    await this.open();
    const by = projectsOf(await this.sql("SELECT project, name, layout, saved FROM asleep;", true));
    const now = Date.now();
    return Object.entries(by).flatMap(([from, list]) => list.map((a) => ({ ...a, from })))
      .filter((a) => all || (!(a.pending > now - STALE_MS) && !(a.waking > now - STALE_MS)))
      .sort((a, b) => b.saved - a.saved);
  }
  // A tab going to sleep: written `pending` (hidden) before its agents
  // leave; settled once they have. Never over another sleeping tab.
  async sleep(project, a) {
    await this.open();
    const r = await this.sql(`${saveSql(project, { ...a, pending: Date.now() }, false, "asleep").replace(/;$/, "")} RETURNING name;`, true);
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
    await this.sql(`${deleteSql(project, a.name, "asleep")}\n${saveSql(project, a, true, "asleep")}`);
    return this.asleep();
  }
  async woke(project, name) { await this.open(); await this.sql(deleteSql(project, name, "asleep")); return this.asleep(); }
}
