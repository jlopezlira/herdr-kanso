import test from "node:test";
import assert from "node:assert/strict";
import { load, popoverHost, chain, clone, calls, context, texts, everyDrawn, CHROME_NIGHT } from "./helpers.mjs";
import { loadSidebar, mountedState, withParts, recorder, world, shell } from "./sidebar-fixtures.mjs";
import { loadWorkspaceStatus } from "./mod-fixtures.mjs";
import { paneMenu, tabBar, footer, BINDINGS } from "./menu-fixtures.mjs";
import { loadStrip, menuSidebar, openHeaderEntries } from "./context-menu-fixtures.mjs";
import ROWS from "./fixtures/context-menu-rows.json" with { type: "json" };

const quotes = (word) => word.replace(/[“”]/g, "\"");
const row = ({ lead = [], label = "", hint = "", trail = [] }) => [lead.join(","), quotes(label), hint, trail.join(",")].join(" | ");
const iconName = (path) => path.split("/").at(-1).replace(/\.svg$/, "");
const blockedDot = (kid) => calls(kid, "rounded_full").length > 0 && calls(kid, "child").some((call) => call[1] === "!");
const ownWords = (kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]);
const artOf = (el) => everyDrawn(el).flatMap((kid) => (blockedDot(kid) ? ["blocked"] : calls(kid, "svg").map((call) => iconName(call[1]))));
const itemRow = (item) => {
  const [lead, label, ...rest] = item.kids;
  return row({ lead: artOf(lead), label: drawnWords(label).join(" "), hint: rest.filter((kid) => !artOf(kid).length).flatMap(drawnWords).join(" "), trail: rest.flatMap(artOf) });
};
const rowsOf = (el) => (calls(el, "accessibility_label").length ? [itemRow(el)]
  : [...ownWords(el).map((label) => row({ label })), ...[...el.kids, ...calls(el, "content").map((call) => call[1])].flatMap(rowsOf)]);
const menuOf = (el) => ({
  words: everyDrawn(el).filter((kid) => !blockedDot(kid)).flatMap(ownWords),
  rows: rowsOf(el),
});
const drawnWords = (el) => everyDrawn(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const pressable = (el, label) => everyDrawn(el).find((kid) => calls(kid, "on_click").length && drawnWords(kid).includes(label));
const press = (el, label) => calls(pressable(el, label), "on_click").at(-1).at(-1)({}, { notify() {}, stop_propagation() {}, timer: { after() {} } });
const today = (h, m) => new Date(2026, 10, 18, h, m).getTime();
const NOW = today(14, 2);
class FrozenDate extends Date {
  constructor(...at) { super(...(at.length ? at : [NOW])); }
  static now() { return NOW; }
}
const contentOf = (el) => calls(everyDrawn(el).find((kid) => calls(kid, "content").length), "content")[0][1];
const byId = (el, id) => everyDrawn(el).find((kid) => kid.tag === id || calls(kid, "id").some((call) => call[1] === id));
const SESSION = "/Users/me/.claude/projects/acme/9f2c1234-0000-4000-8000-000000000001.jsonl";
const SPACES = [
  { id: "sp1", name: "acme-shop", folder: "/Users/me/acme-shop", machine: null, active: true,
    tabs: [{ id: "tb0", name: "Main", index: 0, active: true }, { id: "tb1", name: "api", index: 1 }, { id: "tb2", name: "review", index: 2, settled: true, settled_at: today(14, 2) }] },
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

async function sidebarPopup({ popup, open, status = "working", labels = {}, registry = [PROJECT], armed = null, sub = null, spaces = SPACES, known = null, asleep = false, moved = null }) {
  const store = { "kanso.registry": registry, "kanso.projects": moved };
  const { Spaces } = await menuSidebar({
    ...world(spaces, agent(status), PANES.filter((p) => asleep || p.tab !== "tb2"), terms(labels)),
    Date: FrozenDate, appHome: () => "/Users/me/.config/herdr-app", shared: (key) => store[key] ?? null,
    props: () => ({ [popup]: open, overlay: "o", ...(popup === "newAgent" ? { start: true } : {}) }), closeOverlay: () => {},
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: (key) => key === armed }, menuAt: -1, sub, trees: TREES, known })));
  return [menuOf(view.render())];
}

