import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, gpuiHost, texts, calls, find } from "./helpers.mjs";
import { paneMenu as menu } from "./menu-fixtures.mjs";

test("The menu names the pane, then keeps its groups in order", async () => {
  const { view } = await menu();
  const words = texts(view.render());
  const at = (label) => words.indexOf(label);
  assert.equal(words[0], "tests");
  for (const [a, b] of [["Split right", "Split down"], ["Split down", "Split left"], ["Split left", "Wider or narrower"], ["Wider or narrower", "Pin"], ["Pin", "Send to an agent…"],
    ["Send to an agent…", "Find in conversation"], ["Find in conversation", "Open with…"], ["Open with…", "Sleep"], ["Sleep", "Right-clicks go to the program"], ["Right-clicks go to the program", "Close pane"]]) {
    assert.ok(at(a) >= 0 && at(b) > at(a), `${a} comes before ${b}`);
  }
});

test("A pane on another computer carries its name in the title, and one with no agent has no Send, Find or Sleep", async () => {
  const { view } = await menu({ machine: "devbox", agent: false });
  const words = texts(view.render());
  assert.equal(words[0], "tests · devbox");
  for (const gone of ["Send to an agent…", "Find in conversation", "Sleep"]) assert.ok(!words.includes(gone), gone);
});

test("Close asks twice with an agent in the pane and once without", async () => {
  const cx = { notify() {}, timer: { after() {} } };
  const press = (m) => {
    const row = find(m.view.render(), (el) => calls(el, "accessibility_label").some((call) => /close/i.test(call[1])));
    calls(row, "on_click").at(-1)[1]({}, cx);
  };
  const withAgent = await menu();
  press(withAgent);
  assert.ok(!withAgent.closed.includes("pane.close"), "the first press only arms");
  assert.ok(texts(withAgent.view.render()).some((word) => /Press again to close tests/.test(word)));
  press(withAgent);
  assert.ok(withAgent.closed.includes("pane.close"));
  const plain = await menu({ agent: false });
  press(plain);
  assert.ok(plain.closed.includes("pane.close"));
});

const OVERLAY = JSON.parse(readFileSync(new URL("../kanso/mods/kanso-menu/mod.json", import.meta.url), "utf8")).overlay;
const ceiling = (height, window) => (height <= 1 ? height * window : height);

test("The pane menu opens as tall as its longest set of rows, with none cut off", async () => {
  const { menuHeight } = await load("kanso-menu/ui-menu.js", ["menuHeight"], gpuiHost());
  const { view } = await menu({ parent: { address: "T0", name: "zsh", labels: {} } });
  const { title, lines } = view.paneView({ pane: "p1", terminal: "T1" });
  const words = lines.map((line) => line.label);
  for (const row of ["Send to an agent\u2026", "Find in conversation", "Open with\u2026", "Sleep", "Send back to zsh", "Right-clicks go to the program", "Close pane"]) assert.ok(words.includes(row), row);
  const needed = menuHeight({ title, items: lines });
  assert.equal(Math.min(ceiling(OVERLAY.height, needed), needed), needed);
});

test("Each row's key hint is its chord in glyphs, as the kit writes it, not the key table's words", async () => {
  const { view } = await menu({ keys: [{ action: "kanso-strip.width", keys: "cmd-shift-enter" }, { action: "kanso-strip.new-left", keys: "cmd-alt-shift-d" }] });
  const { lines } = view.paneView({ pane: "p1", terminal: "T1" });
  const hint = (label) => lines.find((line) => line.label === label)?.hint;
  assert.equal(hint("Wider or narrower"), "\u21e7\u2318\u21a9");
  assert.equal(hint("Split left"), "\u2325\u21e7\u2318D");
  assert.equal(hint("Sleep"), null);
});
