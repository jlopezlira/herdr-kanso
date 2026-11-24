import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, chain, gpuiHost, calls, arg, find, all, everyDrawn, CHROME_NIGHT, texts, repoText, keyboard } from "./helpers.mjs";
import { TABS, tabBar as bar } from "./menu-fixtures.mjs";

const night = CHROME_NIGHT;
const model = () => load("kanso-tabs/tab-bar-model.js", ["tabMark", "barState", "foldTabs", "dropSide", "renameWaits"]);
// A bar whose three tabs are measured at 100 wide.
const measuredBar = async (options = {}) => {
  const b = await bar(options);
  for (const id of ["t1", "t2", "t3"]) b.view.tabW[id] = 100;
  return b;
};
const twoFolded = async (options = {}) => {
  const b = await measuredBar(options);
  b.view.barW.bar = ROOM + 100 + 40;
  return b;
};
const byTag = (root, id) => find(root, (el) => el.tag === id || calls(el, "id").some((call) => call[1] === id));
const handler = (el, name) => calls(el, name).at(-1)?.at(-1);
const pressOf = (el, button) => (...args) => calls(el, "on_mouse_down").filter((call) => call[1] === button).forEach((call) => call.at(-1)(...args));
const tabId = (id) => `tab-bar-0-${id}`;
const tab = (root, id) => byTag(root, tabId(id));
const part = (root, id, name) => byTag(root, `${tabId(id)}-${name}`);
const doorBox = (root, label) => door(root, label)?.parent;
const door = (root, label) => find(root, (el) => calls(el, "tooltip").some((call) => String(call[1]).startsWith(label)) && calls(el, "accessibility_label").some((call) => call[1] === label));
const press = { click_count: 1 };
const withPanel = (open) => ({ id: "root", children: [{ id: "panel", children: [{ id: "panel-body", children: open ? [{ id: open }] : [] }] }] });
const panelsBar = async (panels) => {
  const b = await bar({ tree: withPanel(null), stored: { "kanso.panels": panels } });
  return { b, root: b.view.render(b.cx) };
};
const ROOM = 2 * 12 + 2 * (28 + 8) + 2 * 8 + 12 * 28 + 11 * 2;

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
  assert.deepEqual(clone(foldTabs({ widths, chosen: 0, room: null, gap: 2, more: 30 })), { shown: [0, 1, 2, 3, 4], folded: [] }, "before the bar is measured nothing folds");
  assert.deepEqual(clone(foldTabs({ widths, chosen: 0, room: 0, gap: 2, more: 30 })), { shown: [0], folded: [1, 2, 3, 4] }, "a bar measured with no room left folds all but the chosen tab");
  assert.deepEqual(clone(foldTabs({ widths: [100, undefined, 100], chosen: 0, room: 210, gap: 2, more: 30 })).shown, [0, 1, 2], "an unmeasured tab draws to be measured");
});

