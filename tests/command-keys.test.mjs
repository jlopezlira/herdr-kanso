// Keys from keys.json reach a view's nextCommand loop even when the view was just mounted or reloaded.
import { test } from "node:test";
import assert from "node:assert/strict";
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

async function mount(file, name, props, key, ready = () => {}) {
  const f = fixture();
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

test("the strip, the tab bar and the sidebar footer take their keys right after a reload", async () => {
  for (const [file, name, props, key] of [
    ["kanso-strip/main.js", "Strip", {}, "kanso-strip.arrange"],
    ["kanso-tabs/main.js", "Tabs", {}, "kanso-tabs.panel-1"],
    ["kanso-chrome/main.js", "WorkspaceChrome", { footer: true }, "kanso-tabs.settings"],
  ]) {
    const { keys, pressed } = await mount(file, name, props, key);
    assert.ok(pressed, `${name} listens for its keys once it is on screen`);
    assert.equal(keys.reads, 2, `${name} acts on the key and waits for the next one`);
  }
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
