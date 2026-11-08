import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load, context, exec, temporary, clone } from "./helpers.mjs";

const names = ["Updater", "newestTag", "compareVersions", "mergeKeys", "SOURCE", "footerPx"];
const repo = new URL("../kanso/", import.meta.url);

async function updater(host) {
  return load("kanso-chrome/update.js", names, host);
}

test("Kanso's newest release comes from the vX.Y.Z tags, not from Herdr", async () => {
  const { newestTag, compareVersions } = await updater();
  const out = [
    "aaa\trefs/tags/v1.0.0", "bbb\trefs/tags/v1.10.0", "ccc\trefs/tags/v1.9.3",
    "ddd\trefs/tags/nightly", "eee\trefs/tags/v2.0.0-beta",
  ].join("\n");
  assert.equal(newestTag(out), "1.10.0", "numeric order, other tags ignored");
  assert.equal(newestTag(""), null);
  assert.ok(compareVersions("1.2.0", "1.10.0") < 0);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
});

test("Keys follow the release only where you left them as shipped", async () => {
  const { mergeKeys } = await updater();
  const before = { "layout:kanso": { "cmd-d": "a", "cmd-e": "b", "cmd-f": "c", "cmd-g": "d", "cmd-h": "e" } };
  const after = { "layout:kanso": { "cmd-d": "a2", "cmd-e": "b2", "cmd-f": "c", "cmd-n": "new", "cmd-h": "e2" } };
  const user = {
    global: { "cmd-q": "app.quit" },
    // cmd-d as shipped, cmd-e yours, cmd-g as shipped (the release drops it), cmd-h removed by you.
    "layout:kanso": { "cmd-d": "a", "cmd-e": "mine", "cmd-f": "c", "cmd-g": "d" },
  };
  const { keys, changed, kept } = clone(mergeKeys(clone(user), before, after)); // out of the mod's realm
  assert.ok(changed);
  assert.deepEqual(keys.global, user.global, "other sections untouched");
  assert.deepEqual(keys["layout:kanso"], { "cmd-d": "a2", "cmd-e": "mine", "cmd-f": "c", "cmd-n": "new" });
  assert.deepEqual(kept, ["cmd-e"]);
  assert.equal(mergeKeys(clone(user), before, before).changed, false, "a release that kept them changes nothing");
});

