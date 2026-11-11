import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile, utimes, symlink, access, readFile } from "node:fs/promises";
import { guardHost, guardHome, guardEnvironment, macProcesses, footprintValues, workingSets, windowsMemory, macMemory, memoryLow, idleValue, corePid, windowAncestor, uniqueWindow, windowNotice, resumeShellReason } from "../kanso/mods/kanso-guard/guard-host.mjs";
import { windowsProcesses } from "../kanso/mods/kanso-panel/platform-processes.js";
import { watchChecks, acquireGuardLock, guardReads } from "../kanso/mods/kanso-guard/guard.mjs";
import { temporary } from "./helpers.mjs";

const MB = 1024 * 1024;
const result = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const windowsRows = [{ pid: 40, ppid: 30, name: "node.exe", executable: "C:\\Node\\node.exe" }, { pid: 30, ppid: 20, name: "pwsh.exe" }, { pid: 20, ppid: 10, name: "cmd.exe" }, { pid: 10, ppid: 1, name: "renamed.exe", executable: "C:\\Program Files\\My Window.exe" }];

test("The installer follows ancestors through launchers and never guesses from a program name", () => {
  assert.deepEqual(windowAncestor(windowsRows, 40), { executable: windowsRows[3].executable });
  const missing = windowsRows.filter((p) => p.pid !== 20);
  assert.match(windowAncestor(missing, 40).reason, /could not be identified/);
  assert.match(windowAncestor(windowsRows.map((p) => p.pid === 10 ? { ...p, executable: null } : p), 40).reason, /path is unavailable/);
  assert.match(windowAncestor([{ pid: 40, ppid: 30 }, { pid: 30, ppid: 40, name: "node.exe" }], 40).reason, /could not be identified/);
  assert.match(windowAncestor([], 40).reason, /could not be identified/);
  assert.deepEqual(windowAncestor([{ pid: 40, ppid: 30 }, { pid: 30, ppid: 20, name: "conhost.exe" }, { pid: 20, ppid: 10, name: "powershell.exe" }, windowsRows[3]], 40), { executable: windowsRows[3].executable });
});

test("Only one matching executable can be sampled or restarted, including case and separator variants", () => {
  const executable = windowsRows[3].executable;
  assert.deepEqual(uniqueWindow(windowsRows, executable.toLowerCase().replaceAll("\\", "/")), { pid: 10, reason: null });
  assert.equal(uniqueWindow([], executable).pid, null);
  assert.match(uniqueWindow([], executable).reason, /not running/);
  assert.match(uniqueWindow(windowsRows, null).reason, /not recorded/);
  const ambiguous = uniqueWindow([...windowsRows, { ...windowsRows[3], pid: 11 }], executable);
  assert.equal(ambiguous.pid, null);
  assert.match(ambiguous.reason, /Several windows/);
  assert.equal(uniqueWindow([{ pid: 50, name: "My Window.exe", executable: "D:\\My Window.exe" }], executable).pid, null);
});

test("Process parsers retain memory, parentage, executable paths and process start identity", () => {
  assert.deepEqual(macProcesses(" 8 1 2048 1-01:02:03 Tue Nov 10 12:30:00 2026 /Applications/Herdr.app/Herdr --arg\nbad"), [{ pid: 8, ppid: 1, rssMB: 2, ageMin: 1502, lstart: "Tue Nov 10 12:30:00 2026", command: "/Applications/Herdr.app/Herdr --arg", name: "Herdr" }]);
  assert.deepEqual(macProcesses(""), []);
  const at = Date.parse("2026-11-11T00:01:00Z"), rows = windowsProcesses(JSON.stringify({ pid: 9, ppid: 8, name: "window.exe", executable: "C:\\window.exe", bytes: MB * 2, created: "2026-11-11T00:00:00Z" }), at);
  assert.equal(rows[0].started, at - 60000);
  assert.equal(rows[0].executable, "C:\\window.exe");
  assert.equal(rows[0].ppid, 8);
  assert.equal(workingSets(rows).get(9), 2);
  assert.equal(windowsProcesses('[{"pid":9,"created":"bad"}]')[0].started, null);
  assert.deepEqual([...footprintValues({ processes: [{ pid: "8", footprint: MB * 4 }] })], [[8, 4]]);
  assert.equal(footprintValues(null).size, 0);
  assert.equal(corePid('{"pid":62490,"holders":[{"pid":99}]}'), 62490);
  assert.equal(corePid('{"pid":0}'), null);
  assert.equal(corePid('{"pid":"bad"}'), null);
  assert.throws(() => corePid("bad"));
});

