import test from "node:test";
import assert from "node:assert/strict";
import { load, success, storeShared, context } from "./helpers.mjs";
import { loadSpaces } from "./mod-fixtures.mjs";

const { STORE, MIGRATED } = await load("kanso-settings/pieces.js", ["STORE", "MIGRATED"]);
const { caffeineCall, createCaffeine, SETUP_EVERY_MS } = await load("kanso-panel/caffeine-model.js", ["caffeineCall", "createCaffeine", "SETUP_EVERY_MS"]);
const VERBS = ["on", "off", "read"];
const verbOf = (args) => VERBS.find((verb) => caffeineCall("linux", verb).args[1] === args?.[1]) ?? null;

async function sidebar({ pieces = {}, replies = {} } = {}) {
  const store = { [MIGRATED]: true, [STORE]: pieces };
  const calls = [], toasts = [], connected = [], opened = [], clock = { at: 0 };
  const exec = async (command, args, options = {}) => {
    if (command === "uname") return success("Linux");
    const call = { on: options.on ?? "", verb: verbOf(args) };
    calls.push(call);
    const reply = replies[`${call.on} ${call.verb}`];
    return success(Array.isArray(reply) ? reply.shift() ?? "off" : reply ?? "off");
  };
  const { Spaces } = await loadSpaces({
    ...storeShared(store, null),
    window: () => ({ active: true, platform: "linux" }),
    terminals: () => [], spaces: () => [], panes: () => [], agents: () => [],
    machines: () => connected.map((name) => ({ name, layout: "ready" })),
    home: () => "/tmp", notify: (note) => toasts.push(note), exec, hc: async () => success("[]"), run: (name) => opened.push(name),
  });
  const { cx, drain } = context();
  cx.timer = { after() {}, every() {} };
  const view = Object.assign(new Spaces(), {
    tasks: {}, threads: {}, git: {}, checked: {}, machines: [], parked: [], waking: new Set(), login: new Set(), failed: new Set(),
    names: { title: (m) => m || "This computer" }, redraw() {},
    caffeine: createCaffeine({ local: "linux", now: () => clock.at, run: (call) => exec(call.command, call.args, call) }),
  });
  const follow = async () => { calls.length = 0; view.followCaffeine(cx); await drain(); return calls; };
  return { view, cx, drain, calls, toasts, store, connected, follow, opened, clock };
}

test("Hiding Caffeine turns it off on this computer when no other computer is added", async () => {
  const s = await sidebar({ replies: { " on": "on" } });
  await s.view.caffeine.change("", true);
  s.store[STORE] = { "panel.caffeine": "hide" };
  s.calls.length = 0;
  s.view.refreshMachines(s.cx, true);
  await s.drain();
  assert.deepEqual(s.calls, [{ on: "", verb: "off" }]);
});

test("While Caffeine is hidden, a computer that connects again is turned off again", async () => {
  const s = await sidebar({ pieces: { "panel.caffeine": "hide" } });
  s.connected.push("grey");
  assert.ok((await s.follow()).some((call) => call.on === "grey" && call.verb === "off"));
  s.connected.length = 0;
  await s.follow();
  s.connected.push("grey");
  assert.deepEqual((await s.follow()).filter((call) => call.on === "grey"), [{ on: "grey", verb: "off" }]);
});

test("The Caffeine panel lists every connected computer even with Computers hidden in the sidebar", async () => {
  const s = await sidebar({ pieces: { "sidebar.computers": "hide" } });
  s.connected.push("grey");
  s.view.refreshMachines(s.cx);
  await s.drain();
  assert.deepEqual(Object.keys(s.store["kanso.caffeine"]).toSorted(), ["", "grey"]);
});

test("Turning Caffeine off through its set up ends with it off and a toast with Undo", async () => {
  const s = await sidebar({ replies: { "grey on": "on", "grey off": "setup", "grey read": "off" } });
  s.connected.push("grey");
  await s.view.caffeine.change("grey", true);
  s.view.setCaffeine("grey", false, s.cx);
  await s.drain();
  s.clock.at += SETUP_EVERY_MS;
  await s.follow();
  assert.deepEqual(s.opened, ["space.new"], "the set up opens in a new space on grey");
  assert.equal(s.view.caffeine.look("grey").setup, false);
  assert.equal(s.toasts.at(-1)?.title, "Caffeine off: grey");
});
