import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
// The left nav's one database: identity by conversation, asleep as a status,
// holds that say whether they held, a migration that happens once or not at all.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec } from "./helpers.mjs";

const spaces = [
  { id: "sp-shield", name: "shield", folder: "/Users/jj/Apps/fluenty" },
  { id: "sp-agile", name: "agile", folder: "/Users/jj/Apps/fluenty" },
  { id: "sp-kanso", name: "herdr-kanso", folder: "/Users/jj/Apps/fluenty" },
];
const project = ":/Users/jj/Apps/fluenty";
const seen = (conversation, given, space, pos, status = "idle", terminal = "t1") => ({ conversation, given, space, pos, status, terminal, tab: `tb-${space}`, title: null });
const layout = (...resumes) => ({ per: null, cols: [{ w: 1, panes: resumes.map((r) => (r ? { argv: ["claude"], resume: r, name: r } : { argv: ["npm", "run", "dev"], resume: null })) }] });

async function database(t, dir = null) {
  dir ??= await temporary(t);
  const mod = await load("kanso-spaces/kdb.js", ["Kdb", "spaceFor", "inPlace", "conversationOf", "STALE_MS", "ABANDON_MS", "GONE_MS", "SPACE_KEEP_MS"], { exec, appHome: () => dir });
  return { ...mod, db: new mod.Kdb(join(dir, "kanso")), dir };
}
const sh = (file, sql) => exec("sqlite3", ["-bail", file, sql]);

test("a place is its space, not the first space that shares the folder", async (t) => {
  const { spaceFor, inPlace } = await database(t);
  assert.equal(spaceFor({ spaceId: "sp-kanso", project }, spaces).name, "herdr-kanso", "by id");
  assert.equal(spaceFor({ spaceId: "old-id", spaceName: "agile", project }, spaces), null, "its space is gone: not another of that folder and name, which may have stood beside it");
  assert.equal(spaceFor({ spaceName: "agile", project }, spaces).id, "sp-agile", "a row from before ids: the one of that folder and name");
  assert.equal(spaceFor({ project }, spaces), null, "three fit: none is guessed");
  assert.equal(spaceFor({ spaceName: "gone", project }, spaces), null, "no space of that name: none, never shield");
  const moved = [{ id: "sp-kanso", name: "herdr-kanso", folder: "/elsewhere" }];
  assert.equal(inPlace({ spaceId: "sp-kanso", from: project }, { from: ":/elsewhere", space: "sp-kanso" }, moved), true, "a space that changed folder keeps what sleeps in it");
  assert.equal(inPlace({ spaceId: "gone", from: ":/x" }, { from: ":/x", space: null }, []), true, "no space: in its project's quiet row");
});

test("conversation ids come from Claude's and Codex's files", async (t) => {
  const { conversationOf } = await database(t);
  assert.equal(conversationOf("/h/.claude/projects/-w/78efdf1f-a14a-432a-acf8-0a964fcc0b1a.jsonl"), "78efdf1f-a14a-432a-acf8-0a964fcc0b1a");
  assert.equal(conversationOf("/h/.codex/sessions/2026/rollout-2026-11-06T10-00-00-019a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.jsonl"), "019a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b");
  assert.equal(conversationOf(null), null);
});

