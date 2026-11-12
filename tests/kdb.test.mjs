import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
// The left nav's one database: identity by conversation, holds that say whether they held,
// a migration that happens once or not at all.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { databaseTimer, load, clone, temporary, exec } from "./helpers.mjs";

const seen = (conversation, given, space, pos, status = "idle", terminal = "t1") => ({ conversation, given, space, pos, status, terminal, tab: `tb-${space}`, title: null });

async function database(t, dir = null) {
  dir ??= await temporary(t);
  const mod = await load("kanso-spaces/kdb.js", ["Kdb", "conversationOf", "GONE_MS"], { exec, appHome: () => dir });
  return { ...mod, db: new mod.Kdb(databaseTimer, join(dir, "kanso")), dir };
}
const sh = (file, sql) => exec("sqlite3", ["-bail", file, sql]);

test("conversation ids come from Claude's and Codex's files", async (t) => {
  const { conversationOf } = await database(t);
  assert.equal(conversationOf("/h/.claude/projects/-w/78efdf1f-a14a-432a-acf8-0a964fcc0b1a.jsonl"), "78efdf1f-a14a-432a-acf8-0a964fcc0b1a");
  assert.equal(conversationOf("/h/.codex/sessions/2026/rollout-2026-11-06T10-00-00-019a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.jsonl"), "019a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b");
  assert.equal(conversationOf(null), null);
});

test("a terminal address given to another agent never carries a name over", async (t) => {
  const { db } = await database(t);
  await db.observe([seen("c-a", "morpheus", "sp-agile", 0, "idle", "t5c")]);
  await db.observe([seen("c-b", null, "sp-kanso", 0, "idle", "t5c")], Date.now() + 1);
  assert.deepEqual(clone(await db.read("SELECT id, name FROM agents ORDER BY id")), [{ id: "c-a", name: "morpheus" }, { id: "c-b", name: null }]);
  await db.observe([seen("c-a", null, "sp-agile", 0, "idle", "t7")], Date.now() + 2);
  assert.equal((await db.read("SELECT name FROM agents WHERE id='c-a'"))[0].name, null, "a name cleared on its terminal brings the automatic one back");
  await db.observe([{ ...seen(null, "x", "sp-kanso", 0), conversation: null }]);
  assert.equal((await db.read("SELECT id FROM agents")).length, 2, "without a conversation an agent is not kept: no row by terminal");
});

test("an older sighting never overwrites a newer one; one not seen for a while and never moved is forgotten", async (t) => {
  const { db, GONE_MS } = await database(t);
  await db.observe([seen("c1", "new", "sp-kanso", 1, "working")], 200);
  await db.observe([seen("c1", "old", "sp-shield", 0, "idle")], 100);
  assert.deepEqual(clone(await db.read("SELECT name, space_id, status FROM agents")), [{ name: "new", space_id: "sp-kanso", status: "working" }]);
  await db.observe([], 200 + GONE_MS + 1);
  assert.deepEqual(clone(await db.read("SELECT id FROM agents")), []);
});

test("a conversation moved to a project stays after it leaves", async (t) => {
  const { db, GONE_MS } = await database(t);
  await db.setProject("c-kept", "sp-kanso", 1);
  await db.observe([seen("c-kept", "kept", "sp-kanso", 0), seen("c-free", "free", "sp-kanso", 1)], 1);
  await db.observe([], GONE_MS + 2);
  assert.deepEqual(clone(await db.read("SELECT id, status FROM agents ORDER BY id")), [{ id: "c-kept", status: "gone" }]);
});

test("a database that failed to open is tried again", async (t) => {
  const dir = await temporary(t);
  let fail = true;
  const flaky = async (c, a, o) => (fail && c === "sqlite3" && a[0] === "-version" ? { code: 1, stdout: "", stderr: "no" } : exec(c, a, o));
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: flaky, appHome: () => dir });
  const db = new Kdb(databaseTimer, join(dir, "kanso"));
  await assert.rejects(db.open(), /Install sqlite3/);
  fail = false;
  await db.open();
  assert.deepEqual(clone(await db.read("SELECT value FROM meta WHERE key='version'")), [{ value: "1" }]);
});

// The file before this database: data/kanso-spaces/panel.db.
async function legacy(dir) {
  await mkdir(join(dir, "kanso-spaces"), { recursive: true });
  const panel = join(dir, "kanso-spaces", "panel.db");
  await sh(panel, `CREATE TABLE prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE agents(address TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, space TEXT, project TEXT, at INTEGER, program TEXT, seen INTEGER NOT NULL);
    INSERT INTO prefs VALUES('spaces.view','threads');
    INSERT INTO agents VALUES('t3q','Hashiko','Memory leaks',9,'sp-shield',':/w',2,NULL,1);`);
  return { panel };
}
async function storeIn(t, dir, run = exec, host = {}) {
  const { Store } = await load("kanso-spaces/store.js", ["Store"], { exec: run, appHome: () => dir, ...host });
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: run, appHome: () => dir, ...host });
  const db = new Kdb(databaseTimer, join(dir, "kanso"));
  return { store: new Store(db, dir), db };
}

