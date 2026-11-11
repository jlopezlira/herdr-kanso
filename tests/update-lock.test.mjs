import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { context, until } from "./helpers.mjs";
import { windows, test, fixture, updates, staged, pending, holder, took, version, updated } from "./update-harness.mjs";

test("An install whose owner is alive is left alone, staging and all; once it is gone the lock is free at once", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();

  const a = await holder(t, f);
  took(a, "the holder takes a free lock");
  await mkdir(join(updates(f.home), "a/src"), { recursive: true }); // its staging
  assert.equal(await f.updater.install(cx), "busy");
  assert.equal(f.updater.error, null);
  assert.equal(await version(f.home), "1.0.0", "nothing replaced");
  assert.deepEqual(await staged(f.home), [".kanso-updates/a"], "the live owner's staging stays");
  assert.equal(f.updater.busy, false, "told, not waiting");

  // Killed, as a crash would: no timeout to wait out, nothing to take back.
  await a.kill();
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), [], "the dead install's staging, swept under the lock (no live one can have any)");
});

test("An owner that lets go while another waits: the next to take the lock keeps it, and its staging", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  const a = await holder(t, f);
  assert.equal(await f.updater.install(cx), "busy");
  // A finishes; C takes the lock straight away. Nothing judged A gone, so nothing can undo C.
  await a.kill();
  const c = await holder(t, f);
  took(c, "the next holder takes the lock");
  await mkdir(join(updates(f.home), "c/src"), { recursive: true });
  assert.equal(await f.updater.install(cx), "busy");
  assert.deepEqual(await staged(f.home), [".kanso-updates/c"]);
  assert.equal((await holder(t, f)).got, false, "C still holds it");
  await c.kill();
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
});

test("An install longer than exec's limit runs to the end, and keeps the lock all along", async (t) => {
  const f = await fixture(t);
  const other = await f.window();
  // Herdr kills an exec at 30 s; here sooner, yet above what starting PowerShell alone takes.
  const limit = windows ? 10000 : 1000;
  f.ctl.limit = limit; other.ctl.limit = limit;
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  await f.flag("slow");
  const began = Date.now();
  const first = f.updater.install(cx);
  await until(async () => f.updater.error || (await f.checks()).includes("open-with"));
  assert.equal(f.updater.error, null, f.updater.error);
  await new Promise((r) => setTimeout(r, Math.max(0, began + limit + 500 - Date.now())));
  assert.deepEqual(pending(f).map((id) => f.store["kanso.update"].installs[id].phase), ["started"], "launched and let go: no exec waits on the install");
  // As far as this window's buttons can tell, the install was started an hour ago.
  f.store["kanso.update"] = { ...f.store["kanso.update"],
    installs: Object.fromEntries(pending(f).map((id) => [id, { ...f.store["kanso.update"].installs[id], at: Date.now() - 3600 * 1000 }])) };
  const tabs = new f.Updater(f.source);
  await tabs.readInstalled();
  assert.equal(await tabs.install(cx), "busy", "the lock still says no");
  other.store["kanso.update"] = { latest: "1.1.0" };
  await other.updater.readInstalled();
  assert.equal(await other.updater.install(cx), "busy", "and so it does to another window");
  assert.equal(await version(f.home), "1.0.0");
  await f.flag("go");
  assert.equal(await first, undefined);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.equal(updated(f.toasts).length, 1);
  assert.deepEqual(await staged(f.home), []);
});

test("A swap that fails on its last mod puts back every one before it: the old version stays", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  const keysBefore = await readFile(join(f.home, "keys.json"), "utf8");
  await f.flag("sabotage"); // kanso-chrome, the last mod moved in, cannot be
  await f.updater.install(cx);
  assert.match(f.updater.error, /could not put kanso-chrome in place/);
  assert.equal(f.toasts.at(-1).level, "error");
  assert.equal(await version(f.home), "1.0.0", "kanso-chrome was moved aside, then put back");
  assert.equal(await readFile(join(f.home, "mods/kanso-chrome/main.js"), "utf8"), "// 1.0.0\n");
  assert.deepEqual((await readdir(join(f.home, "mods"))).toSorted(), ["kanso-chrome", "token-spend"], "the mods it brought are gone again");
  assert.equal(await readFile(join(f.home, "keys.json"), "utf8"), keysBefore, "your keys as they were");
  assert.equal(await readFile(join(f.home, "layouts/kanso.json"), "utf8"), '{"root":{"id":"live"}}', "your layout as it was");
  assert.deepEqual(await readdir(join(f.home, "themes")), [], "the release's themes taken back too");
  assert.deepEqual(await staged(f.home), [], "backups removed only once everything is back");
  took(await holder(t, f), "the lock went with its process");
  assert.equal(f.updater.available(), "1.1.0", "and the update is offered again");
});
