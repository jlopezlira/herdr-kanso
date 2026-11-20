// Keys from keys.json reach a view's nextCommand loop even when the view was just mounted or reloaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, loadMod } from "./perf-harness.mjs";

// Herdr loses a host call started in the turn a reloaded view mounts: it never settles and its command goes nowhere.
function commands(f) {
  const keys = { mounted: false, waiting: null, reads: 0 };
  f.host.nextCommand = () => {
    if (!keys.mounted) return new Promise(() => {});
    keys.reads += 1;
    return new Promise((resolve) => { keys.waiting = resolve; });
  };
  keys.press = async (command) => {
    const deliver = keys.waiting;
    keys.waiting = null;
    deliver?.(command);
    await f.settle();
    return Boolean(deliver);
  };
  return keys;
}

async function mount(file, name, props, key, ready = () => {}, prepare = () => {}) {
  const f = fixture();
  prepare(f);
  const keys = commands(f);
  const mod = await loadMod(file, [name], f.host);
  const view = new mod[name]();
  f.state.props = props;
  view.init(props, f.cx);
  await f.settle();
  keys.mounted = true;
  await f.advance(0);
  ready(view);
  return { f, keys, view, pressed: await keys.press(key) };
}

test("Cmd+B folds the sidebar right after kansō was updated or reloaded", async () => {
  const { f, pressed } = await mount("kanso-spaces/main.js", "Spaces", {}, "kanso-spaces.sidebar");
  assert.ok(pressed, "the sidebar listens for its keys once it is on screen");
  assert.equal(f.shared.get("sidebar.collapsed"), true);
});

test("the strip, the tab bar and the title bar take their keys right after a reload", async () => {
  for (const [file, name, props, key] of [
    ["kanso-strip/main.js", "Strip", {}, "kanso-strip.arrange"],
    ["kanso-tabs/main.js", "Tabs", {}, "kanso-tabs.panel-1"],
    ["kanso-chrome/main.js", "WorkspaceChrome", {}, "kanso-tabs.settings"],
  ]) {
    const { keys, pressed } = await mount(file, name, props, key);
    assert.ok(pressed, `${name} listens for its keys once it is on screen`);
    assert.equal(keys.reads, 2, `${name} acts on the key and waits for the next one`);
  }
});

test("The title bar acts on its own commands, forwards the tab bar's to it, and an old footer block takes none", async () => {
  const ran = [];
  const record = (f) => {
    f.host.run = (command, args) => { ran.push([command, args ?? null]); };
    f.shared.set("kanso.pieces.undo", { id: "sidebar.activity", state: "show" });
    f.shared.set("kanso.pieces", { "sidebar.activity": "hide" });
  };
  const brand = await mount("kanso-chrome/main.js", "WorkspaceChrome", {}, "kanso-chrome.piece-undo", () => {}, record);
  assert.ok(brand.pressed, "the title bar listens");
  assert.notEqual(brand.f.shared.get("kanso.pieces")?.["sidebar.activity"], "hide", "piece-undo brings the hidden piece back");
  assert.equal(brand.f.shared.get("kanso.pieces.undo"), null);
  for (const name of ["update", "check", "settings", "settings-mods", "settings-news"]) {
    ran.length = 0;
    assert.ok(await brand.keys.press(`kanso-chrome.${name}`));
    assert.deepEqual(ran, [[`kanso-tabs.${name}`, null]], `${name} goes to the tab bar, which holds the Updater and opens Settings`);
  }
  ran.length = 0;
  assert.ok(await brand.keys.press("kanso-chrome.restart"));
  assert.ok(brand.f.state.processes.some((p) => p.command === "sh" && String(p.args[1]).includes("nohup herdr-app")), "restart starts the new window");
  assert.deepEqual(ran, [["app.quit", null]], "then quits this one");
  const old = await mount("kanso-chrome/main.js", "WorkspaceChrome", { footer: true }, "kanso-chrome.restart", () => {}, record);
  assert.equal(old.pressed, false, "a kept footer block reads no command");
  assert.equal(old.keys.reads, 0);
});

const TAB_BAR = ["kanso-tabs.", "kanso-strip.arrange", "mod.open:kanso-help"];
const recording = (ran) => (f) => {
  f.projects[0].tabs = Array.from({ length: 9 }, (_, i) => ({ id: `tab0-${i + 1}`, name: `t${i + 1}`, active: i === 0 }));
  f.host.run = (command, args) => { ran.push([command, JSON.parse(JSON.stringify(args ?? null))]); };
  f.host.openOverlay = (spec) => { ran.push(["overlay", spec.mod]); };
};

