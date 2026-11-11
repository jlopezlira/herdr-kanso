import assert from "node:assert/strict";
import nodeTest, { after as afterAll } from "node:test";
import { execFile, execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load, context, exec, nativePlatform, nativeWindow, temporary, clone, until } from "./helpers.mjs";

const names = ["Updater", "newestTag", "compareVersions", "mergeKeys", "SOURCE", "footerPx", "HOLD", "INSTALL_SCRIPT", "RECOVER", "LAUNCH", "updateHost", "windowsInstallScript", "windowsLaunchScript", "windowsRecoverScript", "sameVolume"];
export const repo = new URL("../kanso/", import.meta.url);
export const windows = process.platform === "win32";
export const test = (name, options, fn) => typeof options === "function"
  ? nodeTest(name, { timeout: 60_000 }, options)
  : nodeTest(name, { timeout: 60_000, ...options }, fn);
const livePids = new Map();
function endTree(pid) {
  if (!pid) return;
  if (windows) {
    try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}
// A pipe to a child that is still running keeps the test process from exiting.
export function dropChild(child) {
  if (windows) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
  endTree(child.pid);
  if (!windows) return;
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
  child.unref();
}
export function trackedSpawn(t, command, args, options) {
  const child = spawn(command, args, options);
  if (child.pid) livePids.set(child.pid, t.name);
  child.once("exit", () => livePids.delete(child.pid));
  return child;
}
afterAll(() => {
  const left = [...livePids];
  if (!windows) {
    for (const [pid] of left) endTree(pid);
    return;
  }
  for (const [pid, name] of left) {
    console.error(`update tests left pid ${pid} started by ${name}`);
    try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
  }
});
async function stopInstalls(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await stopInstalls(path);
    else if (entry.name.endsWith(".pid")) {
      const pid = Number((await readFile(path, "utf8").catch(() => "")).trim());
      if (pid) endTree(pid);
    }
  }
}
export const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const pauses = (command, args) => command === "sleep" || (args ?? []).some((arg) => String(arg).includes("Start-Sleep"));
const fetches = (command) => command === "curl" || command === "curl.exe";

function rawExec(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.limit ?? 60000,
      killSignal: "SIGKILL",
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) resolve({ code: 0, stdout: stdout ?? "", stderr: stderr ?? "", signal: null });
      else resolve({ code: error.code ?? null, stdout: error.stdout ?? stdout ?? "", stderr: error.stderr ?? stderr ?? "", signal: error.signal ?? null });
    });
  });
}
function classify(result) {
  if (result?.signal === "SIGKILL" || result?.signal === "SIGTERM" || result?.code === 137) return "killed";
  if (result?.code === 0) return "ok";
  const line = String(result?.stderr ?? "").replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  return `failed: ${line}`;
}
async function writeChecker(root, { record = false } = {}) {
  if (!windows) {
    const checker = join(root, "check.sh");
    const body = record
      ? [
        "name=$(basename \"$2\")",
        `echo "$name" >> "${root}/checks"`,
        `if [ -f "${root}/slow" ] && [ "$name" = open-with ]; then while [ ! -f "${root}/go" ]; do sleep 0.05; done; fi`,
        `if [ -f "${root}/sabotage" ] && [ "$name" = kanso-chrome ]; then chmod 555 "$2"; fi`,
        "",
      ].join("\n")
      : `if [ -f "${root}/sabotage" ] && [ "$(basename "$2")" = kanso-chrome ]; then chmod 555 "$2"; fi\n`;
    await writeFile(checker, body, { mode: 0o755 });
    return checker;
  }
  const script = join(root, "check.mjs");
  await writeFile(script, [
    `import { appendFileSync, existsSync } from "node:fs";`,
    `import { basename, join } from "node:path";`,
    `import { execFileSync } from "node:child_process";`,
    `const root = ${JSON.stringify(root)};`,
    `const modPath = process.argv[3];`,
    `const name = basename(modPath ?? "");`,
    record ? `appendFileSync(join(root, "checks"), name + "\\n");` : "",
    record ? `if (existsSync(join(root, "slow")) && name === "open-with") { while (!existsSync(join(root, "go"))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }` : "",
    `if (existsSync(join(root, "sabotage")) && name === "kanso-chrome") execFileSync("icacls", [modPath, "/deny", "*S-1-1-0:(OI)(CI)F"], { stdio: "ignore", windowsHide: true });`,
    "",
  ].filter((line) => line !== "").join("\n"));
  const checker = join(root, "check.cmd");
  await writeFile(checker, "@echo off\r\nnode \"%~dp0check.mjs\" \"%~1\" \"%~2\"\r\n");
  return checker;
}
export const windowsOnly = (name, fn) => test(name, { skip: !windows && "Unix has no Windows file lock, read-only attribute, or curl.exe beside powershell.exe" }, fn);

export async function updater(host) {
  return load("kanso-chrome/update.js", names, host);
}