test("asleep is a status like working or done: the agent keeps its space, place and name, and wakes with them", async (t) => {
  const { db } = await database(t);
  await db.syncSpaces(spaces);
  await db.observe([seen("c-morpheus", "morpheus", "sp-agile", 0), seen("c-hashiko", "Hashiko", "sp-kanso", 3, "done", "t3q"), seen("c-fury", "Fury", "sp-shield", 2, "working", "t32")]);
  const { id, token } = await db.sleepTab({ name: "Hashiko", space: spaces[2], project, layout: layout("c-hashiko"), agents: [{ conversation: "c-hashiko", given: "Hashiko" }] });
  assert.equal(await db.settle(id, token), true);
  const row = (c) => db.read(`SELECT status, space_id, pos, name, terminal FROM agents WHERE id='${c}'`).then((r) => clone(r[0]));
  assert.deepEqual(await row("c-hashiko"), { status: "asleep", space_id: "sp-kanso", pos: 3, name: "Hashiko", terminal: null }, "in herdr-kanso, at its place, by its name");
  assert.equal((await row("c-morpheus")).space_id, "sp-agile", "another agent of the same folder stays in its own space");
  await db.observe([seen("c-hashiko", null, "sp-shield", 0, "idle", "t3q")], Date.now() + 1);
  assert.equal((await row("c-hashiko")).status, "asleep", "a sighting never changes an agent asleep");
  const claim = await db.claim(id);
  assert.equal(claim.space_id, "sp-kanso");
  assert.equal(await db.woke(id, claim.token), true);
  assert.equal((await row("c-hashiko")).name, "Hashiko", "awake, before its new terminal is seen: its name is kept with its conversation");
  await db.observe([seen("c-hashiko", "Hashiko", "sp-kanso", 3, "idle", "t99")], Date.now() + 2);
  assert.deepEqual(await row("c-hashiko"), { status: "idle", space_id: "sp-kanso", pos: 3, name: "Hashiko", terminal: "t99" }, "same agent on a new terminal (its name put back on it by the wake)");
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

test("an older sighting never overwrites a newer one; one not seen for a while and never moved is forgotten, one asleep stays", async (t) => {
  const { db, GONE_MS } = await database(t);
  await db.observe([seen("c1", "new", "sp-kanso", 1, "working")], 200);
  await db.observe([seen("c1", "old", "sp-shield", 0, "idle")], 100);
  assert.deepEqual(clone(await db.read("SELECT name, space_id, status FROM agents")), [{ name: "new", space_id: "sp-kanso", status: "working" }]);
  const { id, token } = await db.sleepTab({ name: "z", space: spaces[0], project, layout: layout("c2"), agents: [{ conversation: "c2" }], saved: 200, now: 200 });
  await db.settle(id, token);
  await db.observe([], 200 + GONE_MS + 1);
  assert.deepEqual(clone(await db.read("SELECT id, status FROM agents ORDER BY id")), [{ id: "c2", status: "asleep" }]);
});

test("a conversation moved to a project stays after it leaves, and a project gone for 7 days is forgotten", async (t) => {
  const { db, GONE_MS, SPACE_KEEP_MS } = await database(t);
  const { KEEP_MS } = await load("kanso-spaces/since-left-model.js", ["KEEP_MS"]);
  assert.equal(SPACE_KEEP_MS, KEEP_MS);
  await db.setProject("c-kept", "sp-kanso", 1);
  await db.observe([seen("c-kept", "kept", "sp-kanso", 0), seen("c-free", "free", "sp-kanso", 1)], 1);
  await db.observe([], GONE_MS + 2);
  assert.deepEqual(clone(await db.read("SELECT id, status FROM agents ORDER BY id")), [{ id: "c-kept", status: "gone" }]);
  const now = SPACE_KEEP_MS + 5000;
  await db.syncSpaces([{ id: "young", name: "young", folder: "/young", machine: null }, { id: "old", name: "old", folder: "/old", machine: null }], now);
  await db.run(`UPDATE spaces SET gone=${now - 1000} WHERE id='young'; UPDATE spaces SET gone=${now - SPACE_KEEP_MS - 1} WHERE id='old';`);
  await db.syncSpaces([{ id: "young", name: "young", folder: "/young", machine: null }], now);
  assert.deepEqual(clone(await db.read("SELECT id FROM spaces ORDER BY id")), [{ id: "young" }]);
});

test("one sleep holds its row: an undo from a sleep that lost it never deletes another window's wake", async (t) => {
  const { db, STALE_MS } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1" }], now: 0 });
  assert.equal(await db.claim(id, 1000), null, "going to sleep: not to be woken");
  const b = await db.claim(id, STALE_MS + 1);
  assert.ok(b, "a sleep that stopped half way long ago can be woken");
  assert.equal(await db.drop(id, token), false, "the stale sleep's undo no longer holds it");
  assert.equal(await db.narrow(id, layout(), [], { sleep: token }), false);
  assert.equal(await db.settle(id, token), false);
  assert.equal((await db.sleeps()).length, 1, "the wake's row is still there");
  assert.equal(await db.woke(id, b.token), true);
});

test("a wake that lost its hold is told so, and one that renews keeps it", async (t) => {
  const { db, STALE_MS } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1" }] });
  await db.settle(id, token);
  const a = await db.claim(id, 0);
  assert.equal(await db.renew(id, a.token, STALE_MS - 1), true);
  assert.equal(await db.claim(id, STALE_MS + 1), null, "renewed: still held");
  const b = await db.claim(id, 2 * STALE_MS);
  assert.ok(b, "not renewed: another window takes it");
  assert.equal(await db.woke(id, a.token), false, "the first wake is told it lost the row");
  assert.equal(await db.renew(id, a.token), false);
  assert.equal(await db.woke(id, b.token), true);
});

test("waking part of a tab: the agents kept stay asleep, the others wake; every pane stays in what reopens", async (t) => {
  const { db } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1", "c2", null), agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  await db.settle(id, token);
  const a = await db.claim(id);
  const kept = { per: null, cols: [{ w: 1, panes: [layout("c2").cols[0].panes[0], layout(null).cols[0].panes[0]] }] };
  assert.equal(await db.narrow(id, kept, ["c2"], { wake: a.token }, { space: "sp-new" }), true);
  assert.deepEqual(clone(await db.read("SELECT id, status, sleep_id IS NOT NULL AS z, space_id FROM agents ORDER BY id")),
    [{ id: "c1", status: "unknown", z: 0, space_id: "sp-kanso" }, { id: "c2", status: "asleep", z: 1, space_id: "sp-new" }]);
  const [row] = await db.sleeps();
  assert.equal(JSON.parse(row.layout).cols[0].panes.length, 2, "the shell that did not open is still there to open");
  assert.equal(row.space_id, "sp-new", "where it is now");
});

test("an agent is in one sleep at a time, and sleeping takes its place as it is now", async (t) => {
  const { db } = await database(t);
  await db.observe([seen("c1", "old", "sp-shield", 0)]);
  await db.observe([seen("c1", "renamed", "sp-kanso", 4)], Date.now() + 1);
  const one = await db.sleepTab({ name: "one", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1", given: "renamed", pos: 4 }] });
  assert.deepEqual(clone(await db.read("SELECT space_id, name, pos FROM agents")), [{ space_id: "sp-kanso", name: "renamed", pos: 4 }], "where it is now, by the name it has now");
  await assert.rejects(db.sleepTab({ name: "two", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1" }] }), /already asleep/);
  assert.deepEqual(clone((await db.sleeps()).map((s) => s.id)), [one.id], "the second sleep left nothing behind");
  await assert.rejects(db.sleepTab({ name: "one", space: spaces[2], project, layout: layout("c9"), agents: [{ conversation: "c9" }] }), /a tab named one is already asleep/);
});

test("a database that failed to open is tried again", async (t) => {
  const dir = await temporary(t);
  let fail = true;
  const flaky = async (c, a, o) => (fail && c === "sqlite3" && a[0] === "-version" ? { code: 1, stdout: "", stderr: "no" } : exec(c, a, o));
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: flaky, appHome: () => dir });
  const db = new Kdb(join(dir, "kanso"));
  await assert.rejects(db.open(), /Install sqlite3/);
  fail = false;
  await db.open();
  assert.deepEqual(clone(await db.read("SELECT value FROM meta WHERE key='version'")), [{ value: "1" }]);
});

// The files before this database: data/kanso-sleep/sleep.db and data/kanso-spaces/panel.db.
async function legacy(dir) {
  await mkdir(join(dir, "kanso-sleep"), { recursive: true });
  await mkdir(join(dir, "kanso-spaces"), { recursive: true });
  const sleep = join(dir, "kanso-sleep", "sleep.db"), panel = join(dir, "kanso-spaces", "panel.db");
  const l = (id, extra = "") => `{"per":null,${id ? `"id":"${id}",` : ""}"space":"herdr-kanso",${extra}"cols":[{"w":1,"panes":[{"argv":["claude"],"cwd":"/w","resume":"c-h","name":"Hashiko","terminal":"t3q"},{"argv":["npm"],"resume":null,"terminal":"t4"}]}]}`;
  await sh(sleep, `CREATE TABLE asleep(project TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, saved INTEGER NOT NULL, PRIMARY KEY(project, name));
    INSERT INTO asleep VALUES('${project}','Hashiko','${l("r1", '"into":{"tab":null,"tabId":"tb1"},')}',5);
    INSERT INTO asleep VALUES('${project}','Tab 1','${l(null).replace(/c-h/, "c-t").replace("Hashiko", "Tony")}',6);`);
  await sh(panel, `CREATE TABLE prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE agents(address TEXT PRIMARY KEY, name TEXT, title TEXT, said INTEGER, space TEXT, project TEXT, at INTEGER, program TEXT, seen INTEGER NOT NULL);
    INSERT INTO prefs VALUES('spaces.view','threads');
    INSERT INTO agents VALUES('t3q','Hashiko','Memory leaks',9,'sp-shield','${project}',2,NULL,1);`);
  return { sleep, panel };
}
async function storeIn(t, dir, run = exec, host = {}) {
  const { Store } = await load("kanso-spaces/store.js", ["Store"], { exec: run, appHome: () => dir, ...host });
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec: run, appHome: () => dir, ...host });
  const db = new Kdb(join(dir, "kanso"));
  return { store: new Store(db, dir), db };
}

test("what sleep.db and panel.db held is taken in once: every agent asleep, every pane kept, each space found by its name", async (t) => {
  const dir = await temporary(t);
  await legacy(dir);
  const { store, db } = await storeIn(t, dir);
  const rows = clone(await store.asleep(true));
  assert.deepEqual(rows.map((r) => [r.name, r.spaceId, r.space, r.cols[0].panes.length]).sort(), [["Hashiko", null, "herdr-kanso", 2], ["Tab 1", null, "herdr-kanso", 2]]);
  assert.deepEqual(clone(await db.read("SELECT id, name, space_id, status FROM agents ORDER BY id")),
    [{ id: "c-h", name: "Hashiko", space_id: null, status: "asleep" }, { id: "c-t", name: "Tony", space_id: null, status: "asleep" }],
    "nothing taken from what panel.db kept by terminal address (it may be another agent's): t3q said shield");
  assert.deepEqual(clone(await db.prefs()), [{ key: "spaces.view", value: "threads" }]);
  const first = rows.find((r) => r.name === "Hashiko");
  assert.deepEqual(first.into, { tab: null, tabId: "tb1" });
  // The sidebar finds the space that fits by name and keeps it by id.
  const { spaceFor } = await database(t, dir);
  await db.adoptSpaces(rows.map((r) => ({ sleep: r.id, space: spaceFor({ spaceName: r.space, project: r.from }, spaces)?.id })));
  assert.deepEqual(clone((await db.read("SELECT DISTINCT space_id FROM agents"))), [{ space_id: "sp-kanso" }], "herdr-kanso, not shield");
  // Woken, then another window (or a restart) opens: nothing comes back.
  const c = await store.claim(first.id);
  await store.woke(first.id, c.token);
  const again = (await storeIn(t, dir)).store;
  assert.deepEqual(clone((await again.asleep(true)).map((r) => r.name)), ["Tab 1"], "taken in once: what woke never comes back");
});

test("an agent the old file had asleep twice stays only in the newest sleep", async (t) => {
  const dir = await temporary(t);
  const { sleep } = await legacy(dir);
  await sh(sleep, `UPDATE asleep SET layout=replace(layout,'"c-t"','"c-h"') WHERE name='Tab 1';`);
  const { store, db } = await storeIn(t, dir);
  const rows = clone(await store.asleep(true));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.cols.flatMap((c) => c.panes).map((p) => p.resume)]));
  assert.deepEqual(byName, { "Tab 1": ["c-h", null], Hashiko: [null] }, "the older keeps only its shell");
  assert.deepEqual(clone(await db.read("SELECT id, sleep_id FROM agents")), [{ id: "c-h", sleep_id: rows.find((r) => r.name === "Tab 1").id }]);
});

