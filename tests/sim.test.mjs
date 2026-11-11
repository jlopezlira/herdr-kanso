import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { load, clone, singleUse, tape } from "./helpers.mjs";
import * as model from "../kanso/mods/kanso-sim/model.js";

const good = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const DEVELOPER = "/Applications/Xcode Test.app/Contents/Developer";
const SIMCTL = `${DEVELOPER}/usr/bin/simctl`;
const apple = { devices: { "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
  { udid: "one", name: "Phone", state: "Booted", isAvailable: true },
  { udid: "two", name: "Tablet", state: "Shutdown", isAvailable: true },
  { udid: "gone", name: "Old", state: "Shutdown", isAvailable: false },
] } };
const emulator = { id: "avd:Pixel", avd: "Pixel", name: "Pixel", platform: "android", emulator: true, target: "emulator-5554", state: "Booted" };
const phone = { ...emulator, id: "android:usb", avd: undefined, target: "usb", emulator: false };
const ios = model.parseSimctl(JSON.stringify(apple));

test("Simulator reads only available Apple devices and their boot state", () => {
  assert.deepEqual(ios.map((device) => [device.target, device.name, device.state]), [["one", "Phone", "Booted"], ["two", "Tablet", "Off"]]);
  assert.equal(ios[0].runtime, "iOS 18.0");
  assert.deepEqual(model.parseSimctl("{}"), []);
  assert.throws(() => model.parseSimctl("broken"));
});

test("Android devices distinguish emulators, phones and unavailable connections", () => {
  assert.deepEqual(model.parseAdb("* daemon started successfully *\nList of devices attached\nemulator-5554\tdevice\nusb offline\nlocked unauthorized\n"), [
    { serial: "emulator-5554", state: "device", emulator: true }, { serial: "usb", state: "offline", emulator: false }, { serial: "locked", state: "unauthorized", emulator: false },
  ]);
  assert.deepEqual(model.parseAvds("INFO | Starting\r\nPixel\r\nTablet\r\nPixel\n"), ["Pixel", "Tablet"]);
  assert.deepEqual(model.parseAvds(""), []);
});

test("Android size uses the override and refuses absent or empty dimensions", () => {
  assert.deepEqual(model.parseSize("Physical size: 1080x2400\nOverride size: 720x1600"), { width: 720, height: 1600 });
  assert.deepEqual(model.parseSize("Physical size: 1080x2400"), { width: 1080, height: 2400 });
  assert.equal(model.parseSize("Physical size: 0x2400"), null);
  assert.equal(model.parseSize("not ready"), null);
});

test("The device list contains exactly the platforms whose tools are here", () => {
  const running = [{ serial: "emulator-5554", avd: "Pixel", emulator: true, state: "device" }, { serial: "usb", state: "device", emulator: false }];
  for (const applePresent of [false, true]) for (const androidPresent of [false, true]) {
    const rows = model.deviceList({ ios: applePresent, adb: androidPresent }, ios, ["Pixel", "Tablet"], running);
    assert.equal(rows.filter((row) => row.platform === "ios").length, applePresent ? 2 : 0);
    assert.equal(rows.filter((row) => row.platform === "android").length, androidPresent ? 3 : 0);
    if (androidPresent) {
      assert.equal(rows.find((row) => row.id === "avd:Pixel").target, "emulator-5554");
      assert.equal(rows.find((row) => row.id === "avd:Tablet").state, "Off");
    }
  }
  assert.equal(model.deviceList({ adb: true }, [], [], running).length, 2, "connected devices work without the emulator binary");
});

test("Start and Rotate are drawn only for devices their commands can act on", () => {
  assert.equal(Boolean(model.canStart({ ...phone, state: "Off" }, { adb: true })), false);
  assert.equal(Boolean(model.canStart({ ...emulator, state: "Off" }, { adb: true })), false);
  assert.equal(Boolean(model.canStart({ ...emulator, state: "Off" }, { emulator: "/sdk/emulator" })), true);
  assert.equal(model.canRotate(emulator), true);
  assert.equal(model.canRotate(phone), false);
  assert.equal(model.canRotate(ios[0]), false);
  const boot = { id: ios[1].id, until: 90000 };
  assert.equal(model.bootState(ios[1], boot, 0), "Starting… 90s");
  assert.equal(model.bootState(ios[1], boot, 90000), "Start timed out.");
  assert.equal(model.bootState(ios[0], { ...boot, id: ios[0].id }, 1), null);
});

