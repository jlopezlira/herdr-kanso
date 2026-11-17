// The tab bar as the Storybook draws its tabs: chosen, at rest and waiting, close armed, renaming, dragging, folded, connecting and unreachable.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, chain, gpuiHost, calls, arg, find, all, CHROME_NIGHT, fieldWith, texts } from "./helpers.mjs";

const night = CHROME_NIGHT;
const model = () => load("kanso-tabs/tab-bar-model.js", ["tabMark", "barState", "foldTabs", "pillAt", "dropSide", "renameWaits"]);
const TABS = [
  { id: "t1", index: 1, name: "checkout", active: true, status: "working" },
  { id: "t2", index: 2, name: "cart-ui", active: false, status: "blocked" },
  { id: "t3", index: 3, name: "tests", active: false, status: "done" },
];

// One bar, drawn by the real view against a fake Herdr; `space.tabs` is what Herdr reports now.
async function bar({ tabs = TABS, machine = null, computers = [], panes = [], fails = null } = {}) {
  const store = {}, ran = [], toasts = [], opened = [];
  const space = { id: "s1", active: true, machine, tabs: clone(tabs) };
  const host = {
    ...gpuiHost(), Popover: { new: (id) => chain(id) },
    InputState: { new: fieldWith },
    theme: () => night, spaces: () => [space], panes: () => panes, machines: () => computers,
    layout: () => null, home: () => "/home/me", shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
    run: (cmd, args) => { if (cmd === fails) throw new Error("refused"); ran.push([cmd, args]); }, notify: (note) => { toasts.push(note); }, openOverlay: (spec) => { opened.push(spec); },
  };
  const { Tabs, tokens, W } = await load("kanso-tabs/main.js", ["Tabs", "tokens", "W"], host);
  const { PENDING } = await load("kanso-tabs/ui-state.js", ["PENDING"], gpuiHost());
  const view = new Tabs();
  const cx = { stop_propagation() {}, notify() {}, timer: { after() {} } };
  return { view, cx, ran, toasts, opened, space, c: tokens(night), W, PENDING };
}

// A bar whose three tabs are measured at 100 wide.
const measuredBar = async () => {
  const b = await bar();
  for (const id of ["t1", "t2", "t3"]) b.view.tabW[id] = 100;
  return b;
};
const byTag = (root, id) => find(root, (el) => el.tag === id || calls(el, "id").some((call) => call[1] === id));
const handler = (el, name) => calls(el, name).at(-1)?.at(-1);
const pressOf = (el, button) => calls(el, "on_mouse_down").find((call) => call[1] === button)?.at(-1);
const tab = (root, id) => byTag(root, `tab-${id}`);
const press = { click_count: 1 };

test("A tab out of view whose agent waits carries the blocked mark; working, done and the chosen tab carry none", async () => {
  const { tabMark } = await model();
  assert.equal(tabMark({ status: "blocked", active: false }), "blocked");
  for (const status of ["working", "done", "idle", null]) assert.equal(tabMark({ status, active: false }), null, status);
  assert.equal(tabMark({ status: "blocked", active: true }), null, "it leaves when the tab is chosen");
});

test("A project on another computer is connecting while its layout loads and unreachable when it cannot be read", async () => {
  const { barState } = await model();
  assert.equal(barState({ machine: null }, []), "connected");
  assert.equal(barState({ machine: "devbox" }, [{ name: "devbox", layout: "loading" }]), "connecting");
  assert.equal(barState({ machine: "devbox" }, [{ name: "devbox", layout: "unavailable" }]), "unreachable");
  assert.equal(barState({ machine: "devbox" }, [{ name: "devbox", layout: "ready" }]), "connected");
  assert.equal(barState(undefined, []), "connected");
});

