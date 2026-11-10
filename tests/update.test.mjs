import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load, context, exec, temporary, clone } from "./helpers.mjs";

const names = ["Updater", "newestTag", "compareVersions", "mergeKeys", "SOURCE", "footerPx", "HOLD", "INSTALL_SCRIPT", "RECOVER"];
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

test("An update adds Find where an edited keys file has not set Cmd+F", async () => {
  const { mergeKeys } = await updater();
  const before = { "layout:kanso": { "cmd-d": "kanso-strip.new-right" } };
  const after = { "layout:kanso": { "cmd-d": "kanso-strip.new-right" }, terminal: { "cmd-f": "terminal.search" } };
  const edited = {
    global: { "cmd-q": "app.quit" },
    "layout:kanso": { "cmd-d": "mine.right" },
    terminal: { "cmd-c": "terminal.copy", "cmd-v": "terminal.paste" },
  };
  const gained = clone(mergeKeys(clone(edited), before, after));
  assert.equal(gained.changed, true);
  assert.deepEqual(gained.keys.terminal, { "cmd-c": "terminal.copy", "cmd-v": "terminal.paste", "cmd-f": "terminal.search" });
  assert.equal(gained.keys["layout:kanso"]["cmd-d"], "mine.right", "a key you changed stays");
  assert.deepEqual(gained.kept, []);

  const custom = clone(edited);
  custom.terminal["cmd-f"] = "mine.search";
  const kept = clone(mergeKeys(custom, before, after));
  assert.equal(kept.keys.terminal["cmd-f"], "mine.search");
  assert.equal(kept.keys.terminal["cmd-c"], "terminal.copy");
  assert.deepEqual(kept.kept, ["cmd-f"]);

  const bare = { global: { "cmd-q": "app.quit" }, "layout:kanso": { "cmd-d": "kanso-strip.new-right" } };
  assert.deepEqual(clone(mergeKeys(clone(bare), before, after)).keys.terminal, { "cmd-f": "terminal.search" });

  const removed = { terminal: { "cmd-c": "terminal.copy" } };
  const stays = clone(mergeKeys(clone(removed), after, after));
  assert.equal(stays.changed, false);
  assert.equal(stays.keys.terminal["cmd-f"], undefined, "a later release leaves a Cmd+F you took out");
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
  // And its raw files, which decide the keys and the layout before the download.
  await mkdir(join(site, "v1.1.0/kanso/layouts"), { recursive: true });
  await writeFile(join(site, "v1.1.0/kanso/keys.json"), await readFile(new URL("keys.json", repo), "utf8"));
  await writeFile(join(site, "v1.1.0/kanso/layouts/kanso.json"), shippedLayout);

  // Herdr's `herdr-app check`, faked: it notes each mod, and on a file's say holds open-with
  // (slow) or makes kanso-chrome, the last to go in, impossible to move into place (sabotage).
  const checker = join(root, "check.sh");
  await writeFile(checker, [
    "name=$(basename \"$2\")",
    `echo "$name" >> "${root}/checks"`,
    `if [ -f "${root}/slow" ] && [ "$name" = open-with ]; then while [ ! -f "${root}/go" ]; do sleep 0.05; done; fi`,
    `if [ -f "${root}/sabotage" ] && [ "$name" = kanso-chrome ]; then chmod 555 "$2"; fi`,
    "",
  ].join("\n"), { mode: 0o755 });

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
    checker,
    pauseS: 0.05,
  };
  const checks = async () => (await readFile(join(root, "checks"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const flag = (name) => writeFile(join(root, name), "");
  // A window: its own shared state and toasts, the same Herdr home as every other. Its exec
  // kills what runs past `limit`, as Herdr's does at 30 s. `abandon` plays the copy replaced by
  // the swap: from its next pause on, it never runs again.
  const window = async () => {
    const store = {}, toasts = [], resizes = [];
    const footer = { id: "sidebar-footer", size: { px: 156 } };
    // holdCurl: the plan's downloads wait for release(), keeping an install in preparation.
    const gate = {};
    gate.promise = new Promise((resolve) => { gate.open = resolve; });
    const ctl = { abandon: false, stuck: 0, limit: 30000, holdCurl: false, held: 0, release: () => gate.open() };
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
        if (command === "git") return { code: 0, stdout: "x\trefs/tags/v1.0.0\ny\trefs/tags/v1.1.0\n", stderr: "" };
        if (ctl.abandon && command === "sleep") { ctl.stuck += 1; return new Promise(() => {}); }
        if (ctl.holdCurl && command === "curl") { ctl.held += 1; await gate.promise; }
        return exec(command, args, { ...options, limit: ctl.limit });
      },
    };
    const { Updater, HOLD } = await updater(host);
    return { store, toasts, resizes, footer, ctl, HOLD, Updater, updater: new Updater(source) };
  };
  return { root, home, checks, flag, source, window, userKeys, ...(await window()) };
}

// What installs left in the home, besides the lock file (it stays, empty): dot entries, and
// whatever is in .kanso-updates.
const updates = (home) => join(home, ".kanso-updates");
const staged = async (home) => [
  ...(await readdir(home)).filter((x) => x.startsWith(".") && x !== ".kanso-updates"),
  ...(await readdir(updates(home)).catch(() => [])).filter((x) => x !== "lock").map((x) => `.kanso-updates/${x}`),
].toSorted();
const until = async (ok) => { while (!(await ok())) await new Promise((r) => setTimeout(r, 20)); };
const pending = (f) => Object.keys(f.store["kanso.update"]?.installs ?? {});
// Another install holding the lock: a real process, asleep, whose life is the lock's.
async function holder(t, f) {
  await mkdir(updates(f.home), { recursive: true });
  const child = spawn("sh", ["-c", `${f.HOLD}\nhold "$1" || exit $?\necho held\nexec sleep 60`, "sh", join(updates(f.home), "lock")],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const ended = new Promise((resolve) => child.once("exit", resolve));
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const got = await Promise.race([new Promise((resolve) => child.stdout.once("data", () => resolve(true))), ended.then(() => false)]);
  return { got, pid: child.pid, kill: async () => { process.kill(-child.pid, "SIGKILL"); await ended; } };
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
  const results = await Promise.all([f.updater.install(cx), other.updater.install(cx)]);
  assert.deepEqual(results.toSorted(), ["busy", undefined], "one installs, one is told");
  const toasts = [...f.toasts, ...other.toasts];
  assert.equal(updated(toasts).length, 1);
  assert.equal(told(toasts).length, 1);
  assert.equal(toasts.filter((n) => n.level === "error").length, 0, "neither breaks the other");
  assert.equal(await version(f.home), "1.1.0");
  assert.deepEqual(await staged(f.home), []);
});

test("An install whose owner is alive is left alone, staging and all; once it is gone the lock is free at once", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();

  const a = await holder(t, f);
  assert.ok(a.got, "the holder takes a free lock");
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
  assert.ok(c.got);
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
  // Herdr kills an exec at 30 s; here at 1 s, and the install takes longer.
  f.ctl.limit = 1000; other.ctl.limit = 1000;
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  await f.flag("slow");
  const first = f.updater.install(cx);
  await until(async () => (await f.checks()).includes("open-with"));
  await new Promise((r) => setTimeout(r, 1500));
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
  assert.ok((await holder(t, f)).got, "the lock went with its process");
  assert.equal(f.updater.available(), "1.1.0", "and the update is offered again");
});

