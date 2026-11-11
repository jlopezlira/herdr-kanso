// The piece registry: one list, one read, and a hidden piece issues no command.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "./helpers.mjs";
import {
  PIECES, GROUPS, STATE_LABEL, STORE, MIGRATED, pieceOf, choice, shown, runs, setPiece,
  migratePieces, loadPieces, pieces, filterPieces, groupsOf, withRoster,
} from "../kanso/mods/kanso-settings/pieces.js";

const LEFT_OUT = ["status.needs", "status.memory", "status.ports", "status.containers", "status.reviews", "status.spend", "pr.directory", "pr.agent", "pr.write", "files.named", "toast.pr", "toast.agent", "header.actions", "computers.awake"];
const STATES = new Set(["show", "needed", "hide"]);
const JOBS = new Set(["git", "gh", "lsof", "docker", "ps", "remote"]);

test("the registry ids are unique and each default is one of its states", () => {
  const ids = PIECES.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(GROUPS, ["Sidebar", "Pane header", "Status bar", "Tab bar and panels", "Notifications", "Background"]);
  for (const row of PIECES) {
    assert.equal(pieceOf(row.id)?.id, row.id);
    assert.ok(GROUPS.includes(row.group), row.id);
    assert.ok(row.states.length >= 2, row.id);
    assert.ok(row.states.every((state) => STATES.has(state)), row.id);
    assert.ok(row.states.includes(row.default), row.id);
    assert.equal(STATE_LABEL[row.default] != null, true, row.id);
    if (row.stops === "work") assert.ok(row.job === null || JOBS.has(row.job), `${row.id} ${row.job}`);
    else assert.equal(row.stops, "draw", row.id);
  }
  assert.deepEqual(Object.fromEntries(PIECES.filter((row) => row.job).map((row) => [row.id, row.job])), {
    "sidebar.activity": "ps", "sidebar.tasks": "ps", "sidebar.git": "git", "header.digest": "git", "header.pr": "gh",
    "panel.files": "git", "panel.pr": "gh", "panel.shipped": "git", "panel.worktrees": "git", "panel.ports": "lsof",
    "panel.containers": "docker", "panel.memory": "ps", "update.check": "git",
  });
  assert.equal(PIECES.find((row) => row.id === "sidebar.away").job, null);
  assert.equal(PIECES.find((row) => row.id === "sidebar.computers").job, null);
  assert.equal(pieceOf("panel.workflow").job, null);
  for (const id of LEFT_OUT) assert.equal(PIECES.some((row) => row.id === id), false, id);
  assert.equal(PIECES.some((row) => row.id === "sidebar.away"), true);
  assert.equal(PIECES.find((row) => row.id === "sidebar.needs").default, "needed");
});

test("shown follows show, when needed and hide, with and without something to say", () => {
  const away = "sidebar.away";
  for (const has of [true, false]) {
    assert.equal(shown(away, has, { [away]: "show" }), true, `show ${has}`);
    assert.equal(shown(away, has, { [away]: "hide" }), false, `hide ${has}`);
  }
  assert.equal(shown(away, true, { [away]: "needed" }), true);
  assert.equal(shown(away, false, { [away]: "needed" }), false);
  assert.equal(shown(away, true, {}), true, "absent means the default, which is when needed");
  assert.equal(shown(away, false, undefined), false);
  assert.equal(shown("sidebar.switch", false, {}), true, "a show default draws with nothing to say");
  assert.equal(shown(away, false, { [away]: "nope" }), false, "a value that is not a state falls back to the default");
  assert.equal(runs(away, {}), true, "when needed still does the work");
  assert.equal(runs(away, { [away]: "hide" }), false);
  assert.equal(runs("sidebar.switch", {}), false, "a drawn piece has no command to stop");
  assert.deepEqual(setPiece({ "sidebar.switch": "hide" }, "sidebar.switch", "show"), {});
  assert.deepEqual(setPiece({}, away, "needed"), {});
  assert.deepEqual(setPiece({}, away, "hide"), { [away]: "hide" });
});