test("One frame lands before the next beat can begin", () => {
  const loop = new model.FrameLoop();
  assert.equal(loop.ready(0, true, "one"), true);
  const key = loop.begin(0);
  assert.equal(loop.ready(3000, true, "one"), false, "never two captures in flight");
  loop.land(key, { path: "frame", width: 100, height: 200 }, 3000);
  assert.equal(loop.ready(3699, true, "one"), false);
  assert.equal(loop.ready(3700, true, "one"), true);
});

test("Behind does no work and front again takes one frame immediately", () => {
  const loop = new model.FrameLoop();
  assert.equal(loop.ready(0, false, "one"), false);
  assert.equal(loop.ready(1, true, "one"), true);
  loop.begin(1); loop.land("one", { path: "last" }, 2);
  assert.equal(loop.ready(3, false, "one"), false);
  assert.equal(loop.ready(4, true, "one"), true, "wake does not wait the remaining beat");
  loop.begin(4);
  assert.equal(loop.ready(5, true, "one"), false);
});

test("A late or failed capture keeps the last picture and its age", () => {
  const loop = new model.FrameLoop();
  loop.ready(0, true, "one"); loop.begin(0); loop.land("one", { path: "last" }, 1);
  loop.begin(701);
  assert.equal(loop.late(8700), false);
  assert.equal(loop.late(8701), true);
  loop.land("one", null, 8800);
  assert.equal(loop.last.path, "last");
  assert.equal(loop.late(8800), true);
  assert.equal(model.age(loop.last.at, 10001), "as of 10s ago");
});

test("A frame from a previous selection cannot replace the selected device", () => {
  const loop = new model.FrameLoop();
  loop.ready(0, true, "old"); loop.begin(0);
  loop.ready(1, true, "new");
  assert.equal(loop.land("old", { path: "old" }, 2), false);
  assert.equal(loop.last, null);
  assert.equal(loop.inFlight, false);
});

test("Hidden ancestors stop the panel even when its own node is shown", () => {
  const tree = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "sim" }] }] };
  assert.equal(model.panelShown(tree), false);
  tree.children[0].hidden = false;
  assert.equal(model.panelShown(tree), true);
  assert.equal(model.panelShown({ id: "root", children: [] }), false);
});

test("PNG and JPEG headers give the device's actual picture proportions", () => {
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); png.set([0, 0, 4, 56, 0, 0, 9, 96], 16);
  assert.deepEqual(model.pictureSize(png), { width: 1080, height: 2400 });
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 17, 8, 9, 96, 4, 56, 3, 0, 0]);
  assert.deepEqual(model.pictureSize(jpeg), { width: 1080, height: 2400 });
  assert.equal(model.pictureSize(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(model.fitPicture({ width: 1080, height: 2400 }, { width: 300, height: 600 }), { width: 270, height: 600 });
  assert.equal(model.fitPicture(null, { width: 300, height: 600 }), null);
});

test("Taps and swipes scale the drawn picture to the device, including rotation", () => {
  const size = { width: 1080, height: 2400 }, drawn = { width: 270, height: 600 };
  const a = model.screenPoint({ x: 135, y: 300 }, drawn, size, size);
  assert.deepEqual(a, { x: 540, y: 1200 });
  assert.deepEqual(model.gesture(a, a, 20), ["tap", "540", "1200"]);
  assert.deepEqual(model.gesture(a, { x: 800, y: 2000 }, 450), ["swipe", "540", "1200", "800", "2000", "450"]);
  assert.deepEqual(model.screenPoint({ x: 300, y: 135 }, { width: 600, height: 270 }, size, { width: 2400, height: 1080 }), { x: 1200, y: 540 });
  assert.deepEqual(model.screenPoint({ x: -1, y: 900 }, drawn, size, size), { x: 0, y: 2399 });
  assert.equal(model.screenPoint(null, drawn, size, size), null);
});

