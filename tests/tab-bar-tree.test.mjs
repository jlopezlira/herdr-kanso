// The tab bar's tree is the Storybook's markup in every state on its page, and the app draws each tab from the CSS compiled for it.
import test from "node:test";
import assert from "node:assert/strict";
import { compile, indexed, kansoTheme, reachable, read, SHEETS } from "../scripts/css-to-gpui.mjs";
import { viewOf, stylesFor } from "../kanso/mods/kanso-panel/ui-match.js";
import { toHtml } from "../stories/kit/tree.js";
import { statedPages, tabActs } from "../stories/kit/states.js";
import { panelDoors } from "../stories/kit/compositions.js";
import { tabBar } from "../stories/kit/tab-bar.js";
import { tabBarTree } from "../stories/kit/tab-bar-tree.js";
import { gpuiHost, load, calls, arg } from "./helpers.mjs";

const rules = indexed(reachable(compile(SHEETS.map(read).join("\n")).rules));
const page = statedPages["Compositions/Tab bar"];
const tabItems = (value) => [{ key: "checkout", label: "checkout" }, { key: "cart-ui", label: "cart-ui", mark: value === "cart-ui" ? "" : "blocked" }, { key: "tests", label: "tests" }];
const propsOf = ({ args }) => {
  const { value, tab, folded, state, panel, windows, help } = { ...page.args, ...args };
  return { items: tabActs[tab](tabItems(value)), value, folded, state, panel, windows, help };
};
// The Storybook's tab carries its own click script, and a folded menu hangs from +N: the app draws neither in the bar's tree.
const storyOf = ({ items, value, folded, state, panel, windows, help }) => tabBar({ items, value, state, panel, windows, help, panels: panelDoors,
  folded: Array.from({ length: folded }, (_, i) => ({ key: `f${i}`, label: `f${i}` })) }).replace(/ onclick="[^"]*"/g, "");
const treeOf = (props) => tabBarTree({ ...props, panels: panelDoors });

test("Every state on the Tab bar page, but renaming, is the same markup as the Storybook's", () => {
  const states = page.states.filter(({ args }) => args.tab !== "renaming");
  assert.equal(states.length, page.states.length - 1);
  for (const state of states) assert.equal(toHtml(treeOf(propsOf(state))), storyOf(propsOf(state)), state.label);
});

test("A tab dragged right lands after the last one, in both kits", () => {
  const items = [{ key: "a", label: "a" }, { key: "b", label: "b", drop: "after" }];
  assert.equal(toHtml(treeOf({ items, value: "a" })), storyOf({ items, value: "a", folded: 0 }));
  assert.match(toHtml(treeOf({ items, value: "a" })), /<\/span><i class="kanso-tabs__insertion"><\/i><\/div>/);
});

test("Each tab in each state is drawn from the CSS compiled for its node", async () => {
  const { tab } = await load("kanso-panel/ui-tab.js", ["tab"], gpuiHost());
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const theme = kansoTheme();
  const c = tokens({ ...theme, ...theme.colors });
  const ink = (value) => (value?.colour === undefined ? value : value.share === undefined ? c[value.colour] : undefined);
  for (const state of page.states.filter(({ args }) => !["renaming", "connecting"].includes(args.tab ?? args.state))) {
    const props = propsOf(state);
    const tree = treeOf(props);
    const list = viewOf(tree)[0].children[0];
    const items = props.items.map((item) => ({ closable: true, ...item }));
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

test("A door is the app's icon Button with the size, radius, ink and open wash the compiled CSS gives the Storybook's door", async () => {
  const { button } = await load("kanso-panel/ui-button.js", ["button"], gpuiHost());
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const theme = kansoTheme();
  const c = tokens({ ...theme, ...theme.colors });
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
