// Unchanged sidebar state does not start database maintenance.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

test("seen state writes only on changes and coalesces changes for ten seconds", async () => {
  const writes = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { terminals: () => [], shared: () => null });
  const row = { conversation: "c1", terminal: "t1", title: "First" };
  const panel = { agents: new Map(), remember: (seen, at) => writes.push([at, seen.size]) };
  const view = Object.assign(new Spaces(), { panel, panelReady: true, seenNow: new Map([["t1", row]]), nameTerminals() {} });
  view.keepSeen(0);
  view.seenNow = new Map([["t1", { ...row, title: "Changed" }]]);
  for (const now of [2000, 9999, 10000, 20000, 60000]) view.keepSeen(now);
  assert.deepEqual(writes, [[0, 1], [10000, 1]]);
  view.seenNow = new Map();
  view.keepSeen(62000);
  assert.deepEqual(writes.at(-1), [62000, 0]);
});

test("names and projects are read again only when asked, while a save waits, or after two minutes", async () => {
  let now = 100000, reads = 0, pending = null;
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: { now: () => now }, spaces: () => [], machines: () => [], home: () => "/home", shared: () => null,
  });
  const view = Object.assign(new Spaces(), {
    db: () => ({ aliases: async () => { reads += 1; return []; } }), loadProjects: async () => {},
  });
  view.names = { pending: () => pending, absorb() {}, owed: () => null, took() {} };
  await view.loadNames();
  for (const elapsed of [30000, 60000, 90000]) { now = 100000 + elapsed; await view.loadNames(false); }
  assert.equal(reads, 1);
  now = 220000;
  await view.loadNames(false);
  assert.equal(reads, 2);
  pending = [{ route: "", name: "Cave", at: 1, pending: 0 }];
  await view.loadNames(false);
  assert.equal(reads, 3);
});

test("project folders are checked only after registry changes or five minutes", async () => {
  let now = 0, checks = 0;
  const rows = [{ id: "p1", folder: "/project", name: "Project", machine: "" }];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    Date: { now: () => now }, shared: () => null, spaces: () => [], home: () => "/home",
    fileApi: () => ({ existing: async () => { checks += 1; return []; } }),
  });
  const view = new Spaces(), db = { projects: async () => rows };
  assert.equal((await view.publishRegistry(db))[0].missing, true);
  for (now of [30000, 120000, 299999]) await view.publishRegistry(db);
  assert.equal(checks, 1);
  now = 300000;
  await view.publishRegistry(db);
  assert.equal(checks, 2);
  rows[0].name = "Renamed";
  now += 1;
  await view.publishRegistry(db);
  assert.equal(checks, 3);
});