test("Typing batches per target and keeps keyevents between text batches", () => {
  const batch = new model.TextBatch();
  batch.add("one", { text: "he" }); batch.add("one", { text: "llo" }); batch.add("one", { code: 66 }); batch.add("one", { text: "again" }); batch.add("two", { text: "other" });
  assert.deepEqual(batch.take(), [{ target: "one", text: "hello" }, { target: "one", code: 66 }, { target: "one", text: "again" }, { target: "two", text: "other" }]);
  assert.deepEqual(batch.take(), []);
  assert.equal(model.escapeText("a b&'\"\\;$()<>|`"), "a%sb\\&\\'\\\"\\\\\\;\\$\\(\\)\\<\\>\\|\\`");
  assert.deepEqual(model.textParts("literal %s and space"), ["literal%s\\%", "s%sand%sspace"], "literal percent-s must not become a space inside Android input");
});

test("Enter, Backspace and arrows map to Android keys without swallowing shortcuts", () => {
  for (const [key, code] of Object.entries(model.KEYS)) assert.deepEqual(model.keyInput({ key }), { code });
  assert.deepEqual(model.keyInput({ key: "a", key_char: "A" }), { text: "A" });
  for (const modifier of ["control", "alt", "platform"]) assert.equal(model.keyInput({ key: "a", key_char: "a", modifiers: { [modifier]: true } }), null);
  assert.equal(model.keyInput({ key: "escape" }), null);
  assert.deepEqual(model.CONTROLS, [["Back", 4], ["Home", 3], ["Recents", 187], ["Power", 26], ["Volume up", 24], ["Volume down", 25]]);
});

test("Simulator availability is simctl or adb on this computer", async () => {
  const { available } = await load("kanso-sim/registration.js", ["available"]);
  for (const tools of [null, {}, { emulator: "/sdk/emulator" }]) assert.equal(available(tools), false);
  for (const tools of [{ ios: true }, { adb: "/sdk/adb" }, { ios: true, adb: "/sdk/adb" }]) assert.equal(available(tools), true);
});

test("Tab availability probes once per panel-list rebuild and a deadline ignores late answers", async () => {
  const store = {}, commands = [], timers = [], pending = [];
  let settle;
  const answer = new Promise((resolve) => { settle = resolve; });
  const { Tabs } = await load("kanso-tabs/main.js", ["Tabs"], {
    shared: (key) => store[key], setShared: (key, value) => { store[key] = value; }, home: () => "/home/me",
    window: () => ({ platform: "macos" }), exists: async (path) => path === SIMCTL,
    exec: async (cmd) => { commands.push(cmd); return cmd === "xcode-select" ? answer : good("\n\n\n"); },
  });
  const cx = { notify() {}, timer: { after(_ms, fn) { const task = { fn, cancel() {} }; timers.push(task); return task; } }, spawn(fn) { pending.push(fn(cx)); } };
  const tabs = new Tabs();
  tabs.probeSimulator(cx); tabs.probeSimulator(cx);
  assert.equal(commands.filter((cmd) => cmd === "xcode-select").length, 1);
  timers[0].fn();
  assert.deepEqual(clone(store["kanso.sim.tools"]), {});
  settle(good(DEVELOPER)); await Promise.all(pending);
  assert.deepEqual(clone(store["kanso.sim.tools"]), {}, "a missed startup deadline does not publish a stale capability");
  store["kanso.panels.order"] = ["sim", "files"];
  tabs.probeSimulator(cx); await Promise.all(pending);
  assert.equal(commands.filter((cmd) => cmd === "xcode-select").length, 2);
  assert.equal(store["kanso.sim.tools"].ios, SIMCTL);
  assert.equal(store["kanso.pieces"], undefined, "the probe never writes the piece");
});

test("SDK folders follow environment precedence and platform defaults", async () => {
  const { sdkRoots } = await load("kanso-panel/platform-simulator.js", ["sdkRoots"]);
  assert.deepEqual(clone(sdkRoots("macos", "/home/user", { ANDROID_HOME: "/first", ANDROID_SDK_ROOT: "/second" })), ["/first", "/second", "/home/user/Library/Android/sdk"]);
  assert.deepEqual(clone(sdkRoots("linux", "/home/user", {})), ["/home/user/Android/Sdk"]);
  assert.deepEqual(clone(sdkRoots("windows", "C:\\Users\\me", { LOCALAPPDATA: "D:\\Local" })), ["D:\\Local\\Android\\Sdk"]);
});

