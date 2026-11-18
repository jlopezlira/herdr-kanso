// Every state on Layouts/Context menus, one test each: the app draws the story's rows in the story's order, the thing's actions, the act that ends it, then the piece lines.
// A drawn state compares with its board's words; a state the Storybook lists as a gap is drawn as the app draws it today, so it is kept.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, chain, clone, texts, everyDrawn, CHROME_NIGHT } from "./helpers.mjs";
import { loadSidebar, mountedState, recorder, world, shell } from "./sidebar-fixtures.mjs";
import { paneMenu, tabBar, BINDINGS } from "./menu-fixtures.mjs";
import catalog from "../stories/catalog.json" with { type: "json" };

const part = (i) => (Array.isArray(catalog.parts[i]) ? catalog.parts[i].map(part).join("") : catalog.parts[i]);
const record = (id) => catalog.records.find((r) => r.id === id);
const quotes = (word) => word.replace(/[“”]/g, "\"");
const decode = (html) => html.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
// The words a board draws, in order.
const storyWords = (id) => decode(part(record(id).markup).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n"))
  .split("\n").map((w) => quotes(w.trim())).filter(Boolean);
const inOrder = (want, words) => want.reduce((at, w) => {
  const next = at < 0 ? -1 : words.findIndex((x, i) => i >= at && x.startsWith(w));
  return next < 0 ? -1 : next + 1;
}, 0) >= 0;

// Every word drawn, a popover's content too.
const drawnWords = (el) => everyDrawn(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const NOW = Date.now();
const SESSION = "/Users/me/.claude/projects/acme/9f2c1234-0000-4000-8000-000000000001.jsonl";
const SPACES = [
  { id: "sp1", name: "acme-shop", folder: "/Users/me/acme-shop", machine: null, active: true,
    tabs: [{ id: "tb0", name: "Main", index: 0, active: true }, { id: "tb1", name: "api", index: 1 }, { id: "tb2", name: "review", index: 2, settled: true, settled_at: 1 }] },
  { id: "sp2", name: "docs-site", folder: "/Users/me/docs-site", machine: null, tabs: [{ id: "tb3", name: "Main", index: 0 }] },
  { id: "sp3", name: "reports", folder: "/Users/me/reports", machine: null, tabs: [{ id: "tb4", name: "Main", index: 0 }] },
];
const agent = (status) => [{ address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "acme-shop", status, name: "checkout", seq: 1 }];
const PANES = [
  { pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/acme-shop-checkout", branch: "checkout-v2" },
  { pane: "p5", tab: "tb2", terminal: "t5", cwd: "/Users/me/acme-shop" }, { pane: "p6", tab: "tb2", terminal: "t6", cwd: "/Users/me/acme-shop" },
];
const terms = (labels = {}) => [{ address: "t0", state: "live", program: { agent: true }, labels: { "kanso.name": "checkout", ...labels } },
  shell("t5", "00000000-0000-4000-8000-000000000005", "billing"), shell("t6", "00000000-0000-4000-8000-000000000006", "ledger")];
const PROJECT = { id: "pr1", name: "acme-shop", folder: "/Users/me/acme-shop", machine: "" };
const TREES = [{ branch: "checkout-v2", path: "/Users/me/.config/herdr-app/data/kanso/worktrees/acme-shop/checkout-v2" }, { branch: "cart-retry", path: "/Users/me/acme-shop-cart" }];

// A sidebar popup, drawn with recording elements: `popup` names the props it opens with.
async function sidebarPopup({ popup, open, status = "working", labels = {}, registry = [PROJECT], armed = null, sub = null, spaces = SPACES, known = null, asleep = false }) {
  const el = recorder(), store = { "kanso.registry": registry };
  const { Spaces } = await loadSidebar(el.host, {
    ...world(spaces, agent(status), PANES.filter((p) => asleep || p.tab !== "tb2"), terms(labels)),
    appHome: () => "/Users/me/.config/herdr-app", shared: (key) => store[key] ?? null,
    props: () => ({ [popup]: open, overlay: "o", ...(popup === "newAgent" ? { start: true } : {}) }), closeOverlay: () => {},
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: (key) => key === armed }, menuAt: -1, sub, trees: TREES, known }));
  view.render();
  return el.texts;
}

const session = (more = {}) => () => sidebarPopup({ popup: "menu", open: { address: "t0", view: "spaces", session: SESSION }, ...more });
const project = (more = {}) => () => sidebarPopup({ popup: "spaceMenu", open: { id: "sp1" }, ...more });
const computer = (phase, syncOn = false) => () => sidebarPopup({ popup: "machineMenu", open: { route: "devbox", shown: "devbox", phase, syncOn } });
const pane = (more = {}) => async () => texts((await paneMenu({ keys: BINDINGS, ...more })).view.render());
const piece = (id, title) => pane({ target: { piece: { id, title, actions: [] } } });
const settings = (ready) => async () => {
  const { settingsEntries } = await load("kanso-chrome/footer-model.js", ["settingsEntries"]);
  return ["Settings", ...settingsEntries({ ready }).filter((row) => row.label).map((row) => row.label)];
};
const tabMenu = (armed) => async () => {
  const ps = [{ tab: "t1", program: { agent: true } }, { tab: "t1", program: { agent: true } }];
  const b = await tabBar({ panes: ps, keys: BINDINGS });
  if (armed) b.view.armed.press("close-t1", b.cx, () => {});
  return drawnWords(b.view.tabMenuPopover(b.c, chain("trigger"), b.space.tabs[0], { space: b.space, ps }));
};
const panelMenu = async () => {
  const b = await tabBar();
  return drawnWords(b.view.panelMenuPopover(b.c, chain("trigger"), { id: "pr", label: "PR" }));
};
const headerPr = async () => {
  const { Strip, tokens } = await load("kanso-strip/main.js", ["Strip", "tokens"], { ...gpuiHost(), Popover: { new: (id) => chain(id) }, theme: () => CHROME_NIGHT, shared: () => null });
  const view = Object.assign(new Strip(), { segmentMenu: "pr-p1" });
  const pr = { kind: "pr", number: "#166", url: "https://github.com/acme/docs/pull/166", verdict: "ready" };
  return drawnWords(view.digestBar(tokens(CHROME_NIGHT), { pane: "p1", cwd: "/w" }, [pr], { fold: 0, working: false, reading: false, strip: false, does: {} }));
};
const asleepRow = () => sidebarPopup({ popup: "menu", open: { address: "zz:t5", name: "billing", asleep: { tab: "review", n: 3, saved: 1, resume: "00000000-0000-4000-8000-000000000005" } } });
const plusMenu = () => sidebarPopup({ popup: "newAgent", open: { space: "sp1", folder: "/Users/me/acme-shop", machine: "", project: "pr1", name: "acme-shop" },
  known: [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }] });