test("A tab dragged lands before or after its target", async () => {
  const { dropSide } = await model();
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
  assert.equal(arg(chosen, "bg"), b.c.w12, "the chosen tab wears its own fill, the selection's wash-12");
  assert.equal(arg(chosen, "text_color"), b.c.text);
  assert.equal(arg(chosen, "selected"), true);
  assert.ok(part(chosen, "t1", "close"), "the chosen tab ends with ×");
  for (const other of [rest, waiting]) {
    assert.equal(calls(other, "bg").length, 0, "nothing filled at rest");
    assert.equal(arg(other, "text_color"), b.c.muted);
    assert.equal(byTag(other, `${other.tag}-close`), null, "× only on the chosen tab");
    assert.deepEqual(calls(other, "hover").length, 1, "the hover wash");
  }
  assert.ok(texts(rest).includes("cart-ui"));
  assert.equal(all(rest, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 1, "cart-ui waits: the blocked mark");
  assert.equal(all(chosen, (el) => calls(el, "spin").length > 0).length, 0, "no working mark");
  assert.equal(all(waiting, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 0, "no done mark");
  assert.equal(texts(root).some((text) => / Z$/.test(text)), false, "no Z after a zoomed tab");
  const label = find(rest, (el) => calls(el, "child").some((call) => call[1] === "cart-ui"));
  assert.equal(arg(label, "max_w"), b.W.tabLabel, "a name trims at 170");
});

test("Measured, the chosen tab keeps its own fill: nothing glides under it", async () => {
  const b = await bar();
  for (const [id, width] of [["t1", 90], ["t2", 70], ["t3", 60]]) b.view.tabW[id] = width;
  const root = b.view.render(b.cx);
  assert.equal(byTag(root, "tab-pill"), null);
  assert.equal(all(byTag(root, "tab-bar-0"), (el) => calls(el, "transition").length > 0).length, 0);
  assert.equal(arg(tab(root, "t1"), "bg"), b.c.w12);
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
  const list = byTag(root, "tab-bar-0");
  const before = list.kids[list.kids.indexOf(tab(root, "t2").parent) - 1];
  assert.equal(arg(before, "bg"), b.c.accent, "the accent bar where it lands, before the tab it moves left of");
  handler(tab(root, "t2"), "on_mouse_up")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.move", { id: "t3", index: 2 }]]);
});

test("Close asks twice on a tab holding an agent, and once on a plain shell", async () => {
  const agent = await bar({ panes: [{ tab: "t1", program: { agent: true } }] });
  handler(part(agent.view.render(agent.cx), "t1", "close"), "on_click")({}, agent.cx);
  assert.deepEqual(agent.ran, [], "the first press only arms");
  const armed = tab(agent.view.render(agent.cx), "t1");
  assert.equal(arg(armed, "bg"), agent.c.accent);
  assert.equal(arg(armed, "text_color"), agent.c.accentText);
  assert.equal(arg(armed, "tooltip"), "Press again to close checkout");
  handler(part(armed, "t1", "close"), "on_click")({}, agent.cx);
  assert.deepEqual(clone(agent.ran), [["tab.close", { id: "t1" }]]);
  const shell = await bar({ panes: [{ tab: "t1", program: { agent: false, shell: true } }] });
  handler(part(shell.view.render(shell.cx), "t1", "close"), "on_click")({}, shell.cx);
  assert.deepEqual(clone(shell.ran), [["tab.close", { id: "t1" }]]);
  const alone = await bar({ tabs: [TABS[0]] });
  assert.equal(part(alone.view.render(alone.cx), "t1", "close"), null, "the last tab has no ×");
});

test("Double-click renames in place; the new name draws at 80% with a breathing dot until the tab carries it", async () => {
  const b = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "ready" }] });
  pressOf(tab(b.view.render(b.cx), "t1"), "left")({ click_count: 2 }, b.cx);
  const editing = tab(b.view.render(b.cx), "t1");
  assert.ok(part(editing, "t1", "name"), "the field in place of the name");
  assert.equal(part(editing, "t1", "close"), null, "no × while renaming");
  b.view.renaming.text.value = () => "api-limits";
  b.view.endRename(b.cx, true);
  assert.deepEqual(clone(b.ran), [["tab.rename", { id: "t1", name: "api-limits" }]]);
  const waiting = tab(b.view.render(b.cx), "t1");
  assert.equal(arg(waiting, "opacity"), b.PENDING);
  assert.ok(texts(waiting).includes("api-limits"));
  assert.ok(part(waiting, "t1", "pending"), "the breathing dot");
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
  const b = await twoFolded();
  b.view.moreOpen = true;
  const root = b.view.render(b.cx);
  assert.ok(tab(root, "t1"));
  assert.equal(tab(root, "t2"), null);
  const pop = find(root, (el) => calls(el, "content").length > 0);
  assert.ok(texts(arg(pop, "trigger")).includes("+2"));
  const list = arg(pop, "content");
  assert.ok(texts(list).includes("cart-ui") && texts(list).includes("tests"));
  assert.equal(all(list, (el) => calls(el, "bg").some((call) => call[1] === b.c.blocked)).length, 1, "cart-ui keeps its mark");
  for (const label of ["New tab", "Arrange"]) assert.ok(door(root, label), label);
  handler(find(list, (el) => calls(el, "on_click").length > 0 && texts(el).includes("cart-ui")), "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.select", { id: "t2" }]]);
});

test("Connecting draws one breathing skeleton per known tab; unreachable steps the tabs down with no + and no Arrange", async () => {
  const connecting = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "loading" }] });
  const loading = connecting.view.render(connecting.cx);
  assert.equal(tab(loading, "t1"), null);
  const skeletons = ["tab-bar-0", "tab-bar-1", "tab-bar-2"].map((id) => byTag(loading, id));
  assert.ok(skeletons.every((el) => el && calls(el, "loop").length === 1), "each breathes");
  assert.deepEqual(skeletons.map((el) => arg(el, "w")), [connecting.W.tabSkeleton, connecting.W.tabSkeletonShort, connecting.W.tabSkeletonShort], "the first long, the others short");
  assert.equal(door(loading, "New tab"), null);
  const away = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "unavailable" }] });
  const far = away.view.render(away.cx);
  for (const id of ["t1", "t2", "t3"]) {
    assert.equal(arg(tab(far, id), "disabled"), true);
    assert.equal(arg(tab(far, id), "text_color"), away.c.dim);
  }
  for (const label of ["New tab", "Arrange", "Files"]) assert.equal(door(far, label), null, label);
});

test("A right-click opens the tab's menu and the wheel still moves one tab", async () => {
  const b = await bar();
  pressOf(tab(b.view.render(b.cx), "t2"), "right")(press, b.cx);
  assert.equal(b.view.tabMenu, "t2");
  const popover = byTag(b.view.render(b.cx), "tab-menu-t2");
  const words = texts(arg(popover, "content"));
  for (const row of ["cart-ui", "Rename…", "New tab", "Sleep this tab…", "Close tab", "Hide “Agent state on tabs”", "Settings for this…"]) assert.ok(words.includes(row), row);
  b.view.wheel({ delta_lines: { y: 1 } });
  assert.equal(b.ran.at(-1)[0], "tab.prev");
});

test("An armed close leaves with its x: choosing another tab, here or by a key, draws the first tab at rest", async () => {
  const b = await bar({ panes: [{ tab: "t1", program: { agent: true } }] });
  handler(part(b.view.render(b.cx), "t1", "close"), "on_click")({}, b.cx);
  assert.equal(arg(tab(b.view.render(b.cx), "t1"), "bg"), b.c.accent, "armed");
  handler(tab(b.view.render(b.cx), "t2"), "on_click")({}, b.cx);
  assert.equal(b.view.armed.is("close-t1"), false, "a click on another tab disarms");
  handler(part(b.view.render(b.cx), "t1", "close"), "on_click")({}, b.cx);
  b.space.tabs = b.space.tabs.map((one) => ({ ...one, active: one.id === "t2" }));
  const away = tab(b.view.render(b.cx), "t1");
  assert.equal(calls(away, "bg").length, 0, "chosen elsewhere by a key: no accent left behind");
  assert.equal(arg(away, "tooltip"), undefined);
});

