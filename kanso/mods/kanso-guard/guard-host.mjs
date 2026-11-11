import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, totalmem, freemem } from "node:os";
import { delimiter, join } from "node:path";
import { platformName, powershell, psQuote, checked, jsonRows, validPid, elapsedSeconds } from "./platform-command.js";
import { pathApi } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { openApi } from "./platform-open.js";
import { portApi, unixPorts } from "./platform-ports.js";
export { unixPorts as parseListen };

const MB = 1024 * 1024;
const LABEL = "dev.kanso.guard";
export const readJSON = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
export function writeJSON(file, value) { const temp = `${file}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(value)); renameSync(temp, file); }
export const guardHome = (env, home, platform = platformName(process.platform)) => env.HERDR_APP_HOME || pathApi(platform).join(home, ".config", "herdr-app");
export const guardEnvironment = (env, home, platform) => ({ ...env, PATH: [...(platform === "macos" ? [join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] : []), env.PATH ?? ""].join(delimiter) });

export function macProcesses(text) {
  return String(text).split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), rssMB: Math.round(Number(m[3]) / 1024), ageMin: Math.floor(elapsedSeconds(m[4]) / 60), lstart: m[5].replace(/\s+/g, " "), command: m[6], name: m[6].split(" ")[0].split("/").at(-1) }] : [];
  });
}

export const footprintValues = (value) => new Map((value?.processes ?? []).map((p) => [Number(p.pid), Math.round(Number(p.footprint ?? 0) / MB)]));
export const workingSets = (rows) => new Map(rows.map((p) => [p.pid, Math.round(Number(p.bytes ?? 0) / MB)]));
export const windowsMemory = (total, free, text) => {
  const rows = jsonRows(text);
  return { totalMB: Math.round(total / MB), freePct: total > 0 ? Math.round(free / total * 1000) / 10 : 0, swapMB: rows.reduce((sum, p) => sum + Number(p.CurrentUsage ?? 0), 0), swapTotalMB: rows.reduce((sum, p) => sum + Number(p.AllocatedBaseSize ?? 0), 0) };
};
export const macMemory = (total, free, swap) => ({ totalMB: Math.round(Number(total) / MB), freePct: Number(free) || 0, swapMB: Math.round(Number(/used = ([\d.]+)M/.exec(swap)?.[1] ?? 0)), swapTotalMB: Math.round(Number(/total = ([\d.]+)M/.exec(swap)?.[1] ?? 0)) });
export const memoryLow = (platform, memory, limits) => memory.freePct < limits.lowFreePct || (platform === "macos" && memory.swapMB > limits.lowSwapMB);
export const idleValue = (platform, text) => platform === "macos" ? Math.floor(Number(/"HIDIdleTime" = (\d+)/.exec(text)?.[1] ?? 0) / 1e9) : String(text).trim() ? Number(String(text).trim()) : NaN;
export const resumeShellReason = (platform, shell) => platform !== "windows" || /^(?:pwsh|powershell)(?:\.exe)?$/i.test(pathApi("windows").basename(shell?.executable || shell?.name || "")) ? null : "Recycling and closing agents require a PowerShell terminal on Windows";
export const corePid = (text) => { const pid = Number(JSON.parse(text).pid); return Number.isSafeInteger(pid) && pid > 0 ? pid : null; };

export function windowAncestor(rows, pid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const walk = (parent, seen) => {
    const row = byPid.get(parent);
    if (!parent || seen.has(parent) || !row) return { reason: "The window ancestor could not be identified; turn on Memory from its window" };
    const name = pathApi("windows").basename(row.executable || row.name).replace(/\.exe$/i, "");
    if (/^(node|pwsh|powershell|cmd|conhost)$/i.test(name)) return walk(row.ppid, new Set([...seen, parent]));
    return row.executable ? { executable: row.executable } : { reason: "The window ancestor's executable path is unavailable" };
  };
  return walk(byPid.get(pid)?.ppid, new Set([pid]));
}

export function uniqueWindow(rows, executable) {
  if (!executable) return { pid: null, reason: "The window program is not recorded; turn on Memory from its window" };
  const matches = rows.filter((p) => p.executable && pathApi("windows").equal(p.executable, executable));
  return matches.length === 1 ? { pid: matches[0].pid, reason: null } : { pid: null, reason: matches.length ? "Several windows use the recorded program; window sampling and restarts are paused" : "The recorded window program is not running; window sampling and restarts are paused" };
}

export const windowNotice = (previous, identity) => identity.reason && previous?.reason !== identity.reason ? identity.reason : null;
export function isWatcher(row, self) {
  const script = self.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(row && new RegExp(`(?:^|["\\s])${script}(?=["\\s]|$)`).test(row.command) && /(?:^|["\s])watch(?=["\s]|$)/.test(row.command));
}

export function cleanTemporary(appHome, now = Date.now()) {
  for (const entry of readdirSync(appHome, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("shared.json.tmp.")) continue;
    const file = join(appHome, entry.name);
    try { if (now - statSync(file).mtimeMs > 3600000) rmSync(file, { force: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

const IDLE = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class KansoInput { [StructLayout(LayoutKind.Sequential)] public struct Info { public uint size; public uint tick; } [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info info); public static double Seconds() { Info i = new Info(); i.size = (uint)Marshal.SizeOf(i); if (!GetLastInputInfo(ref i)) throw new InvalidOperationException("GetLastInputInfo failed"); return unchecked((uint)Environment.TickCount - i.tick) / 1000.0; } }'; [KansoInput]::Seconds().ToString([Globalization.CultureInfo]::InvariantCulture)`;
export const encodedCommand = (script) => `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;

export function guardHost({ platform = platformName(process.platform), run, home = homedir(), appHome = guardHome(process.env, home, platform), self, node = process.execPath, uid = process.getuid?.(), taskName } = {}) {
  const data = join(appHome, "data", "kanso-guard"), identityFile = join(data, "window-program.json");
  const task = `$taskName=${taskName ? psQuote(taskName) : `'${LABEL}-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value`}; `;
  const ps = async (script) => checked(await powershell(run, script));
  const processes = processApi(platform, run), ports = portApi(platform, run);
  const alive = (pid) => { validPid(pid); try { process.kill(Number(pid), 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
  const common = {
    available: true, appHome, env: guardEnvironment(process.env, home, platform),
    alive, commandLine: openApi(platform, run).terminalLine, resumeReason: (shell) => resumeShellReason(platform, shell), cleanTemporary: () => cleanTemporary(appHome),
    isLow: (memory, limits) => memoryLow(platform, memory, limits),
    listen: () => ports.listen(), cwd: (pids) => processes.cwd(pids),
    stop: async (pid, force = false) => {
      validPid(pid);
      const result = await run(...(platform === "windows" ? ["taskkill", ["/PID", String(pid), ...(force ? ["/F"] : [])]] : ["kill", [force ? "-KILL" : "-TERM", String(pid)]]));
      return { ...result, forced: platform === "windows" && force && result.code === 0, note: platform === "windows" && force && result.code === 0 ? "Forced stop: Windows has no graceful signal for this process" : "" };
    },
  };
  const implementations = {
    macos: () => ({
      metric: "physical footprint", swapLabel: "swap", forceHelpers: false, quitCommand: "app.quit",
      processes: async () => macProcesses(checked(await run("ps", ["-axo", "pid=,ppid=,rss=,etime=,lstart=,command="])).stdout),
      corePids: async (rows) => rows.filter((p) => /\/herdr-core$/.test(p.command.split(" ")[0]) && !/ connect\b/.test(p.command)).map((p) => p.pid),
      footprints: async (pids) => {
        const want = [...new Set(pids.filter(Boolean))];
        if (!want.length) return new Map();
        const file = join(tmpdir(), `kanso-guard-fp-${process.pid}.json`);
        try { await run("footprint", [...want.flatMap((pid) => ["-p", String(pid)]), "--noCategories", "-j", file], 20000); return footprintValues(readJSON(file)); }
        finally { rmSync(file, { force: true }); }
      },
      window: async () => { const r = await run("lsof", ["-t", join(appHome, "herdr-app.sock")], 5000); return { pid: Number(r.stdout.trim().split("\n")[0]) || null }; },
      captureWindow: async () => {},
      idleSeconds: async () => idleValue(platform, checked(await run("ioreg", ["-c", "IOHIDSystem"], 5000)).stdout),
      machine: async (read = async (_name, operation) => operation()) => {
        const values = await Promise.all(["hw.memsize", "kern.memorystatus_level", "vm.swapusage"].map((key) => read(`sysctl ${key}`, async () => checked(await run("sysctl", ["-n", key])).stdout, "")));
        return macMemory(...values);
      },
      reopen: async () => {
        const app = [join(home, "Applications/Herdr.app"), "/Applications/Herdr.app"].find(existsSync);
        return checked(await run(app ? "open" : "sh", app ? ["-g", "-n", "--env", `HERDR_APP_HOME=${appHome}`, app] : ["-c", 'HERDR_APP_HOME="$1" nohup herdr-app >/dev/null 2>&1 &', "_", appHome]));
      },
      notify: (title, body) => run("osascript", ["-e", "on run a", "-e", "display notification (item 2 of a) with title (item 1 of a)", "-e", "end run", title, body], 5000),
      install: async () => {
        const folder = join(home, "Library/LaunchAgents"), plist = join(folder, `${LABEL}.plist`), x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        mkdirSync(folder, { recursive: true });
        writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${x(node)}</string><string>${x(self)}</string><string>check</string></array>
  <key>EnvironmentVariables</key><dict><key>HERDR_APP_HOME</key><string>${x(appHome)}</string></dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${x(join(data, "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${x(join(data, "launchd.log"))}</string>
</dict>
</plist>
`);
        await run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]);
        return checked(await run("launchctl", ["bootstrap", `gui/${uid}`, plist]));
      },
      uninstall: async () => { await run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]); rmSync(join(home, "Library/LaunchAgents", `${LABEL}.plist`), { force: true }); },
      scheduled: async () => ({ state: "unavailable", reason: "Task Scheduler is only used on Windows" }),
    }),
    windows: () => ({
      metric: "working set", swapLabel: "page file", forceHelpers: true, quitCommand: "window.close",
      corePids: async () => {
        const pid = corePid(checked(await run("hc", ["server", "status", "--json"])).stdout);
        if (!pid) throw new Error("Core PID is unavailable");
        return [pid];
      },
      processes: async () => (await processes.list()).rows.map((p) => ({ ...p, rssMB: Math.round(Number(p.bytes ?? 0) / MB), ageMin: Math.floor(elapsedSeconds(p.etime) / 60), lstart: p.started == null ? "" : new Date(p.started).toISOString() })),
      footprints: async (pids) => {
        const want = [...new Set(pids.filter(Boolean))].map(validPid);
        if (!want.length) return new Map();
        const rows = jsonRows((await ps(`@(Get-Process -Id @(${want.join(",")}) -ErrorAction SilentlyContinue | ForEach-Object { @{pid=$_.Id;bytes=$_.WorkingSet64} }) | ConvertTo-Json -Compress`)).stdout);
        return workingSets(rows);
      },
      window: async (rows) => uniqueWindow(rows ?? (await processes.list()).rows, readJSON(identityFile)?.executable),
      captureWindow: async () => {
        const identity = windowAncestor((await processes.list()).rows, process.pid);
        mkdirSync(data, { recursive: true });
        writeJSON(identityFile, { ...identity, installerPid: process.pid });
        if (identity.reason) throw new Error(identity.reason);
      },
      idleSeconds: async () => { const seconds = idleValue(platform, (await ps(IDLE)).stdout); if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Windows idle time is unavailable"); return seconds; },
      machine: async () => windowsMemory(totalmem(), freemem(), (await ps("@(Get-CimInstance Win32_PageFileUsage | Select-Object CurrentUsage,AllocatedBaseSize) | ConvertTo-Json -Compress")).stdout),
      reopen: async () => { const executable = readJSON(identityFile)?.executable; if (!executable) throw new Error("The window program is not recorded"); return ps(`$env:HERDR_APP_HOME=${psQuote(appHome)}; Start-Process -FilePath ${psQuote(executable)} -ErrorAction Stop`); },
      notify: (title, body) => run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$ErrorActionPreference='Stop'; [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null; [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] > $null; $xml=[Windows.Data.Xml.Dom.XmlDocument]::new(); $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>'); $texts=$xml.GetElementsByTagName('text'); $texts.Item(0).InnerText=${psQuote(title)}; $texts.Item(1).InnerText=${psQuote(body)}; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Herdr').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`, "utf16le").toString("base64")]).then(checked),
      install: async () => {
        const action = encodedCommand(`$env:HERDR_APP_HOME=${psQuote(appHome)}; & ${psQuote(node)} ${psQuote(self)} watch; exit $LASTEXITCODE`);
        return ps(task + [
          "$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name",
          "$previous=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue",
          "if ($previous) { Stop-ScheduledTask -TaskName $taskName }",
          `$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(action)}`,
          "$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user",
          "$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited",
          "$settings=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew",
          "$registered=$false; try { Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null; $registered=$true; Start-ScheduledTask -TaskName $taskName } catch { if ($registered) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }; throw }",
        ].join("; "));
      },
      scheduled: async () => jsonRows((await ps(task + `@(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Select-Object TaskName,State) | ConvertTo-Json -Compress`)).stdout),
      uninstall: async () => ps(task + `$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; if ($task) { Stop-ScheduledTask -TaskName $taskName; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }`),
    }),
  };
  if (!implementations[platform]) {
    const reason = `Memory is not available on ${platform}`;
    const absent = Object.fromEntries([...Object.keys(common).filter((key) => typeof common[key] === "function"), "processes", "corePids", "footprints", "window", "captureWindow", "idleSeconds", "machine", "reopen", "notify", "install", "uninstall", "scheduled"].map((key) => [key, async () => ({ state: "unavailable", reason })]));
    return { ...common, ...absent, available: false, reason };
  }
  return { ...common, ...implementations[platform]() };
}
