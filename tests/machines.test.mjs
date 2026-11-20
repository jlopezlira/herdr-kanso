// A remote machine can be turned off from the sidebar and back on with the setup that was saved.
import { loadSpaces, temporaryKdbFile } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, temporary, exec, context, failure, popoverHost, keyboard, calls, arg, tipsOf, svgsOf, find } from "./helpers.mjs";
import { loadSidebar, mountedState, withParts, recorder } from "./sidebar-fixtures.mjs";

const record = { name: "dark", target: "dark.example", via: "", session: "", temporary: false };
const darkKey = JSON.stringify(["dark", "/srv"]);
const homeKey = JSON.stringify([null, "/home"]);

test("adding a machine back uses the saved setup and never installs", async () => {
  const { addArgs, rmArgs, canRestore, machineRecord } = await load("kanso-spaces/machines.js", ["addArgs", "rmArgs", "canRestore", "machineRecord"]);
  assert.deepEqual(clone(addArgs(record)), ["machine", "add", "dark.example", "--name", "dark", "--json"]);
  assert.equal(addArgs(record).includes("--install"), false);
  assert.deepEqual(clone(addArgs({ name: "dark", target: "", via: "ssh -J jump", session: "sess", temporary: true })),
    ["machine", "add", "--name", "dark", "--via", "ssh -J jump", "--session", "sess", "--temp", "--json"]);
  assert.deepEqual(clone(rmArgs("dark")), ["machine", "rm", "dark"]);
  assert.equal(canRestore(machineRecord({ name: "dark" })), false, "a name alone is not removed");
  assert.equal(machineRecord({ name: null }), null);
  assert.deepEqual(clone(machineRecord({ name: "dark", target: "dark.example", temporary: 1 })), { ...record, temporary: true });
  const plain = machineRecord({ name: "dark", target: "dark.example", via: false, session: null });
  assert.deepEqual(clone(plain), record);
  assert.equal(addArgs(plain).includes("--via"), false);
  assert.equal(addArgs(plain).includes("--session"), false);
  assert.equal(addArgs(plain).includes("false"), false);
  assert.equal(machineRecord({ name: "dark", target: "dark.example", via: " false ", session: "null" }).via, "");
  assert.equal(machineRecord({ name: "dark", target: "dark.example", via: "false", session: " null " }).session, "");
  assert.equal(machineRecord({ name: "dark", target: "dark.example", via: "False", session: "NULL" }).via, "False");
  assert.equal(machineRecord({ name: "dark", target: "dark.example", via: "False", session: "NULL" }).session, "NULL");
});

test("a login Herdr asks for is told apart from a missing install", async () => {
  const { hcError, needsLogin, loginLine } = await load("kanso-spaces/machines.js", ["hcError", "needsLogin", "loginLine"]);
  assert.equal(hcError({ code: 0, stdout: "{}" }), null);
  assert.deepEqual(clone(hcError({ code: 1, stdout: JSON.stringify({ error: { kind: "login_needed", message: "needs a login" } }) })), { kind: "login_needed", message: "needs a login" });
  assert.equal(hcError({ code: 1, stderr: "nope" }).message, "nope");
  for (const kind of ["login_needed", "auth_failed", "host_key"]) assert.equal(needsLogin({ kind }), true, kind);
  assert.equal(needsLogin({ message: "host key changed" }), true);
  assert.equal(needsLogin({ kind: "hc_missing", message: "install herdr" }), false);
  assert.equal(needsLogin(null), false);
  assert.equal(loginLine("dark"), "hc machine login dark");
});

