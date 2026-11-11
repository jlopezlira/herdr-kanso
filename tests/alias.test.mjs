// A computer's name: one function, one row per route, the writer's clock.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec } from "./helpers.mjs";

const names = ["aliasOf", "renameTo", "placeAlias", "bookOf", "selfOf", "publishNames", "deliversNow", "catchUp", "mergeBooks", "takeAsks", "askedAlias", "Names"];
const alias = await load("kanso-spaces/alias.js", names);

const gap = 5 * 60 * 1000;

test("two computers five minutes apart: the writer's name wins, and a fast clock does not bury it", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(clone(alias.placeAlias({ name: "Night", at: now + gap }, { name: "Cave", at: now }, now)), { name: "Cave", at: now + gap });
  assert.deepEqual(clone(alias.placeAlias({ name: "Cave", at: now - gap }, { name: "Night", at: now }, now)), { name: "Night", at: now });
  assert.deepEqual(clone(alias.placeAlias({ name: "Night", at: now }, { name: "Cave", at: now - gap }, now - gap)), { name: "Cave", at: now });
  assert.deepEqual(clone(alias.placeAlias({ name: "Night", at: now }, { name: "Cave", at: now - gap }, now)), { name: "Night", at: now });
  assert.deepEqual(clone(alias.placeAlias({ name: "Night", at: now }, { name: "", at: now + 1 }, now + 1)), { name: "", at: now + 1 });
  assert.deepEqual(clone(alias.placeAlias({ name: "Night", at: now }, { name: "", at: now - gap }, now)), { name: "Night", at: now });
});

test("a rename is the computer's own row, and a third computer is another route", () => {
  assert.equal(alias.renameTo(null, "macbook", 3), null);
  assert.deepEqual(clone(alias.renameTo("macbook", "macbook", 3)), { name: "", at: 3 });
  assert.deepEqual(clone(alias.renameTo("Studio", "macbook", 3)), { name: "Studio", at: 3 });
  const home = alias.askedAlias({}, { route: "", text: "Studio", at: 10 }, { hostName: "macbook" });
  assert.equal(home.save.route, "");
  assert.equal(home.save.pending, 0);
  assert.equal(home.remote, null);
  assert.equal(alias.askedAlias({}, { route: "", text: "macbook", at: 4 }, { hostName: "macbook" }), null);
  assert.equal(alias.askedAlias({}, { route: "", text: null, at: 4 }, { hostName: "macbook" }), null);
  const dark = alias.askedAlias({}, { route: "dark", text: "Night", at: 3 });
  const third = alias.askedAlias(dark.book, { route: "light", text: "Day", at: 4 });
  assert.equal(third.book.dark.name, "Night");
  assert.equal(third.book.light.name, "Day");
  assert.deepEqual(clone(alias.publishNames(third.book)), { dark: "Night", light: "Day" });
  assert.deepEqual(clone(alias.takeAsks({ local: { text: "Studio", at: 2 }, dark: { text: "Night", at: 1 } }, 0)), [
    { route: "dark", text: "Night", at: 1 },
    { route: "", text: "Studio", at: 2 },
  ]);
});

test("a rename while the other computer is off waits, and the next read of it catches up", () => {
  assert.equal(alias.deliversNow("dark", "Off"), false);
  assert.equal(alias.deliversNow("dark", ""), true);
  assert.equal(alias.deliversNow("", ""), false);
  const off = alias.askedAlias({}, { route: "dark", text: "Cave", at: 5 }, { phaseWord: "Off" });
  assert.equal(off.remote, null);
  assert.equal(off.book.dark.pending, 1);
  const waiting = alias.catchUp(off.book.dark, null, 5);
  assert.equal(waiting.row.pending, 1);
  assert.deepEqual(clone(waiting.write), { name: "Cave", at: 5 });
  const landed = alias.catchUp(off.book.dark, { name: "Cave", at: 5 }, 9);
  assert.equal(landed.write, null);
  assert.equal(landed.row.pending, 0);
  assert.equal(landed.show.name, "Cave");
});

test("the newer name wins, and clearing the name is a change", () => {
  const now = 100;
  const memory = { dark: { name: "Cave", at: 40, pending: 1 } };
  const stored = { dark: { name: "Night", at: 10, pending: 0 }, "": { name: "Studio", at: 80, pending: 0 } };
  const book = alias.mergeBooks(memory, alias.bookOf([{ route: "dark", name: "Night", at: 10, pending: 0 }, { route: "", name: "Studio", at: 80, pending: 0 }]), now);
  assert.equal(book.dark.name, "Cave");
  assert.equal(book.dark.pending, 1);
  assert.equal(book[""].name, "Studio");
  const cleared = alias.mergeBooks({ dark: { name: "", at: 90, pending: 1 } }, stored, now);
  assert.equal(cleared.dark.name, "");
  assert.equal(cleared.dark.pending, 1);
  assert.equal(alias.aliasOf(book, "dark"), "Cave");
  assert.equal(alias.selfOf([{ route: "dark", name: "Night", at: 10 }, { route: "", name: "Studio", at: 80 }]).name, "Studio");
});

