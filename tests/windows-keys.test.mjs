import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shippedKeymap } from "../kanso/mods/kanso-panel/platform-keymap.js";

const read = (file) => readFileSync(new URL(`../kanso/${file}`, import.meta.url), "utf8");

test("Only Windows selects the Windows shipped keymap", () => {
  for (const platform of ["macos", "linux", "windows"]) assert.equal(shippedKeymap(platform), `kanso/${platform === "windows" ? "keys.windows.json" : "keys.json"}`);
});

test("Windows keys cover exactly the shipped actions without Command, AltGr or plain Ctrl letters", () => {
  const source = read("keys.windows.json"), windows = JSON.parse(source), mac = JSON.parse(read("keys.json"));
  assert.deepEqual(Object.keys(windows), Object.keys(mac));
  for (const [section, bindings] of Object.entries(windows)) {
    assert.deepEqual([...new Set(Object.values(bindings))].sort(), [...new Set(Object.values(mac[section]))].sort(), section);
    for (const chord of Object.keys(bindings)) {
      const parts = chord.split("-");
      assert.ok(!parts.includes("cmd"), chord);
      assert.ok(!(parts.includes("ctrl") && parts.includes("alt")), chord);
      assert.ok(!/^ctrl-[a-z]$/.test(chord), chord);
    }
  }
  const sections = source.matchAll(/"([^"\n]+)": \{([^}]+)\}/g);
  for (const [, section, body] of sections) {
    const chords = [...body.matchAll(/"([^"\n]+)":/g)].map((m) => m[1]);
    assert.equal(new Set(chords).size, chords.length, `${section}: duplicate chord`);
  }
  assert.equal(windows["layout:kanso"]["ctrl-shift-/"], "mod.open:kanso-help");
  assert.equal(windows["layout:kanso"]["ctrl-shift-?"], "mod.open:kanso-help");
});