test("On an unreachable computer the x is drawn but a press closes nothing", async () => {
  const b = await bar({ machine: "devbox", computers: [{ name: "devbox", layout: "unavailable" }] });
  const close = part(b.view.render(b.cx), "t1", "close");
  assert.ok(close, "drawn");
  assert.equal(calls(close, "on_click").length, 0);
  assert.equal(calls(close, "hover").length, 0);
  assert.deepEqual(b.ran, []);
});

test("Folded tabs and +N with its gap fit the room the bar leaves beside new tab, Arrange and the doors", async () => {
  const b = await measuredBar();
  b.view.barW.more = 30;
  for (const room of [306, 308, 340, 420]) {
    b.view.barW.bar = ROOM + room;
    const root = b.view.render(b.cx);
    const shown = ["t1", "t2", "t3"].filter((id) => tab(root, id));
    const folded = 3 - shown.length;
    const used = shown.length * 100 + (shown.length - 1) * 2 + (folded ? 8 + 30 : 0);
    assert.ok(used <= room, `${room}: ${used} drawn`);
  }
});

test("The panel doors: each one a door at rest, the open one on the active wash, held and let go on another it moves there, its right-click opens its menu, and kansō help after them", async () => {
  const tree = withPanel("pr");
  const b = await bar({ tree });
  const root = b.view.render(b.cx);
  const labels = [...DOORS.map(([label]) => label), "kansō help"];
  for (const label of labels) assert.ok(door(root, label), label);
  assert.equal(arg(door(root, "PR"), "bg"), b.c.w12, "the open door");
  assert.equal(calls(door(root, "Files"), "bg").length, 0, "a closed door paints nothing");
  assert.match(arg(door(root, "kansō help"), "tooltip"), /^kansō help/);
  pressOf(doorBox(root, "Files"), "left")(press, b.cx);
  handler(doorBox(root, "Ports"), "on_mouse_up")({}, b.cx);
  assert.deepEqual(clone(b.store["kanso.panels.order"]).slice(0, 8), ["insights", "pr", "issues", "shipped", "caffeine", "worktrees", "ports", "files"]);
  pressOf(doorBox(b.view.render(b.cx), "Shipped"), "right")(press, b.cx);
  const menu = byTag(b.view.render(b.cx), "panel-menu-shipped");
  assert.ok(texts(arg(menu, "content")).includes("Panels\u2026"));
  handler(door(root, "kansō help"), "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran.at(-1)), ["mod.open", { name: "kanso-help" }]);
});

test("A panel whose tool is absent is not offered, a custom panel has its own door, and Arrange hidden is not drawn", async () => {
  const custom = { id: "notes", mod: "notes-panel", label: "Notes", icon: "mods/notes-panel/icon.svg" };
  const without = await bar({ stored: { "kanso.panels": [custom], "kanso.sim.tools": {} } });
  const root = without.view.render(without.cx);
  assert.equal(door(root, "Simulator"), null, "no simulator tools: no door");
  assert.ok(door(root, "Notes"), "the custom panel's door");
  const tools = await bar({ stored: { "kanso.sim.tools": { ios: true }, "kanso.pieces": { "tabs.arrange": "hide" } } });
  const drawn = tools.view.render(tools.cx);
  assert.ok(door(drawn, "Simulator"), "with Xcode, the Simulator's door");
  assert.equal(door(drawn, "Arrange"), null, "Arrange hidden is not drawn");
  assert.ok(door(drawn, "New tab"));
});

test("Cmd+1 to Cmd+9 are kansō's own keys and choose the tabs the bar shows: past the last one, or where only a sleeping tab is, nothing runs and nothing is said", async () => {
  const keymaps = { "kanso/keys.json": "cmd", "kanso/keys.windows.json": "ctrl" };
  for (const [file, mod] of Object.entries(keymaps)) {
    const section = JSON.parse(repoText(file))["layout:kanso"];
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.equal(section[`${mod}-${n}`], `kanso-tabs.tab-${n}`, `${file} ${mod}-${n}`);
  }
  const asleep = { id: "t0", index: 1, name: "slept", active: false, settled: true };
  const b = await bar({ tabs: [asleep, ...TABS.map((tab) => ({ ...tab, index: tab.index + 1 }))] });
  b.view.command("tab-2");
  assert.deepEqual(clone(b.ran), [["tab.select", { id: "t2" }]], "the second tab the bar shows, not the second Herdr holds");
  b.ran.length = 0;
  for (const n of [4, 5, 6]) b.view.command(`tab-${n}`);
  assert.deepEqual(b.ran, [], "no tab there: nothing runs");
  const gone = await bar({ fails: "tab.select" });
  gone.view.command("tab-1");
  assert.deepEqual(gone.toasts, [], "a tab gone before Herdr chose it says nothing");
});

test("Two custom panels with one icon each open their own panel, and a custom panel with no icon shows its name", async () => {
  const icon = "mods/custom/icon.svg";
  const panels = [{ id: "a", mod: "a-panel", label: "Alpha", icon }, { id: "b", mod: "b-panel", label: "Beta", icon }, { id: "notes", mod: "notes-panel", label: "Notes" }];
  const { b, root } = await panelsBar(panels);
  handler(door(root, "Alpha"), "on_click")({}, b.cx);
  assert.equal(b.view.want, "a", "Alpha opens Alpha");
  handler(door(b.view.render(b.cx), "Beta"), "on_click")({}, b.cx);
  assert.equal(b.view.want, "b", "Beta opens Beta");
  pressOf(doorBox(b.view.render(b.cx), "Alpha"), "right")(press, b.cx);
  assert.equal(b.view.panelMenu, "a", "Alpha's right-click is Alpha's menu");
  const notes = door(b.view.render(b.cx), "Notes");
  assert.ok(texts(notes).includes("Notes"), "its name, drawn");
  handler(notes, "on_click")({}, b.cx);
  assert.equal(b.view.want, "notes");
});

test("The chosen tab's × is a Button: Tab reaches it, Enter and Space press it, it has the focus ring, and it keeps its 16", async () => {
  const b = await bar();
  const close = part(b.view.render(b.cx), "t1", "close");
  assert.equal(close.tag, `${tabId("t1")}-close`, "a Button, not a bare element");
  assert.equal(arg(close, "accessibility_label"), "Close checkout");
  assert.equal(arg(close, "border"), 2);
  assert.equal(arg(close, "border_color"), "#00000000", "the ring is clear at rest");
  assert.equal(calls(close, "focus").length, 1, "and the accent under the keyboard");
  assert.equal(arg(close, "m"), -2, "the ring takes no room of its own");
  assert.equal(arg(close, "w"), 16);
  handler(close, "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran), [["tab.close", { id: "t1" }]]);
});

test("A panel tab draws its state: each door a Button, the open panel's on the selection's wash, the others at rest", async () => {
  const { b, root } = await prOpen();
  for (const label of ["New tab", "Arrange", "Files", "PR"]) assert.equal(door(root, label).tag.startsWith("tab-bar-"), true, `${label}: a Button`);
  assert.equal(arg(door(root, "PR"), "bg"), b.c.w12, "the open panel's door");
  assert.equal(calls(door(root, "Files"), "bg").length, 0, "the others at rest");
});

test("A panel's id is its own: one named lu-notes draws and opens, and one named plus leaves New tab alone", async () => {
  const panels = [{ id: "lu-notes", mod: "notes-panel", label: "Custom" }, { id: "plus", mod: "plus-panel", label: "Plus", icon: "mods/plus/icon.svg" }];
  const { b, root } = await panelsBar(panels);
  handler(door(root, "Custom"), "on_click")({}, b.cx);
  assert.equal(b.view.want, "lu-notes");
  handler(door(b.view.render(b.cx), "New tab"), "on_click")({}, b.cx);
  assert.deepEqual(clone(b.ran.at(-1)), ["kanso-spaces.start", null], "New tab is still New tab");
  handler(door(b.view.render(b.cx), "Plus"), "on_click")({}, b.cx);
  assert.equal(b.view.want, "plus");
});

test("A door with a long name takes its measured width from the room, so the tabs fold behind +N", async () => {
  const panels = [{ id: "notes", mod: "notes-panel", label: "A very long detail panel for this project" }];
  const wide = await bar({ stored: { "kanso.panels": panels } });
  for (const id of ["t1", "t2", "t3"]) wide.view.tabW[id] = 100;
  wide.view.barW.bar = ROOM + 2 * (28 + 2) + 3 * 100 + 2 * 2;
  assert.equal(["t1", "t2", "t3"].filter((id) => tab(wide.view.render(wide.cx), id)).length, 3, "before the door is measured, all fit");
  wide.view.doorW.notes = 205;
  const root = wide.view.render(wide.cx);
  assert.ok(["t1", "t2", "t3"].filter((id) => tab(root, id)).length < 3, "measured, the door's width folds a tab");
});

const asking = async (exec, options = {}) => {
  const calls = [], pending = [], waiting = [];
  const b = await bar({ ...options, exec: async (command, args, opts = {}) => { calls.push([command, args.at(-1), opts.on ?? null]); return exec(command, args, opts); } });
  const cx = { ...b.cx, timer: { after: (ms, fn) => { if (ms) waiting.push(fn); else fn(cx); return { cancel() {} }; } }, spawn: (fn) => { pending.push(fn(cx)); } };
  const drawn = async () => {
    b.view.render(cx);
    while (pending.length) await pending.shift();
    return ["Containers", "PR"].filter((label) => door(b.view.render(cx), label));
  };
  const later = () => waiting.splice(0).forEach((fn) => fn(cx));
  return { b, cx, drawn, later, lookups: () => calls.filter(([, tool]) => tool === "docker" || tool === "gh").toSorted(), forget: () => { calls.length = 0; } };
};
const installed = (tools) => async (_command, args) => ({ code: tools.includes(args.at(-1)) ? 0 : 1, stdout: "", stderr: "" });

test("Each door asks the computer its panel reads: Containers this computer's Docker on any space, PR the space's own gh, each answer kept for its computer", async () => {
  const exec = async (command, args, options = {}) => (options.on === "devbox"
    ? { code: args.at(-1) === "docker" ? 1 : 0, stdout: command === "where.exe" ? `C:\\bin\\${args[0]}.exe` : "Win32NT\n", stderr: "" }
    : { code: args.at(-1) === "docker" ? 0 : 1, stdout: "", stderr: "" });
  const { b, drawn, lookups, forget } = await asking(exec, { machine: "devbox", computers: [{ name: "devbox", layout: "ready" }] });
  assert.deepEqual(await drawn(), ["Containers", "PR"], "Docker only on this Mac, gh only on devbox: both offered on devbox");
  assert.deepEqual(lookups(), [["sh", "docker", null], ["where.exe", "gh", "devbox"]], "Docker asked here, gh on devbox as Windows");
  b.space.machine = null;
  forget();
  assert.deepEqual(await drawn(), ["Containers"], "on this Mac: its Docker, no gh");
  assert.deepEqual(lookups(), [["sh", "gh", null]], "only gh is new here");
  b.space.machine = "devbox";
  forget();
  assert.deepEqual(await drawn(), ["Containers", "PR"], "back on devbox: offered again");
  assert.deepEqual(lookups(), [], "from the answers kept, without asking again in the same bar");
});

test("A lookup that fails keeps the door and is asked again later, without asking at rest before then", async () => {
  let reachable = false;
  const exec = async (command, args) => { if (!reachable) throw new Error("machine unreachable"); return { code: 0, stdout: "", stderr: "" }; };
  const { drawn, lookups, forget, later } = await asking(exec);
  assert.deepEqual(await drawn(), ["Containers", "PR"], "unknown: both stay");
  forget();
  assert.deepEqual(await drawn(), ["Containers", "PR"]);
  assert.deepEqual(lookups(), [], "not asked again on every draw");
  reachable = true;
  later();
  assert.deepEqual(await drawn(), ["Containers", "PR"]);
  assert.deepEqual(lookups(), [["sh", "docker", null], ["sh", "gh", null]], "asked again once the wait is over");
});

test("A tool installed after the bar said no shows its door when the space is visited again", async () => {
  const tools = [];
  const { b, drawn, lookups, forget } = await asking((command, args) => installed(tools)(command, args));
  assert.deepEqual(await drawn(), [], "neither yet");
  tools.push("docker");
  forget();
  assert.deepEqual(await drawn(), [], "the same space at rest: not asked again");
  assert.deepEqual(lookups(), []);
  b.space.id = "s2";
  await drawn();
  b.space.id = "s1";
  assert.deepEqual(await drawn(), ["Containers"], "visited again: Docker installed since shows its door");
});

test("Without Docker the Containers door is not offered, without gh the PR door is not, and both stay until the computer answers", async () => {
  assert.deepEqual(await (await asking(installed(["gh"]))).drawn(), ["PR"], "no Docker: no Containers");
  assert.deepEqual(await (await asking(installed(["docker"]))).drawn(), ["Containers"], "no gh: no PR");
  assert.deepEqual(await (await asking(installed(["docker", "gh"]))).drawn(), ["Containers", "PR"]);
  const waiting = await asking(installed([]));
  assert.deepEqual(["Containers", "PR"].filter((label) => door(waiting.b.view.render(waiting.cx), label)), ["Containers", "PR"], "before the computer answers, both stay");
  await waiting.drawn();
  assert.equal(waiting.b.store["kanso.panels.all"].some((p) => p.id === "containers"), false, "and once it says neither, kansō settings does not list it either");
});

test("A new bar asks again whatever was saved: tools installed since show their doors, tools removed since hide them", async () => {
  const before = await asking(installed([]));
  assert.deepEqual(await before.drawn(), [], "neither, then");
  const after = await asking(installed(["docker", "gh"]), { stored: before.b.store });
  assert.deepEqual(await after.drawn(), ["Containers", "PR"], "installed since: a fresh bar asks and draws both");
  assert.equal(after.lookups().length, 2);
  const removed = await asking(installed([]), { stored: after.b.store });
  assert.deepEqual(await removed.drawn(), [], "removed since: a fresh bar asks and hides both");
  assert.equal(removed.lookups().length, 2);
});

test("The computer is asked whether each tool exists: command -v through the shell, where.exe on Windows; only a clean not-found hides a door", async () => {
  const { probeCommand, offered } = await load("kanso-tabs/panel-tools.js", ["probeCommand", "offered"]);
  const asked = [];
  const answer = (codes) => async (command, args) => { asked.push([command, ...args]); return { code: codes[args.at(-1)], stdout: "", stderr: "" }; };
  const probe = async (run, platform) => Object.fromEntries(await Promise.all(["docker", "gh"].map(async (tool) => [tool, await probeCommand(run, platform, tool)])));
  const keyed = (found) => ({ commands: { "\tdocker": found.docker, "\tgh": found.gh } });
  assert.deepEqual(await probe(answer({ docker: 1, gh: 0 }), "macos"), { docker: false, gh: true }, "found shows, not found hides");
  assert.deepEqual(asked.map(([command, , script]) => [command, script]), [["sh", 'command -v "$1" >/dev/null 2>&1 || exit 1'], ["sh", 'command -v "$1" >/dev/null 2>&1 || exit 1']]);
  assert.deepEqual(asked.map((call) => call.at(-1)), ["docker", "gh"]);
  asked.length = 0;
  assert.deepEqual(await probe(answer({ docker: 0, gh: 1 }), "windows"), { docker: true, gh: false });
  assert.deepEqual(asked, [["where.exe", "docker"], ["where.exe", "gh"]]);
  const unknown = {
    "a chdir ENOENT that names the tool": (command) => Object.assign(new Error(`chdir /gone before starting ${command} failed`), { code: "ENOENT", path: "/gone", syscall: "chdir" }),
    "a spawn failure": () => Object.assign(new Error("spawn sh ENOENT"), { code: "ENOENT", path: "sh", syscall: "spawn sh" }),
    "a timeout": () => new Error("command timed out after 1500 ms"),
    "a plain error naming the tool": (command) => new Error(`${command}: command not found`),
  };
  for (const [label, failure] of Object.entries(unknown)) {
    const probed = await probe(async (_command, args) => { throw failure(args.at(-1)); }, "macos");
    assert.deepEqual(probed, { docker: null, gh: null }, label);
    assert.equal(offered("containers", keyed(probed)) && offered("pr", keyed(probed)), true, `${label}: both doors stay offered`);
  }
  for (const code of [2, 126, 127, 9009]) assert.deepEqual(await probe(async () => ({ code, stdout: "", stderr: "" }), "macos"), { docker: null, gh: null }, `exit ${code}`);
});

test("Moving the drawn doors keeps the slot of a door gh's absence or Settings hides, first or between the moved doors, and it comes back there", async () => {
  const absent = { hidden: [installed(["docker"]), {}], shown: [installed(["docker", "gh"]), {}] };
  const hidden = { hidden: [installed(["docker", "gh"]), { "kanso.pieces": { "panel.pr": "hide" } }], shown: [installed(["docker", "gh"]), { "kanso.pieces": {} }] };
  for (const [why, order, kept, label] of [[absent, ["pr", "files", "ports", "insights"], ["pr", "ports", "files", "insights"], "gh absent, first"],
    [absent, ["files", "pr", "ports", "insights"], ["ports", "pr", "files", "insights"], "gh absent, second"],
    [hidden, ["files", "pr", "ports", "insights"], ["ports", "pr", "files", "insights"], "hidden in Settings, second"]]) {
    const { b, cx, drawn } = await asking(why.hidden[0], { stored: { "kanso.panels.order": order, ...why.hidden[1] } });
    assert.equal((await drawn()).includes("PR"), false, label);
    pressOf(doorBox(b.view.render(cx), "Ports"), "left")(press, cx);
    handler(doorBox(b.view.render(cx), "Files"), "on_mouse_up")({}, cx);
    assert.deepEqual(clone(b.store["kanso.panels.order"]).slice(0, 4), kept, `${label}: PR keeps its slot`);
    const back = await asking(why.shown[0], { stored: { ...b.store, ...why.shown[1] } });
    assert.ok((await back.drawn()).includes("PR"), `${label}: PR is drawn again`);
    assert.deepEqual(clone(back.b.store["kanso.panels.all"]).map((p) => p.id).slice(0, 4), kept, `${label}: PR comes back there`);
  }
});

const prOpen = async () => {
  const b = await bar({ tree: withPanel("pr") });
  return { b, root: b.view.render(b.cx) };
};
const LISTENERS = ["on_size_change", "on_hover", "on_mouse_down", "on_mouse_up"];
const DOORS_SHOWN = ["Files", "Spend", "PR", "Ports", "New tab", "Arrange"];

test("Every door, New tab and Arrange is the kit button with its hover wash and nothing else at rest; a door's drag, menu and size are measured around it", async () => {
  const b = await bar({ tree: withPanel(null) });
  const root = b.view.render(b.cx);
  for (const label of DOORS_SHOWN) {
    const el = door(root, label);
    const wash = chain();
    calls(el, "hover").at(-1)[1](wash);
    assert.deepEqual(calls(wash, "bg").map((call) => call[1]), [b.c.subtle], `${label}: the kit's wash under the pointer`);
    assert.deepEqual(LISTENERS.filter((name) => name !== "on_mouse_down" && calls(el, name).length), [], `${label}: no drag or size listener on the button`);
  }
  for (const label of ["Files", "Spend", "PR", "Ports"]) {
    assert.deepEqual(LISTENERS.filter((name) => !calls(doorBox(root, label), name).length), [], `${label}: its box measures it and carries the drag`);
    assert.equal(calls(door(root, label), "on_mouse_down").length, 0, `${label}: the button itself takes no press but its click`);
  }
});

const revealOf = (el) => find(el, (kid) => calls(kid, "transition").length > 0);
const opened = (el) => [arg(revealOf(el), "w") > 0, arg(revealOf(el), "opacity")];

test("A door shows its name beside its icon under the pointer and while its panel is open, easing open inside the same 28-high icon button", async () => {
  const { b, root } = await prOpen();
  assert.deepEqual(opened(door(root, "PR")), [true, 1], "the open panel's door is named");
  assert.deepEqual(opened(door(root, "Files")), [false, 0], "a door at rest is its icon");
  assert.ok(texts(revealOf(door(root, "Files"))).includes("Files"));
  handler(doorBox(root, "Files"), "on_hover")(true, b.cx);
  const hovered = door(b.view.render(b.cx), "Files");
  assert.deepEqual(opened(hovered), [true, 1], "under the pointer it is named");
  assert.deepEqual(clone([arg(hovered, "h"), calls(hovered, "transition").length]), [arg(door(root, "Files"), "h"), 0], "the button keeps its height; only the name eases");
  handler(doorBox(b.view.render(b.cx), "Files"), "on_hover")(false, b.cx);
  assert.deepEqual(opened(door(b.view.render(b.cx), "Files")), [false, 0], "and the name goes when the pointer leaves");
});

test("A door named under the pointer loses its name when the bar stops drawing it", async () => {
  const box = { name: "box", layout: "ready" };
  const b = await bar({ tree: withPanel(null), machine: "box", computers: [box] });
  handler(doorBox(b.view.render(b.cx), "Files"), "on_hover")(true, b.cx);
  assert.deepEqual(opened(door(b.view.render(b.cx), "Files")), [true, 1]);
  box.layout = "unavailable";
  assert.equal(door(b.view.render(b.cx), "Files"), null, "the computer is out of reach: no doors");
  box.layout = "ready";
  assert.deepEqual(opened(door(b.view.render(b.cx), "Files")), [false, 0], "drawn again, it is at rest");
});

const drawnTexts = (el) => everyDrawn(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const drawnBox = (el, id) => everyDrawn(el).find((kid) => calls(kid, "id")[0]?.[1] === id);
const unnamedCodex = () => bar({ tabs: [TABS[0], { ...TABS[1], name: "2", named: false }, TABS[2]], panes: [{ tab: "t2", program: { name: "Codex", agent: true } }] });
const report = (el, width, cx) => calls(el, "on_size_change").at(-1)[1]({ width, height: 28 }, cx);
const measureAll = (b, { barWidth, tab = 100, side = 28 }) => {
  const root = b.view.render(b.cx);
  for (const el of all(root, (kid) => /^tab-box-/.test(String(calls(kid, "id")[0]?.[1])))) report(el, tab, b.cx);
  for (const el of all(root, (kid) => /^(door|tool)-box-/.test(String(calls(kid, "id")[0]?.[1])))) report(el, side, b.cx);
  report(root, barWidth, b.cx);
  return b.view.render(b.cx);
};

test("Folding takes every width from the drawn controls' own size reports: no room left folds all but the chosen tab, and +N lists the rest", async () => {
  const b = await bar({ tree: withPanel(null) });
  const tight = measureAll(b, { barWidth: ROOM });
  assert.deepEqual(["t1", "t2", "t3"].filter((id) => tab(tight, id)), ["t1"], "measured to the last pixel, the chosen tab stays and the others fold");
  assert.ok(drawnTexts(tight).includes("+2"));
  report(drawnBox(tight, "tab-bar-more-box"), 30, b.cx);
  assert.equal(b.view.barW.more, 30, "+N reports its own width");
  b.view.moreOpen = true;
  assert.ok(["cart-ui", "tests"].every((name) => drawnTexts(b.view.render(b.cx)).includes(name)), "+N lists the folded tabs");
  b.view.moreOpen = false;
  const roomy = measureAll(b, { barWidth: ROOM + 28 + 2 + 3 * 100 + 2 * 2 });
  assert.deepEqual(["t1", "t2", "t3"].filter((id) => tab(roomy, id)), ["t1", "t2", "t3"], "with room for all three, all show");
  assert.equal(drawnTexts(roomy).includes("+2"), false);
  assert.deepEqual(Object.keys(b.view.toolW).toSorted(), ["arrange", "plus"], "New tab and Arrange are measured like the doors");
});

test("A tab nobody named shows its program, as Herdr's own tab bar does, or Terminal; a named tab keeps its name", async () => {
  const { tabName } = await load("kanso-tabs/tab-bar-model.js", ["tabName"]);
  const ps = [{ tab: "t2", program: { name: "zsh" } }, { tab: "t2", program: { name: "Claude", agent: true } }, { tab: "t3", program: { name: "vim" } }];
  assert.deepEqual([{ id: "t1", name: "checkout", named: true }, { id: "t2", name: "2", named: false }, { id: "t3", name: "3", named: false }, { id: "t4", name: "4", named: false }].map((t) => tabName(t, ps)),
    ["checkout", "Claude", "vim", "Terminal"]);
  const b = await unnamedCodex();
  assert.ok(texts(tab(b.view.render(b.cx), "t2")).includes("Codex"));
});

test("A custom panel with no icon is a door as high as the others, its name always shown", async () => {
  const { root } = await panelsBar([{ id: "notes", mod: "notes-panel", label: "Notes" }]);
  assert.equal(arg(door(root, "Notes"), "h"), arg(door(root, "Files"), "h"));
  assert.deepEqual(opened(door(root, "Notes")), [true, 1]);
});

test("The Caffeine door shows its cup and reveals its name while any computer has Caffeine on", async () => {
  const b = await bar({ tree: withPanel(null) });
  const caffeine = () => door(b.view.render(b.cx), "Caffeine");
  assert.ok(everyDrawn(caffeine()).some((el) => arg(el, "svg")?.endsWith("/coffee.svg")), "the cup is drawn");
  for (const on of [false, true, false]) {
    b.store["kanso.caffeine"] = { "": { on: false }, devbox: { on } };
    assert.deepEqual(opened(caffeine()), [on, Number(on)]);
  }
});

test("Each door's easing name has an id of its own, so a fold during the ease keeps its motion", async () => {
  const { root } = await prOpen();
  for (const [label, key] of [["Files", "files"], ["PR", "pr"], ["Ports", "ports"]]) {
    assert.match(String(calls(revealOf(door(root, label)), "id")[0]?.[1]), new RegExp(`panel:${key}-reveal$`), label);
  }
});

test("A tab nobody named is called by its program in its right-click menu, and its Sleep action says Sleep this tab", async () => {
  const b = await unnamedCodex();
  pressOf(tab(b.view.render(b.cx), "t2"), "right")(press, b.cx);
  const said = drawnTexts(b.view.render(b.cx));
  assert.ok(said.includes("Codex"), "the menu's title");
  assert.ok(said.includes("Sleep this tab\u2026"), "and its Sleep action");
  assert.equal(said.includes("Sleep Codex\u2026"), false);
  assert.equal(said.some((text) => text === "2" || text === "Sleep 2\u2026"), false);
});

test("Every tab draws its name in a box that is measured and never shrinks under it, the chosen one's × after the name", async () => {
  const b = await bar({ tabs: [...TABS, { id: "t4", index: 4, name: "4", active: false }] });
  const root = b.view.render(b.cx);
  for (const { id, name } of [...TABS, { id: "t4", name: "4" }]) {
    const box = tab(root, id).parent;
    assert.ok(texts(tab(root, id)).includes(name), `${id}: its name is drawn`);
    assert.ok(calls(box, "flex_none").length && calls(box, "on_size_change").length, `${id}: its box keeps its width and is measured`);
    assert.equal(calls(tab(root, id), "on_size_change").length, 0, `${id}: the measure is not on the button, where it never arrives`);
  }
  const chosen = tab(root, "t1"), kids = chosen.kids;
  assert.ok(kids.indexOf(part(root, "t1", "close")) > kids.findIndex((kid) => texts(kid).includes("checkout")), "the × comes after the name");
});

test("A door being dragged is held on the pressed wash with the accent bar where it lands", async () => {
  const b = await bar({ tree: withPanel("pr") });
  pressOf(doorBox(b.view.render(b.cx), "Ports"), "left")(press, b.cx);
  handler(doorBox(b.view.render(b.cx), "Spend"), "on_hover")(true, b.cx);
  const root = b.view.render(b.cx);
  assert.equal(arg(door(root, "Ports"), "bg"), b.c.selected, "held");
  assert.equal(arg(door(root, "PR"), "bg"), b.c.w12, "the open door keeps its wash");
  const spend = doorBox(root, "Spend"), row = spend.parent.kids, mark = row[row.indexOf(spend) - 1];
  assert.equal(arg(mark, "bg"), b.c.accent, "the accent bar before Spend");
  assert.equal(calls(mark, "on_click").length, 0, "the bar is no press");
  handler(doorBox(root, "Spend"), "on_mouse_up")({}, b.cx);
  assert.deepEqual(clone(b.store["kanso.panels.order"]).slice(0, 3), ["files", "ports", "insights"]);
  const after = b.view.render(b.cx);
  assert.equal(calls(door(after, "Ports"), "bg").length, 0, "let go, nothing is held");
  assert.equal(all(after, (el) => calls(el, "bg").some((call) => call[1] === b.c.accent)).length, 0, "and no bar is left");
});

const DOORS = [["Files", "files"], ["Spend", "insights"], ["PR", "pr"], ["Tasks", "issues"], ["Shipped", "shipped"], ["Caffeine", "caffeine"], ["Worktrees", "worktrees"], ["Ports", "ports"], ["Containers", "containers"], ["Memory", "memory"], ["Images", "look"], ["hjkl dōjō", "dojo"]]
  .map(([label, want]) => [label, { want }]);
const TOOLS = [["New tab", [["kanso-spaces.start", null]]], ["Arrange", { opened: "kanso-arrange" }]];
const CHOSEN = [["checkout", []], ["Close checkout", [["tab.close", { id: "t1" }]]]];
const HELP = ["kansō help", [["mod.open", { name: "kanso-help" }]]];
const walk = (b, root, effects) => {
  const keys = keyboard(root);
  assert.deepEqual(keys.stops.map((stop) => arg(stop, "accessibility_label") ?? texts(stop)[0]), effects.map(([label]) => label), "Tab reaches these, in this order, and nothing else");
  for (const [label, want] of effects) {
    const stop = keys.tab();
    assert.ok(calls(stop, "focus").length > 0, `${label}: its ring`);
    for (const key of ["enter", "space"]) {
      b.ran.length = 0; b.opened.length = 0; b.view.want = undefined; b.view.moreOpen = false;
      keys.key(key, b.cx);
      if (Array.isArray(want)) assert.deepEqual(clone(b.ran), want, `${label}, ${key}`);
      else if (want.opened) assert.equal(b.opened.at(-1)?.mod, want.opened, `${label}, ${key}`);
      else if (want.more) assert.equal(b.view.moreOpen, true, `${label}, ${key}`);
      else assert.equal(b.view.want, want.want, `${label}, ${key}`);
    }
  }
};

test("Tab walks every target of the tab bar in order, each with its focus ring, and Enter and Space each press it", async () => {
  const b = await bar({ tree: withPanel(null) });
  walk(b, b.view.render(b.cx), [...CHOSEN, ["cart-ui", [["tab.select", { id: "t2" }]]], ["tests", [["tab.select", { id: "t3" }]]], ...TOOLS, ...DOORS, HELP]);
});

test("Where the window has its own buttons, Tab reaches Minimize, Maximize and Close after the doors, and Enter and Space press them", async () => {
  const b = await bar({ tree: withPanel(null), buttons: true });
  walk(b, b.view.render(b.cx), [...CHOSEN, ["cart-ui", [["tab.select", { id: "t2" }]]], ["tests", [["tab.select", { id: "t3" }]]], ...TOOLS, ...DOORS, HELP,
    ["Minimize", [["window.minimize", null]]], ["Maximize", [["window.maximize", null]]], ["Close", [["window.close", null]]]]);
});

test("With tabs folded, Tab reaches +N, which Enter and Space open, then the folded tabs' rows, which Enter and Space choose", async () => {
  const b = await twoFolded({ tree: withPanel(null) });
  walk(b, b.view.render(b.cx), [...CHOSEN, ["+2", { more: true }], ...TOOLS, ...DOORS, HELP]);
  b.view.moreOpen = true;
  const open = b.view.render(b.cx);
  walk(b, open, [...CHOSEN, ["+2", []], ["cart-ui", [["tab.select", { id: "t2" }]]], ["tests", [["tab.select", { id: "t3" }]]], ...TOOLS, ...DOORS, HELP]);
});