test("old hide lists and a turned-off update check move once, and a second read leaves a later choice", () => {
  const once = migratePieces({
    hidden: ["sidebar.switch", "not.a.piece"],
    off: ["files", "panel.pr"],
    autoCheck: false,
    pieces: {},
    migrated: false,
  });
  assert.equal(once.migrated, true);
  assert.equal(once.pieces["sidebar.switch"], "hide");
  assert.equal(once.pieces["not.a.piece"], undefined);
  assert.equal(once.pieces["panel.files"], "hide");
  assert.equal(once.pieces["panel.pr"], "hide");
  assert.equal(once.pieces["update.check"], "hide");
  const kept = migratePieces({ hidden: ["sidebar.switch"], off: ["files"], autoCheck: false, pieces: {}, migrated: true });
  assert.deepEqual(kept.pieces, {});
  const again = migratePieces({ hidden: ["footer.machine"], off: ["sim"], autoCheck: false, pieces: once.pieces, migrated: true });
  assert.deepEqual(again.pieces, once.pieces);

  const store = { "kanso.hidden": ["footer.machine"], "kanso.panels.off": ["look"], "kanso.update": { autoCheck: false, latest: "1.0.0" } };
  const shared = (key) => store[key];
  const setShared = (key, value) => { store[key] = value; };
  const map = loadPieces(shared, setShared);
  assert.equal(map["footer.machine"], "hide");
  assert.equal(map["panel.look"], "hide");
  assert.equal(map["update.check"], "hide");
  assert.equal(store[MIGRATED], true);
  assert.equal(store["kanso.update"].autoCheck, false, "the old check flag is left in place");
  assert.equal(store["kanso.update"].latest, "1.0.0");
  store[STORE] = { "sidebar.activity": "show" };
  assert.deepEqual(loadPieces(shared, setShared), { "sidebar.activity": "show" });
  assert.equal(migratePieces({ hidden: [], off: [], autoCheck: true, pieces: {}, migrated: false }).pieces["update.check"], undefined);
  const read = { [STORE]: { "sidebar.git": "hide" }, "kanso.hidden": ["footer.machine"] };
  assert.deepEqual(pieces((key) => read[key]), { "sidebar.git": "hide" });
  assert.deepEqual(read, { [STORE]: { "sidebar.git": "hide" }, "kanso.hidden": ["footer.machine"] });
  assert.deepEqual(pieces(() => ["footer.machine"]), {});
  assert.deepEqual(pieces(() => null), {});
});

test("find matches a label or an id and keeps the window order", () => {
  assert.equal(filterPieces("").length, PIECES.length);
  assert.equal(filterPieces("   ").length, PIECES.length);
  assert.deepEqual(filterPieces("panel.files").map((row) => row.id), ["panel.files"]);
  assert.ok(filterPieces("SPEND").some((row) => row.id === "panel.insights"));
  assert.deepEqual(filterPieces("no-such-piece"), []);
  assert.deepEqual(groupsOf(filterPieces("computer")).map((group) => group.name), ["Sidebar", "Status bar"]);
  assert.deepEqual(groupsOf([]), []);
  const roster = withRoster([{ id: "workflow", label: "Workflow" }, { id: "files", label: "Not files" }]);
  assert.ok(roster.some((row) => row.id === "panel.workflow" && row.label === "Workflow"));
  assert.equal(roster.filter((row) => row.id === "panel.files").length, 1);
});

// A URL pathname keeps a leading slash, so Windows reads D:\D:\...
const modsRoot = fileURLToPath(new URL("../kanso/mods", import.meta.url));

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path, visit); continue; }
    if (name.endsWith(".js")) visit(path, readFileSync(path, "utf8"));
  }
}

