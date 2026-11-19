import { loadGuideSections, loadHelp, keyDown } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, clone, tape, drawingHost, keyboard, calls, KIT_NIGHT } from "./helpers.mjs";

const bindingsOf = (platform) => Object.entries(JSON.parse(readFileSync(new URL(`../kanso/keys${platform === "windows" ? ".windows" : ""}.json`, import.meta.url), "utf8")))
  .flatMap(([section, map]) => Object.entries(map).map(([keys, action]) => ({ section, keys, action })));
const linesOf = (sections) => sections.flatMap(([, lines]) => lines).join("\n");

test("Help names Windows modifiers and preserves macOS glyphs", async () => {
  const { modifierLabels } = await load("kanso-help/guide.js", ["modifierLabels"]);
  const windows = modifierLabels("windows"), mac = modifierLabels("macos");
  assert.equal(["ctrl", "alt", "shift"].map((m) => windows.MOD_GLYPH[m]).join(windows.join), "Ctrl+Alt+Shift");
  assert.equal(["ctrl", "alt", "shift", "cmd"].map((m) => mac.MOD_GLYPH[m]).join(mac.join), "⌃⌥⇧⌘");
  assert.equal(mac.MOD_WORD.cmd, "Command");
});

test("The Guide reads its chords by action from live keys on every platform", async () => {
  const { guideSections } = await loadGuideSections();
  for (const platform of ["windows", "macos", "linux"]) {
    const bindings = bindingsOf(platform), home = platform === "windows" ? "C:\\Users\\Jo\\AppData\\Roaming\\herdr-app" : "/custom/herdr";
    const text = linesOf(guideSections(bindings, platform, home));
    assert.ok(text.includes(home));
    assert.ok(!text.includes("~/.config/herdr-app"));
    assert.ok(text.includes(platform === "macos" ? "⌘D" : platform === "windows" ? "Ctrl+Shift+O" : "Super+D"));
    assert.ok(text.includes(platform === "macos" ? "⌘J" : platform === "windows" ? "Ctrl+Shift+J" : "Super+J"));
    if (platform === "windows") assert.doesNotMatch(text, /[⌘⌃⌥⇧]/);
    const rebound = bindings.map((b) => ({ ...b, keys: "shift-f12" }));
    const reboundText = linesOf(guideSections(rebound, platform, home));
    assert.ok(reboundText.includes(platform === "macos" ? "⇧f12" : "Shift+f12"));
    assert.ok(!reboundText.includes("Ctrl+Shift+O") && !reboundText.includes("⌘D"));
  }
});

test("An unbound Guide action leaves a complete sentence with no chord", async () => {
  const { guideSections } = await loadGuideSections();
  const sections = clone(guideSections([], "windows", "/custom"));
  assert.equal(sections[0][1][0], "Every pane sits in a row you slide along, each one wide enough to read. Open a pane to the right or below it in the same column.");
  const text = linesOf(sections);
  assert.doesNotMatch(text, /\(\)|undefined|null|Ctrl\+|Alt\+/);
});

async function openHelp(platform, bindings, { folder = "/actual/config", userHome = "/users/jo", ui = tape(), keyboard: held = { onPage: true } } = {}) {
  const { Help } = await loadHelp({
    ...ui.host, window: () => ({ platform }), keys: () => bindings, appHome: () => folder, home: () => userHome, props: () => ({}),
    Companion: class { load() {} },
  });
  const help = new Help();
  help.init({}, { focus_handle: () => ({ focus() { held.onPage = true; }, is_focused: () => held.onPage }), timer: { every() {} } });
  return { ui, help };
}

test("Help's keyboard and Guide render the current platform and bindings", async () => {
  for (const platform of ["windows", "macos"]) {
    const { ui, help } = await openHelp(platform, bindingsOf(platform));
    assert.deepEqual(clone(help.mods), platform === "windows" ? ["alt"] : ["cmd", "alt"]);
    help.keysPage({}, {});
    help.guidePage({}, {});
    const text = ui.texts.join("\n");
    assert.ok(text.includes("/actual/config"));
    if (platform === "windows") {
      assert.doesNotMatch(text, /[⌘⌃⌥⇧]/);
      assert.ok(ui.texts.includes("Ctrl") && ui.texts.includes("Alt") && ui.texts.includes("Shift"));
    } else assert.ok(ui.texts.includes("⌘ Command"));
  }
});

