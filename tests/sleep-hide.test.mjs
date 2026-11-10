// Ordering sleep hides the tab or parks the pane before the slow read, and a wake mid-flight cancels it.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

const space = { id: "sp", name: "kanso", folder: "/w", active: true, tabs: [{ id: "tb1", active: true, name: "Main" }] };

function host(order) {
  return {
    spaces: () => [space],
    panes: () => [{ pane: "p1", tab: "tb1", terminal: "t1", cwd: "/w" }],
    terminals: () => [{ address: "t1" }],
    shared: () => null,
    setShared: () => {},
    run: () => order.push("hide"),
    hc: async () => { order.push("hc"); return { code: 1, stdout: "" }; },
    home: () => "/h",
    readTextFile: async () => { throw new Error("no"); },
    props: () => ({}),
    theme: () => ({}),
    closeOverlay: () => {},
    exec: async () => ({ code: 1, stdout: "" }),
  };
}

const shown = [{ name: "Tab 1", tab: { id: "tb1" }, blocker: null, error: null, fronts: new Map(),
  capture: { per: null, cols: [{ w: 1, panes: [{ terminal: "t1", argv: ["claude"], pid: 1, resume: "c", name: "Ada" }] }] } }];

test("ordering a tab to sleep hides it before the slow read", async () => {
  const order = [];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host(order));
  const s = new Sleep();
  s.space = space;
  s.store = { asleep: async () => [], sleep: async () => "id1" };
  const cx = { notify() {}, spawn(fn) { return fn(cx); } };
  s.startSleep(cx, false, "tb1", null);
  assert.equal(order[0], "hide");
  assert.ok(order.indexOf("hide") < order.indexOf("hc"), "the hide is not waiting on the read");
});

test("ordering a project to sleep hides it before the slow read", async () => {
  const order = [];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host(order));
  const s = new Sleep();
  s.space = space;
  s.view = "sleep";
  s.whole = true;
  s.busy = null;
  s.sleepers = shown;
  s.sleepTabs = space.tabs;
  s.store = { asleep: async () => [], sleep: async () => "id1" };
  const cx = { notify() {}, spawn(fn) { return fn(cx); } };
  s.sleep(cx);
  assert.equal(order[0], "hide");
  assert.ok(order.indexOf("hide") < order.indexOf("hc"));
});

test("waking a sleep that is still going cancels it and does not claim it", async () => {
  const calls = [];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host([]));
  const s = new Sleep();
  s.busy = null;
  s.act = (_cx, id, how) => calls.push([id, how]);
  s.store = { claim: async () => { calls.push("claim"); return null; } };
  const cx = { notify() {}, spawn(fn) { return fn(cx); } };
  s.wake({ id: "s1", state: "sleeping", name: "Ada" }, cx);
  assert.deepEqual(calls, [["s1", "undo"]]);
  s.wake({ id: "s1", state: "undoing", name: "Ada" }, cx);
  assert.deepEqual(calls, [["s1", "undo"]], "one already coming back is left to finish");
  s.wake({ id: "s2", state: "asleep", name: "Bea" }, cx);
  assert.ok(calls.includes("claim"), "an asleep row is claimed");
  assert.equal(calls.filter((c) => Array.isArray(c)).length, 1, "the one still going was cancelled, not claimed");
});

test("a settled tab and a tab sent to sleep leave the bar", async () => {
  const { shownTabs } = await load("kanso-tabs/main.js", ["shownTabs"], { shared: () => null });
  const tabs = [{ id: "a", active: true }, { id: "b", settled: true }, { id: "c" }];
  assert.deepEqual(shownTabs(tabs, [{ id: "away:c", tab: "c", settle: ["c"] }]).map((t) => t.id), ["a"]);
  assert.deepEqual(shownTabs(tabs, []).map((t) => t.id), ["a", "c"]);
});