test("Memory parsers keep Windows page-file usage distinct and apply the swap limit only on macOS", () => {
  const windows = windowsMemory(1000 * MB, 250 * MB, '[{"CurrentUsage":3000,"AllocatedBaseSize":4000},{"CurrentUsage":3000,"AllocatedBaseSize":4000}]');
  assert.deepEqual(windows, { totalMB: 1000, freePct: 25, swapMB: 6000, swapTotalMB: 8000 });
  assert.equal(windowsMemory(MB, MB, "null").swapMB, 0);
  assert.equal(windowsMemory(0, 0, "[]").freePct, 0);
  const limits = { lowFreePct: 20, lowSwapMB: 5000 };
  assert.equal(memoryLow("windows", windows, limits), false);
  assert.equal(memoryLow("macos", windows, limits), true);
  for (const platform of ["windows", "macos"]) {
    assert.equal(memoryLow(platform, { freePct: 19, swapMB: 0 }, limits), true);
    assert.equal(memoryLow(platform, { freePct: 20, swapMB: 5000 }, limits), false);
  }
  assert.deepEqual(macMemory(String(MB * 1000), "30", "total = 4000.00M used = 512.5M free = 3487.5M"), { totalMB: 1000, freePct: 30, swapMB: 513, swapTotalMB: 4000 });
  assert.equal(idleValue("macos", '"HIDIdleTime" = 120900000000'), 120);
  assert.equal(idleValue("macos", "missing"), 0);
  assert.equal(idleValue("windows", "120.9\r\n"), 120.9);
});

test("Every Linux host operation explains its unavailability and runs no command", async () => {
  const host = guardHost({ platform: "linux", run: () => assert.fail("No Linux command"), self: "guard.mjs" });
  assert.equal(host.available, false);
  for (const operation of Object.values(host).filter((value) => typeof value === "function")) assert.deepEqual(await operation(), { state: "unavailable", reason: "Memory is not available on linux" });
});

test("The guard uses the selected home and supports resuming only shells it can quote", () => {
  assert.equal(guardHome({ HERDR_APP_HOME: "C:\\Selected" }, "ignored"), "C:\\Selected");
  assert.match(guardHome({}, "/home/jj"), /\.config[/\\]herdr-app$/);
  assert.equal(guardHome({}, "C:\\Users\\JJ", "windows"), "C:\\Users\\JJ\\.config\\herdr-app");
  assert.equal(guardEnvironment({ PATH: "original" }, "/home/jj", "windows").PATH, "original");
  assert.match(guardEnvironment({ PATH: "original" }, "/home/jj", "macos").PATH, /homebrew/);
  for (const platform of ["macos", "windows"]) assert.equal(resumeShellReason(platform, { name: "pwsh.exe" }), null);
  assert.equal(resumeShellReason("windows", { executable: "C:\\Windows\\powershell.EXE" }), null);
  assert.match(resumeShellReason("windows", { name: "cmd.exe" }), /PowerShell/);
  assert.match(resumeShellReason("windows", null), /PowerShell/);
});

