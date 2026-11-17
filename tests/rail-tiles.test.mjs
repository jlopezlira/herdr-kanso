// The rail's tiles and the view switch: the Storybook's Tile and View switch compositions, copied as they are and drawn by the app kit.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, texts, tipsOf, svgsOf, themed, calls, arg, KIT_NIGHT, popoverHost as host, blockedDots, repoText as read, sameCopies } from "./helpers.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";

const FILES = ["tile", "view-switch"];
const compositions = async () => themed({
  ...await load("kanso-spaces/tile.js", ["tile"], host()),
  ...await load("kanso-spaces/view-switch.js", ["viewSwitch", "views"], host()),
  ...await load("kanso-panel/ui.js", ["tokens", "G", "TINT", "SIDEBAR", "alpha"], host()),
  kit: await load("kanso-panel/kit.js", ["stack", "chip"], host()),
}, KIT_NIGHT);
const cx = { stop_propagation() {}, notify() {} };
const ringOf = (el) => calls(el, "border_color").map((call) => call[1]);

test("The sidebar's copies of the Tile and the View switch are the Storybook's, byte for byte", () => {
  sameCopies(FILES);
});

test("Each Tile state in the Storybook draws in the app: a button with its lead, its count, and the wash, the mark or the ring the story shows", async () => {
  const { tile, c, alpha, TINT, SIDEBAR } = await compositions();
  // The tile sits centred in its row of the rail; the button is the tile.
  const draw = (props) => {
    const placed = tile(props)("t", c);
    assert.equal(arg(placed, "h"), SIDEBAR.railRow);
    return nodes(placed).find((kid) => kid.tag === "t");
  };
  const project = draw({ initial: "A", tone: "teal", status: "blocked", count: 4, open: true });
  assert.equal(project.tag, "t", "a tile is a Button: Tab reaches it, Enter and Space press it");
  assert.equal(arg(project, "bg"), c.w12, "the project you are in wears wash-12");
  assert.deepEqual(texts(project), ["A", "4"]);
  assert.ok(nodes(project).some((kid) => calls(kid, "text_color").some((call) => call[1] === c.blocked)), "someone blocked: the count in the blocked tone");
  const status = draw({ status: "working", count: 3 });
  assert.deepEqual(texts(status), ["3"]);
  assert.equal(calls(status, "bg").length, 0, "not open: no wash");
  assert.ok(svgsOf(status).some((path) => path.includes("working")), "a state leads with its mark");
  const shelf = draw({ icon: "lu-pin", status: "working", count: 2, marked: true, label: "Pinned" });
  assert.deepEqual(svgsOf(shelf).map((path) => path.split("/").at(-1)), ["pin.svg", "working.svg"], "a shelf leads with its icon; the most urgent state stands beside the count");
  assert.deepEqual(tipsOf(shelf), ["Pinned"]);
  assert.equal(arg(shelf, "accessibility_label"), "Pinned");
  const urgent = draw({ initial: "D", tone: "yellow", status: "working", count: 1, marked: true, label: "dojo" });
  assert.deepEqual(texts(urgent), ["D", "1"]);
  assert.ok(svgsOf(urgent).some((path) => path.includes("working")));
  assert.deepEqual(svgsOf(draw({ initial: "D", status: "working", count: 1 })), [], "unmarked, a project shows no state of its own");
  assert.equal(ringOf(draw({ initial: "A", status: "done", count: 2, strong: true, label: "kansō" }))[0], alpha(c.accent, TINT.ring), "something unread or woke: the ring");
  assert.equal(ringOf(urgent)[0], "#00000000", "no ring at rest: a border kept clear, so nothing moves");
});

test("Each View switch state in the Storybook draws in the app, with no margin of the mod's own", async () => {
  const { viewSwitch, views, c, G } = await compositions();
  const tips = { spaces: "Projects ⌃⌥P", agents: "Status ⌃⌥S", threads: "Threads ⌃⌥T" };
  const row = viewSwitch({ view: "agents", asks: true, tips })("v", c, { onChange() {} });
  assert.deepEqual(texts(row).filter((text) => views.some((item) => item.label === text)), ["Projects", "Status", "Threads"]);
  assert.deepEqual(tipsOf(row), Object.values(tips), "each tooltip has its view's key");
  assert.deepEqual([arg(row, "mx"), arg(row, "mt"), arg(row, "mb")], [G.sm, G.xs, G.sm], "the Storybook's margins, from the tokens");
  const dotted = viewSwitch({ view: "spaces", asks: true })("v", c, { onChange() {} });
  const dots = (el) => blockedDots(el, c);
  assert.equal(dots(dotted), 1, "someone needs you: Status carries the dot");
  assert.equal(dots(viewSwitch({ view: "spaces" })("v", c, { onChange() {} })), 0);
  const column = viewSwitch({ view: "threads", column: true, tips })("v", c, { onChange() {}, onOpen() {} });
  const pop = nodes(column).find((kid) => kid.tag === "v");
  const trigger = arg(pop, "trigger");
  assert.equal(trigger.tag, "v-button", "collapsed, one button for the current view");
  assert.equal(arg(trigger, "tooltip"), "Threads ⌃⌥T");
  assert.equal(arg(pop, "open"), false);
  assert.equal(calls(pop, "content").length, 0);
  const menu = nodes(viewSwitch({ view: "threads", column: true, open: true, asks: true })("v", c, { onChange() {}, onOpen() {} })).find((kid) => kid.tag === "v");
  assert.equal(arg(menu, "open"), true);
  const items = nodes(arg(menu, "content")).filter((kid) => /^v-menu-0-\d$/.test(kid.tag));
  assert.deepEqual(items.map((item) => arg(item, "accessibility_label")), ["Projects", "Status", "Threads"], "open, the menu of all three");
  assert.deepEqual(items.map((item) => arg(item, "selected")), [false, false, true], "the current view chosen");
  assert.ok(texts(items[1]).includes("!"), "Status marked while someone needs you");
});