test("The Guide shows each family once and shares modifiers across a run", async () => {
  const { guideSections } = await loadGuideSections();
  for (const [platform, vim, columns, panels] of [
    ["macos", "⌥⌘H J K L", "⌃⌥1–9", "⌃⇧1–9"],
    ["windows", "Alt+H J K L", "Alt+Shift+1–9", "Ctrl+Shift+1–9"],
  ]) {
    const sections = guideSections(bindingsOf(platform), platform, "/config");
    const strip = sections[0][1][1], panel = sections[2][1][0];
    assert.ok(strip.includes(`(${vim})`), strip);
    assert.ok(strip.includes(`Jump to a column (${columns})`), strip);
    assert.ok(panel.includes(`Open them by place (${panels})`), panel);
    assert.doesNotMatch(strip, /⌥2|Shift\+2/);
    assert.doesNotMatch(panel, /⇧2|Shift\+2/);
  }
});

test("Help reuses the shared modifier tables, including Linux's Super key", async () => {
  const { modifierLabels, modifierGlyphs } = await load("kanso-help/guide.js", ["modifierLabels", "modifierGlyphs"]);
  for (const platform of ["windows", "linux", "macos"]) assert.equal(modifierLabels(platform).MOD_GLYPH, modifierGlyphs(platform));
  assert.equal(modifierLabels("linux").MOD_WORD.cmd, "Super");
  assert.equal(modifierLabels("windows").MOD_WORD.cmd, "Win");
});

test("A rebound Guide run repeats modifiers only when they change", async () => {
  const { chordRun, familyPattern, shownChord, glyphs } = await load("kanso-spaces/marks.js", ["chordRun", "familyPattern", "shownChord", "glyphs"]);
  for (const platform of ["macos", "windows", "linux"]) assert.equal(chordRun(["cmd-alt-t"], platform), glyphs("cmd-alt-t", platform));
  assert.equal(chordRun(["alt-h", "alt-j", "ctrl-k", "alt-l"], "windows"), "Alt+H J, Ctrl+K, Alt+L");
  assert.equal(chordRun(["cmd-alt-h", "alt-j", "cmd-alt-k", "cmd-alt-l"], "macos"), "⌥⌘H, ⌥J, ⌥⌘K L");
  assert.equal(chordRun(["cmd-alt-h", "alt-cmd-j"], "macos"), "⌥⌘H J");
  assert.equal(chordRun(["alt--", "alt-="], "windows"), "Alt+- =");
  assert.equal(chordRun(["cmd-alt-h", "cmd-alt-h"], "macos"), "⌥⌘H");
  assert.equal(shownChord(familyPattern("ctrl-alt-4"), "macos"), "⌃⌥1–9");
  assert.equal(shownChord(familyPattern("ctrl-shift-4"), "windows"), "Ctrl+Shift+1–9");
});

test("The Guide shortens the actual settings folder only when it is under home", async () => {
  for (const [platform, userHome, folder, expected] of [
    ["macos", "/Users/jo", "/Users/jo/.config/herdr-app", "~/.config/herdr-app"],
    ["windows", "C:\\Users\\Jo", "C:\\Users\\Jo\\AppData\\Roaming\\herdr-app", "~\\AppData\\Roaming\\herdr-app"],
    ["macos", "/Users/jo", "/custom/herdr", "/custom/herdr"],
  ]) {
    const { ui, help } = await openHelp(platform, [], { folder, userHome });
    help.guidePage({}, {});
    const pathLine = ui.texts.find((text) => text.startsWith("Your settings folder"));
    assert.ok(pathLine.includes(`${expected}:`), pathLine);
  }
});

