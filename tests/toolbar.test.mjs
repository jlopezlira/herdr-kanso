// The sidebar's Header and Toolbar: large icon buttons in a row, and collapsed a column whose caret holds Sort and Search.
import { loadMenu } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, numberArguments, calls, arg, themed, CHROME_NIGHT } from "./helpers.mjs";

const host = () => ({
  ...gpuiHost(),
  svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; },
  Popover: { new: (id) => chain(id) },
  image: (path) => { const el = chain("image"); el.calls.push(["image", path]); return el; },
});
const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "ICON_CHROME"], host()),
  ...await load("kanso-panel/ui-toolbar.js", ["toolbar", "addLabels"], host()),
  ...await load("kanso-panel/ui-sidebar-header.js", ["header"], host()),
  ...await loadMenu(host()),
}, night);
const night = CHROME_NIGHT;

const all = (el) => [el, ...el.kids.flatMap(all)];
const named = (el) => arg(el, "id") ?? el.tag;
const byTag = (el, tag) => all(el).find((kid) => named(kid) === tag);
const tags = (el) => el.kids.map(named);
const icon = (el) => arg(el.kids.find((kid) => calls(kid, "svg").length), "svg");
const sortOf = (el) => arg(byTag(el, "t-sort-menu"), "trigger");
const press = (el) => arg(el, "on_click")({}, { stop_propagation() {} });

test("Open, the Toolbar is + alone on the left, then Sort, Search and Hide sidebar, large icon buttons 4 apart", async () => {
  const { toolbar, tokens, G, H, ICON_CHROME } = await kit();
  const el = toolbar("t", tokens(night));
  assert.deepEqual(tags(el), ["t-add", "div", "t-sort-menu", "t-search", "t-sidebar"]);
  assert.equal(arg(el, "gap"), G.xs);
  assert.equal(calls(el.kids[1], "flex_1").length, 1, "the room between + and the rest grows");
  const add = byTag(el, "t-add");
  assert.deepEqual([arg(add, "h"), arg(add, "w"), arg(add.kids[0], "size")], [H.line, H.line, ICON_CHROME]);
  assert.deepEqual([icon(add), icon(sortOf(el)), icon(byTag(el, "t-search")), icon(byTag(el, "t-sidebar"))],
    ["plus", "arrow-up-down", "search", "panel-left"].map((name) => `mods/kanso-chrome/icons/${name}.svg`));
  assert.equal(arg(byTag(el, "t-sidebar"), "tooltip"), "Hide sidebar");
});

test("+ says what it adds: Add project on Projects, New conversation on Status and Threads", async () => {
  const { toolbar, tokens } = await kit();
  const tip = (view) => arg(byTag(toolbar("t", tokens(night), { view }), "t-add"), "tooltip");
  assert.deepEqual(["spaces", "agents", "threads"].map(tip), ["Add project", "New conversation", "New conversation"]);
});

test("Sort is dim at its default order, drawn like the other tools when sorted, and selected while its menu is open", async () => {
  const { toolbar, c } = await kit();
  const ink = (o) => arg(sortOf(toolbar("t", c, o)).kids[0], "text_color");
  assert.equal(ink({}), c.dim);
  assert.equal(ink({ sorted: true }), c.muted);
  const open = sortOf(toolbar("t", c, { sortOpen: true, sortMenu: () => chain("sort-menu") }));
  assert.equal(arg(open, "bg"), c.selected);
  assert.equal(arg(open.kids[0], "text_color"), c.text);
});

test("Sort's menu hangs under it in a row and beside it in a column, and only while it is open", async () => {
  const { toolbar, G, c } = await kit();
  const pop = (o) => byTag(toolbar("t", c, { sortMenu: () => chain("sort-menu"), ...o }), "t-sort-menu");
  assert.equal(calls(pop({}), "content").length, 0);
  const row = pop({ sortOpen: true });
  assert.equal(arg(row, "anchor"), "top_left");
  assert.equal(arg(arg(row, "content"), "pt"), G.xs);
  const column = pop({ column: true, open: true, sortOpen: true });
  assert.equal(arg(column, "anchor"), "left_center");
  assert.equal(arg(arg(column, "content"), "pl"), G.xs);
  const changes = [];
  arg(pop({ on: { sort: (open) => changes.push(open) } }), "on_open_change")(true, {});
  assert.deepEqual(changes, [true]);
});

