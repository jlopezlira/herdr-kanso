// The dialogs' and panels' lists draw each item through the kit row, and every item still does what it did.
import test from "node:test";
import assert from "node:assert/strict";
import { load, tape, drawingHost, calls } from "./helpers.mjs";

const night = { foreground: "#d8d4cb", background: "#1b1b19", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6862", muted: "#949086" };
const cx = (seen = []) => ({ notify() {}, stop_propagation: () => seen.push("stopped"), open_url: (url) => seen.push(url), timer: { after() {} } });

test("Arrangements lists each one as a row that opens it, with Overwrite and Delete, which asks twice, under it", async () => {
  const ui = tape();
  const { Arrange, Armed } = await load("kanso-arrange/main.js", ["Arrange", "Armed"], { ...ui.host, theme: () => night, props: () => ({}), spaces: () => [], panes: () => [] });
  const arrange = new Arrange();
  const saved = { name: "Review", from: "/repo", cols: [{ panes: [{ argv: ["claude"], cwd: "/repo" }, { argv: ["npm", "run", "dev"], cwd: "/repo" }] }] };
  const done = [];
  Object.assign(arrange, { armed: new Armed(), handle: {}, space: { name: "App", folder: "/repo" }, busy: null, error: null, at: 0, others: [], view: "list", list: [saved],
    open: (a) => done.push(["open", a.name]), startSave: (_cx, a) => done.push(["overwrite", a.name]), remove: (a) => done.push(["delete", a.name]) });
  arrange.render();
  assert.ok(["Review", "Overwrite", "Delete"].every((text) => ui.texts.includes(text)), ui.texts.join(" | "));
  assert.ok(ui.texts.some((text) => text.startsWith("2 panes: ")));
  const id = [...ui.handlers.keys()].find((key) => key?.startsWith("ar-") && !key.includes("-verb-"));
  ui.handlers.get(id)({}, cx());
  ui.handlers.get(`${id}-verb-0`)({}, cx());
  ui.handlers.get(`${id}-verb-1`)({}, cx());
  assert.deepEqual(done, [["open", "Review"], ["overwrite", "Review"]], "Delete waits for its second press");
  arrange.render();
  ui.handlers.get(`${id}-verb-1`)({}, cx());
  assert.deepEqual(done.at(-1), ["delete", "Review"]);
});

test("Credits are rows with their picture, words and address, and a press opens the address", async () => {
  const ui = tape();
  const { Settings, tokens } = await load("kanso-settings/main.js", ["Settings", "tokens"], { ...ui.host, image: ui.host.div, theme: () => night, props: () => ({}) });
  const settings = new Settings();
  settings.creditsPage(night, tokens(night));
  assert.ok(["Where it comes from", "Herdr", "herdr.dev", "Made by", "JJ", "@jlopezlira on GitHub"].every((text) => ui.texts.includes(text)), ui.texts.join(" | "));
  const seen = [];
  ui.handlers.get("credit-herdr")({}, cx(seen));
  assert.deepEqual(seen, ["https://herdr.dev"]);
});

test("Look's note rows: a press writes the note again, and the remove tool drops the pin without writing", async () => {
  const ui = tape();
  const { Look, tokens } = await load("kanso-panel/look.js", ["Look", "tokens"], { ...ui.host, image: ui.host.div });
  const done = [];
  const look = Object.assign(Object.create(Look.prototype), { askNote: (i) => done.push(["ask", i]), drop: (i) => done.push(["drop", i]) });
  look.noteRow({ note: null }, 0, tokens(night));
  look.noteRow({ note: "crop the top" }, 1, tokens(night));
  assert.ok(["1", "No note yet", "2", "crop the top"].every((text) => ui.texts.includes(text)), ui.texts.join(" | "));
  ui.handlers.get("look-note-1")({}, cx());
  const seen = [];
  ui.handlers.get("look-note-0-action")({}, cx(seen));
  assert.deepEqual(done, [["ask", 1], ["drop", 0]]);
  assert.deepEqual(seen, ["stopped"], "the pin's row does not open its note too");
});

test("Settings' shortcuts are rows with their keys as key hints; a press records, and a changed one offers Reset", async () => {
  const ui = tape();
  const { Settings, Armed, tokens, GROUPS } = await load("kanso-settings/main.js", ["Settings", "Armed", "tokens", "GROUPS"], {
    ...ui.host, image: ui.host.div, theme: () => night, props: () => ({}), window: () => ({ platform: "macos" }), keys: () => [],
  });
  const settings = Object.assign(new Settings(), { capture: null, conflict: null, message: null, armed: new Armed() });
  const started = [];
  settings.startCapture = (row) => started.push(row.label);
  settings.keysPage(night, tokens(night));
  const plain = GROUPS.find((g) => !g.bar).actions[0];
  const id = `key-${plain.family ?? plain.action}`;
  assert.ok(ui.texts.includes(plain.label) && ui.texts.includes("No key"), ui.texts.join(" | "));
  assert.ok(ui.handlers.has(`${id}-action`), "unbound from what ships, it offers Reset");
  ui.handlers.get(id)({}, cx());
  assert.deepEqual(started, [plain.label]);
});

test("In Arrangements Enter opens the highlighted one only when the list holds the keyboard; on a focused Delete or Save it is that button's", async () => {
  const { Arrange, Armed } = await load("kanso-arrange/main.js", ["Arrange", "Armed"], { ...drawingHost(), theme: () => night, props: () => ({}), spaces: () => [], panes: () => [] });
  const arrange = new Arrange();
  const saved = { name: "Review", from: "/repo", cols: [{ panes: [{ argv: ["claude"], cwd: "/repo" }] }] };
  const opened = [];
  const state = { focused: false };
  Object.assign(arrange, { armed: new Armed(), handle: { is_focused: () => state.focused }, space: { name: "App", folder: "/repo" }, busy: null, error: null, at: 0, others: [], view: "list", list: [saved],
    open: (a) => opened.push(a.name) });
  const press = (key) => {
    const stopped = [];
    calls(arrange.render(), "on_key_down").forEach(([, handler]) => handler({ key, modifiers: {} }, { notify() {}, stop_propagation: () => stopped.push(key) }));
    return stopped;
  };
  assert.deepEqual([press("enter"), opened], [[], []], "focus on a button: its own press");
  state.focused = true;
  assert.deepEqual([press("enter"), opened], [["enter"], ["Review"]], "focus on the list: the highlighted arrangement opens");
});
