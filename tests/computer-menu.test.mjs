// A computer's right-click menu: its rows by phase, drawn by the kit, each one acting, the keyboard included.
import { loadSpaces } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, chain, gpuiHost } from "./helpers.mjs";

const rows = async () => (await load("kanso-spaces/computer-menu.js", ["computerMenuItems"])).computerMenuItems;
const wordsOf = async () => (await load("kanso-spaces/menu-actions.js", ["wordsOf"])).wordsOf;
const words = (items, said) => clone(items).map((row) => {
  if (row.separator) return "—";
  const label = row.act ? said(row.act) : row.label;
  return row.hint ? `${label} (${row.hint})` : label;
});
const menuWords = async () => {
  const [items, said] = await Promise.all([rows(), wordsOf()]);
  return (props) => words(items(props), said);
};
const TAIL = ["—", "Add computer…", "—", "Hide “Computers”", "Settings for this…"];

test("Another computer, connected, has its menu: Rename, Disconnect, Sync, New project, Remove, Add computer, Hide and Settings", async () => {
  const read = await menuWords();
  assert.deepEqual(read({ remote: true, phase: "connected", syncOn: true }), ["Rename…", "Disconnect", "Sync (on)", "New project", "Remove", ...TAIL]);
  assert.deepEqual(read({ remote: true, phase: "connected" }).slice(0, 4), ["Rename…", "Disconnect", "Sync (off)", "New project"]);
});

test("This computer has no power or sync to offer, and a computer out of reach keeps only its way back", async () => {
  const read = await menuWords();
  assert.deepEqual(read({ remote: false, phase: "connected" }), ["Rename…", "New project", ...TAIL]);
  assert.deepEqual(read({ remote: true, phase: "off" }), ["Rename…", "Connect", "Remove", ...TAIL]);
  assert.deepEqual(read({ remote: true, phase: "unavailable" }), ["Rename…", "Refresh", "Remove", ...TAIL]);
  assert.deepEqual(read({ remote: true, phase: "login" }), ["Rename…", "Sign in…", "Remove", ...TAIL]);
  assert.deepEqual(read({ remote: true, phase: "loading" }), ["Rename…", ...TAIL]);
});

test("Remove is on a remote computer in every phase but loading, and never on this computer", async () => {
  const computerMenuItems = await rows();
  const item = (props) => clone(computerMenuItems(props)).find((row) => row.key === "remove") ?? null;
  for (const phase of ["connected", "off", "unavailable", "login"]) {
    assert.deepEqual(item({ remote: true, phase }), { key: "remove", act: "remove-computer" });
    assert.equal(item({ remote: false, phase }), null);
  }
  assert.equal(item({ remote: true, phase: "loading" }), null);
});

test("Remove this computer's key is offered only for a connected remote computer on a kansō key route", async () => {
  const [items, said] = await Promise.all([rows(), wordsOf()]);
  const props = { remote: true, phase: "connected", keyed: true };
  const removeKey = (menu) => clone(items(menu)).filter((row) => row.act === "remove-key");
  assert.deepEqual(removeKey(props), [{ key: "unkey", act: "remove-key" }]);
  assert.equal(said("remove-key"), "Remove this computer's key");
  assert.deepEqual(removeKey({ ...props, remote: false }), []);
  assert.deepEqual(removeKey({ ...props, keyed: false }), []);
  for (const phase of ["off", "unavailable", "login", "loading"]) assert.deepEqual(removeKey({ ...props, phase }), []);
});

test("Add computer switched off in kansō settings leaves the menu without it or its line", async () => {
  const computerMenuItems = await rows();
  assert.deepEqual(words(computerMenuItems({ remote: true, phase: "off", addComputer: false }), await wordsOf()), ["Rename…", "Connect", "Remove", "—", "Hide “Computers”", "Settings for this…"]);
});

