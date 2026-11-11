import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, context, exec, nativePlatform, temporary, clone } from "./helpers.mjs";
import { test, dropChild, trackedSpawn, quote, windowsOnly, updater, fixture, version, small, tree, stages, hostFor } from "./update-harness.mjs";

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
  assert.equal(timers.filter((timer) => timer.ms === 1500).length, 1, "one footer fit timer");
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
  const store = { "kanso.pieces": { "update.check": "hide" }, "kanso.update": { autoCheck: false } }, timers = [];
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
  const store = { "kanso.pieces": { "update.check": "hide" }, "kanso.update": { autoCheck: false } };
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
  f.store["kanso.pieces"] = { "footer.machine": "hide" };
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
  assert.match(windowsRecoverScript(home, dir, join(dir, "recover.ps1")), /FileShare\]::None/);
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
  assert.equal((await tree(home))["mods/kanso-chrome/version.json"], '{ "version": "1.1.0" }\n');
});

windowsOnly("A file in use is retried, then the update is undone and the file is named", async (t) => {
  const s = await small(t);
  const home = await s.fresh("in-use");
  const locked = join(home, "mods", "kanso-chrome", "main.js");
  const release = join(s.root, "release-lock");
  const child = trackedSpawn(t, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
    "$ErrorActionPreference = 'Stop'",
    `$s = [IO.File]::Open(${quote(locked)}, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)`,
    "[Console]::Out.WriteLine('held')",
    "[Console]::Out.Flush()",
    `while (-not (Test-Path -LiteralPath ${quote(release)})) { Start-Sleep -Milliseconds 100 }`,
    "$s.Dispose()",
  ].join("; ")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const ended = new Promise((resolve) => child.once("exit", resolve));
  const releaseLock = async () => {
    try { writeFileSync(release, "go"); } catch { /* the tree is already gone */ }
    const finished = await Promise.race([ended.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
    if (!finished) dropChild(child);
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 2000))]);
    dropChild(child);
  };
  t.after(releaseLock);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`step lock, file ${locked}`)), 15000);
    child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`step lock exited ${code}, file ${locked}`)); });
  });
  const how = await s.run(home, 0, { env: { KANSO_UPDATE_RETRY_MS: "600" } });
  assert.match(how, /could not put kanso-chrome in place/, how);
  assert.ok(how.includes("kanso-chrome"), how);
  assert.equal(await readFile(join(home, "mods/kanso-chrome/version.json"), "utf8"), '{ "version": "1.0.0" }\n', how);
  await releaseLock();
});

windowsOnly("A read-only file is still updated", async (t) => {
  const s = await small(t);
  const home = await s.fresh("readonly");
  const file = join(home, "mods", "kanso-chrome", "main.js");
  const marked = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$i = Get-Item -LiteralPath ${quote(file)}; $i.IsReadOnly = $true; if (-not $i.IsReadOnly) { exit 2 }`]);
  assert.equal(marked.code, 0, `step readonly, file ${file}: ${marked.stderr}`);
  assert.equal(await s.run(home, 0), "ok", `step install, file ${file}`);
  assert.equal((await tree(home))["mods/kanso-chrome/version.json"], '{ "version": "1.1.0" }\n');
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
