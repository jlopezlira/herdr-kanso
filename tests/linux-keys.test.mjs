import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clone, context, exec, load, repoText, temporary } from "./helpers.mjs";
import { loadSettings } from "./mod-fixtures.mjs";
import { installedUpdater } from "./update-harness.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const readKeys = (file) => JSON.parse(repoText(file));
const { linuxKeymap, linuxSection, migrateToLinux, shippedLinuxKeymap, takenByOmarchy, withClipboardKeys } = await load("kanso-panel/platform-linux-keys.js", ["linuxKeymap", "linuxSection", "migrateToLinux", "shippedLinuxKeymap", "takenByOmarchy", "withClipboardKeys"]);
const macLinux = () => ({
  mac: readKeys("kanso/keys.json"),
  linux: readKeys("kanso/keys.linux.json"),
  herdr: JSON.parse(repoText("tests/herdr-keys.macos.json")),
});
const canonical = (chord) => {
  const match = String(chord).match(/^((?:(?:ctrl|alt|shift|cmd)-)*)(.+)$/);
  const mods = new Set(match[1].split("-").filter(Boolean));
  return [...["ctrl", "alt", "shift", "cmd"].filter((mod) => mods.has(mod)), match[2]].join("-");
};
const modifiers = (chord) => chord.split("-").slice(0, -1).join("-");
const noneTaken = (keys) => {
  for (const [section, bindings] of Object.entries(keys)) {
    for (const chord of Object.keys(bindings)) assert.equal(takenByOmarchy(chord), false, `${section} ${chord} is one Omarchy takes`);
  }
};
const captureWrites = () => {
  const writes = [];
  return { writes, writeTextFile: async (file, body, expected) => { writes.push({ file, body, expected }); } };
};

test("Linux keys leave Omarchy's chords alone, keep every action, and do not bind a chord twice", async () => {
  const { mac } = macLinux();
  const linux = linuxKeymap(mac);
  for (const [section, bindings] of Object.entries(linux)) {
    const chords = Object.keys(bindings);
    const forms = chords.map(canonical);
    assert.equal(new Set(forms).size, forms.length, `${section} binds a chord twice`);
    for (const chord of chords) assert.equal(takenByOmarchy(chord), false, `${section} ${chord} is one Omarchy takes`);
    const actions = new Set(Object.values(bindings));
    for (const action of Object.values(mac[section])) assert.ok(actions.has(action), `${section} no longer binds ${action}`);
  }
  assert.equal(JSON.stringify(linuxKeymap(linux)), JSON.stringify(linux), "rewriting the Linux keys changes them");
});

test("Super+D and Super+B stay, the next agent that needs you moves to Ctrl+Shift+J, and the vim keys share one set of modifiers", async () => {
  const { mac } = macLinux();
  const layout = linuxKeymap(mac)["layout:kanso"];
  assert.equal(layout["cmd-d"], mac["layout:kanso"]["cmd-d"]);
  assert.equal(layout["cmd-b"], mac["layout:kanso"]["cmd-b"]);
  assert.equal(layout["ctrl-shift-j"], "kanso-spaces.needs-you.next");
  assert.equal(layout["cmd-j"], undefined);
  const vim = Object.entries(layout).filter(([, action]) => /^kanso-strip\.vim-(left|down|up|right)$/.test(action));
  assert.equal(vim.length, 4);
  assert.equal(new Set(vim.map(([chord]) => modifiers(chord))).size, 1, vim.map(([chord]) => chord).join(" "));
  assert.equal(layout["ctrl-?"], "mod.open:kanso-help");
  assert.equal(layout["alt-!"], "kanso-tabs.tab-1");
});

test("The Linux keys file is the Mac keys rewritten for Omarchy, and the build check fails when that file is changed", async (t) => {
  const { mac } = macLinux();
  const text = `${JSON.stringify(shippedLinuxKeymap(mac), null, 2)}\n`;
  assert.equal(repoText("kanso/keys.linux.json"), text);
  const onRepo = await exec(process.execPath, ["scripts/build-linux-keys.mjs", "--check"], { cwd: repo });
  assert.equal(onRepo.code, 0, onRepo.stderr);
  const scratch = await temporary(t);
  for (const file of ["scripts/build-linux-keys.mjs", "scripts/cli.mjs", "kanso/mods/kanso-panel/platform-linux-keys.js", "kanso/keys.json", "kanso/keys.linux.json"]) {
    await mkdir(dirname(join(scratch, file)), { recursive: true });
    await cp(join(repo, file), join(scratch, file));
  }
  const copy = await readFile(join(scratch, "kanso/keys.linux.json"), "utf8");
  await writeFile(join(scratch, "kanso/keys.linux.json"), copy.replace("kanso-strip.new-right", "kanso-strip.other"));
  const changed = await exec(process.execPath, ["scripts/build-linux-keys.mjs", "--check"], { cwd: scratch });
  assert.notEqual(changed.code, 0);
  assert.match(changed.stderr, /kanso\/keys\.linux\.json differs from kanso\/keys\.json/);
});