// A Herdr home with Kanso 1.0.0 installed and used, and two releases served
// from file:// URLs: what v1.0.0 shipped and the v1.1.0 tarball.
export async function fixture(t, { layoutChanged = true, homeName = "O'Brien home" } = {}) {
  const root = await temporary(t);
  const home = join(root, homeName), site = join(root, "site");
  const shippedKeys = JSON.parse(await readFile(new URL("keys.json", repo), "utf8"));
  const shippedLayout = await readFile(new URL("layouts/kanso.json", repo), "utf8");

  // v1.0.0, as GitHub's raw files.
  const oldKeys = clone(shippedKeys);
  oldKeys["layout:kanso"]["cmd-d"] = "kanso-strip.old-right";
  delete oldKeys["layout:kanso"]["cmd-shift-w"];
  await mkdir(join(site, "v1.0.0/kanso/layouts"), { recursive: true });
  // Windows reads keys.windows.json. The same bytes stand in for this fixture.
  const oldKeymap = JSON.stringify(oldKeys);
  await writeFile(join(site, "v1.0.0/kanso/keys.json"), oldKeymap);
  await writeFile(join(site, "v1.0.0/kanso/keys.windows.json"), oldKeymap);
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
  const newKeymap = await readFile(new URL("keys.json", repo), "utf8");
  await writeFile(join(site, "v1.1.0/kanso/keys.json"), newKeymap);
  await writeFile(join(site, "v1.1.0/kanso/keys.windows.json"), newKeymap);
  await writeFile(join(site, "v1.1.0/kanso/layouts/kanso.json"), shippedLayout);

  // Herdr's `herdr-app check`, faked: it notes each mod, and on a file's say holds open-with
  // (slow) or makes kanso-chrome, the last to go in, impossible to move into place (sabotage).
  const checker = await writeChecker(root, { record: true });

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
  let closed = false;
  t.after(async () => { closed = true; await stopInstalls(root); });
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
      window: nativeWindow,
      exec: async (command, args, options) => {
        if (closed) return { code: 1, stdout: "", stderr: "" };
        if (command === "git") return { code: 0, stdout: "x\trefs/tags/v1.0.0\ny\trefs/tags/v1.1.0\n", stderr: "" };
        if (ctl.abandon && pauses(command, args)) { ctl.stuck += 1; return new Promise(() => {}); }
        if (ctl.holdCurl && fetches(command)) { ctl.held += 1; await gate.promise; }
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
export const updates = (home) => join(home, ".kanso-updates");
export const staged = async (home) => [
  ...(await readdir(home)).filter((x) => x.startsWith(".") && x !== ".kanso-updates"),
  ...(await readdir(updates(home)).catch(() => [])).filter((x) => x !== "lock").map((x) => `.kanso-updates/${x}`),
].toSorted();
export const pending = (f) => Object.keys(f.store["kanso.update"]?.installs ?? {});
// Another install holding the lock: a real process, asleep, whose life is the lock's.
function pickCommand(commands) {
  if (commands.length === 1) return commands[0];
  for (const command of commands) {
    try { execFileSync(command, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore", windowsHide: true, timeout: 15000 }); return command; }
    catch (error) { if (error.status === 0) return command; }
  }
  return commands.at(-1);
}
export async function holder(t, f) {
  await mkdir(updates(f.home), { recursive: true });
  const spec = f.updater.host.holdArgs(join(updates(f.home), "lock"));
  // Detached on Windows drops the stdout handle, so the holder exits before it says it holds the lock.
  const child = trackedSpawn(t, pickCommand(spec.commands), spec.args, { detached: !windows, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let note = "";
  child.stderr.on("data", (chunk) => { note = `${note}${chunk}`.slice(-400); });
  child.once("error", (error) => { note = `${note} ${error.message}`.trim(); });
  const ended = new Promise((resolve) => child.once("close", resolve));
  const kill = async () => {
    endTree(child.pid);
    const stopped = await Promise.race([ended.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), windows ? 2000 : 10000))]);
    if (!stopped) dropChild(child);
  };
  t.after(() => dropChild(child));
  const got = await Promise.race([
    new Promise((resolve) => child.stdout.once("data", () => resolve(true))),
    ended.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
  ]);
  if (!got) dropChild(child);
  return { got, pid: child.pid, kill, note: note.replace(/^\uFEFF/, "").trim() };
}
export const took = (h, why) => assert.ok(h.got, [why, h.note].filter(Boolean).join(": "));
export const version = async (home) => JSON.parse(await readFile(join(home, "mods/kanso-chrome/version.json"), "utf8")).version;
export const told = (toasts) => toasts.filter((n) => n.title === "kansō is already being updated");
export const updated = (toasts) => toasts.filter((n) => n.title === "kansō updated to 1.1.0");

// A small release (three mods, a theme, the layout and its picture) and a home with two of those
// mods, for running INSTALL_SCRIPT itself many times.
export async function small(t) {
  const root = await temporary(t);
  t.after(() => stopInstalls(root));
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
  const checker = await writeChecker(root);
  const url = pathToFileURL(join(site, "v1.1.0.tar.gz")).href;
  const { HOLD, INSTALL_SCRIPT, RECOVER, LAUNCH, updateHost } = await updater({ window: nativeWindow });
  const writer = async (path, text) => { await writeFile(path, text); return null; };
  const host = updateHost(nativePlatform, rawExec, writer, { HOLD, INSTALL_SCRIPT, RECOVER, LAUNCH });
  // An install of 1.1.0 over `from`, killed after its `stop`-th step (0: never). By default it
  // brings keys merged from yours and a new layout; a reinstall over 1.1.0 brings neither.
  const run = async (home, stop, { from = "1.0.0", sabotage = false, base, env = {} } = {}) => {
    const dir = join(home, ".kanso-updates");
    await mkdir(dir, { recursive: true }); // as LAUNCH makes it
    if (sabotage) await writeFile(join(root, "sabotage"), "");
    const plan = from === "1.0.0" ? ['{"merged":true}', "1", '{"yours":true}\n'] : ["", "", ""];
    const [keys, layout, baseKeys] = plan;
    const result = await host.foreground({
      url, home, dir, id: "op", want: "1.1.0", from, checker, stamp: "20261108-1200",
      keys, layout, base: base ?? baseKeys,
    }, { env: { ...process.env, KANSO_UPDATE_STOP: String(stop), ...env }, limit: 60000 });
    await rm(join(root, "sabotage"), { force: true });
    return classify(result);
  };
  const recover = (home) => host.recover(home, join(home, ".kanso-updates"));
  const fresh = async (name) => { const home = join(root, name); await cp(base, home, { recursive: true }); return home; };
  const before = await tree(base);
  const whole = await fresh("whole");
  assert.equal(await run(whole, 0), "ok");
  return { root, run, recover, fresh, before, after: await tree(whole) };
}

// Every file under a home, by path, with its content; .kanso-updates aside.
export async function tree(dir, at = "") {
  const entries = await readdir(join(dir, at), { withFileTypes: true }).catch(() => []);
  const parts = await Promise.all(entries.filter((e) => !(at === "" && e.name === ".kanso-updates")).map(async (e) => {
    const path = at ? `${at}/${e.name}` : e.name;
    return e.isDirectory() ? tree(dir, path) : { [path]: await readFile(join(dir, path), "utf8") };
  }));
  return Object.assign({}, ...parts);
}
export const stages = async (home) => (await readdir(updates(home), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
// Recovery, run as a copy that starts would, must end at one whole install, change nothing run
// again, leave nothing staged, and let the next install through.
export async function recovered(s, home, at) {
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

// Kills an install after each step from `first` to `last` and checks the recovery from each. It
// ends at the first step the install gets past: `end` is then the home that install left.
export async function sweep(s, { sabotage = false, first = 1, last = 60 } = {}) {
  const kills = [];
  for (let stop = first; stop <= last; stop += 1) {
    const home = await s.fresh(`${sabotage ? "s" : "k"}${stop}`);
    const how = await s.run(home, stop, { sabotage });
    if (how !== "killed") {
      if (sabotage) assert.match(how, /could not put kanso-chrome in place/); else assert.equal(how, "ok");
      return { kills, end: await tree(home) };
    }
    // Herdr started cold now loads what is on disk: an updater, to start the recovery, is there.
    const files = await tree(home);
    assert.ok(["kanso-chrome", "kanso-tabs"].some((name) => files[`mods/${name}/main.js`]), `no updater on disk after step ${stop}`);
    kills.push(await recovered(s, home, `step ${stop}${sabotage ? " (undoing)" : ""}`));
  }
  return { kills, end: null };
}

// The first window's install, killed after its `stop`-th step and never heard from again: its
// copy is replaced by the swap, so nothing in that window recovers it.
export async function killed(t, f, stop) {
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
  await until(async () => (await f.updater.host.alive(pid)).code !== 0);
  delete process.env.KANSO_UPDATE_STOP;
  return { cx, drain };
}
// The step right after the new kanso-chrome goes in (its version.json says 1.1.0), before the
// commit: keys and layout aside and in (4), the picture, each theme and every mod but kanso-chrome
// in (none of them here before), then kanso-chrome aside and in (2).
export const chromeIn = async () => {
  const mods = (await readdir(new URL("mods/", repo))).length;
  const themes = (await readdir(new URL("themes/", repo))).length;
  return 4 + 1 + themes + (mods - 1) + 2;
};

export async function hostFor(platform) {
  const loaded = await updater({ window: () => ({ platform }) });
  const host = loaded.updateHost(platform, rawExec, async (path, text) => { await writeFile(path, text); return null; }, loaded);
  return { ...loaded, host };
}
