import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec } from "./helpers.mjs";
import { BUSY_MS, CALL_MS, sqliteLimit } from "../kanso/mods/kanso-panel/platform-sqlite.js";

const never = () => new Promise(() => {});
const drain = async () => { for (let n = 0; n < 100; n += 1) await Promise.resolve(); };
const clock = () => {
  const waits = [];
  return { waits, after(ms, fn) { waits.push({ ms, fn }); } };
};

for (const file of ["kanso-arrange/store.js", "kanso-dojo/store.js", "kanso-help/store.js", "kanso-panel/shipped-store.js", "kanso-spaces/kdb.js"]) {
  test(`${file} requires a view timer and drops a lost call`, async () => {
    const timer = clock();
    let lost = true;
    const name = file.endsWith("kdb.js") ? "Kdb" : "Store";
    const mod = await load(file, [name], { appHome: () => "/test", exec: () => lost ? never() : { code: 0, stdout: "", stderr: "" } });
    const Constructor = mod[name];
    assert.throws(() => new Constructor(), /view's timer/);
    assert.throws(() => new Constructor({}), /view's timer/);
    const db = new Constructor(timer);
    const pending = db.sql("SELECT 1;");
    const failed = assert.rejects(pending, /did not answer/);
    await drain();
    assert.ok(timer.waits.every((wait) => wait.ms > BUSY_MS));
    timer.waits.at(-1).fn();
    await failed;
    lost = false;
    await db.sql("SELECT 2;");
  });
}

test("the left nav Store requires an injected bounded database", async () => {
  const { Store } = await load("kanso-spaces/store.js", ["Store"], { appHome: () => "/test" });
  assert.throws(() => new Store(), /needs its database/);
  assert.throws(() => new Store({}), /view's timer/);
});

test("a fake execute that loses the first batch does not block the next read", async (t) => {
  const dir = await temporary(t), timer = clock();
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { appHome: () => dir, exec });
  const db = new Kdb(timer);
  await db.open();
  const execute = db.execute.bind(db);
  let first = true;
  db.execute = (text) => { if (!first) return execute(text); first = false; return never(); };
  const lost = db.read("SELECT 1 AS n;");
  const failed = assert.rejects(lost, /did not answer/);
  await drain();
  assert.equal(timer.waits.at(-1).ms, sqliteLimit(["SELECT 1 AS n;", ".print marker:0"]) + BUSY_MS);
  timer.waits.at(-1).fn();
  await failed;
  assert.deepEqual(clone(await db.read("SELECT 2 AS n;")), [{ n: 2 }]);
});

test("Windows schema creation may take over thirty seconds without a false deadline", async () => {
  const timer = clock(), calls = [], scripts = [];
  let finish;
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], {
    appHome: () => "C:\\slow-create",
    window: () => ({ platform: "windows" }),
    writeTextFile: async (_path, text) => { scripts.push(text); },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "sqlite3" && args.some((arg) => arg.includes("CREATE TABLE") || arg.startsWith(".read "))) return new Promise((resolve) => { finish = resolve; });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const db = new Kdb(timer);
  let settled = false;
  const opening = db.open().finally(() => { settled = true; });
  await drain();
  for (const wait of timer.waits.filter((wait) => wait.ms <= 30_000)) wait.fn();
  await drain();
  assert.equal(settled, false);
  const schema = calls.find((call) => call.args.some((arg) => arg.includes("CREATE TABLE") || arg.startsWith(".read ")));
  assert.ok(schema.options.timeout > 30_000);
  assert.ok(schema.options.timeout > CALL_MS);
  const schemaText = scripts.join("\n") || schema.args.join("\n");
  assert.match(schemaText, /BEGIN IMMEDIATE;/);
  assert.match(schemaText, /COMMIT;/);
  assert.ok(schema.args.includes(`.timeout ${BUSY_MS}`));
  finish({ code: 0, stdout: "", stderr: "" });
  await opening;
  assert.equal(settled, true);
});

test("a failed store open clears its readiness so a later open can recover", async (t) => {
  for (const file of ["kanso-arrange/store.js", "kanso-dojo/store.js"]) {
    const dir = await temporary(t), timer = clock();
    let lost = true;
    const { Store } = await load(file, ["Store"], { appHome: () => dir, exec: (...args) => lost ? never() : exec(...args), readTextFile: async () => null });
    const store = new Store(timer);
    const opening = store.open();
    const failed = assert.rejects(opening, /did not answer/);
    await drain();
    timer.waits.at(-1).fn();
    await failed;
    lost = false;
    await store.open();
  }
});

test("the host runner honours the timeout supplied by a database", async () => {
  const result = await exec(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeout: 20 });
  assert.equal(result.code, 137);
});