async function machineSidebar(host = {}) {
  const opened = [], toasts = [];
  const { Spaces } = await loadSidebar(recorder().host, {
    appHome: () => "/app", exec: async () => ({ code: 0, stdout: "" }), hc: async () => ({ code: 0, stdout: "" }),
    readTextFile: async () => null, writeTextFile: async () => {}, notify: (note) => toasts.push(note), openOverlay: (o) => opened.push(clone(o.props)), ...host,
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({ machines: [{ name: "devbox", target: "devbox.example", via: "", session: "", state: "connected" }] })));
  const menuOf = (phase) => { view.computerMenu("devbox", phase); return sidebarPopup({ popup: "machineMenu", open: opened.at(-1).machineMenu }); };
  return { view, toasts, menuOf, ...context() };
}

const session = (more = {}) => () => sidebarPopup({ popup: "menu", open: { address: "t0", view: "spaces", session: SESSION }, ...more });
const project = (more = {}) => () => sidebarPopup({ popup: "spaceMenu", open: { id: "sp1" }, ...more });
const computer = (phase, syncOn = false) => () => sidebarPopup({ popup: "machineMenu", open: { route: "devbox", shown: "devbox", phase, syncOn } });
const pane = (more = {}) => async () => [menuOf((await paneMenu({ keys: BINDINGS, ...more })).view.render())];
const piece = (id, title) => pane({ target: { piece: { id, title, actions: [] } } });
const settingsMenu = async (ready = null) => {
  const f = await footer({ ready });
  f.view.menuOpen = true;
  return f;
};
const settings = (ready) => async () => [menuOf(contentOf((await settingsMenu(ready)).view.render()))];
const tabMenu = (armed, keys = BINDINGS) => async () => {
  const ps = [{ tab: "t1", program: { agent: true } }, { tab: "t1", program: { agent: true } }];
  const b = await tabBar({ panes: ps, keys });
  if (armed) b.view.armed.press("close-t1", b.cx, () => {});
  return [menuOf(contentOf(b.view.tabMenuPopover(b.c, chain("trigger"), b.space.tabs[0], { space: b.space, ps })))];
};
const panelMenu = async () => {
  const b = await tabBar();
  return [menuOf(contentOf(b.view.panelMenuPopover(b.c, chain("trigger"), { id: "pr", label: "PR" })))];
};
const strip = async (segmentMenu) => {
  const { Strip, tokens } = await loadStrip();
  return { view: Object.assign(new Strip(), { segmentMenu }), c: tokens(CHROME_NIGHT) };
};
const headerPr = async () => {
  const { view, c } = await strip("pr-p1");
  const pr = { kind: "pr", number: "#166", url: "https://github.com/acme/docs/pull/166", verdict: "ready" };
  return [menuOf(byId(view.digestBar(c, { pane: "p1", cwd: "/w" }, [pr], { fold: 0, working: false, reading: false, strip: false, does: {} }), "fact-menu-list-pr-p1"))];
};
const digestMenu = async () => {
  const { view, c } = await strip("files-p1");
  const segments = [{ kind: "files", count: "2 files", diff: "+18 −2" }, { kind: "commits", count: "2 commits" }];
  return [menuOf(byId(view.digestBar(c, { pane: "p1", cwd: "/w" }, segments, { fold: 0, working: false, reading: false, strip: false, does: {} }), "fact-menu-list-files-p1"))];
};
const headerMore = async () => {
  const { view, c } = await strip(null);
  view.moreOpen = true;
  const entries = await openHeaderEntries();
  return [menuOf(contentOf(view.more(c, "p1", { name: "tests", entries, does: {} })))];
};
const statusMenus = async () => {
  const opened = [];
  const { WorkspaceStatus } = await loadWorkspaceStatus({
    ...popoverHost(), theme: () => CHROME_NIGHT, props: () => ({}), keys: () => BINDINGS, window: () => ({ platform: "macos" }),
    spaces: () => [{ id: "s1", active: true, machine: "devbox", tabs: [] }], machines: () => [{ name: "devbox", layout: "unavailable" }],
    agents: () => [{ address: "a1", status: "working" }], terminals: () => [],
    shared: (key) => ({ "sidebar.collapsed": true, "kanso.needs-you": { rows: [{ address: "a2", pane: "p2", status: "blocked", name: "cart-ui" }] } })[key] ?? null,
    openOverlay: (o) => opened.push(clone(o.props.target)), appHome: () => "/app", readTextFile: async () => null,
  });
  const view = Object.assign(new WorkspaceStatus(), { memoryText: JSON.stringify({ v: 1, at: Date.now(), machine: { freePct: 8 }, limits: { lowFreePct: 20 } }) });
  const root = view.render();
  everyDrawn(root).flatMap((kid) => calls(kid, "on_mouse_down").filter((call) => call[1] === "right")).forEach((call) => call.at(-1)({}, { stop_propagation() {} }));
  return Object.fromEntries(await Promise.all(opened.map(async (target) => [target.piece.title, (await pane({ target })())[0]])));
};
const statusMenu = (title) => async () => [(await statusMenus())[title]];
const placeMenu = async () => {
  const { view, c } = await strip("place-p1");
  const p = { pane: "p1", cwd: "/Users/me/acme-shop" };
  return [menuOf(contentOf(view.factMenu(c, "place-p1", chain("fact"), view.placeMenu(p, { where: { branch: "checkout-v2" } }))))];
};
const asleepRow = () => sidebarPopup({ popup: "menu", open: { address: "zz:t5", name: "billing", asleep: { tab: "review", n: 3, saved: today(14, 2), resume: "00000000-0000-4000-8000-000000000005" } } });
const plusMenu = () => sidebarPopup({ popup: "newAgent", open: { space: "sp1", folder: "/Users/me/acme-shop", machine: "", project: "pr1", name: "acme-shop" },
  known: [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }] });

