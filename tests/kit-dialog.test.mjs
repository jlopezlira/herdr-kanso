// The dialog piece: its title, scope, notes and footer, and Cancel and Escape through one handler.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, numberArguments, clone } from "./helpers.mjs";

const night = { foreground: "#d8d4cb", background: "#1b1b19", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", popover: "#20201e" };
const kit = async () => {
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"], gpuiHost());
  const { dialog, statusNotes } = await load("kanso-panel/ui-dialog.js", ["dialog", "statusNotes"], gpuiHost());
  return { dialog, statusNotes, c: tokens(night) };
};
const all = (el) => [el, ...el.kids.flatMap(all)];
const texts = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const button = (el, id) => all(el).find((kid) => kid.tag === id);
const called = (el, name) => el?.calls.filter((call) => call[0] === name).map((call) => call.slice(1)) ?? [];
const press = (el, id) => called(button(el, id), "on_click").forEach(([handler]) => handler({}, {}));
const key = (el, name) => {
  const stopped = [];
  called(el, "on_key_down").forEach(([handler]) => handler({ key: name }, { stop_propagation: () => stopped.push(name) }));
  return stopped;
};

test("A dialog shows its title, scope, notes, then Cancel before the one primary", async () => {
  const { dialog, c } = await kit();
  const el = dialog("d", c, { title: "Send to an agent", scope: "From checkout", notes: [{ text: "Pasted into its terminal" }, { text: "Not sent", tone: "error" }], secondary: "Cancel", primary: "Send" });
  const words = texts(el);
  assert.deepEqual(["Send to an agent", "From checkout", "Pasted into its terminal", "Not sent", "Cancel", "Send"].map((word) => words.indexOf(word) >= 0), Array(6).fill(true));
  assert.ok(words.indexOf("Cancel") < words.indexOf("Send"));
  assert.ok(all(el).some((kid) => called(kid, "text_color").some(([ink]) => ink === c.blocked)), "an error note takes the blocked colour");
});

test("Cancel and Escape run the same handler, and other keys go to the dialog's own", async () => {
  const { dialog, c } = await kit();
  const hits = [];
  const el = dialog("d", c, { title: "Rename", secondary: "Cancel", primary: "Save", onCancel: () => hits.push("cancel"), onPrimary: () => hits.push("save"), onKey: (e) => hits.push(e.key) });
  press(el, "d-secondary");
  press(el, "d-primary");
  assert.deepEqual(key(el, "escape"), ["escape"]);
  key(el, "j");
  assert.deepEqual(hits, ["cancel", "save", "cancel", "j"]);
});

test("A dialog without Cancel still closes on Escape, and a held one keeps Escape and Cancel until its work ends", async () => {
  const { dialog, c } = await kit();
  const hits = [];
  const bare = dialog("d", c, { title: "Wake", onCancel: () => hits.push("closed") });
  assert.equal(button(bare, "d-secondary"), undefined);
  key(bare, "escape");
  assert.deepEqual(hits, ["closed"]);
  const held = dialog("d", c, { title: "Sleep", secondary: "Cancel", held: true, onCancel: () => hits.push("again") });
  assert.deepEqual(key(held, "escape"), []);
  assert.deepEqual(called(button(held, "d-secondary"), "disabled"), [[true]]);
  assert.deepEqual(hits, ["closed"]);
});

test("The primary's states: disabled, loading spins, armed asks again, and loading the dialog disables both", async () => {
  const { dialog, c } = await kit();
  const primary = (props) => button(dialog("d", c, { title: "Make", secondary: "Cancel", primary: "Create", ...props }), "d-primary");
  assert.deepEqual(called(primary({ state: "disabled" }), "disabled"), [[true]]);
  assert.deepEqual(called(primary({ state: "loading" }), "disabled"), [[false]]);
  assert.ok(all(primary({ state: "loading" })).some((kid) => called(kid, "spin").length), "a working primary spins");
  assert.ok(texts(primary({ state: "armed" })).includes("Press again to create"));
  const loading = dialog("d", c, { title: "Make", secondary: "Cancel", primary: "Create", loading: true });
  assert.deepEqual([...called(button(loading, "d-primary"), "disabled"), ...called(button(loading, "d-secondary"), "disabled")], [[true], [true]]);
});

test("Work under way and its failure become a muted and an error note", async () => {
  const { statusNotes } = await kit();
  assert.deepEqual(clone(statusNotes({ busy: "Opening", error: "Stopped: gone" })), [{ text: "Opening", tone: "muted" }, { text: "Stopped: gone", tone: "error" }]);
  assert.deepEqual(clone(statusNotes({ busy: null, error: null })), []);
});

test("The dialog piece reads every size from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-dialog.js"), []);
});
