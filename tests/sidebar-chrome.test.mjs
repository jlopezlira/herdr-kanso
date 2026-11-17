// The sidebar's Toolbar, Header and Footer: the Storybook's compositions, copied as they are and drawn by the app kit, state by state.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, texts, svgsOf, themed, calls, arg, KIT_NIGHT, popoverHost as host, everyDrawn as every, blockedDots, repoText, sameCopies, numberArguments } from "./helpers.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";
import { mountChrome } from "./mod-fixtures.mjs";
import { statedPages } from "../stories/kit/states.js";
import { kitRecords } from "../scripts/storybook-kit.mjs";

const compositions = async () => themed({
  kit: await load("kanso-panel/kit.js", ["menu", "stack"], host()),
  ...await load("kanso-spaces/toolbar.js", ["toolbar", "addLabels"], host()),
  ...await load("kanso-chrome/header.js", ["header"], host()),
  ...await load("kanso-chrome/sidebar-footer.js", ["sidebarFooter"], host()),
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "DAWN", "DAWN_H"], host()),
}, KIT_NIGHT);
const tipsOf = (el) => every(el).flatMap((kid) => calls(kid, "tooltip").map((call) => call[1]));
const byTip = (el, tip) => every(el).find((kid) => calls(kid, "tooltip").some((call) => call[1] === tip)) ?? null;
const sortMenu = (kit) => kit.menu({ items: [{ heading: "Agents, pinned first, then by" }, { label: "Last update", icon: "check" }] });
// A Toolbar state's preset, drawn by the app: its menus as the app's Menu.
const drawState = ({ toolbar, kit, c }, args, handlers = { onOpen() {} }) => toolbar({ ...args, sortMenu: args.menu ? sortMenu(kit) : null, addMenu: args.add ? sortMenu(kit) : null, menu: undefined, add: undefined })("t", c, handlers);
const cx = { stop_propagation() {}, notify() {} };

test("The app's copies of the Toolbar, the Header and the Footer are the Storybook's, byte for byte", () => {
  sameCopies(["toolbar", "header"]);
  sameCopies(["header", "sidebar-footer"], "kanso-chrome");
});

test("Every Toolbar state in the Storybook draws in the app with its tools in the story's order", async () => {
  const kit = await compositions();
  const { c, G, H, R, addLabels } = kit;
  const page = statedPages["Compositions/Toolbar"];
  const drawn = Object.fromEntries(page.states.map(({ label, args }) => [label, drawState(kit, { ...page.args, ...args })]));
  assert.deepEqual(Object.keys(drawn), ["Projects", "Status and Threads", "+ menu", "Sorted", "Sort names its order", "Sort menu, Projects", "Sort menu, Status", "Sort menu, Threads", "Collapsed", "Collapsed, tools open"]);
  const open = drawn.Projects;
  assert.deepEqual(tipsOf(open), ["Add project", "Sort", "Search", "Hide sidebar"], "+ alone on the left, then Sort, Search and Hide sidebar");
  assert.equal(arg(open, "gap"), G.xs);
  assert.ok(nodes(open).some((kid) => calls(kid, "flex_1").length), "the room between + and the rest grows");
  assert.deepEqual(every(open).filter((kid) => kid.calls.some((call) => call[0] === "w")).map((kid) => arg(kid, "w")), [H.line, H.line, H.line, H.line], "large icon Buttons");
  assert.equal(tipsOf(drawn["Status and Threads"])[0], addLabels.agents);
  assert.equal(arg(byTip(open, "Sort").kids[0], "text_color"), c.dim, "Sort is dim at its default order");
  assert.equal(arg(byTip(drawn.Sorted, "Sort").kids[0], "text_color"), c.muted, "sorted, it is drawn like the other tools");
  assert.ok(byTip(drawn["Sort names its order"], "Sort: Needs you first"), "Proposed: Sort's tooltip names the order in use");
  for (const label of ["Sort menu, Projects", "Sort menu, Status", "Sort menu, Threads"]) {
    const pop = every(drawn[label]).find((kid) => calls(kid, "content").length);
    assert.equal(arg(pop, "anchor"), "top_left", `${label}: it hangs under Sort`);
    assert.equal(arg(arg(pop, "content"), "pt"), G.xs);
    assert.equal(arg(arg(pop, "trigger"), "bg"), c.selected, "Sort is selected while its menu is open");
  }
  assert.deepEqual(texts(drawn["+ menu"]).slice(0, 1), ["Agents, pinned first, then by"], "+ holds the menu it is given, under it");
  const column = drawn.Collapsed;
  assert.equal(arg(column, "gap"), G.sm);
  assert.deepEqual(tipsOf(column), ["Add project", "Show sidebar", "More tools"], "collapsed, + and Show sidebar head the column, Sort and Search fold under the caret");
  const tools = drawn["Collapsed, tools open"];
  assert.deepEqual(tipsOf(tools), ["Add project", "Show sidebar", "Fewer tools", "Sort", "Search"]);
  const group = every(tools).find((kid) => calls(kid, "bg").some((call) => call[1] === c.w4));
  assert.deepEqual([arg(group, "rounded"), arg(group, "gap")], [R.card, G.xs], "the caret's tools on a quiet wash");
  const beside = every(drawState(kit, { column: true, open: true, menu: true }, { onOpen() {} })).find((kid) => calls(kid, "content").length);
  assert.equal(arg(beside, "anchor"), "left_center", "in the column the menu opens beside Sort");
  assert.equal(arg(arg(beside, "content"), "pl"), G.xs);
});

