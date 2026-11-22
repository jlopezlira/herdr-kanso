import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, chain, gpuiHost, texts, calls, popoverHost, everyDrawn, CHROME_NIGHT } from "./helpers.mjs";
import { world, mountedState, withParts } from "./sidebar-fixtures.mjs";
import { BINDINGS, paneMenu, tabBar } from "./menu-fixtures.mjs";
import { loadStrip, menuSidebar, openHeaderEntries } from "./context-menu-fixtures.mjs";
import ROWS from "./fixtures/context-menu-rows.json" with { type: "json" };

const parseRow = (line) => {
  const [icon, label, hint, trail] = line.split(" | ");
  return { icon, label, hint, trail };
};
const menus = Object.values(ROWS).flat();
const parsed = menus.map((menu) => menu.map(parseRow));

const table = () => load("kanso-menu/menu-actions.js", ["ACTIONS", "ORDER", "wordsOf", "contextItems"]);
const hints = () => load("kanso-menu/ui-tooltip.js", ["hintOf"], {
  ...gpuiHost(), keys: () => BINDINGS, window: () => ({ platform: "macos" }),
});
const openTable = async () => ({ ...(await table()), hintOf: (await hints()).hintOf });

const blank = (hint) => hint ?? "";
const pieceLine = (label) => label === "Only when needed" || label === "Hide this" || label === "Settings for this…" || label.startsWith("Hide ");
const armed = (label) => label.startsWith("Press again");
const heading = (label) => label === "Asleep" || label === "Worktrees" || label.endsWith("is no longer here.");

const SURFACES = {
  tab: [ROWS.bars[0], ROWS.bars[1]],
  pane: [ROWS.pane[0], ROWS.paneToProgram[0], ROWS.panePinned[0], ROWS.paneChild[0], ROWS.keyboard[0], ROWS.bars[2], ROWS.bars[4]],
  header: [ROWS.bars[3]],
  project: [ROWS.project[0], ROWS.projectArmed[0], ROWS.projectAsleep[0], ROWS.gone[0], ROWS.keep[0], ROWS.missing[0]],
  session: [ROWS.session[0], ROWS.sessionArmed[0], ROWS.snooze[0], ROWS.copy[0], ROWS.move[0], ROWS.pinned[0], ROWS.settled[0], ROWS.snoozed[0], ROWS.thread[0]],
  asleep: [ROWS.asleepRow[0]],
  computer: [ROWS.computer[0], ROWS.syncPending[0], ROWS.syncFailed[0], ROWS.powerFailed[0], ROWS.login[0], ROWS.off[0], ROWS.unreachable[0]],
};

const iconOf = (ACTIONS, act) => ACTIONS[act].icon ?? "";
const keyHint = (ACTIONS, hintOf, act) => blank(hintOf(ACTIONS[act].key));
const candidates = (ACTIONS, ORDER, wordsOf, label, icon) => ORDER.filter((act) => wordsOf(act) === label && iconOf(ACTIONS, act) === icon);
const actOfRow = (ACTIONS, ORDER, wordsOf, hintOf, row) => {
  const found = candidates(ACTIONS, ORDER, wordsOf, row.label, row.icon);
  if (found.length === 1) return found[0];
  const byHint = found.filter((act) => keyHint(ACTIONS, hintOf, act) === row.hint);
  return byHint.length === 1 ? byHint[0] : null;
};

const explained = (ACTIONS, ORDER, wordsOf, label, icon) => {
  const staticAct = candidates(ACTIONS, ORDER, wordsOf, label, icon)[0];
  if (staticAct) return staticAct;
  const tries = [];
  const push = label.match(/^Push (.+)…$/);
  if (push) tries.push(["push", [push[1]]]);
  const allIn = label.match(/^Wake all (\d+) in (.+)$/);
  if (allIn) tries.push(["wake-all-in", [allIn[1], allIn[2]]]);
  const all = label.match(/^Wake all (\d+)$/);
  if (all) tries.push(["wake-all", [all[1]]]);
  if (label.startsWith("Wake ") && !label.startsWith("Wake all")) tries.push(["wake-tab", [label.slice("Wake ".length)]]);
  if (label.startsWith("Send back to ")) tries.push(["send-back", [label.slice("Send back to ".length)]]);
  if (label.startsWith("Back to ")) tries.push(["move-back", [label.slice("Back to ".length)]]);
  for (const act of ["snooze-until", "move-to", "worktree"]) tries.push([act, [label]]);
  return tries.find(([act, of]) => wordsOf(act, of) === label && iconOf(ACTIONS, act) === icon)?.[0] ?? null;
};

