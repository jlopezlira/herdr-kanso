import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clone, exec, load, repoText, temporary } from "./helpers.mjs";
import { loadSettings } from "./mod-fixtures.mjs";
import { updater } from "./update-harness.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const readKeys = (file) => JSON.parse(repoText(file));
const canonical = (chord) => {
  const match = String(chord).match(/^((?:(?:ctrl|alt|shift|cmd)-)*)(.+)$/);
  const mods = new Set(match[1].split("-").filter(Boolean));
  return [...["ctrl", "alt", "shift", "cmd"].filter((mod) => mods.has(mod)), match[2]].join("-");
};
const modifiers = (chord) => chord.split("-").slice(0, -1).join("-");

test("Linux keys leave Omarchy's chords alone, keep every action, and do not bind a chord twice", async () => {
  const { linuxKeymap, takenByOmarchy } = await load("kanso-panel/platform-linux-keys.js", ["linuxKeymap", "takenByOmarchy"]);
  const mac = readKeys("kanso/keys.json");
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
  const { linuxKeymap } = await load("kanso-panel/platform-linux-keys.js", ["linuxKeymap"]);
  const mac = readKeys("kanso/keys.json");
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
  const { linuxKeymap } = await load("kanso-panel/platform-linux-keys.js", ["linuxKeymap"]);
  const mac = readKeys("kanso/keys.json");
  const text = `${JSON.stringify(linuxKeymap(mac), null, 2)}\n`;
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

test("An update from a tag without Linux keys gives the Mac keys back as Linux keys, keeps a key you changed, and moves Quit off Super+Q", async () => {
  const { takenByOmarchy } = await load("kanso-panel/platform-linux-keys.js", ["takenByOmarchy"]);
  const mac = readKeys("kanso/keys.json");
  const linux = readKeys("kanso/keys.linux.json");
  const herdr = JSON.parse(repoText("tests/herdr-keys.macos.json"));
  const user = { ...clone(mac), global: { ...herdr.global }, "layout:kanso": { ...mac["layout:kanso"], "cmd-j": "mine.jump" } };
  const asked = [];
  const { Updater } = await updater({
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
  });
  const instance = new Updater({ file: (version, path) => `${version}/${path}` });
  instance.installed = "old";
  const plan = await instance.plan("new", "/app");
  assert.ok(asked.includes("old/kanso/keys.linux.json") && asked.includes("old/kanso/keys.json") && asked.includes("new/kanso/keys.linux.json"));
  const got = JSON.parse(plan.keys);
  for (const [section, bindings] of Object.entries(linux)) {
    for (const [chord, action] of Object.entries(bindings)) assert.equal(got[section][chord], action, `${section} ${chord}`);
  }
  const yours = Object.entries(got["layout:kanso"]).filter(([, action]) => action === "mine.jump");
  assert.equal(yours.length, 1, "the key you changed is gone");
  assert.equal(takenByOmarchy(yours[0][0]), false, yours[0][0]);
  assert.equal(got.global["cmd-q"], undefined);
  assert.equal(got.global["ctrl-shift-q"], "app.quit");
  for (const [section, bindings] of Object.entries(got)) {
    for (const chord of Object.keys(bindings)) assert.equal(takenByOmarchy(chord), false, `${section} ${chord} is one Omarchy takes`);
  }
  assert.match(plan.notes, /Kept your own cmd-j/);
});

test("Settings on Linux lists a row's shipped key from the Linux keymap", async () => {
  const { Settings } = await loadSettings({ window: () => ({ platform: "linux" }) });
  const settings = new Settings();
  assert.deepEqual(clone(settings.shipped({ action: "kanso-spaces.needs-you.next" }, "layout:kanso")), ["ctrl-shift-j"]);
  assert.deepEqual(clone(settings.shipped({ action: "mod.open:kanso-help" }, "layout:kanso")), ["ctrl-shift-/", "ctrl-?"]);
  assert.deepEqual(clone(settings.shipped({ action: "kanso-strip.new-right" }, "layout:kanso")), ["cmd-d"]);
});