// A small release (three mods, a theme, the layout and its picture) and a home with two of those
// mods, for running INSTALL_SCRIPT itself many times.
async function small(t) {
  const root = await temporary(t);
  const site = join(root, "site"), base = join(root, "base");
  const mod = async (dir, name, v) => {
    await mkdir(join(dir, name, "icons"), { recursive: true });
    await writeFile(join(dir, name, "version.json"), `{ "version": "${v}" }\n`);
    await writeFile(join(dir, name, "main.js"), `// ${name} ${v}\n`);
    await writeFile(join(dir, name, "icons/a.svg"), `<svg>${name} ${v}</svg>\n`);
  };
  const top = join(site, "build/herdr-kanso-1.1.0/kanso");
  for (const name of ["kanso-chrome", "kanso-tabs", "open-with"]) await mod(join(top, "mods"), name, "1.1.0");
  await mkdir(join(top, "themes"), { recursive: true });
  await writeFile(join(top, "themes/kanso-day.json"), '{"theme":"1.1.0"}\n');
  await mkdir(join(top, "layouts"), { recursive: true });
  await writeFile(join(top, "layouts/kanso.json"), '{"root":{"id":"1.1.0"}}\n');
  await writeFile(join(top, "layouts/kanso.png"), "png 1.1.0\n");
  const made = await exec("tar", ["-czf", join(site, "v1.1.0.tar.gz"), "-C", join(site, "build"), "herdr-kanso-1.1.0"]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of ["kanso-chrome", "kanso-tabs"]) await mod(join(base, "mods"), name, "1.0.0");
  await mkdir(join(base, "mods/token-spend"), { recursive: true });
  await writeFile(join(base, "mods/token-spend/main.js"), "// someone else's\n");
  await mkdir(join(base, "themes"), { recursive: true });
  await writeFile(join(base, "themes/kanso-day.json"), '{"theme":"1.0.0"}\n');
  await mkdir(join(base, "layouts"), { recursive: true });
  await writeFile(join(base, "layouts/kanso.json"), '{"root":{"id":"yours"}}\n');
  await writeFile(join(base, "layouts/kanso.png"), "png 1.0.0\n");
  await writeFile(join(base, "keys.json"), '{"yours":true}\n');
  const checker = join(root, "check.sh");
  await writeFile(checker, `if [ -f "${root}/sabotage" ] && [ "$(basename "$2")" = kanso-chrome ]; then chmod 555 "$2"; fi\n`, { mode: 0o755 });
  const url = pathToFileURL(join(site, "v1.1.0.tar.gz")).href;
  const { INSTALL_SCRIPT, RECOVER } = await updater();
  // An install of 1.1.0 over `from`, killed after its `stop`-th step (0: never). By default it
  // brings keys merged from yours and a new layout; a reinstall over 1.1.0 brings neither.
  const run = async (home, stop, { from = "1.0.0", sabotage = false, base } = {}) => {
    const dir = join(home, ".kanso-updates");
    await mkdir(dir, { recursive: true }); // as LAUNCH makes it
    if (sabotage) await writeFile(join(root, "sabotage"), "");
    const plan = from === "1.0.0" ? ['{"merged":true}', "1", '{"yours":true}\n'] : ["", "", ""];
    const [keys, layout] = plan;
    const how = await new Promise((resolve) => execFile("sh", ["-c", INSTALL_SCRIPT, "sh", url, home, dir, "op", "1.1.0", from, checker, "20261108-1200", keys, layout, base ?? plan[2]],
      { env: { ...process.env, KANSO_UPDATE_STOP: String(stop) } }, (error, _out, err) => resolve(error?.signal === "SIGKILL" ? "killed" : error ? `failed: ${err.trim().split("\n").at(-1)}` : "ok")));
    await rm(join(root, "sabotage"), { force: true });
    return how;
  };
  const recover = (home) => exec("sh", ["-c", RECOVER, "sh", home, join(home, ".kanso-updates")]);
  const fresh = async (name) => { const home = join(root, name); await cp(base, home, { recursive: true }); return home; };
  const before = await tree(base);
  const whole = await fresh("whole");
  assert.equal(await run(whole, 0), "ok");
  return { root, run, recover, fresh, before, after: await tree(whole) };
}