test("Each Toolbar tool runs what the app gives under its name, and Sort's menu says when it opens or shuts", async () => {
  const kit = await compositions();
  const hits = [];
  const pressesOf = (...names) => Object.fromEntries(names.map((name) => [name, () => hits.push(name)]));
  const presses = pressesOf("plus", "search", "panel-left");
  const press = (el) => arg(el, "on_click")({}, cx);
  const row = drawState(kit, {}, { presses, onOpen: (open) => hits.push(open ? "sort" : "shut") });
  ["Add project", "Search", "Hide sidebar", "Sort"].forEach((tip) => press(byTip(row, tip)));
  press(byTip(drawState(kit, { column: true }, { presses: pressesOf("plus", "panel-left", "chevron-down") }), "More tools"));
  const pop = every(drawState(kit, { menu: true }, { presses, onOpen: (open) => hits.push(open ? "sort" : "shut") })).find((kid) => calls(kid, "content").length);
  assert.equal(calls(arg(pop, "trigger"), "on_click").length, 0, "open, the popover owns the next press");
  arg(pop, "on_open_change")(false, cx);
  assert.deepEqual(hits, ["plus", "search", "panel-left", "sort", "chevron-down", "shut"]);
});

test("A press named for no drawn target throws, as `on` does for a tool: renaming a label or icon cannot leave its press unbound", async () => {
  const { toolbar, sidebarFooter, c } = await compositions();
  const install = () => {};
  const refused = (fix) => sidebarFooter({ update: "Update kansō", refused: { text: "kansō didn't update", source: "offline", fix } });
  assert.ok(refused("Update")("f", c, { presses: { "refresh-cw": install, Update: install } }), "every name finds its target");
  assert.throws(() => refused("Try again")("f", c, { presses: { "refresh-cw": install, Update: install } }), /kit: f has no tool Update/);
  assert.throws(() => toolbar({ column: true })("t", c, { presses: { plus: install, search: install } }), /kit: t has no tool search/,
    "collapsed with the caret shut, Search is not drawn");
  const handle = {};
  assert.ok(sidebarFooter({ collapsed: true })("f", c, { focuses: { settings: handle } }), "a handle finds its target by the same name");
  assert.throws(() => sidebarFooter()("f", c, { focuses: { gear: handle } }), /kit: f has no tool gear/, "and a handle named for no target throws too");
});

