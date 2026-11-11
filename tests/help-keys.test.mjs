import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, clone, tape } from "./helpers.mjs";

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
  const { guideSections } = await load("kanso-help/guide.js", ["guideSections"]);
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
  const { guideSections } = await load("kanso-help/guide.js", ["guideSections"]);
  const sections = clone(guideSections([], "windows", "/custom"));
  assert.equal(sections[0][1][0], "Every pane sits in a row you slide along, each one wide enough to read. Open a pane to the right or below it in the same column.");
  const text = linesOf(sections);
  assert.doesNotMatch(text, /\(\)|undefined|null|Ctrl\+|Alt\+/);
});

test("Help's keyboard and Guide render the current platform and bindings", async () => {
  for (const platform of ["windows", "macos"]) {
    const ui = tape(), bindings = bindingsOf(platform);
    const { Help } = await load("kanso-help/main.js", ["Help"], {
      ...ui.host, window: () => ({ platform }), keys: () => bindings, appHome: () => "/actual/config", home: () => "/users/jo", props: () => ({}),
      Companion: class { load() {} },
    });
    const help = new Help();
    help.init({}, { focus_handle: () => ({ focus() {} }), timer: { every() {} } });
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
  const { guideSections } = await load("kanso-help/guide.js", ["guideSections"]);
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
    const ui = tape();
    const { Help } = await load("kanso-help/main.js", ["Help"], {
      ...ui.host, window: () => ({ platform }), keys: () => [], appHome: () => folder, home: () => userHome,
    });
    new Help().guidePage({}, {});
    const pathLine = ui.texts.find((text) => text.startsWith("Your settings folder"));
    assert.ok(pathLine.includes(`${expected}:`), pathLine);
  }
});
