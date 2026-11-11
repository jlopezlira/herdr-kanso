// Kanso settings: the keys page's bookkeeping, the changelog reader and the
// shipped keys it resets to.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, clone } from "./helpers.mjs";

const actions = () => load("kanso-settings/actions.js", ["GROUPS", "HERDRS", "ofRow", "familyChords", "conflictsOf", "rebound"]);

test("A family row owns its nine actions and shows one pattern", async () => {
  const { ofRow, familyChords } = await actions();
  const { familyPattern } = await load("kanso-spaces/marks.js", ["familyPattern"]);
  const row = { family: "kanso-strip.col-" };
  assert.ok(ofRow(row, "kanso-strip.col-3"));
  assert.ok(!ofRow(row, "kanso-strip.col-10"));
  assert.ok(!ofRow(row, "kanso-strip.close"));
  assert.equal(familyPattern("cmd-alt-4"), "cmd-alt-N");
  assert.deepEqual(clone(familyChords("ctrl-shift-1")).slice(0, 3), ["ctrl-shift-1", "ctrl-shift-2", "ctrl-shift-3"]);
  assert.equal(familyChords("cmd-d"), null, "no digit to vary");
});

test("A new key says what it takes over, and keys.json comes back changed only where asked", async () => {
  const { conflictsOf, rebound } = await actions();
  const all = [
    { section: "global", keys: "cmd-p", action: "mod.open:picker" },
    { section: "layout:kanso", keys: "cmd-d", action: "kanso-strip.new-right" },
    { section: "layout:kanso", keys: "cmd-alt-shift-d", action: "terminal" },
  ];
  assert.deepEqual(clone(conflictsOf(all, "cmd-p", "kanso-strip.close")).map((k) => k.action), ["mod.open:picker"]);
  assert.deepEqual(conflictsOf(all, "cmd-d", "kanso-strip.new-right"), [], "its own binding is no conflict");
  assert.deepEqual(conflictsOf(all, "cmd-alt-shift-d", "kanso-strip.close"), [], "a key handed to the terminal is free to take");
  const doc = { global: { "cmd-p": "mod.open:picker" }, "layout:kanso": { "cmd-d": "kanso-strip.new-right", "cmd-w": "kanso-strip.close" } };
  const next = rebound(doc, "layout:kanso", { drop: ["cmd-w"], set: { "cmd-shift-x": "kanso-strip.close" } });
  assert.deepEqual(clone(next), { global: { "cmd-p": "mod.open:picker" }, "layout:kanso": { "cmd-d": "kanso-strip.new-right", "cmd-shift-x": "kanso-strip.close" } });
  assert.deepEqual(clone(doc["layout:kanso"]), { "cmd-d": "kanso-strip.new-right", "cmd-w": "kanso-strip.close" }, "the given document is left alone");
  const over = rebound(doc, "layout:kanso", { set: { "cmd-d": "kanso-strip.close" } });
  assert.equal(over["layout:kanso"]["cmd-d"], "kanso-strip.close", "a key taken over points at the new action");
});

// macOS keys taken because you asked for them: ⌘⌥h is vim's left (with
// ⌘⌥j/k/l), over Hide Others, while the Kanso layout shows.
const ASKED = new Set(["cmd-alt-h"]);

// Herdr's sidebar key on Linux and Windows (its AGENTS.md); the macOS file has cmd-b.
const ELSEWHERE = { "ctrl-shift-b": "layout.toggle:sidebar" };
const herdrKeys = () => {
  const herdr = JSON.parse(readFileSync(new URL("./herdr-keys.macos.json", import.meta.url), "utf8"));
  return new Map([...Object.values(herdr).filter((v) => v && typeof v === "object").flatMap((sec) => Object.entries(sec)), ...Object.entries(ELSEWHERE)]);
};

