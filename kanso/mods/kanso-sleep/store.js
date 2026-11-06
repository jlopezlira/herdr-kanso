// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Where sleeping tabs are kept: a local SQLite database
// (data/kanso-sleep/sleep.db, through the sqlite3 command), one row per tab,
// keyed by the project it sleeps in and its name. Each row also carries an
// id of its own (`$.id` in its layout) that no other row ever gets: every
// change after it is written goes by that id, so a window holding an old
// copy can never touch a newer tab that took the same name. A row is written
// `pending` before its agents leave and settled once they have; a wake
// claims it (`waking`, with a token of that wake) so one window at a time
// wakes it, and only that wake may finish it.
import { exec, appHome } from "herdr";

export const STORE_DIR = "data/kanso-sleep";
export const STALE_MS = 10 * 60_000; // a sleep or wake that long under way stopped half way

export const sqlText = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const SCHEMA = `CREATE TABLE IF NOT EXISTS asleep(
  project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL,
  PRIMARY KEY(project, name));
UPDATE asleep SET layout=json_set(layout,'$.id',lower(hex(randomblob(8)))) WHERE json_extract(layout,'$.id') IS NULL;`;

// A tab's row: what it opens (columns, panes, each Claude agent's
// conversation) as JSON. Never over a row of that name.
export function insertSql(project, a) {
  const layout = JSON.stringify({ id: a.id, per: a.per ?? null, cols: a.cols ?? [], ...(a.space ? { space: a.space } : {}), ...(a.pending ? { pending: a.pending } : {}) });
  return `INSERT OR IGNORE INTO asleep(project,name,layout,saved) VALUES(${sqlText(project)},${sqlText(a.name)},${sqlText(layout)},${int(a.saved ?? Date.now())}) RETURNING name;`;
}
const byId = (id) => `json_extract(layout,'$.id')=${sqlText(id)}`;

// Rows as tabs, each with the project it sleeps in (`from`), newest first.
export function rowsOf(rows) {
  const out = [];
  for (const r of rows ?? []) {
    let l;
    try { l = JSON.parse(r.layout); } catch { continue; }
    if (!Array.isArray(l?.cols)) continue;
    out.push({ id: l.id ?? null, from: r.project, name: r.name, per: l.per ?? null, cols: l.cols, saved: Number(r.saved) || 0,
      ...(l.space ? { space: l.space } : {}), ...(l.pending ? { pending: l.pending } : {}), ...(l.waking ? { waking: l.waking } : {}) });
  }
  return out.sort((a, b) => b.saved - a.saved);
}
// Not going to sleep or waking right now, or that was so long ago it
// stopped half way (then it shows again, to be woken).
export const idle = (a, now = Date.now()) => !(a.pending > now - STALE_MS) && !(Number(String(a.waking ?? "").split(":")[0]) > now - STALE_MS);

export class Store {
  constructor() {
    this.dir = `${appHome()}/${STORE_DIR}`;
    this.db = `${this.dir}/sleep.db`;
    this.ready = null;
  }

  async sql(text, json = false) {
    // Another window writing: wait for it up to 5 s instead of failing.
    const r = await exec("sqlite3", ["-cmd", ".timeout 5000", ...(json ? ["-json"] : []), this.db, text]);
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

  // The tabs asleep (`all`: also those going to sleep or waking now). The
// changes below return nothing: read this after them, apart, so a failed
// read never passes for a failed change.
  async asleep(all = false) {
    await this.open();
    const now = Date.now();
    return rowsOf(await this.sql("SELECT project, name, layout, saved FROM asleep;", true)).filter((a) => all || idle(a, now));
  }
  // Written going to sleep, never over another sleeping tab of that name:
  // its new id, or an error when the name is taken.
  async sleep(project, a) {
    await this.open();
    const id = newId();
    const r = await this.sql(insertSql(project, { ...a, id, pending: Date.now() }), true);
    if (!r.length) throw new Error(`a tab named ${a.name} is already asleep in this project`);
    return id;
  }
  async settle(id) {
    await this.open();
    await this.sql(`UPDATE asleep SET layout=json_remove(layout,'$.pending') WHERE ${byId(id)};`);
  }
  // A row this sleep wrote and no longer wants (its agents came back).
  async drop(id) { await this.open(); await this.sql(`DELETE FROM asleep WHERE ${byId(id)} AND json_extract(layout,'$.pending') IS NOT NULL;`); }
  // The panes kept (`cols`), all else of the row as it was. `hold`: one of
  // them may still be starting somewhere, so it is not offered to wake
  // until that would have long settled (STALE_MS).
  async narrow(id, cols, token = null, hold = false) {
    await this.open();
    const layout = `json_remove(json_set(layout,'$.cols',json(${sqlText(JSON.stringify(cols))})),'$.pending','$.waking')`;
    await this.sql(`UPDATE asleep SET layout=${hold ? `json_set(${layout},'$.pending',${Date.now()})` : layout}
      WHERE ${byId(id)}${token ? ` AND json_extract(layout,'$.waking')=${sqlText(token)}` : ""};`);
  }
  // Taken by one wake at a time: the row as it is now, with the wake's
  // token, or null when another wake holds it or it is gone.
  async claim(id) {
    await this.open();
    const now = Date.now(), token = `${now}:${newId()}`;
    const r = await this.sql(`UPDATE asleep SET layout=json_set(layout,'$.waking',${sqlText(token)}) WHERE ${byId(id)}
      AND (json_extract(layout,'$.pending') IS NULL OR json_extract(layout,'$.pending') < ${now - STALE_MS})
      AND (json_extract(layout,'$.waking') IS NULL OR CAST(json_extract(layout,'$.waking') AS INTEGER) < ${now - STALE_MS})
      RETURNING project, name, layout, saved;`, true);
    const [a] = rowsOf(r);
    return a ? { ...a, token } : null;
  }
  async release(id, token) {
    await this.open();
    await this.sql(`UPDATE asleep SET layout=json_remove(layout,'$.waking') WHERE ${byId(id)} AND json_extract(layout,'$.waking')=${sqlText(token)};`);
  }
  // Awake: gone, if this wake still holds it.
  async woke(id, token) {
    await this.open();
    await this.sql(`DELETE FROM asleep WHERE ${byId(id)} AND json_extract(layout,'$.waking')=${sqlText(token)};`);
  }
  // Forgotten by hand: gone, unless a wake holds it.
  async forget(id) {
    await this.open();
    await this.sql(`DELETE FROM asleep WHERE ${byId(id)} AND (json_extract(layout,'$.waking') IS NULL OR CAST(json_extract(layout,'$.waking') AS INTEGER) < ${Date.now() - STALE_MS});`);
  }
}
