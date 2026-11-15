// The kit a composition imports: the same pieces under the same name in the Storybook and the app, the app's drawing what its own piece draws.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, chain, gpuiHost } from "./helpers.mjs";
import { exportedNames } from "../scripts/mod-source.mjs";
import * as storybookKit from "../stories/kit/kit.js";
import * as storybookPieces from "../stories/kit/pieces.js";

const host = () => ({ ...gpuiHost(), svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; }, image: (path) => { const el = chain("image"); el.calls.push(["image", path]); return el; } });
const kits = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens"], host()),
  ...await load("kanso-panel/ui-row.js", ["row"], host()),
  ui: { ...await load("kanso-panel/ui-button.js", ["button"], host()), ...await load("kanso-panel/ui-menu.js", ["menu"], host()) },
  app: await load("kanso-panel/kit.js", ["row", "button", "menu"], host()),
});
const night = { foreground: "#d8d4cb", background: "#1b1b19", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f" };
// A drawing as plain data: handlers compare by kind, since each draw makes new ones.
const drawn = (el) => ({ tag: el.tag, calls: el.calls.map((call) => call.map((arg) => (typeof arg === "function" ? "handler" : arg?.calls ? "element" : arg))), kids: el.kids.map(drawn) });
const all = (el) => [el, ...el.kids.flatMap(all)];
const svgs = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "svg").map((call) => call[1]));
const ids = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "id").map((call) => call[1]));
const texts = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const press = (el, id) => {
  const tool = all(el).find((kid) => kid.tag === id);
  tool.calls.filter((call) => call[0] === "on_click").forEach(([, handler]) => handler({}, { stop_propagation: () => {} }));
};
const tools = [{ icon: "lu-pin", label: "Pin to the top" }, { icon: "lu-ellipsis", label: "More" }];

test("A row from the shared kit draws what the app's row draws with the same props", async () => {
  const { row, tokens, app } = await kits();
  const c = tokens(night);
  const props = { icon: "file", name: "checkout.ts", detail: ["src/api", { icon: "branch", text: "main" }], meta: "4m", mark: "working", depth: 1, current: true, hover: true, chip: 2, actions: [{ icon: "pin", label: "Pin to the top" }] };
  assert.deepEqual(drawn(app.row(props)("r", c)), drawn(row("r", c, props)));
});

test("A row from the shared kit takes the Storybook's Lucide icon names and draws the app's icons", async () => {
  const { row, tokens, app } = await kits();
  const c = tokens(night);
  const named = (prefix) => ({
    icon: `${prefix}file`, name: "a", flag: `${prefix}pin`, detail: { icon: `${prefix}folder`, text: "src" }, hover: true,
    actions: [{ icon: `${prefix}pin`, label: "Pin" }, { icon: `${prefix}ellipsis`, label: "More" }], action: { kind: "icon", icon: `${prefix}power`, label: "Turn on" },
  });
  const shared = svgs(app.row(named("lu-"))("r", c));
  assert.deepEqual(shared, svgs(row("r", c, named(""))));
  assert.ok(shared.every((path) => !path.includes("lu-")), shared.join(", "));
});

test("The app hands a composition's tools their handlers by name, without restating them", async () => {
  const { tokens, app } = await kits();
  const hits = [];
  const el = app.row({ name: "Atlas", hover: true, actions: tools, action: { label: "Wake", kind: "quiet" } })("r", tokens(night), {
    on: { ellipsis: () => hits.push("more"), "lu-pin": () => hits.push("pin"), Wake: () => hits.push("wake") },
    onClick: () => hits.push("row"),
  });
  press(el, "r-tool-1");
  press(el, "r-tool-0");
  press(el, "r-action");
  assert.deepEqual(hits, ["more", "pin", "wake"]);
  el.calls.filter((call) => call[0] === "on_click").forEach(([, handler]) => handler({}, {}));
  assert.deepEqual(hits.at(-1), "row");
});

test("The app gives a shared piece only handlers, each for a tool it has, and a missing one leaves the piece as it is", async () => {
  const { tokens, app } = await kits();
  const c = tokens(night);
  const atlas = app.row({ name: "Atlas", meta: "4m", hover: true, actions: tools });
  assert.throws(() => atlas("r", c, { meta: "now" }), /only handlers, not meta/);
  assert.throws(() => atlas("r", c, { on: { search: () => {} } }), /r has no tool search/);
  assert.deepEqual(drawn(atlas("r", c, { onClick: undefined })), drawn(atlas("r", c)));
  assert.ok(texts(atlas("r", c, { onHover: undefined })).includes("Atlas"));
});

