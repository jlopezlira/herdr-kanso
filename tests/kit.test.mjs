// The kit a composition imports: the same pieces under the same name in the Storybook and the app, the app's drawing what its own piece draws.
import { loadTokens, loadRow, loadMenu } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, nodes, texts, press, themed, KIT_NIGHT, drawingHost, drawn, gpuiHost } from "./helpers.mjs";
import { exportedNames } from "../scripts/mod-source.mjs";
import * as storybookKit from "../stories/kit/kit.js";
import * as storybookPieces from "../stories/kit/pieces.js";

const host = drawingHost;
const kits = async () => themed({
  ...await loadTokens(host()),
  ...await loadRow(host()),
  ui: { ...await load("kanso-panel/ui-button.js", ["button"], host()), ...await loadMenu(host()), ...await load("kanso-panel/ui-toast.js", ["toast"], host()) },
  app: await load("kanso-panel/kit.js", ["row", "button", "menu", "toast"], host()),
}, night);
const night = KIT_NIGHT;
const svgs = (el) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "svg").map((call) => call[1]));
const ids = (el) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "id").map((call) => call[1]));
const tools = [{ icon: "lu-pin", label: "Pin to the top" }, { icon: "lu-ellipsis", label: "More" }];

test("A row from the shared kit draws what the app's row draws with the same props", async () => {
  const { row, app, c } = await kits();
  const props = { icon: "file", name: "checkout.ts", detail: ["src/api", { icon: "git-branch", text: "main" }], meta: "4m", mark: "working", depth: 1, current: true, hover: true, chip: 2, actions: [{ icon: "pin", label: "Pin to the top" }] };
  assert.deepEqual(drawn(app.row(props)("r", c)), drawn(row("r", c, props)));
});

test("A row from the shared kit takes the Storybook's Lucide icon names and draws the app's icons", async () => {
  const { row, app, c } = await kits();
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
  const { app, c } = await kits();
  const atlas = app.row({ name: "Atlas", meta: "4m", hover: true, actions: tools });
  assert.throws(() => atlas("r", c, { meta: "now" }), /only handlers, not meta/);
  assert.throws(() => atlas("r", c, { on: { search: () => {} } }), /r has no tool search/);
  assert.deepEqual(drawn(atlas("r", c, { onClick: undefined })), drawn(atlas("r", c)));
  assert.ok(texts(atlas("r", c, { onHover: undefined })).includes("Atlas"));
});

test("A piece inside a shared row is drawn by that row, with its own id and the same colours", async () => {
  const { row, app, c } = await kits();
  const el = app.row({ name: "Atlas", start: [app.row({ name: "lead" })], tools: [app.row({ name: "tail" })] })("r", c);
  assert.ok(ids(el).includes("r-start-0") && ids(el).includes("r-tools-0"), ids(el).join(", "));
  const inner = nodes(el).find((kid) => ids(kid)[0] === "r-tools-0");
  assert.deepEqual(drawn(inner), drawn(row("r-tools-0", c, { name: "tail" })));
});

test("A shared row takes no piece, one piece or a list of them before its icon and at its end, as the Storybook's row does", async () => {
  const { row, app, c } = await kits();
  assert.deepEqual(drawn(app.row({ name: "t", title: true, start: null, tools: undefined })("r", c)), drawn(row("r", c, { name: "t", title: true })));
  const single = app.row({ name: "t", start: app.row({ name: "back" }), tools: [[app.row({ name: "a" })], false, app.row({ name: "b" })] })("r", c);
  assert.deepEqual(["r-start-0", "r-tools-0", "r-tools-1"].filter((id) => ids(single).includes(id)), ["r-start-0", "r-tools-0", "r-tools-1"]);
});

test("The app gives a shared row its press, release and right-click, and a program's own art passes through as its icon", async () => {
  const { app, c } = await kits();
  const hits = [];
  const el = app.row({ name: "Atlas", icon: { icon: "programs/codex.png", tint: false } })("r", c, {
    onPress: () => hits.push("press"), onRelease: () => hits.push("release"), onMenu: () => hits.push("menu"),
  });
  const mouse = (name, button) => el.calls.filter((call) => call[0] === name && call[1] === button).forEach(([, , handler]) => handler({}, {}));
  mouse("on_mouse_down", "left");
  mouse("on_mouse_up", "left");
  mouse("on_mouse_down", "right");
  assert.deepEqual(hits, ["press", "release", "menu"]);
  assert.equal(nodes(el).filter((kid) => kid.calls.some((call) => call[0] === "svg")).length, 0, "art is not drawn as a glyph");
});