test("Tabs that fit all show; the rest fold behind +N in order, and the chosen tab never folds", async () => {
  const { foldTabs } = await model();
  const widths = [100, 100, 100, 100, 100];
  assert.deepEqual(clone(foldTabs({ widths, chosen: 0, room: 600, gap: 2, more: 30 })), { shown: [0, 1, 2, 3, 4], folded: [] });
  assert.deepEqual(clone(foldTabs({ widths, chosen: 0, room: 300, gap: 2, more: 30 })), { shown: [0, 1], folded: [2, 3, 4] });
  assert.deepEqual(clone(foldTabs({ widths, chosen: 4, room: 300, gap: 2, more: 30 })), { shown: [0, 4], folded: [1, 2, 3] });
  assert.deepEqual(clone(foldTabs({ widths, chosen: 0, room: 0, gap: 2, more: 30 })), { shown: [0, 1, 2, 3, 4], folded: [] }, "before the bar is measured nothing folds");
  assert.deepEqual(clone(foldTabs({ widths: [100, undefined, 100], chosen: 0, room: 210, gap: 2, more: 30 })).shown, [0, 1, 2], "an unmeasured tab draws to be measured");
});

test("The chosen fill sits under the chosen tab once every tab is measured, and a tab dragged lands before or after its target", async () => {
  const { pillAt, dropSide } = await model();
  assert.deepEqual(clone(pillAt([80, 60, 90], 2, 2)), { left: 144, width: 90 });
  assert.equal(pillAt([80, undefined], 0, 2), null);
  assert.equal(pillAt([80], -1, 2), null);
  assert.equal(dropSide(2, 1), "before");
  assert.equal(dropSide(0, 2), "after");
});

test("A rename waits until the tab carries the new name, and an empty name asks Herdr for its own", async () => {
  const { renameWaits } = await model();
  const tabs = [{ id: "t1", name: "checkout" }];
  assert.equal(renameWaits({ id: "t1", name: "api-limits" }, tabs), true);
  assert.equal(renameWaits({ id: "t1", name: "checkout" }, tabs), false);
  assert.equal(renameWaits({ id: "t1", name: "" }, tabs), false);
  assert.equal(renameWaits({ id: "gone", name: "x" }, tabs), false, "a closed tab waits for nothing");
});

test("Chosen, at rest and waiting each draw their own state: the quiet fill, muted with the hover wash, and the blocked mark", async () => {
  const b = await bar();
  const root = b.view.render(b.cx);
  const [chosen, rest, waiting] = ["t1", "t2", "t3"].map((id) => tab(root, id));
  assert.equal(arg(chosen, "bg"), b.c.w7, "until measured, the chosen tab wears its fill");
  assert.equal(arg(chosen, "text_color"), b.c.text);
  assert.equal(arg(chosen, "selected"), true);
  assert.ok(byTag(chosen, "tab-t1-close"), "the chosen tab ends with ×");
  for (const other of [rest, waiting]) {
    assert.equal(calls(other, "bg").length, 0, "nothing filled at rest");
    assert.equal(arg(other, "text_color"), b.c.muted);
    assert.equal(byTag(other, `${other.tag}-close`), null, "× only on the chosen tab");
  }
  assert.ok(texts(rest).includes("cart-ui"));
  assert.equal(all(rest, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 1, "cart-ui waits: the blocked mark");
  assert.equal(all(chosen, (el) => calls(el, "spin").length > 0).length, 0, "no working mark");
  assert.equal(all(waiting, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 0, "no done mark");
  assert.equal(texts(root).some((text) => / Z$/.test(text)), false, "no Z after a zoomed tab");
  const label = find(rest, (el) => calls(el, "child").some((call) => call[1] === "cart-ui"));
  assert.equal(arg(label, "max_w"), b.W.tabLabel, "a name trims at 170");
});

test("Once measured, the chosen fill glides under the chosen tab and the tab paints none of its own", async () => {
  const b = await bar();
  for (const [id, width] of [["t1", 90], ["t2", 70], ["t3", 60]]) b.view.tabW[id] = width;
  const root = b.view.render(b.cx);
  const pill = byTag(root, "tab-pill");
  assert.equal(arg(pill, "left"), 0);
  assert.equal(arg(pill, "w"), 90);
  assert.equal(arg(pill, "bg"), b.c.w7);
  assert.equal(calls(tab(root, "t1"), "bg").length, 0);
});

test("A click chooses a tab, and a press dragged onto another holds it on the pressed wash, draws the accent where it lands and moves it there", async () => {
  const b = await bar();
  handler(tab(b.view.render(b.cx), "t2"), "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.select", { id: "t2" }]]);
  b.ran.length = 0;
  pressOf(tab(b.view.render(b.cx), "t3"), "left")(press, b.cx);
  handler(tab(b.view.render(b.cx), "t2"), "on_hover")(true, b.cx);
  const root = b.view.render(b.cx);
  assert.equal(arg(tab(root, "t3"), "bg"), b.c.selected, "the held tab");
  const box = byTag(root, "tab-box-t2");
  const insertion = find(box, (el) => calls(el, "bg").some((call) => call[1] === b.c.accent));
  assert.ok(insertion, "the accent bar where it lands");
  assert.ok(calls(insertion, "left").length === 1, "before the tab it moves left of");
  handler(tab(root, "t2"), "on_mouse_up")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.move", { id: "t3", index: 2 }]]);
});