const restartArmed = async () => {
  const f = await settingsMenu("0.1.16");
  press(f.view.render(), "Update Herdr to 0.1.16");
  assert.deepEqual(f.ran, [], "the first press only arms");
  const armed = menuOf(contentOf(f.view.render()));
  press(f.view.render(), "Press again to restart Herdr");
  assert.deepEqual(f.ran, [["app.update", undefined]], "the second press restarts Herdr into its update");
  return [armed];
};
const syncPending = async () => {
  const writes = [];
  const m = await machineSidebar({ readTextFile: () => new Promise(() => {}), writeTextFile: async (...args) => writes.push(args) });
  m.view.toggleSync("devbox", m.cx);
  m.view.toggleSync("devbox", m.cx);
  assert.equal(m.view.syncSaving, true, "the save is still out");
  assert.equal(m.view.sync.config.peers.devbox.enabled, true, "Sync shows on at once, and a second press while it saves changes nothing");
  assert.deepEqual(writes, []);
  return m.menuOf("connected");
};
const syncFailed = async () => {
  const m = await machineSidebar({ writeTextFile: async () => { throw new Error("stale"); } });
  m.view.toggleSync("devbox", m.cx);
  await m.drain();
  assert.equal(m.view.sync.config.peers?.devbox, undefined, "a refused save turns Sync back off");
  assert.deepEqual(m.toasts.map((t) => t.title), ["Sync devbox was not changed"]);
  return m.menuOf("connected");
};
const powerFailed = async () => {
  const m = await machineSidebar();
  m.view.db = () => ({ async parkMachine() { throw new Error("disk"); }, async forgetMachine() {} });
  m.view.turnOff("devbox", m.cx);
  await m.drain();
  assert.equal(m.view.failed.has("devbox"), true, "a power write that cannot be stored marks the computer failed");
  return m.menuOf(m.view.phaseOf("devbox", [{ name: "devbox", layout: "ready" }]));
};
const keyboard = async () => {
  const menu = await paneMenu({ keys: BINDINGS, pane: { name: "tests" } });
  const cx = { notify() {}, stop_propagation() {} };
  const keyDown = (key) => calls(menu.view.render(), "on_key_down").at(-1).at(-1)({ key, modifiers: {} }, cx);
  keyDown("j");
  assert.equal(menu.view.at, 0, "j lights the first row");
  const lit = everyDrawn(menu.view.render()).filter((kid) => calls(kid, "bg").length && texts(kid).includes("Copy") && !texts(kid).includes("Cut"));
  assert.ok(lit.length > 0, "the lit row draws its selected ground");
  keyDown("enter");
  assert.ok(menu.closed.includes("terminal.copy"), "Enter runs the lit row");
  return [menuOf(menu.view.render())];
};

