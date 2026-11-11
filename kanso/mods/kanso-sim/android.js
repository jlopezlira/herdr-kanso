// Copyright (c) 2026 Robert Soriano
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): adb input from herdr-sim, without a shell on Windows.
import { exec, appHome, home, readTextFile } from "herdr";
import { openApi } from "./platform-open.js";
import { pathApi } from "./platform-paths.js";
import { powershell } from "./platform-command.js";
import { portOpen } from "./host-io.js";
import {
  ENV_NAMES, STREAM_WIDTH, avdHome, commandError, listenPort, readArch, readNamedEnv, sdkCandidates, toolFile, runningDirs,
} from "./sim-register.js";
import {
  ANDROID_BUTTONS, ANDROID_MODIFIERS, ANDROID_SHIFT, ANDROID_VOLUME, androidKeyCode, clamp01,
  emulatorRow, parseAdbDevices, parseAvdConfig, parseAvdNames, parseEmuAvdName, parseWmSize,
} from "./model.js";

const run = (file, args) => exec(file, args).catch(() => null);

export async function listEmulators(platform, known) {
  const api = pathApi(platform);
  const homeDir = home();
  const env = known ?? await readNamedEnv(platform, exec, ENV_NAMES, powershell);
  const dirs = runningDirs(platform, homeDir, env, api);
  const found = (await Promise.all(sdkCandidates(platform, homeDir, env, api).map(async (candidate) => {
    const file = api.join(candidate, "platform-tools", toolFile("adb", platform));
    return (await run(file, ["version"]))?.code === 0 ? { root: candidate, adb: file } : null;
  }))).find(Boolean);
  if (!found) return { sdk: false, adb: null, emulator: null, dirs, devices: [] };
  const emulator = api.join(found.root, "emulator", toolFile("emulator", platform));
  const names = parseAvdNames((await run(emulator, ["-list-avds"]))?.stdout ?? "");
  const folder = avdHome(platform, homeDir, env, api);
  const family = await readArch(platform, exec, powershell);
  const serials = parseAdbDevices((await run(found.adb, ["devices"]))?.stdout ?? "");
  const named = await Promise.all(serials.map((serial) => run(found.adb, ["-s", serial, "emu", "avd", "name"]).then((result) => parseEmuAvdName(result?.stdout ?? ""), () => "")));
  const running = new Set(named.filter(Boolean));
  const devices = await Promise.all(names.map(async (name) => {
    const text = await readTextFile(api.join(folder, `${name}.avd`, "config.ini")).catch(() => null);
    return emulatorRow(name, parseAvdConfig(text ?? ""), running.has(name), family);
  }));
  return { sdk: true, adb: found.adb, emulator, dirs, devices };
}

export async function bootAvd(emulator, name, platform) {
  if (!emulator) throw new Error("The Android emulator is not installed.");
  await openApi(platform, exec).spawn(emulator, ["-avd", name, "-no-window", "-no-audio"]);
}

export async function openAndroid(device, adb, dirs, platform, onError, onOk) {
  const serial = await serialOf(adb, device.avd);
  if (!serial) throw new Error(`${device.name} has no adb connection yet`);
  const size = parseWmSize((await exec(adb, ["-s", serial, "shell", "wm", "size"])).stdout);
  const port = listenPort(serial);
  if (!(await portOpen(port))) {
    const script = pathApi(platform).join(appHome(), "mods", "kanso-sim", "android-stream.mjs");
    await openApi(platform, exec).spawn("node", [script, serial.split("-")[1], String(port), String(STREAM_WIDTH), ...dirs]);
  }
  return { device, serial, host: "127.0.0.1", port, path: "/", input: new AdbInput(adb, serial, size, onError, onOk) };
}

async function serialOf(adb, avd) {
  for (const serial of parseAdbDevices((await run(adb, ["devices"]))?.stdout ?? "")) {
    if (parseEmuAvdName((await run(adb, ["-s", serial, "emu", "avd", "name"]))?.stdout ?? "") === avd) return serial;
  }
  return null;
}

export class AdbInput {
  constructor(adb, serial, size, onError, onOk) {
    this.adb = adb;
    this.serial = serial;
    this.size = size;
    this.onError = onError;
    this.onOk = onOk;
    this.queue = Promise.resolve();
    this.move = null;
    this.held = new Set();
  }

  run(command) {
    const job = this.queue.then(command).then((result) => {
      const error = commandError(result, "Input failed.");
      if (error) this.onError?.(error.message);
      else if (result) this.onOk?.();
      return result;
    }).catch((error) => this.onError?.(String(error?.message ?? error)));
    this.queue = job;
    return job;
  }

  shell(args) { return this.run(() => exec(this.adb, ["-s", this.serial, "shell", ...args])); }

  px(point) {
    return [String(Math.round(point.x * (this.size.width - 1))), String(Math.round(point.y * (this.size.height - 1)))];
  }

  touch(type, point) {
    if (type === "move") {
      const queued = this.move != null;
      this.move = point;
      if (queued) return this.queue;
      return this.run(async () => {
        const at = this.move;
        this.move = null;
        return at ? exec(this.adb, ["-s", this.serial, "shell", "input", "motionevent", "MOVE", ...this.px(at)]) : null;
      });
    }
    this.move = null;
    return this.shell(["input", "motionevent", type === "begin" ? "DOWN" : "UP", ...this.px(point)]);
  }

  key(type, usage) {
    if (ANDROID_MODIFIERS.has(usage)) return type === "down" ? this.held.add(usage) : this.held.delete(usage);
    const code = androidKeyCode(usage);
    if (type !== "down" || code == null) return;
    return this.held.has(ANDROID_SHIFT)
      ? this.shell(["input", "keycombination", "59", String(code)])
      : this.shell(["input", "keyevent", String(code)]);
  }

  button(name) { return ANDROID_BUTTONS[name] != null && this.shell(["input", "keyevent", String(ANDROID_BUTTONS[name])]); }
  hid(_page, usage) { return ANDROID_VOLUME[usage] != null && this.shell(["input", "keyevent", String(ANDROID_VOLUME[usage])]); }

  scroll(dx, dy, point) {
    const to = { x: clamp01(point.x - dx), y: clamp01(point.y - dy) };
    return this.shell(["input", "swipe", ...this.px(point), ...this.px(to), "120"]);
  }

  rotate() {
    return this.shell(["settings put system accelerometer_rotation 0; r=$(settings get system user_rotation); settings put system user_rotation $(( (${r:-0} + 1) % 4 ))"]);
  }

  close() {}
}