// A Herdr home with Kanso 1.0.0 installed and used, and two releases served
// from file:// URLs: what v1.0.0 shipped and the v1.1.0 tarball.
async function fixture(t, { layoutChanged = true } = {}) {
  const root = await temporary(t);
  const home = join(root, "home"), site = join(root, "site");
  const shippedKeys = JSON.parse(await readFile(new URL("keys.json", repo), "utf8"));
  const shippedLayout = await readFile(new URL("layouts/kanso.json", repo), "utf8");

  // v1.0.0, as GitHub's raw files.
  const oldKeys = clone(shippedKeys);
  oldKeys["layout:kanso"]["cmd-d"] = "kanso-strip.old-right";
  delete oldKeys["layout:kanso"]["cmd-shift-w"];
  await mkdir(join(site, "v1.0.0/kanso/layouts"), { recursive: true });
  await writeFile(join(site, "v1.0.0/kanso/keys.json"), JSON.stringify(oldKeys));
  await writeFile(join(site, "v1.0.0/kanso/layouts/kanso.json"), layoutChanged ? '{"root":{"id":"old"}}' : shippedLayout);

  // v1.1.0: this repository's kanso/ with version.json saying 1.1.0.
  const top = join(site, "build/herdr-kanso-1.1.0");
  await cp(new URL(".", repo), join(top, "kanso"), { recursive: true });
  await writeFile(join(top, "kanso/mods/kanso-chrome/version.json"), '{ "version": "1.1.0" }\n');
  await writeFile(join(top, "README.md"), "not installed\n");
  const made = await exec("tar", ["-czf", join(site, "v1.1.0.tar.gz"), "-C", join(site, "build"), "herdr-kanso-1.1.0"]);
  assert.equal(made.code, 0, made.stderr);

  // The person's home: Kanso 1.0.0, a custom key, a live layout, another mod.
  await mkdir(join(home, "mods/kanso-chrome"), { recursive: true });
  await writeFile(join(home, "mods/kanso-chrome/version.json"), '{ "version": "1.0.0" }\n');
  await writeFile(join(home, "mods/kanso-chrome/main.js"), "// 1.0.0\n");
  await mkdir(join(home, "mods/token-spend"), { recursive: true });
  await writeFile(join(home, "mods/token-spend/main.js"), "// someone else's\n");
  await mkdir(join(home, "layouts"), { recursive: true });
  await writeFile(join(home, "layouts/kanso.json"), '{"root":{"id":"live"}}');
  const userKeys = { global: { "cmd-q": "app.quit" }, "layout:kanso": { ...oldKeys["layout:kanso"], "cmd-shift-o": "mine.open" } };
  await writeFile(join(home, "keys.json"), JSON.stringify(userKeys, null, 2));

  const url = (p) => pathToFileURL(join(site, p)).href;
  const source = {
    remote: "unused",
    tarball: (v) => url(`v${v}.tar.gz`),
    file: (v, path) => url(`v${v}/${path}`),
  };
  const checks = [];
  // A window: its own shared state and toasts, the same Herdr home as every other.
  const window = async () => {
    const store = {}, toasts = [], resizes = [];
    const footer = { id: "sidebar-footer", size: { px: 156 } };
    const host = {
      layout: () => ({ id: "root", children: [{ id: "sidebar", children: [footer] }] }),
      run: (name, args) => { resizes.push(args.px); footer.size = { px: args.px }; return null; },
      appHome: () => home,
      shared: (k) => store[k],
      setShared: (k, v) => { store[k] = v; },
      notify: (n) => { toasts.push(n); return String(toasts.length); },
      readTextFile: async (p) => { try { return await readFile(p, "utf8"); } catch { return null; } },
      writeTextFile: async (p, text) => { await writeFile(p, text); return null; },
      exec: async (command, args, options) => {
        if (command === "herdr-app") { checks.push(args[1].split("/").pop()); return { code: 0, stdout: "check passed", stderr: "" }; }
        if (command === "git") return { code: 0, stdout: "x\trefs/tags/v1.0.0\ny\trefs/tags/v1.1.0\n", stderr: "" };
        return exec(command, args, options);
      },
    };
    const { Updater } = await updater(host);
    return { store, toasts, resizes, footer, Updater, updater: new Updater(source) };
  };
  return { home, checks, source, window, userKeys, ...(await window()) };
}

// What a stage left in the home: staging folders and locks are dot folders.
const staged = (home) => readdir(home).then((n) => n.filter((x) => x.startsWith(".")));
const lockOf = (home) => join(home, ".kanso-update.lock");
async function holdLock(home, id, { pid = "-", at = Math.floor(Date.now() / 1000) } = {}) {
  await mkdir(join(home, `.kanso-update-${id}/src`), { recursive: true });
  await mkdir(lockOf(home));
  await writeFile(join(lockOf(home), "owner"), `${id} ${pid} ${at}\n`);
}
const version = async (home) => JSON.parse(await readFile(join(home, "mods/kanso-chrome/version.json"), "utf8")).version;
const told = (toasts) => toasts.filter((n) => n.title === "kansō is already being updated");
const updated = (toasts) => toasts.filter((n) => n.title === "kansō updated to 1.1.0");

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
  assert.deepEqual([...f.checks].sort(), shipped, "every mod checked before the swap");

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

  assert.deepEqual(await readdir(f.home).then((n) => n.filter((x) => x.startsWith("."))), [], "nothing staged left");
  assert.equal(f.updater.available(), null);
  const done = f.toasts.at(-1);
  assert.equal(done.title, "kansō updated to 1.1.0");
  assert.equal(done.level, "success");
  assert.match(done.body, /layouts\/kanso\.json\.old-/);
  assert.equal(f.store["kanso.update"].done, null, "reported once");
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
  assert.deepEqual(await staged(f.home), [], "its staging and its lock both gone");
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
  const results = await Promise.all([f.updater.install(cx), other.updater.install(cx)]);
  assert.deepEqual(results.toSorted(), ["busy", undefined], "one installs, one is told");
  const toasts = [...f.toasts, ...other.toasts];
  assert.equal(updated(toasts).length, 1);
  assert.equal(told(toasts).length, 1);
  assert.equal(toasts.filter((n) => n.level === "error").length, 0, "neither breaks the other");
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
});