test("a machine row names only the states that need a word", async () => {
  const { machineState, machineTip, machineHot, machineStop } = await load("kanso-spaces/machines.js", ["machineState", "machineTip", "machineHot", "machineStop"]);
  assert.equal(machineState("off"), "Off");
  assert.equal(machineState("unavailable"), "Unreachable");
  assert.equal(machineState("login"), "Needs login");
  assert.equal(machineState("connected"), "");
  assert.equal(machineState("loading"), "");
  assert.equal(machineTip("dark", "connected"), "dark");
  assert.equal(machineTip("dark", "off"), "dark: Off");
  assert.equal(machineTip("dark", "unavailable", "ssh timed out"), "dark: ssh timed out");
  assert.equal(machineTip("dark", "login", ""), "dark: Needs login");
  assert.equal(machineHot("dark", "dark", false, null), true);
  assert.equal(machineStop("dark"), "machine:dark");
  assert.equal(machineStop(null, "lu-plus"), "machine-lu-plus:local");
  assert.equal(machineHot("dark", null, true, machineStop("dark")), true, "the keyboard on its row");
  assert.equal(machineHot("dark", null, true, machineStop("dark", "lu-power")), true, "or on one of its tools");
  assert.equal(machineHot("dark", null, true, machineStop("dark", "lu-refresh-cw")), true);
  assert.equal(machineHot("dark", null, false, machineStop("dark", "lu-power")), false);
  assert.equal(machineHot(null, "local", false, null), true);
  assert.equal(machineHot("dark", "local", true, "machine:odin"), false);
  assert.equal(machineHot("dark", null, true, "machine-lu-power:darker"), false, "another computer's tool");
  assert.equal(machineHot("dark", null, true, "space:dark"), false);
});

test("hc machine ls is the live list, without temporary rows", async () => {
  const { listedMachines } = await load("kanso-spaces/machines.js", ["listedMachines"]);
  const text = JSON.stringify({ machines: [{ name: "dark", state: "connected" }, { name: "tmp", state: "connected", temporary: true }] });
  assert.deepEqual(clone(listedMachines({ code: 0, stdout: text })), [{ name: "dark", state: "connected" }]);
  assert.deepEqual(clone(listedMachines({ code: 1, stdout: text })), []);
  assert.deepEqual(clone(listedMachines(null)), []);
  assert.deepEqual(clone(listedMachines({ code: 0, stdout: "nope" })), []);
});

test("a machine that is not connected is drawn in muted", async () => {
  const { machineInk } = await load("kanso-spaces/machines.js", ["machineInk"]);
  assert.equal(machineInk("off"), "muted");
  assert.equal(machineInk("unavailable"), "muted");
  assert.equal(machineInk("login"), "muted");
  assert.equal(machineInk("connected"), "foreground");
  assert.equal(machineInk("loading"), "foreground");
});

test("off hides that machine, and this computer has no switch", async () => {
  const { isOff, namesOff, heldNames, connectedNames, pollKeys, visibleSpaces, visibleAgents, machinePhase, machineTitle } = await load(
    "kanso-spaces/machines.js",
    ["isOff", "namesOff", "heldNames", "connectedNames", "pollKeys", "visibleSpaces", "visibleAgents", "machinePhase", "machineTitle"],
  );
  const stored = [record];
  const spaces = [{ id: "home", machine: null }, { id: "app", machine: "dark" }];
  const agents = [{ address: "t1" }, { address: "dark/a1" }];
  assert.equal(isOff(null, stored, []), false);
  assert.equal(isOff("dark", stored, []), true);
  assert.equal(isOff("dark", stored, [{ name: "dark", state: "connected" }]), false);
  assert.deepEqual(clone([...namesOff(stored, [])]), ["dark"]);
  assert.deepEqual(clone(connectedNames(stored, [{ name: "dark", state: "connected" }])), ["dark"]);
  assert.deepEqual(clone(pollKeys([darkKey, homeKey], heldNames(stored))), [homeKey]);
  assert.deepEqual(clone(pollKeys([darkKey], heldNames(stored))), [], "still stored, so not read, even once hc lists it connected");
  assert.deepEqual(clone(visibleSpaces(spaces, heldNames(stored)).map((space) => space.id)), ["home"]);
  assert.deepEqual(clone(visibleAgents(agents, heldNames(stored)).map((agent) => agent.address)), ["t1"]);
  assert.equal(machineTitle(null, "macbook"), "macbook");
  assert.equal(machineTitle(null, ""), "This computer");
  assert.equal(machineTitle("dark", "macbook"), "dark");
  assert.equal(machineTitle("dark", "macbook", "Night"), "Night");
  assert.equal(machineTitle("dark", "macbook", "  "), "dark");
  assert.equal(machineTitle(null, "macbook", "Studio"), "Studio");
  const phase = (extra) => machinePhase({ name: "dark", stored, live: [], layout: null, asking: false, login: false, failed: false, ...extra });
  assert.equal(phase({}), "off");
  assert.equal(phase({ asking: true }), "loading");
  assert.equal(phase({ login: true }), "login");
  assert.equal(phase({ failed: true }), "unavailable");
  assert.equal(phase({ stored: [], layout: "unavailable" }), "unavailable");
  assert.equal(phase({ stored: [], layout: "loading" }), "loading");
  assert.equal(phase({ stored: [], layout: "ready" }), "connected");
  assert.equal(phase({ stored: [], live: [{ name: "dark", state: "needs_login" }] }), "login");
  assert.equal(machinePhase({ name: null, stored, live: [], layout: "ready" }), "connected");
  assert.equal(machinePhase({ name: null, stored: [], live: [], layout: "loading" }), "loading");
});