test("macOS and Windows keep their own key files, and Linux uses the Linux file with the Mac file as the old baseline", async () => {
  const { formerKeymap, shippedKeymap } = await load("kanso-panel/platform-keymap.js", ["formerKeymap", "shippedKeymap"]);
  assert.equal(shippedKeymap("macos"), "kanso/keys.json");
  assert.equal(formerKeymap("macos"), null);
  assert.equal(shippedKeymap("windows"), "kanso/keys.windows.json");
  assert.equal(formerKeymap("windows"), null);
  assert.equal(shippedKeymap("linux"), "kanso/keys.linux.json");
  assert.equal(formerKeymap("linux"), "kanso/keys.json");
});

test("A chord reserved for kansō is never given to a key that had to move, nor to the form Linux reports", async () => {
  assert.equal(linuxSection({ "cmd-j": "mine.jump" })["ctrl-shift-j"], "mine.jump");
  const moved = linuxSection({ "cmd-j": "mine.jump" }, new Set(["ctrl-shift-j"]));
  assert.equal(moved["ctrl-shift-j"], undefined);
  assert.deepEqual(Object.values(moved), ["mine.jump"]);
  assert.equal(linuxSection({ "cmd-shift-/": "app.help" })["ctrl-?"], "app.help");
  assert.equal(linuxSection({ "cmd-shift-/": "app.help" }, new Set(["ctrl-?"]))["ctrl-?"], undefined);
});

test("Settings on Linux lists a row's shipped key from the Linux keymap", async () => {
  const { Settings } = await loadSettings({ window: () => ({ platform: "linux" }) });
  const settings = new Settings();
  assert.deepEqual(clone(settings.shipped({ action: "kanso-spaces.needs-you.next" }, "layout:kanso")), ["ctrl-shift-j"]);
  assert.deepEqual(clone(settings.shipped({ action: "mod.open:kanso-help" }, "layout:kanso")), ["ctrl-shift-/"]);
  assert.deepEqual(clone(settings.shipped({ action: "kanso-strip.new-right" }, "layout:kanso")), ["cmd-d"]);
});

test("A Mac keys file moves kansō and Herdr to Linux keys, and a second run changes nothing", async () => {
  const { mac, linux, herdr } = macLinux();
  const user = { ...clone(mac), global: { ...herdr.global } };
  const first = migrateToLinux(user, mac);
  assert.equal(first.changed, true);
  for (const [section, bindings] of Object.entries(linux)) {
    for (const [chord, action] of Object.entries(bindings)) assert.equal(first.keys[section][chord], action, `${section} ${chord}`);
  }
  assert.equal(first.keys.global["cmd-q"], undefined);
  assert.equal(first.keys.global["ctrl-shift-q"], "app.quit");
  noneTaken(first.keys);
  assert.equal(first.keys.terminal["ctrl-shift-c"], "terminal.copy");
  assert.equal(first.keys.terminal["ctrl-insert"], "terminal.copy");
  assert.equal(first.keys.terminal["ctrl-shift-v"], "terminal.paste");
  assert.equal(first.keys.terminal["shift-insert"], "terminal.paste");
  const second = migrateToLinux(first.keys, mac);
  assert.equal(second.changed, false);
  assert.equal(JSON.stringify(second.keys), JSON.stringify(first.keys));
});

test("Clipboard keys fill only the unbound chords and keep a user's own Ctrl+Shift+C", () => {
  const keys = { terminal: { "ctrl-shift-c": "mine.copy", "ctrl-insert": "mine.insert", "ctrl-shift-f": "kanso-strip.find" } };
  const next = withClipboardKeys(keys);
  assert.equal(next.terminal["ctrl-shift-c"], "mine.copy");
  assert.equal(next.terminal["ctrl-insert"], "mine.insert");
  assert.equal(next.terminal["ctrl-shift-f"], "kanso-strip.find");
  assert.equal(next.terminal["ctrl-shift-v"], "terminal.paste");
  assert.equal(next.terminal["shift-insert"], "terminal.paste");
  assert.equal(Object.keys(next.terminal).length, 5);
});

test("A Mac map without Super+J migrates with no key for the next agent that needs you", async () => {
  const { mac } = macLinux();
  const layout = Object.fromEntries(Object.entries(mac["layout:kanso"]).filter(([chord]) => chord !== "cmd-j"));
  const moved = migrateToLinux({ ...mac, "layout:kanso": layout }, mac);
  for (const bindings of Object.values(moved.keys)) assert.equal(Object.values(bindings).includes("kanso-spaces.needs-you.next"), false);
});