test("the migration is all or nothing, a row it can't read is left behind, and two windows never both do it", async (t) => {
  const dir = await temporary(t);
  const { sleep } = await legacy(dir);
  await sh(sleep, `INSERT INTO asleep VALUES('${project}','broken','{"cols":"not an array"}',7);`);
  // A failure half way (an agent's step): nothing of it stays, and it is tried again.
  const failing = async (c, a, o) => exec(c, c === "sqlite3" ? a.map((x) => (x.startsWith("INSERT INTO agents(id,name,cwd,status,seen,sleep_id) SELECT") ? "INSERT INTO nowhere VALUES(1);" : x)) : a, o);
  await assert.rejects((await storeIn(t, dir, failing)).store.asleep(), /nowhere/);
  const { db } = await storeIn(t, dir);
  assert.equal((await db.sleeps()).length, 0, "nothing of a failed one stays");
  assert.equal(await db.migrated(), false, "so it is tried again");
  const [one, two] = [await storeIn(t, dir), await storeIn(t, dir)];
  await Promise.all([one.store.asleep(), two.store.asleep()]);
  assert.deepEqual(clone((await db.sleeps()).map((r) => r.name).sort()), ["Hashiko", "Tab 1"], "two windows at once: taken in once; the broken row left behind");
  assert.equal(await db.migrated(), true);
});

