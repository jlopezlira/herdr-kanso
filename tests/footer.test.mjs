// The sidebar footer: the Storybook's Footer composition, drawn by kanso-chrome with kansō's update in each mode, its refusal, Settings and its one menu, Herdr's update, and the rail.
import { mountChrome } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, calls, everyDrawn as all } from "./helpers.mjs";

const night = { background: "#1b1b19", foreground: "#d8d4cb", chrome: "#161615", hover: "#232321", selected: "#2b2b28", dim: "#6b6860", muted: "#949086", blocked: "#d5674f", accent: "#c9a46a" };

const arg = (el, name) => calls(el, name)[0]?.[1];
const texts = (el) => all(el).flatMap((x) => calls(x, "child").map((call) => call[1]).filter((v) => typeof v === "string"));
const byId = (el, id) => all(el).find((x) => x.tag === id || arg(x, "id") === id) ?? null;
const holding = (el, words) => all(el).find((x) => calls(x, "on_click").length && texts(x).includes(words)) ?? null;
const popover = (el) => all(el).find((x) => calls(x, "trigger").length) ?? null;

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
  const view = await mountChrome(host);
  const kit = await load("kanso-chrome/ui.js", ["H", "G", "T"], host);
  view.updater = { available: () => null, busy: false, refused: () => null, install: (context) => installs.push(context), ...updater };
  return { view, ran, overlays, installs, ...kit };
}

test("In Stable Mode with nothing to install, the footer is Settings alone: Add computer lives in +", async () => {
  const { view } = await footer();
  assert.deepEqual(texts(view.render()), ["Settings"]);
});

test("Open, the footer's rows are the kit's rows, 8 above and 16 below at the sidebar's gutter; the rail keeps 12 below, its Buttons a hair apart", async () => {
  const { view, G, T } = await footer();
  const open = view.render();
  assert.deepEqual([arg(open, "pt"), arg(open, "px"), arg(open, "pb")], [G.sm, G.sm, G.lg]);
  assert.equal(arg(open, "gap"), undefined, "open rows touch");
  const settings = holding(open, "Settings");
  assert.equal(arg(settings, "text_size"), T.value, "the kit's row size, as the Storybook's row");
  const rail = await footer({ shared: { "sidebar.collapsed": true } });
  const squares = rail.view.render();
  assert.deepEqual([arg(squares, "pt"), arg(squares, "pb"), arg(squares, "gap")], [G.sm, G.md, G.hair]);
});