test("Help's key list is a row per key, the action then its chord as a key hint, and a press picks that key", async () => {
  const { ui, help } = await openHelp("macos", bindingsOf("macos"));
  help.keysPage({}, {});
  const id = [...ui.handlers.keys()].find((key) => key?.startsWith("row-"));
  assert.ok(id, "a key row is drawn");
  ui.handlers.get(id)({}, { notify() {} });
  assert.equal(help.picked, id.slice("row-".length));
});

const drawnHelp = async (over = {}) => {
  const held = { onPage: true };
  const { help } = await openHelp("macos", bindingsOf("macos"), { ui: { host: { ...drawingHost(), theme: () => KIT_NIGHT, ...over } }, keyboard: held });
  return { help, held };
};

const PRESS = [
  ["keys", "escape", [], false, "close", true], ["guide", "escape", [], true, "close", true],
  ["keys", "j", [], false, "pick", true], ["keys", "j", [], true, "pick", true],
  ["keys", "enter", [], false, "pick", true], ["keys", "space", [], false, "pick", true], ["keys", "return", [], false, "pick", true],
  ["keys", "enter", [], true, null, false], ["keys", "space", [], true, null, false],
  ["keys", "space", ["shift"], true, "pick", true], ["keys", "enter", ["shift"], true, "pick", true], ["keys", "space", ["function"], true, "pick", true],
  ["keys", "enter", ["platform"], true, "pick", true], ["keys", "space", ["alt"], true, "pick", true],
  ["keys", "tab", [], false, "pick", false], ["keys", "tab", ["shift"], false, "pick", false], ["keys", "tab", ["control"], false, "pick", true], ["keys", "tab", ["function"], true, "pick", true],
  ["keys", "tab", [], true, null, false], ["keys", "tab", ["shift"], true, null, false],
  ["keys", "shift", [], false, null, false], ["keys", "platform", [], false, null, false],
  ["dojo", "enter", [], false, "dojo", true], ["dojo", "enter", [], true, null, false], ["dojo", "enter", ["shift"], true, "dojo", true],
  ["dojo", "return", [], false, null, false], ["dojo", "j", [], false, null, false],
  ["guide", "enter", [], false, null, false], ["guide", "j", [], false, null, false],
];

test("A key on Help closes it, enters the dōjō, shows that key, or is left to the control that holds the keyboard only when it is that control's own unmodified key", async () => {
  const { keyPress, keyName } = await load("kanso-help/main.js", ["keyPress", "keyName"], tape().host);
  for (const [page, key, held, onControl, does, stop] of PRESS) {
    assert.deepEqual(clone(keyPress({ page, key, held, onControl })), { does, stop }, `${page}, ${[...held, key].join("-")}, ${onControl ? "on a control" : "on the page"}`);
  }
  assert.deepEqual(["Return", " ", "J", "Tab", undefined].map(keyName), ["enter", "space", "j", "tab", ""]);
});

test("On a focused control a modified Enter or Space still does what the page did: it shows the key and the layer, or enters the dōjō", async () => {
  const { help, held } = await drawnHelp();
  held.onPage = false;
  const press = (key, modifiers) => help.key({ key, modifiers }, { notify() {}, stop_propagation() {}, timer: { after() {} } });
  press("space", { shift: true });
  assert.deepEqual([help.picked, clone(help.mods)], ["space", ["shift"]], "Shift+Space shows Space on the Shift layer");
  press("enter", { platform: true });
  assert.deepEqual([help.picked, clone(help.mods)], ["enter", ["cmd"]], "Command+Enter shows Enter on the Command layer");
  help.picked = "j";
  press("space", { function: true });
  assert.equal(help.picked, "space", "Fn+Space shows Space");
  help.picked = "j";
  press("space", {});
  assert.equal(help.picked, "j", "unmodified Space is the control's");
  const opened = [];
  const { help: dojo } = await drawnHelp({ closeOverlay() {}, run: (name, args) => opened.push([name, args]) });
  dojo.page = "dojo";
  dojo.key({ key: "enter", modifiers: { shift: true } }, { notify() {}, stop_propagation() {} });
  assert.deepEqual(clone(opened), [["mod.open", { name: "kanso-dojo" }]], "Shift+Enter still enters the dōjō from the dōjō page");
  dojo.key({ key: "return", modifiers: {} }, { notify() {}, stop_propagation() {} });
  assert.equal(opened.length, 1, "a raw return does not");
});