// The popup as Herdr mounts it, with the kit drawing into recording elements.
async function popup({ menuProps, stored = null }) {
  const calls = [], overlays = [], closed = [], store = { "kanso.pieces": stored };
  const { Spaces } = await loadSpaces({
    ...gpuiHost(),
    Popover: { new: (id) => chain(id) }, Scrollbar: { vertical: () => chain() },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", popover: "#222", selected: "#444" }),
    shared: (k) => store[k] ?? null, setShared: (k, v) => { store[k] = v; },
    props: () => ({ overlay: "ov1", machineMenu: menuProps }), closeOverlay: (id) => closed.push(id),
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => { overlays.push(clone(o)); return "o"; },
  });
  const view = new Spaces();
  view.init({}, { focus_handle: () => ({ focus() {}, is_focused: () => true }), spawn() {}, notify() {}, timer: { after() {}, every() {} } });
  return { view, calls, overlays, closed, store };
}

const all = (el) => [el, ...el.kids.flatMap(all)];
const texts = (el) => all(el).flatMap((x) => x.calls.filter((c) => c[0] === "child" && typeof c[1] === "string").map((c) => c[1]));
const pressing = (el, words) => all(el).find((x) => x.calls.some((c) => c[0] === "accessibility_label" && c[1] === words));
const press = (el) => el.calls.find((c) => c[0] === "on_click")[1]({}, { notify() {} });

test("A right-click on a computer opens the kit's menu under its name, and Add computer opens the window to add one", async () => {
  const { view, calls, closed } = await popup({ menuProps: { route: "devbox", shown: "devbox", phase: "connected", syncOn: true } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["devbox", "Rename…", "Disconnect", "Sync", "on", "New project", "Remove", "Add computer…", "Hide “Computers”", "Settings for this…"]);
  press(pressing(drawn, "Add computer…"));
  assert.deepEqual(calls, [["mod.open", { name: "kanso-computers" }]]);
  assert.deepEqual(closed, ["ov1"], "the menu closes once chosen");
});

test("Each row of a computer's menu does what its button or command does", async () => {
  const { view, calls, overlays, store } = await popup({ menuProps: { route: "devbox", shown: "devbox", phase: "connected", syncOn: false } });
  const drawn = view.render();
  for (const words of ["Disconnect", "Sync", "New project", "Hide “Computers”", "Settings for this…"]) press(pressing(drawn, words));
  assert.deepEqual(calls, [["kanso-spaces.power-machine:devbox", null], ["kanso-spaces.sync-machine:devbox", null], ["space.new", { machine: "devbox" }]]);
  assert.equal(store["kanso.pieces"]["sidebar.computers"], "hide", "Hide switches the Computers piece off");
  assert.deepEqual(overlays.at(-1).props, { page: "pieces", find: "Computers" }, "Settings opens kansō settings on the Computers piece");
});

test("The keyboard walks a computer's menu: down lights a row, Enter runs it", async () => {
  const { view, calls } = await popup({ menuProps: { route: "", shown: "This Mac", phase: "connected" } });
  const onKey = all(view.render()).flatMap((x) => x.calls.filter((c) => c[0] === "on_key_down").map((c) => c[1]))[0];
  const cx = { stop_propagation() {}, notify() {} };
  for (const key of ["down", "down"]) onKey({ key, modifiers: {} }, cx);
  const newProject = pressing(view.render(), "New project");
  assert.ok(newProject.calls.some((c) => c[0] === "bg" && c[1] === "#444"), "the second row, New project, is lit");
  onKey({ key: "enter", modifiers: {} }, cx);
  assert.deepEqual(calls, [["space.new", { machine: "" }]]);
});

test("The computer menu shows Caffeine with its status only when the computer is connected and supports it", async () => {
  const [items, said] = await Promise.all([rows(), wordsOf()]);
  const item = (props) => items(props).find((row) => row.key === "caffeine");
  for (const remote of [false, true]) {
    const row = item({ remote, caffeine: "on" });
    assert.equal(said(row?.act), "Caffeine");
    assert.equal(row.hint, "on");
    assert.equal(item({ remote, caffeine: null }), undefined);
  }
  assert.equal(item({ remote: true, phase: "off", caffeine: "on" }), undefined);
});
