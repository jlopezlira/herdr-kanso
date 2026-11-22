import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, clone, gpuiHost, texts, calls, find } from "./helpers.mjs";
import { paneMenu as menu } from "./menu-fixtures.mjs";
import { loadStripWith } from "./mod-fixtures.mjs";

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

test("Sleep and Send each open one overlay, the same from the pane's menu and from its header", async () => {
  const { sendOverlay, sleepOverlay } = await load("kanso-strip/launch.js", ["sendOverlay", "sleepOverlay"], gpuiHost());
  const send = clone(sendOverlay({ pane: "p1" })), sleep = clone(sleepOverlay({ space: "s1", tab: "t1", pane: "p1" }));
  assert.deepEqual(send, { mod: "kanso-send", kind: "dialog", width: 480, props: { pane: "p1" } });
  assert.deepEqual(sleep, { mod: "kanso-sleep", kind: "dialog", width: 480, props: { sleep: { scope: "agent", space: "s1", tab: "t1", pane: "p1" } } });

  const fromMenu = await menu();
  const item = (label) => find(fromMenu.view.render(), (el) => calls(el, "accessibility_label").some((call) => call[1] === label));
  for (const label of ["Send to an agent\u2026", "Sleep"]) calls(item(label), "on_click").at(-1)[1]({}, { notify() {} });
  assert.deepEqual(clone(fromMenu.opened), [send, sleep]);

  const opened = [];
  const agent = { tab: "t1", status: "idle", program: { agent: true } };
  const { Strip } = await loadStripWith({ pane: "p1" }, [{ ...agent, pane: "p1", terminal: "T1", focused: true }, { ...agent, pane: "p2", terminal: "T2" }], {},
    { spaces: () => [{ id: "s1", tabs: [{ id: "t1" }] }], agents: () => [{ address: "T1" }], openOverlay: (spec) => opened.push(spec) });
  const head = new Strip();
  head.init({}, {});
  const root = head.render();
  for (const tag of ["ph-send-p1", "ph-sleep-p1"]) calls(find(root, (el) => el.tag === tag), "on_click").at(-1)[1]({}, { stop_propagation() {}, notify() {} });
  assert.deepEqual(clone(opened), [send, sleep]);
});

test("In the pane menu Enter runs the highlighted row only when the list holds the keyboard; on a focused row it is that row's", async () => {
  const { view, closed } = await menu();
  const keys = (key, stopped) => calls(view.render(), "on_key_down").at(-1)[1]({ key, modifiers: {} }, { notify() {}, stop_propagation: () => stopped.push(key) });
  const stopped = [];
  view.handle = { is_focused: () => true };
  keys("j", []);
  view.handle = { is_focused: () => false };
  keys("enter", stopped);
  assert.deepEqual([closed, stopped], [[], []], "focus on a row: nothing runs, the row's own press goes through");
  view.handle = { is_focused: () => true };
  keys("enter", stopped);
  assert.deepEqual([closed.includes("closeOverlay"), closed.includes("terminal.copy"), stopped.at(-1)], [true, true, "enter"], "focus on the list: the highlighted Copy runs");
});

test("The pane menu leads with Copy, Cut and Paste: Copy always, since an agent draws its own selection, Cut never in a terminal, and each acts on that terminal", async () => {
  const cx = { notify() {}, timer: { after() {} } };
  const row = (view, label) => find(view.render(), (el) => calls(el, "accessibility_label").some((call) => call[1] === label));
  const disabled = (el) => calls(el, "disabled").at(-1)?.[1] === true;
  const plain = await menu();
  const words = texts(plain.view.render());
  assert.deepEqual(["Copy", "Cut", "Paste"].map((label) => words.indexOf(label)), [1, 2, 3], "first, after the title");
  assert.ok(words.indexOf("Paste") < words.indexOf("Split right"));
  assert.deepEqual([disabled(row(plain.view, "Copy")), disabled(row(plain.view, "Cut")), disabled(row(plain.view, "Paste"))], [false, true, false]);
  calls(row(plain.view, "Paste"), "on_click").at(-1)[1]({}, cx);
  assert.deepEqual(plain.closed, ["closeOverlay", "pane.focus", "terminal.paste"]);
  const copy = await menu();
  calls(row(copy.view, "Copy"), "on_click").at(-1)[1]({}, cx);
  assert.deepEqual(copy.closed, ["closeOverlay", "pane.focus", "terminal.copy"]);
});

test("Copy and Paste on a terminal shown outside a pane, as a peek, act on it without focusing a pane", async () => {
  const cx = { notify() {}, timer: { after() {} } };
  const row = (view, label) => find(view.render(), (el) => calls(el, "accessibility_label").some((call) => call[1] === label));
  for (const [label, command] of [["Copy", "terminal.copy"], ["Paste", "terminal.paste"]]) {
    const peek = await menu({ target: { pane: "term-peek", terminal: "T1" }, pane: { terminal: "T9" } });
    calls(row(peek.view, label), "on_click").at(-1)[1]({}, cx);
    assert.deepEqual(peek.closed, ["closeOverlay", command], label);
  }
});