const PIECE = (named) => [named ? `Hide “${named}”` : "Hide this", "Settings for this…"];
const SUBMENU = "›";
const SESSION_ROWS = ({ pin = "Pin to the top", shelf = [], wake = ["Snooze", SUBMENU], close = "Close agent" } = {}) => ["checkout", "Open", "Rename…", pin, ...shelf, "Mark unread", ...wake,
  "Move to project", SUBMENU, "Copy", SUBMENU, "Sleep this agent…", "Sleep this tab…", close, ...PIECE("What each agent is on")];
const PROJECT_HEAD = ["acme-shop", "New conversation…", "New in a worktree…", "Schedule…", "Worktrees", "checkout-v2", "kansō", "cart-retry", "~/acme-shop-cart", "Rename…", "Sleep this tab…", "Sleep the project…", "Project options…"];
const PROJECT_ROWS = ({ head = PROJECT_HEAD, extra = [], remove = "Remove project" } = {}) => [...head, ...extra, remove, ...PIECE("Branch, ahead, behind")];
const COMPUTER_ROWS = (...phase) => ["devbox", "Rename…", ...phase, "Add computer…", ...PIECE("Computers")];
const PANE_ROWS = (title, pin, agentRows, back = []) => [title, "Copy", "Cut", "Paste", "Split right", "⌘D", "Split down", "⇧⌘D", "Split left", "⌥⇧⌘D", "Wider or narrower", "⇧⌘↩", pin, "⌥⌘P",
  ...agentRows, ...back, "Right-clicks go to the program", "Close pane", "⇧⌘W"];
const AGENT_ROWS = ["Send to an agent…", "⌥⌘S", "Find in conversation", "⌘F", "Open with…", "Sleep this agent…"];
const TAB_ROWS = (close, hint = []) => ["checkout", "Rename…", "New tab", "⌘T", "Sleep this tab…", close, ...hint, ...PIECE("Agent state on tabs")];
const PLACE_ROWS = ["Folder and branch", "Copy path", "Copy branch name", "Open with…", ...PIECE()];
const NEEDED = "Only when needed";
const MORE_ROWS = ["tests", "Split down", "⇧⌘D", "Pin", "⌥⌘P", "Zoom", "Send to an agent…", "⌥⌘S", "Open with…", "Sleep this agent…", NEEDED, ...PIECE()];
const DIGEST_ROWS = ["Files and commits", "Open the diff", "Push 2 commits…", NEEDED, ...PIECE()];
const STATUS_ROWS = { needs: ["Needs you", "Go to cart-ui", "⌘J"], memory: ["Memory low", "Open Memory"], computer: ["devbox", "Refresh", NEEDED, ...PIECE()], agents: ["Agents at work", "Show them", "⌃⌥S", NEEDED, ...PIECE()], palette: ["Command palette key", ...PIECE()] };
const SETTINGS_ROWS = ["Settings", "kansō settings", "⌃⇧,", "Herdr settings"];
const SNOOZE = ["Snooze checkout", "In 1 hour", "15:02", "In 3 hours", "17:02", "This evening", "18:00", "Tomorrow", "Thu 9:00", "Monday", "Mon 9:00"];

const PANE_PINNED = pane({ pane: { name: "web" }, machine: "devbox", agent: false, terminal: { labels: { "herdr.right-click": "program" } }, store: { "strip.state": { t1: { cols: [{ panes: ["p1"], pin: true }] } } } });