// Every file under a home, by path, with its content; .kanso-updates aside.
async function tree(dir, at = "") {
  const entries = await readdir(join(dir, at), { withFileTypes: true }).catch(() => []);
  const parts = await Promise.all(entries.filter((e) => !(at === "" && e.name === ".kanso-updates")).map(async (e) => {
    const path = at ? `${at}/${e.name}` : e.name;
    return e.isDirectory() ? tree(dir, path) : { [path]: await readFile(join(dir, path), "utf8") };
  }));
  return Object.assign({}, ...parts);
}
const stages = async (home) => (await readdir(updates(home), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
// Recovery, run as a copy that starts would, must end at one whole install, change nothing run
// again, leave nothing staged, and let the next install through.
async function recovered(s, home, at) {
  assert.equal((await s.recover(home)).code, 0, `recovery after ${at}`);
  const once = await tree(home);
  const end = JSON.stringify(once) === JSON.stringify(s.before) ? "old" : JSON.stringify(once) === JSON.stringify(s.after) ? "new" : null;
  assert.ok(end, `after ${at}, recovery left neither install whole`);
  assert.equal((await s.recover(home)).code, 0);
  assert.deepEqual(await tree(home), once, `a second recovery after ${at} changed something`);
  assert.deepEqual(await stages(home), [], `nothing staged left after ${at}`);
  assert.equal(await s.run(home, 0, { from: end === "old" ? "1.0.0" : "1.1.0" }), "ok", `the next install after ${at}`);
  assert.deepEqual(await tree(home), s.after, `the next install after ${at} is whole`);
  return end;
}

test("Killed after any step of the swap or of its undoing, recovery ends at the whole old install or the whole new one, and the next install goes through", async (t) => {
  const s = await small(t);
  assert.equal(s.after["mods/kanso-chrome/version.json"], '{ "version": "1.1.0" }\n');
  assert.equal(s.after["layouts/kanso.json.old-20261108-1200"], '{"root":{"id":"yours"}}\n');
  assert.equal(s.after["themes/kanso-day.json"], '{"theme":"1.1.0"}\n');
  const updaters = (home) => tree(home).then((files) => ["kanso-chrome", "kanso-tabs"].filter((name) => files[`mods/${name}/main.js`]));
  const sweep = async (sabotage) => {
    const kills = [];
    for (const stop of Array.from({ length: 60 }, (_, i) => i + 1)) {
      const home = await s.fresh(`${sabotage ? "s" : "k"}${stop}`);
      const how = await s.run(home, stop, { sabotage });
      if (how !== "killed") {
        if (sabotage) assert.match(how, /could not put kanso-chrome in place/); else assert.equal(how, "ok");
        return { kills, last: await tree(home) };
      }
      // Herdr started cold now loads what is on disk: an updater, to start the recovery, is there.
      assert.ok((await updaters(home)).length > 0, `no updater on disk after step ${stop}`);
      kills.push(await recovered(s, home, `step ${stop}${sabotage ? " (undoing)" : ""}`));
    }
    assert.fail("more steps than expected");
  };
  // Forward, slot by slot, each aside and in: keys, layout, picture, theme (8), open-with in (1),
  // kanso-tabs and kanso-chrome (4); then the commit, the layout you had kept, the journal gone.
  const forward = await sweep(false);
  assert.deepEqual(forward.kills, [...Array(13).fill("old"), ...Array(3).fill("new")]);
  assert.deepEqual(forward.last, s.after);
  // kanso-chrome cannot go in: 12 steps forward, then back in reverse, each slot's renames and its
  // line out of the journal (19), then the journal gone.
  const back = await sweep(true);
  assert.deepEqual(back.kills, Array(32).fill("old"));
  assert.deepEqual(back.last, s.before, "a failed swap undone in full");
});

test("An undoing killed as its stage was being removed never takes back what it put back", async (t) => {
  const s = await small(t);
  // The sabotaged install, killed once every slot is back (its last step, the journal emptied,
  // before the journal goes); then all the stage holds but its journal is gone, as a removal
  // cut short could leave it: the release's keys.json, your backups.
  const home = await s.fresh("undone");
  assert.equal(await s.run(home, 31, { sabotage: true }), "killed");
  const [stage] = await stages(home);
  const st = join(updates(home), stage);
  assert.equal(await readFile(join(st, "slots"), "utf8"), "", "every slot is out of the journal");
  await exec("chmod", ["-R", "u+w", st]); // the sabotaged kanso-chrome
  await Promise.all(["keys.json", "kanso.json", "old", "src"].map((x) => rm(join(st, x), { recursive: true, force: true })));
  assert.equal(await recovered(s, home, "a removal cut short"), "old");
});

test("A finished install killed as its stage was being removed is not done again: the next install goes through", async (t) => {
  const s = await small(t);
  // Killed after the commit and the layout you had kept; then the stage loses all but its journal
  // and the `committed` mark, as a removal cut short could leave it: the release's themes and
  // picture, its other files, your backups, the stamp.
  const home = await s.fresh("committed");
  assert.equal(await s.run(home, 15), "killed");
  const [stage] = await stages(home);
  const st = join(updates(home), stage);
  await Promise.all(["src", "old", "stamp", "slots.part"].map((x) => rm(join(st, x), { recursive: true, force: true })));
  assert.deepEqual((await readdir(st)).toSorted(), ["committed", "slots"]);
  assert.equal(await recovered(s, home, "a removal cut short"), "new");
});

test("Keys merged from another keys.json than the one in place are not installed: nothing changes", async (t) => {
  const s = await small(t);
  const home = await s.fresh("stale");
  assert.equal(await s.run(home, 0, { base: '{"half":true}\n' }), "failed: your keys.json changed while the update was prepared; try again");
  assert.deepEqual(await tree(home), s.before);
  assert.deepEqual(await stages(home), []);
});

// The first window's install, killed after its `stop`-th step and never heard from again: its
// copy is replaced by the swap, so nothing in that window recovers it.
async function killed(t, f, stop) {
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  process.env.KANSO_UPDATE_STOP = String(stop);
  t.after(() => { delete process.env.KANSO_UPDATE_STOP; });
  await f.flag("slow");
  f.ctl.abandon = true;
  f.updater.install(cx);
  await until(async () => f.ctl.stuck > 0);
  f.ctl.abandon = false;
  const pid = join(updates(f.home), `${pending(f)[0]}.pid`);
  await f.flag("go");
  await until(async () => (await exec("sh", ["-c", 'kill -0 "$(cat "$1")" 2>/dev/null', "sh", pid])).code !== 0);
  delete process.env.KANSO_UPDATE_STOP;
  return { cx, drain };
}
// The step right after the new kanso-chrome goes in (its version.json says 1.1.0), before the
// commit: keys and layout aside and in (4), the picture, each theme and every mod but kanso-chrome
// in (none of them here before), then kanso-chrome aside and in (2).
const chromeIn = async () => {
  const mods = (await readdir(new URL("mods/", repo))).length;
  const themes = (await readdir(new URL("themes/", repo))).length;
  return 4 + 1 + themes + (mods - 1) + 2;
};

test("An install that died with the new keys in place, retried from another window, ends with the new keys", async (t) => {
  const f = await fixture(t);
  await killed(t, f, 2); // keys aside, then the merged ones in
  const now = JSON.parse(await readFile(new URL("keys.json", repo), "utf8"))["layout:kanso"];
  const live = async () => JSON.parse(await readFile(join(f.home, "keys.json"), "utf8"))["layout:kanso"];
  assert.equal((await live())["cmd-d"], now["cmd-d"], "it died with the release's keys in place");
  assert.equal(await version(f.home), "1.0.0");

  const other = await f.window();
  other.store["kanso.update"] = { latest: "1.1.0" };
  await other.updater.readInstalled();
  const { cx } = context();
  await other.updater.install(cx);
  assert.equal(other.updater.error, null, other.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  const keys = await live();
  assert.equal(keys["cmd-d"], now["cmd-d"], "a shipped key follows the release");
  assert.equal(keys["cmd-shift-w"], now["cmd-shift-w"], "a new key arrives");
  assert.equal(keys["cmd-shift-o"], "mine.open", "your own key stays");
  assert.equal(updated(other.toasts).length, 1);
  assert.deepEqual(await stages(f.home), [], "the dead install's stage settled (its outcome stays for its own window to report)");
});

test("A follower whose recovery finds the lock taken waits for it, then reports once what recovery left", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died half new");
  // Another window recovering, or what the dead install started still holding its lock.
  const other = await holder(t, f);
  assert.ok(other.got);
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await new Promise((r) => setTimeout(r, 400)); // it tries a few times meanwhile
  assert.deepEqual(pending(f).length, 1, "still followed");
  assert.equal(f.toasts.filter((n) => n.level === "error" || n.level === "success").length, 0, "nothing told before recovery ran");
  await other.kill();
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "told once, as stopped");
  assert.equal(updated(f.toasts).length, 0, "never as updated");
  assert.deepEqual(await staged(f.home), []);
});

test("A recovery killed partway is not taken for done: the follower tries again and reports what it left", async (t) => {
  const f = await fixture(t);
  const { cx } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died half new");
  process.env.KANSO_UPDATE_STOP = "1"; // every recovery is killed after its first step
  const fresh = new f.Updater(f.source);
  await fresh.follow(cx, pending(f)[0]);
  delete process.env.KANSO_UPDATE_STOP;
  assert.equal(await version(f.home), "1.0.0", "undone, a step at a time");
  assert.equal(updated(f.toasts).length, 0, "never told as updated");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "told once, as stopped");
  assert.deepEqual(pending(f), []);
  assert.deepEqual(await staged(f.home), []);
});

