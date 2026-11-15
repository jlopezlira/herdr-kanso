// The sidebar footer: kansō's update row in each mode, its refusal, Settings and its one menu, Herdr's update, and the rail.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost } from "./helpers.mjs";

const night = { background: "#1b1b19", foreground: "#d8d4cb", chrome: "#161615", hover: "#232321", selected: "#2b2b28", dim: "#6b6860", muted: "#949086", blocked: "#d5674f", accent: "#c9a46a" };

const calls = (el, name) => el.calls.filter((call) => call[0] === name);
const arg = (el, name) => calls(el, name)[0]?.[1];
// Kids, and what a popover holds as its trigger and content.
const inside = (el) => [...el.kids, ...el.calls.filter((call) => call[0] === "trigger" || call[0] === "content").map((call) => call[1])];
const all = (el) => [el, ...inside(el).flatMap(all)];
const texts = (el) => all(el).flatMap((x) => calls(x, "child").map((call) => call[1]).filter((v) => typeof v === "string"));
const byId = (el, id) => all(el).find((x) => x.tag === id || arg(x, "id") === id) ?? null;
const holding = (el, words) => all(el).find((x) => calls(x, "on_click").length && texts(x).includes(words)) ?? null;

const cx = () => ({ notified: 0, notify() { this.notified += 1; }, timer: { after() {} }, stop_propagation() {} });
const press = (el, context = cx()) => { arg(el, "on_click")({}, context); return context; };

// Mounted as Herdr mounts it, with nothing run; the updater is then a stand-in.
async function footer({ shared = {}, ready = null, bindings = [{ action: "kanso-tabs.settings", keys: "ctrl-shift-," }], updater = {} } = {}) {
  const ran = [], overlays = [], installs = [];
  const host = {
    ...gpuiHost(),
    Popover: { new: (id) => chain(id) },
    theme: () => night, props: () => ({ footer: true }), shared: (key) => shared[key] ?? null, setShared: () => {},
    run: (name, args) => { ran.push([name, args]); }, openOverlay: (spec) => { overlays.push(spec); return "o"; },
    updates: () => ({ app: { ready } }), keys: () => bindings, settings: () => ({ font_family: "Mono" }), window: () => ({ platform: "macos" }),
  };
  const { WorkspaceChrome } = await load("kanso-chrome/main.js", ["WorkspaceChrome"], host);
  const kit = await load("kanso-chrome/ui.js", ["CHROME_SQUARE", "ICON_CHROME", "T", "G"], host);
  const view = new WorkspaceChrome();
  view.init({}, { spawn() {}, timer: { after() {}, every() {} } });
  view.updater = { available: () => null, busy: false, refused: () => null, install: (context) => installs.push(context), ...updater };
  return { view, ran, overlays, installs, ...kit };
}

test("In Stable Mode with nothing to install, the footer is Settings alone: Add computer lives in +", async () => {
  const { view } = await footer();
  assert.deepEqual(texts(view.render()), ["Settings"]);
});

test("Open, every row is at chrome size, muted at rest, 8 above and 16 below; the rail keeps 12 below", async () => {
  const { view, ICON_CHROME, T, G } = await footer();
  const open = view.render();
  for (const id of ["footer-settings"]) {
    const row = byId(open, id);
    assert.equal(calls(row, "text_size").at(-1)[1], T.card, `${id} reads at 13.5: the last size set wins`);
    const glyph = all(row).find((x) => arg(x, "size") === ICON_CHROME);
    assert.equal(arg(glyph, "text_color"), night.muted, `${id}'s icon is 17, muted`);
  }
  assert.deepEqual([arg(open, "pt"), arg(open, "pb")], [G.sm, G.lg]);
  assert.equal(arg(open, "gap"), undefined, "open rows touch");
  const rail = await footer({ shared: { "sidebar.collapsed": true } });
  const squares = rail.view.render();
  assert.deepEqual([arg(squares, "pt"), arg(squares, "pb"), arg(squares, "gap")], [G.sm, G.md, G.hair]);
});