test("Close asks twice on a tab holding an agent, and once on a plain shell", async () => {
  const agent = await bar({ panes: [{ tab: "t1", program: { agent: true } }] });
  handler(byTag(agent.view.render(agent.cx), "tab-t1-close"), "on_click")({}, agent.cx);
  assert.deepEqual(agent.ran, [], "the first press only arms");
  const armed = tab(agent.view.render(agent.cx), "t1");
  assert.equal(arg(armed, "bg"), agent.c.accent);
  assert.equal(arg(armed, "text_color"), agent.c.accentText);
  assert.equal(arg(armed, "tooltip"), "Press again to close checkout");
  handler(byTag(armed, "tab-t1-close"), "on_click")({}, agent.cx);
  assert.deepEqual(clone(agent.ran), [["tab.close", { id: "t1" }]]);
  const shell = await bar({ panes: [{ tab: "t1", program: { agent: false, shell: true } }] });
  handler(byTag(shell.view.render(shell.cx), "tab-t1-close"), "on_click")({}, shell.cx);
  assert.deepEqual(clone(shell.ran), [["tab.close", { id: "t1" }]]);
  const alone = await bar({ tabs: [TABS[0]] });
  assert.equal(byTag(alone.view.render(alone.cx), "tab-t1-close"), null, "the last tab has no ×");
});

test("Double-click renames in place; the new name draws at 80% with a breathing dot until the tab carries it", async () => {
  const b = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "ready" }] });
  pressOf(tab(b.view.render(b.cx), "t1"), "left")({ click_count: 2 }, b.cx);
  const editing = tab(b.view.render(b.cx), "t1");
  assert.ok(byTag(editing, "tab-t1-name"), "the field in place of the name");
  assert.equal(byTag(editing, "tab-t1-close"), null, "no × while renaming");
  b.view.renaming.text.value = () => "api-limits";
  b.view.endRename(b.cx, true);
  assert.deepEqual(clone(b.ran), [["tab.rename", { id: "t1", name: "api-limits" }]]);
  const waiting = tab(b.view.render(b.cx), "t1");
  assert.equal(arg(waiting, "opacity"), b.PENDING);
  assert.ok(texts(waiting).includes("api-limits"));
  assert.ok(byTag(waiting, "tab-t1-pending"), "the breathing dot");
  b.space.tabs = b.space.tabs.map((one) => (one.id === "t1" ? { ...one, name: "api-limits" } : one));
  const settled = tab(b.view.render(b.cx), "t1");
  assert.equal(calls(settled, "opacity").length, 0, "confirmed: both go");
});

test("Escape restores the name, and a refused rename gives the old name back with a toast", async () => {
  const b = await bar();
  pressOf(tab(b.view.render(b.cx), "t2"), "left")({ click_count: 2 }, b.cx);
  handler(tab(b.view.render(b.cx), "t2"), "on_key_down")({ key: "escape" }, b.cx);
  assert.equal(b.view.renaming, null);
  assert.deepEqual(b.ran, []);
  const refused = await bar({ fails: "tab.rename" });
  pressOf(tab(refused.view.render(refused.cx), "t2"), "left")({ click_count: 2 }, refused.cx);
  refused.view.renaming.text.value = () => "web";
  refused.view.endRename(refused.cx, true);
  assert.ok(texts(tab(refused.view.render(refused.cx), "t2")).includes("cart-ui"));
  assert.deepEqual(clone(refused.toasts), [{ title: "Couldn't rename cart-ui", level: "error" }]);
});