test("Linux arrival writes the moved keys once, with the text it read as the expected content, and does nothing on macOS, Windows, or a missing or unreadable keys file", async () => {
  const { herdr } = macLinux();
  const { DEFAULT_KEYS } = await load("kanso-tabs/defaults.js", ["DEFAULT_KEYS"]);
  const mac = DEFAULT_KEYS["kanso/keys.json"];
  const user = { ...clone(mac), global: { ...herdr.global } };
  const text = JSON.stringify(user);
  const { writes, writeTextFile } = captureWrites();
  let read = async () => text;
  const { arriveOnLinux } = await load("kanso-tabs/linux-arrival.js", ["arriveOnLinux"], {
    appHome: () => "/app",
    readTextFile: () => read(),
    writeTextFile,
    notify: () => {},
  });
  assert.equal(await arriveOnLinux("linux"), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, "/app/keys.json");
  assert.equal(writes[0].expected, text);
  assert.equal(writes[0].body, JSON.stringify(migrateToLinux(user, mac).keys, null, 2) + "\n");
  read = async () => writes[0].body;
  assert.equal(await arriveOnLinux("linux"), false);
  assert.equal(await arriveOnLinux("macos"), false);
  assert.equal(await arriveOnLinux("windows"), false);
  read = async () => null;
  assert.equal(await arriveOnLinux("linux"), false);
  read = async () => { throw new Error("unreadable"); };
  assert.equal(await arriveOnLinux("linux"), false);
  assert.equal(writes.length, 1);
});

test("Backspace on the panel family removes Ctrl+Shift+N and Ctrl+! through Ctrl+(, and the panel row lists one chord pattern", async () => {
  const shifted = ["!", "@", "#", "$", "%", "^", "&", "*", "("];
  const panel = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n, i) => [
    [`ctrl-shift-${n}`, `kanso-tabs.panel-${n}`],
    [`ctrl-${shifted[i]}`, `kanso-tabs.panel-${n}`],
  ]));
  const doc = { "layout:kanso": { ...panel, "cmd-d": "kanso-strip.new-right" } };
  const text = JSON.stringify(doc);
  const { writes, writeTextFile } = captureWrites();
  const { Settings } = await loadSettings({
    window: () => ({ platform: "linux" }),
    appHome: () => "/app",
    readTextFile: async () => text,
    writeTextFile,
  });
  const settings = new Settings();
  const row = { family: "kanso-tabs.panel-" };
  const list = Object.entries(doc["layout:kanso"]).map(([keys, action]) => ({ section: "layout:kanso", keys, action }));
  assert.deepEqual(clone(settings.chordsOf(row, "layout:kanso", list)), ["ctrl-shift-N"]);
  assert.deepEqual(clone(settings.shipped(row, "layout:kanso")), ["ctrl-shift-N"]);
  settings.armed = { clear() {} };
  settings.capture = { row, section: "layout:kanso", old: "ctrl-shift-N" };
  const { cx, drain } = context();
  settings.key({ key: "backspace", modifiers: {} }, cx);
  await drain();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expected, text);
  const left = JSON.parse(writes[0].body)["layout:kanso"];
  for (const chord of Object.keys(panel)) assert.equal(left[chord], undefined, chord);
  assert.equal(left["cmd-d"], "kanso-strip.new-right");
});

test("An update from a tag without Linux keys moves the Mac keys with migrateToLinux", async () => {
  const { mac, linux, herdr } = macLinux();
  const user = { ...clone(mac), global: { ...herdr.global }, "layout:kanso": { ...mac["layout:kanso"], "cmd-j": "mine.jump" } };
  const asked = [];
  const plan = await (await installedUpdater({
    window: () => ({ platform: "linux" }),
    readTextFile: async () => JSON.stringify(user),
    exec: async (command, args) => {
      assert.ok(command === "curl" || command === "curl.exe", command);
      const url = args.at(-1);
      asked.push(url);
      if (url.endsWith("layouts/kanso.json")) return { code: 0, stdout: "{}" };
      if (url === "old/kanso/keys.linux.json") return { code: 22, stdout: "" };
      if (url === "old/kanso/keys.json") return { code: 0, stdout: JSON.stringify(mac) };
      if (url === "new/kanso/keys.linux.json") return { code: 0, stdout: JSON.stringify(linux) };
      assert.fail(url);
    },
  })).plan("new", "/app");
  assert.ok(asked.includes("old/kanso/keys.linux.json") && asked.includes("old/kanso/keys.json") && asked.includes("new/kanso/keys.linux.json"));
  assert.equal(plan.keys, JSON.stringify(migrateToLinux(user, mac).keys, null, 2));
});