function callsOf(root) {
  const calls = new Set();
  let panels = false;
  walk(root, (_path, text) => {
    for (const match of text.matchAll(/(?:shown|runs)\(\s*["']([^"']+)["']/g)) calls.add(match[1]);
    if (/runs\(\s*`panel\.\$\{/.test(text)) panels = true;
  });
  return { calls, panels };
}

test("the shared map is migrated from one start, and a draw only reads it", () => {
  const sites = [];
  walk(modsRoot, (path, text) => {
    if (/(?<!function )loadPieces\s*\(/.test(text)) sites.push(join(basename(dirname(path)), basename(path)));
  });
  assert.deepEqual(sites, [join("kanso-chrome", "main.js")]);
});

test("every shown or runs id is in the registry, and every registry id is read", () => {
  const { calls, panels } = callsOf(modsRoot);
  assert.equal(panels, true, "a panel id is read as panel.<id>");
  for (const id of calls) assert.ok(pieceOf(id), id);
  for (const row of PIECES) {
    const covered = calls.has(row.id) || (row.id.startsWith("panel.") && panels);
    assert.equal(covered, true, row.id);
  }
});

const TERM = { address: "t1", state: "live", status: "working", pid: 50, foreground: { pid: 101 } };

async function sidebar(map) {
  const store = { [MIGRATED]: true, [STORE]: map };
  const cmds = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    shared: (key) => store[key] ?? null,
    setShared: (key, value) => { store[key] = value; },
    window: () => ({ active: true, platform: "macos" }),
    terminals: () => [TERM],
    spaces: () => [], panes: () => [], agents: () => [], machines: () => [],
    home: () => "/tmp",
    exec: async (cmd) => { cmds.push(cmd); return { code: 1, stdout: "", stderr: "" }; },
    hc: async () => { cmds.push("hc"); return { code: 0, stdout: "[]", stderr: "" }; },
  });
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const task = fn(cx); pending.push(task); return task; } };
  const view = Object.assign(new Spaces(), {
    tasks: {}, threads: {}, psLook: null, pending: new Set(), refreshing: false, git: {}, checked: {},
    unsure: new Set(), watching: new Set(), machines: [], parked: [], waking: new Set(), login: new Set(), failed: new Set(),
  });
  const flush = async () => { while (pending.length) await pending.shift(); };
  const ask = async (map) => {
    cmds.length = 0;
    store[STORE] = map;
    view.psAt = null;
    view.psLook = null;
    view.checkTasks(cx, Date.now(), true);
    await flush();
    return cmds.filter((cmd) => cmd === "ps").length;
  };
  return { view, cx, cmds, flush, store, ask };
}

test("sidebar.activity hidden issues no ps when tasks are hidden too", async () => {
  const { ask } = await sidebar({});
  assert.ok(await ask({}) > 0, "both shown: ps runs");
  assert.ok(await ask({ "sidebar.activity": "hide" }) > 0, "tasks still asks for the table");
  assert.equal(await ask({ "sidebar.activity": "hide", "sidebar.tasks": "hide" }), 0);
});

test("sidebar.tasks hidden issues no ps when activity is hidden too", async () => {
  const { ask } = await sidebar({});
  assert.ok(await ask({ "sidebar.tasks": "hide" }) > 0, "activity still asks for the table");
  assert.equal(await ask({ "sidebar.activity": "hide", "sidebar.tasks": "hide" }), 0);
});

test("sidebar.git hidden issues no git status", async () => {
  const key = JSON.stringify([null, "/repo"]);
  const { view, cx, cmds, flush, store } = await sidebar({});
  view.pollingPlaces = () => new Map([["s", { key }]]);
  view.refreshGit([key], cx);
  await flush();
  assert.ok(cmds.includes("git"));
  cmds.length = 0;
  store[STORE] = { "sidebar.git": "hide" };
  view.refreshing = false;
  view.refreshGit([key], cx);
  await flush();
  assert.equal(cmds.includes("git"), false);
});

test("sidebar.away hidden records nothing", async () => {
  const { view, cx } = await sidebar({ "sidebar.away": "hide" });
  let updated = 0;
  view.sinceLeft = { busy: false, leave() {}, update() { updated += 1; return Promise.resolve(); } };
  view.returnSignature = "kept";
  view.trackReturn([], [], true, 1, cx);
  assert.equal(updated, 0);
  assert.equal(view.returnSignature, null);
});

test("sidebar.computers hidden does not list computers", async () => {
  const { view, cx, cmds, flush } = await sidebar({ "sidebar.computers": "hide" });
  let held = 0;
  view.awake = { sync: async () => { held += 1; }, nextWait: () => null, follow() { return this.nextWait(); } };
  view.refreshMachines(cx);
  await flush();
  assert.equal(cmds.includes("hc"), false);
  assert.equal(held, 1, "the hold still renews");
});

async function digestCmds(map) {
  const store = { [MIGRATED]: true, [STORE]: map };
  const cmds = [];
  const { Strip } = await load("kanso-strip/main.js", ["Strip"], {
    shared: (key) => store[key] ?? null,
    setShared: (key, value) => { store[key] = value; },
    spaces: () => [], panes: () => [],
    exec: async (cmd) => { cmds.push(cmd); return { code: 1, stdout: "", stderr: "" }; },
  });
  const view = Object.assign(new Strip(), { digesting: new Set() });
  const pending = [];
  view.digest({ pane: "p1", cwd: "/repo", tab: "t1" }, { notify() {}, spawn(fn) { pending.push(fn()); } });
  while (pending.length) await pending.shift();
  return cmds;
}

test("header.digest hidden issues no git command", async () => {
  const cmds = await digestCmds({ "header.digest": "hide" });
  assert.equal(cmds.includes("git"), false);
  assert.ok(cmds.includes("gh"), "the pull request is still read");
});

test("header.pr hidden issues no gh command", async () => {
  const cmds = await digestCmds({ "header.pr": "hide" });
  assert.equal(cmds.includes("gh"), false);
  assert.ok(cmds.includes("git"));
});

test("a hidden panel is not mounted", async () => {
  const store = { [MIGRATED]: true, [STORE]: {} };
  const { panelList } = await load("kanso-tabs/main.js", ["panelList"], {
    shared: (key) => store[key],
    setShared: (key, value) => { store[key] = value; },
  });
  for (const row of PIECES.filter((piece) => piece.id.startsWith("panel."))) {
    store[STORE] = { [row.id]: "hide" };
    const panel = panelList().find((item) => `panel.${item.id}` === row.id);
    assert.ok(panel, row.id);
    assert.equal(panel.on, false, `${row.id} hidden is not mounted, so its commands do not run`);
    store[STORE] = {};
    assert.equal(panelList().find((item) => item.id === panel.id).on, true, row.id);
  }
});

test("update.check hidden does not poll, and Check still looks", async () => {
  const store = { [MIGRATED]: true, [STORE]: { "update.check": "hide" }, "kanso.update": { autoCheck: true } };
  let asked = 0;
  const { Updater } = await load("kanso-chrome/update.js", ["Updater"], {
    appHome: () => "/nowhere",
    shared: (key) => store[key],
    setShared: (key, value) => { store[key] = value; },
    notify() {},
    readTextFile: async () => '{ "version": "1.3.1" }',
    layout: () => null,
    run: () => null,
    exec: async (command) => {
      if (command === "git") asked += 1;
      return { code: 0, stdout: command === "git" ? "x\trefs/tags/v1.4.0\n" : "", stderr: "" };
    },
  });
  const pending = [];
  const timers = [];
  const cx = {
    notify() {},
    spawn(fn) { const task = fn(cx); pending.push(task); return task; },
    timer: { every(_ms, fn) { timers.push(fn); } },
  };
  const updater = new Updater();
  updater.start(cx);
  while (pending.length) await pending.shift();
  for (const fn of timers) fn(cx);
  while (pending.length) await pending.shift();
  assert.equal(asked, 0);
  await updater.check(cx, true, true);
  assert.equal(asked, 1);
  assert.equal(store["kanso.update"].autoCheck, true);
});
