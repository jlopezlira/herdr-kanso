// The window's sizes come from the layout tokens, and one chosen wash marks the active project, the chosen tab and the focused pane header.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, chain, calls, arg, find, all, repoText, KIT_NIGHT } from "./helpers.mjs";
import { loadTokens, THEME_FILES } from "../scripts/tokens.mjs";
import { LAYOUT, LAYOUT_SIZES, layoutWithTokens, layoutSizes, nodesOf, px } from "../scripts/build-ui-tokens.mjs";

const tokens = loadTokens();
const layoutText = repoText(LAYOUT);
const at = (node, path) => path.split(".").reduce((value, key) => value?.[key], node);

// Every number in a node but its children, as "path": value; a weight shares the room and is no size.
const numbersIn = (value, path = "") => (typeof value === "number" ? [[path, value]]
  : value && typeof value === "object" ? Object.entries(value).filter(([key]) => key !== "children").flatMap(([key, v]) => numbersIn(v, path ? `${path}.${key}` : key)) : []);

test("Each size in kanso.json is its layout token", () => {
  for (const { node, path, token, value } of layoutSizes(JSON.parse(layoutText), tokens)) assert.equal(at(node, path), value, `${node.id} ${path} is ${token}`);
  assert.equal(layoutWithTokens(layoutText, tokens), layoutText, "npm run build:ui-tokens leaves kanso.json as it is");
});

test("No size in kanso.json is a bare number: each one but a weight or a zero has its token", () => {
  const tree = JSON.parse(layoutText);
  const bare = nodesOf(tree).flatMap((node) => numbersIn(node)
    .filter(([path, value]) => value !== 0 && !path.endsWith("weight") && !LAYOUT_SIZES[node.id]?.[path])
    .map(([path, value]) => `${node.id} ${path}: ${value}`));
  assert.deepEqual(bare, []);
});

test("A size that drifts from its token fails: in the file or in the token", () => {
  const drifted = layoutText.replace('"px": 156', '"px": 160');
  assert.notEqual(layoutWithTokens(drifted, tokens), drifted, "a number changed by hand");
  const moved = structuredClone(tokens);
  moved.layout.find((t) => t.name === "k-w-panel-max").value = "960px";
  assert.match(layoutWithTokens(layoutText, moved), /"max": 960/, "a token changed, the file follows it");
  assert.notEqual(layoutWithTokens(layoutText, moved), layoutText);
});

test("The window's new tokens hold the sizes the layout file had", () => {
  const size = px(tokens);
  assert.deepEqual(["k-h-sidebar-footer", "k-w-panel-min", "k-w-panel-max", "k-w-sidebar-layout-min", "k-w-sidebar-max", "k-h-spaces-min"].map(size), [156, 280, 900, 200, 480, 90]);
  assert.deepEqual(["k-terminal-x", "k-terminal-y", "k-traffic-x", "k-traffic-y"].map(size), [14, 10, 12, 16]);
});

// The chosen wash: the foreground at 12% over the pane's ground is the theme's own selected colour, so the focused pane header does not change
// (within one step of a channel: the wash is drawn as an alpha byte, 31/255).
const over = (fg, bg, share) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * share + parseInt(bg.slice(i, i + 2), 16) * (1 - share)).toString(16).padStart(2, "0")).join("")}`;

test("The chosen wash over a pane is the theme's selected colour in the dark and the light theme", async () => {
  const { tokens: kit } = await load("kanso-panel/ui.js", ["tokens"], gpuiHost());
  for (const path of Object.values(THEME_FILES)) {
    const theme = JSON.parse(repoText(path));
    const c = kit({ ...theme.colors, foreground: theme.foreground, background: theme.background });
    const share = parseInt(c.chosen.slice(7), 16) / 255;
    assert.equal(c.chosen.slice(0, 7), theme.foreground, path);
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const drawn = channels(over(theme.foreground, theme.background, share)), selected = channels(theme.colors.selected);
    assert.ok(drawn.every((v, i) => Math.abs(v - selected[i]) <= 1), `${path}: ${drawn} against ${selected}`);
  }
});

const sidebar = async () => {
  const { Spaces, tokens: kit } = await load("kanso-spaces/main.js", ["Spaces", "tokens"], { ...gpuiHost(), theme: () => KIT_NIGHT });
  return { view: new Spaces(), c: kit(KIT_NIGHT) };
};
const withId = (root, id) => find(root, (el) => calls(el, "id").some((call) => call[1] === id));

test("The active project's pill in the list and its tile in the rail wear the chosen wash; another tile none", async () => {
  const { view, c } = await sidebar();
  const row = chain("row");
  const list = view.list(KIT_NIGHT, false, "spaces", [{ el: row, h: 32, mark: { kind: "space", at: 0, h: 32 } }]);
  assert.equal(arg(withId(list, "pill-space"), "bg"), c.chosen);
  const tile = (on) => withId(view.railMark(KIT_NIGHT, c, "space-s1", { lead: chain("lead"), rows: [], tip: "kanso", on }), "space-s1");
  assert.equal(arg(tile(true), "bg"), c.chosen);
  assert.equal(all(tile(false), (el) => calls(el, "bg").length > 0).length, 0);
});

test("The tab bar's chosen tab, alone and as the gliding pill, wears the chosen wash", async () => {
  const { tabItem, tabPill } = await load("kanso-panel/ui-tab.js", ["tabItem", "tabPill"], gpuiHost());
  const c = (await load("kanso-panel/ui.js", ["tokens"], gpuiHost())).tokens(KIT_NIGHT);
  const item = (on, bar) => tabItem("t", { key: "a", label: "checkout" }, c, { on, track: false, size: "md", bar });
  assert.equal(arg(item(true, true), "bg"), c.chosen);
  assert.equal(arg(tabPill(c), "bg"), c.chosen);
  assert.equal(calls(item(false, true), "bg").length, 0);
  assert.equal(arg(item(true, false), "bg"), c.w7, "a tab group outside the bar keeps the Storybook's tabs wash");
});

test("The Storybook draws the active project, its rail tile, the chosen tab and the focused pane header with the same wash token", () => {
  const css = repoText("stories/primitives.css");
  for (const selector of [".kanso-project.kanso-control--on", ".kanso-rail__tile.kanso-control--on", ".kanso-tab.kanso-control--on", ".kanso-tab--rest.kanso-control--on", ".kanso-pane-header.kanso-pane-header--focus"]) {
    const rule = new RegExp(`${selector.replace(/[.-]/g, (ch) => `\\${ch}`)}\\{background:([^;}]+)`).exec(css);
    assert.equal(rule?.[1], "var(--wash-chosen)", selector);
  }
  for (const theme of ["dark", "light"]) assert.equal(tokens.colour[theme].find((t) => t.name === "wash-chosen").value, "color-mix(in srgb, var(--fg) 12%, transparent)");
});

test("No hand-mixed wash is left on the three: the project's pill, the rail tile, the tab and the pane header read c.chosen", () => {
  const spaces = repoText("kanso/mods/kanso-spaces/main.js"), strip = repoText("kanso/mods/kanso-strip/main.js"), tab = repoText("kanso/mods/kanso-panel/ui-tab.js");
  assert.doesNotMatch(spaces, /TINT\.pill/);
  assert.doesNotMatch(strip, /el\.bg\(c\.selected\)/);
  assert.match(tab, /bar \? c\.chosen : c\.w7/);
  assert.match(tab, /tabPill = [^\n]*\.bg\(c\.chosen\)/);
});