test("Windows commands carry literal arguments, use limited logon scheduling and report forced stops", async () => {
  const calls = [], host = guardHost({ platform: "windows", appHome: "C:\\O'Brien\\Herdr", self: "C:\\O'Brien\\guard.mjs", node: "C:\\Node JS\\node.exe", taskName: "kanso-test-only", run: async (command, args) => { calls.push({ command, args }); return result(); } });
  await host.install();
  const schedule = calls.at(-1).args.at(-1);
  assert.match(schedule, /Register-ScheduledTask/);
  assert.match(schedule, /kanso-test-only/);
  assert.match(schedule, /-AtLogOn/);
  assert.match(schedule, /-LogonType Interactive -RunLevel Limited/);
  assert.match(schedule, /Start-ScheduledTask/);
  assert.doesNotMatch(schedule, /RepetitionInterval|Highest/);
  const encoded = /EncodedCommand ([A-Za-z\d+/=]+)/.exec(schedule)[1];
  const action = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(action, /HERDR_APP_HOME='C:\\O''Brien\\Herdr'/);
  assert.match(action, /guard\.mjs' watch/);
  await host.scheduled(); await host.uninstall();
  assert.match(calls.at(-1).args.at(-1), /Stop-ScheduledTask.*Unregister-ScheduledTask/);
  assert.equal((await host.stop(42)).forced, false);
  assert.deepEqual(calls.at(-1), { command: "taskkill", args: ["/PID", "42"] });
  assert.match((await host.stop(42, true)).note, /no graceful signal/);
  assert.deepEqual(calls.at(-1).args, ["/PID", "42", "/F"]);
  await assert.rejects(() => host.stop(-1), /Invalid/);
  await host.notify("A 'title' <&", "body");
  assert.equal(calls.at(-1).command, "powershell");
  const toast = Buffer.from(calls.at(-1).args.at(-1), "base64").toString("utf16le");
  assert.match(toast, /InnerText='A ''title'' <&'/);
  assert.match(toast, /Windows.UI.Notifications/);
  assert.match(host.commandLine("C:\\O'Brien", ["claude", "--resume", "s"]), /Set-Location -LiteralPath 'C:\\O''Brien'/);
  const failed = guardHost({ platform: "windows", run: async () => ({ code: 1, stderr: "denied", stdout: "" }) });
  assert.equal((await failed.stop(42, true)).note, "");
  await assert.rejects(() => failed.install(), /denied/);
});

test("macOS keeps launchd's minute job, existing memory commands and graceful signals", async (t) => {
  const home = await temporary(t), calls = [], host = guardHost({ platform: "macos", home, appHome: home, self: "/guard.mjs", node: "/node", run: async (command, args) => { calls.push({ command, args }); return result(command === "lsof" ? "42\n" : ""); } });
  await host.install();
  const plist = await readFile(join(home, "Library/LaunchAgents/dev.kanso.guard.plist"), "utf8");
  assert.match(plist, /StartInterval<\/key><integer>60/);
  assert.match(plist, /<string>check<\/string>/);
  assert.equal(calls.at(-1).command, "launchctl");
  assert.equal((await host.window()).pid, 42);
  await host.stop(42); assert.deepEqual(calls.at(-1).args, ["-TERM", "42"]);
  await host.stop(42, true); assert.deepEqual(calls.at(-1).args, ["-KILL", "42"]);
  await host.notify("title", "body"); assert.equal(calls.at(-1).command, "osascript");
  await host.uninstall();
  await assert.rejects(() => access(join(home, "Library/LaunchAgents/dev.kanso.guard.plist")));
});

test("macOS includes every core in the process table and excludes connect clients without asking hc", async () => {
  const host = guardHost({ platform: "macos", run: () => assert.fail("Core discovery must reuse the process table") });
  const rows = [
    { pid: 10, command: "/first/herdr-core" },
    { pid: 20, command: "/second/herdr-core --home /other" },
    { pid: 30, command: "/first/herdr-core connect abc" },
    { pid: 40, command: "/first/herdr-core-helper" },
    { pid: 50, command: "/first/node /first/herdr-core" },
    { pid: 60, command: "/first/herdr-core --name connected" },
  ];
  assert.deepEqual(await host.corePids(rows), [10, 20, 60]);
  assert.deepEqual(await host.corePids([]), []);
});

for (const [key, fallback] of [
  ["hw.memsize", { totalMB: 0, freePct: 30, swapMB: 513, swapTotalMB: 4000 }],
  ["kern.memorystatus_level", { totalMB: 1000, freePct: 0, swapMB: 513, swapTotalMB: 4000 }],
  ["vm.swapusage", { totalMB: 1000, freePct: 30, swapMB: 0, swapTotalMB: 0 }],
]) test(`A failed macOS ${key} logs once and preserves the other machine memory fields`, async () => {
  const events = [], values = { "hw.memsize": String(1000 * MB), "kern.memorystatus_level": "30", "vm.swapusage": "total = 4000.00M used = 512.5M" };
  const source = guardHost({ platform: "macos", run: async (command, args) => {
    assert.equal(command, "sysctl");
    return args[1] === key ? { code: 1, stdout: "", stderr: `${key} denied` } : result(values[args[1]]);
  } });
  const reads = guardReads(source, (...event) => events.push(event));
  assert.deepEqual(await reads.machine(), fallback);
  assert.deepEqual(events, [["error", `sysctl ${key} failed: ${key} denied`]]);
});

test("A failed macOS ioreg logs once and reports zero idle seconds so automatic actions keep waiting", async () => {
  const events = [], source = guardHost({ platform: "macos", run: async (command) => {
    assert.equal(command, "ioreg");
    return { code: 1, stdout: "", stderr: "ioreg denied" };
  } });
  const reads = guardReads(source, (...event) => events.push(event));
  assert.equal(await reads.idleSeconds(), 0);
  assert.deepEqual(events, [["error", "Idle seconds failed: ioreg denied"]]);
});

for (const response of [{ code: 1, stdout: "", stderr: "core lookup denied" }, result("not json"), result('{"pid":0}')]) {
  test(`A failed Windows core lookup returns no pids and one error instead of losing the check (${response.stdout || response.stderr})`, async () => {
    const events = [], source = guardHost({ platform: "windows", run: async (command, args) => {
      assert.equal(command, "hc");
      assert.deepEqual(args, ["server", "status", "--json"]);
      return response;
    } });
    assert.deepEqual(await guardReads(source, (...event) => events.push(event)).corePids([]), []);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], "error");
    assert.match(events[0][1], /^Core PID failed:/);
  });
}