test("The kit draws a stack only as the Storybook names it, and gives it only handlers", async () => {
  const { tile, kit, c } = await compositions();
  assert.throws(() => tile({ initial: "A" })("t", c, { color: "#fff" }), /the app gives only handlers, not color/);
  assert.throws(() => kit.stack({ variant: "rail" })("s", c), /has no stack "rail"/);
  assert.throws(() => kit.stack({ variant: "rail tile", wide: true })("s", c), /has no state wide/);
  assert.throws(() => kit.chip({ label: 2 })("s", c, { tone: "blocked" }), /only handlers/);
});

// The collapsed sidebar, recorded: which elements are buttons, and the press handlers by id.
const rail = async (own = {}, spaces = [{ id: "sp1", name: "app", folder: "/w", machine: null, active: true, tabs: [{ id: "tab1" }] }]) => {
  const drawn = recorder(), buttons = [], overlays = [], ran = [];
  const named = drawn.host.Button;
  drawn.host.Button = { new: (id) => { buttons.push(id); return named.new(id); } };
  const agents = [{ address: "t1", pane: "p1", tab: "tab1", space: "sp1", space_name: "app", status: "blocked", program: { agent: true, name: "Claude Code" }, title: "t1", seq: 1 }];
  const { Spaces } = await loadSidebar(drawn.host, {
    shared: (key) => (key === "sidebar.collapsed" ? true : null), spaces: () => spaces, agents: () => agents,
    window: () => ({ platform: "macos", active: true }), openOverlay: (o) => overlays.push(o), run: (cmd) => ran.push(cmd),
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(spaces.map((s) => s.id)), ...own }));
  const render = () => { drawn.clear(); buttons.length = 0; view.render(); };
  render();
  return { view, drawn, buttons, overlays, ran, render };
};

test("Keyboard first: each rail tile and the view button are buttons Tab reaches; Enter on a tile lists its group, and the view menu picks a view", async () => {
  const { view, drawn, buttons, overlays, render } = await rail();
  assert.ok(buttons.includes("space-sp1"), "the project's tile is a button");
  drawn.handlers["on_click:space-sp1"]({}, cx);
  assert.equal(overlays.at(-1)?.props?.railMenu?.title, "app", "pressed, it lists the project's conversations");
  assert.ok(buttons.includes("rail-view-button"), "collapsed, the view switch is one button");
  drawn.handlers["on_click:rail-view-button"]({}, cx);
  assert.equal(view.viewMenu, true, "pressed, it opens the menu");
  render();
  const items = buttons.filter((id) => id.startsWith("rail-view-menu-"));
  assert.equal(items.length, 3, "each view is a menu item, a button of its own");
  drawn.handlers[`on_click:${items[1]}`]({}, cx);
  assert.equal(view.view, "agents");
  assert.equal(view.viewMenu, false, "a choice shuts the menu");
  render();
  drawn.handlers["on_click:rail-view-button"]({}, cx);
  render();
  drawn.handlers["on_open_change:rail-view"](false, cx);
  assert.equal(view.viewMenu, false, "a press outside or Escape shuts it");
  render();
  assert.ok(buttons.some((id) => id.startsWith("rail-section-")), "on Status, each state's tile is a button too");
});

test("Open, the views are a track of buttons", async () => {
  const open = recorder(), buttons = [];
  const named = open.host.Button;
  open.host.Button = { new: (id) => { buttons.push(id); return named.new(id); } };
  const { Spaces } = await loadSidebar(open.host, { window: () => ({ platform: "macos", active: true }) });
  Object.assign(new Spaces(), mountedState()).render();
  assert.deepEqual(buttons.filter((id) => id.startsWith("spaces-view")), ["spaces-view-tabs-spaces", "spaces-view-tabs-agents", "spaces-view-tabs-threads"]);
});

test("No hand-drawn tile or view switch is left in kanso-spaces", () => {
  const main = read("kanso/mods/kanso-spaces/main.js");
  for (const gone of ["railMark", "railInitial", "railIcon", "avatarColor", "segmented(", ".mx(18)"]) assert.equal(main.includes(gone), false, gone);
});