test("Tool discovery ignores iOS away from macOS and finds an SDK with adb", async () => {
  const commands = [];
  const run = async (cmd, args) => { commands.push([cmd, args]); return good(cmd === "xcode-select" ? DEVELOPER : "/missing\n/sdk\n\n"); };
  const { simulatorApi } = await load("kanso-panel/platform-simulator.js", ["simulatorApi"]);
  const present = async (path) => path === "/sdk/platform-tools/adb";
  const tools = await simulatorApi("linux", run, present).probe("/home/me");
  assert.deepEqual(clone(tools), { ios: null, adb: "/sdk/platform-tools/adb", emulator: null });
  assert.equal(commands.some(([cmd]) => cmd === "xcode-select"), false);
  const mac = await simulatorApi("macos", run, async (path) => path === SIMCTL).probe("/home/me");
  assert.equal(mac.ios, SIMCTL);
  assert.equal(commands.some(([cmd]) => cmd === "xcrun"), false);
});

test("A Mac without Xcode or simctl has no iOS and never invokes the install launcher", async () => {
  const { simulatorApi } = await load("kanso-panel/platform-simulator.js", ["simulatorApi"]);
  for (const selected of [{ code: 1, stdout: "", stderr: "No developer directory" }, good("/Library/Developer/CommandLineTools\n")]) {
    const commands = [];
    const run = async (cmd, args) => { commands.push([cmd, args]); return cmd === "xcode-select" ? selected : good("\n\n\n"); };
    const tools = await simulatorApi("macos", run, async () => false).probe("/home/me");
    assert.equal(tools.ios, null);
    assert.deepEqual(commands.map(([cmd]) => cmd), ["sh", "xcode-select"]);
    assert.deepEqual(clone(commands[1][1]), ["-p"]);
  }
});

test("iOS listing, start and capture execute the discovered simctl directly", async () => {
  const commands = [];
  const run = async (cmd, args) => { commands.push([cmd, args]); return good(args[0] === "list" ? JSON.stringify(apple) : ""); };
  const { readDevices, startDevice, captureDevice } = await load("kanso-sim/devices.js", ["readDevices", "startDevice", "captureDevice"]);
  const tools = { ios: SIMCTL };
  assert.equal((await readDevices(run, tools)).length, 2);
  await startDevice(run, "macos", tools, ios[1]);
  await captureDevice(run, "macos", tools, ios[0], "/data/frame.jpg");
  assert.deepEqual(clone(commands), [
    [SIMCTL, ["list", "devices", "--json"]], [SIMCTL, ["boot", "two"]],
    [SIMCTL, ["io", "one", "screenshot", "--type=jpeg", "/data/frame.jpg"]],
  ]);
});

test("Android capture writes binary output through the platform command service", async () => {
  const commands = [];
  const run = async (...args) => { commands.push(args); return good(); };
  const { simulatorApi } = await load("kanso-panel/platform-simulator.js", ["simulatorApi"]);
  await simulatorApi("linux", run).capture("/sdk with space/adb", "usb", "/data/frame.png");
  const [cmd, args, options] = commands[0];
  assert.equal(cmd, "sh"); assert.match(args[1], /exec-out screencap -p/);
  assert.deepEqual(clone(args.slice(-3)), ["/sdk with space/adb", "usb", "/data/frame.png"]);
  assert.equal(options.timeout, 8000);
  await simulatorApi("windows", run).capture("C:\\SDK\\adb.exe", "usb", "C:\\data\\frame.png");
  assert.equal(commands[1][0], "pwsh");
  assert.match(commands[1][1].at(-1), /StandardOutput\.BaseStream\.CopyTo/);
  assert.doesNotMatch(commands[1][1].at(-1), /cmd\.exe|Out-File/);
});

