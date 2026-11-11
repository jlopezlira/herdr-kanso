import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sqliteApi } from "../kanso/mods/kanso-panel/platform-sqlite.js";
import { exec, nativePlatform, temporary } from "./helpers.mjs";

for (const platform of ["macos", "linux", "windows"]) {
  test(`${platform} SQLite keeps short queries in argv and large queries in a private file`, async () => {
    const calls = [], writes = [];
    let failure = false;
    const run = async (command, args) => {
      calls.push({ command, args });
      return { code: failure && command === "sqlite3" ? 1 : 0, stdout: "[]", stderr: "query failed" };
    };
    const api = sqliteApi(platform, run, async (...args) => writes.push(args));
    const file = platform === "windows" ? "C:\\O'Brien ü\\kanso.db" : "/tmp/O'Brien ü/kanso.db";
    await api.execute(file, ["SELECT 1;", "SELECT 2;"], { json: true, busy: 10000 });
    assert.deepEqual(calls[0], { command: "sqlite3", args: ["-bail", "-cmd", ".timeout 10000", "-json", file, "SELECT 1;", "SELECT 2;"] });
    assert.equal(writes.length, 0);
    const sql = `SELECT '${"é".repeat(40000)}';`;
    await api.execute(file, sql);
    const [path, text, expected] = writes[0];
    assert.ok(path.endsWith(".sql"));
    assert.equal(text, sql + "\n;");
    assert.equal(expected, null);
    assert.ok(calls[1].args.join(" ").length < 1024);
    assert.match(calls[1].args.at(-1), /^\.read ".+\.sql"$/);
    assert.ok(calls[2].command === (platform === "windows" ? "pwsh" : "rm"));
    failure = true;
    await assert.rejects(api.execute(file, sql), /query failed/);
    assert.equal(calls.length, 5, "a failed query also removes its SQL file");
    assert.notEqual(writes[0][0], writes[1][0], "concurrent callers cannot share a SQL file");
    const denied = sqliteApi(platform, run, async () => { throw new Error("Access denied"); });
    await assert.rejects(denied.execute(file, sql), /Access denied/);
    assert.equal(calls.length, 5, "a failed file write never runs the query");
  });
}

test("native SQLite executes large transactions without a long command line and rolls back on error", async (t) => {
  const folder = join(await temporary(t), "O'Brien ü folder");
  await mkdir(folder);
  const file = join(folder, "kanso.db"), calls = [];
  const api = sqliteApi(nativePlatform, async (command, args) => { calls.push({ command, args }); return exec(command, args); },
    (path, text) => writeFile(path, text, { flag: "wx" }));
  await api.execute(file, "CREATE TABLE entries(id INTEGER PRIMARY KEY, body TEXT);");
  const text = "quote ''; semicolon ; código\n".repeat(600);
  const insert = `INSERT INTO entries VALUES(1,'${text.replace(/'/g, "''")}');`;
  await api.execute(file, ["BEGIN;", insert, "COMMIT;"]);
  assert.equal(JSON.parse((await api.execute(file, "SELECT body FROM entries;", { json: true })).stdout)[0].body, text);
  await assert.rejects(api.execute(file, ["BEGIN;", "DELETE FROM entries;", insert, "INSERT INTO missing VALUES(1);", "COMMIT;"]), /missing/);
  assert.equal(JSON.parse((await api.execute(file, "SELECT COUNT(*) n FROM entries;", { json: true })).stdout)[0].n, 1);
  await Promise.all([2, 3].map((id) => api.execute(file, [`INSERT INTO entries VALUES(${id},'${"x".repeat(10000)}');`])));
  assert.ok(calls.filter(({ command }) => command === "sqlite3").every(({ args }) => args.join(" ").length < 8192));
  assert.deepEqual((await readdir(folder)).filter((name) => name.endsWith(".sql")), []);
});