test("An action that the fixture menus share keeps the same words, icon and key hint in every one of them", async () => {
  const { ACTIONS, ORDER, wordsOf, hintOf } = await openTable();
  const seen = new Map();
  parsed.forEach((menu, menuAt) => {
    for (const row of menu) {
      const act = actOfRow(ACTIONS, ORDER, wordsOf, hintOf, row);
      if (!act) continue;
      const list = seen.get(act) ?? [];
      seen.set(act, [...list, { menuAt, row }]);
    }
  });
  const across = [...seen.entries()].filter(([, rows]) => new Set(rows.map((item) => item.menuAt)).size > 1);
  assert.ok(across.length > 0, "the fixture shares actions");
  for (const [act, rows] of across) {
    assert.ok(rows.every((item) => item.row.label === wordsOf(act) && item.row.icon === iconOf(ACTIONS, act)), act);
    if (ACTIONS[act].key) assert.ok(rows.every((item) => item.row.hint === keyHint(ACTIONS, hintOf, act)), act + " hint");
  }
});

test("Actions that two fixture menus share stay in the same order in both", async () => {
  const { ACTIONS, ORDER, wordsOf, hintOf } = await openTable();
  const once = (list) => list.filter((act, at) => list.indexOf(act) === at);
  const keys = parsed.map((menu) => once(menu.map((row) => actOfRow(ACTIONS, ORDER, wordsOf, hintOf, row)).filter(Boolean)));
  let pairs = 0;
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const shared = keys[i].filter((act) => keys[j].includes(act));
      if (shared.length < 2) continue;
      pairs += 1;
      assert.deepEqual(keys[j].filter((act) => shared.includes(act)), shared, shared.join(", "));
    }
  }
  assert.ok(pairs > 0, "two menus share more than one action");
});

test("contextItems takes an action's words, icon and hint from the table, fills a dynamic label, lets a given hint win, and passes separators, headings and a scroll run through", async () => {
  const { wordsOf, contextItems } = await table();
  const make = (label, does, look) => ({ label, does, ...look });
  const hint = (key) => (key ? "table:" + key : null);
  const [split] = contextItems([{ act: "split-down", does: () => "ran" }], { hint, make });
  assert.equal(split.label, wordsOf("split-down"));
  assert.equal(split.icon, "rows-2");
  assert.equal(split.hint, "table:kanso-strip.new-down");
  assert.equal(split.does(), "ran");
  const [push] = contextItems([{ act: "push", of: ["2 commits"], does: () => {} }], { hint, make });
  assert.equal(push.label, "Push 2 commits…");
  const [wake] = contextItems([{ act: "wake-all-in", of: [3, "review"], does: () => {} }], { hint, make });
  assert.equal(wake.label, "Wake all 3 in review");
  assert.equal(wake.icon, "sun");
  const [given] = contextItems([{ act: "split-down", hint: "given", does: () => {} }], { hint, make });
  assert.equal(given.hint, "given");
  const passed = contextItems([{ separator: true }, { heading: "Worktrees", mark: "idle" }], { hint, make });
  assert.deepEqual(passed, [{ separator: true }, { heading: "Worktrees", mark: "idle" }]);
  const [scroll] = contextItems([{ scroll: [{ act: "wake", does: () => {} }, { separator: true }], rows: 3, handle: "h" }], { hint, make });
  assert.equal(scroll.rows, 3);
  assert.equal(scroll.handle, "h");
  assert.equal(scroll.scroll[0].label, "Wake");
  assert.equal(scroll.scroll[0].icon, "sun");
  assert.deepEqual(scroll.scroll[1], { separator: true });
});