async function sidebar(state) {
  const { node, host, ids, texts, tips } = recorder();
  const { Spaces } = await loadSidebar(host, {
    shared: (key) => (key === "sidebar.collapsed" ? state.collapsed === true : null),
    spaces: () => state.spaces, machines: () => state.layouts, run: state.run ?? (() => {}),
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({
    shown: new Set(state.spaces.map((space) => space.id)),
    machines: state.live ?? [], parked: state.parked ?? [],
    waking: state.waking ?? new Set(), login: state.login ?? new Set(), failed: state.failed ?? new Set(),
    hints: state.hints ?? {}, hoverMachine: state.hover ?? null,
    kbd: state.kbd === true, navKey: state.navKey ?? null,
    handle: { is_focused: () => state.kbd === true, focus() {} },
    hostName: state.hostName ?? "macbook", tools: node, sync: state.sync ?? { config: {}, status: {} },
  })));
  view.render();
  return { view, ids, texts, tips };
}

const local = { id: "home", name: "~", folder: "/Users/me", machine: null, active: true, tabs: [] };
const remote = { id: "dark-sp", name: "app", folder: "/srv", machine: "dark", active: false, tabs: [] };

const parkedDark = { spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record] };
const connected = { spaces: [local, remote], layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }], live: [{ ...record, state: "connected" }] };
const unreachable = { spaces: [local, remote], layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "unavailable" }], live: [{ ...record, state: "unreachable" }] };
const ADD_DARK = ["machine", "add", "dark.example", "--name", "dark", "--json"];
const turnedOff = async (view) => {
  const tasks = context();
  view.turnOff("dark", tasks.cx);
  await tasks.drain();
};

// A computer row's tools, by what each does: the kit draws them, each named by its tip.
const TOOLS = { power: /^Turn (off|dark on)$/, retry: /^Refresh$/, login: /^Sign in$/, add: /^New project on dark$/, sync: /^Sync\b/ };
const tools = (drawn) => drawn.tips.flatMap((tip) => Object.keys(TOOLS).filter((name) => TOOLS[name].test(tip)));
const tool = (drawn, name) => tools(drawn).includes(name);
const oneRow = (drawn, name) => drawn.view.nav.filter((row) => row.key === `machine:${name}`).length;