test("A window that starts while another recovers, which then dies, recovers itself", async (t) => {
  const f = await fixture(t);
  await killed(t, f, await chromeIn());
  // The other recoverer: it holds the lock, then dies without settling anything.
  const other = await holder(t, f);
  assert.ok(other.got);
  const w = await f.window(); // no install of its own to follow
  const { cx, drain } = context();
  cx.timer = { every() {} };
  w.updater.start(cx);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await version(f.home), "1.1.0", "left alone while another holds the lock");
  await other.kill();
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone once the lock is free");
  assert.equal(w.updater.available(), "1.1.0", "and the update offered again");
  assert.deepEqual(await stages(f.home), []);
});

test("A copy that starts after an install died mid-swap undoes it before it reads the version", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died with the new kanso-chrome in place");
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone, not left half new");
  assert.equal(await readFile(join(f.home, "mods/kanso-chrome/main.js"), "utf8"), "// 1.0.0\n");
  assert.equal(fresh.available(), "1.1.0", "so the update is offered again");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "and the one that died is told as such");
  assert.equal(updated(f.toasts).length, 0);
  assert.deepEqual(await staged(f.home), []);
});

test("A copy started while another prepares its install waits for it, and the outcome is told once, with its version", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  f.ctl.holdCurl = true; // the keys and layout downloads wait
  const first = f.updater.install(cx);
  await until(async () => pending(f).length === 1 && f.ctl.held > 0);
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await new Promise((r) => setTimeout(r, 300)); // it looks a few times meanwhile
  assert.equal(pending(f).length, 1, "a mark still preparing is no dead install");
  f.ctl.release();
  await first;
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(updated(f.toasts).length, 1, "told once");
  assert.ok(!f.toasts.some((n) => /undefined/.test(n.title)));
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 0);
  assert.equal(await version(f.home), "1.1.0");
});