test("Tab reaches every chip, key and row of Help's keyboard, each with the kit's ring, and Enter and Space press it while every other key still shows itself", async () => {
  const { help, held } = await drawnHelp();
  const cx = { notify() {}, timer: { after() {} } };
  const walk = () => {
    const keys = keyboard(help.render());
    return { keys, to: (id) => { held.onPage = false; for (let n = 0; n < keys.stops.length; n += 1) if (keys.tab().tag === id) return keys.stops.find((stop) => stop.tag === id); return assert.fail(`Tab never reaches ${id}`); } };
  };
  const first = walk();
  const tags = first.keys.stops.map((stop) => stop.tag);
  for (const id of ["mod-ctrl", "mod-alt", "mod-shift", "mod-cmd", "mod-lists", "cap-j-2-7", "cap-shift-3-0", "cap-space-4-3", "cap-enter-2-12", "row-h"]) assert.ok(tags.includes(id), `${id} is a Tab stop`);
  assert.equal(tags.filter((tag) => tag.startsWith("cap-")).length, 63, "every key of the board");
  for (const id of ["mod-shift", "cap-j-2-7", "row-h"]) assert.ok(calls(first.to(id), "focus").length > 0, `${id}: its ring`);

  for (const key of ["enter", "space"]) {
    help.mods = ["cmd", "alt"]; help.picked = "h";
    const chip = walk();
    chip.to("mod-shift");
    chip.keys.key(key, cx);
    assert.deepEqual(clone(help.mods), ["alt", "shift", "cmd"], `${key} on the Shift chip holds Shift`);
    assert.equal(help.picked, "h", `${key} went to the chip, not to the board`);
    const cap = walk();
    cap.to("cap-j-2-7");
    cap.keys.key(key, cx);
    assert.equal(help.picked, "j", `${key} on the J key picks it`);
    const mod = walk();
    mod.to("cap-shift-3-0");
    mod.keys.key(key, cx);
    assert.deepEqual(clone(help.mods), ["alt", "cmd"], `${key} on the Shift key lets Shift go`);
    const lists = walk();
    lists.to("mod-lists");
    lists.keys.key(key, cx);
    assert.deepEqual([help.lists, clone(help.mods), help.picked], [true, [], "j"], `${key} on Lists shows the list keys`);
    const row = walk();
    row.to("row-g");
    row.keys.key(key, cx);
    assert.equal(help.picked, "g", `${key} on a row picks its key`);
    help.lists = false;
  }

  const letter = walk();
  letter.to("cap-j-2-7");
  letter.keys.key("k", cx);
  assert.equal(help.picked, "k", "with a key focused, any other key still shows itself");
});

test("With the keyboard on Help's page every key shows itself, Tab too, and a pointer press gives the keyboard back to the page", async () => {
  const { help, held } = await drawnHelp();
  const lit = [];
  const press = (key) => {
    const stopped = [];
    keyDown(help.render(), { key, modifiers: {} }, { notify() {}, stop_propagation: () => stopped.push(key), timer: { after: (ms) => lit.push(ms) } });
    return stopped.length > 0;
  };
  assert.deepEqual([press("enter"), help.picked], [true, "enter"]);
  assert.deepEqual([press(" "), help.picked], [true, "space"]);
  assert.deepEqual([press("tab"), help.picked], [false, "tab"], "Tab shows itself and still moves the keyboard on");
  held.onPage = false;
  assert.deepEqual([press("enter"), press(" "), press("tab"), help.picked], [false, false, false, "tab"], "on a control they are the control's");
  calls(help.render(), "on_mouse_up").forEach(([, , release]) => release({}, {}));
  assert.equal(held.onPage, true);
  assert.deepEqual([press(" "), help.picked], [true, "space"], "after a pointer press Space shows itself again");
});