test("each machine state is one row, and this computer has no power button", async () => {
  const alone = await sidebar({ spaces: [local], layouts: [{ name: null, layout: "ready" }] });
  assert.equal(alone.ids.includes("machine-local"), false, "one machine: no header");
  assert.equal(alone.tips.includes("Turn macbook on"), false);

  const off = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record], hostName: "macbook",
  });
  assert.equal(oneRow(off, "dark"), 1);
  assert.equal(off.ids.includes("machine-local"), true);
  assert.equal(off.ids.includes("machine-dark"), true);
  assert.equal(off.ids.filter((id) => id === "machine-dark").length, 1);
  assert.equal(tool(off, "power"), true, "turn on stays on the row");
  assert.equal(off.tips.includes("Turn macbook on"), false);
  assert.equal(off.ids.includes("space-dark-sp"), false, "its projects are not listed");
  assert.equal(off.texts.includes("macbook"), true);
  assert.equal(off.texts.includes("dark"), true);
  assert.equal(off.texts.includes("Off"), true);
  assert.equal(off.texts.includes("Unavailable"), false);

  const offHover = await sidebar({ ...parkedDark, hover: "dark" });
  assert.equal(tool(offHover, "power"), true);
  assert.equal(offHover.tips.includes("Turn dark on"), true);
  assert.equal(tool(offHover, "add"), false);
  assert.equal(tool(offHover, "retry"), false);

  const keys = await sidebar({ ...parkedDark, kbd: true, navKey: "machine:dark" });
  assert.equal(tool(keys, "power"), true);

  const back = await sidebar({ ...connected, hover: "dark" });
  assert.equal(oneRow(back, "dark"), 1);
  assert.equal(back.ids.includes("space-dark-sp"), true, "on: its project is back");
  assert.equal(tool(back, "power"), true);
  assert.equal(tool(back, "add"), true);
  assert.equal(back.tips.includes("Turn off"), true);
  assert.equal(back.tips.includes("New project on dark"), true);
  assert.equal(back.texts.includes("Off"), false);
  assert.equal(back.tips.includes("Connected"), false);

  const onQuiet = await sidebar(connected);
  assert.equal(oneRow(onQuiet, "dark"), 1);
  assert.equal(tool(onQuiet, "power"), false, "turn off waits for hover");
  assert.equal(tool(onQuiet, "add"), false);

  const onKeys = await sidebar({ ...connected, kbd: true, navKey: "machine:dark" });
  assert.equal(tool(onKeys, "power"), true);
  assert.equal(tool(onKeys, "add"), true);

  const rail = await sidebar({ ...parkedDark, collapsed: true, hover: "dark" });
  assert.equal(oneRow(rail, "dark"), 1);
  assert.equal(tool(rail, "power"), false);
  assert.equal(tool(rail, "retry"), false);
  assert.equal(rail.texts.includes("dark"), false);
  assert.equal(rail.tips.includes("dark: Off"), true);
});

test("loading, unreachable, and needs login each stay on that one row", async () => {
  const loading = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "loading" }],
    live: [{ ...record, state: "connected" }], waking: new Set(["dark"]), parked: [record],
  });
  assert.equal(oneRow(loading, "dark"), 1);
  assert.equal(loading.ids.filter((id) => id === "machine-loading-dark").length, 1);
  assert.equal(loading.ids.includes("space-dark-sp"), false);
  assert.equal(loading.texts.includes("dark"), true);
  assert.equal(loading.tips.includes("Loading"), false);
  assert.equal(tool(loading, "power"), false);

  const down = await sidebar({ ...unreachable, hints: { dark: "ssh timed out" }, hover: "dark" });
  assert.equal(oneRow(down, "dark"), 1);
  assert.equal(down.ids.includes("machine-unavailable-dark"), false);
  assert.equal(tool(down, "retry"), true);
  assert.equal(tool(down, "power"), false);
  assert.equal(down.texts.includes("Unreachable"), true);
  assert.equal(down.texts.includes("Unavailable"), false);
  assert.equal(down.tips.includes("ssh timed out"), true);
  assert.equal(down.tips.includes("Refresh"), true);
  assert.equal(down.ids.includes("space-dark-sp"), true, "its projects stay, as last read");

  const login = await sidebar({ ...parkedDark, login: new Set(["dark"]), hover: "dark" });
  assert.equal(oneRow(login, "dark"), 1);
  assert.equal(tool(login, "login"), true);
  assert.equal(login.ids.includes("machine-login-copy-dark"), false);
  assert.equal(tool(login, "power"), false);
  assert.equal(login.texts.includes("Needs login"), true);
  assert.equal(login.texts.includes("Needs a login"), false);
  assert.equal(login.texts.includes("hc machine login dark"), false);
  assert.equal(login.tips.includes("Sign in"), true);
  assert.equal(login.ids.includes("space-dark-sp"), false);

  const loginQuiet = await sidebar({ ...parkedDark, login: new Set(["dark"]) });
  assert.equal(oneRow(loginQuiet, "dark"), 1);
  assert.equal(tool(loginQuiet, "login"), true, "Sign in stays on the row");
  assert.equal(tool(loginQuiet, "power"), false);

  const quiet = await sidebar(unreachable);
  assert.equal(oneRow(quiet, "dark"), 1);
  assert.equal(tool(quiet, "retry"), true, "retry stays on the row");
  assert.equal(tool(quiet, "power"), false);
  assert.equal(quiet.texts.includes("Unreachable"), true);
});

