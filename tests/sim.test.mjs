// Simulator: device lists, frames, viewers, SDK paths, and the panel's default.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clone, load } from "./helpers.mjs";

const model = () => load("kanso-sim/model.js", [
  "parseSimctl", "parseAdbDevices", "parseAvdNames", "parseAvdConfig", "parseEmuAvdName", "parseWmSize",
  "emulatorRow", "chooseDevice", "createParser", "pushBytes", "imageAspect", "scheduleFrame", "promoteStack",
  "freshStack", "claimSlot", "releaseSlot", "freshness", "watch", "unwatch", "keyUsages", "touchEdge",
  "frameBytes", "TAG", "nextOrientation", "lastJson", "streamAddress", "fitScreen", "androidKeyCode", "scrollFractions", "FRAME_MS",
]);
const reg = () => load("kanso-sim/sim-register.js", [
  "applySimDefault", "sdkCandidates", "runningDirs", "hostFamily", "abiFits", "probeTools", "readNamedEnv",
  "gapRows", "streamBlock", "listenPort", "toolFile", "PANEL", "INSTALL_LINE", "SERVE_INSTALL", "iosOn",
]);
const paths = () => load("kanso-panel/platform-paths.js", ["pathApi"]);

const text = (value) => new TextEncoder().encode(value);
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const part = (body) => {
  const bytes = body instanceof Uint8Array ? body : text(body);
  return join(text(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${bytes.length}\r\n\r\n`), bytes, text("\r\n"));
};

test("simctl JSON keeps iOS devices, newest runtime first, and skips other runtimes", async () => {
  const { parseSimctl } = await model();
  const devices = parseSimctl(JSON.stringify({ devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-27-2": [
      { udid: "A", name: "iPhone 16", state: "Shutdown", isAvailable: true },
      { udid: "B", name: "iPhone 15", state: "Booted", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [{ udid: "C", name: "iPad", state: "Shutdown" }],
    "com.apple.CoreSimulator.SimRuntime.watchOS-10-0": [{ udid: "W", name: "Watch", state: "Booted" }],
  } }));
  assert.deepEqual(clone(devices), [
    { platform: "ios", id: "B", name: "iPhone 15", os: "iOS 27.2", booted: true },
    { platform: "ios", id: "A", name: "iPhone 16", os: "iOS 27.2", booted: false },
    { platform: "ios", id: "C", name: "iPad", os: "iOS 18.0", booted: false },
  ]);
});

test("adb and emulator output become devices, and a mismatched image cannot be chosen", async () => {
  const { parseAdbDevices, parseAvdNames, parseAvdConfig, parseEmuAvdName, parseWmSize, emulatorRow, chooseDevice } = await model();
  assert.deepEqual(clone(parseAdbDevices("List of devices attached\nemulator-5554\tdevice\nemulator-5556 offline\n")), ["emulator-5554"]);
  assert.deepEqual(clone(parseAvdNames("Pixel_6\nnot a name\nPixel.Fold\n")), ["Pixel_6", "Pixel.Fold"]);
  assert.deepEqual(clone(parseAvdConfig("abi.type=arm64-v8a\nimage.sysdir.1=system-images/android-34/google_apis/arm64-v8a\n")), { abi: "arm64-v8a", api: "34" });
  assert.equal(parseEmuAvdName("Pixel_6\r\nOK\r\n"), "Pixel_6");
  assert.equal(parseEmuAvdName("error: closed\nOK\n"), "");
  assert.deepEqual(clone(parseWmSize("Physical size: 1080x2400\n")), { width: 1080, height: 2400 });
  const arm = emulatorRow("Pixel_6", { abi: "arm64-v8a", api: "34" }, true, "arm");
  const foreign = emulatorRow("Pixel_x86", { abi: "x86_64", api: "34" }, false, "arm");
  assert.equal(arm.booted, true);
  assert.equal(arm.os, "Android API 34");
  assert.equal(arm.unusable, null);
  assert.equal(foreign.unusable, "x86_64 image, can't run on this computer");
  assert.equal(chooseDevice([foreign, arm], "avd:Pixel_x86").id, "avd:Pixel_6", "an unusable pick falls through to the booted one");
  assert.equal(chooseDevice([arm], null).name, "Pixel 6");
  assert.equal(chooseDevice([], "gone"), null);
});

test("the multipart parser skips an HTTP preamble and a frame split across chunks, and copies bytes", async () => {
  const { createParser, pushBytes } = await model();
  const parser = createParser();
  const first = new Uint8Array([1, 2, 3, 4]);
  const second = new Uint8Array([5, 6, 7, 8]);
  const preamble = text("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n");
  const both = join(preamble, part(first), part(second));
  const waiting = pushBytes(parser, both.subarray(0, 20));
  assert.equal(waiting.frames.length, 0, "a split header waits");
  const frames = pushBytes(waiting.parser, both.subarray(20)).frames;
  assert.equal(frames.length, 2);
  assert.deepEqual([...frames[0]], [...first]);
  assert.deepEqual([...frames[1]], [...second]);
  frames[0][0] = 9;
  pushBytes(waiting.parser, part(new Uint8Array([9])));
  assert.equal(frames[0][0], 9, "a later chunk does not alias an earlier frame");
  const body = part(new Uint8Array([4, 5, 6, 7, 8]));
  const head = body.findIndex((byte, index) => index > 10 && byte === 4);
  const partial = pushBytes(createParser(), body.subarray(0, head + 2));
  assert.equal(partial.frames.length, 0, "a split body waits");
  assert.deepEqual([...pushBytes(partial.parser, body.subarray(head + 2)).frames[0]], [4, 5, 6, 7, 8]);
});

test("a frame's aspect comes from PNG or JPEG, and the ring promotes the file that just reloaded", async () => {
  const { imageAspect, scheduleFrame, promoteStack, freshStack, FRAME_MS } = await model();
  const png = new Uint8Array(24);
  png[0] = 0x89; png[1] = 0x50; png[19] = 100; png[23] = 200;
  assert.equal(imageAspect(png), 0.5);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x00, 0xc8]);
  assert.equal(imageAspect(jpeg), 200 / 400);
  assert.equal(scheduleFrame(100, 99, FRAME_MS), null);
  assert.equal(scheduleFrame(0, 0, FRAME_MS), FRAME_MS);
  assert.equal(scheduleFrame(0, 1000, FRAME_MS), 1000 - FRAME_MS + FRAME_MS);
  assert.deepEqual(clone(promoteStack(freshStack(3), 1)), [0, 2, 1]);
});

test("live lasts through a frame 2 seconds old, and stops when no frame has arrived", async () => {
  const { freshness } = await model();
  assert.equal(freshness(1000, 3000), "live");
  assert.equal(freshness(1000, 3001), "stalled");
  assert.equal(freshness(null, 3000), "stopped");
});

test("closing one viewer never finishes a helper another viewer still holds", async () => {
  const { watch, unwatch, claimSlot, releaseSlot } = await model();
  let book = {};
  book = watch(book, "phone").book;
  const second = watch(book, "phone");
  book = second.book;
  assert.equal(second.first, false);
  assert.equal(book.phone, 2);
  const other = watch(book, "tablet");
  book = other.book;
  const left = unwatch(book, "phone");
  assert.equal(left.last, false);
  assert.equal(left.book.phone, 1);
  assert.equal(left.book.tablet, 1);
  const done = unwatch(left.book, "phone");
  assert.equal(done.last, true);
  assert.deepEqual(clone(done.book), { tablet: 1 });
  const first = claimSlot([]);
  const next = claimSlot(first.taken);
  assert.deepEqual(clone([first.id, next.id]), ["v1", "v2"]);
  assert.deepEqual(clone(releaseSlot(next.taken, "v1")), ["v2"]);
});

test("a stream address gives the host, the port and the path of the screen", async () => {
  const { streamAddress } = await model();
  assert.deepEqual(clone(streamAddress("http://127.0.0.1:9/stream.mjpeg")), { host: "127.0.0.1", port: 9, path: "/stream.mjpeg" });
  assert.deepEqual(clone(streamAddress("http://127.0.0.1/stream.mjpeg?ready=1")), { host: "127.0.0.1", port: 0, path: "/stream.mjpeg" });
});

test("keys for the device keep a shifted symbol and leave a platform chord alone", async () => {
  const { keyUsages, touchEdge, frameBytes, TAG, nextOrientation, lastJson, scrollFractions, androidKeyCode, fitScreen } = await model();
  assert.equal(keyUsages({ key: "a", modifiers: { platform: true } }), null);
  assert.deepEqual(clone(keyUsages({ key: "A", modifiers: {} })), { usage: 4, modifiers: [225] });
  assert.equal(keyUsages({ key: "!", modifiers: {} }).usage, 30);
  assert.equal(touchEdge({ y: 0.93 }), 3);
  assert.equal(touchEdge({ y: 0.5 }), 0);
  const bytes = frameBytes(TAG.touch, { type: "begin", x: 0, y: 1 });
  assert.equal(bytes[0], TAG.touch);
  assert.equal(nextOrientation("portrait"), "landscape_left");
  assert.equal(nextOrientation("nope"), "portrait");
  assert.deepEqual(clone(lastJson("noise\n{\"streamUrl\":\"http://127.0.0.1:9/stream.mjpeg\"}\n")), { streamUrl: "http://127.0.0.1:9/stream.mjpeg" });
  assert.deepEqual(clone(scrollFractions(null, { x: 0, y: 1 }, { width: 100, height: 200 })), { dx: 0, dy: -20 / 200 });
  assert.equal(androidKeyCode(4), 29);
  const fit = fitScreen(200, 400, 9 / 19.5);
  assert.ok(fit.height <= 400 && fit.width <= 200);
});

test("each platform finds the Android SDK and the emulator's discovery folder", async () => {
  const { pathApi } = await paths();
  const { sdkCandidates, runningDirs, hostFamily, toolFile, listenPort, iosOn } = await reg();
  assert.equal(hostFamily("arm64"), "arm");
  assert.equal(hostFamily("aarch64"), "arm");
  assert.equal(hostFamily("ARM64"), "arm");
  assert.equal(hostFamily("x86_64"), "x86");
  assert.equal(hostFamily("AMD64"), "x86");
  assert.equal(iosOn("macos"), true);
  assert.equal(iosOn("linux"), false);
  assert.equal(listenPort("emulator-5554"), 32554);
  assert.equal(toolFile("adb", "windows"), "adb.exe");
  const mac = pathApi("macos");
  assert.deepEqual(clone(sdkCandidates("macos", "/Users/me", { ANDROID_HOME: "", ANDROID_SDK_ROOT: "/opt/sdk" }, mac)), ["/opt/sdk", "/Users/me/Library/Android/sdk"]);
  assert.deepEqual(clone(runningDirs("macos", "/Users/me", {}, mac)), ["/Users/me/Library/Caches/TemporaryItems/avd/running"]);
  const linux = pathApi("linux");
  assert.deepEqual(clone(sdkCandidates("linux", "/home/me", {}, linux)), ["/home/me/Android/Sdk"]);
  assert.deepEqual(clone(runningDirs("linux", "/home/me", { XDG_RUNTIME_DIR: "/run/user/1" }, linux)), ["/run/user/1/avd/running", "/tmp/avd/running"]);
  const win = pathApi("windows");
  assert.deepEqual(clone(sdkCandidates("windows", "C:\\Users\\me", { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ANDROID_HOME: "  " }, win)), ["C:\\Users\\me\\AppData\\Local\\Android\\Sdk"]);
  assert.deepEqual(clone(runningDirs("windows", "C:\\Users\\me", { TEMP: "C:\\Temp" }, win)), ["C:\\Temp\\avd\\running"]);
  assert.equal(sdkCandidates("windows", "C:\\Users\\me", {}, win)[0], "C:\\Users\\me\\AppData\\Local\\Android\\Sdk");
});

test("a missing tool is named, and Linux does not look for simctl", async () => {
  const { pathApi } = await paths();
  const { probeTools, readNamedEnv, gapRows, streamBlock, INSTALL_LINE, SERVE_INSTALL } = await reg();
  const cmds = [];
  const tools = await probeTools({
    platform: "linux", home: "/home/me", env: {}, api: pathApi("linux"),
    run: async (cmd) => { cmds.push(cmd); return { code: 1, stdout: "", stderr: "" }; },
  });
  assert.deepEqual(clone(tools), { ios: false, android: false });
  assert.equal(cmds.includes("xcrun"), false);
  const env = await readNamedEnv("linux", async (cmd, args) => ({ code: args[0] === "ANDROID_HOME" ? 0 : 1, stdout: args[0] === "ANDROID_HOME" ? "/opt/sdk\n" : "", stderr: "" }), ["ANDROID_HOME", "TMP"]);
  assert.deepEqual(clone(env), { ANDROID_HOME: "/opt/sdk", TMP: "" });
  const win = await readNamedEnv("windows", async () => { throw new Error("printenv"); }, ["ANDROID_HOME", "TEMP"], async (_run, script) => {
    assert.match(script, /ANDROID_HOME/);
    return { code: 0, stdout: "ANDROID_HOME=D:\\sdk\r\nTEMP=\r\n", stderr: "" };
  });
  assert.equal(win.ANDROID_HOME, "D:\\sdk");
  assert.equal(win.TEMP, "");
  assert.equal(gapRows({ platform: "linux", node: false, simctl: false, sdk: false, serve: false }).some((row) => row.id === "xcode" || row.install), false);
  assert.equal(gapRows({ platform: "macos", node: false, simctl: true, sdk: true, serve: false }).some((row) => row.install), false, "no install button without Node");
  const install = gapRows({ platform: "macos", node: true, simctl: true, sdk: true, serve: false }).find((row) => row.install);
  assert.equal(install.text, INSTALL_LINE);
  assert.deepEqual(clone(SERVE_INSTALL), ["--yes", "serve-sim@0.1.49", "--version"]);
  assert.equal(streamBlock({ platform: "macos", node: true, simctl: true, sdk: true, serve: false, device: { platform: "ios" } }), "serve");
  assert.equal(streamBlock({ platform: "windows", node: true, simctl: false, sdk: true, serve: false, device: { platform: "android" } }), null);
});

test("Simulator is a panel, off by default only when this computer has neither tool", async () => {
  const { applySimDefault, PANEL } = await reg();
  assert.equal(PANEL.id, "sim");
  assert.deepEqual(clone(applySimDefault(["look"], { ios: false, android: false }, false)), { off: ["look", "sim"], decided: true });
  assert.deepEqual(clone(applySimDefault(["look"], { ios: true, android: false }, false)), { off: ["look"], decided: true });
  assert.deepEqual(clone(applySimDefault(["sim", "files"], { ios: true, android: true }, true)), { off: ["sim", "files"], decided: true }, "a later choice stays");
  assert.deepEqual(clone(applySimDefault(["sim"], { ios: false, android: true }, false).off), ["sim"], "a tool does not turn a panel back on");
  const store = {};
  const host = { shared: (key) => store[key], setShared: (key, value) => { store[key] = value; } };
  const { panelList, setPanelOn } = await load("kanso-tabs/main.js", ["panelList", "setPanelOn"], host);
  assert.equal(panelList().some((panel) => panel.id === "sim" && panel.on), true);
  setPanelOn("sim", false);
  assert.equal(panelList().find((panel) => panel.id === "sim").on, false);
  assert.equal(panelList().at(-1).id, "sim");
});
