import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

// One agent asleep, woken back into its tab: Herdr opens t1 for it, and its session record says `session`.
async function waking(session) {
  const calls = [], writes = [], reads = [], clock = { at: 1000 };
  const open = [{ pane: "p0", tab: "tb1", terminal: "t0" }];
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], {
    Date: { now: () => { clock.at += 1000; return clock.at; } },
    spaces: () => [{ id: "sp", name: "Kanso", folder: "/w", tabs: [{ id: "tb1", name: "Tab" }] }],
    machines: () => [],
    home: () => "/Users/jj",
    shared: (key) => (key === "strip.state" ? { tb1: { cols: [{ panes: open.map((p) => p.pane) }] } } : null),
    panes: () => open,
    terminals: () => [],
    props: () => ({}),
    theme: () => ({}),
    run(name) { if (name === "terminal.open") open.push({ pane: "p1", tab: "tb1", terminal: "t1" }); },
    hc: async (args) => {
      calls.push(args.join(" "));
      return args[0] === "get" ? { code: 0, stdout: JSON.stringify({ pid: 5, foreground: { pid: 77, argv: ["claude", "--resume", "c1"] } }) } : { code: 0, stdout: "" };
    },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    readTextFile: async () => { reads.push(calls.filter((c) => c.startsWith("label")).join(";")); return JSON.stringify({ pid: 77, sessionId: session }); },
    closeOverlay() {},
  });
  const store = {
    renew: async () => { writes.push("renew"); return true; },
    woke: async () => { writes.push("woke"); return true; },
    narrow: async () => { writes.push("narrow"); return true; },
    release: async () => { writes.push("release"); return true; },
  };
  const row = { id: "z1", token: "k", from: ":/w", name: "Notes", space: "Kanso", spaceId: "sp", into: { tabId: "tb1", tab: "Tab" }, agents: [],
    cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w", resume: "c1", name: "Ada" }] }] };
  const view = Object.assign(new Sleep(), { refresh: async () => {} });
  const ok = await view.wakeHeld(row, { notify() {}, sleep: async () => {} }, store);
  return { ok, calls, writes, reads };
}

test("a wake says on the terminal it opened which conversation it brings back, before it checks it", async () => {
  const { ok, calls, writes, reads } = await waking("c1");
  assert.equal(ok, true);
  assert.equal(reads[0], "label t1 kanso.wakes=c1", "the sidebar can draw it once while the check still runs");
  assert.equal(writes.at(-1), "woke");
  assert.equal(calls.includes("label t1 kanso.wakes="), false, "awake: the terminal keeps saying so");
});

test("an agent that did not come back loses the mark: it stays asleep, and the hold is renewed while the check waits", async () => {
  const { ok, calls, writes } = await waking("another");
  assert.equal(ok, false);
  assert.equal(calls.at(-1), "label t1 kanso.wakes=", "the terminal left open no longer says it runs it");
  assert.equal(writes.at(-1), "narrow");
  assert.ok(writes.filter((w) => w === "renew").length > 3, "a long check keeps the hold fresh");
});
