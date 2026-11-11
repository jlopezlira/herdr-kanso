// Whether Simulator starts on, and where each platform keeps an Android SDK.
export const PANEL = { id: "sim", label: "Simulator", icon: "smartphone.svg" };
export const SERVE_PIN = "serve-sim@0.1.49";
export const SERVE_INSTALL = ["--yes", SERVE_PIN, "--version"];
export const SERVE_OFFLINE = ["--no", "--offline", SERVE_PIN];
export const INSTALL_LINE = "npx --yes serve-sim@0.1.49 --version";
export const ENV_NAMES = ["ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_AVD_HOME", "LOCALAPPDATA", "TEMP", "TMP", "XDG_RUNTIME_DIR"];
export const DEFAULTED = "kanso.sim.defaulted";
export const LAST_PICKED = "kanso.sim.device";
export const IOS_ONLY = "iOS simulators are on macOS.";
export const REMOTE_LINE = "This space is on another machine, so these are this computer's devices.";
export const NODE_MISSING = "Node is not on PATH.";
export const NODE_LINK = "https://nodejs.org";
export const XCODE_CMD = "xcode-select --install";
export const XCODE_LINK = "https://developer.apple.com/xcode/";
export const SDK_LINK = "https://developer.android.com/studio";
export const STALL_MS = 2000;
export const STREAM_WIDTH = 540;
export const LISTEN_BASE = 27000;
export const PROBE_MS = 8000;

export const iosOn = (platform) => platform === "macos";
export const toolFile = (name, platform) => platform === "windows" ? `${name}.exe` : name;
export const listenPort = (serial) => LISTEN_BASE + Number(String(serial).split("-")[1]);

const filled = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

export function hostFamily(arch) {
  const name = String(arch ?? "").trim().toLowerCase();
  return name.startsWith("arm") || name.startsWith("aarch") ? "arm" : "x86";
}

export function abiFits(abi, family) {
  return !abi || String(abi).startsWith(family);
}

export function applySimDefault(off, tools, decided) {
  const list = Array.isArray(off) ? off.filter((item) => typeof item === "string") : [];
  if (decided || tools?.ios || tools?.android) return { off: list, decided: true };
  return { off: list.includes(PANEL.id) ? list : [...list, PANEL.id], decided: true };
}

export function sdkCandidates(platform, home, env = {}, api) {
  const named = [filled(env.ANDROID_HOME), filled(env.ANDROID_SDK_ROOT)].filter(Boolean);
  const local = filled(env.LOCALAPPDATA);
  const fallback = platform === "windows"
    ? api.join(local || api.join(home, "AppData", "Local"), "Android", "Sdk")
    : api.join(home, ...(platform === "linux" ? ["Android", "Sdk"] : ["Library", "Android", "sdk"]));
  const keyOf = (path) => platform === "windows" ? path.toLowerCase() : path;
  return [...named, fallback].filter((path, index, all) => all.findIndex((item) => keyOf(item) === keyOf(path)) === index);
}

export function runningDirs(platform, home, env = {}, api) {
  if (platform === "macos") return [api.join(home, "Library", "Caches", "TemporaryItems", "avd", "running")];
  if (platform === "linux") {
    const xdg = filled(env.XDG_RUNTIME_DIR);
    return [xdg ? api.join(xdg, "avd", "running") : null, "/tmp/avd/running"].filter(Boolean);
  }
  const temp = filled(env.TEMP) || filled(env.TMP) || (filled(env.LOCALAPPDATA) ? api.join(env.LOCALAPPDATA, "Temp") : api.join(home, "AppData", "Local", "Temp"));
  return [api.join(temp, "avd", "running")];
}

export function avdHome(platform, home, env = {}, api) {
  return filled(env.ANDROID_AVD_HOME) || api.join(home, ".android", "avd");
}

export function envMap(text, names) {
  const found = Object.fromEntries(String(text ?? "").split(/\r?\n/).flatMap((line) => {
    const at = line.indexOf("=");
    return at > 0 && names.includes(line.slice(0, at)) ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }));
  return Object.fromEntries(names.map((name) => [name, found[name] ?? ""]));
}

export async function readNamedEnv(platform, run, names, powershell) {
  if (platform === "windows") {
    const list = names.map((name) => `'${name}'`).join(",");
    const result = await powershell(run, `@(${list}) | ForEach-Object { Write-Output ($_ + '=' + [Environment]::GetEnvironmentVariable($_)) }`).catch(() => null);
    return envMap(result?.code === 0 ? result.stdout : "", names);
  }
  const pairs = await Promise.all(names.map(async (name) => {
    const result = await run("printenv", [name]).catch(() => null);
    return [name, result?.code === 0 ? String(result.stdout ?? "").replace(/\r?\n$/, "") : ""];
  }));
  return Object.fromEntries(pairs);
}

export async function readArch(platform, run, powershell) {
  if (platform === "windows") {
    const result = await powershell(run, "Write-Output $env:PROCESSOR_ARCHITECTURE").catch(() => null);
    return hostFamily(result?.stdout);
  }
  const result = await run("uname", ["-m"]).catch(() => null);
  return hostFamily(result?.code === 0 ? result.stdout : "");
}

const ok = (result) => result?.code === 0;

export async function probeTools({ platform, home, env, run, api }) {
  const ios = iosOn(platform) ? ok(await run("xcrun", ["--find", "simctl"]).catch(() => null)) : false;
  const checks = await Promise.all(sdkCandidates(platform, home, env, api).map((root) => run(api.join(root, "platform-tools", toolFile("adb", platform)), ["version"]).catch(() => null)));
  return { ios, android: checks.some(ok) };
}

export async function probeRuntime(run) {
  const node = await run("node", ["-v"]).catch(() => null);
  const serve = await run("npx", [...SERVE_OFFLINE, "--version"]).catch(() => null);
  return { node: ok(node), serve: ok(serve) };
}

export function gapRows({ platform, node, simctl, sdk, serve }) {
  return [
    !node ? { id: "node", text: NODE_MISSING, link: NODE_LINK } : null,
    iosOn(platform) && !simctl ? { id: "xcode", text: "Xcode's simctl is not installed.", command: XCODE_CMD, link: XCODE_LINK } : null,
    !sdk ? { id: "sdk", text: "The Android SDK is not installed.", link: SDK_LINK } : null,
    node && iosOn(platform) && simctl && !serve ? { id: "serve", install: true, text: INSTALL_LINE } : null,
  ].filter(Boolean);
}

export function streamBlock({ platform, node, simctl, sdk, serve, device }) {
  if (!device) return null;
  if (!node) return "node";
  if (device.platform === "ios") {
    if (!iosOn(platform) || !simctl) return "xcode";
    return serve ? null : "serve";
  }
  return sdk ? null : "sdk";
}

export function commandError(result, fallback) {
  if (result == null || result.code === 0) return null;
  const text = String(result.stderr || result.stdout || "").trim().split(/\r?\n/).at(-1);
  return new Error(text || fallback);
}