test("A kansō update is a row on top, in the foreground, and a press installs it", async () => {
  const { view, installs } = await footer({ updater: { available: () => "3.31.0" } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["Update kansō to 3.31.0", "Settings"]);
  const row = holding(drawn, "Update kansō to 3.31.0");
  assert.equal(arg(row, "text_color"), night.foreground);
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
  assert.equal(arg(all(drawn).find((x) => texts(x)[0] === "Updating kansō" && calls(x, "text_color").length), "text_color"), night.muted);
});

test("A refused update keeps its row and shows the tool's words under it, with Update to try again", async () => {
  const why = "git ls-remote: Could not resolve host: github.com";
  const { view, installs, G } = await footer({ updater: { available: () => "3.31.0", refused: () => why } });
  const drawn = view.render();
  assert.deepEqual(texts(drawn), ["Update kansō to 3.31.0", "!", "kansō didn't update", why, "Update", "Settings"], "the blocked mark, our words, the tool's words, the fix");
  const block = all(drawn).find((x) => calls(x, "mt").length);
  assert.deepEqual([arg(block, "mt"), arg(block, "mb")], [G.hair, G.sm], "a hair under its row, 8 above Settings");
  press(holding(block, "Update"));
  assert.equal(installs.length, 1);
});

test("Settings opens one menu: kansō settings with its key, and Herdr settings; choosing shuts it", async () => {
  const { view, ran, overlays } = await footer();
  const closed = view.render();
  assert.equal(popover(closed), null, "shut, Settings is its row alone, as the Storybook draws it");
  press(holding(closed, "Settings"));
  assert.equal(view.menuOpen, true, "a press on Settings, the pointer's or Enter's, opens it");
  const open = view.render();
  assert.equal(calls(arg(popover(open), "trigger"), "on_click").length, 0, "open, the popover owns the next press");
  assert.deepEqual(texts(arg(popover(open), "content")), ["Settings", "kansō settings", "⌃⇧,", "Herdr settings"]);
  press(holding(open, "kansō settings"));
  assert.equal(overlays[0].mod, "kanso-settings");
  assert.equal(view.menuOpen, false, "choosing closes the menu");
  view.menuOpen = true;
  press(holding(view.render(), "Herdr settings"));
  assert.deepEqual(ran, [["app.settings", undefined]]);
  view.menuOpen = true;
  arg(popover(view.render()), "on_open_change")(false, cx());
  assert.equal(view.menuOpen, false, "a press outside or Escape shuts it");
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

test("Keyboard first: Tab reaches each footer target, a kit Button with the focus ring, and Enter or Space presses it, open and in the rail", async () => {
  for (const collapsed of [false, true]) {
    const { view, installs, H } = await footer({ shared: { "sidebar.collapsed": collapsed }, updater: { available: () => "3.31.0" } });
    const drawn = view.render();
    const update = collapsed ? byId(drawn, "footer-update") : holding(drawn, "Update kansō to 3.31.0");
    const settings = all(drawn).find((x) => calls(x, "on_click").length && arg(x, "tooltip") === "Settings") ?? holding(drawn, "Settings");
    for (const el of [update, settings]) {
      assert.ok(/^footer-/.test(el.tag), `${el.tag} is a Button: Tab reaches it, Enter and Space press it`);
      assert.equal(calls(el, "focus").length, 1, `${el.tag} shows the focus ring`);
    }
    press(update);
    press(settings);
    assert.deepEqual([installs.length, view.menuOpen], [1, true]);
    if (collapsed) {
      assert.deepEqual(texts(drawn), [], "no names, no refusal block in the rail");
      assert.deepEqual([update, settings].map((el) => [arg(el, "w"), arg(el, "tooltip")]), [[H.line, "Update kansō to 3.31.0"], [H.line, "Settings"]]);
    }
  }
});

// Herdr's window, as far as focus goes: a Button tracks the handle it is given, or one keyed by its id that lives only while a Button
// with that id is drawn frame after frame (a Popover's state is its own); the Popover keeps the handle focused as it opens and focuses it again as it shuts.
const herdrWindow = () => {
  let keyed = new Map();
  const handle = (el) => arg(el, "track_focus") ?? keyed.get(el.tag);
  return {
    handle,
    frame(drawn) {
      keyed = new Map(all(drawn).filter((x) => /^footer-/.test(x.tag) && !calls(x, "trigger").length).map((x) => [x.tag, keyed.get(x.tag) ?? { id: x.tag }]));
      return drawn;
    },
  };
};

test("Escape gives the keyboard back to Settings, open and in the rail, so Tab goes on from it", async () => {
  for (const collapsed of [false, true]) {
    const { view } = await footer({ shared: { "sidebar.collapsed": collapsed }, updater: { available: () => "3.31.0" } });
    const herdr = herdrWindow();
    const settings = (drawn) => all(drawn).find((x) => calls(x, "on_click").length && arg(x, "tooltip") === "Settings") ?? holding(drawn, "Settings");
    const shut = herdr.frame(view.render());
    assert.equal(settings(shut).tag, "footer-settings", "Settings keeps its name with the update's row above it");
    const focused = herdr.handle(settings(shut));
    press(settings(shut));
    const open = herdr.frame(view.render());
    arg(popover(open), "on_open_change")(false, cx());
    const back = herdr.frame(view.render());
    assert.equal(view.menuOpen, false);
    assert.equal(herdr.handle(settings(back)), focused, `${collapsed ? "in the rail" : "open"}, the handle Escape focuses is Settings' own`);
  }
});