test("an old file that can't be read now stops the migration until it can, never passes it by", async (t) => {
  const dir = await temporary(t);
  await legacy(dir);
  let locked = true;
  const run = async (c, a, o) => (locked && c === "sqlite3" && a.includes("-readonly") ? { code: 5, stdout: "", stderr: "database is locked" } : exec(c, a, o));
  const { store, db } = await storeIn(t, dir, run);
  await assert.rejects(store.asleep(), /could not be read: database is locked/);
  assert.equal(await db.migrated(), false);
  locked = false;
  assert.equal((await store.asleep(true)).length, 2, "read once it can be: nothing lost");
});

test("a path with a quote in it is read as it is", async (t) => {
  const dir = join(await temporary(t), "O'Brien");
  await mkdir(dir, { recursive: true });
  await legacy(dir);
  const { store } = await storeIn(t, dir);
  assert.equal((await store.asleep(true)).length, 2);
});

test("waking all agents of a tab but a shell: the agents wake, the shell stays to open", async (t) => {
  const { db } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1", null), agents: [{ conversation: "c1" }] });
  await db.settle(id, token);
  const a = await db.claim(id);
  assert.equal(await db.narrow(id, layout(null), [], { wake: a.token }), true);
  assert.deepEqual(clone(await db.read("SELECT status, sleep_id FROM agents")), [{ status: "unknown", sleep_id: null }], "none kept: every agent is awake");
  await db.syncSpaces(spaces);
  await db.syncSpaces([]);
  assert.equal((await db.read("SELECT id FROM spaces WHERE gone IS NULL")).length, 0, "no spaces now: all gone");
});