test("Emulator startup detaches the SDK's process on every platform", async () => {
  const commands = [];
  const { simulatorApi } = await load("kanso-panel/platform-simulator.js", ["simulatorApi"]);
  const run = async (...args) => { commands.push(args); return good(); };
  await simulatorApi("macos", run).start("/sdk/emulator", "Pixel");
  assert.match(commands[0][1][1], /nohup.*&$/);
  assert.deepEqual(clone(commands[0][1].slice(-2)), ["/sdk/emulator", "Pixel"]);
  await simulatorApi("windows", run).start("C:\\SDK\\emulator.exe", "Pixel");
  assert.match(commands[1][1].at(-1), /Start-Process/);
  assert.doesNotMatch(commands[1][1].at(-1), /-Wait/);
});

test("The device service reads emulator names without sending emulator commands to phones", async () => {
  const commands = [];
  const run = async (cmd, args) => {
    commands.push([cmd, args]);
    if (cmd === "emulator") return good("Pixel\nTablet\n");
    if (args[0] === "devices") return good("List of devices attached\nemulator-5554 device\nusb device\n");
    return good("Pixel\nOK\n");
  };
  const { readDevices } = await load("kanso-sim/devices.js", ["readDevices"]);
  const devices = await readDevices(run, { adb: "adb", emulator: "emulator" });
  assert.equal(devices.length, 3);
  assert.equal(devices[0].target, "emulator-5554");
  assert.deepEqual(clone(commands.at(-1)), ["adb", ["-s", "emulator-5554", "emu", "avd", "name"]]);
  commands.length = 0;
  assert.deepEqual(clone(await readDevices(run, { adb: "adb" }, () => false)), []);
  assert.equal(commands.length, 0);
});

async function viewFixture({ active = true, hidden = false, capture, deviceRead, ui = singleUse() } = {}) {
  let now = 100000;
  const timers = [], pending = [], commands = [], removed = [], files = new Set(["avd%3APixel-old.png"]);
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); png.set([0, 0, 4, 56, 0, 0, 9, 96], 16);
  const state = { active, hidden };
  const store = { "kanso.sim.tools": { adb: "adb", emulator: "emulator" } };
  const cx = {
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, release() {}, is_focused: () => true }),
    timer: { after(ms, fn) { const task = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(task); return task; } },
    spawn(fn) { const task = fn(cx); pending.push(task); return { cancel() {} }; },
  };
  const run = async (cmd, args) => {
    commands.push([cmd, args]);
    if (args.includes("size")) return good("Physical size: 1080x2400");
    if (cmd === "sh") return capture ? capture() : good();
    if (args[0] === "devices") return deviceRead ? deviceRead() : good("emulator-5554 device\n");
    if (args.includes("name")) return good("Pixel\nOK\n");
    if (cmd === "emulator") return good("Pixel\n");
    return good();
  };
  const { Simulator } = await load("kanso-sim/main.js", ["Simulator"], {
    ...ui, Input: ui.Input ?? { new: ui.div }, image: ui.div, exec: run, home: () => "/home/me", appHome: () => "/app", theme: () => ({}), spaces: () => [],
    window: () => ({ platform: "linux", active: state.active }), layout: () => ({ id: "panel", hidden: state.hidden, children: [{ id: "sim" }] }),
    shared: (key) => store[key], setShared: (key, value) => { store[key] = value; },
    InputState: { new: () => ({ on() {}, value: () => "app://test", release() {} }) },
    mkdir: async () => {}, readFile: async () => png, readdir: async () => [...files], unlink: async (file) => { removed.push(file); files.delete(file.split("/").at(-1)); },
    Date: class extends Date { static now() { return now; } },
  });
  const view = new Simulator(); view.init({}, cx);
  view.devices = [emulator]; view.selected = emulator.id; view.readAt = now;
  return {
    view, cx, state, timers, commands, removed, advance(ms) { now += ms; },
    setPicture(width, height) { const data = new DataView(png.buffer); data.setUint32(16, width); data.setUint32(20, height); },
    async drain() { while (pending.length) await pending.shift(); },
  };
}