test("The Keys page lists Kanso's own keys only, and Reset knows them all", async () => {
  const { GROUPS, HERDRS, ofRow } = await actions();
  const herdrChords = herdrKeys();
  const { DEFAULT_KEYS } = await load("kanso-settings/defaults.js", ["DEFAULT_KEYS"]);
  const shipped = JSON.parse(readFileSync(new URL("../kanso/keys.json", import.meta.url), "utf8"));
  assert.deepEqual(clone(DEFAULT_KEYS["kanso/keys.json"]), shipped, "regenerate kanso-settings/defaults.js from kanso/keys.json");
  for (const [section, map] of Object.entries(shipped)) {
    for (const [chord, action] of Object.entries(map)) {
      if (action === "terminal") continue;
      const rows = GROUPS.filter((g) => g.section === section).flatMap((g) => g.actions);
      const listed = rows.some((r) => ofRow(r, action));
      if (HERDRS.test(action)) { assert.ok(!listed, `${action} is Herdr's command: not on Kanso's Keys page`); assert.ok(herdrChords.has(chord), `${chord} = ${action} is not on Herdr's key`); continue; }
      assert.ok(listed, `${chord} = ${action} has no row on the Keys page`);
      if (section === "layout:kanso" && !ASKED.has(chord)) assert.ok(!herdrChords.has(chord), `${chord} = ${action}: Kanso's own key on one of Herdr's`);
    }
  }
});

test("The changelog reads into versions, categories and bullets", async () => {
  const { parseChangelog, plain, compare } = await load("kanso-settings/changelog.js", ["parseChangelog", "plain", "compare"]);
  const text = "# Changelog\n\nIntro.\n\n## [2.7.0] - 2026-11-05\n\n### Added\n\n- The keys, on what they open. Tap `⌃⇧Space`.\n- New keys.\n\n### Fixed\n\n- No error.\n\n## [2.6.0] - 2026-11-05\n\n### Changed\n\n- Nothing moves while behind,\n  so an idle window draws no frames.\n";
  const log = clone(parseChangelog(text));
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], { version: "2.7.0", date: "2026-11-05", sections: [{ name: "Added", items: ["The keys, on what they open. Tap `⌃⇧Space`.", "New keys."] }, { name: "Fixed", items: ["No error."] }] });
  assert.equal(log[1].sections[0].items[0], "Nothing moves while behind, so an idle window draws no frames.", "a wrapped bullet is one line");
  assert.equal(plain("Tap `⌃⇧Space` for **all** of [them](x)."), "Tap ⌃⇧Space for all of them.");
  assert.ok(compare("2.7.0", "2.6.0") > 0 && compare("2.6.0", "2.6.0") === 0 && compare("2.6.1", "2.10.0") < 0);
});

test("A chord reads as glyphs on macOS and as names elsewhere", async () => {
  const { glyphs } = await load("kanso-spaces/marks.js", ["glyphs"], { window: () => ({ platform: "macos", active: true }), keys: () => [] });
  assert.equal(glyphs("cmd-shift-s"), "⇧⌘S");
  assert.equal(glyphs("ctrl-alt-1"), "⌃⌥1");
  assert.equal(glyphs("ctrl-shift-space"), "⌃⇧Space");
  assert.equal(glyphs("cmd-alt-left"), "⌥⌘←");
  assert.equal(glyphs("cmd-shift--"), "⇧⌘-");
  assert.equal(glyphs("cmd-shift-s", "windows"), "Shift+Win+S");
});

// Herdr's own keys (herdr-app defaults/keys.macos.json, Apache-2.0) and the
// ones macOS keeps for itself: Kanso's keys never give either another
// meaning. Where Kanso takes one of Herdr's, it is the same command done
// the strip's way (a split, going to or swapping a pane, close, zoom as the
// width, a space that is there, the sidebar hidden to its rail), or Find in the conversation, which falls
// back to the terminal's own. Everything else is a chord of Kanso's own.
const SAME_AS_HERDR = {
  "pane.split": /^kanso-strip\.new-(right|down)$/,
  "pane.close": /^kanso-strip\.close$/,
  "pane.go": /^kanso-strip\.(go|vim)-(left|right|up|down)$/,
  "pane.swap": /^(kanso-strip\.(move|vim-move)-(left|right|up|down)|terminal)$/,
  "pane.zoom": /^kanso-strip\.width$/,
  "space.select": /^kanso-spaces\.space-\d$/,
  "app.settings": /^kanso-spend\.settings$/,
  "app.help": /^mod\.open:kanso-help$/,
  "terminal.search": /^kanso-strip\.find$/,
  "layout.toggle": /^kanso-spaces\.sidebar$/,
};
const MACOS = ["cmd-alt-d", "cmd-alt-h", "cmd-h", "cmd-m", "cmd-q", "cmd-tab", "cmd-space", "cmd-alt-escape", "cmd-shift-3", "cmd-shift-4", "cmd-shift-5", "ctrl-up", "ctrl-down", "ctrl-left", "ctrl-right", "cmd-`"];