test("The copy the swap starts picks up the install's outcome and reports it", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  await f.flag("slow");
  f.ctl.abandon = true;
  f.updater.install(cx); // replaced mid-install: never heard from again
  await until(async () => f.ctl.stuck > 0);
  f.ctl.abandon = false;
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await f.flag("go");
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.1.0");
  assert.equal(updated(f.toasts).length, 1, "reported once, by the fresh copy");
  assert.match(updated(f.toasts)[0].body, /layouts\/kanso\.json\.old-/, "with the notes the first copy made");
  assert.deepEqual(await staged(f.home), []);
});

test("The tab bar looks for releases; the footer reads what it found", async () => {
  const store = {}, toasts = [], timers = [];
  let asked = 0;
  const host = {
    appHome: () => "/nowhere", shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify: (n) => { toasts.push(n); return "1"; }, readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null, run: () => null,
    exec: async (command) => { if (command === "git") asked++; return command === "git" ? { code: 0, stdout: "x\trefs/tags/v1.4.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "" }; },
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
    exec: async (command) => { if (command === "git") asked++; return { code: 0, stdout: "x\trefs/tags/v1.4.0\n", stderr: "" }; },
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
    exec: async (command) => { if (command === "git") asked++; return command === "git" && !offline ? { code: 0, stdout: tags, stderr: "" } : { code: 128, stdout: "", stderr: "offline" }; },
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
    exec: async (command) => { if (command === "git") asked++; return { code: 0, stdout: "x\trefs/tags/v1.3.1\n", stderr: "" }; },
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