test("turning a machine off stops reading it at once, and turning it on adds the saved setup", async () => {
  const db = { parked: [], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; }, async machinesOff() { return this.parked; } };
  const { view, calls } = await parkedView(async (args) => {
    if (args[0] === "machine" && args[1] === "ls") return { code: 0, stdout: JSON.stringify({ machines: [] }) };
    if (args[1] === "add") return { code: 1, stdout: JSON.stringify({ error: { kind: "login_needed", message: "needs a login" } }) };
    return { code: 0, stdout: "" };
  }, db, { shared: () => null, home: () => "/home" });
  view.machines = [{ ...record, state: "connected" }];
  const { cx, drain } = context();
  view.turnOff("dark", cx);
  assert.equal(view.parked.some((row) => row.name === "dark"), true, "the row goes dim before hc answers");
  const places = new Map([
    ["home", { on: null, cwd: "/home", key: homeKey }],
    ["app", { on: "dark", cwd: "/srv", key: darkKey }],
  ]);
  const sp = [{ id: "home", machine: null, tabs: [] }, { id: "app", machine: "dark", tabs: [] }];
  assert.equal(view.due(Date.now(), sp, [], places, true).has(darkKey), false);
  assert.equal(view.due(Date.now(), sp, [], places, true).has(homeKey), true);
  const gitCalls = [];
  const { Spaces: WithExec } = await loadSpaces({
    exec: (...args) => { gitCalls.push(args); return { code: 1, stderr: "skipped" }; }, machines: () => [],
  });
  const quiet = Object.assign(new WithExec(), { parked: [record], checked: {}, unsure: new Set(), git: {} });
  await quiet.check(darkKey, cx);
  assert.deepEqual(gitCalls, [], "no git call toward a machine that is off");
  await drain();
  assert.deepEqual(clone(calls[0]), ["machine", "rm", "dark"]);
  assert.deepEqual(clone(db.parked.map((row) => row.name)), ["dark"]);

  calls.length = 0;
  view.turnOn("dark", cx);
  await drain();
  assert.deepEqual(clone(calls[0]), ADD_DARK);
  assert.equal(calls[0].includes("--install"), false);
  assert.equal(view.login.has("dark"), true);
  assert.equal(view.parked.some((row) => row.name === "dark"), true, "a login keeps the saved setup");

  view.parked = [];
  view.machines = [{ ...record, state: "connected" }];
  view.git = {};
  view.at = {};
  assert.equal(view.due(Date.now(), sp, [], places, true).has(darkKey), true, "on: it is read again");
});

// A view whose machine commands `answer` gives, kept in `calls`.
async function parkedView(answer, db, host = {}) {
  const calls = [];
  const hc = async (args) => {
    calls.push(args);
    return answer(args);
  };
  const { Spaces } = await loadSpaces({ hc, machines: () => [], exec: async () => ({ code: 0, stdout: "" }), ...host });
  const view = Object.assign(new Spaces(), {
    parked: [], machines: [], waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(), hints: {},
    git: {}, at: {}, busy: {}, ready: {}, folded: new Set(), checked: {}, unsure: new Set(), db: () => db,
  });
  return { view, calls };
}

test("an unreachable add keeps the machine and does not pass --via false", async () => {
  const db = { parked: [record], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; } };
  const { view, calls } = await parkedView(async (args) => {
    if (args[1] === "add") return { code: 1, stdout: JSON.stringify({ error: { kind: "unreachable", message: "timed out", hint: "ssh timed out" } }) };
    return { code: 0, stdout: JSON.stringify({ machines: [] }) };
  }, db);
  view.parked = [{ ...record, via: "false", session: "null" }];
  const { cx, drain } = context();
  view.turnOn("dark", cx);
  await drain();
  assert.equal(calls[0].includes("--via"), false);
  assert.equal(calls[0].includes("--session"), false);
  assert.equal(calls[0].includes("false"), false);
  assert.equal(view.failed.has("dark"), true);
  assert.equal(view.login.has("dark"), false);
  assert.equal(view.parked.some((row) => row.name === "dark"), true);
  assert.equal(view.hints.dark, "ssh timed out");
  assert.deepEqual(clone(calls[0]), ADD_DARK);
});