test("Every Command chord of the tab bar in kanso/keys.json goes through the keymap to its handler: Cmd+1 to Cmd+9 across nine tabs, Simulator, Arrange and kansō help", async () => {
  const keymap = JSON.parse(readFileSync(new URL("../kanso/keys.json", import.meta.url), "utf8"))["layout:kanso"];
  const chords = Object.entries(keymap).filter(([chord, action]) => chord.startsWith("cmd-") && TAB_BAR.some((owned) => action.startsWith(owned)));
  assert.deepEqual(chords.map(([chord]) => chord), ["cmd-alt-t", ...Array.from({ length: 9 }, (_, i) => `cmd-${i + 1}`), "cmd-shift-s", "cmd-shift-/"]);
  const ran = [], arranged = [];
  const tabs = await mount("kanso-tabs/main.js", "Tabs", {}, keymap["cmd-1"], () => {}, recording(ran));
  assert.ok(tabs.pressed, "cmd-1 reaches the bar");
  assert.deepEqual(ran.filter(([command]) => command === "tab.select"), [["tab.select", { id: "tab0-1" }]], "cmd-1");
  const strip = await mount("kanso-strip/main.js", "Strip", {}, keymap["cmd-alt-t"], () => {}, recording(arranged));
  assert.ok(strip.pressed, "cmd-alt-t reaches the strip");
  assert.deepEqual(arranged.filter(([command]) => command === "overlay"), [["overlay", "kanso-arrange"]], "cmd-alt-t opens Arrangements, as the Arrange door does");
  for (let n = 2; n <= 9; n += 1) {
    ran.length = 0;
    assert.ok(await tabs.keys.press(keymap[`cmd-${n}`]), `cmd-${n} reaches the bar`);
    assert.deepEqual(ran, [["tab.select", { id: `tab0-${n}` }]], `cmd-${n}`);
  }
  tabs.f.shared.set("kanso.sim.tools", { ios: "/usr/bin/simctl" });
  assert.ok(await tabs.keys.press(keymap["cmd-shift-s"]));
  assert.equal(tabs.view.want, "sim", "Cmd+Shift+S opens Simulator");
  const [verb, name] = keymap["cmd-shift-/"].split(":");
  assert.deepEqual([verb, { name }], ["mod.open", { name: "kanso-help" }], "Cmd+Shift+/ is Herdr's own mod.open of kansō help, what its door runs");
});

test("Back leaves Memory's full list right after a reload", async () => {
  const { view, pressed } = await mount("kanso-guard/main.js", "Memory", {}, "kanso-guard.back", (view) => { view.showAll = true; });
  assert.ok(pressed, "Memory listens for its keys once it is on screen");
  assert.equal(view.showAll, false);
});

test("Back leaves Spend's settings right after a reload", async () => {
  const { view, pressed } = await mount("kanso-spend/main.js", "TokenSpend", {}, "kanso-spend.back", (view) => { view.page = "settings"; });
  assert.ok(pressed, "Spend listens for its keys once it is on screen");
  assert.equal(view.page, "home");
});

async function preview() {
  const f = fixture();
  const keys = commands(f);
  const { Preview } = await loadMod("kanso-panel/preview.js", ["Preview"], f.host);
  const open = async () => {
    const view = new Preview();
    view.init(f.cx, { panel: "preview" });
    await f.settle();
    view.saved = 0;
    view.save = () => { view.saved += 1; };
    return view;
  };
  return { f, keys, open };
}

test("Cmd+S saves in Preview right after a reload", async () => {
  const { f, keys, open } = await preview();
  const view = await open();
  keys.mounted = true;
  await f.advance(0);
  assert.ok(await keys.press("kanso-panel.save"), "Preview listens for its keys once it is on screen");
  assert.equal(view.saved, 1);
});

test("Cmd+S still saves in a new Preview when the last one closed before it was on screen", async () => {
  const { f, keys, open } = await preview();
  await open();
  // That view is gone, and its timers with it.
  f.state.timers.length = 0;
  keys.mounted = true;
  const view = await open();
  await f.advance(0);
  assert.ok(await keys.press("kanso-panel.save"), "the new Preview listens for its keys");
  assert.equal(view.saved, 1);
});
