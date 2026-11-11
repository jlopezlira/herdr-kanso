// Every view has its own queue and cache: a view gone mid-call never holds up the next one.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec } from "./helpers.mjs";

const never = () => new Promise(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));
function within(promise, ms = 2000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("never settled")), ms); })]).finally(() => clearTimeout(timer));
}

async function views(t) {
  const dir = await temporary(t), calls = [], host = { hang: false };
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], {
    appHome: () => dir,
    exec: (command, args) => { calls.push([command, args]); return host.hang ? never() : exec(command, args); },
  });
  return { Kdb, calls, host };
}

test("a view gone while its call runs never holds up another view's calls", async (t) => {
  const { Kdb, host } = await views(t);
  const gone = new Kdb();
  await gone.open();
  host.hang = true;
  gone.read("SELECT 1;");
  await turn();
  host.hang = false;
  assert.deepEqual(clone(await within(new Kdb().read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

test("a flush that never ran holds up only its own view", async (t) => {
  const { Kdb } = await views(t);
  const gone = new Kdb();
  gone.flush = () => {};
  gone.read("SELECT 1;");
  await turn();
  assert.deepEqual(clone(await within(new Kdb().read("SELECT 2 AS two;"))), [{ two: 2 }]);
});

test("the schema is opened once per file, whichever view opens it first", async (t) => {
  const { Kdb, calls } = await views(t);
  await new Kdb().open();
  await new Kdb().read("SELECT 1;");
  assert.equal(calls.filter(([command, args]) => command === "sqlite3" && args[0] === "-version").length, 1);
  assert.equal(calls.filter(([command]) => command === "mkdir").length, 1);
});