const evening = new Date(NOW).getHours() < 17 ? ["This evening"] : [];
const PIECE = (named) => [named ? `Hide “${named}”` : "Hide this", "Settings for this…"];
const SESSION_ROWS = (pin = "Pin to the top", shelf = [], wake = "Snooze", close = "Close agent") => ["checkout", "Open", "Rename…", pin, ...shelf, "Mark unread", wake,
  "Move to project", "Copy", "Sleep this agent", "Sleep its tab", close, ...PIECE("What each agent is on")];
const PROJECT_ROWS = (remove = "Remove project") => ["acme-shop", "New conversation…", "New in a worktree…", "Worktrees", "checkout-v2", "kansō", "cart-retry", "~/acme-shop-cart",
  "Rename…", "Sleep this tab…", "Sleep the project…", "Project options…", remove, ...PIECE("Branch, ahead, behind")];
const COMPUTER_ROWS = (...phase) => ["devbox", "Rename…", ...phase, "Add computer…", ...PIECE("Computers")];
const PANE_ROWS = (title, pin, agentRows, back = []) => [title, "Split right", "⌘D", "Split down", "⇧⌘D", "Split left", "⌥⇧⌘D", "Wider or narrower", "⇧⌘↩", pin, "⌥⌘P",
  ...agentRows, ...back, "Right-clicks go to the program", "Close pane", "⇧⌘W"];
const AGENT_ROWS = ["Send to an agent…", "⌥⌘S", "Find in conversation", "⌘F", "Open with…", "Sleep"];
const TAB_ROWS = (close, hint = []) => ["checkout", "Rename", "New tab", "⌘T", "Sleep checkout…", close, ...hint, ...PIECE("Agent state on tabs")];