test("A kansō update is a row on top, in the foreground, and a press installs it", async () => {
  const { view, installs, ICON_CHROME } = await footer({ updater: { available: () => "3.31.0" } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["Update kansō to 3.31.0", "Settings"]);
  const row = byId(drawn, "footer-kanso-update");
  const glyph = all(row).find((x) => arg(x, "size") === ICON_CHROME);
  assert.equal(arg(glyph, "text_color"), night.foreground, "the update's icon is at chrome size, in the foreground");
  press(row);
  assert.equal(installs.length, 1);
});

test("A Dawn Mode build is offered by its own name", async () => {
  const { view } = await footer({ updater: { available: () => "3.31.0-beta.3" } });
  assert.equal(texts(view.render())[0], "Update to 3.31.0-beta.3");
});

test("A pressed update says Updating kansō at once and stays quiet until it lands", async () => {
  const { view } = await footer({ updater: { available: () => "3.31.0", busy: true, refused: () => "old words" } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["Updating kansō", "Settings"], "no refusal while it runs");
  const name = all(byId(drawn, "footer-kanso-update")).find((x) => calls(x, "child").some((call) => call[1] === "Updating kansō"));
  assert.equal(arg(name, "text_color"), night.muted);
});

test("A refused update keeps its row and shows the tool's words under it, with Update to try again", async () => {
  const why = "git ls-remote: Could not resolve host: github.com";
  const { view, installs } = await footer({ updater: { available: () => "3.31.0", refused: () => why } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["Update kansō to 3.31.0", "!", "kansō didn't update", why, "Update", "Settings"], "the blocked mark, our words, the tool's words, the fix");
  press(holding(byId(drawn, "footer-refused"), "Update"));
  assert.equal(installs.length, 1);
});

test("Settings under the pointer opens one menu: kansō settings with its key, and Herdr settings", async () => {
  const { view, ran, overlays } = await footer();
  const closed = view.render();
  const trigger = byId(closed, "footer-settings");
  assert.equal(calls(trigger, "on_click").length, 0, "the menu owns the press");
  const menu = byId(closed, "footer-settings-menu");
  assert.equal(arg(menu, "trigger"), trigger);
  assert.equal(arg(menu, "open"), false);
  arg(menu, "on_open_change")(true, cx());
  const open = view.render();
  assert.deepEqual(texts(byId(open, "footer-settings-list")), ["Settings", "kansō settings", "⌃⇧,", "Herdr settings"]);
  press(holding(open, "kansō settings"));
  assert.equal(overlays[0].mod, "kanso-settings");
  assert.equal(view.menuOpen, false, "choosing closes the menu");
  view.menuOpen = true;
  press(holding(view.render(), "Herdr settings"));
  assert.deepEqual(ran, [["app.settings", undefined]]);
});

test("Herdr's waiting update is the menu's third row: the first press arms it, the second restarts Herdr", async () => {
  const { view, ran } = await footer({ ready: "0.1.16" });
  view.menuOpen = true;
  assert.ok(texts(view.render()).includes("Update Herdr to 0.1.16"));
  press(holding(view.render(), "Update Herdr to 0.1.16"));
  assert.deepEqual(ran, [], "the first press only arms");
  const armed = view.render();
  assert.ok(texts(armed).includes("Press again to restart Herdr"));
  press(holding(armed, "Press again to restart Herdr"));
  assert.deepEqual(ran, [["app.update", undefined]]);
});

test("Without a Herdr update the menu has no third row, and the footer no longer says update ready", async () => {
  const { view } = await footer();
  view.menuOpen = true;
  assert.equal(texts(view.render()).some((words) => /Herdr to|update ready/.test(words)), false);
});

test("In the rail the footer is chrome squares with their names as tips, and the gear opens the same menu", async () => {
  const { view, CHROME_SQUARE } = await footer({ shared: { "sidebar.collapsed": true }, updater: { available: () => "3.31.0", refused: () => "words" } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), [], "no names, no refusal block in the rail");
  const squares = ["footer-kanso-update", "footer-settings"].map((id) => byId(drawn, id));
  assert.deepEqual(squares.map((el) => arg(el, "size")), [CHROME_SQUARE, CHROME_SQUARE]);
  assert.deepEqual(squares.map((el) => arg(el, "tooltip")), ["Update kansō to 3.31.0", "Settings"]);
  assert.equal(arg(byId(drawn, "footer-settings-menu"), "trigger"), squares[1]);
  assert.equal(byId(drawn, "footer-machine"), null, "Add computer lives in +, not in the rail");
});
