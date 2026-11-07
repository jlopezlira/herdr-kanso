// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Where arrangements are kept: a local SQLite database
// (data/kanso-arrange/arrange.db, through the sqlite3 command), one row per
// arrangement, keyed by the project it was saved in and its name, so saving
// under a name that exists overwrites it. The JSON file earlier versions
// wrote (data/kanso-arrange.json) is read into it once and left in place.
import { exec, appHome, readTextFile } from "herdr";
import { parseOr, tryOrAsync } from "./pure.js";

export const STORE_DIR = "data/kanso-arrange";
const OLD_FILE = "data/kanso-arrange.json";

export const sqlText = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);

export const SCHEMA = `CREATE TABLE IF NOT EXISTS arrangements(
  project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL,
  PRIMARY KEY(project, name));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`;

// An arrangement's row: what it opens (columns, panes per view) as JSON.
export function saveSql(project, a, replace = true) {
  const layout = JSON.stringify({ per: a.per ?? null, cols: a.cols ?? [] });
  return `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO arrangements(project,name,layout,saved) VALUES(${sqlText(project)},${sqlText(a.name)},${sqlText(layout)},${int(a.saved ?? Date.now())});`;
}
export const deleteSql = (project, name) => `DELETE FROM arrangements WHERE project=${sqlText(project)} AND name=${sqlText(name)};`;

// Rows as { project: [arrangement] }, each project's in the order saved.
export function projectsOf(rows) {
  // A row whose layout is not JSON, or holds no columns, is left out.
  const kept = (rows ?? []).flatMap((r) => {
    const layout = parseOr(r.layout);
    if (!Array.isArray(layout?.cols)) return [];
    return [{ project: String(r.project), a: { name: r.name, per: layout.per ?? null, cols: layout.cols, saved: Number(r.saved) || 0 } }];
  });
  const projects = [...new Set(kept.map((x) => x.project))];
  return Object.fromEntries(projects.map((k) => [k, kept.filter((x) => x.project === k).map((x) => x.a).toSorted((a, b) => a.saved - b.saved)]));
}

// The old JSON file's arrangements as inserts that never overwrite a row.
export function importSql(text) {
  const v = text ? parseOr(text) : null;
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
      const ok = await tryOrAsync(() => exec("sqlite3", ["-version"])); // a failure is reported below
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
}
