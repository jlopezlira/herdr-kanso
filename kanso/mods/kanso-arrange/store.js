import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
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

export function saveSql(project, a, replace = true) {
  const layout = JSON.stringify({ per: a.per ?? null, cols: a.cols ?? [] });
  return `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO arrangements(project,name,layout,saved) VALUES(${sqlText(project)},${sqlText(a.name)},${sqlText(layout)},${int(a.saved ?? Date.now())});`;
}
export const deleteSql = (project, name) => `DELETE FROM arrangements WHERE project=${sqlText(project)} AND name=${sqlText(name)};`;

export function projectsOf(rows) {
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
    this.dir = paths.join(appHome(), STORE_DIR);
    this.db = paths.join(this.dir, "arrange.db");
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
      await localService(fileApi).mkdir(this.dir);
      await this.sql(SCHEMA);
      const done = await this.sql(`SELECT v FROM meta WHERE k='imported';`, true);
      if (!done.length) {
        const old = importSql(await readTextFile(paths.join(appHome(), OLD_FILE)).catch(() => null));
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