test("a sleep that lost its row knows it before it touches an agent", async (t) => {
  const { db, STALE_MS } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1" }], now: 0 });
  assert.equal(await db.holdSleep(id, token, 1000), true, "renewed while its agents leave");
  assert.equal(await db.claim(id, 1000 + STALE_MS - 1), null, "renewed: not to be woken");
  const b = await db.claim(id, 1000 + STALE_MS + 1);
  assert.ok(b);
  assert.equal(await db.holdSleep(id, token), false, "another window has it: nothing more of this sleep");
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
    await assert.rejects(store.asleep(), /could not be (looked at|read)/);
    assert.equal(await db.migrated(), false, "nothing marked: it is taken in once it can be read");
    denied = false;
    assert.equal((await store.asleep(true)).length, 2);
  });
}

test("one conversation twice in one old tab is taken in once", async (t) => {
  const dir = await temporary(t);
  const { sleep } = await legacy(dir);
  await sh(sleep, `UPDATE asleep SET layout=replace(layout,'"resume":null','"resume":"c-h"') WHERE name='Hashiko';`);
  const { store } = await storeIn(t, dir);
  const h = (await store.asleep(true)).find((r) => r.name === "Hashiko");
  assert.deepEqual(clone(h.cols.flatMap((c) => c.panes).map((p) => p.resume)), ["c-h"]);
  await assert.rejects(store.sleep(project, { name: "dup", space: spaces[0], cols: [{ w: 1, panes: [{ resume: "c9" }, { resume: "c9" }] }] }), /same conversation/, "nor can a new sleep have it twice");
});

test("a name a wake could not put back is kept until its terminal has it again", async (t) => {
  const { db } = await database(t);
  await db.observe([seen("c1", "Hashiko", "sp-kanso", 0)], 100);
  await db.toRestore("c1", "Hashiko");
  await db.observe([seen("c1", null, "sp-kanso", 0, "idle", "t9")], 200);
  assert.deepEqual(clone(await db.read("SELECT name, restore FROM agents")), [{ name: "Hashiko", restore: "Hashiko" }], "seen without it: kept");
  await db.observe([seen("c1", "Hashiko", "sp-kanso", 0, "idle", "t9")], 300);
  assert.deepEqual(clone(await db.read("SELECT name, restore FROM agents")), [{ name: "Hashiko", restore: null }], "back on its terminal: done");
});


test("a name a wake keeps to put back is written with the wake itself, or not at all", async (t) => {
  const { db } = await database(t);
  await db.observe([seen("c1", "Hashiko", "sp-kanso", 0)], 100);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1"), agents: [{ conversation: "c1", given: "Hashiko" }] });
  await db.settle(id, token);
  const a = await db.claim(id);
  assert.equal(await db.woke(id, "lost", [["c1", "Hashiko"]]), false);
  assert.equal((await db.read("SELECT restore FROM agents"))[0].restore, null, "a wake that does not hold the row writes nothing");
  assert.equal(await db.woke(id, a.token, [["c1", "Hashiko"]]), true);
  assert.equal((await db.read("SELECT restore FROM agents"))[0].restore, "Hashiko");
});