const CASES = {
  session: { draw: session(), want: SESSION_ROWS() },
  sessionArmed: { draw: session({ armed: "close" }), want: SESSION_ROWS(undefined, [], undefined, "Press again to close checkout") },
  snooze: { draw: session({ sub: "snooze" }), want: ["Snooze checkout", "In 1 hour", "In 3 hours", ...evening, "Tomorrow", "Monday"] },
  copy: { draw: session({ sub: "copy" }), want: ["Copy", "Folder", "~/acme-shop-checkout", "Branch", "checkout-v2", "Conversation id", "9f2c…"] },
  move: { draw: session({ sub: "move" }), want: ["Move checkout to", "docs-site", "reports"] },
  pinned: { draw: session({ labels: { "kanso.pin": "1" } }), want: SESSION_ROWS("Unpin") },
  settled: { draw: session({ status: "idle", labels: { "kanso.settled": `${NOW}:0` } }), want: SESSION_ROWS(undefined, ["Bring back"]) },
  snoozed: { draw: session({ labels: { "kanso.snooze": String(NOW + 3600000) } }), want: SESSION_ROWS(undefined, [], "Wake") },
  thread: { draw: session({ status: "idle" }), want: SESSION_ROWS(undefined, ["Settle"]) },
  project: { draw: project(), want: PROJECT_ROWS() },
  projectArmed: { draw: project({ armed: "remove" }), want: PROJECT_ROWS("Press again to remove, close 3 tabs") },
  projectAsleep: { draw: project({ asleep: true }), want: [PROJECT_ROWS()[0], "Asleep", "Wake review", ...PROJECT_ROWS().slice(1)] },
  gone: { draw: project({ spaces: [], registry: [] }), want: ["This project is no longer here."] },
  keep: { draw: project({ registry: [] }), want: [...PROJECT_ROWS().slice(0, 12), "Keep as a project", ...PROJECT_ROWS().slice(12)] },
  missing: { draw: project({ registry: [{ ...PROJECT, missing: true }] }), want: [PROJECT_ROWS()[0], ...PROJECT_ROWS().slice(3, 12), "Locate folder…", ...PROJECT_ROWS().slice(12)] },
  computer: { draw: computer("connected", true), want: COMPUTER_ROWS("Turn off", "Sync", "on", "New project") },
  syncOff: { draw: computer("connected", false), want: COMPUTER_ROWS("Turn off", "Sync", "off", "New project") },
  login: { draw: computer("login"), want: COMPUTER_ROWS("Sign in…") },
  off: { draw: computer("off"), want: COMPUTER_ROWS("Turn on") },
  unreachable: { draw: computer("unavailable"), want: COMPUTER_ROWS("Refresh") },
  asleepRow: { draw: asleepRow, want: ["billing, asleep since", "Wake", "Wake all 3 in review", "Copy conversation id", "Everything asleep…"] },
  noMenu: { draw: piece("sidebar.switch", "Projects, Status, Threads"), want: ["Projects, Status, Threads", ...PIECE()] },
  pane: { draw: pane({ pane: { name: "tests" } }), want: PANE_ROWS("tests", "Pin", AGENT_ROWS) },
  paneToProgram: { draw: pane({ terminal: { labels: { "herdr.right-click": "program" } } }), want: PANE_ROWS("tests", "Pin", AGENT_ROWS) },
  panePinned: { draw: pane({ pane: { name: "web" }, machine: "devbox", agent: false, store: { "strip.state": { t1: { cols: [{ panes: ["p1"], pin: true }] } } } }),
    want: PANE_ROWS("web · devbox", "Unpin", ["Open with…"]) },
  paneChild: { draw: pane({ parent: { address: "T0", name: "J" } }), want: PANE_ROWS("tests", "Pin", AGENT_ROWS, ["Send back to J"]) },
  bars: { draw: async () => [...await tabMenu(false)(), ...await tabMenu(true)(), ...await pane({ pane: { name: "tests" } })()],
    want: [...TAB_ROWS("Close tab", ["⌘W"]), ...TAB_ROWS("Press again to close 2 agents"), ...PANE_ROWS("tests", "Pin", AGENT_ROWS)] },
  plus: { draw: plusMenu, want: ["acme-shop", "Terminal", "Claude Code", "Codex", "New project", "New worktree…", "Open worktree…", "Arrange…"], skip: "the + menu is not a right-click: it belongs to #331" },
  anyPiece: { draw: async () => [...await headerPr(), ...await panelMenu()],
    want: ["Pull request · #166", "Copy link", "Open the pull request", "Open on GitHub", "Only when needed", ...PIECE(), "PR panel", ...PIECE(), "Panels…"] },
  settings: { draw: settings(null), want: ["Settings", "kansō settings", "Herdr settings"] },
  hostUpdate: { draw: settings("0.1.16"), want: ["Settings", "kansō settings", "Herdr settings", "Update Herdr to 0.1.16"] },
};