const CASES = {
  session: { draw: session(), want: SESSION_ROWS() },
  sessionArmed: { draw: session({ armed: "close" }), want: SESSION_ROWS({ close: "Press again to close checkout" }) },
  snooze: { draw: session({ sub: "snooze" }), want: SNOOZE },
  copy: { draw: session({ sub: "copy" }), want: ["Copy", "Folder", "~/acme-shop-checkout", "Branch", "checkout-v2", "Conversation id", "9f2c…"] },
  move: { draw: session({ sub: "move", moved: { "9f2c1234-0000-4000-8000-000000000001": "sp1" } }), want: ["Move checkout to", "docs-site", "reports", "Back to acme-shop"] },
  pinned: { draw: session({ labels: { "kanso.pin": "1" } }), want: SESSION_ROWS({ pin: "Unpin" }) },
  settled: { draw: session({ status: "idle", labels: { "kanso.settled": `${NOW}:0` } }), want: SESSION_ROWS({ shelf: ["Bring back"] }) },
  snoozed: { draw: session({ labels: { "kanso.snooze": String(NOW + 3600000) } }), want: SESSION_ROWS({ wake: ["Wake"] }) },
  thread: { draw: session({ status: "idle" }), want: SESSION_ROWS({ shelf: ["Settle"] }) },
  project: { draw: project(), want: PROJECT_ROWS() },
  projectArmed: { draw: project({ armed: "remove" }), want: PROJECT_ROWS({ remove: "Press again to remove, close 3 tabs" }) },
  projectAsleep: { draw: project({ asleep: true }), want: PROJECT_ROWS({ head: [PROJECT_HEAD[0], "Asleep", "Wake review", "14:02", ...PROJECT_HEAD.slice(1)] }), own: true },
  gone: { draw: project({ spaces: [], registry: [] }), want: ["This project is no longer here."] },
  keep: { draw: project({ registry: [] }), want: PROJECT_ROWS({ extra: ["Keep as a project"] }) },
  missing: { draw: project({ registry: [{ ...PROJECT, missing: true }] }), want: PROJECT_ROWS({ head: [PROJECT_HEAD[0], ...PROJECT_HEAD.slice(4)], extra: ["Locate folder…"] }) },
  computer: { draw: computer("connected", true), want: COMPUTER_ROWS("Disconnect", "Sync", "on", "New project", "Remove") },
  syncPending: { draw: syncPending, want: COMPUTER_ROWS("Disconnect", "Sync", "on", "New project", "Remove") },
  syncFailed: { draw: syncFailed, want: COMPUTER_ROWS("Disconnect", "Sync", "off", "New project", "Remove") },
  powerFailed: { draw: powerFailed, want: COMPUTER_ROWS("Refresh", "Remove") },
  login: { draw: computer("login"), want: COMPUTER_ROWS("Sign in…", "Remove") },
  off: { draw: computer("off"), want: COMPUTER_ROWS("Connect", "Remove") },
  unreachable: { draw: computer("unavailable"), want: COMPUTER_ROWS("Refresh", "Remove") },
  asleepRow: { draw: asleepRow, want: ["billing, asleep since 14:02", "Wake", "Wake all 3 in review", "Copy conversation id", "Forget", "Everything asleep…"] },
  noMenu: { draw: piece("sidebar.switch", "Projects, Status, Threads"), want: ["Projects, Status, Threads", ...PIECE()] },
  pane: { draw: pane({ pane: { name: "tests" } }), want: PANE_ROWS("tests", "Pin", AGENT_ROWS) },
  paneToProgram: { draw: PANE_PINNED, want: PANE_ROWS("web · devbox", "Unpin", ["Open with…"]) },
  panePinned: { draw: PANE_PINNED, want: PANE_ROWS("web · devbox", "Unpin", ["Open with…"]) },
  paneChild: { draw: pane({ parent: { address: "T0", name: "J" } }), want: PANE_ROWS("tests", "Pin", AGENT_ROWS, ["Send back to J"]) },
  keyboard: { draw: keyboard, want: PANE_ROWS("tests", "Pin", AGENT_ROWS) },
  bars: { draw: async () => [...await tabMenu(false)(), ...await tabMenu(true)(), ...await pane({ pane: { name: "tests" } })(), ...await headerMore(), ...await PANE_PINNED(), ...await placeMenu(), ...await digestMenu(),
    ...await statusMenu("Needs you")(), ...await statusMenu("devbox")(), ...await statusMenu("Memory low")(), ...await statusMenu("Agents at work")(), ...await statusMenu("Command palette key")()],
  want: [TAB_ROWS("Close tab", ["⌘W"]), TAB_ROWS("Press again to close 2 agents", ["⌘W"]), PANE_ROWS("tests", "Pin", AGENT_ROWS), MORE_ROWS, PANE_ROWS("web · devbox", "Unpin", ["Open with…"]), PLACE_ROWS, DIGEST_ROWS,
    STATUS_ROWS.needs, STATUS_ROWS.computer, STATUS_ROWS.memory, STATUS_ROWS.agents, STATUS_ROWS.palette] },
  plus: { draw: plusMenu, want: ["acme-shop", "Terminal", "Claude Code", "Codex", "New project", "New worktree…", "Open worktree…", "Arrange…"], skip: "the + menu is not a right-click: it belongs to #331" },
  anyPiece: { draw: async () => [...await headerPr(), ...await panelMenu()],
    want: [["Pull request · #166", "Copy link", "Open the pull request", "Open on GitHub", "Only when needed", ...PIECE()], ["PR panel", ...PIECE(), "Panels…"]] },
  settings: { draw: settings(null), want: SETTINGS_ROWS },
  hostUpdate: { draw: settings("0.1.16"), want: [...SETTINGS_ROWS, "Update Herdr to 0.1.16"] },
  restartArmed: { draw: restartArmed, want: [...SETTINGS_ROWS, "Press again to restart Herdr"] },
};