for (const [primitive, name, fallback] of [
  ["processes", "Process table", []], ["footprints", "Process memory", new Map()],
  ["window", "Window PID", { pid: null }], ["corePids", "Core PID", []],
  ["machine", "Machine memory", { totalMB: 0, freePct: 0, swapMB: 0, swapTotalMB: 0 }],
  ["listen", "Listening servers", null], ["cwd", "Server working directories", null],
  ["cleanTemporary", "Temporary file cleanup", undefined],
]) test(`A rejected ${name} primitive logs once and returns its previous fallback`, async () => {
  const events = [], args = [10, 20], source = { [primitive]: async (given) => {
    if (["footprints", "window", "corePids", "cwd"].includes(primitive)) assert.equal(given, args);
    throw new Error("command rejected");
  } };
  const reads = guardReads(source, (...event) => events.push(event));
  assert.deepEqual(await reads[primitive](args), fallback);
  assert.deepEqual(events, [["error", `${name} failed: command rejected`]]);
});

test("Temporary cleanup removes only old shared-file fragments and leaves links and folders alone", async (t) => {
  const home = await temporary(t), old = join(home, "shared.json.tmp.old"), fresh = join(home, "shared.json.tmp.new"), saved = join(home, "shared.json");
  await writeFile(old, "old"); await writeFile(fresh, "new"); await writeFile(saved, "saved");
  await utimes(old, new Date(0), new Date(0));
  await mkdir(join(home, "shared.json.tmp.folder"));
  if (process.platform !== "win32") await symlink(saved, join(home, "shared.json.tmp.link"));
  guardHost({ platform: "macos", appHome: home }).cleanTemporary();
  await assert.rejects(() => access(old));
  await access(fresh); await access(saved); await access(join(home, "shared.json.tmp.folder"));
});

test("One watcher owns the loop while checks keep their own lock and recover after a failure", async () => {
  let owned = false, ticks = 0, released = 0;
  const errors = [], delays = [], acquire = async () => {
    if (owned) return null;
    owned = true;
    return () => { owned = false; released++; };
  };
  await watchChecks({ acquire, now: () => 0, active: () => ticks < 2, check: async () => {
    ticks++;
    assert.equal(await watchChecks({ acquire, check: () => assert.fail("second watcher"), delay: () => {} }), false);
    if (ticks === 1) throw new Error("sample failed");
  }, delay: async (ms) => delays.push(ms), onError: (error) => errors.push(error.message) });
  assert.deepEqual(delays, [60000]);
  assert.deepEqual(errors, ["sample failed"]);
  assert.equal(released, 1);
});

test("A watch lock rejects a live second owner and recovers a dead or incomplete owner", async (t) => {
  const file = join(await temporary(t), "watch.lock");
  const release = await acquireGuardLock(file, { alive: () => true });
  assert.equal(typeof release, "function");
  assert.equal(await acquireGuardLock(file, { alive: () => true }), null);
  release();
  await writeFile(file, JSON.stringify({ pid: 12345 }));
  const recovered = await acquireGuardLock(file, { alive: () => false });
  assert.equal(typeof recovered, "function");
  recovered();
  await writeFile(file, "{");
  assert.equal(await acquireGuardLock(file, { alive: () => false }), null);
  await utimes(file, new Date(0), new Date(0));
  const completed = await acquireGuardLock(file, { alive: () => false });
  completed();
  await assert.rejects(() => access(file));
});