test("a sleep that stopped half way loses its row for good once a wake claims it", async (t) => {
  const { db, STALE_MS } = await database(t);
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: layout("c1", "c2"), agents: [{ conversation: "c1" }, { conversation: "c2" }], now: 0 });
  const w = await db.claim(id, STALE_MS + 1);
  assert.ok(w);
  assert.equal(await db.narrow(id, layout("c2"), ["c2"], { wake: w.token }), true, "the wake leaves c2 asleep");
  assert.equal(await db.holdSleep(id, token), false, "the old sleep can't take it back");
  assert.equal(await db.drop(id, token), false);
  assert.equal(await db.narrow(id, layout(), [], { sleep: token }), false);
  assert.equal((await db.sleeps()).length, 1, "c2 still asleep");
});

test("one window at a time makes the space in place of a gone one, and every wake after takes that one", async (t) => {
  const { db, STALE_MS } = await database(t);
  assert.equal(await db.replacing("sp-gone", "w1", 1000), true, "the first wake makes it");
  assert.equal(await db.replacing("sp-gone", "w2", 2000), false, "another window waits for it");
  assert.equal(await db.replacement("sp-gone"), null);
  await db.moveSpace("sp-gone", "sp-new");
  assert.equal(await db.replacement("sp-gone"), "sp-new", "a wake that still has the old id finds the new one");
  assert.equal(await db.replacing("sp-gone", "w3", 3000), true, "done: nothing held");
  assert.equal(await db.replacing("sp-gone", "w4", 3000 + STALE_MS + 1), true, "one that stopped long ago holds nothing");
  await db.unreplacing("sp-gone", "w3");
  assert.equal(await db.replacing("sp-gone", "w5", 4000 + STALE_MS), false, "only its own hold is let go: w4 still has it");
});

test("only the wake that holds the making of a space moves what slept in the gone one", async (t) => {
  const { db } = await database(t);
  await db.open();
  await db.replacing("sp-gone", "w1", Date.now());
  await db.moveSpace("sp-gone", "sp-b", "w2");
  assert.equal(await db.replacement("sp-gone"), null, "w2 does not hold it: nothing moved, no mapping");
  await db.moveSpace("sp-gone", "sp-a", "w1");
  assert.equal(await db.replacement("sp-gone"), "sp-a");
});

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