const menusOf = (want) => (Array.isArray(want[0]) ? want : [want]).map((menu) => menu.map(quotes));

for (const [key, { draw, want, skip, own }] of Object.entries(CASES)) {
  test(`${key}${own ? ", the project's own rows" : ""}: the app draws its rows in order`, { skip }, async () => {
    const drawn = await draw();
    assert.deepEqual(drawn.map((menu) => menu.words.map(quotes)), menusOf(want));
    assert.deepEqual(drawn.map((menu) => menu.rows), ROWS[key], "each row's leading art, label, key hint and trailing art, in order");
  });
}

test("A pane whose Close is pressed once keeps every row and Close's key", async () => {
  const menu = await paneMenu({ keys: BINDINGS, pane: { name: "tests" } });
  const close = everyDrawn(menu.view.render()).find((kid) => calls(kid, "accessibility_label").some((call) => call[1] === "Close pane"));
  calls(close, "on_click").at(-1).at(-1)({}, { notify() {}, timer: { after() {} } });
  const drawn = texts(menu.view.render());
  assert.deepEqual(drawn, PANE_ROWS("tests", "Pin", AGENT_ROWS).map((word) => (word === "Close pane" ? "Press again to close tests" : word)));
  assert.ok(!menu.closed.includes("pane.close"), "the first press only arms");
});

test("A tab's menu writes no shortcut for New tab or Close tab when neither is bound", async () => {
  assert.deepEqual((await tabMenu(false, [])()).map((menu) => menu.words), [["checkout", "Rename…", "New tab", "Sleep this tab…", "Close tab", ...PIECE("Agent state on tabs")]]);
});

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
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: () => false }, menuAt: -1 })));
  return { el, view, opened };
}

for (const name of ["spaces", "agents"]) {
  test(`In ${name === "spaces" ? "Projects" : "Status"}, a right click on a subagent opens the Session menu for it, as on its parent`, async () => {
    const { el, view, opened } = await subagents();
    view.view = name;
    view.render();
    for (const address of ["t0", "t9", "s1"]) {
      const right = el.handlers[`on_mouse_down:right:space-agent-${address}`];
      assert.ok(right, `${address} takes a right click`);
      right({}, { stop_propagation() {} });
    }
    assert.deepEqual(opened, ["t0", "t9", "s1"]);
  });
}

const ACTIONS = ["Open", "Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Copy", "Sleep this agent…", "Sleep this tab…", "Close agent", "Close terminal"];
const offered = async (address) => {
  const { el, view } = await subagents({ address, view: "spaces" });
  view.render();
  return el.texts.filter((text) => ACTIONS.includes(text));
};

test("A subagent with no pane of its own is offered Rename, Pin, Settle, Mark read, Snooze, Move and Close, and no Open, Copy or Sleep, which its parent is", async () => {
  assert.deepEqual(await offered("s1"), ["Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Close terminal"]);
  const parent = await offered("t0");
  for (const row of ["Open", "Copy", "Sleep this agent…", "Sleep this tab…"]) assert.ok(parent.includes(row), `the parent offers ${row}`);
});

test("A subagent in a pane of its own is offered the rows its pane gives, as any agent is", async () => {
  const child = await offered("t9");
  for (const row of ["Open", "Copy", "Sleep this agent…", "Sleep this tab…"]) assert.ok(child.includes(row), `it offers ${row}`);
});

test("An asleep row's Wake wakes only it, Wake all wakes its tab, and Everything asleep… opens Status with Asleep unfolded", async () => {
  const el = recorder(), opened = [], ran = [], stored = {};
  const { Spaces } = await loadSidebar(el.host, {
    ...world(SPACES, [], [], []), run: (cmd) => ran.push(cmd), openOverlay: (o) => opened.push(o.props),
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({ sectionsFolded: new Set(["asleep"]), panel: { set: (key, value) => { stored[key] = value; } } })));
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
