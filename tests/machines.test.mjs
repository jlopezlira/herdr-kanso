// A remote machine can be turned off from the sidebar and back on with the setup that was saved.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { load, clone, temporary, exec, context } from "./helpers.mjs";

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
  const { machineState, machineTip, machineHot } = await load("kanso-spaces/machines.js", ["machineState", "machineTip", "machineHot"]);
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
  assert.equal(machineHot("dark", null, true, "machine-power:dark"), true);
  assert.equal(machineHot("dark", null, true, "machine-retry:dark"), true);
  assert.equal(machineHot("dark", null, false, "machine-power:dark"), false);
  assert.equal(machineHot(null, "local", false, null), true);
  assert.equal(machineHot("dark", "local", true, "machine:odin"), false);
});

test("hc machine ls is the live list, without temporary rows", async () => {
  const { listedMachines } = await load("kanso-spaces/machines.js", ["listedMachines"]);
  const text = JSON.stringify({ machines: [{ name: "dark", state: "connected" }, { name: "tmp", state: "connected", temporary: true }] });
  assert.deepEqual(clone(listedMachines({ code: 0, stdout: text })), [{ name: "dark", state: "connected" }]);
  assert.deepEqual(clone(listedMachines({ code: 1, stdout: text })), []);
  assert.deepEqual(clone(listedMachines(null)), []);
  assert.deepEqual(clone(listedMachines({ code: 0, stdout: "nope" })), []);
});

test("off hides that machine, and this computer has no switch", async () => {
  const { isOff, namesOff, heldNames, connectedNames, pollKeys, visibleSpaces, visibleAgents, machinePhase, powerId, machineTitle } = await load(
    "kanso-spaces/machines.js",
    ["isOff", "namesOff", "heldNames", "connectedNames", "pollKeys", "visibleSpaces", "visibleAgents", "machinePhase", "powerId", "machineTitle"],
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
  assert.equal(powerId(null), null);
  assert.equal(powerId("dark"), "machine-power-dark");
  assert.equal(machineTitle(null, "macbook"), "macbook");
  assert.equal(machineTitle(null, ""), "This computer");
  assert.equal(machineTitle("dark", "macbook"), "dark");
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
  const ids = [];
  const texts = [];
  const tips = [];
  const node = () => {
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (prop === "id") return (id) => { ids.push(id); return proxy; };
        if (prop === "child") return (value) => { if (typeof value === "string") texts.push(value); return proxy; };
        if (prop === "tooltip") return (value) => { if (typeof value === "string") tips.push(value); return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        return () => proxy;
      },
    });
    return proxy;
  };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node,
    Popover: { new: node }, Toggle: { new: (id) => { ids.push(id); return node(); } }, Button: { new: (id) => { ids.push(id); return node(); } },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", chrome: "#111", hover: "#222", ansi2: "#0f0", blocked: "#c44", border: "#333", raised: "#222", accent: "#09f" }),
    shared: (key) => (key === "sidebar.collapsed" ? state.collapsed === true : null), setShared: () => {},
    spaces: () => state.spaces, panes: () => [], agents: () => [], terminals: () => [],
    machines: () => state.layouts, run: () => {}, home: () => "/Users/me", props: () => ({}),
  });
  const view = Object.assign(new Spaces(), {
    git: {}, shown: new Set(state.spaces.map((space) => space.id)), born: {}, custom: {}, order: "updated",
    machines: state.live ?? [], parked: state.parked ?? [], folded: new Set(), agentsFolded: new Set(),
    waking: state.waking ?? new Set(), login: state.login ?? new Set(), failed: state.failed ?? new Set(),
    powerBusy: new Set(), hints: state.hints ?? {}, hoverMachine: state.hover ?? null,
    kbd: state.kbd === true, navKey: state.navKey ?? null,
    handle: { is_focused: () => state.kbd === true, focus() {} },
    hostName: state.hostName ?? "macbook", orderPicker: node,
  });
  view.render();
  return { view, ids, texts, tips };
}

const local = { id: "home", name: "~", folder: "/Users/me", machine: null, active: true, tabs: [] };
const remote = { id: "dark-sp", name: "app", folder: "/srv", machine: "dark", active: false, tabs: [] };

const oneRow = (drawn, name) => drawn.view.nav.filter((row) => row.key === `machine:${name}`).length;

