// The switch: one size, the knob's end, and the rows that keep it.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

function chain(tag) {
  const state = { calls: [], kids: [], tag, parent: null };
  const adopt = (child) => {
    if (child && typeof child === "object") { child.parent = node; state.kids.push(child); }
  };
  const node = new Proxy(state, {
    get(_target, prop) {
      if (prop === "calls" || prop === "kids" || prop === "tag" || prop === "parent") return state[prop];
      if (prop === "when") return (condition, build) => {
        state.calls.push(["when", Boolean(condition)]);
        return condition ? build(node) : node;
      };
      if (prop === "child") return (child) => { state.calls.push(["child", child]); adopt(child); return node; };
      if (prop === "children") return (list) => { state.calls.push(["children"]); for (const child of list ?? []) adopt(child); return node; };
      return (...args) => { state.calls.push([String(prop), ...args]); return node; };
    },
    set(_target, prop, value) {
      if (prop === "parent") { state.parent = value; return true; }
      return false;
    },
  });
  return node;
}

const host = () => ({
  div: () => chain("div"),
  h_flex: () => chain("h_flex"),
  v_flex: () => chain("v_flex"),
  svg: () => chain(),
  image: () => chain(),
  Button: { new: (id) => chain(id) },
  Input: { new: () => chain() },
  Toggle: { new: (id) => { const el = chain(id); el.calls.push(["new", id]); return el; } },
});

const kit = () => load("kanso-panel/ui.js", ["toggleSwitch", "SWITCH", "H", "G", "R"], host());

const arg = (el, name) => {
  const found = el.calls.filter((call) => call[0] === name);
  assert.equal(found.length, 1, name);
  return found[0][1];
};

const day = { primary: "#3c3934", primaryText: "#f4f1eb", raised: "#faf8f4", input: "#d4cec4", muted: "#7a756c", accent: "#b8405e" };
const night = { primary: "#d8d4cb", primaryText: "#161615", raised: "#262624", input: "#353430", muted: "#949086", accent: "#da627d" };

test("A switch is one compact size, knob at the left when off and at the right when on", async () => {
  const { toggleSwitch, SWITCH, H, G } = await kit();
  const pad = (SWITCH.h - SWITCH.knob - 2) / 2;
  assert.deepEqual(Object.keys(SWITCH).sort(), ["h", "knob", "w"]);
  assert.equal(SWITCH.w, 28);
  assert.equal(SWITCH.h, 16);
  assert.equal(SWITCH.knob, 12);
  assert.equal(SWITCH.w, SWITCH.knob * 2 + pad * 2 + 2);
  for (const [checked, end] of [[false, "justify_start"], [true, "justify_end"]]) {
    const hit = toggleSwitch("mods", checked, () => {}, night);
    assert.equal(hit.tag, "mods");
    assert.equal(hit.kids.length, 1);
    const pill = hit.kids[0];
    const knob = pill.kids[0];
    assert.equal(pill.tag, "h_flex", "the pill is a flex row");
    assert.equal(knob.tag, "div");
    assert.equal(arg(hit, "h"), H.compact);
    assert.equal(arg(hit, "px"), G.xs);
    assert.equal(hit.calls.filter((call) => call[0] === "items_center").length, 1);
    assert.equal(hit.calls.some((call) => call[0] === "cursor_pointer"), true);
    assert.equal(hit.calls.some((call) => call[0] === "bg" || call[0] === "on_click"), false);
    assert.equal(pill.kids.length, 1);
    assert.equal(arg(pill, "w"), SWITCH.w);
    assert.equal(arg(pill, "h"), SWITCH.h);
    assert.equal(arg(pill, "p"), pad);
    assert.equal(pill.calls.filter((call) => call[0] === "items_center").length, 1);
    const justify = pill.calls.filter((call) => call[0] === "justify_start" || call[0] === "justify_end").map((call) => call[0]);
    assert.equal(justify.at(-1), end);
    assert.equal(pill.calls.some((call) => call[0] === "justify_end"), checked, "on carries justify_end");
    assert.equal(arg(knob, "size"), SWITCH.knob);
    assert.equal(knob.calls.some((call) => call[0] === "flex_none"), true);
    assert.equal(knob.calls.some((call) => call[0] === "ml" || call[0] === "mr"), false);
    assert.equal(pill.calls.filter((call) => call[0] === "bg").length, 1, "the pill has one fill");
    assert.equal(knob.calls.filter((call) => call[0] === "bg").length, 1, "the knob has one fill");
    assert.equal(knob.calls.some((call) => call[0] === "border_1" || call[0] === "shadow_sm"), false);
    assert.equal(pill.calls.some((call) => call[0] === "on_click" || call[0] === "on_change"), false);
    assert.equal(hit.calls.filter((call) => call[0] === "on_change").length, 1);
  }
});