test("Tabs that do not fit fold behind +N, a Menu of them with their marks; + and Arrange never fold", async () => {
  const b = await measuredBar();
  b.view.barW.area = 100 + 2 * (26 + 8) + 40;
  b.view.moreOpen = true;
  const root = b.view.render(b.cx);
  assert.ok(tab(root, "t1"));
  assert.equal(tab(root, "t2"), null);
  const pop = find(root, (el) => calls(el, "content").length > 0);
  assert.ok(texts(arg(pop, "trigger")).includes("+2"));
  const list = arg(pop, "content");
  assert.ok(texts(list).includes("cart-ui") && texts(list).includes("tests"));
  assert.equal(all(list, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 1, "cart-ui keeps its mark");
  for (const id of ["tab-new", "tab-arrange"]) assert.ok(byTag(root, id), id);
  handler(byTag(list, "tab-more-list-0"), "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.select", { id: "t2" }]]);
});

test("Connecting draws one breathing skeleton per known tab; unreachable steps the tabs down with no + and no Arrange", async () => {
  const connecting = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "loading" }] });
  const loading = connecting.view.render(connecting.cx);
  assert.equal(tab(loading, "t1"), null);
  const skeletons = ["tab-skeleton-0", "tab-skeleton-1", "tab-skeleton-2"].map((id) => byTag(loading, id));
  assert.ok(skeletons.every((el) => el && calls(el, "loop").length === 1), "each breathes");
  assert.equal(byTag(loading, "tab-new"), null);
  const away = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "unavailable" }] });
  const far = away.view.render(away.cx);
  for (const id of ["t1", "t2", "t3"]) {
    assert.equal(arg(tab(far, id), "disabled"), true);
    assert.equal(arg(tab(far, id), "text_color"), away.c.dim);
  }
  assert.equal(byTag(far, "tab-new"), null);
  assert.equal(byTag(far, "tab-arrange"), null);
});

test("A right-click opens the tab's menu and the wheel still moves one tab", async () => {
  const b = await bar();
  pressOf(tab(b.view.render(b.cx), "t2"), "right")(press, b.cx);
  assert.deepEqual(clone(b.opened[0].props), { tab: "tab", target: { id: "t2", space: "s1" } });
  b.view.wheel({ delta_lines: { y: 1 } });
  assert.equal(b.ran.at(-1)[0], "tab.prev");
});

test("An armed close leaves with its x: choosing another tab, here or by a key, draws the first tab at rest", async () => {
  const b = await bar({ panes: [{ tab: "t1", program: { agent: true } }] });
  handler(byTag(b.view.render(b.cx), "tab-t1-close"), "on_click")({}, b.cx);
  assert.equal(arg(tab(b.view.render(b.cx), "t1"), "bg"), b.c.accent, "armed");
  handler(tab(b.view.render(b.cx), "t2"), "on_click")({}, b.cx);
  assert.equal(b.view.armed.is("close-t1"), false, "a click on another tab disarms");
  handler(byTag(b.view.render(b.cx), "tab-t1-close"), "on_click")({}, b.cx);
  b.space.tabs = b.space.tabs.map((one) => ({ ...one, active: one.id === "t2" }));
  const away = tab(b.view.render(b.cx), "t1");
  assert.equal(calls(away, "bg").length, 0, "chosen elsewhere by a key: no accent left behind");
  assert.equal(arg(away, "tooltip"), undefined);
});

test("On an unreachable computer the x is drawn but a press closes nothing", async () => {
  const b = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "unavailable" }] });
  const close = byTag(b.view.render(b.cx), "tab-t1-close");
  assert.ok(close, "drawn, as the Storybook draws it");
  assert.equal(calls(close, "on_click").length, 0);
  assert.equal(calls(close, "hover").length, 0);
  assert.deepEqual(b.ran, []);
});

test("Folded tabs, +N with its gap, new tab and Arrange fit the bar's width", async () => {
  const b = await measuredBar();
  b.view.barW.more = 30;
  const tools = 2 * (26 + 8);
  for (const area of [306, 308, 340, 420]) {
    b.view.barW.area = area;
    const root = b.view.render(b.cx);
    const shown = ["t1", "t2", "t3"].filter((id) => tab(root, id));
    const folded = 3 - shown.length;
    const used = shown.length * 100 + (shown.length - 1) * 2 + (folded ? 8 + 30 : 0) + tools;
    assert.ok(used <= area, `${area}: ${used} drawn`);
  }
});