test("Every Header state in the Storybook draws in the app: the lights' row, Dawn Mode's sky and pill, the Toolbar 40 tall", async () => {
  const kit = await compositions();
  const { header, toolbar, c, G, H, DAWN, DAWN_H } = kit;
  const records = kitRecords([]).filter((record) => record.page === "Compositions/Header").map((record) => record.label);
  assert.deepEqual(records, ["Expanded", "Collapsed", "Expanded, Dawn Mode", "Collapsed, Dawn Mode", "Under the title bar"]);
  const draw = (props) => header({ ...props, toolbar: toolbar({ column: Boolean(props.collapsed) }) })("h", c);
  const art = (el) => nodes(el).filter((kid) => calls(kid, "image").length);
  const open = draw({});
  assert.deepEqual([arg(open, "px"), arg(open, "pb")], [G.sm, G.xs]);
  assert.ok(nodes(open).some((kid) => arg(kid, "h") === H.tabBar), "the lights' row, as tall as the tab bar");
  assert.ok(nodes(open).some((kid) => arg(kid, "h") === H.row && tipsOf(kid).includes("Add project")), "the Toolbar 40 tall");
  assert.deepEqual([art(open).length, texts(open).includes("Dawn Mode")], [0, false], "Stable Mode shows nothing");
  const rail = draw({ collapsed: true });
  assert.equal(calls(rail, "items_center").length, 1, "collapsed, it centres the column");
  assert.ok(nodes(rail).some((kid) => arg(kid, "pt") === G.hair && tipsOf(kid).includes("Show sidebar")));
  const dawn = draw({ dawn: true });
  assert.deepEqual(art(dawn).map((kid) => [arg(kid, "image"), arg(kid, "h"), calls(kid, "absolute").length]), [[DAWN.dark.art, DAWN_H, 1]], "the sky lies behind the lights");
  const pill = nodes(dawn).find((kid) => calls(kid, "child").some((call) => call[1] === "Dawn Mode"));
  assert.deepEqual([arg(pill, "bg"), arg(pill, "text_color")], [DAWN.dark.top, DAWN.dark.star], "the pill: the night of the sky with light words");
  const dawnRail = draw({ collapsed: true, dawn: true });
  assert.deepEqual([art(dawnRail).length, texts(dawnRail).includes("Dawn Mode")], [1, false], "collapsed, the sky stays and the pill does not fit");
  assert.equal(art(draw({ dawn: true, art: false })).length, 0, "the sky can be turned off");
  const under = draw({ title: false });
  assert.equal(nodes(under).some((kid) => arg(kid, "h") === H.tabBar), false, "Proposed: under the window's title bar, the Toolbar alone");
});

test("Dawn Mode's art is the Storybook's sky in each theme's colours, written by build:ui-tokens", async () => {
  const { dawnSvg, dawnArt } = await import("../scripts/build-ui-tokens.mjs");
  const { loadTokens } = await import("../scripts/tokens.mjs");
  const tokens = loadTokens(), css = repoText("stories/primitives.css");
  for (const theme of ["dark", "light"]) {
    const art = repoText(`kanso/${dawnArt(theme)}`);
    assert.equal(art, dawnSvg(tokens, theme, css), `${theme}: npm run build:ui-tokens leaves it as it is`);
    assert.equal(/class=|var\(/.test(art), false, "every colour is written in");
    assert.match(art, /<rect opacity="0" fill="#[0-9a-f]{6}"/, "the night has lifted: the last frame");
  }
});

test("The app sidebar draws its header from the composition, the lights left to the window's block above", async () => {
  const drawn = recorder();
  const { Spaces } = await loadSidebar(drawn.host, { window: () => ({ platform: "macos", active: true }) });
  Object.assign(new Spaces(), mountedState({ order: "attention" })).render();
  assert.ok(drawn.ids.includes("spaces-header"));
  assert.ok(drawn.tips.includes("Sort: Needs you first"), "Sort's tooltip names the order");
  assert.ok(["Add project", "Search", "Hide sidebar"].every((tip) => drawn.tips.includes(tip)));
});

test("The window's title block draws the Header's lights' row: in Dawn Mode the sky and, open, the pill", async () => {
  const draw = async (shared) => {
    const view = await mountChrome({ ...host(), theme: () => KIT_NIGHT, props: () => ({}), shared: (key) => shared[key] ?? null, setShared() {} });
    return { el: view.render() }; // wrapped: a drawn element answers every name, `then` too
  };
  const { el: stable } = await draw({});
  assert.deepEqual([svgsOf(stable).length, nodes(stable).filter((kid) => calls(kid, "image").length).length, texts(stable)], [0, 0, []], "Stable Mode shows nothing");
  const { el: dawn } = await draw({ "kanso.update": { channel: "beta" } });
  assert.equal(nodes(dawn).filter((kid) => calls(kid, "image").length).length, 1);
  assert.deepEqual(texts(dawn), ["Dawn Mode"]);
  assert.deepEqual(texts((await draw({ "kanso.update": { channel: "beta" }, "sidebar.collapsed": true })).el), [], "collapsed, the pill does not fit");
});

// The collapsed sidebar, recorded, with one agent that needs you.
const rail = async (own = {}) => {
  const drawn = recorder(), dots = [];
  const spaces = [{ id: "sp1", name: "app", folder: "/w", machine: null, active: true, status: "blocked", tabs: [{ id: "tab1" }] }];
  const { Spaces } = await loadSidebar(drawn.host, {
    shared: (key) => (key === "sidebar.collapsed" ? own.collapsed !== false : null), spaces: () => spaces,
    agents: () => [{ address: "t1", pane: "p1", tab: "tab1", space: "sp1", space_name: "app", status: "blocked", program: { agent: true, name: "Claude Code" }, title: "t1", seq: 1 }],
    window: () => ({ platform: "macos", active: true }), openOverlay() {}, run() {},
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), ...own.state }));
  return { view, drawn, dots, render: () => { drawn.clear(); view.render(); } };
};

