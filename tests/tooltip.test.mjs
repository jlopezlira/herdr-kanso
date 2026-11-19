// The tooltip: Herdr's `.tooltip()` takes only a string, so the kit's tooltip is words, its chord read from the key table.
import test from "node:test";
import assert from "node:assert/strict";
import { load, repoText } from "./helpers.mjs";
import { outsideKit } from "./mod-sources.mjs";
import { SHARED } from "../scripts/sync-share.mjs";

const BINDINGS = [
  { section: "app", keys: "cmd-shift-p", action: "app.palette" },
  { section: "layout:kanso", keys: "ctrl-alt-s", action: "kanso-spaces.view-agents" },
  { section: "layout:kanso", keys: "cmd-shift--", action: "kanso-strip.fewer" },
];
const host = (platform) => ({ window: () => ({ platform }), keys: () => BINDINGS });
const kit = async (platform = "macos") => ({
  ...await load("kanso-panel/kit.js", ["tooltip"], host(platform)),
  ...await load("kanso-panel/ui-tooltip.js", ["boundChord"], host(platform)),
});

const STATES = {
  "the label alone": [{ label: "More" }, "More"],
  "with its detail": [{ label: "Adding up", detail: "14 repositories to go" }, "Adding up · 14 repositories to go"],
  "with its chord": [{ label: "Command palette", chord: "cmd-shift-p" }, "Command palette ⇧⌘P"],
  "with chord and detail": [{ label: "2 per view", chord: "cmd-shift-0", detail: "click to even out" }, "2 per view ⇧⌘0 · click to even out"],
};

for (const [state, [props, words]] of Object.entries(STATES)) {
  test(`Tooltip, ${state}: the app writes its words`, async () => {
    const { tooltip } = await kit();
    assert.equal(tooltip(props), words);
  });
}

test("A tooltip's chord is written as this computer writes it", async () => {
  assert.equal((await kit("windows")).tooltip({ label: "Command palette", chord: "cmd-shift-p" }), "Command palette Shift+Win+P");
  assert.equal((await kit("linux")).tooltip({ label: "Agents", chord: "ctrl-alt-s" }), "Agents Ctrl+Alt+S");
});

test("The chord comes from the key table, and an action with no key shows none", async () => {
  const { tooltip, boundChord } = await kit();
  assert.equal(boundChord("app.palette"), "cmd-shift-p");
  assert.equal(boundChord("kanso-spaces.view-threads"), "");
  assert.equal(tooltip({ label: "Agents", chord: boundChord("kanso-spaces.view-agents") }), "Agents ⌃⌥S");
  assert.equal(tooltip({ label: "Threads", chord: boundChord("kanso-spaces.view-threads") }), "Threads");
});

test("The tooltip takes label, detail and chord, and throws on anything else", async () => {
  const { tooltip } = await kit();
  assert.throws(() => tooltip({ label: "More", key: "⌘K" }), /label, detail and chord, not key/);
  assert.throws(() => tooltip({ text: "More" }), /not text/);
});

// Every mod source but the kit (kit.js and its ui-*.js drawing files, which pass on the words a caller made).
const sources = outsideKit;

test("Outside the kit, every .tooltip( takes the kit's tooltip, never a string written at the call", () => {
  const loose = sources().flatMap((file) => [...repoText(file).matchAll(/\.tooltip\((?!tooltip\()/g)].map((m) => `${file}: ${repoText(file).slice(m.index, m.index + 60)}`));
  assert.deepEqual(loose, []);
});

test("No tooltip writes a chord by hand: the old hand-written tips and the view switch's own key table are gone", () => {
  for (const [file, gone] of [
    ["kanso/mods/kanso-status/model.js", ["paletteTip", "⌘⇧P", "Ctrl+Shift+P"]],
    ["kanso/mods/kanso-status/main.js", ["paletteTip"]],
    ["kanso/mods/kanso-tabs/main.js", ["⌥⌘T", "⌘⇧/", "⌃⇧,", "Ctrl+Shift+"]],
    ["kanso/mods/kanso-spaces/sidebar-rows.js", ["VIEW_CHORDS", "viewChord"]],
    ["kanso/mods/kanso-spaces/main.js", ["viewChord", "glyphs("]],
  ]) for (const text of gone) assert.equal(repoText(file).includes(text), false, `${file} still has ${text}`);
  const glyph = /["'`][^"'`\n]*[⌘⌥⇧⌃][^"'`\n]*["'`]/;
  const tipLines = sources().flatMap((file) => repoText(file).split("\n").filter((line) => /\.tooltip\(|\btip\s*[:=]/.test(line) && glyph.test(line)).map((line) => `${file}: ${line.trim()}`));
  assert.deepEqual(tipLines, []);
});

test("The view switch, the palette, the tab bar's tools and the strip's stepper read their chords from the key table", () => {
  const uses = {
    "kanso/mods/kanso-spaces/main.js": ["boundChord(`kanso-spaces.view-${key}`)"],
    "kanso/mods/kanso-status/main.js": ["boundChord(PALETTE_COMMAND)"],
    "kanso/mods/kanso-tabs/main.js": ['boundChord("kanso-strip.arrange")', 'boundChord("mod.open:kanso-help")'],
    "kanso/mods/kanso-strip/main.js": ['boundChord("kanso-strip.fewer")', 'boundChord("kanso-strip.more")', 'boundChord("kanso-strip.fit")'],
    "kanso/mods/kanso-spaces/needs-you-view.js": ["boundChord(NEXT_NEEDS)"],
  };
  for (const [file, calls] of Object.entries(uses)) for (const call of calls) assert.ok(repoText(file).includes(call), `${file} calls ${call}`);
  const bound = new Set(Object.values(JSON.parse(repoText("kanso/keys.json"))).flatMap((section) => Object.values(section)));
  for (const action of ["kanso-strip.arrange", "mod.open:kanso-help", "kanso-tabs.settings", "kanso-strip.fewer", "kanso-strip.more", "kanso-strip.fit", "kanso-spaces.needs-you.next", "kanso-spaces.view-spaces", "kanso-spaces.view-agents", "kanso-spaces.view-threads"]) {
    assert.ok(bound.has(action), `keys.json binds ${action}`);
  }
});

test("Every copy of ui-tooltip.js is its source", () => {
  const entry = SHARED.find(({ source }) => source === "kanso/mods/kanso-panel/ui-tooltip.js");
  assert.ok(entry?.copies.length, "ui-tooltip.js is shared");
  for (const copy of entry.copies) assert.equal(repoText(copy), repoText(entry.source), copy);
});