test("a remove that cannot be stored keeps the row and offers retry", async () => {
  const db = { async parkMachine() { throw new Error("disk"); }, async forgetMachine() {} };
  const { view, calls } = await parkedView(async () => ({ code: 0, stdout: "" }), db);
  view.machines = [{ name: "dark", target: "dark.example", via: false, session: null, state: "connected" }];
  await turnedOff(view);
  assert.deepEqual(clone(calls[0]), ["machine", "rm", "dark"]);
  assert.equal(view.parked.some((row) => row.name === "dark" && row.via === "" && row.session === ""), true);
  assert.equal(view.failed.has("dark"), true);
});

test("a remove Herdr refuses puts the machine back", async () => {
  const db = { parked: [], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; } };
  const { view } = await parkedView(async () => (failure("still there")), db);
  view.machines = [{ ...record, state: "connected" }];
  await turnedOff(view);
  assert.equal(view.parked.some((row) => row.name === "dark"), false);
  assert.equal(view.failed.has("dark"), false);
  assert.deepEqual(db.parked, []);
});

test("an off machine is still off after the database is opened again", async (t) => {
  const { fresh } = await temporaryKdbFile(t);
  await fresh().parkMachine({ name: "dark", target: "dark.example", via: "ssh -J jump", session: "sess", temporary: true });
  assert.deepEqual(clone(await fresh().machinesOff()), [{ name: "dark", target: "dark.example", via: "ssh -J jump", session: "sess", temporary: true }]);
  await fresh().forgetMachine("dark");
  assert.deepEqual(clone(await fresh().machinesOff()), []);
  await fresh().parkMachine({ name: "kept", target: "kept.example", via: "ssh -J jump", session: "sess", temporary: false });
  await fresh().parkMachine({ name: "plain", target: "plain.example", via: "false", session: "null", temporary: false });
  await fresh().parkMachine({ name: "mixed", target: "mixed.example", via: "null", session: "sess", temporary: false });
  assert.deepEqual(clone(await fresh().machinesOff()), [
    { name: "kept", target: "kept.example", via: "ssh -J jump", session: "sess", temporary: false },
    { name: "mixed", target: "mixed.example", via: "", session: "sess", temporary: false },
    { name: "plain", target: "plain.example", via: "", session: "", temporary: false },
  ]);
});

const syncOn = { config: { version: 1, peers: { dark: { enabled: true } } }, status: {} };

test("a connected machine's row keeps Sync in sight when it is on or cannot run, and with its hover actions when off", async () => {
  const off = await sidebar(connected);
  assert.equal(tool(off, "sync"), false, "off waits for hover");
  const offHover = await sidebar({ ...connected, hover: "dark" });
  assert.deepEqual(tools(offHover), ["power", "add", "sync"]);
  assert.equal(offHover.tips.includes("Sync"), true);

  const on = await sidebar({ ...connected, sync: syncOn });
  assert.equal(tool(on, "sync"), true, "on is state: no hover needed");
  assert.equal(tool(on, "power"), false);
  assert.equal(on.tips.includes("Sync dark"), true);
  const synced = await sidebar({ ...connected, sync: { ...syncOn, status: { dark: { synced_at: new Date(Date.now() - 120_000).toISOString() } } } });
  assert.equal(synced.tips.includes("Sync dark: synced 2 min ago"), true);
  const cannot = await sidebar({ ...connected, sync: { ...syncOn, status: { dark: { reason: "update" } } } });
  assert.equal(tool(cannot, "sync"), true);
  assert.equal(cannot.tips.includes("Sync dark: Update kanso there"), true);
  assert.equal(cannot.texts.includes("Update kanso there"), false, "the words stay in the tooltip");
  assert.equal(cannot.texts.includes("Sync can't run"), true, "the row says it in a word");

  const keys = await sidebar({ ...connected, sync: syncOn, kbd: true, navKey: "machine:dark" });
  assert.equal(tool(keys, "power"), true, "the keyboard on the row shows its actions");

  const rail = await sidebar({ ...connected, sync: syncOn, collapsed: true });
  assert.equal(tool(rail, "sync"), false);
  const here = await sidebar({ ...connected, sync: { config: { version: 1, peers: { null: { enabled: true } } }, status: {} }, hover: "local" });
  assert.equal(tool(here, "sync"), false, "this computer has none");
});