test("A piece inside a shared row is drawn by that row, with its own id and the same colours", async () => {
  const { row, tokens, app } = await kits();
  const c = tokens(night);
  const el = app.row({ name: "Atlas", start: [app.row({ name: "lead" })], tools: [app.row({ name: "tail" })] })("r", c);
  assert.ok(ids(el).includes("r-start-0") && ids(el).includes("r-tools-0"), ids(el).join(", "));
  const inner = all(el).find((kid) => ids(kid)[0] === "r-tools-0");
  assert.deepEqual(drawn(inner), drawn(row("r-tools-0", c, { name: "tail" })));
});

test("A shared row takes no piece, one piece or a list of them before its icon and at its end, as the Storybook's row does", async () => {
  const { row, tokens, app } = await kits();
  const c = tokens(night);
  assert.deepEqual(drawn(app.row({ name: "t", title: true, start: null, tools: undefined })("r", c)), drawn(row("r", c, { name: "t", title: true })));
  const single = app.row({ name: "t", start: app.row({ name: "back" }), tools: [[app.row({ name: "a" })], false, app.row({ name: "b" })] })("r", c);
  assert.deepEqual(["r-start-0", "r-tools-0", "r-tools-1"].filter((id) => ids(single).includes(id)), ["r-start-0", "r-tools-0", "r-tools-1"]);
});

test("A button from the shared kit draws what the app's button draws, its Lucide icon the app's and its press the handler given", async () => {
  const { tokens, ui, app } = await kits();
  const c = tokens(night);
  const hits = [];
  const onClick = () => hits.push("add");
  const shared = app.button({ label: "Add project", kind: "icon", size: "lg", icon: "lu-plus", active: true })("b", c, { onClick });
  assert.deepEqual(drawn(shared), drawn(ui.button("b", "Add project", onClick, c, { kind: "icon", size: "lg", icon: "plus", active: true })));
  shared.calls.filter((call) => call[0] === "on_click").forEach(([, handler]) => handler({}, {}));
  assert.deepEqual(hits, ["add"]);
  assert.deepEqual(svgs(app.button({ label: "Wake", kind: "quiet" })("w", c)), [], "no icon is the Storybook's none");
  assert.throws(() => app.button({ label: "Sort" })("s", c, { label: "Order" }), /only handlers, not label/);
});

test("An app-only prop such as a button's colour passes through the shared kit as the row's do", async () => {
  const { tokens, ui, app } = await kits();
  const c = tokens(night);
  const props = { kind: "icon", size: "lg", color: c.dim };
  assert.deepEqual(drawn(app.button({ label: "Sort", icon: "lu-arrow-up-down", ...props })("s", c)), drawn(ui.button("s", "Sort", null, c, { icon: "arrow-up-down", ...props })));
});

test("A menu from the shared kit draws what the app's menu draws, its items' Lucide icons the app's and each item its own press", async () => {
  const { tokens, ui, app } = await kits();
  const c = tokens(night);
  const pick = () => {};
  const items = (prefix) => [{ heading: "Show" }, { label: "Last update", icon: `${prefix}check`, onClick: pick }, { separator: true }, { label: "Your order" }];
  const shared = app.menu({ title: "Sort", items: items("lu-") })("m", c);
  assert.deepEqual(drawn(shared), drawn(ui.menu("m", { title: "Sort", items: items("") }, c)));
  assert.ok(svgs(shared).every((path) => !path.includes("lu-")), svgs(shared).join(", "));
  assert.throws(() => app.menu({ items: [] })("m", c, { title: "Sort" }), /only handlers, not title/);
});

test("The Storybook's shared kit is its pieces, and the app's has only Storybook pieces", (t) => {
  assert.deepEqual(Object.keys(storybookKit).sort(), Object.keys(storybookPieces).sort());
  const app = exportedNames(readFileSync(new URL("../kanso/mods/kanso-panel/kit.js", import.meta.url), "utf8"));
  const storybook = Object.entries(storybookKit).filter(([, value]) => typeof value === "function").map(([name]) => name);
  assert.deepEqual(app.filter((name) => !storybook.includes(name)), [], "the app's shared kit exports only Storybook pieces");
  const gap = storybook.filter((name) => !app.includes(name));
  t.diagnostic(`In the app's shared kit (${app.length}): ${app.join(", ")}; not yet (${gap.length}): ${gap.join(", ")}`);
});
