// Unchanged sidebar state does not start database maintenance.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

test("seen state writes only on changes and coalesces changes for ten seconds", async () => {
  const writes = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { terminals: () => [], shared: () => null });
  const row = { conversation: "c1", terminal: "t1", title: "First" };
  const panel = { agents: new Map(), remember: (seen, at) => writes.push([at, seen.size]), toRestore: () => [] };
  const view = Object.assign(new Spaces(), { panel, panelReady: true, seenNow: new Map([["t1", row]]), nameTerminals() {} });
  view.keepSeen(0);
  view.seenNow = new Map([["t1", { ...row, title: "Changed" }]]);
  for (const now of [2000, 9999, 10000, 20000, 60000]) view.keepSeen(now);
  assert.deepEqual(writes, [[0, 1], [10000, 1]]);
  view.seenNow = new Map();
  view.keepSeen(62000);
  assert.deepEqual(writes.at(-1), [62000, 0]);
});

test("name restoration reloads agents only while a name is pending", async () => {
  let pending = false, reloads = 0;
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { terminals: () => [], shared: () => null });
  const panel = {
    agents: new Map(), remember() {}, toRestore: () => pending ? [{ terminal: "t1", conversation: "c1", name: "Name" }] : [],
    reloadAgents: async () => { reloads += 1; },
  };
  const view = Object.assign(new Spaces(), { panel, panelReady: true, seenNow: new Map(), nameTerminals() {} });
  view.keepSeen(100000);
  assert.equal(reloads, 0);
  pending = true;
  view.keepSeen(100001);
  await Promise.resolve();
  view.keepSeen(110000);
  assert.equal(reloads, 1);
  pending = false;
  view.keepSeen(140000);
  assert.equal(reloads, 1);
});

test("sleep reloads wait for a changed stamp, a kick, or two minutes", async () => {
  let now = 100000, stamp = 0, kick = 0, reads = 0;
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: { now: () => now }, spaces: () => [], home: () => "/home",
    shared: (key) => key === "kanso.asleep.at" ? stamp : key === "kanso.sleep.kick" ? kick : null,
  });
  const view = Object.assign(new Spaces(), {
    asleepReads: 0, asleepApplied: 0, leftNavStore: () => ({ asleep: async () => { reads += 1; return []; } }),
    loadProjects: async () => {}, settleHidden() {},
  });
  await view.loadAsleep();
  for (const elapsed of [30000, 60000, 90000]) { now = 100000 + elapsed; await view.loadAsleep(false); }
  assert.equal(reads, 1);
  now = 220000;
  await view.loadAsleep(false);
  assert.equal(reads, 2);
  stamp = now;
  await view.loadAsleep(false);
  assert.equal(reads, 3);
  kick = 1;
  await view.loadAsleep(false);
  assert.equal(reads, 4);
});
