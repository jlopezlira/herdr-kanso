// Every view has its own queue and cache: a view gone mid-call never holds up the next one.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec } from "./helpers.mjs";

const never = () => new Promise(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));
// Only a guard against hanging: opening the schema alone takes about 4 s on Windows CI.
const SETTLE_LIMIT_MS = 20000;
function within(promise, ms = SETTLE_LIMIT_MS) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("never settled")), ms); })]).finally(() => clearTimeout(timer));
}

// lose() makes the next command the one Herdr loses; it resolves once that command was asked for.
async function views(t) {
  const dir = await temporary(t), calls = [], host = { lost: null };
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], {
    appHome: () => dir,
    exec: (command, args) => {
      calls.push([command, args]);
      if (!host.lost) return exec(command, args);
      host.lost();
      host.lost = null;
      return never();
    },
  });
  return { Kdb, calls, lose: () => new Promise((resolve) => { host.lost = resolve; }) };
}

test("a view gone while its call runs never holds up another view's calls", async (t) => {
  const { Kdb, lose } = await views(t);
  const gone = new Kdb();
  await gone.open();
  const lost = lose();
  gone.read("SELECT 1;").catch(() => {});
  await lost;
  assert.deepEqual(clone(await within(new Kdb().read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

test("a flush that never ran holds up only its own view", async (t) => {
  const { Kdb } = await views(t);
  const gone = new Kdb();
  await gone.open();
  gone.flush = () => {};
  gone.read("SELECT 1;").catch(() => {});
  await turn();
  assert.equal(gone.queue.length, 1);
  assert.deepEqual(clone(await within(new Kdb().read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

test("the schema is opened once per file, whichever view opens it first", async (t) => {
  const { Kdb, calls } = await views(t);
  await new Kdb().open();
  await new Kdb().read("SELECT 1;");
  assert.equal(calls.filter(([command, args]) => command === "sqlite3" && args[0] === "-version").length, 1);
  assert.equal(calls.filter(([command]) => command === "mkdir").length, 1);
});

test("an abandoned call no longer holds up its own view's next calls", async (t) => {
  const { Kdb, lose } = await views(t);
  const db = new Kdb();
  await db.open();
  const lost = lose();
  db.read("SELECT 1;").catch(() => {});
  await lost;
  db.abandon();
  assert.deepEqual(clone(await within(db.read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

async function clocked(t) {
  const dir = await temporary(t);
  const waits = [];
  const timer = { after(ms, fn) { waits.push({ ms, fn }); } };
  let hang = false;
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], {
    appHome: () => dir,
    exec: (command, args) => (hang && command === "sqlite3" ? never() : exec(command, args)),
  });
  return { db: () => new Kdb(undefined, null, timer), waits, hang: (on) => { hang = on; } };
}

async function armed(waits, n) {
  for (let i = 0; i < 80 && waits.length < n; i += 1) await Promise.resolve();
}

test("a call that never settles is dropped and the next read answers", async (t) => {
  const { db: openDb, waits, hang } = await clocked(t);
  const db = openDb();
  await db.open();
  const mark = waits.length;
  hang(true);
  const lost = db.read("SELECT 1 AS one;");
  await armed(waits, mark + 1);
  assert.equal(waits.at(-1).ms, 15_000);
  const failed = assert.rejects(lost, /did not answer/);
  waits.at(-1).fn();
  await failed;
  hang(false);
  assert.deepEqual(clone(await within(db.read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

test("a timer from a dropped call does not drop the next read", async (t) => {
  const { db: openDb, waits, hang } = await clocked(t);
  const db = openDb();
  await db.open();
  const mark = waits.length;
  hang(true);
  const lost = db.read("SELECT 1 AS one;");
  await armed(waits, mark + 1);
  const stale = waits.length - 1;
  db.abandon();
  hang(false);
  const failed = assert.rejects(lost, /did not answer/);
  waits[stale].fn();
  const next = db.read("SELECT 2 AS two;");
  assert.deepEqual(clone(await within(next)), [{ two: 2 }]);
  await failed;
});

test("a create that never settles is dropped and the next open answers", async (t) => {
  const { db: openDb, waits, hang } = await clocked(t);
  hang(true);
  const db = openDb();
  const opening = db.open();
  await armed(waits, 1);
  assert.equal(waits.at(-1).ms, 15_000);
  const failed = assert.rejects(opening, /did not answer/);
  waits.at(-1).fn();
  await failed;
  hang(false);
  await db.open();
  assert.deepEqual(clone(await within(db.read("SELECT 2 AS two;"))), [{ two: 2 }]);
});
