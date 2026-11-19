import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, context, exec, nativePlatform, temporary, clone, gpuiHost, success, failure, storeShared, tickingContext } from "./helpers.mjs";
import { test, dropChild, trackedSpawn, quote, windowsOnly, heldFile, updater, fixture, version, small, tree, stages, hostFor, startUpdater, versionFile } from "./update-harness.mjs";

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

test("An update points Cmd+F at the conversation when it still searches the terminal", async () => {
  const { mergeKeys } = await updater();
  const before = { terminal: { "cmd-c": "terminal.copy", "cmd-f": "terminal.search" } };
  const after = { terminal: { "cmd-c": "terminal.copy", "cmd-f": "kanso-strip.find" } };
  const moved = clone(mergeKeys(clone(before), before, after));
  assert.equal(moved.changed, true);
  assert.equal(moved.keys.terminal["cmd-f"], "kanso-strip.find");
  assert.equal(moved.keys.terminal["cmd-c"], "terminal.copy");

  const custom = clone(before);
  custom.terminal["cmd-f"] = "mine.search";
  assert.equal(clone(mergeKeys(custom, before, after)).keys.terminal["cmd-f"], "mine.search");

  const removed = { terminal: { "cmd-c": "terminal.copy" } };
  assert.equal(clone(mergeKeys(clone(removed), before, after)).keys.terminal["cmd-f"], undefined, "a Cmd+F you took out stays out");

  const older = { "layout:kanso": { "cmd-d": "kanso-strip.new-right" } };
  const added = clone(mergeKeys(clone(older), { "layout:kanso": { "cmd-d": "kanso-strip.new-right" } }, after));
  assert.equal(added.keys.terminal["cmd-f"], "kanso-strip.find", "a keys file from before Find gains the conversation");
});

// A host on version 1.3.1 whose commands `exec` answers.
const releaseHost = (store, exec, notify = () => {}) => ({
  appHome: () => "/nowhere", ...storeShared(store), notify,
  readTextFile: async () => '{ "version": "1.3.1" }', layout: () => null, run: () => null, exec,
});
const toasting = (toasts) => (n) => { toasts.push(n); return "1"; };
const oneCopy = async (host) => {
  const { Updater } = await updater(host);
  return { u: new Updater(), ...context() };
};
// The tab bar's copy and the footer's, started.
const twoCopies = async (host, timers) => {
  const { Updater } = await updater(host);
  const tabs = new Updater(), footer = new Updater();
  const { cx, drain } = tickingContext(timers);
  tabs.start(cx); footer.start(cx, { polls: false }); await drain();
  return { tabs, footer, cx, drain };
};
const minutesLater = async (timers, cx, drain) => {
  for (const { ms, fn } of timers.filter((x) => x.ms > 60000)) fn(cx);
  await drain();
};

test("The tab bar looks for releases; the footer reads what it found", async () => {
  const store = {}, toasts = [], timers = [];
  let asked = 0;
  const host = releaseHost(store, async (command) => { if (command === "git") asked++; return command === "git" ? success("x\trefs/tags/v1.4.0\n") : failure(""); }, toasting(toasts));
  const { tabs, footer, cx, drain } = await twoCopies(host, timers);
  assert.equal(timers.filter((timer) => timer.ms === 1500).length, 1, "one footer fit timer");
  assert.equal(asked, 1, "one forced look on start, not one per copy");
  assert.equal(footer.available(), "1.4.0", "the footer offers what the tab bar found");
  assert.equal(toasts.filter((n) => n.title === "kansō 1.4.0 is available").length, 1);

  // Minutes later both ticks fire: only the tab bar's looks.
  store["kanso.update"] = { ...store["kanso.update"], checked: null };
  await minutesLater(timers, cx, drain);
  assert.equal(asked, 2);

  // Both asked at once (the footer's Check and the tab bar's command): GitHub is asked once.
  await Promise.all([tabs.check(cx, true), footer.check(cx, true)]);
  assert.equal(asked, 3);
});