// Each story on the page and the case that draws it; `board` is the drawing it is compared with, none for a gap.
const STATES = [
  ["proto/approved-sidebar-menus/Reference/1", "session"], ["coverage/spaces/AgentMenu/Agent", "session"],
  ["proto/approved-sidebar-menus/Reference/2", "sessionArmed"], ["coverage/spaces/AgentMenu/Close armed", "sessionArmed"],
  ["proto/approved-sidebar-menus/Reference/3", "snooze"], ["coverage/spaces/AgentMenu/Snooze picker", "snooze"],
  ["proto/approved-sidebar-menus/Reference/4", "copy"], ["coverage/spaces/AgentMenu/Copy picker", "copy"],
  ["proto/approved-sidebar-menus/Reference/5", "move"], ["coverage/spaces/AgentMenu/Move picker", "move"],
  ["coverage/spaces/AgentMenu/Pinned", "pinned"], ["coverage/spaces/AgentMenu/Settled", "settled"],
  ["coverage/spaces/AgentMenu/Snoozed", "snoozed"], ["coverage/spaces/AgentMenu/Thread", "thread"],
  ["proto/approved-sidebar-menus/Reference/6", "project"], ["coverage/spaces/ProjectMenu/Open project", "project"],
  ["proto/approved-sidebar-menus/Reference/7", "projectArmed"], ["coverage/spaces/ProjectMenu/Remove armed", "projectArmed"],
  ["coverage/spaces/ProjectMenu/Asleep", "projectAsleep", null], ["coverage/spaces/ProjectMenu/Gone", "gone"],
  ["coverage/spaces/ProjectMenu/Keep", "keep"], ["coverage/spaces/ProjectMenu/Missing folder", "missing"],
  ["proto/approved-sidebar-menus/Reference/8", "computer"], ["coverage/spaces/ComputerMenu/Connected", "computer"],
  ["coverage/spaces/ComputerMenu/Sync on", "computer"], ["coverage/spaces/ComputerMenu/Sync pending", "computer"],
  ["coverage/spaces/ComputerMenu/Sync failed", "syncOff"], ["coverage/spaces/ComputerMenu/Login", "login"],
  ["coverage/spaces/ComputerMenu/Off", "off"], ["coverage/spaces/ComputerMenu/Unreachable", "unreachable"],
  ["coverage/spaces/ComputerMenu/Power failed", "unreachable"],
  ["proto/approved-sidebar-menus/Reference/9", "asleepRow"], ["proto/approved-sidebar-menus/Reference/10", "noMenu"],
  ["proto/approved-bars-menus/Reference/1", "bars"], ["coverage/menu/PaneMenu/Rest", "pane"],
  ["coverage/menu/PaneMenu/Program menu", "paneToProgram"], ["coverage/menu/PaneMenu/Pinned", "panePinned"],
  ["coverage/menu/PaneMenu/Child terminal", "paneChild"], ["coverage/menu/PaneMenu/Keyboard", "pane"],
  ["proto/approved-bars-new/Reference/1", "plus"],
  ["proto/approved-hide/Reference/1", "anyPiece"], ["proto/layouts-right-click-any-piece/RightClickAnyPiece/Default", "anyPiece"],
  ["coverage/chrome/SettingsMenu/Rest", "settings"], ["coverage/chrome/SettingsMenu/Host update", "hostUpdate"],
  ["coverage/chrome/SettingsMenu/Restart armed", "hostUpdate"],
];

const VOCABULARY = new Set(Object.values(CASES).flatMap((c) => c.want).map(quotes));
const boardOf = (id, given) => (given !== undefined ? given : record(id).markup !== undefined ? id : record(id).design ?? null);
const prefix = (words) => (w) => (words.includes(w) ? w : words.filter((x) => w.startsWith(x)).toSorted((x, y) => y.length - x.length)[0] ?? w);

test("The table holds every state on Layouts/Context menus", () => {
  const page = catalog.records.filter((r) => r.page === "Layouts/Context menus" && (r.markup !== undefined || r.gap || r.design)).map((r) => r.id).toSorted();
  assert.deepEqual(STATES.map(([id]) => id).toSorted(), page);
});

for (const [id, key, given] of STATES) {
  const { draw, want, skip } = CASES[key];
  const board = boardOf(id, given);
  test(`${record(id).label}: the app draws ${board ? "its board's" : "its"} rows in order`, { skip }, async () => {
    const wanted = want.map(quotes);
    if (board) assert.ok(inOrder(wanted, storyWords(board)), `the rows are the board's, in its order: ${wanted.join(" | ")}`);
    const drawn = (await draw()).map(quotes).map(prefix(wanted)).filter((w) => VOCABULARY.has(w));
    assert.deepEqual(drawn, wanted);
  });
}

