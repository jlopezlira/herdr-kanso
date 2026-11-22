import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, texts, calls, popoverHost } from "./helpers.mjs";
import { loadSidebar, world, mountedState, withParts } from "./sidebar-fixtures.mjs";
import { BINDINGS, paneMenu, tabBar } from "./menu-fixtures.mjs";
import ROWS from "./fixtures/context-menu-rows.json" with { type: "json" };

const parseRow = (line) => {
  const [icon, label, hint, trail] = line.split(" | ");
  return { icon, label, hint, trail };
};
const menus = Object.values(ROWS).flat();
const parsed = menus.map((menu) => menu.map(parseRow));

const table = () => load("kanso-menu/context-menu.js", ["ACTIONS", "ORDER", "wordsOf", "contextItems"]);
const hints = () => load("kanso-menu/ui-tooltip.js", ["hintOf"], {
  ...gpuiHost(), keys: () => BINDINGS, window: () => ({ platform: "macos" }),
});

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
  const { ACTIONS, ORDER, wordsOf } = await table();
  const { hintOf } = await hints();
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
  const { ACTIONS, ORDER, wordsOf } = await table();
  const { hintOf } = await hints();
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
  const { Spaces } = await loadSidebar({ ...popoverHost(), Scrollbar: { vertical: () => chain() } }, {
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
  const { Strip, tokens } = await load("kanso-strip/main.js", ["Strip", "tokens"], {
    ...popoverHost(), theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", popover: "#222", selected: "#444", accent: "#c9a46a" }),
    shared: () => null, keys: () => BINDINGS, window: () => ({ platform: "macos" }),
  });
  const { menuEntries } = await load("kanso-strip/header-model.js", ["menuEntries"]);
  const head = Object.assign(new Strip(), { moreOpen: true });
  const entries = menuEntries({ strip: true, pinned: false, zoomed: false, tools: { sleep: "menu", send: "menu" }, fold: 0, canOpen: true });
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