test("Collapsed, while someone needs you and Status is not on show, the view button carries the dot and says so", async () => {
  const { viewSwitch } = await load("kanso-spaces/view-switch.js", ["viewSwitch"], host());
  const { tokens, LINE } = await load("kanso-panel/ui.js", ["tokens", "LINE"], host());
  const c = tokens(KIT_NIGHT);
  const button = (props) => nodes(viewSwitch({ column: true, carry: true, ...props })("v", c, { onChange() {}, onOpen() {} })).map((kid) => arg(kid, "trigger")).find(Boolean);
  const dots = (el) => blockedDots(el, c);
  const asked = button({ view: "spaces", asks: true });
  assert.equal(dots(asked), 1, "the Status dot, on the view button");
  const dot = nodes(asked).find((kid) => calls(kid, "bg").some((call) => call[1] === c.blocked));
  assert.deepEqual([arg(dot, "top"), arg(dot, "right"), LINE], [1, 1, 1], "a hairline (k-w-line) in from the corner, as the Storybook's --k-w-line");
  assert.equal(dots(button({ view: "spaces", asks: true, carry: false })), 0, "without carry, the approved button: no dot");
  assert.equal(arg(asked, "accessibility_label"), "Projects · Someone needs you");
  assert.equal(arg(asked, "tooltip"), "Projects · Someone needs you");
  assert.equal(dots(button({ view: "spaces" })), 0);
  assert.equal(dots(button({ view: "agents", asks: true })), 0, "on Status, the states say it already");
  const { drawn, render } = await rail();
  render();
  assert.ok(drawn.tips.includes("Projects · Someone needs you"), "in the rail, while Projects is on show, its tooltip says someone needs you");
});

test("A view key shuts the collapsed view menu, as a pick from it does", async () => {
  const { view, render } = await rail();
  view.viewMenu = true;
  render();
  view.command("view-agents", cx);
  assert.deepEqual([view.view, view.viewMenu], ["agents", false]);
});

test("Drawing the view switch changes no state: the open sidebar hides the view menu, and opening or folding the sidebar shuts it", async () => {
  const { view, render, drawn } = await rail({ collapsed: false });
  view.viewMenu = true;
  render();
  assert.equal(view.viewMenu, true, "the draw leaves the menu's state alone");
  assert.equal(drawn.ids.some((id) => id.startsWith("spaces-view-menu")), false, "open, the menu is not drawn");
  view.openRail();
  assert.equal(view.viewMenu, false, "opening the sidebar shuts it for good");
  view.viewMenu = true;
  view.foldRail(null);
  assert.equal(view.viewMenu, false);
});

test("A project's hues have one list: the tones it is drawn in, whose order new projects take", () => {
  const main = repoText("kanso/mods/kanso-spaces/main.js");
  assert.equal(main.match(/"ansi6"/g).length, 1, "the six hues are written once");
  assert.match(main, /const palette = Object\.keys\(HUES\);/);
});

test("No hand-drawn toolbar, header or footer is left, and the stacks draw no literal size", () => {
  for (const gone of ["kanso-panel/ui-toolbar.js", "kanso-panel/ui-sidebar-header.js", "kanso-spaces/ui-toolbar.js", "kanso-chrome/footer.js"]) {
    assert.throws(() => repoText(`kanso/mods/${gone}`), /ENOENT/, gone);
  }
  const spaces = repoText("kanso/mods/kanso-spaces/main.js"), chrome = repoText("kanso/mods/kanso-chrome/main.js");
  for (const word of ["ui-toolbar", "ui-sidebar-header", "sortTip"]) assert.equal(spaces.includes(word), false, word);
  for (const word of ["./footer.js", "chromeGlyph", "div().size_full()"]) assert.equal(chrome.includes(word), false, word);
  assert.deepEqual(numberArguments("kanso-panel/ui-stack.js"), []);
});
