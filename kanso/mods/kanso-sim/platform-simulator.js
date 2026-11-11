import { exists } from "fs/promises";
import { pathApi } from "./platform-paths.js";
import { checked, powershell, psQuote, windowsArg } from "./platform-command.js";

export const SDK_ENV = ["ANDROID_HOME", "ANDROID_SDK_ROOT", "LOCALAPPDATA"];
export function sdkRoots(platform, home, env) {
  const api = pathApi(platform);
  const fallback = platform === "windows" ? api.join(env.LOCALAPPDATA || api.join(home, "AppData", "Local"), "Android", "Sdk")
    : api.join(home, ...(platform === "macos" ? ["Library", "Android", "sdk"] : ["Android", "Sdk"]));
  return [...new Set([env.ANDROID_HOME, env.ANDROID_SDK_ROOT, fallback].filter(Boolean))];
}

export function simulatorApi(platform, run, present = exists) {
  const api = pathApi(platform), exe = platform === "windows" ? ".exe" : "";
  const environment = async () => {
    const result = checked(await (platform === "windows"
      ? powershell(run, SDK_ENV.map((name) => `Write-Output ([string]$env:${name})`).join("; "), { timeout: 1500 })
      : run("sh", ["-c", 'printf "%s\\n" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$LOCALAPPDATA"'], { timeout: 1500 })));
    const values = result.stdout.replace(/\r/g, "").split("\n");
    return Object.fromEntries(SDK_ENV.map((name, index) => [name, values[index] || ""]));
  };
  const probe = async (home) => {
    const [env, selected] = await Promise.all([
      environment().catch(() => ({})),
      platform === "macos" ? run("xcode-select", ["-p"], { timeout: 1500 }).catch(() => null) : null,
    ]);
    const developer = selected?.code === 0 ? selected.stdout.trim() : "";
    const simctl = developer ? api.join(developer, "usr", "bin", "simctl") : null;
    const ios = simctl && await present(simctl).catch(() => false) ? simctl : null;
    const roots = sdkRoots(platform, home, env);
    const find = async (index) => {
      const root = roots[index];
      if (!root) return {};
      const adb = api.join(root, "platform-tools", `adb${exe}`), emulator = api.join(root, "emulator", `emulator${exe}`);
      return await present(adb).catch(() => false) ? { adb, emulator: await present(emulator).catch(() => false) ? emulator : null } : find(index + 1);
    };
    return { ios, ...await find(0) };
  };
  const capture = (adb, serial, file) => platform === "windows"
    ? powershell(run, `$p=[Diagnostics.ProcessStartInfo]::new(); $p.FileName=${psQuote(adb)}; $p.Arguments=${psQuote(["-s", serial, "exec-out", "screencap", "-p"].map(windowsArg).join(" "))}; $p.UseShellExecute=$false; $p.RedirectStandardOutput=$true; $child=[Diagnostics.Process]::Start($p); $file=[IO.File]::Create(${psQuote(file)}); try { $child.StandardOutput.BaseStream.CopyTo($file) } finally { $file.Dispose() }; $child.WaitForExit(); exit $child.ExitCode`, { timeout: 8000 })
    : run("sh", ["-c", 'exec "$1" -s "$2" exec-out screencap -p > "$3"', "capture", adb, serial, file], { timeout: 8000 });
  const start = (emulator, name) => platform === "windows"
    ? powershell(run, `Start-Process -FilePath ${psQuote(emulator)} -ArgumentList ${psQuote(["-avd", name].map(windowsArg).join(" "))} -ErrorAction Stop`)
    : run("sh", ["-c", 'nohup "$1" -avd "$2" </dev/null >/dev/null 2>&1 &', "start", emulator, name]);
  return { probe, capture, start };
}