test("The live view captures one file, removes the old one, and waits a beat", async () => {
  const f = await viewFixture();
  f.view.tick(f.cx); f.view.tick(f.cx);
  await f.drain();
  assert.equal(f.commands.filter(([cmd]) => cmd === "sh").length, 1);
  assert.equal(f.removed.length, 1);
  assert.match(f.removed[0], /avd%3APixel-old\.png$/);
  assert.equal(f.view.loop.last.width, 1080);
  f.view.tick(f.cx); await f.drain();
  assert.equal(f.commands.filter(([cmd]) => cmd === "sh").length, 1);
  f.advance(700); f.view.tick(f.cx); await f.drain();
  assert.equal(f.commands.filter(([cmd]) => cmd === "sh").length, 2);
});

test("Android dimensions are cached per device and reread only when its picture rotates", async () => {
  const f = await viewFixture();
  const sizes = () => f.commands.filter(([, args]) => args.includes("size"));
  const frame = async () => { f.advance(700); f.view.tick(f.cx); await f.drain(); };
  await frame(); await frame();
  assert.equal(sizes().length, 1);
  f.setPicture(720, 1600); await frame();
  assert.equal(sizes().length, 1, "dimensions changing within the same orientation do not poll wm size");
  f.setPicture(2400, 1080); await frame(); await frame();
  assert.equal(sizes().length, 2);
  f.view.devices = [emulator, phone];
  f.view.pick(phone, f.cx); f.view.tick(f.cx); await f.drain();
  assert.equal(sizes().length, 3);
  assert.equal(sizes().at(-1)[1][1], "usb");
  f.view.pick(emulator, f.cx); f.view.tick(f.cx); await f.drain();
  assert.equal(sizes().length, 3, "returning to a device reuses its dimensions");
  f.setPicture(1080, 2400); await frame();
  assert.equal(sizes().length, 4);
  assert.deepEqual(clone(f.view.point({ local_position: { x: 135, y: 300 }, bounds: { width: 270, height: 600 } })), { x: 540, y: 1200 });
});

test("The live view keeps its picture after a failed capture and resumes once in front", async () => {
  let fail = false;
  const f = await viewFixture({ capture: async () => { if (fail) throw new Error("late"); return good(); } });
  f.view.tick(f.cx); await f.drain();
  const last = f.view.loop.last.path;
  fail = true; f.advance(700); f.view.tick(f.cx); await f.drain();
  assert.equal(f.view.loop.last.path, last);
  assert.equal(f.view.loop.failed, true);
  const count = f.commands.length;
  f.state.active = false; f.view.tick(f.cx); await f.drain(); assert.equal(f.commands.length, count);
  f.state.active = true; f.view.tick(f.cx); f.view.tick(f.cx); await f.drain();
  assert.equal(f.commands.filter(([cmd]) => cmd === "sh").length, 3);
  f.state.hidden = true; f.advance(700); const before = f.commands.length; f.view.tick(f.cx); await f.drain();
  assert.equal(f.commands.length, before);
});

test("A front transition before the next beat still captures immediately", async () => {
  const f = await viewFixture();
  f.view.tick(f.cx); await f.drain();
  f.state.active = false; f.view.render(f.cx);
  f.state.active = true; f.view.render(f.cx);
  const wake = f.timers.at(-1);
  assert.equal(wake.ms, 0);
  wake.fn(f.cx); await f.drain();
  assert.equal(f.commands.filter(([cmd]) => cmd === "sh").length, 2);
});

test("Keyboard batches and emulator rotation use only the selected Android device", async () => {
  const f = await viewFixture();
  f.view.key({ key: "h", key_char: "h" }, f.cx); f.view.key({ key: "i", key_char: "i" }, f.cx);
  f.view.key({ key: "enter" }, f.cx);
  f.view.flush(f.cx); await f.drain();
  assert.deepEqual(clone(f.commands), [["adb", ["-s", "emulator-5554", "shell", "input", "text", "hi"]], ["adb", ["-s", "emulator-5554", "shell", "input", "keyevent", "66"]]]);
  f.view.android(["emu", "rotate"], f.cx); f.view.flush(f.cx); await f.drain();
  assert.deepEqual(clone(f.commands.at(-1)), ["adb", ["-s", "emulator-5554", "emu", "rotate"]]);
  f.view.key({ key: "x", key_char: "x" }, f.cx); f.state.active = false; f.view.flush(f.cx); await f.drain();
  assert.equal(f.commands.length, 3);
});