async function database(t) {
  const dir = await temporary(t);
  const calls = [];
  const { Kdb, machinesToAsk, restDue } = await load("kanso-spaces/kdb.js", ["Kdb", "machinesToAsk", "restDue"], {
    appHome: () => dir,
    exec: (command, args) => { calls.push([command, args]); return exec(command, args); },
  });
  const db = new Kdb();
  await db.open();
  calls.length = 0;
  return { db, calls, machinesToAsk, restDue };
}

const sqlOf = (call) => (call?.[1] ?? []).join("\n");

test("a computer Herdr lists stays listed with nothing open, and one it no longer lists does not", async (t) => {
  const { machinesToAsk, restDue } = await database(t);
  assert.deepEqual(clone(machinesToAsk([{ name: "light" }, { name: "dark", layout: "unavailable" }, { name: null }], [])), ["light", "dark"]);
  assert.deepEqual(clone(machinesToAsk([{ name: "dark", layout: "ready" }, { name: null }], [])), ["dark"]);
  assert.deepEqual(clone(machinesToAsk([{ name: null }], [])), []);
  assert.equal(restDue({ readAt: 1_000, ordered: false, now: 2_000, active: true, showing: true }), false);
  assert.equal(restDue({ readAt: null, ordered: false, now: 2_000, active: false, showing: true }), false);
});

test("the alias rides the sleep read, and a write in that read is still one process", async (t) => {
  const now = 1_700_000_000_000;
  const { db, calls } = await database(t);
  await db.sleeps();
  assert.equal(calls.length, 1, `sleep read started ${calls.length} processes`);
  assert.match(sqlOf(calls[0]), /SELECT route, name, at, pending FROM computer_alias/);
  calls.length = 0;
  await db.sleeps(null, now, { route: "", name: "Cave", at: now, pending: 0 });
  assert.equal(calls.length, 1, `rename inside the read started ${calls.length} processes`);
  assert.match(sqlOf(calls[0]), /INSERT INTO computer_alias/);
  assert.equal(db.seenAlias.find((row) => row.route === "").name, "Cave");
  assert.equal((await db.read("SELECT name FROM computer_alias WHERE route='';"))[0].name, "Cave");
  calls.length = 0;
  await db.sleeps(null, now, [{ route: "", name: "Cave", at: now, pending: 0 }, { route: "dark", name: "Night", at: now, pending: 0 }]);
  assert.equal(calls.length, 1, `two rows inside the read started ${calls.length} processes`);
  assert.equal(db.seenAlias.find((row) => row.route === "dark").name, "Night");
});

test("a failed local save stays pending and the next read writes it", async () => {
  const bag = { "kanso.alias.ask": { local: { text: "Studio", at: 10 } } };
  const { Names } = await load("kanso-spaces/alias.js", ["Names"], {
    shared: (key) => bag[key],
    setShared: (key, value) => { bag[key] = value; },
  });
  const names = new Names({
    hostName: "macbook",
    phaseOf: () => "connected",
    db: () => ({ saveAlias: () => Promise.reject(new Error("disk")) }),
  });
  names.take({ notify() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(names.book[""].pending, 1);
  assert.deepEqual(clone(names.pending()), [{ route: "", name: "Studio", at: 10, pending: 0 }]);
  names.absorb([{ route: "", name: "Studio", at: 10, pending: 0 }], 10);
  assert.equal(names.book[""].pending, 0);
  assert.equal(names.pending(), null);
});

test("a row five minutes ahead keeps its later time and still takes the name written now", async (t) => {
  const now = 1_700_000_000_000;
  const { db } = await database(t);
  await db.saveAlias({ route: "", name: "Night", at: now + gap, pending: 0 }, now);
  assert.deepEqual(clone(await db.saveAlias({ route: "", name: "Cave", at: now, pending: 0 }, now)), [{ name: "Cave", at: now + gap, pending: 0 }]);
  assert.deepEqual(clone(await db.saveAlias({ route: "", name: "Old", at: now - gap, pending: 0 }, now)), []);
  assert.deepEqual(clone(await db.read("SELECT name, at FROM computer_alias WHERE route='';")), [{ name: "Cave", at: now + gap }]);
  await db.saveAlias({ route: "step", name: "Night", at: now, pending: 0 }, now);
  assert.deepEqual(clone(await db.saveAlias({ route: "step", name: "Cave", at: now - gap, pending: 0 }, now - gap)), [{ name: "Cave", at: now, pending: 0 }]);
});