test("what panel.db held is taken in once, and nothing kept by terminal address", async (t) => {
  const dir = await temporary(t);
  const { panel } = await legacy(dir);
  const { store, db } = await storeIn(t, dir);
  await store.open();
  assert.deepEqual(clone(await db.prefs()), [{ key: "spaces.view", value: "threads" }]);
  assert.deepEqual(clone(await db.read("SELECT id FROM agents")), [], "t3q may be another agent by now");
  await sh(panel, "UPDATE prefs SET value='spaces' WHERE key='spaces.view';");
  const again = (await storeIn(t, dir)).store;
  await again.open();
  assert.deepEqual(clone(await db.read("SELECT value FROM prefs")), [{ value: "threads" }], "taken in once");
});

test("the migration is all or nothing, and two windows never both do it", async (t) => {
  const dir = await temporary(t);
  await legacy(dir);
  const failing = async (c, a, o) => exec(c, c === "sqlite3" ? a.map((x) => (x.startsWith("INSERT OR IGNORE INTO prefs(key,value) SELECT") ? "INSERT INTO nowhere VALUES(1);" : x)) : a, o);
  await assert.rejects((await storeIn(t, dir, failing)).store.open(), /nowhere/);
  const { db } = await storeIn(t, dir);
  assert.equal(await db.migrated(), false, "nothing of a failed one stays, so it is tried again");
  const [one, two] = [await storeIn(t, dir), await storeIn(t, dir)];
  await Promise.all([one.store.open(), two.store.open()]);
  assert.deepEqual(clone(await db.prefs()), [{ key: "spaces.view", value: "threads" }]);
  assert.equal(await db.migrated(), true);
});

test("an old file that can't be read now stops the migration until it can, never passes it by", async (t) => {
  const dir = await temporary(t);
  await legacy(dir);
  let locked = true;
  const run = async (c, a, o) => (locked && c === "sqlite3" && a.includes("-readonly") ? { code: 5, stdout: "", stderr: "database is locked" } : exec(c, a, o));
  const { store, db } = await storeIn(t, dir, run);
  await assert.rejects(store.open(), /could not be read: database is locked/);
  assert.equal(await db.migrated(), false);
  locked = false;
  await store.open();
  assert.equal((await db.prefs()).length, 1, "read once it can be: nothing lost");
});

test("a path with a quote in it is read as it is", async (t) => {
  const dir = join(await temporary(t), "O'Brien");
  await mkdir(dir, { recursive: true });
  await legacy(dir);
  const { store, db } = await storeIn(t, dir);
  await store.open();
  assert.equal((await db.prefs()).length, 1);
});

for (const [name, folder, reason] of [
  ["a folder that can't be looked into is not taken for nothing there", "locked", "Access denied"],
  ["a folder whose message only names 'No such file' in its path is still an error, not nothing there", "No such file here", "No such file here: Permission denied"],
]) {
  test(name, async (t) => {
    const dir = join(await temporary(t), folder);
    await legacy(dir);
    let denied = true;
    const { store, db } = await storeIn(t, dir, exec, {
      fileApi: (platform, run) => {
        const api = fileApi(platform, run);
        return { ...api, legacyStatus: (file) => denied ? Promise.resolve(`error: ${reason}`) : api.legacyStatus(file) };
      },
    });
    await assert.rejects(store.open(), /could not be (looked at|read)/);
    assert.equal(await db.migrated(), false, "nothing marked: it is taken in once it can be read");
    denied = false;
    await store.open();
    assert.equal((await db.prefs()).length, 1);
  });
}

test("an agent's project is a person's choice, kept with the agent whatever space its terminal is in", async (t) => {
  const { db } = await database(t);
  await db.observe([seen("c-qb2", null, "sp-fluenty", 0, "idle", "t5t")], 1000);
  await db.setProject("c-qb2", "sp-kanso", 1001);
  await db.observe([seen("c-qb2", null, "sp-fluenty", 0, "working", "t5t")], 2000);
  const [row] = clone(await db.agents());
  assert.deepEqual([row.project, row.space_id, row.status], ["sp-kanso", "sp-fluenty", "working"], "a sighting never changes it");
  await db.setProject("term:abc", "sp-kanso", 3000);
  assert.ok(clone(await db.agents()).some((r) => r.id === "term:abc" && r.project === "sp-kanso"), "one with no conversation, by its terminal's own id");
  await db.setProject("c-qb2", null, 4000);
  assert.equal(clone(await db.agents()).find((r) => r.id === "c-qb2").project, null, "back to where it runs");
});

test("a database made before agents had a project gets the column, and keeps its rows", async (t) => {
  const { db } = await database(t);
  await mkdir(db.dir, { recursive: true });
  await sh(db.file, "CREATE TABLE agents(id TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, program TEXT, cwd TEXT, space_id TEXT, tab_id TEXT, pos INTEGER, terminal TEXT, status TEXT NOT NULL DEFAULT 'unknown', since INTEGER, seen INTEGER NOT NULL, sleep_id TEXT, restore TEXT); INSERT INTO agents(id,name,status,seen) VALUES('c1','Alice','idle',1);");
  await db.setProject("c1", "sp-kanso");
  assert.deepEqual(clone((await db.agents()).map((r) => [r.id, r.name, r.project])), [["c1", "Alice", "sp-kanso"]]);
});