test("A right-click on the pane header opens the more menu, and does not while the name is being renamed", async () => {
  const { Strip } = await load("kanso-strip/main.js", ["Strip"], {
    ...gpuiHost(), Popover: { new: (id) => chain(id) }, props: () => ({ pane: "p1", strip: true }),
  });
  const view = new Strip();
  view.init({}, { focus_handle: () => ({ focus() {} }), notify() {} });
  const el = chain("head");
  view.headEvents(el, { pane: "p1", terminal: "t1" }, { name: "tests", strip: true, pinned: false, side: null }, {});
  const right = el.calls.filter((call) => call[0] === "on_mouse_down" && call[1] === "right");
  assert.equal(right.length, 1);
  const fire = () => right[0][2]({}, { notify() {}, stop_propagation() {} });
  fire();
  assert.equal(view.moreOpen, true);
  view.moreOpen = false;
  view.renaming = true;
  fire();
  assert.equal(view.moreOpen, false);
});

const sidebar = async (popup, open) => {
  const { Spaces } = await menuSidebar({
    ...world(
      [{ id: "sp1", name: "acme", folder: "/Users/me/acme", machine: null, active: true, tabs: [{ id: "tb0", name: "Main", index: 0, active: true }] }],
      [{ address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "acme", status: "working", name: "checkout", seq: 1 }],
      [{ pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/acme", branch: "main" }],
      [{ address: "t0", state: "live", program: { agent: true }, labels: { "kanso.name": "checkout" } }],
    ),
    props: () => ({ [popup]: open, overlay: "o" }), closeOverlay: () => {}, appHome: () => "/Users/me/.config/herdr-app",
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: () => false }, menuAt: -1, trees: [] })));
  return texts(view.render());
};

