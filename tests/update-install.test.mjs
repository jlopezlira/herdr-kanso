import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { context, until } from "./helpers.mjs";
import { repo, test, fixture, staged, pending, version, told, updated } from "./update-harness.mjs";

test("Updating Kanso swaps its mods, merges its keys and keeps your layout aside", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  assert.equal(f.updater.installed, "1.0.0");
  assert.equal(f.updater.available(), "1.1.0");
  assert.equal(f.toasts.length, 1);
  assert.match(f.toasts[0].title, /kansō 1\.1\.0 is available/);
  assert.equal(f.toasts[0].action.name, "kanso-tabs.update", "the tab bar installs: it is on screen even with the sidebar hidden");
  assert.equal(f.toasts[0].timeout, 30000, "long enough to be seen");
  assert.deepEqual(f.resizes, [192], "the footer grows a row for it");

  // Another check does not toast the same version again.
  await f.updater.check(cx, true);
  assert.equal(f.toasts.length, 1);

  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  const shipped = (await readdir(new URL("mods/", repo))).sort();
  assert.deepEqual((await f.checks()).toSorted(), shipped, "every mod checked before the swap");

  const mods = await readdir(join(f.home, "mods"));
  for (const name of shipped) assert.ok(mods.includes(name), name);
  assert.ok(mods.includes("token-spend"), "other mods stay");
  assert.equal(JSON.parse(await readFile(join(f.home, "mods/kanso-chrome/version.json"), "utf8")).version, "1.1.0");
  assert.equal(await readFile(join(f.home, "mods/kanso-chrome/main.js"), "utf8"),
    await readFile(new URL("mods/kanso-chrome/main.js", repo), "utf8"));
  assert.ok((await readdir(join(f.home, "themes"))).includes("kanso-day.json"));

  const layouts = await readdir(join(f.home, "layouts"));
  const old = layouts.find((n) => n.startsWith("kanso.json.old-"));
  assert.ok(old, "the layout you had is kept");
  assert.equal(await readFile(join(f.home, "layouts", old), "utf8"), '{"root":{"id":"live"}}');
  assert.equal(await readFile(join(f.home, "layouts/kanso.json"), "utf8"),
    await readFile(new URL("layouts/kanso.json", repo), "utf8"));

  const keys = JSON.parse(await readFile(join(f.home, "keys.json"), "utf8"));
  const now = JSON.parse(await readFile(new URL("keys.json", repo), "utf8"))["layout:kanso"];
  assert.deepEqual(keys.global, f.userKeys.global);
  assert.equal(keys["layout:kanso"]["cmd-d"], now["cmd-d"], "a shipped key follows the release");
  assert.equal(keys["layout:kanso"]["cmd-shift-w"], now["cmd-shift-w"], "a new key arrives");
  assert.equal(keys["layout:kanso"]["cmd-shift-o"], "mine.open", "your own key stays");

  assert.deepEqual(await staged(f.home), [], "nothing staged left");
  assert.equal(f.updater.available(), null);
  const done = f.toasts.at(-1);
  assert.equal(done.title, "kansō updated to 1.1.0");
  assert.equal(done.level, "success");
  assert.match(done.body, /layouts\/kanso\.json\.old-/);
  assert.deepEqual(pending(f), [], "reported once");
  assert.deepEqual(f.resizes, [192, 156], "and gives the room back");
});

test("A copy that started before version.json arrived stops offering what is installed", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  assert.equal(f.updater.available(), "1.1.0");
  // The release's files land by another way (a manual install); the copy keeps running.
  await writeFile(join(f.home, "mods/kanso-chrome/version.json"), '{ "version": "1.1.0" }\n');
  await f.updater.check(cx); // the next tick, inside the 4 minutes another copy already looked
  assert.equal(f.updater.installed, "1.1.0");
  assert.equal(f.updater.available(), null, "no dot on the gear, no row in the footer");
  assert.equal(f.toasts.length, 1);
});

test("A release that kept the layout leaves yours as it is", async (t) => {
  const f = await fixture(t, { layoutChanged: false });
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  f.footer.size = { px: 240 }; // sized by you
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.deepEqual(f.resizes, [192], "a footer you sized is left alone");
  assert.equal(await readFile(join(f.home, "layouts/kanso.json"), "utf8"), '{"root":{"id":"live"}}');
  assert.ok(!(await readdir(join(f.home, "layouts"))).some((n) => n.startsWith("kanso.json.old-")));
});

test("A tag whose files say another version is not installed", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  f.store["kanso.update"].latest = "1.2.0"; // tagged, but no such tarball
  await f.updater.install(cx);
  assert.ok(f.updater.error);
  assert.equal(f.toasts.at(-1).level, "error");
  assert.equal(await readFile(join(f.home, "mods/kanso-chrome/main.js"), "utf8"), "// 1.0.0\n", "nothing replaced");
  assert.deepEqual(await staged(f.home), [], "its staging and its files all gone");
  assert.equal(f.updater.busy, false);

  // A failed install holds nothing back: the next one goes ahead.
  f.store["kanso.update"].latest = "1.1.0";
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
});

test("Update from the footer and from the tab bar at once: one installs, the other is told", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  // The same window: the footer's copy and the tab bar's, one shared state.
  const tabs = new f.Updater(f.source);
  await tabs.readInstalled();
  assert.equal(tabs.available(), "1.1.0");
  const [a, b] = await Promise.all([f.updater.install(cx), tabs.install(cx)]);
  assert.equal(b, "busy", "the second sees the first at once");
  assert.equal(a, undefined);
  assert.equal(updated(f.toasts).length, 1);
  assert.equal(told(f.toasts).length, 1);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
  assert.equal(f.updater.busy, false);
  assert.equal(tabs.busy, false);
});

test("Two windows installing at once share no state, and the lock lets one through", async (t) => {
  const f = await fixture(t);
  const other = await f.window();
  const { cx } = context();
  for (const w of [f, other]) {
    w.store["kanso.update"] = { latest: "1.1.0" };
    await w.updater.readInstalled();
  }
  await f.flag("slow");
  const first = f.updater.install(cx);
  await until(async () => f.updater.error || (await f.checks()).includes("open-with"));
  assert.equal(f.updater.error, null, f.updater.error);
  const second = await other.updater.install(cx);
  await f.flag("go");
  const results = [await first, second];
  assert.deepEqual(results.toSorted(), ["busy", undefined], "one installs, one is told");
  const toasts = [...f.toasts, ...other.toasts];
  assert.equal(updated(toasts).length, 1);
  assert.equal(told(toasts).length, 1);
  assert.equal(toasts.filter((n) => n.level === "error").length, 0, "neither breaks the other");
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
});
