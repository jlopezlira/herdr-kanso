import test from "node:test";
import assert from "node:assert/strict";
import { compile, indexed, reachable, read, SHEETS } from "../scripts/css-to-gpui.mjs";
import { viewOf, stylesFor } from "../kanso/mods/kanso-panel/ui-match.js";
import { toHtml } from "../stories/kit/tree.js";
import { doorActs, statedPages, tabActs } from "../stories/kit/states.js";
import { panelDoors } from "../stories/kit/compositions.js";
import { tabBar } from "../stories/kit/tab-bar.js";
import { tabBarTree } from "../stories/kit/tab-bar-tree.js";
import { gpuiHost, load, calls, arg, kansoColours } from "./helpers.mjs";

const rules = indexed(reachable(compile(SHEETS.map(read).join("\n")).rules));
const page = statedPages["Compositions/Tab bar"];
const tabItems = (value) => [{ key: "checkout", label: "checkout" }, { key: "cart-ui", label: "cart-ui", mark: value === "cart-ui" ? "" : "blocked" }, { key: "tests", label: "tests" }];
const propsOf = ({ args }) => {
  const { value, tab, door, folded, overflow, state, panel, windows, help, focus, custom } = { ...page.args, ...args };
  return { items: tabActs[tab](tabItems(value)), value, overflow, state, panel, windows, help, focus,
    folded: Array.from({ length: folded }, (_, i) => ({ key: `f${i}`, label: `f${i}` })), panels: doorActs[door](custom ? [...panelDoors, { key: "notes", label: "Notes" }] : panelDoors) };
};
const storyOf = ({ folded = [], panels = panelDoors, ...props }) => tabBar({ ...props, folded, panels }).replace(/ onclick="[^"]*"/g, "")
  .replace(/<div class="kanso-field kanso-field--inline">.*?<\/div><\/div>/, '<div class="kanso-field kanso-field--inline"></div>');
const treeOf = (props) => tabBarTree({ panels: panelDoors, ...props });
const appButton = async () => ({ ...(await load("kanso-panel/ui-button.js", ["button"], gpuiHost())), c: await kansoColours() });

test("Every state on the Tab bar page is the same markup as the Storybook's, with the folded menu open where the story opens it, the field renaming a tab being the Field's own", () => {
  assert.ok(page.states.some(({ args }) => args.tab === "renaming"));
  assert.ok(page.states.some(({ args }) => args.overflow && args.folded), "a state opens the folded menu");
  for (const state of page.states) assert.equal(toHtml(treeOf(propsOf(state))), storyOf(propsOf(state)), state.label);
});