test("each machine state is one row, and this computer has no power button", async () => {
  const alone = await sidebar({ spaces: [local], layouts: [{ name: null, layout: "ready" }] });
  assert.equal(alone.ids.includes("machine-local"), false, "one machine: no header");
  assert.equal(alone.ids.includes("machine-power-local"), false);

  const off = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record], hostName: "macbook",
  });
  assert.equal(oneRow(off, "dark"), 1);
  assert.equal(off.ids.includes("machine-local"), true);
  assert.equal(off.ids.includes("machine-dark"), true);
  assert.equal(off.ids.filter((id) => id === "machine-dark").length, 1);
  assert.equal(off.ids.includes("machine-power-dark"), false, "power waits for hover");
  assert.equal(off.ids.includes("machine-power-local"), false);
  assert.equal(off.ids.includes("space-dark-sp"), false, "its projects are not listed");
  assert.equal(off.texts.includes("macbook"), true);
  assert.equal(off.texts.includes("dark"), true);
  assert.equal(off.texts.includes("Off"), true);
  assert.equal(off.texts.includes("Unavailable"), false);

  const offHover = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record], hover: "dark",
  });
  assert.equal(offHover.ids.includes("machine-power-dark"), true);
  assert.equal(offHover.tips.includes("Turn on"), true);
  assert.equal(offHover.ids.includes("machine-add-dark"), false);
  assert.equal(offHover.ids.includes("machine-retry-dark"), false);

  const keys = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record],
    kbd: true, navKey: "machine:dark",
  });
  assert.equal(keys.ids.includes("machine-power-dark"), true);
  assert.ok(keys.view.nav.some((row) => row.key === "machine-power:dark"));

  const back = await sidebar({
    spaces: [local, remote],
    layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }],
    live: [{ ...record, state: "connected" }], hover: "dark",
  });
  assert.equal(oneRow(back, "dark"), 1);
  assert.equal(back.ids.includes("space-dark-sp"), true, "on: its project is back");
  assert.equal(back.ids.includes("machine-power-dark"), true);
  assert.equal(back.ids.includes("machine-add-dark"), true);
  assert.equal(back.tips.includes("Turn off"), true);
  assert.equal(back.tips.includes("New space"), true);
  assert.equal(back.texts.includes("Off"), false);
  assert.equal(back.tips.includes("Connected"), false);

  const rail = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record],
    collapsed: true, hover: "dark",
  });
  assert.equal(oneRow(rail, "dark"), 1);
  assert.equal(rail.ids.includes("machine-power-dark"), false);
  assert.equal(rail.ids.includes("machine-retry-dark"), false);
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
  assert.equal(loading.ids.includes("machine-power-dark"), false);

  const down = await sidebar({
    spaces: [local, remote],
    layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "unavailable" }],
    live: [{ ...record, state: "unreachable" }], hints: { dark: "ssh timed out" }, hover: "dark",
  });
  assert.equal(oneRow(down, "dark"), 1);
  assert.equal(down.ids.includes("machine-unavailable-dark"), false);
  assert.equal(down.ids.includes("machine-retry-dark"), true);
  assert.equal(down.ids.includes("machine-power-dark"), false);
  assert.equal(down.texts.includes("Unreachable"), true);
  assert.equal(down.texts.includes("Unavailable"), false);
  assert.equal(down.tips.includes("ssh timed out"), true);
  assert.equal(down.tips.includes("Retry"), true);
  assert.equal(down.ids.includes("space-dark-sp"), false);

  const login = await sidebar({
    spaces: [local, remote], layouts: [{ name: null, layout: "ready" }], parked: [record], login: new Set(["dark"]), hover: "dark",
  });
  assert.equal(oneRow(login, "dark"), 1);
  assert.equal(login.ids.includes("machine-login-dark"), true);
  assert.equal(login.ids.includes("machine-login-copy-dark"), false);
  assert.equal(login.ids.includes("machine-power-dark"), false);
  assert.equal(login.texts.includes("Needs login"), true);
  assert.equal(login.texts.includes("Needs a login"), false);
  assert.equal(login.texts.includes("hc machine login dark"), false);
  assert.equal(login.tips.includes("hc machine login dark"), true);
  assert.equal(login.ids.includes("space-dark-sp"), false);

  const quiet = await sidebar({
    spaces: [local, remote],
    layouts: [{ name: null, layout: "ready" }, { name: "dark", layout: "unavailable" }],
    live: [{ ...record, state: "unreachable" }],
  });
  assert.equal(quiet.ids.includes("machine-retry-dark"), false, "retry waits for hover");
  assert.equal(quiet.texts.includes("Unreachable"), true);
});