test("A button from the shared kit draws what the app's button draws, its Lucide icon the app's and its press the handler given", async () => {
  const { ui, app, c } = await kits();
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
  const { ui, app, c } = await kits();
  const props = { kind: "icon", size: "lg", color: c.dim };
  assert.deepEqual(drawn(app.button({ label: "Sort", icon: "lu-arrow-up-down", ...props })("s", c)), drawn(ui.button("s", "Sort", null, c, { icon: "arrow-up-down", ...props })));
});

test("A menu from the shared kit draws what the app's menu draws, its items' Lucide icons the app's and each item its own press", async () => {
  const { ui, app, c } = await kits();
  const pick = () => {};
  const items = (prefix) => [{ heading: "Show" }, { label: "Last update", icon: `${prefix}check`, onClick: pick }, { separator: true }, { label: "Your order" }];
  const shared = app.menu({ title: "Sort", items: items("lu-") })("m", c);
  assert.deepEqual(drawn(shared), drawn(ui.menu("m", { title: "Sort", items: items("") }, c)));
  assert.ok(svgs(shared).every((path) => !path.includes("lu-")), svgs(shared).join(", "));
  assert.throws(() => app.menu({ items: [] })("m", c, { title: "Sort" }), /only handlers, not title/);
});

test("A toast from the shared kit draws what the app's toast draws, its Lucide icon the app's and its press the handler given", async () => {
  const { ui, app, c } = await kits();
  const props = { level: "success", title: "kansō updated", action: "Restart", detail: "3.31.0", tone: "muted" };
  const hits = [];
  const onClick = () => hits.push("home");
  const shared = app.toast({ ...props, icon: "lu-refresh-cw" })("t", c, { onClick });
  assert.deepEqual(drawn(shared), drawn(ui.toast("t", c, { ...props, icon: "refresh-cw", onClick })));
  press(shared, "t-fix");
  assert.deepEqual(hits, ["home"]);
  assert.deepEqual(svgs(app.toast({ title: "Saved" })("t", c)), [], "no icon is the Storybook's none: the level's dot");
  assert.throws(() => app.toast({ title: "Saved" })("t", c, { title: "Gone" }), /only handlers, not title/);
});

test("A toast draws the Storybook's sentence at body size, its second line and its Explain button", async () => {
  const { app, c } = await kits();
  const { T } = await load("kanso-panel/ui.js", ["T"], host());
  const props = { title: "Failed", body: "Details", explain: "Claude", action: "Retry" };
  const el = app.toast(props)("t", c);
  assert.ok(storybookPieces.toast(props).includes("Explain to Claude"));
  assert.deepEqual(texts(el), ["Failed", "Details", "Retry", "Explain to Claude"]);
  assert.deepEqual(nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "text_size").map((call) => call[1])).slice(0, 2), [T.value, T.body]);
  assert.ok(svgs(el).some((path) => path.endsWith("bot.svg")));
});

test("The Storybook's shared kit is its pieces, and the app's has only Storybook pieces", (t) => {
  assert.deepEqual(Object.keys(storybookKit).sort(), Object.keys(storybookPieces).sort());
  const app = exportedNames(readFileSync(new URL("../kanso/mods/kanso-panel/kit.js", import.meta.url), "utf8"));
  const storybook = Object.entries(storybookKit).filter(([, value]) => typeof value === "function").map(([name]) => name);
  assert.deepEqual(app.filter((name) => !storybook.includes(name)), [], "the app's shared kit exports only Storybook pieces");
  const gap = storybook.filter((name) => !app.includes(name));
  t.diagnostic(`In the app's shared kit (${app.length}): ${app.join(", ")}; not yet (${gap.length}): ${gap.join(", ")}`);
});

test("A Button's name reaches its press as written, even when it reads like an icon", async () => {
  const { button } = await load("kanso-panel/kit.js", ["button"], gpuiHost());
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const pressed = [];
  const drawn = button({ name: "lu-notes", label: "Notes", kind: "quiet" })("custom", tokens({}), { presses: { "lu-notes": () => pressed.push("notes") } });
  drawn.calls.find(([op]) => op === "on_click").at(-1)({}, {});
  assert.deepEqual(pressed, ["notes"]);
  assert.throws(() => button({ name: "lu-notes", label: "Notes", kind: "quiet" })("custom", tokens({}), { presses: { notes: () => {} } }), /has no tool notes/, "a name is not rewritten into another");
});
