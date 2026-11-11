// Concurrent database calls share a process without sharing their results or failures.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec } from "./helpers.mjs";

async function database(t) {
  const dir = await temporary(t), calls = [];
  const clock = { now: Date.now() };
  class Clock extends Date { static now() { return clock.now; } }
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], {
    appHome: () => dir, Date: Clock,
    exec: (command, args) => { calls.push([command, args]); return exec(command, args); },
  });
  const db = new Kdb();
  await db.open();
  calls.length = 0;
  return { db, calls, clock, another: () => new Kdb() };
}

test("kdb batches same-tick reads and writes, keeping empty and multiline results with their caller", async (t) => {
  const { db, calls, another } = await database(t);
  const results = await Promise.all([
    db.read("SELECT 'first' AS value; SELECT 'line' || char(10) || 'two' AS value;"),
    another().read("SELECT 1 WHERE 0;"),
    db.setPref("a", "b"),
    db.read("SELECT value FROM prefs WHERE key='a';"),
  ]);
  assert.equal(calls.length, 1, `kdb same-tick calls started ${calls.length} processes; budget 1`);
  assert.deepEqual(clone(results), [[{ value: "first" }, { value: "line\ntwo" }], [], [], [{ value: "b" }]]);
});

test("kdb rejects only the failing caller and rolls back its transaction before later calls", async (t) => {
  const { db } = await database(t);
  const results = await Promise.allSettled([
    db.read("SELECT 'before' AS value;"),
    db.run("BEGIN; INSERT INTO prefs VALUES('no', 'rollback'); SELECT * FROM missing_table; COMMIT;"),
    db.read("SELECT * FROM prefs;"),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /missing_table/);
  assert.deepEqual(clone(results[2].value), []);
  assert.deepEqual(clone(await db.read("SELECT 3 AS next;")), [{ next: 3 }]);
});

test("kdb caches preferences and panel state across handles until a write or the 30-second reload", async (t) => {
  const { db, calls, clock, another } = await database(t);
  await db.setPref("view", "spaces");
  await db.savePanelState("A", "files", { cwd: "/a" });
  const prefs = await db.prefs();
  await db.panelState("A", "files");
  calls.length = 0;
  prefs[0].value = "changed by caller";
  assert.equal((await another().prefs())[0].value, "spaces");
  assert.equal((await another().panelState("A", "files")).cwd, "/a");
  assert.equal(calls.length, 0);
  await another().setPref("view", "threads");
  assert.equal((await db.prefs())[0].value, "threads");
  await another().clearPanelState("A", "files");
  assert.equal(await db.panelState("A", "files"), undefined);
  await db.prefs();
  calls.length = 0;
  clock.now += 30_000;
  await db.prefs();
  assert.equal(calls.length, 1);
});

test("a failed cached read is tried again", async (t) => {
  const { db } = await database(t);
  await db.run("DROP TABLE prefs;");
  await assert.rejects(db.prefs(), /prefs/);
  await db.run("CREATE TABLE prefs(key TEXT, value TEXT);");
  assert.deepEqual(clone(await db.prefs()), []);
});

test("space synchronization and sleeping rows share one database process", async (t) => {
  const { db, calls } = await database(t);
  await db.sleepTab({ name: "Sleep", space: { id: "s1", name: "Project" }, project: ":/project", layout: { cols: [] }, agents: [] });
  calls.length = 0;
  const rows = await db.sleeps([{ id: "s1", name: "Project", folder: "/project" }], 123);
  assert.equal(calls.length, 1, `sleep reload started ${calls.length} processes; budget 1`);
  assert.equal(rows[0].name, "Sleep");
  assert.deepEqual(Array.from(rows[0].agents), []);
  assert.equal((await db.read("SELECT seen FROM spaces WHERE id='s1';"))[0].seen, 123);
});