test("turning a machine off stops reading it at once, and turning it on adds the saved setup", async () => {
  const calls = [];
  const db = { parked: [], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; }, async machinesOff() { return this.parked; } };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    hc: async (args) => {
      calls.push(args);
      if (args[0] === "machine" && args[1] === "ls") return { code: 0, stdout: JSON.stringify({ machines: [] }) };
      if (args[1] === "add") return { code: 1, stdout: JSON.stringify({ error: { kind: "login_needed", message: "needs a login" } }) };
      return { code: 0, stdout: "" };
    },
    machines: () => [], shared: () => null, home: () => "/home", exec: async () => ({ code: 0, stdout: "" }),
  });
  const view = Object.assign(new Spaces(), {
    parked: [], machines: [{ ...record, state: "connected" }], waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(),
    git: {}, at: {}, busy: {}, ready: {}, folded: new Set(), checked: {}, unsure: new Set(), db: () => db,
  });
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
  const { Spaces: WithExec } = await load("kanso-spaces/main.js", ["Spaces"], {
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
  assert.deepEqual(clone(calls[0]), ["machine", "add", "dark.example", "--name", "dark", "--json"]);
  assert.equal(calls[0].includes("--install"), false);
  assert.equal(view.login.has("dark"), true);
  assert.equal(view.parked.some((row) => row.name === "dark"), true, "a login keeps the saved setup");

  view.parked = [];
  view.machines = [{ ...record, state: "connected" }];
  view.git = {};
  view.at = {};
  assert.equal(view.due(Date.now(), sp, [], places, true).has(darkKey), true, "on: it is read again");
});

async function parkedView(hc, db) {
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { hc, machines: () => [], exec: async () => ({ code: 0, stdout: "" }) });
  return Object.assign(new Spaces(), {
    parked: [], machines: [], waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(), hints: {},
    git: {}, at: {}, busy: {}, ready: {}, folded: new Set(), checked: {}, unsure: new Set(), db: () => db,
  });
}

test("an unreachable add keeps the machine and does not pass --via false", async () => {
  const calls = [];
  const db = { parked: [record], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; } };
  const view = await parkedView(async (args) => {
    calls.push(args);
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
  assert.deepEqual(clone(calls[0]), ["machine", "add", "dark.example", "--name", "dark", "--json"]);
});

test("a remove that cannot be stored keeps the row and offers retry", async () => {
  const calls = [];
  const db = { async parkMachine() { throw new Error("disk"); }, async forgetMachine() {} };
  const view = await parkedView(async (args) => { calls.push(args); return { code: 0, stdout: "" }; }, db);
  view.machines = [{ name: "dark", target: "dark.example", via: false, session: null, state: "connected" }];
  const { cx, drain } = context();
  view.turnOff("dark", cx);
  await drain();
  assert.deepEqual(clone(calls[0]), ["machine", "rm", "dark"]);
  assert.equal(view.parked.some((row) => row.name === "dark" && row.via === "" && row.session === ""), true);
  assert.equal(view.failed.has("dark"), true);
});

test("a remove Herdr refuses puts the machine back", async () => {
  const db = { parked: [], async parkMachine(row) { this.parked = [clone(row)]; }, async forgetMachine() { this.parked = []; } };
  const view = await parkedView(async () => ({ code: 1, stdout: "", stderr: "still there" }), db);
  view.machines = [{ ...record, state: "connected" }];
  const { cx, drain } = context();
  view.turnOff("dark", cx);
  await drain();
  assert.equal(view.parked.some((row) => row.name === "dark"), false);
  assert.equal(view.failed.has("dark"), false);
  assert.deepEqual(db.parked, []);
});

test("an off machine is still off after the database is opened again", async (t) => {
  const dir = await temporary(t);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir });
  const file = join(dir, "kanso");
  await new Kdb(file).parkMachine({ name: "dark", target: "dark.example", via: "ssh -J jump", session: "sess", temporary: true });
  assert.deepEqual(clone(await new Kdb(file).machinesOff()), [{ name: "dark", target: "dark.example", via: "ssh -J jump", session: "sess", temporary: true }]);
  await new Kdb(file).forgetMachine("dark");
  assert.deepEqual(clone(await new Kdb(file).machinesOff()), []);
  await new Kdb(file).parkMachine({ name: "kept", target: "kept.example", via: "ssh -J jump", session: "sess", temporary: false });
  await new Kdb(file).parkMachine({ name: "plain", target: "plain.example", via: "false", session: "null", temporary: false });
  await new Kdb(file).parkMachine({ name: "mixed", target: "mixed.example", via: "null", session: "sess", temporary: false });
  assert.deepEqual(clone(await new Kdb(file).machinesOff()), [
    { name: "kept", target: "kept.example", via: "ssh -J jump", session: "sess", temporary: false },
    { name: "mixed", target: "mixed.example", via: "", session: "sess", temporary: false },
    { name: "plain", target: "plain.example", via: "", session: "", temporary: false },
  ]);
});