test("off, unreachable, loading and needs login keep their one action, with no Sync", async () => {
  const states = [
    [{ parked: [record] }, ["power"]],
    [{ layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "unavailable" }], live: [{ ...record, state: "unreachable" }] }, ["retry"]],
    [{ layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "loading" }], live: [{ ...record, state: "connected" }], waking: new Set(["dark"]), parked: [record] }, []],
    [{ parked: [record], login: new Set(["dark"]) }, ["login"]],
  ];
  for (const [state, actions] of states) {
    const drawn = await sidebar({ spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], ...state, sync: syncOn, hover: "dark" });
    assert.deepEqual(tools(drawn), actions);
  }
});

// The keyboard on a computer's row, then j to each tool it shows and Enter on it: the stops it walked, and what each Enter ran.
async function keyWalk(state) {
  const ran = [];
  const drawn = await sidebar({ ...state, kbd: true, navKey: "machine:dark", run: (cmd, args) => ran.push([cmd, clone(args)]) });
  const { view } = drawn;
  Object.assign(view, { setPower: (m, on) => ran.push(["power", m, on]), retryMachine: (m) => ran.push(["retry", m]), toggleSync: (m) => ran.push(["sync", m]) });
  const keyCx = { stop_propagation() {}, notify() {} };
  const stops = [];
  for (;;) {
    const before = view.navKey;
    view.listKeyDown({ key: "j", modifiers: {} }, keyCx);
    if (view.navKey === before || !view.navKey.startsWith("machine-") || !view.navKey.endsWith(":dark")) break;
    stops.push(view.navKey);
    view.render();
    assert.ok(view.nav.some((n) => n.key === view.navKey), `${view.navKey} stays a stop while the ring is on it`);
    view.listKeyDown({ key: "enter", modifiers: {} }, keyCx);
  }
  return { stops, ran };
}

test("each tool a computer row shows is its own keyboard stop: j walks to it and Enter runs it, as a press does", async () => {
  const base = { spaces: [local, remote], layouts: [{ name: null, layout: "ready" }] };
  const login = ["terminal.open", { argv: ["hc", "machine", "login", "dark"], place: "right" }];
  // On, Sync on or off: Turn off, New project, then Sync, wherever Sync sits.
  const onStops = ["machine-lu-power:dark", "machine-lu-plus:dark", "machine-lu-arrow-right-left:dark"];
  const onRan = [["power", "dark", false], ["space.new", { machine: "dark" }], ["sync", "dark"]];
  const walks = [
    ["connected", connected, onStops, onRan],
    ["needs login", { ...base, parked: [record], login: new Set(["dark"]) }, ["machine-lu-key:dark"], [login]],
    ["off", { ...base, parked: [record] }, ["machine-lu-power:dark"], [["power", "dark", true]]],
    ["unreachable", unreachable, ["machine-lu-refresh-cw:dark"], [["retry", "dark"]]],
    ["sync on", { ...connected, sync: syncOn }, onStops, onRan],
  ];
  for (const [name, state, stops, ran] of walks) {
    const walked = await keyWalk(state);
    assert.deepEqual(walked.stops, stops, `${name}: a stop per tool, in screen order`);
    assert.deepEqual(walked.ran, ran, `${name}: Enter runs each tool`);
  }
});

async function syncView({ sync = { config: {}, status: {} }, host = {} } = {}) {
  const { Spaces } = await loadSpaces({ appHome: () => "/app", setShared: () => {}, ...host });
  return Object.assign(new Spaces(), { sync, machines: [], parked: [] });
}