test("With automatic checks off neither copy polls, and a Check from settings still looks once", async () => {
  const store = { "kanso.pieces": { "update.check": "hide" }, "kanso.update": { autoCheck: false } }, timers = [];
  let asked = 0;
  const host = releaseHost(store, async (command) => { if (command === "git") asked++; return success("x\trefs/tags/v1.4.0\n"); });
  const { tabs, footer, cx, drain } = await twoCopies(host, timers);
  await minutesLater(timers, cx, drain);
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
  const host = releaseHost(store, async (command) => { if (command === "git") asked++; return command === "git" && !offline ? success(tags) : failure("offline", 128); }, toasting(toasts));
  const { u, cx, drain } = await oneCopy(host);
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
  assert.equal(toasts.at(-1).title, "GitHub could not be reached");
  assert.equal(toasts.at(-1).action.name, "kanso-tabs.check", "Refresh looks again");
});

test("Automatic update checks can be disabled while manual checks still work", async () => {
  const store = { "kanso.pieces": { "update.check": "hide" }, "kanso.update": { autoCheck: false } };
  let asked = 0, tick = null;
  const host = releaseHost(store, async (command) => { if (command === "git") asked++; return success("x\trefs/tags/v1.3.1\n"); });
  const { u, cx, drain } = await oneCopy(host);
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

test("The footer is as tall as the rows it shows, and a size an older kansō set comes back to it", async (t) => {
  for (const [px, why] of [[228, "3.9.1's taller footer"], [120, "the footer with Add computer under Settings"]]) {
    const f = await fixture(t);
    f.footer.size = { px };
    const { cx, drain } = await startUpdater(f);
    assert.deepEqual(f.resizes, [84], `${why} comes back to Update and Settings`);
  }
  const { footerPx } = await updater({ shared: () => null });
  const { stateBlockPx } = await load("kanso-chrome/ui-state.js", ["stateBlockPx"], gpuiHost());
  assert.equal(footerPx(null), 52, "Settings alone: 8 above, 32, and 12 below");
  assert.equal(footerPx("3.31.0"), 84, "an update is a row on top");
  assert.equal(footerPx(null, "words"), 52, "a refusal shows only under an update row");
  const block = Math.ceil(stateBlockPx({ source: "words", fix: "Update" }, 2));
  assert.equal(footerPx("3.31.0", "words"), 84 + 2 + block + 8, "the kit's block with our words on two lines, a hair under its row and 8 above the next");
  assert.equal(footerPx("3.31.0", "words", false), 86, "in the rail two of the kit's large icon buttons (32) a hair apart, 8 above and 12 below, and no block");
  assert.equal(footerPx(null, null, false), 52, "one square");
});

test("A refused update makes room for its block in the open footer, and gives it back in the rail", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = await startUpdater(f);
  assert.deepEqual(f.resizes, [84], "Update and Settings");
  f.updater.refuse("the download failed");
  f.updater.fit();
  assert.ok(f.resizes.at(-1) > 84, "the block fits under the update row");
  f.store["sidebar.collapsed"] = true;
  f.updater.fit();
  assert.equal(f.resizes.at(-1), 86, "the rail fits its squares and draws no block");
});

test("A refused update keeps the tool's words for the footer, and an update that lands clears them", async (t) => {
  const f = await fixture(t);
  const { cx } = context();
  f.updater.refuse("git ls-remote: Could not resolve host: github.com");
  assert.equal(f.updater.refused(), "git ls-remote: Could not resolve host: github.com");
  await f.updater.report(cx, "error", "the download failed");
  assert.equal(f.updater.refused(), "the download failed");
  await f.updater.report(cx, "ok", "");
  assert.equal(f.updater.refused(), null);
});

test("A mod that did not load for want of memory asks for a restart, however the runtime words it", async () => {
  const { exhausted } = await load("kanso-chrome/main.js", ["exhausted"], { window: () => ({}) });
  assert.equal(exhausted("kanso-panel: out of memory"), true);
  assert.equal(exhausted('kanso-menu did not load: Null "null"'), true, "no room left even for the error");
  assert.equal(exhausted("kanso-menu did not load: SyntaxError: unexpected token"), false, "a broken file is not memory");
});

test("The update plan reads this platform's keymap and adds Windows keys when the installed tag predates them", async () => {
  for (const platform of ["macos", "linux", "windows"]) {
    for (const missing of [false, true]) {
      const path = `kanso/keys${platform === "windows" ? ".windows" : ""}.json`;
      const chord = platform === "windows" ? "ctrl-shift-o" : "cmd-d";
      const requests = [], before = { "layout:kanso": { [chord]: "before" } }, after = { "layout:kanso": { [chord]: "after", f5: "refresh" } };
      const current = { "layout:kanso": { ...(missing ? {} : before["layout:kanso"]), f5: "mine" } };
      const { Updater } = await updater({
        window: () => ({ platform }),
        readTextFile: async () => JSON.stringify(current),
        exec: async (cmd, args) => {
          assert.ok(cmd === "curl" || cmd === "curl.exe", cmd);
          const url = args.at(-1);
          requests.push(url);
          if (url.endsWith("layouts/kanso.json")) return { code: 0, stdout: "{}" };
          assert.ok(url.endsWith(path), url);
          return missing && url.startsWith("old/") ? { code: 22, stdout: "" } : { code: 0, stdout: JSON.stringify(url.startsWith("old/") ? before : after) };
        },
      });
      const instance = new Updater({ file: (version, file) => `${version}/${file}` });
      instance.installed = "old";
      const plan = await instance.plan("new", "/app");
      assert.ok(requests.includes(`old/${path}`) && requests.includes(`new/${path}`));
      if (missing && platform !== "windows") assert.equal(plan.keys, "", "missing Unix baseline keeps existing behavior");
      else {
        assert.deepEqual(JSON.parse(plan.keys), { "layout:kanso": { [chord]: "after", f5: "mine" } });
        assert.equal(plan.base, JSON.stringify(current));
        assert.match(plan.notes, /Kept your own f5/);
      }
    }
  }
});

test("The POSIX lock holder is the shell the updater already starts", async () => {
  const { host, HOLD } = await hostFor("macos");
  const got = host.holdArgs("/tmp/lock");
  assert.deepEqual([...got.commands], ["sh"]);
  assert.equal(got.args[1], `${HOLD}\nhold "$1" || exit $?\necho held\nexec sleep 60`);
  assert.deepEqual([...got.args.slice(2)], ["sh", "/tmp/lock"]);
});

test("A stage is on the same volume as the app home", async () => {
  const { sameVolume } = await updater();
  assert.equal(sameVolume("/tmp/app/.kanso-updates/id", "/tmp/app"), true);
  assert.equal(sameVolume("C:\\Users\\a\\.kanso-updates\\id", "C:\\Users\\a"), true);
  assert.equal(sameVolume("C:\\stage", "D:\\home"), false);
  assert.equal(sameVolume("\\\\server\\share\\a", "\\\\server\\share\\b"), true);
});

test("A pid file names a live process or a dead one", async (t) => {
  const dir = await temporary(t);
  const { host } = await hostFor(nativePlatform);
  const live = join(dir, "live.pid");
  const child = trackedSpawn(t, process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  t.after(() => dropChild(child));
  await writeFile(live, `${child.pid}\n`);
  assert.equal((await host.alive(live)).code, 0, `step alive, file ${live}`);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.notEqual((await host.alive(live)).code, 0, `step dead, file ${live}`);
});

test("The Windows updater script keeps the same contract and PowerShell 5.1", async () => {
  const home = join("/tmp", "O'Brien home");
  const dir = join(home, ".kanso-updates");
  const { windowsInstallScript, windowsLaunchScript, windowsRecoverScript, host } = await hostFor("windows");
  const script = windowsInstallScript({
    url: "https://example.test/v.tar.gz", home, dir, id: "op", want: "1.1.0", from: "1.0.0",
    checker: join(dir, "check.cmd"), stamp: "20261108-1200", keys: "{\"a\":1}", layout: "1", base: "{\"a\":1}\n",
  }, join(dir, "op.ps1"));
  assert.match(script, /O''Brien home/, "step quote, file install script");
  assert.match(script, /\$AppHome = /);
  assert.equal(/\$home\b/.test(script), false, "step assign, file install script");
  assert.equal(script.includes("'/grant'"), false, "step reset, file install script");
  assert.match(script, new RegExp(Buffer.from('{"a":1}', "utf8").toString("base64")));
  assert.match(script, new RegExp(Buffer.from('{"a":1}\n', "utf8").toString("base64")));
  for (const banned of ["&&", "||", "??", "-AsHashtable"]) assert.equal(script.includes(banned), false, `step syntax ${banned}`);
  assert.match(script, /KANSO_UPDATE_STOP/);
  assert.match(script, /\[Environment\]::Exit\(137\)/);
  assert.match(script, /FileShare\]::None/);
  assert.match(script, /UTF8Encoding \$false/);
  assert.match(script, /\.status\.part/);
  assert.match(script, /\.exe is not on PATH; nothing was downloaded another way/);
  assert.match(script, /Require-Tool 'curl'/);
  assert.match(script, /Require-Tool 'tar'/);
  const curlAt = script.indexOf("Require-Tool 'curl'");
  const tarAt = script.indexOf("Require-Tool 'tar'");
  const srcAt = script.indexOf("New-Item -ItemType Directory -Force -Path $srcDir");
  assert.ok(curlAt > 0 && tarAt > curlAt && srcAt > tarAt, "step tools, file before download");
  const launch = windowsLaunchScript(dir, "op", join(dir, "op.ps1"));
  assert.match(launch, /Start-Process .* -WindowStyle Hidden -PassThru/, "step launch, file shell execute: the worker inherits no handle");
  assert.equal(/UseShellExecute|RedirectStandard/.test(launch), false, "step launch, file no pipe passed on");
  const recoverScript = windowsRecoverScript(home, dir, join(dir, "recover.ps1"));
  assert.match(recoverScript, /FileShare\]::None/);
  assert.match(recoverScript, /function Report-Op/);
  assert.match(recoverScript, /\$Op \+ ' ' \+ \$Path/);
  assert.match(recoverScript, /if \(Wait-Sharing \$_ \$deadline\) \{ continue \}/);
  assert.equal(recoverScript.includes("KANSO_UPDATE_BLOCKED"), false);
  const removeAt = recoverScript.indexOf("function Remove-Tree");
  const settleAt = recoverScript.indexOf("function Settle");
  assert.equal(recoverScript.slice(removeAt, settleAt).includes("Start-Sleep"), false, "step stage, file a denial does not wait");
  const listedAt = recoverScript.indexOf("$dirs = @([IO.Directory]::GetDirectories($dir))");
  const holdAt = recoverScript.indexOf("$taken = Hold");
  assert.ok(listedAt > 0 && holdAt > listedAt);
  assert.match(recoverScript.slice(listedAt, holdAt), /\$dirs = \$null/, "step listing, file released before recovery");
  const tryAt = recoverScript.indexOf("function Try-Move");
  const tryBody = recoverScript.slice(tryAt, recoverScript.indexOf("function Step"));
  const shareAt = tryBody.indexOf("if (-not (Test-Sharing $_)) { return $false }");
  const unlockAt = tryBody.indexOf("Unlock-Tree");
  assert.ok(shareAt >= 0 && unlockAt > shareAt, "step rollback, file a denial does not retry");
  const held = host.holdArgs(join(dir, "lock"));
  assert.deepEqual([...held.commands], ["pwsh", "powershell"]);
  const heldArgs = [...held.args];
  assert.deepEqual(heldArgs.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  assert.equal(heldArgs.some((arg) => /[\r\n]/.test(arg)), false, "step one command, file hold script");
  const heldScript = Buffer.from(heldArgs.at(-1), "base64").toString("utf16le");
  assert.match(heldScript, /O''Brien home/);
  assert.match(heldScript, /WriteLine\('held'\)/);
  assert.match(heldScript, /Start-Sleep -Seconds 60/);
});

test("The Windows installer copies nothing before the app home exists", async () => {
  const text = await readFile(new URL("../scripts/local-install.ps1", import.meta.url), "utf8");
  assert.match(text, /\$PSScriptRoot/);
  assert.match(text, /\$env:APPDATA/);
  assert.match(text, /HERDR_APP_HOME/);
  assert.match(text, /keys\.windows\.json/);
  assert.equal(text.includes("instead of keys.json"), false);
  for (const banned of ["&&", "??"]) assert.equal(text.includes(banned), false, banned);
  const homeAt = text.indexOf("HERDR_APP_HOME");
  const testAt = text.indexOf("Test-Path");
  const copyAt = text.indexOf("Copy-Item");
  assert.ok(homeAt >= 0 && testAt > homeAt && copyAt > testAt, "step home, file before copy");
});

test("A home path with a space and an apostrophe installs", async (t) => {
  const s = await small(t);
  const home = await s.fresh("O'Brien home");
  assert.equal(await s.run(home, 0), "ok", `step install, file ${home}`);
  assert.equal(await versionFile(home), '{ "version": "1.1.0" }\n');
});

windowsOnly("A file in use is retried, then the update is undone and the file is named", async (t) => {
  const s = await small(t);
  const home = await s.fresh("in-use");
  const locked = join(home, "mods", "kanso-chrome", "main.js");
  const lock = heldFile(t, locked, join(s.root, "release-lock"));
  await lock.held;
  const how = await s.run(home, 0, { env: { KANSO_UPDATE_RETRY_MS: "600" } });
  assert.match(how, /could not put kanso-chrome in place/, how);
  assert.ok(how.includes("kanso-chrome"), how);
  assert.equal(await readFile(join(home, "mods/kanso-chrome/version.json"), "utf8"), '{ "version": "1.0.0" }\n', how);
  await lock.stop();
});

windowsOnly("A read-only file is still updated", async (t) => {
  const s = await small(t);
  const home = await s.fresh("readonly");
  const file = join(home, "mods", "kanso-chrome", "main.js");
  const marked = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$i = Get-Item -LiteralPath ${quote(file)}; $i.IsReadOnly = $true; if (-not $i.IsReadOnly) { exit 2 }`]);
  assert.equal(marked.code, 0, `step readonly, file ${file}: ${marked.stderr}`);
  assert.equal(await s.run(home, 0), "ok", `step install, file ${file}`);
  assert.equal(await versionFile(home), '{ "version": "1.1.0" }\n');
});

const recoverHome = async (t) => {
  const root = await realpath(await temporary(t));
  const home = join(root, "home");
  const dir = join(home, ".kanso-updates");
  return { root, home, dir };
};

const recoverNow = async (home, dir, env = {}) => {
  const { host } = await hostFor("windows");
  return host.recover(home, dir, { env: { ...process.env, KANSO_UPDATE_RETRY_MS: "8000", ...env } });
};

const watchRecover = async (t, home, dir, file, ready) => {
  const { windowsRecoverScript } = await hostFor("windows");
  await writeFile(file, `\uFEFF${windowsRecoverScript(home, dir, file)}`);
  const child = trackedSpawn(t, "powershell.exe", ["-NoProfile", "-NonInteractive", "-File", file], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, KANSO_UPDATE_RETRY_MS: "8000" },
  });
  let err = "";
  child.stderr.on("data", (chunk) => { err += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  const saw = await Promise.race([
    (async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (ready(() => err)) return "sharing";
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return err;
    })(),
    exited.then((code) => `exited ${code} ${err}`),
  ]);
  return { saw, exited, text: () => err };
};

const expectStop = (result, op, path, began) => {
  assert.equal(result.code, 1, result.stderr);
  const prefix = `${op} ${path} `;
  const line = result.stderr.split(/\r?\n/).find((row) => row.startsWith(prefix));
  assert.ok(line, result.stderr);
  assert.ok(line.slice(prefix.length).trim(), line);
  assert.ok(Date.now() - began < 7000, `waited ${Date.now() - began}: ${result.stderr}`);
};

windowsOnly("A file still open in an update that stopped does not stop recovery once it closes", async (t) => {
  const { root, home, dir } = await recoverHome(t);
  const stage = join(dir, "op");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "slots"), "");
  const locked = join(stage, "leftover.txt");
  await writeFile(locked, "open\n");
  const lock = heldFile(t, locked, join(root, "release"));
  await lock.held;
  const watched = await watchRecover(t, home, dir, join(dir, "recover.ps1"), (text) => text().includes("sharing delete") && text().includes("leftover.txt"));
  assert.equal(watched.saw, "sharing", watched.text());
  await lock.open();
  assert.equal(await watched.exited, 0, watched.text());
  assert.equal((await readdir(dir)).includes("op"), false, watched.text());
});

windowsOnly("A permanent denial of a recovery rename stops at once and keeps the source and the prior destination", async (t) => {
  const made = await recoverHome(t);
  const stage = join(made.dir, "op");
  const source = join(stage, "old", "kanso.json");
  const prior = join(made.home, "layouts", "kanso.json.old-stamp");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "main.js"), "old\n");
  await mkdir(join(made.home, "layouts"), { recursive: true });
  await writeFile(prior, "prior\n");
  await writeFile(join(stage, "stamp"), "stamp\n");
  await writeFile(join(stage, "committed"), "1\n");
  await writeFile(join(stage, "slots"), "");
  const began = Date.now();
  expectStop(await recoverNow(made.home, made.dir), "rename", source, began);
  assert.equal(await readFile(join(source, "main.js"), "utf8"), "old\n");
  assert.equal(await readFile(prior, "utf8"), "prior\n");
});

windowsOnly("A failed parent creation names that create, not a rename of the live mod", async (t) => {
  const made = await recoverHome(t);
  const live = join(made.home, "mods", "kanso-chrome");
  const stage = join(made.dir, "op");
  const parent = join(stage, "src", "kanso", "mods");
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "main.js"), "old\n");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "src"), "not a directory\n");
  await writeFile(join(stage, "slots"), "1 kanso-chrome\n");
  const began = Date.now();
  const result = await recoverNow(made.home, made.dir);
  expectStop(result, "create", parent, began);
  assert.equal(result.stderr.includes(`rename ${live}`), false, result.stderr);
  assert.equal(await readFile(join(live, "main.js"), "utf8"), "old\n");
});

windowsOnly("A destination another writer fills while rollback waits stops the move and keeps both sides", async (t) => {
  const made = await recoverHome(t);
  const stage = join(made.dir, "op", "src", "kanso", "mods");
  const live = join(made.home, "mods", "kanso-chrome");
  const dest = join(stage, "kanso-chrome");
  const kept = join(dest, "kept.txt");
  await mkdir(stage, { recursive: true });
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "held.txt"), "open\n");
  await writeFile(join(made.dir, "op", "slots"), "0 kanso-chrome\n");
  const lock = heldFile(t, join(live, "held.txt"), join(made.root, "release"));
  await lock.held;
  const watched = await watchRecover(t, made.home, made.dir, join(made.root, "recover-share.ps1"), (text) => text().includes("sharing rename") && text().includes(live));
  assert.equal(watched.saw, "sharing", watched.text());
  await mkdir(dest, { recursive: true });
  await writeFile(kept, "prior\n");
  await lock.open();
  assert.equal(await watched.exited, 1, watched.text());
  assert.deepEqual(await readdir(live), ["held.txt"], watched.text());
  assert.equal(await readFile(join(live, "held.txt"), "utf8"), "open\n", watched.text());
  assert.deepEqual(await readdir(dest), ["kept.txt"], watched.text());
  assert.equal(await readFile(kept, "utf8"), "prior\n", watched.text());
  const prefix = `move ${live} ${dest} `;
  const line = watched.text().split(/\r?\n/).find((row) => row.startsWith(prefix));
  assert.ok(line && line.slice(prefix.length).trim(), watched.text());
});

windowsOnly("A live file recovery does not own stops rollback and is left in place", async (t) => {
  const made = await recoverHome(t);
  const live = join(made.home, "keys.json");
  const backup = join(made.dir, "op", "old", "keys.json");
  const staged = join(made.dir, "op", "keys.json");
  const journal = join(made.dir, "op", "slots");
  await mkdir(join(made.dir, "op", "old"), { recursive: true });
  await writeFile(live, "user edits\n");
  await writeFile(backup, "backup\n");
  await writeFile(staged, "staged\n");
  await writeFile(journal, "1 keys\n");
  const check = async () => {
    const started = Date.now();
    const result = await recoverNow(made.home, made.dir);
    expectStop(result, "undo", live, started);
    const line = result.stderr.split(/\r?\n/).find((row) => row.startsWith(`undo ${live} `));
    assert.ok(line.includes(backup) && line.includes(staged), result.stderr);
  };
  await check();
  await check();
  assert.equal(await readFile(live, "utf8"), "user edits\n");
  assert.equal(await readFile(backup, "utf8"), "backup\n");
  assert.equal(await readFile(staged, "utf8"), "staged\n");
  assert.equal(await readFile(journal, "utf8"), "1 keys\n");
});

windowsOnly("A permanent denial of stage cleanup stops at once and names that delete", async (t) => {
  const made = await recoverHome(t);
  const slots = join(made.dir, "op", "slots");
  const stage = join(made.dir, "op");
  await mkdir(stage, { recursive: true });
  await writeFile(slots, "\n");
  const odd = "\\\\?\\" + stage + "\\denied.";
  const created = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[IO.File]::WriteAllText(${quote(odd)}, 'kept')`]);
  assert.equal(created.code, 0, created.stderr);
  const began = Date.now();
  expectStop(await recoverNow(made.home, made.dir), "delete", stage, began);
  assert.equal((await readdir(made.dir)).includes("op"), true);
});

