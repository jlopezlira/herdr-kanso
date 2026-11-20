import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, chain, calls, arg, find, all, repoText, KIT_NIGHT } from "./helpers.mjs";
import { loadTokens } from "../scripts/tokens.mjs";
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
  const drifted = layoutText.replace('"px": 368', '"px": 372');
  assert.notEqual(layoutWithTokens(drifted, tokens), drifted, "a number changed by hand");
  const moved = structuredClone(tokens);
  moved.layout.find((t) => t.name === "k-w-panel-max").value = "960px";
  assert.match(layoutWithTokens(layoutText, moved), /"max": 960/, "a token changed, the file follows it");
  assert.notEqual(layoutWithTokens(layoutText, moved), layoutText);
});

test("The window's new tokens hold the sizes the layout file had", () => {
  const size = px(tokens);
  assert.deepEqual(["k-w-panel-min", "k-w-panel-max", "k-w-sidebar-layout-min", "k-w-sidebar-max", "k-h-spaces-min"].map(size), [280, 900, 200, 480, 90]);
  assert.deepEqual(["k-terminal-x", "k-terminal-y", "k-traffic-x", "k-traffic-y"].map(size), [14, 10, 12, 16]);
});

const sidebar = async () => {
  const { Spaces, tokens: kit } = await load("kanso-spaces/main.js", ["Spaces", "tokens"], { ...gpuiHost(), theme: () => KIT_NIGHT });
  return { view: new Spaces(), c: kit(KIT_NIGHT) };
};
const withId = (root, id) => find(root, (el) => calls(el, "id").some((call) => call[1] === id));

test("The active project's pill in the list and its tile in the rail wear wash-12; another tile none", async () => {
  const { view, c } = await sidebar();
  const row = chain("row");
  const list = view.list(KIT_NIGHT, false, "spaces", [{ el: row, h: 32, mark: { kind: "space", at: 0, h: 32 } }]);
  assert.equal(arg(withId(list, "pill-space"), "bg"), c.w12);
  const tile = (open) => find(view.railTile(c, "space-s1", { initial: "K", tone: "teal", rows: [], label: "kanso", open }), (el) => el.tag === "space-s1");
  assert.equal(arg(tile(true), "bg"), c.w12);
  assert.equal(calls(tile(false), "bg").length, 0);
});

test("A chosen tab wears the selection's wash-12, as the active project and the focused pane header do, on a track too", async () => {
  const { tab } = await load("kanso-panel/ui-tab.js", ["tab"], gpuiHost());
  const c = (await load("kanso-panel/ui.js", ["tokens"], gpuiHost())).tokens(KIT_NIGHT);
  const items = [{ key: "a", label: "checkout" }, { key: "b", label: "tests" }];
  const [chosen, other] = tab("t", items, "a", null, c, { track: false, size: "md" }).kids;
  assert.equal(arg(chosen, "bg"), c.w12);
  assert.equal(calls(other, "bg").length, 0);
  assert.equal(arg(tab("t", items, "a", null, c, { track: true, size: "md" }).kids[0], "bg"), c.w12);
});

test("No hand-mixed wash is left on the project's pill and the rail tile", () => {
  assert.doesNotMatch(repoText("kanso/mods/kanso-spaces/main.js"), /TINT\.pill/);
});