test("one click saves the machine on, tells Spend, and a failed save turns the icon back and says so", async () => {
  const files = { "/app/data/kanso-sync/config.json": JSON.stringify({ version: 1, peers: { loki: { enabled: true } } }) };
  const kicks = [];
  const toasts = [];
  const made = [];
  const host = {
    exec: async (command, args) => { made.push([command, ...args]); return { code: 0, stdout: "" }; }, notify: (n) => toasts.push(n), setShared: (key, value) => kicks.push([key, value]),
    readTextFile: async (file) => files[file] ?? null,
    writeTextFile: async (file, text, expected) => { assert.equal(expected, files[file] ?? null); files[file] = text; },
  };
  const view = await syncView({ host });
  const { cx, drain } = context();
  view.toggleSync("dark", cx);
  assert.equal(view.sync.config.peers.dark.enabled, true, "the icon turns before the write lands");
  await drain();
  assert.deepEqual(JSON.parse(files["/app/data/kanso-sync/config.json"]), { version: 1, peers: { loki: { enabled: true }, dark: { enabled: true } } });
  assert.deepEqual(kicks.map(([key]) => key), ["kanso.sync.kick"]);
  assert.deepEqual(made, [["mkdir", "-p", "/app/data/kanso-sync"]]);
  assert.equal(view.syncSaving, false);

  const broken = await syncView({ host: { ...host, writeTextFile: async () => { throw new Error("stale"); } } });
  broken.toggleSync("dark", cx);
  await drain();
  assert.equal(broken.sync.config.peers?.dark, undefined);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, "Sync dark was not changed");
  assert.equal(kicks.length, 1, "a failed save does not tell Spend");
});

test("the sidebar reads Sync only when the machine list has a remote machine", async () => {
  const reads = [];
  let list = [];
  const view = await syncView({ host: {
    hc: async () => ({ code: 0, stdout: JSON.stringify({ machines: list }) }),
    readTextFile: async (file) => { reads.push(file); return file.endsWith("status.json") ? JSON.stringify({ peers: { dark: { reason: "update" } } }) : null; },
  } });
  await view.readMachines();
  assert.equal(reads.length, 0);
  list = [{ ...record, state: "connected" }];
  await view.readMachines();
  assert.deepEqual(reads, ["/app/data/kanso-sync/config.json", "/app/data/kanso-sync/status.json"]);
  assert.equal(view.sync.status.dark.reason, "update");
});

test("On the rail a computer is a Tile like the projects beside it: Tab reaches it with the kit's ring, Enter and Space fold it, and a right click opens its menu", async () => {
  const opened = [];
  const { Spaces } = await loadSidebar(popoverHost(), {
    shared: (key) => (key === "sidebar.collapsed" ? true : null), spaces: () => connected.spaces, machines: () => connected.layouts, openOverlay: (overlay) => opened.push(Object.keys(overlay.props)[0]),
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(connected.spaces.map((space) => space.id)), machines: connected.live })));
  const walk = () => {
    const keys = keyboard(view.render());
    const at = keys.stops.findIndex((stop) => stop.tag === "machine-dark");
    assert.ok(at >= 0, "the computer's tile is a Tab stop");
    for (let n = 0; n < at; n += 1) keys.tab();
    return { keys, tile: keys.tab() };
  };
  const { tile } = walk();
  assert.ok(calls(tile, "focus").length > 0, "its ring");
  assert.equal(arg(tile, "accessibility_label"), "dark");
  assert.deepEqual(tipsOf(tile), ["dark"], "its name and state in the tooltip");
  assert.ok(svgsOf(tile).some((path) => path.endsWith("server.svg")));
  assert.equal(view.nav.filter((row) => row.key === "machine:dark").length, 1, "and still one stop of the list");
  for (const [key, folded] of [["enter", true], ["space", false]]) {
    walk().keys.key(key, { notify() {} });
    assert.equal(view.folded.has("dark"), folded, key);
  }
  calls(walk().tile, "on_mouse_down").find((call) => call[1] === "right")[2]({}, { stop_propagation() {} });
  assert.deepEqual(opened, ["machineMenu"]);

  const rail = find(view.render(), (el) => calls(el, "id").some((call) => call[1] === "machine-dark-row"));
  assert.ok(rail, "the whole 48px row answers, not only the tile inside it");
  assert.deepEqual(tipsOf(rail).at(-1), "dark", "its tooltip is over the row");
  view.folded.clear();
  calls(rail, "on_click").at(-1)[1]({}, { notify() {} });
  assert.equal(view.folded.has("dark"), true, "a click beside the tile folds it");
  opened.length = 0;
  calls(rail, "on_mouse_down").find((call) => call[1] === "right")[2]({}, { stop_propagation() {} });
  assert.deepEqual(opened, ["machineMenu"], "a right click beside the tile opens its menu");
  const stopped = [];
  calls(walk().tile, "on_click").at(-1)[1]({}, { notify() {}, stop_propagation: () => stopped.push(true) });
  assert.deepEqual(stopped, [true], "a press on the tile stays on the tile, so the row does not fold it twice");
});