test("a sleep that stopped half way lets go of the agent it never ended, once no window holds its row", async (t) => {
  const { db, STALE_MS, ABANDON_MS } = await database(t);
  assert.ok(ABANDON_MS < STALE_MS, "a sleep is given up on sooner than a wake: it renews its hold before each agent leaves");
  const live = (c, terminal, pid) => ({ ...seen(c, null, "sp-kanso", 0, "idle", terminal), program: "{\"kind\":\"claude-code\"}", pid });
  const panes = { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1", pid: 11 }, { argv: ["claude"], resume: "c2", pid: 12 }] }] };
  const saved = 1000;
  // The window closed while c1 was leaving: its row stays pending, c1 and c2 keep running as they were.
  const { id } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, now: saved, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  const still = [live("c1", "t1", 11), live("c2", "t2", 12)];
  assert.deepEqual(clone(await db.awake(still, saved + ABANDON_MS - 1)), [], "while the sleep may still be going, nothing moves");
  const other = await db.sleepTab({ name: "done", space: spaces[2], project, layout: { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c3", pid: 13 }] }] }, saved, now: saved, agents: [{ conversation: "c3" }] });
  await db.settle(other.id, other.token);
  assert.deepEqual(clone(await db.awake([live("c3", "t3", 13)], saved + STALE_MS + 1)), [], "a settled sleep is never abandoned: a late sighting of its old pid leaves it");
  await assert.rejects(db.sleepTab({ name: "again", space: spaces[2], project, layout: panes, agents: [{ conversation: "c1" }], now: saved + ABANDON_MS - 1 }), /already asleep/, "until then the tab can't sleep again");
  assert.deepEqual(clone(await db.awake(still, saved + STALE_MS + 1)), [id], "abandoned: the agents it never ended are awake, and the sleep is over");
  assert.deepEqual(clone((await db.sleeps()).map((s) => s.id)), [other.id]);
  assert.deepEqual(clone(await db.read("SELECT id, status, sleep_id FROM agents WHERE id IN ('c1','c2') ORDER BY id")), [{ id: "c1", status: "unknown", sleep_id: null }, { id: "c2", status: "unknown", sleep_id: null }]);
  const next = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  assert.ok(next.id, "and the tab sleeps again under its own name");
});

test("sleeping a tab again lets go of what a sleep that stopped half way still holds, right there", async (t) => {
  const { db, ABANDON_MS } = await database(t);
  const panes = { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1", pid: 11 }, { argv: ["claude"], resume: "c2", pid: 12 }] }] };
  const saved = 1000;
  // The first try wrote its row and marked both, then its window closed. The person tries again, minutes later.
  const first = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, now: saved, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  const again = await db.sleepTab({ name: "tab 2", space: spaces[2], project, layout: panes, saved: saved + ABANDON_MS + 1, now: saved + ABANDON_MS + 1, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  assert.deepEqual(clone((await db.sleeps()).map((s) => [s.id, s.agents.map((a) => a.id).toSorted()])), [[again.id, ["c1", "c2"]]], "the abandoned sleep is gone with nothing left in it; the new one has both");
  assert.equal(await db.holdSleep(first.id, first.token), false, "its window, back late, holds nothing");
  // One of them only: the abandoned sleep keeps the other under a token its window never had.
  const third = await db.sleepTab({ name: "c3", space: spaces[2], project, layout: panes, saved, now: saved, agents: [{ conversation: "c3" }, { conversation: "c4" }] });
  await db.sleepTab({ name: "just c3", space: spaces[2], project, layout: panes, saved: saved + ABANDON_MS + 1, now: saved + ABANDON_MS + 1, agents: [{ conversation: "c3" }] });
  const [left] = (await db.sleeps()).filter((s) => s.id === third.id);
  assert.deepEqual([clone(left.agents.map((a) => a.id)), left.pending === third.token], [["c4"], false]);
});

test("an abandoned sleep that another window resumes and settles between the read and the write is kept", async (t) => {
  const { db, STALE_MS } = await database(t);
  const live = (c, terminal, pid) => ({ ...seen(c, null, "sp-kanso", 0, "idle", terminal), program: "{\"kind\":\"claude-code\"}", pid });
  const panes = { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1", pid: 11 }] }] };
  const saved = 1000;
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, now: saved, agents: [{ conversation: "c1" }] });
  const reading = db.sleeps.bind(db);
  // Its window comes back right after the read: it ends the agent and settles the sleep.
  const racing = Object.assign(Object.create(db), { sleeps: async () => { const rows = await reading(); await db.settle(id, token); return rows; } });
  assert.deepEqual(clone(await racing.awake([live("c1", "t1", 11)], saved + STALE_MS + 1)), [], "the write finds the row settled and leaves it");
  assert.deepEqual(clone((await db.sleeps()).map((s) => [s.id, s.agents.map((a) => a.id)])), [[id, ["c1"]]], "the sleep and its agent stay, to wake from the list");
});

test("an abandoned sleep let go of in part loses its token: its window, back late, can't end and settle what left it", async (t) => {
  const { db, STALE_MS } = await database(t);
  const live = (c, terminal, pid) => ({ ...seen(c, null, "sp-kanso", 0, "idle", terminal), program: "{\"kind\":\"claude-code\"}", pid });
  const panes = { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1", pid: 11 }, { argv: ["claude"], resume: "c2", pid: 12 }] }] };
  const saved = 1000;
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, now: saved, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  assert.deepEqual(clone(await db.awake([live("c2", "t2", 12)], saved + STALE_MS + 1)), [id], "c2, still running, is let go; c1 (gone) stays asleep");
  const [row] = await db.sleeps();
  assert.deepEqual(clone([row.agents.map((a) => a.id), JSON.parse(row.layout).cols[0].panes.map((p) => p.resume), row.pending === token, row.pending_at]), [["c1"], ["c1"], false, saved]);
  assert.equal(await db.holdSleep(id, token, saved + STALE_MS + 2), false, "the window that started it holds nothing now");
  assert.equal(await db.settle(id, token), false);
  assert.deepEqual(clone(await db.awake([live("c1", "t1", 11)], saved + STALE_MS + 3)), [id], "still abandoned: c1 seen running later is let go too, and the sleep ends");
});

test("an agent of a sleep seen running again is awake: the sleep lets it go, and ends when none is left asleep", async (t) => {
  const { db } = await database(t);
  const live = (c, terminal, pid) => ({ ...seen(c, null, "sp-kanso", 0, "idle", terminal), program: "{\"kind\":\"claude-code\"}", pid });
  const panes = { per: null, cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1", pid: 11 }, { argv: ["claude"], resume: "c2", pid: 12 }] }] };
  const saved = Date.now();
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, agents: [{ conversation: "c1" }, { conversation: "c2" }] });
  assert.deepEqual(clone(await db.awake([live("c1", "t1", 11)], saved + 1)), [], "the process a sleep is ending still runs: left alone");
  assert.deepEqual(clone(await db.awake([live("c1", "t7", 21)], saved + 1)), [], "a sleep still going is left alone");
  await db.settle(id, token);
  assert.deepEqual(clone(await db.awake([live("c1", "t7", 21)], saved - 1)), [], "a sighting from before the sleep wakes no one");
  assert.deepEqual(clone(await db.awake([live("c1", "t1", 11)], saved + 1)), [], "settled: every agent left, so the old pid seen after is a late sighting, not a new process");
  assert.deepEqual(clone(await db.awake([{ ...live("c1", "t7", 21), program: null }], saved + 1)), [], "a terminal with no agent in front wakes no one");
  assert.deepEqual(clone(await db.awake([live("c1", "t7", 21)], saved + 1)), [id]);
  const [row] = await db.sleeps();
  assert.deepEqual(clone(row.agents.map((a) => a.id)), ["c2"], "the other one stays asleep");
  assert.deepEqual(clone(JSON.parse(row.layout).cols[0].panes.map((p) => p.resume)), ["c2"], "and is all that a wake opens");
  await db.observe([live("c1", "t7", 21)], saved + 2);
  assert.equal(clone(await db.read("SELECT status FROM agents WHERE id='c1'"))[0].status, "idle", "the sighting shows it as it runs");
  const claim = await db.claim(id, saved + 3);
  assert.deepEqual(clone(await db.awake([live("c2", "t8", 22)], saved + 4)), [], "a wake in progress is left alone");
  await db.release(id, claim.token);
  assert.deepEqual(clone(await db.awake([live("c2", "t8", 22)], saved + 5)), [id], "released: free again");
  assert.deepEqual(clone(await db.sleeps()), [], "no one left asleep: the sleep is over");
});

test("two windows freeing different agents of one sleep never lose each other's change", async (t) => {
  const { db, dir } = await database(t);
  const other = new (await database(t, dir)).Kdb(join(dir, "kanso"));
  const live = (c, pid) => ({ ...seen(c, null, "sp-kanso", 0, "idle", `t${pid}`), program: "{}", pid });
  const panes = { per: null, cols: [{ w: 1, panes: ["c1", "c2", "c3"].map((c, i) => ({ argv: ["claude"], resume: c, pid: i + 1 })) }] };
  const saved = Date.now();
  const { id, token } = await db.sleepTab({ name: "tab", space: spaces[2], project, layout: panes, saved, agents: ["c1", "c2", "c3"].map((conversation) => ({ conversation })) });
  await db.settle(id, token);
  await Promise.all([db.awake([live("c1", 21)], saved + 1), other.awake([live("c2", 22)], saved + 1)]);
  await db.awake([live("c1", 21)], saved + 2); await other.awake([live("c2", 22)], saved + 2);
  const [row] = await db.sleeps();
  assert.deepEqual(clone(row.agents.map((a) => a.id)), ["c3"]);
  assert.deepEqual(clone(JSON.parse(row.layout).cols[0].panes.map((p) => p.resume)), ["c3"], "every freed agent's pane is gone, whichever window went first");
});

test("a sleep's layout without some conversations keeps the rest, widths shared", async () => {
  const { layoutWithout } = await load("kanso-spaces/kdb.js", ["layoutWithout"], { exec, appHome: () => "/tmp" });
  const two = { per: 4, cols: [{ w: 0.5, panes: [{ resume: "a" }] }, { w: 0.5, panes: [{ resume: "b" }, { resume: null }] }] };
  assert.deepEqual(clone(layoutWithout(two, ["a"])), { per: 4, cols: [{ w: 1, panes: [{ resume: "b" }, { resume: null }] }] });
  assert.deepEqual(clone(layoutWithout(two, ["b"])).cols.map((c) => c.panes.length), [1, 1]);
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