test("what the old Sleep kept is dropped once: its table, trigger, columns and events; agents and other events stay", async (t) => {
  const { db } = await database(t);
  await mkdir(db.dir, { recursive: true });
  await sh(db.file, `CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, machine TEXT, seen INTEGER NOT NULL, gone INTEGER);
    CREATE TABLE sleeps(id TEXT PRIMARY KEY, name TEXT NOT NULL, project TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL);
    CREATE TABLE agents(id TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, program TEXT, cwd TEXT, space_id TEXT, tab_id TEXT, pos INTEGER, terminal TEXT,
      status TEXT NOT NULL DEFAULT 'unknown', since INTEGER, seen INTEGER NOT NULL, sleep_id TEXT, restore TEXT, project TEXT, project_at INTEGER,
      step TEXT, step_at INTEGER, sent_at INTEGER, nudged_at INTEGER, why TEXT);
    CREATE TRIGGER agents_one_sleep BEFORE UPDATE OF sleep_id ON agents WHEN OLD.sleep_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'x'); END;
    CREATE TABLE since_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, did TEXT);
    INSERT INTO meta VALUES('moved:a','b'); INSERT INTO meta VALUES('migrated','1');
    INSERT INTO sleeps VALUES('s1','Tab 1',':/w','{}',1);
    INSERT INTO agents(id,name,status,seen,sleep_id,step) VALUES('c1','Alice','asleep',1,'s1','left');
    INSERT INTO since_events(project,target,kind,text,at) VALUES(':/w','sleep:s1','sleep_finished','Tab 1',1);
    INSERT INTO since_events(project,target,kind,text,at) VALUES(':/w','agent:c1','finished','Alice',2);`);
  assert.deepEqual(clone((await db.agents()).map((r) => [r.id, r.name])), [["c1", "Alice"]]);
  const tables = clone(await db.read("SELECT name FROM sqlite_master WHERE name IN ('sleeps','spaces','agents_one_sleep');"));
  assert.deepEqual(tables, []);
  const columns = clone(await db.read("PRAGMA table_info(agents);")).map((c) => c.name);
  assert.deepEqual(columns.filter((c) => ["sleep_id", "restore", "step", "step_at", "sent_at", "nudged_at", "why"].includes(c)), []);
  assert.deepEqual(clone(await db.read("SELECT kind FROM since_events")), [{ kind: "finished" }]);
  assert.deepEqual(clone(await db.read("SELECT key FROM meta WHERE key LIKE 'moved:%'")), []);
});

test("the alias read keeps a write in the same call, and returns every route", async (t) => {
  const { db } = await database(t);
  const rows = clone(await db.aliases([{ route: "", name: "studio", at: 5, pending: 0 }], 10));
  assert.deepEqual(rows, [{ route: "", name: "studio", at: 5, pending: 0 }]);
  assert.deepEqual(clone(await db.aliases()), rows);
});

test("a transcript's pictures stay, a color already stored is kept, and one left out of a save is gone", async (t) => {
  const { db } = await database(t);
  const file = "/home/me/.claude/projects/-repo/07e8cebe-420b-47d2-9fba-a76c2e4dd30d.jsonl";
  await db.savePictures(file, 10, [{ path: "/a.png", ord: 1, color: "#c45a3a" }, { path: "/b.png", ord: 2, color: null }], "111");
  const got = await db.pictures(file);
  assert.equal(got.size, "10");
  assert.equal(got.mark, "111");
  assert.equal(got.rows[0].color, "#c45a3a");
  await db.savePictures(file, 18, [{ path: "/a.png", ord: 1, color: null }, { path: "/c.png", ord: 3, color: null }], "222");
  const next = await db.pictures(file);
  assert.deepEqual(clone(next.rows.map((r) => r.path)), ["/a.png", "/c.png"]);
  assert.equal(next.rows[0].color, "#c45a3a");
  assert.equal(next.size, "18");
  assert.equal(next.mark, "222");
  await db.savePictures(file, 18, [], "333");
  const none = await db.pictures(file);
  assert.equal(clone(none.rows).length, 0, "a save that names nothing drops the rows");
  assert.equal(none.mark, "333");
});

test("an older picture index gains the prefix mark", async (t) => {
  const { db, dir } = await database(t);
  const file = join(dir, "kanso", "kanso.db");
  await mkdir(join(dir, "kanso"), { recursive: true });
  await exec("sqlite3", [file, "CREATE TABLE picture_scans(file TEXT PRIMARY KEY, size INTEGER NOT NULL); INSERT INTO picture_scans(file,size) VALUES('/t.jsonl', 4);"]);
  const got = await db.pictures("/t.jsonl");
  assert.equal(got.size, "4");
  assert.equal(got.mark, "");
  await db.savePictures("/t.jsonl", 4, [], "9");
  assert.equal((await db.pictures("/t.jsonl")).mark, "9");
});