test("Collapsed, + and Show sidebar head the column and stay 8 apart and Sort and Search fold under a caret that opens on a quiet wash", async () => {
  const { toolbar, G, R, c } = await kit();
  const shut = toolbar("t", c, { column: true });
  assert.deepEqual(tags(shut), ["t-add", "t-sidebar", "t-group"]);
  assert.equal(arg(shut, "gap"), G.sm);
  assert.equal(arg(byTag(shut, "t-sidebar"), "tooltip"), "Show sidebar");
  const group = byTag(shut, "t-group");
  assert.deepEqual(tags(group), ["t-more"]);
  assert.equal(arg(byTag(group, "t-more"), "tooltip"), "More tools");
  assert.equal(calls(group, "bg").length, 0);
  const open = byTag(toolbar("t", c, { column: true, open: true }), "t-group");
  assert.deepEqual(tags(open), ["t-more", "t-sort-menu", "t-search"]);
  assert.equal(arg(byTag(open, "t-more"), "tooltip"), "Fewer tools");
  assert.equal(icon(byTag(open, "t-more")), "mods/kanso-chrome/icons/chevron-up.svg");
  assert.deepEqual([arg(open, "bg"), arg(open, "rounded"), arg(open, "gap")], [c.w4, R.card, G.xs]);
});

test("Each tool runs what it names", async () => {
  const { toolbar, tokens } = await kit();
  const hits = [];
  const on = Object.fromEntries(["add", "search", "sidebar", "more"].map((name) => [name, () => hits.push(name)]));
  const row = toolbar("t", tokens(night), { on });
  ["t-add", "t-search", "t-sidebar"].forEach((tag) => press(byTag(row, tag)));
  press(byTag(toolbar("t", tokens(night), { column: true, on }), "t-more"));
  assert.deepEqual(hits, ["add", "search", "sidebar", "more"]);
});

test("The Header holds the Toolbar 40 tall with 8 at its sides; collapsed, it centres the column", async () => {
  const { header, G, H } = await kit();
  const open = header("h", {}, chain("bar"));
  assert.deepEqual([arg(open, "px"), arg(open, "pb")], [G.sm, G.xs]);
  assert.equal(arg(open.kids[0], "h"), H.row);
  assert.equal(H.row, 40);
  const rail = header("h", { collapsed: true }, chain("bar"));
  assert.deepEqual(tags(rail), ["bar"]);
  assert.equal(calls(rail, "items_center").length, 1);
  assert.equal(arg(rail, "pt"), G.hair);
  assert.equal(calls(rail.kids[0], "h").length, 0, "the column takes its own height");
});

test("A Menu heading item is drawn like its title, so the Sort menu can name its orders and what it shows", async () => {
  const { menu, c } = await kit();
  const el = menu("m", { items: [{ heading: "Agents, pinned first, then by" }, { label: "Last update", icon: "check" }, { separator: true }, { heading: "Show" }] }, c);
  assert.equal(arg(el.kids[0], "child"), "Agents, pinned first, then by");
  assert.equal(arg(el.kids[0], "text_color"), c.dim);
  assert.equal(el.kids[1].tag, "m-1");
  assert.equal(arg(el.kids[3], "child"), "Show");
  assert.deepEqual(arg(menu("t", { title: "Show", items: [] }, c).kids[0], "child"), "Show");
});

test("The Toolbar and the Header draw no literal size", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-toolbar.js"), []);
  assert.deepEqual(numberArguments("kanso-panel/ui-sidebar-header.js"), []);
});