test("A switch fills from the theme when on and marks focus, in light and in dark", async () => {
  const { toggleSwitch, R } = await kit();
  for (const c of [day, night]) {
    for (const checked of [false, true]) {
      let handed;
      const hit = toggleSwitch("auto", checked, (next) => { handed = next; }, c, { label: "Check for updates automatically" });
      const pill = hit.kids[0];
      const knob = pill.kids[0];
      assert.equal(arg(pill, "bg"), checked ? c.primary : c.raised);
      assert.equal(arg(pill, "border_color"), checked ? c.primary : c.input);
      assert.equal(pill.calls.filter((call) => call[0] === "border_1").length, 1);
      assert.equal(arg(hit, "rounded"), R.control);
      assert.equal(hit.calls.filter((call) => call[0] === "border_1").length, 1);
      assert.equal(arg(hit, "border_color"), "#00000000");
      assert.equal(arg(hit, "pressed"), checked);
      assert.equal(arg(hit, "accessibility_label"), "Check for updates automatically");
      assert.equal(arg(knob, "bg"), checked ? c.primaryText : c.muted);
      const focus = chain();
      arg(hit, "focus")(focus);
      assert.deepEqual(focus.calls, [["border_color", c.accent]]);
      const cx = { notify() { cx.notified = true; } };
      arg(hit, "on_change")(!checked, cx);
      assert.equal(handed, !checked);
      assert.equal(cx.notified, true);
      assert.equal(hit.calls.some((call) => call[0] === "on_click"), false);
    }
  }
});

const named = (node, id) => node.tag === id || node.calls?.some((call) => call[0] === "id" && call[1] === id);

const find = (root, id) => {
  const seen = new Set();
  const go = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (named(node, id)) return node;
    for (const kid of node.kids ?? []) {
      const found = go(kid);
      if (found) return found;
    }
    return null;
  };
  return go(root);
};

const centered = (toggle) => {
  let row = toggle.parent;
  while (row && !row.calls.some((call) => call[0] === "w_full")) row = row.parent;
  assert.equal(row?.calls.some((call) => call[0] === "items_center"), true, toggle.tag);
};

test("Settings and Spend keep each switch on its row and flip the same way", async () => {
  const store = {
    "kanso.panels.off": [],
    "kanso.panels.all": [{ id: "files", label: "Files" }],
    "kanso.hidden": [],
    "kanso.update": { autoCheck: true },
  };
  const written = [];
  const theme = {
    ...night, text: night.primary, dim: night.muted, border: night.input, canvas: "#161615",
    subtle: night.raised, popover: "#201f1d", foreground: night.primary, accent: night.accent,
  };
  const desk = {
    ...host(),
    shared: (key) => store[key],
    setShared: (key, value) => { written.push([key, value]); },
    theme: () => theme,
    keys: () => [],
    props: () => ({}),
    appHome: () => "/tmp/app",
    home: () => "/tmp",
    InputState: { new: () => ({ value() { return ""; }, on() {} }) },
  };
  const { Settings } = await load("kanso-settings/main.js", ["Settings"], desk);
  const settings = new Settings();
  settings.init({}, { focus_handle() { return { focus() {} }; }, spawn() {}, notify() {} });
  settings.news = { entries: [], error: null, from: null };
  settings.installed = "3.22.3";
  const pieces = settings.piecesPage(theme, theme);
  const files = find(pieces, "piece-panel.files-hide");
  const check = find(pieces, "piece-update.check-hide");
  centered(files);
  centered(check);
  arg(files, "on_click")({}, { notify() {} });
  assert.equal(JSON.stringify(written.at(-1)), JSON.stringify(["kanso.pieces", { "panel.files": "hide" }]));
  arg(check, "on_click")({}, { notify() {} });
  assert.equal(JSON.stringify(written.at(-1)), JSON.stringify(["kanso.pieces", { "update.check": "hide" }]));
  const up = find(pieces, "order-files--1");
  const down = find(pieces, "order-files-1");
  assert.equal(up.calls.some((call) => call[0] === "on_click"), false);
  arg(down, "on_click")();
  assert.equal(written.at(-1)[0], "kanso.panels.order");
  assert.equal(written.at(-1)[1][0], "insights");
  assert.equal(written.at(-1)[1][1], "files");
  settings.find = { value() { return "zzzz-no-piece"; }, on() {} };
  const none = settings.piecesPage(theme, theme);
  assert.ok(find(none, "pieces-none").calls.some((call) => call[0] === "child" && call[1] === "No piece matches."));

  const news = settings.newsPage(theme, theme);
  const auto = find(news, "auto-update-check");
  centered(auto);
  assert.equal(arg(auto, "accessibility_label"), "Check for updates automatically");
  arg(auto, "on_change")(false, { notify() {} });
  assert.equal(JSON.stringify(written.at(-1)), JSON.stringify(["kanso.update", { autoCheck: false }]));
  assert.ok(find(news, "check-kanso-update"));

  const { TokenSpend } = await load("kanso-spend/main.js", ["TokenSpend"], desk);
  const spend = new TokenSpend();
  spend.settings = { sources: [{ id: "pi", label: "Pi", enabled: true, roots: "~/.pi" }], pricesPath: "/tmp/prices.json" };
  spend.planInputs = [];
  spend.running = null;
  spend.queuedSources = false;
  spend.settingsNote = null;
  const sources = spend.settingsView(theme);
  const source = find(sources, "ins-source-pi");
  centered(source);
  assert.equal(arg(source, "accessibility_label"), "Pi: on");
  const cx = { notify() { cx.notified = true; } };
  arg(source, "on_change")(false, cx);
  assert.equal(spend.settings.sources[0].enabled, false);
  assert.equal(cx.notified, true);
  assert.equal(source.calls.some((call) => call[0] === "on_click"), false);
});
