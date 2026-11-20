import { checked } from "./platform-command.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";

const ARG_LIMIT = 8192;
export const BUSY_MS = 5000;
export const CALL_MS = BUSY_MS * 8;
export const sqliteLimit = (sql) => Math.min(600_000, CALL_MS + BUSY_MS * (Array.isArray(sql) ? sql.join("\n") : String(sql)).split(";").length);
export function sqliteApi(platform, run, write) {
  const unchecked = async (file, sql, { json = false, busy = BUSY_MS } = {}) => {
    const statements = Array.isArray(sql) ? sql : [String(sql)];
    const args = ["-bail", "-cmd", `.timeout ${busy}`, ...(json ? ["-json"] : []), file];
    if ([...args, ...statements].reduce((size, value) => size + value.length + 3, 0) < ARG_LIMIT) return run("sqlite3", [...args, ...statements]);
    const path = paths.join(paths.dirname(file), `.kanso-sql-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
    await write(path, statements.map((statement) => `${statement}\n;`).join("\n"), null);
    try { return await run("sqlite3", [...args, paths.sqliteRead(path)]); }
    finally { await fileApi(platform, run).remove([path]).catch(() => {}); }
  };
  return { unchecked, execute: async (...args) => checked(await unchecked(...args)) };
}