test("Window ambiguity is reported once until the reason changes or detection recovers", () => {
  const missing = { reason: "No window" }, several = { reason: "Several windows" }, ready = { reason: null };
  assert.equal(windowNotice(null, missing), "No window");
  assert.equal(windowNotice(missing, missing), null);
  assert.equal(windowNotice(missing, several), "Several windows");
  assert.equal(windowNotice(several, ready), null);
  assert.equal(windowNotice(ready, several), "Several windows");
});

test("Windows host samples injected process data and persists the installer program before detaching", async (t) => {
  const home = await temporary(t), executable = "C:\\Program Files\\Window.exe", calls = [];
  const rows = [{ pid: process.pid, ppid: 100, name: "node.exe", created: "2026-11-11T00:00:00Z", bytes: MB }, { pid: 100, ppid: 10, name: "powershell.exe" }, { pid: 10, ppid: 1, name: "Window.exe", executable }];
  const host = guardHost({ platform: "windows", appHome: home, run: async (command, args) => {
    const script = args.at(-1);
    calls.push({ command, args });
    return result(command === "hc" ? '{"pid":123}' : script.includes("Win32_Process") ? JSON.stringify(rows) : script.includes("Get-Process") ? JSON.stringify([{ pid: process.pid, bytes: 2 * MB }]) : script.includes("Win32_PageFileUsage") ? '{"CurrentUsage":10,"AllocatedBaseSize":20}' : script.includes("Get-NetTCPConnection") ? '[{"pid":10,"port":3000}]' : script.includes("KansoInput") ? "120.9" : "");
  } });
  await host.captureWindow();
  const identity = JSON.parse(await readFile(join(home, "data/kanso-guard/window-program.json"), "utf8"));
  assert.equal(identity.installerPid, process.pid);
  assert.equal(identity.executable, executable);
  assert.equal((await host.window()).pid, 10);
  assert.equal((await host.window([...rows, { ...rows[2], pid: 11 }])).pid, null);
  const table = await host.processes();
  assert.equal(table[0].rssMB, 1);
  assert.equal(table[0].lstart, "2026-11-11T00:00:00.000Z");
  assert.equal((await host.footprints([process.pid])).get(process.pid), 2);
  assert.equal((await host.footprints([])).size, 0);
  assert.equal(await host.idleSeconds(), 120.9);
  assert.equal((await host.machine()).swapMB, 10);
  assert.equal((await host.listen()).get(10).ports[0], 3000);
  assert.equal((await host.cwd([10])).state, "unavailable");
  assert.deepEqual(await host.corePids(), [123]);
  await host.reopen();
  assert.match(calls.at(-1).args.at(-1), /Start-Process -FilePath 'C:\\Program Files\\Window.exe'/);
  const invalid = guardHost({ platform: "windows", run: async () => result("bad") });
  await assert.rejects(() => invalid.idleSeconds(), /idle time is unavailable/);
  assert.ok(Number.isNaN(idleValue("windows", "")));
});

test("Replacing or removing a watcher never stops a reused pid running another command", async () => {
  const { isWatcher } = await import("../kanso/mods/kanso-guard/guard-host.mjs");
  const self = "C:\\O'Brien\\guard.mjs";
  assert.equal(isWatcher({ command: `node "${self}" "watch"` }, self), true);
  assert.equal(isWatcher({ command: `node "${self}" check` }, self), false);
  assert.equal(isWatcher({ command: `node "${self}-other" watch` }, self), false);
  assert.equal(isWatcher({ command: "node other.mjs watch" }, self), false);
  assert.equal(isWatcher(null, self), false);
});

test("Watcher intervals account for the check's duration without overlapping checks", async () => {
  let ticks = 0, time = 0;
  const delays = [];
  await watchChecks({ acquire: async () => () => {}, active: () => ticks < 3, now: () => time, check: async () => { time += ticks++ === 0 ? 20000 : 70000; }, delay: async (ms) => { delays.push(ms); time += ms; } });
  assert.deepEqual(delays, [40000, 0]);
});