// A subagent row opens the same Session menu as its parent, with the rows that act on it.
const SUBAGENTS = [
  { address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "acme-shop", status: "working", name: "J", seq: 1 },
  { address: "t9", pane: "p9", tab: "tb0", space: "sp1", space_name: "acme-shop", status: "idle", name: "Kay", seq: 2 },
];
const SUBAGENT_PANES = [{ pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/acme-shop", branch: "main" }, { pane: "p9", tab: "tb0", terminal: "t9", cwd: "/Users/me/acme-shop" }];
const SUBAGENT_TERMS = [
  { address: "t0", state: "live", program: { agent: true }, labels: {} },
  { address: "t9", state: "live", program: { agent: true }, labels: {}, parent: "t0" },
  { address: "s1", state: "live", status: "working", program: { agent: true }, name: "Zed", labels: {}, parent: "t0" },
];

async function subagents(menu = null) {
  const el = recorder(), opened = [];
  const { Spaces } = await loadSidebar(el.host, {
    ...world(SPACES, SUBAGENTS, SUBAGENT_PANES, SUBAGENT_TERMS),
    props: () => (menu ? { menu, overlay: "o" } : {}), openOverlay: (o) => opened.push(o.props.menu.address), closeOverlay: () => {},
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: () => false }, menuAt: -1 }));
  return { el, view, opened };
}

for (const name of ["spaces", "agents"]) {
  test(`In ${name === "spaces" ? "Projects" : "Status"}, a right click on a subagent opens the Session menu for it, as on its parent`, async () => {
    const { el, view, opened } = await subagents();
    view.view = name;
    view.render();
    for (const address of ["t0", "t9", "s1"]) {
      const press = el.handlers[`on_mouse_down:right:space-agent-${address}`];
      assert.ok(press, `${address} takes a right click`);
      press({}, { stop_propagation() {} });
    }
    assert.deepEqual(opened, ["t0", "t9", "s1"]);
  });
}

const ACTIONS = ["Open", "Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Copy", "Sleep this agent", "Sleep its tab", "Close agent", "Close terminal"];
const offered = async (address) => {
  const { el, view } = await subagents({ address, view: "spaces" });
  view.render();
  return el.texts.filter((text) => ACTIONS.includes(text));
};

test("A subagent with no pane of its own is offered Rename, Pin, Settle, Mark read, Snooze, Move and Close, and no Open, Copy or Sleep, which its parent is", async () => {
  assert.deepEqual(await offered("s1"), ["Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Close terminal"]);
  const parent = await offered("t0");
  for (const row of ["Open", "Copy", "Sleep this agent", "Sleep its tab"]) assert.ok(parent.includes(row), `the parent offers ${row}`);
});

test("A subagent in a pane of its own is offered the rows its pane gives, as any agent is", async () => {
  const child = await offered("t9");
  for (const row of ["Open", "Copy", "Sleep this agent", "Sleep its tab"]) assert.ok(child.includes(row), `it offers ${row}`);
});

test("An asleep row's Wake wakes only it, Wake all wakes its tab, and Everything asleep… opens Status with Asleep unfolded", async () => {
  const el = recorder(), opened = [], ran = [], stored = {};
  const { Spaces } = await loadSidebar(el.host, {
    ...world(SPACES, [], [], []), run: (cmd) => ran.push(cmd), openOverlay: (o) => opened.push(o.props),
  });
  const view = Object.assign(new Spaces(), mountedState({ sectionsFolded: new Set(["asleep"]), panel: { set: (key, value) => { stored[key] = value; } } }));
  const z = { space: "sp1", terminal: "t5", tabId: "tb2", settled: true, tab: "review", n: 3, resume: "r" };
  const { items } = view.zzLines((label, act) => ({ label, act }), { name: "billing", asleep: z });
  const act = (label) => items.find((row) => row.label === label).act();
  act("Wake");
  act("Wake all 3 in review");
  assert.deepEqual(clone(opened), [{ wake: { space: "sp1", terminal: "t5" } }, { wake: { space: "sp1", tab: "tb2" } }]);
  act("Everything asleep…");
  assert.deepEqual(ran, ["kanso-spaces.asleep"]);
  view.command("asleep", { notify() {} });
  assert.equal(view.view, "agents");
  assert.equal(view.sectionsFolded.has("asleep"), false);
  assert.deepEqual(clone(stored["spaces.sections"]), []);
});