test("iOS controls act through simctl and expose touch only in Apple's Simulator", async () => {
  const screen = tape();
  const f = await viewFixture({ ui: screen.host });
  f.view.tools = { ios: SIMCTL };
  f.view.devices = ios; f.view.selected = ios[0].id;
  f.view.controls(ios[0], {});
  assert.deepEqual([...screen.handlers.keys()], ["sim-Open in Simulator", "sim-Appearance light", "sim-Appearance dark", "sim-Shut down", "sim-Open a URL"]);
  for (const label of ["Appearance dark", "Open a URL", "Shut down", "Open in Simulator"]) {
    screen.handlers.get(`sim-${label}`)({}, f.cx); await f.drain();
  }
  assert.deepEqual(clone(f.commands), [
    [SIMCTL, ["ui", "one", "appearance", "dark"]],
    [SIMCTL, ["openurl", "one", "app://test"]],
    [SIMCTL, ["shutdown", "one"]], ["open", ["-a", "Simulator"]],
  ]);
  f.view.key({ key: "x", key_char: "x" }, f.cx); f.view.flush(f.cx); await f.drain();
  assert.equal(f.commands.length, 4);
});

test("A missed action answer releases its button and does not accept a late failure", async () => {
  let settle;
  const action = new Promise((_resolve, reject) => { settle = reject; });
  const f = await viewFixture();
  f.view.act(() => action, f.cx);
  assert.equal(f.view.acting, true);
  f.timers.at(-1).fn(f.cx);
  assert.equal(f.view.acting, false);
  assert.equal(f.view.error, "Command did not answer.");
  settle(new Error("old failure")); await f.drain();
  assert.equal(f.view.error, "Command did not answer.");
});

test("A missed device read releases Refresh and ignores its late list", async () => {
  let settle;
  const answer = new Promise((resolve) => { settle = resolve; });
  const f = await viewFixture({ deviceRead: () => answer });
  f.view.refresh(f.cx);
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(f.view.reading, true);
  f.view.deadline.fn(f.cx);
  assert.equal(f.view.reading, false);
  assert.equal(f.view.note, "Devices did not answer.");
  settle(good("")); await f.drain();
  assert.equal(f.view.current().id, emulator.id);
  assert.equal(f.view.note, "Devices did not answer.");
});

test("Physical Android devices expose keys but no emulator-only control", async () => {
  const screen = tape();
  const f = await viewFixture({ ui: screen.host });
  f.view.controls(phone, {});
  assert.deepEqual([...screen.handlers.keys()], model.CONTROLS.map(([label]) => `sim-${label}`));
});

test("Every Simulator UI state renders with the shared kit and single-use elements", async () => {
  const f = await viewFixture();
  f.view.devices = null; f.view.render(f.cx);
  f.view.devices = []; f.view.render(f.cx);
  f.view.devices = [emulator]; f.view.selected = emulator.id; f.view.render(f.cx);
  f.view.loop.last = { path: "data/kanso-sim/frame.png", width: 1080, height: 2400, at: 0 }; f.view.bounds = { width: 300, height: 600 }; f.view.render(f.cx);
  f.view.loop.failed = true; f.view.render(f.cx);
  f.view.devices = ios; f.view.selected = ios[0].id; f.view.render(f.cx);
  f.view.selected = ios[1].id; f.view.boot = { id: ios[1].id, until: 190000 }; f.view.render(f.cx);
  f.view.tools = { adb: "adb" }; f.view.note = "Missing part"; f.view.error = "Start failed"; f.view.render(f.cx);
  f.view.close(); assert.equal(f.view.inFront(), false);
});

test("Simulator source contains no package runner, install launcher, alternate transport or server", async () => {
  const root = new URL("../kanso/mods/kanso-sim/", import.meta.url);
  const files = (await readdir(root)).filter((name) => name.endsWith(".js"));
  for (const file of files) {
    const source = (await readFile(new URL(file, root), "utf8")).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\b(?:npx|xcrun|http|https|net|websocket|serve-sim)\b/i, file);
  }
});