test("The app always shows kansō help's door: every state on the page with it is the story with that door and nothing else changed", () => {
  for (const state of page.states) {
    const props = { ...propsOf(state), help: true };
    const story = storyOf(props);
    assert.equal(toHtml(treeOf(props)), story, state.label);
    if (props.state === "connecting" || props.state === "unreachable" || propsOf(state).help) continue;
    assert.equal(story.replace(/<span class="kanso-button kanso-button--icon[^"]*" tabindex="0" title="kansō help">.*?<\/span>/, ""), storyOf(propsOf(state)), `${state.label}: only the door`);
  }
});

test("A door being dragged is held on the pressed wash with the accent bar where it lands, and the keyboard's door has its ring, as the compiled CSS draws them", async () => {
  const { button, c } = await appButton();
  const dragging = page.states.find(({ label }) => label === "Dragging a door");
  const doors = viewOf(treeOf(propsOf(dragging)))[0].children.at(-1).children;
  const held = doors.find((node) => node.classes.includes("kanso-control--held"));
  assert.equal(held.attrs.title, "Ports");
  const bar = doors.findIndex((node) => node.classes.includes("kanso-tab-bar__insertion"));
  assert.equal(doors[bar + 1].attrs.title, "Spend", "the bar lands before Spend");
  const drawn = button("d", "Ports", () => {}, c, { kind: "icon", icon: "plug", held: true });
  assert.equal(arg(drawn, "bg"), c[Object.fromEntries(stylesFor(held, rules)).bg.colour], "the held door's wash");
  const keyboard = page.states.find(({ label }) => label === "kansō help, keyboard");
  const help = viewOf(treeOf(propsOf(keyboard)))[0].children.at(-1).children.at(-1);
  assert.ok(help.classes.includes("kanso-control--focus"));
  const ringed = button("h", "kansō help", () => {}, c, { kind: "icon", icon: "circle-question-mark", focus: true });
  assert.equal(arg(ringed, "border_color"), c.accent, "the accent ring a focused door draws");
});

test("A tab dragged right lands after the last one, in both kits", () => {
  const items = [{ key: "a", label: "a" }, { key: "b", label: "b", drop: "after" }];
  assert.equal(toHtml(treeOf({ items, value: "a" })), storyOf({ items, value: "a" }));
  assert.match(toHtml(treeOf({ items, value: "a" })), /<\/span><i class="kanso-tabs__insertion"><\/i><\/div>/);
});

test("Each tab in each state is drawn from the CSS compiled for its node", async () => {
  const { tab } = await load("kanso-panel/ui-tab.js", ["tab"], gpuiHost());
  const c = await kansoColours();
  const ink = (value) => (value?.colour === undefined ? value : value.share === undefined ? c[value.colour] : undefined);
  const field = { state: {}, value: () => "checkout", focused: false, multiline: false };
  for (const state of page.states.filter(({ args }) => args.state !== "connecting")) {
    const props = propsOf(state);
    const items = props.items.map((item) => ({ closable: true, ...item, ...(item.editing ? { editing: field } : {}) }));
    const tree = treeOf(props);
    const list = viewOf(tree)[0].children[0];
    const drawn = tab("t", items, props.value, null, c, { track: false, size: "md", bar: true, disabled: props.state === "unreachable",
      on: Object.fromEntries(items.map(({ key }) => [key, { onClose: () => {} }])) });
    const tabs = drawn.kids.filter((kid) => calls(kid, "set_position").length);
    const nodes = list.children.filter((node) => node.classes.includes("kanso-tabs__tab"));
    assert.equal(tabs.length, nodes.length, state.label);
    nodes.forEach((node, i) => {
      const want = Object.fromEntries(stylesFor(node, rules).filter(([op]) => ["h", "rounded", "gap", "text_size", "bg", "text_color", "opacity"].includes(op)));
      for (const [op, value] of Object.entries(want)) assert.deepEqual(arg(tabs[i], op), ink(value), `${state.label}, ${node.classes.join(".")}: ${op}`);
    });
  }
});

test("Connecting draws a skeleton per known tab at the size the compiled CSS gives each, the first long and the rest short", async () => {
  const { tabSkeleton } = await load("kanso-panel/ui-skeleton.js", ["tabSkeleton"], gpuiHost());
  const c = await kansoColours();
  const state = page.states.find(({ args }) => args.state === "connecting");
  const props = propsOf(state);
  const skeletons = viewOf(treeOf(props))[0].children.filter((node) => node.classes.includes("kanso-tab-bar__skeleton"));
  assert.equal(skeletons.length, props.items.length);
  skeletons.forEach((node, i) => {
    const want = Object.fromEntries(stylesFor(node, rules).filter(([op]) => ["w", "h", "rounded"].includes(op)));
    const drawn = tabSkeleton(`s${i}`, c, i);
    for (const [op, value] of Object.entries(want)) assert.equal(arg(drawn, op), value, `skeleton ${i}: ${op}`);
  });
});

test("A door is the app's icon Button with the size, radius, ink and open wash the compiled CSS gives the Storybook's door", async () => {
  const { button, c } = await appButton();
  const tree = treeOf({ items: [], value: null, folded: 0, panel: "pr" });
  const doors = viewOf(tree)[0].children.at(-1).children;
  for (const node of doors) {
    const open = node.classes.includes("kanso-button--active");
    const ops = Object.fromEntries(stylesFor(node, rules));
    const drawn = button("d", node.attrs.title, () => {}, c, { kind: "icon", icon: "file", active: open });
    for (const op of ["w", "h", "rounded"]) assert.equal(arg(drawn, op), ops[op], `${node.attrs.title}: ${op}`);
    assert.equal(arg(drawn.kids[0], "size"), Object.fromEntries(stylesFor(node.children[0], rules)).w, `${node.attrs.title}: its icon`);
    assert.equal(arg(drawn, "bg"), open ? c[ops.bg.colour] : undefined, `${node.attrs.title}: its wash`);
    assert.equal(arg(drawn.kids[0], "text_color"), c[ops.text_color.colour], `${node.attrs.title}: its ink`);
  }
});

test("A door with no icon is a quiet Button with its name, in both kits", () => {
  const panels = [{ key: "notes", label: "Notes" }];
  const story = tabBar({ items: [], panels });
  assert.match(story, /<span class="kanso-button kanso-button--quiet kanso-text--fg" tabindex="0" title="Notes">Notes<\/span>/);
  assert.equal(toHtml(tabBarTree({ items: [], panels })), story);
});