test("Kanso's keys never give Herdr's or macOS's keys another meaning", () => {
  const kanso = JSON.parse(readFileSync(new URL("../kanso/keys.json", import.meta.url), "utf8"));
  const theirs = herdrKeys();
  const wrong = [];
  for (const [section, keys] of Object.entries(kanso)) {
    for (const [chord, action] of Object.entries(keys)) {
      if (MACOS.includes(chord) && !ASKED.has(chord)) wrong.push(`${section} ${chord} is macOS's`);
      if (!theirs.has(chord) || ASKED.has(chord)) continue;
      const herdrAction = String(theirs.get(chord)).split(":")[0];
      if (!SAME_AS_HERDR[herdrAction]?.test(action)) wrong.push(`${section} ${chord}: Herdr's ${herdrAction}, Kanso's ${action}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("Settings has no Sync page", async () => {
  const { PAGES } = await load("kanso-settings/main.js", ["PAGES"]);
  assert.deepEqual(clone(PAGES.map((page) => page.key)), ["keys", "mods", "news", "credits"]);
});

const TAKEN_OVER_ON_PURPOSE = {
  "layout:kanso alt-up": ["agent.prev", "kanso-strip.go-up"],
  "layout:kanso alt-down": ["agent.next", "kanso-strip.go-down"],
};

test("Windows takes Herdr keys for the same intent, except the named agent navigation takeovers", (t) => {
  const kanso = JSON.parse(readFileSync(new URL("../kanso/keys.windows.json", import.meta.url), "utf8"));
  const herdr = JSON.parse(readFileSync(new URL("./herdr-keys.json", import.meta.url), "utf8"));
  const seen = [];
  for (const [section, bindings] of Object.entries(kanso)) {
    for (const [chord, action] of Object.entries(bindings)) {
      const original = herdr[section]?.[chord] ?? herdr.global[chord];
      if (!original) continue;
      const key = `${section} ${chord}`;
      t.diagnostic(`${key}: ${original} -> ${action}${key in TAKEN_OVER_ON_PURPOSE ? " (taken over on purpose)" : " (same intent)"}`);
      if (key in TAKEN_OVER_ON_PURPOSE) {
        assert.deepEqual([original, action], TAKEN_OVER_ON_PURPOSE[key]);
        seen.push(key);
      } else {
        assert.match(action, SAME_AS_HERDR[original.split(":")[0]] ?? /^$/, key);
        const direction = original.split(":")[1];
        if (direction && /^(pane\.go|pane\.swap|pane\.split|space\.select)/.test(original)) assert.ok(action.endsWith(`-${direction}`), `${key}: same direction or space`);
      }
    }
  }
  assert.deepEqual(seen.toSorted(), Object.keys(TAKEN_OVER_ON_PURPOSE).toSorted());
});

test("Settings compares and resets to this platform's shipped bindings", async () => {
  const { DEFAULT_KEYS } = await load("kanso-settings/defaults.js", ["DEFAULT_KEYS"]);
  const windows = JSON.parse(readFileSync(new URL("../kanso/keys.windows.json", import.meta.url), "utf8"));
  assert.deepEqual(clone(DEFAULT_KEYS["kanso/keys.windows.json"]), windows, "regenerate defaults with node scripts/sync-keys.mjs");
  for (const platform of ["macos", "linux", "windows"]) {
    const { Settings } = await load("kanso-settings/main.js", ["Settings"], { window: () => ({ platform }) });
    const settings = new Settings(), row = { action: "kanso-strip.new-right" }, section = "layout:kanso";
    const chord = platform === "windows" ? "ctrl-shift-o" : "cmd-d";
    assert.deepEqual(clone(settings.shipped(row, section)), [chord]);
    const user = { [section]: { "shift-f1": row.action, "ctrl-9": "mine" }, global: { f1: "mine.help" } };
    settings.change = (_cx, apply) => {
      const next = apply(user);
      assert.deepEqual(clone(next), { [section]: { "ctrl-9": "mine", [chord]: row.action }, global: user.global });
    };
    settings.reset(row, section, {});
    assert.deepEqual(clone(settings.shipped({ family: "kanso-spaces.space-" }, section)), [platform === "windows" ? "alt-N" : "ctrl-N"]);
  }
});