test("The tab, terminal pane, header menu and the sidebar project, session, asleep and computer menus draw their action rows from the action table", async () => {
  const { ACTIONS, ORDER, wordsOf } = await table();
  const surfaces = Object.values(SURFACES).flat();
  assert.ok(surfaces.length > 0);
  for (const menu of surfaces) {
    menu.map(parseRow).forEach((row, at) => {
      if (at === 0 || pieceLine(row.label) || armed(row.label) || heading(row.label)) return;
      const act = explained(ACTIONS, ORDER, wordsOf, row.label, row.icon);
      assert.ok(act, row.label);
    });
  }
  const tab = await tabBar({ panes: [{ tab: "t1", program: { agent: true } }], keys: BINDINGS });
  const tabWords = texts(calls(tab.view.tabMenuPopover(tab.c, chain("trigger"), tab.space.tabs[0], { space: tab.space, ps: [] }), "content")[0][1]);
  assert.ok(tabWords.includes(wordsOf("rename")));
  assert.ok(tabWords.includes(wordsOf("sleep-tab")));
  assert.equal(tabWords.includes("Rename"), false);
  assert.equal(tabWords.includes("Sleep checkout…"), false);
  const pane = await paneMenu({ keys: BINDINGS });
  const paneWords = texts(pane.view.render());
  assert.ok(paneWords.includes(wordsOf("sleep-agent")));
  assert.equal(paneWords.includes("Sleep"), false);
  const { Strip, tokens } = await loadStrip(() => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", popover: "#222", selected: "#444", accent: "#c9a46a" }));
  const head = Object.assign(new Strip(), { moreOpen: true });
  const entries = await openHeaderEntries();
  const headerWords = texts(calls(head.more(tokens({}), "p1", { name: "tests", entries, does: {} }), "content")[0][1]);
  assert.ok(headerWords.includes(wordsOf("send")));
  assert.ok(headerWords.indexOf(wordsOf("split-down")) < headerWords.indexOf(wordsOf("pin")));
  const session = await sidebar("menu", { address: "t0", view: "spaces" });
  assert.ok(session.includes(wordsOf("sleep-agent")));
  assert.ok(session.includes(wordsOf("sleep-tab")));
  const project = await sidebar("spaceMenu", { id: "sp1" });
  assert.ok(project.includes(wordsOf("sleep-tab")));
  assert.ok(project.includes(wordsOf("rename")));
  const computer = await sidebar("machineMenu", { route: "devbox", shown: "devbox", phase: "connected", syncOn: true });
  assert.ok(computer.includes(wordsOf("disconnect")));
  assert.ok(computer.includes(wordsOf("rename")));
  const asleep = await sidebar("menu", { address: "zz:t0", name: "checkout", asleep: { tab: "Main", n: 2, terminal: "t0", space: "sp1", resume: "r" } });
  assert.ok(asleep.includes(wordsOf("wake")));
  assert.ok(asleep.includes(wordsOf("forget")));
});

const readTable = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const rowsOf = (table) => Object.entries(table).flatMap(([section, keys]) => Object.entries(keys).map(([chord, action]) => ({ section, keys: chord, action })));
const shipped = () => [...rowsOf(readTable("../kanso/keys.json")), ...rowsOf(readTable("./herdr-keys.macos.json"))];
const idsOf = (el) => everyDrawn(el).flatMap((kid) => calls(kid, "id").map((call) => call[1]));
const drawnWords = (el) => everyDrawn(el).flatMap((kid) => calls(kid, "child").filter((call) => typeof call[1] === "string").map((call) => call[1]));
const byLabel = (root, label) => everyDrawn(root).find((el) => calls(el, "accessibility_label").some((call) => call[1] === label));
const countKeys = () => {
  const reads = { n: 0 };
  return { reads, keys: () => { reads.n += 1; return shipped(); } };
};
const tabsHost = {
  ...popoverHost(), theme: () => CHROME_NIGHT, spaces: () => [], panes: () => [], run: () => {}, openOverlay: () => {},
};
const quiet = { shared: () => null, setShared: () => {}, run: () => {}, closeOverlay: () => {}, openOverlay: () => {} };
const openPane = (Menu) => {
  const menu = new Menu();
  const focus = () => ({ is_focused: () => true, focus() {} });
  menu.init({}, { notify() {}, focus_handle: focus });
  return menu;
};
const openMore = (Strip) => Object.assign(new Strip(), { armed: { is: () => false }, moreOpen: true });

test("A layout chord that shadows a global binding hides that hint, a layout binding of the same action still wins, and an unshadowed global binding still shows", async () => {
  const { boundChord, hintOf } = await load("kanso-panel/ui-tooltip.js", ["boundChord", "hintOf"], { window: () => ({ platform: "macos" }) });
  const shadowed = [
    { section: "global", keys: "cmd-shift-enter", action: "pane.zoom" },
    { section: "layout:kanso", keys: "cmd-shift-enter", action: "kanso-strip.width" },
  ];
  assert.equal(boundChord("pane.zoom", shadowed), "");
  assert.equal(hintOf("pane.zoom", shadowed), null);
  assert.equal(hintOf("kanso-strip.width", shadowed), "⇧⌘↩");
  const sameAction = [...shadowed, { section: "layout:kanso", keys: "cmd-0", action: "pane.zoom" }];
  assert.equal(hintOf("pane.zoom", sameAction), "⌘0");
  const sharedChord = [
    { section: "global", keys: "cmd-j", action: "kanso-spaces.needs-you.next" },
    { section: "layout:kanso", keys: "cmd-j", action: "kanso-spaces.needs-you.next" },
  ];
  assert.equal(hintOf("kanso-spaces.needs-you.next", sharedChord), "⌘J");
  assert.equal(hintOf("app.palette", [{ section: "global", keys: "cmd-shift-p", action: "app.palette" }]), "⇧⌘P");
  const otherLayout = [
    { section: "global", keys: "cmd-t", action: "tab.new" },
    { section: "layout:terminals", keys: "cmd-t", action: "space.new" },
  ];
  assert.equal(hintOf("tab.new", otherLayout), "⌘T", "A binding of the same chord in another layout does not hide New tab's global cmd-t hint.");
  const { hintOf: hintOnLinux } = await load("kanso-panel/ui-tooltip.js", ["hintOf"], { window: () => ({ platform: "linux" }) });
  const linuxRows = rowsOf(readTable("../kanso/keys.linux.json"));
  assert.equal(hintOnLinux("kanso-panel.save", linuxRows), "Ctrl+Shift+S", "Save keeps its chord because a mod-local section is never shadowed.");
  assert.equal(hintOnLinux("kanso-spend.settings", linuxRows), "Ctrl+Shift+,", "Spend settings keeps its chord because a mod-local section is never shadowed.");
  assert.equal(hintOnLinux("kanso-tabs.sim", linuxRows), "Ctrl+Shift+S", "The Simulator hint stays Ctrl+Shift+S.");
});

test("The header more menu drawn with the shipped macOS bindings shows no Zoom hint and keeps the wider chord on Wider or narrower", async () => {
  const { Strip, tokens } = await load("kanso-strip/main.js", ["Strip", "tokens"], {
    ...popoverHost(), theme: () => CHROME_NIGHT, shared: () => null,
    keys: () => shipped(), window: () => ({ platform: "macos" }),
  });
  const headerFile = "kanso-strip/header-model.js";
  const { menuEntries } = await load(headerFile, ["menuEntries"]);
  const view = openMore(Strip);
  const entries = menuEntries({
    strip: true, pinned: false, zoomed: false, fold: 3, canOpen: true,
    tools: { sleep: "menu", send: "menu" },
  });
  const menu = view.more(tokens(CHROME_NIGHT), "p1", { name: "tests", entries, does: {} });
  const zoom = byLabel(menu, "Zoom");
  const wider = byLabel(menu, "Wider or narrower");
  assert.ok(zoom, "Zoom is drawn");
  assert.equal(drawnWords(zoom).includes("⇧⌘↩"), false);
  assert.ok(wider, "Wider or narrower is drawn");
  assert.ok(drawnWords(wider).includes("⇧⌘↩"));
});

test("contextRows reads the key table never for a computer menu and once for a terminal pane menu", async () => {
  const computerReads = { n: 0 };
  const { contextRows } = await load("kanso-menu/context-menu.js", ["contextRows"], {
    keys: () => { computerReads.n += 1; return shipped(); },
  });
  const { computerMenuItems } = await load("kanso-spaces/computer-menu.js", ["computerMenuItems"]);
  const rows = computerMenuItems({ remote: true, phase: "connected", syncOn: true });
  const lines = rows.map((row) => (row.act ? { ...row, does: () => {} } : row));
  contextRows(lines, (label, does, look) => ({ label, does, ...look }));
  assert.equal(computerReads.n, 0);
  const paneReads = { n: 0 };
  const { KansoMenu } = await load("kanso-menu/main.js", ["KansoMenu"], {
    ...gpuiHost(), theme: () => CHROME_NIGHT, window: () => ({ platform: "macos" }),
    keys: () => { paneReads.n += 1; return shipped(); },
    props: () => ({ target: { pane: "p1", terminal: "T1" }, overlay: "o" }),
    panes: () => [{ pane: "p1", tab: "t1", terminal: "T1", cwd: "/work/acme", name: "tests", status: "idle", program: { agent: true } }],
    terminals: () => [{ address: "T1", name: "tests", labels: {} }],
    agents: () => [{ address: "T1" }],
    spaces: () => [{ id: "s1", machine: null, tabs: [{ id: "t1" }] }],
    ...quiet,
  });
  openPane(KansoMenu).paneView({ pane: "p1", terminal: "T1" });
  assert.equal(paneReads.n, 1);
});

test("The tab, panel button, header more, header fact, terminal pane, sidebar popup and computer menus draw through contextMenu", async () => {
  const drawn = async (file, names, host, render) => {
    const counter = countKeys();
    const loaded = await load(file, names, { ...host, keys: counter.keys, window: () => ({ platform: "macos" }) });
    return { ids: idsOf(render(loaded)), reads: counter.reads.n };
  };
  const tab = await drawn("kanso-tabs/main.js", ["Tabs", "tokens"], tabsHost, ({ Tabs, tokens }) => {
    const view = Object.assign(new Tabs(), { armed: { is: () => false, press() {} } });
    return view.tabMenuPopover(tokens(CHROME_NIGHT), chain("tab"), { id: "t1", name: "Main" }, {
      space: { id: "s1" }, ps: [],
    });
  });
  assert.ok(tab.ids.includes("tab-menu-list-t1"));
  assert.equal(tab.reads, 1);
  const panel = await drawn("kanso-tabs/main.js", ["Tabs", "tokens"], tabsHost, ({ Tabs, tokens }) => {
    const view = new Tabs();
    return view.panelMenuPopover(tokens(CHROME_NIGHT), chain("door"), { id: "pr", label: "PR" });
  });
  assert.ok(panel.ids.includes("panel-menu-list-pr"));
  assert.equal(panel.reads, 0);
  const header = await drawn("kanso-strip/main.js", ["Strip", "tokens"], {
    ...popoverHost(), theme: () => CHROME_NIGHT, shared: () => null,
  }, ({ Strip, tokens }) => {
    return openMore(Strip).more(tokens(CHROME_NIGHT), "p1", {
      name: "tests", does: {},
      entries: ["pin", "zoom", "width", "separator"],
    });
  });
  assert.ok(header.ids.includes("ph-menu-list-p1"));
  assert.equal(header.reads, 1);
  const fact = await drawn("kanso-strip/main.js", ["Strip", "tokens"], {
    ...popoverHost(), theme: () => CHROME_NIGHT, shared: () => null, openOverlay: () => {},
  }, ({ Strip, tokens }) => {
    const view = Object.assign(new Strip(), { segmentMenu: "folder-p1" });
    return view.factMenu(tokens(CHROME_NIGHT), "folder-p1", chain("fact"), {
      title: "Folder", piece: "header.place",
      actions: [{ act: "open-with", does: () => {} }],
    });
  });
  assert.ok(fact.ids.includes("fact-menu-list-folder-p1"));
  assert.equal(fact.reads, 1);
  const pane = await drawn("kanso-menu/main.js", ["KansoMenu"], {
    ...gpuiHost(), theme: () => CHROME_NIGHT,
    props: () => ({ target: { pane: "p1", terminal: "T1" }, overlay: "o" }),
    panes: () => [{ pane: "p1", tab: "t1", terminal: "T1", cwd: "/work", name: "tests", program: { agent: true } }],
    terminals: () => [{ address: "T1", name: "tests", labels: {} }],
    agents: () => [], spaces: () => [{ id: "s1", tabs: [{ id: "t1" }] }],
    ...quiet,
  }, ({ KansoMenu }) => openPane(KansoMenu).render());
  assert.ok(pane.ids.includes("kanso-menu"));
  assert.equal(pane.reads, 1);
  const sideReads = countKeys();
  const { Spaces } = await menuSidebar({
    ...world(
      [{ id: "s1", name: "acme", folder: "/work", machine: null, active: true, tabs: [{ id: "t1", name: "Main" }] }],
      [{ address: "t0", pane: "p1", tab: "t1", space: "s1", status: "idle", name: "checkout" }],
      [{ pane: "p1", tab: "t1", terminal: "t0", cwd: "/work" }],
      [{ address: "t0", state: "live", labels: {} }],
    ),
    keys: sideReads.keys, window: () => ({ platform: "macos" }),
    props: () => ({ menu: { address: "t0" }, overlay: "o" }), closeOverlay: () => {},
  });
  const session = withParts(Object.assign(new Spaces(), mountedState({ armed: { is: () => false }, menuAt: -1 })));
  sideReads.reads.n = 0;
  assert.ok(idsOf(session.render()).includes("spaces-menu"));
  assert.equal(sideReads.reads.n, 0);
  const computerReads = countKeys();
  const { Spaces: Computers } = await menuSidebar({
    keys: computerReads.keys, window: () => ({ platform: "macos" }),
    props: () => ({ machineMenu: { route: "devbox", shown: "devbox", phase: "connected", syncOn: true }, overlay: "o" }),
    closeOverlay: () => {},
  });
  const computer = withParts(Object.assign(new Computers(), mountedState({ armed: { is: () => false }, menuAt: -1 })));
  computerReads.reads.n = 0;
  assert.ok(idsOf(computer.render()).includes("computer-menu"));
  assert.equal(computerReads.reads.n, 0);
});
