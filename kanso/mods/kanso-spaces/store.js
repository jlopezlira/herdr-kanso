import { BUSY_MS } from "./platform-sqlite.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { appHome } from "herdr";

// Any other failure throws, so the migration waits for a read it can trust; "none" only when ls's message ends in ": No such file or directory", which a path can't fake.
async function legacyRows(db, file, table, sql) {
  const there = await db.call((platform, run, write) => fileApi(platform, run, write).legacyStatus(file));
  if (there === "none") return null;
  if (there !== "file") throw new Error(`${file} could not be looked at: ${there || "no answer"}`);
  const read = async (text) => {
    const r = await db.call((_platform, run) => run("sqlite3", ["-readonly", "-cmd", `.timeout ${BUSY_MS}`, "-json", file, text]));
    if (r.code !== 0) throw new Error(`${file} could not be read: ${(r.stderr || "sqlite3 failed").trim().split("\n")[0]}`);
    return r.stdout.trim() ? JSON.parse(r.stdout) : [];
  };
  if (!(await read(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`)).length) return null;
  return read(sql);
}

export class Store {
  constructor(kdb, legacy = paths.join(appHome(), "data")) {
    if (typeof kdb?.timer?.after !== "function") throw new TypeError("A store needs its database and view's timer");
    this.kdb = kdb;
    this.legacy = legacy;
    this.ready = null;
  }

  open() {
    return (this.ready ??= (async () => {
      await this.kdb.open();
      if (this.kdb.machine || await this.kdb.migrated()) return;
      const prefs = await legacyRows(this.kdb, `${this.legacy}/kanso-spaces/panel.db`, "prefs", "SELECT key, value FROM prefs;");
      await this.kdb.migrate({ prefs: prefs ?? [] });
    })().catch((e) => { this.ready = null; throw e; }));
  }
}