const stopCase = async (t, op, build, env) => {
  const made = await build(t);
  const began = Date.now();
  expectStop(await recoverNow(made.home, made.dir, env), op, made.path, began);
};

windowsOnly("Every recovery exit of 1 names the operation, the path and the error", async (t) => {
  await stopCase(t, "lock", async (hook) => {
    const made = await recoverHome(hook);
    const path = join(made.dir, "lock");
    await mkdir(join(made.dir, "op"), { recursive: true });
    await mkdir(path);
    return { ...made, path };
  });
  await stopCase(t, "read", async (hook) => {
    const made = await recoverHome(hook);
    const path = join(made.dir, "op", "slots");
    await mkdir(path, { recursive: true });
    return { ...made, path };
  });
  await stopCase(t, "write", async (hook) => {
    const made = await recoverHome(hook);
    const stage = join(made.dir, "op");
    const path = join(stage, "slots");
    await mkdir(stage, { recursive: true });
    await writeFile(path, "0 keys\n");
    await writeFile(join(made.dir, "op", "keys.json"), "new\n");
    const lock = heldFile(hook, path, join(made.root, "release"), "Read");
    await lock.held;
    hook.after(() => lock.open());
    return { ...made, path };
  }, { KANSO_UPDATE_RETRY_MS: "0" });
  await stopCase(t, "undo", async (hook) => {
    const made = await recoverHome(hook);
    const path = join(made.home, "mods", "kanso-chrome");
    await mkdir(join(made.dir, "op"), { recursive: true });
    await writeFile(join(made.dir, "op", "slots"), "1 kanso-chrome\n");
    return { ...made, path };
  });
  const { root, home } = await recoverHome(t);
  const updates = join(home, ".kanso-updates");
  await mkdir(home, { recursive: true });
  await writeFile(updates, "not a directory\n");
  const file = join(root, "recover.ps1");
  const { windowsRecoverScript } = await hostFor("windows");
  await writeFile(file, `\uFEFF${windowsRecoverScript(home, updates, file)}`);
  const began = Date.now();
  expectStop(await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", file], { limit: 20000 }), "recover", updates, began);
});

windowsOnly("A missing curl.exe stops before a download and names the tool", async (t) => {
  const s = await small(t);
  const home = await s.fresh("nocurl");
  const powershell = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0");
  const how = await s.run(home, 0, { env: { PATH: powershell, Path: powershell } });
  assert.match(how, /curl\.exe is not on PATH; nothing was downloaded another way/, how);
  assert.deepEqual(await tree(home), s.before, how);
  assert.deepEqual(await stages(home), [], how);
});