test("A lock whose owner is alive is left alone; one gone or held too long is taken back, with its staging", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();

  await holdLock(f.home, "live1");
  assert.equal(await f.updater.install(cx), "busy");
  assert.equal(f.updater.error, null);
  assert.equal(await version(f.home), "1.0.0", "nothing replaced");
  assert.deepEqual((await staged(f.home)).toSorted(), [".kanso-update-live1", ".kanso-update.lock"], "the owner's lock and staging stay");
  assert.equal(f.updater.busy, false, "told, not waiting");

  // The same owner, an hour later: its window went away without letting go.
  await writeFile(join(lockOf(f.home), "owner"), `live1 - ${Math.floor(Date.now() / 1000) - 3600}\n`);
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), [], "the abandoned staging went with it");
});

test("An install whose Herdr died is taken back at once", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  const gone = await exec("sh", ["-c", "echo $$"]); // a pid that has just exited
  await holdLock(f.home, "dead1", { pid: gone.stdout.trim() });
  await f.updater.install(cx);
  assert.equal(f.updater.error, null, f.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
});

test("The tab bar looks for releases; the footer reads what it found", async () => {
  const store = {}, toasts = [], timers = [];
  let asked = 0;
  const host = {
    appHome: () => "/nowhere", shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify: (n) => { toasts.push(n); return "1"; }, readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null, run: () => null,
    exec: async (command) => { asked++; return command === "git" ? { code: 0, stdout: "x\trefs/tags/v1.4.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "" }; },
  };
  const { Updater } = await updater(host);
  const tabs = new Updater(), footer = new Updater();
  const { cx, drain } = context();
  cx.timer = { every(ms, fn) { timers.push({ ms, fn }); } };
  tabs.start(cx); footer.start(cx, { polls: false }); await drain();
  assert.equal(asked, 1, "one forced look on start, not one per copy");
  assert.equal(footer.available(), "1.4.0", "the footer offers what the tab bar found");
  assert.equal(toasts.filter((n) => n.title === "kansō 1.4.0 is available").length, 1);

  // Minutes later both ticks fire: only the tab bar's looks.
  store["kanso.update"] = { ...store["kanso.update"], checked: null };
  for (const { ms, fn } of timers.filter((x) => x.ms > 60000)) fn(cx);
  await drain();
  assert.equal(asked, 2);

  // Both asked at once (the footer's Check and the tab bar's command): GitHub is asked once.
  await Promise.all([tabs.check(cx, true), footer.check(cx, true)]);
  assert.equal(asked, 3);
});

test("With automatic checks off neither copy polls, and a Check from settings still looks once", async () => {
  const store = { "kanso.update": { autoCheck: false } }, timers = [];
  let asked = 0;
  const host = {
    appHome: () => "/nowhere", shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify() {}, readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null, run: () => null,
    exec: async () => { asked++; return { code: 0, stdout: "x\trefs/tags/v1.4.0\n", stderr: "" }; },
  };
  const { Updater } = await updater(host);
  const tabs = new Updater(), footer = new Updater();
  const { cx, drain } = context();
  cx.timer = { every(ms, fn) { timers.push({ ms, fn }); } };
  tabs.start(cx); footer.start(cx, { polls: false }); await drain();
  for (const { ms, fn } of timers.filter((x) => x.ms > 60000)) fn(cx);
  await drain();
  assert.equal(asked, 0, "no look on start or on the tick");

  // Settings runs kanso-tabs.check while the footer's Check is pressed: one look, both see it.
  await Promise.all([tabs.check(cx, true, true), footer.check(cx, true, true)]);
  assert.equal(asked, 1);
  assert.equal(footer.available(), "1.4.0");
  assert.equal(store["kanso.update"].autoCheck, false, "the setting survives the copies' writes");
});

test("Kanso looks for releases on every start, every few minutes, and when asked", async () => {
  const store = { "kanso.update": { latest: "1.0.0", checked: Date.now(), notified: "1.0.0" } }, toasts = [];
  let tags = "x\trefs/tags/v1.3.1\n", asked = 0, every = null, offline = false;
  const host = {
    appHome: () => "/nowhere", shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify: (n) => { toasts.push(n); return "1"; }, readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null, run: () => null,
    exec: async (command) => { asked++; return command === "git" && !offline ? { code: 0, stdout: tags, stderr: "" } : { code: 128, stdout: "", stderr: "offline" }; },
  };
  const { Updater } = await updater(host);
  const u = new Updater();
  const { cx, drain } = context();
  cx.timer = { every(ms, fn) { every = ms; } };
  u.start(cx); await drain();
  assert.equal(asked, 1, "a start looks even right after another look");
  assert.ok(every <= 5 * 60 * 1000, "then every 5 minutes at most");

  await u.check(cx, false, false);
  assert.equal(asked, 1, "the timer does not look twice within minutes");
  await u.check(cx, true, true);
  assert.equal(toasts.at(-1).title, "kansō is up to date", "asked: it says so");

  tags = "x\trefs/tags/v1.3.1\ny\trefs/tags/v1.4.0\n";
  await u.check(cx, true, false);
  assert.equal(toasts.at(-1).title, "kansō 1.4.0 is available");
  await u.check(cx, true, true);
  assert.equal(toasts.filter((n) => n.title === "kansō 1.4.0 is available").length, 2, "asked again: told again");

  offline = true;
  await u.check(cx, true, true);
  assert.equal(toasts.at(-1).title, "kansō could not check for updates");
});

test("Automatic update checks can be disabled while manual checks still work", async () => {
  const store = { "kanso.update": { autoCheck: false } };
  let asked = 0, tick = null;
  const host = {
    appHome: () => "/nowhere", shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify() {}, readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null, run: () => null,
    exec: async () => { asked++; return { code: 0, stdout: "x\trefs/tags/v1.3.1\n", stderr: "" }; },
  };
  const { Updater } = await updater(host);
  const u = new Updater();
  const { cx, drain } = context();
  cx.timer = { every(_ms, fn) { if (!tick) tick = fn; } };
  u.start(cx);
  await drain();
  assert.equal(asked, 0, "disabled means no startup check");

  tick(cx);
  await drain();
  assert.equal(asked, 0, "disabled means no periodic check");

  await u.check(cx, true, true);
  assert.equal(asked, 1, "an explicit check still works");
});

test("The footer is as tall as the rows it shows: one switched off in Kanso's settings gives its place back", async (t) => {
  const f = await fixture(t);
  f.store["kanso.hidden"] = ["footer.machine"];
  f.footer.size = { px: 228 }; // as 3.9.1 sized it
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  assert.deepEqual(f.resizes, [156], "3.9.1's taller footer comes back to Update and Settings");
  const { footerPx } = await updater({ shared: () => null });
  assert.equal(footerPx(new Set(), false), 156);
  assert.equal(footerPx(new Set(["footer.machine"]), false), 120);
});

test("A mod that did not load for want of memory asks for a restart, however the runtime words it", async () => {
  const { exhausted } = await load("kanso-chrome/main.js", ["exhausted"], { window: () => ({}) });
  assert.equal(exhausted("kanso-panel: out of memory"), true);
  assert.equal(exhausted('kanso-menu did not load: Null "null"'), true, "no room left even for the error");
  assert.equal(exhausted("kanso-menu did not load: SyntaxError: unexpected token"), false, "a broken file is not memory");
});
