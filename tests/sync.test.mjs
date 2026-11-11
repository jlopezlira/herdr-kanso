// Each computer keeps its own spend ledger. Sync only adds the others.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { temporary } from "./helpers.mjs";

const runFile = promisify(execFile);
const { exchange } = await import("../kanso/mods/kanso-spend/sync-probe.mjs");
const { foldCosts } = await import("../kanso/mods/kanso-spend/sync-spend.js");
const { clock } = await import("../kanso/mods/kanso-spaces/pure.js");
const sync = await import("../kanso/mods/kanso-settings/sync.js");
const shipped = JSON.parse(await readFile(new URL("../kanso/mods/kanso-chrome/version.json", import.meta.url), "utf8")).version;
const reply = (rows) => ({ machine: PEER, version: sync.MIN_VERSION, protocol: sync.PROTOCOL, rows });

const SELF = "11111111-2222-4333-8444-555555555555";
const PEER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-11-10T15:00:00.000Z");
const spend = (machine, usd, at, extra = {}) => ({
  machine, kind: "spend", updated_at: at,
  body: { usd, tokens: usd, value: `$${usd}.00`, tokensText: String(usd), period: "month", offset: 0, ...extra },
});
const priced = (usd) => ({ costs: { hero: { usd, tokens: usd, value: `$${usd}.00`, stats: [{ unit: "tokens", value: String(usd) }] } } });
const on = (id = "odin") => ({ version: 1, peers: { [id]: { enabled: true, kinds: { spend: true } } } });
const ready = (name = "odin") => [{ name, layout: "ready" }];

test("A computer keeps the same id", async (t) => {
  let minted = 0;
  const first = sync.identityFrom("", () => { minted += 1; return SELF; }, "2026-11-10T00:00:00.000Z");
  const again = sync.identityFrom(sync.identityText(first), () => { minted += 1; return PEER; }, "2026-11-10T01:00:00.000Z");
  assert.equal(first.fresh, true);
  assert.equal(again.fresh, false);
  assert.equal(again.id, SELF);
  assert.equal(minted, 1);

  const app = await temporary(t);
  await mkdir(path.join(app, "mods", "kanso-spend"), { recursive: true });
  await writeFile(path.join(app, "mods", "kanso-spend", "presenter.mjs"), "");
  const deps = {
    appHome: app,
    now: "2026-11-10T12:00:00.000Z",
    mint: () => { minted += 1; return SELF; },
    run: async () => ({ exitCode: 0, stdout: JSON.stringify(priced(2)) }),
  };
  const opened = await exchange({ options: { cost: { period: "month", offset: 0 } } }, deps);
  const kept = await exchange({ options: { cost: { period: "month", offset: 0 } } }, deps);
  assert.equal(minted, 2);
  assert.equal(opened.machine, SELF);
  assert.equal(kept.machine, SELF);
  assert.equal(JSON.parse(await readFile(path.join(app, "data", "kanso-sync", "identity.json"), "utf8")).id, SELF);
});

test("A computer does not take another computer's ledger, or give its own away", async (t) => {
  const local = [spend(SELF, 1, "2026-11-10T00:00:00.000Z")];
  const forged = [
    spend(SELF, 99, "2026-11-11T00:00:00.000Z"),
    spend(PEER, 4, "2026-11-10T01:00:00.000Z"),
  ];
  const calls = [];
  const out = await sync.exchangeAll({
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: JSON.stringify(reply(forged)) };
    },
  }, {
    config: on(), peers: ready(), status: {}, rows: local, self: SELF, own: local[0],
    now: NOW, periodKey: "month:0", options: { cost: { period: "month", offset: 0 } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "node");
  assert.deepEqual(calls[0].args[0], sync.PROBE_REL);
  assert.equal(JSON.parse(calls[0].args[1]).push[0].machine, SELF);
  assert.equal(calls[0].options.on, "odin");
  assert.equal(calls[0].options.timeout, 25_000);
  assert.equal(out.rows.find((row) => row.machine === SELF).body.usd, 1);
  assert.equal(out.rows.find((row) => row.machine === PEER).body.usd, 4);
  assert.equal(out.rows.find((row) => row.machine === PEER).body.name, "odin");

  const app = await temporary(t);
  await mkdir(path.join(app, "mods", "kanso-spend"), { recursive: true });
  await writeFile(path.join(app, "mods", "kanso-spend", "presenter.mjs"), "");
  const dir = path.join(app, "data", "kanso-sync");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "identity.json"), sync.identityText({ id: PEER, created_at: "t" }));
  await writeFile(path.join(dir, "rows.json"), sync.rowsText([spend(PEER, 3, "2026-11-10T00:00:00.000Z")]));
  const answered = await exchange({
    push: [spend(PEER, 99, "2026-11-11T00:00:00.000Z"), spend(SELF, 1, "2026-11-10T02:00:00.000Z")],
    options: { cost: { period: "month", offset: 0 } },
  }, {
    appHome: app,
    now: "2026-11-10T12:00:00.000Z",
    run: async () => ({ exitCode: 0, stdout: JSON.stringify(priced(3)) }),
  });
  assert.equal(answered.rows.find((row) => row.machine === PEER).body.usd, 3);
  assert.equal(answered.rows.find((row) => row.machine === SELF).body.usd, 1);
});

test("Spend adds each computer and leaves one computer as it was", () => {
  const costs = {
    hero: {
      usd: 10, tokens: 100, value: "$10.00", tip: "x", note: "14% more than October",
      stats: [{ unit: "tokens", value: "100", tip: "in 80" }, { unit: "tasks", value: "2" }],
    },
  };
  const rows = [spend("peer", 5, "2026-11-10T01:00:00.000Z", { name: "Studio", tokens: 50, tokensText: "50" })];
  const options = { cost: { period: "month", offset: 0, project: "all", model: "all" } };
  const folded = foldCosts(costs, { self: SELF, rows, options });
  assert.equal(folded.hero.usd, 15);
  assert.equal(folded.hero.tokens, 150);
  assert.equal(folded.hero.value, "$15.00");
  assert.equal(folded.hero.note, "");
  assert.deepEqual(folded.machines.map((row) => row.name), ["This computer", "Studio"]);
  assert.equal(folded.hero.stats.find((stat) => stat.unit === "tokens").value, "150");
  assert.equal(foldCosts(costs, { self: SELF, rows: [], options }), costs);
  assert.equal(foldCosts(costs, { self: SELF, rows, options: { cost: { project: "app", model: "all" } } }), costs);
  assert.equal(foldCosts(costs, { self: SELF, rows, options: { cost: { period: "year", offset: 0, project: "all", model: "all" } } }), costs);
});

test("Sync off, or a computer that is not connected, asks nothing", async () => {
  let calls = 0;
  const runner = { exec: async () => { calls += 1; return { code: 0, stdout: "" }; } };
  const base = { peers: ready(), status: {}, rows: [], self: SELF, now: NOW, periodKey: "month:0" };
  const off = await sync.exchangeAll(runner, { ...base, config: { version: 1, peers: {} } });
  const disabled = await sync.exchangeAll(runner, { ...base, config: { version: 1, peers: { odin: { enabled: false, kinds: { spend: true } } } } });
  const asleep = await sync.exchangeAll(runner, { ...base, config: on(), peers: [{ name: "odin", layout: "unavailable" }] });
  const recent = await sync.exchangeAll(runner, {
    ...base, config: on(), status: { odin: { at: NOW, failures: 0, reason: null, period: "month:0" } },
  });
  assert.equal(calls, 0);
  assert.equal(off.ran, false);
  assert.equal(disabled.ran, false);
  assert.equal(asleep.ran, false);
  assert.equal(recent.ran, false);
  assert.equal(sync.planExchange({ config: on(), peers: [{ name: "odin", layout: "loading" }], status: {}, now: NOW, periodKey: "month:0" }).length, 0);
});

test("A computer out of reach keeps the last figures, then waits longer", async () => {
  const rows = [spend(PEER, 7, "2026-11-10T01:00:00.000Z", { name: "odin" })];
  const status = { odin: { at: NOW - 10_000, failures: 0, reason: null, synced_at: "2026-11-10T14:00:00.000Z", machine: PEER, period: "month:0", marker: "keep" } };
  const kept = sync.applyExchange(rows, status, { id: "odin", name: "odin" }, null, NOW, "month:0");
  assert.equal(kept.rows, rows);
  assert.equal(kept.status.odin.synced_at, status.odin.synced_at);
  assert.equal(kept.status.odin.marker, "keep");
  assert.equal(kept.status.odin.reason, "unreachable");
  assert.equal(kept.status.odin.failures, 1);
  assert.equal(sync.due(kept.status.odin, NOW + sync.delayMs(1) - 1, "month:0"), false);
  assert.equal(sync.due(kept.status.odin, NOW + sync.delayMs(1), "month:0"), true);
  assert.equal(sync.delayMs(8), sync.BACKOFF_MAX_MS);

  let calls = 0;
  const dueStatus = { odin: { ...status.odin, at: NOW - sync.EXCHANGE_MS - 1 } };
  const out = await sync.exchangeAll({
    exec: async () => { calls += 1; throw new Error("down"); },
  }, { config: on(), peers: ready(), status: dueStatus, rows, self: SELF, now: NOW, periodKey: "month:0" });
  assert.equal(calls, 1);
  assert.equal(out.rows, rows);
  assert.equal(out.status.odin.synced_at, status.odin.synced_at);
  assert.equal(sync.due({ at: NOW, failures: 0, reason: null, period: "month:0" }, NOW + sync.RETRY_FLOOR_MS, "month:1"), true);
  assert.equal(sync.due(undefined, NOW, "month:0"), true);
});

test("A computer on an older kansō says to update it, and nothing is written there", async (t) => {
  assert.equal(sync.MIN_VERSION, shipped);
  const empty = await temporary(t);
  const missing = await exchange({}, { appHome: empty });
  assert.deepEqual(missing, { reason: "update", version: "", protocol: sync.PROTOCOL });
  assert.deepEqual(await readdir(empty), []);

  const rows = [spend(SELF, 1, "2026-11-10T00:00:00.000Z")];
  const stale = await sync.exchangeAll({
    exec: async () => ({ code: 0, stdout: `noise\n${JSON.stringify({ machine: PEER, version: "3.21.1", protocol: 1, rows: [spend(PEER, 9, "2026-11-11T00:00:00.000Z")] })}` }),
  }, { config: on(), peers: ready(), status: {}, rows, self: SELF, now: NOW, periodKey: "month:0" });
  assert.equal(stale.rows, rows);
  assert.equal(stale.status.odin.reason, "update");
  assert.equal(sync.holdsOf(stale.status)[0].text, sync.UPDATE_TEXT);

  const absent = await sync.exchangeAll({
    exec: async () => ({ code: 1, stderr: "Error: Cannot find module" }),
  }, { config: on(), peers: ready(), status: {}, rows, self: SELF, now: NOW, periodKey: "month:0" });
  assert.equal(absent.status.odin.reason, "update");
  assert.equal(sync.due(absent.status.odin, NOW + sync.delayMs(1) - 1, "month:0"), false);

  const home = await temporary(t);
  const app = path.join(home, ".config", "herdr-app");
  const custom = await temporary(t);
  const probeDir = path.join(app, "mods", "kanso-spend");
  await mkdir(path.join(custom, "mods", "kanso-chrome"), { recursive: true });
  await mkdir(probeDir, { recursive: true });
  const fromMod = (name) => new URL(`../kanso/mods/kanso-spend/${name}`, import.meta.url);
  await copyFile(fromMod("sync-probe.mjs"), path.join(probeDir, "sync-probe.mjs"));
  await copyFile(fromMod("sync.js"), path.join(probeDir, "sync.js"));
  await copyFile(fromMod("pure.js"), path.join(probeDir, "pure.js"));
  await copyFile(fromMod("machines.js"), path.join(probeDir, "machines.js"));
  await writeFile(path.join(custom, "mods", "kanso-chrome", "version.json"), `${JSON.stringify({ version: "3.21.0" })}\n`);
  const { stdout } = await runFile(process.execPath, [sync.PROBE_REL, "{}"], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, HERDR_APP_HOME: custom },
  });
  assert.deepEqual(JSON.parse(stdout), { reason: "update", version: "3.21.0", protocol: sync.PROTOCOL });
  assert.deepEqual(await readdir(custom), ["mods"]);

  const day = new Date(2026, 10, 10, 9, 5, 0);
  const later = new Date(2026, 10, 10, 15, 4, 0);
  assert.equal(clock(day.toISOString(), later.getTime()), "09:05");
  assert.equal(clock(new Date(2026, 10, 9, 9, 5, 0).toISOString(), later.getTime()), "Nov 9 09:05");
  const roster = sync.syncRoster(
    [{ name: null, layout: "ready" }, { name: "odin", layout: "ready" }],
    on(),
    { odin: stale.status.odin },
    later.getTime(),
  );
  assert.equal(roster.state, "peers");
  assert.equal(roster.peers[0].state.text, "Update kanso there");
  assert.equal(sync.syncRoster([{ name: null, layout: "ready" }], {}, {}, later.getTime()).state, "empty");
  assert.equal(sync.syncRoster([], {}, {}, later.getTime()).state, "loading");
  const enabled = sync.withPeer({ version: 1, peers: {} }, "odin", true);
  assert.equal(enabled.peers.odin.kinds.spend, true);
  assert.equal(sync.syncOn(sync.withKind(enabled, "odin", "spend", false)), false);
});

test("A computer turned off from the sidebar is not asked and shows as off", async () => {
  const stored = [{ name: "odin", target: "odin.example", via: "", session: "", temporary: false }];
  const live = [];
  const connected = [{ name: "odin", state: "connected" }];
  let calls = 0;
  const runner = { exec: async () => { calls += 1; return { code: 0, stdout: JSON.stringify(reply([])) }; } };
  const base = { config: on(), peers: ready(), status: {}, rows: [], self: SELF, now: NOW, periodKey: "month:0", stored };
  const parked = await sync.exchangeAll(runner, { ...base, live });
  assert.equal(calls, 0);
  assert.equal(parked.ran, false);
  const resumed = await sync.exchangeAll(runner, { ...base, live: connected });
  assert.equal(calls, 1);
  assert.equal(resumed.ran, true);
  const both = {
    version: 1,
    peers: {
      odin: { enabled: true, kinds: { spend: true } },
      loki: { enabled: true, kinds: { spend: true } },
    },
  };
  const steps = sync.planExchange({
    config: both, peers: [{ name: "odin", layout: "ready" }, { name: "loki", layout: "ready" }],
    status: {}, now: NOW, periodKey: "month:0", stored, live,
  });
  assert.deepEqual(steps.map((step) => step.id), ["loki"]);
  const roster = sync.syncRoster(ready(), on(), { odin: { reason: "update" } }, NOW, { stored, live });
  assert.equal(roster.peers.length, 1);
  assert.equal(roster.peers[0].state.kind, "off");
  assert.equal(roster.peers[0].state.text, "Off");
  assert.equal(sync.holdsOf({ odin: { reason: "update" } }, stored, live).length, 0);
  assert.equal(sync.holdsOf({ odin: { reason: "update" } }, stored, connected)[0].text, sync.UPDATE_TEXT);
  const missing = sync.syncRoster([{ name: null, layout: "ready" }], on(), { odin: { reason: "update" } }, NOW, { stored, live });
  assert.equal(missing.state, "peers");
  assert.equal(missing.peers[0].id, "odin");
  assert.equal(missing.peers[0].state.text, "Off");
  const quiet = sync.syncRoster([], {}, {}, NOW, { stored: [{ name: "tmp", temporary: true }], live });
  assert.equal(quiet.state, "loading");
  const awake = sync.syncRoster(ready(), on(), {}, NOW, { stored, live: connected });
  assert.equal(awake.peers[0].state.kind, "idle");
});

test("Paths are built with the other computer's path API", async () => {
  const join = path.win32.join;
  const home = sync.appHomeFrom({}, "C:\\Users\\me", join);
  const paths = sync.syncPaths(home, join);
  assert.equal(home, "C:\\Users\\me\\.config\\herdr-app");
  assert.equal(paths.store, "C:\\Users\\me\\.config\\herdr-app\\data\\kanso-spend\\store.json");
  assert.equal(paths.probe, "C:\\Users\\me\\.config\\herdr-app\\mods\\kanso-spend\\sync-probe.mjs");
  assert.equal(paths.version, "C:\\Users\\me\\.config\\herdr-app\\mods\\kanso-chrome\\version.json");
  assert.equal(sync.appHomeFrom({ HERDR_APP_HOME: "D:\\herdr" }, "C:\\Users\\me", join), "D:\\herdr");
  assert.equal(sync.syncDir("C:\\Users\\me\\.config\\herdr-app"), "C:\\Users\\me\\.config\\herdr-app\\data\\kanso-sync");
  assert.equal(sync.joinUnder(sync.syncDir("/Users/me/.config/herdr-app"), "config.json"), "/Users/me/.config/herdr-app/data/kanso-sync/config.json");
  assert.equal(sync.PROBE_REL, ".config/herdr-app/mods/kanso-spend/sync-probe.mjs");

  const seen = [];
  const root = "C:\\Users\\me\\.config\\herdr-app";
  const out = await exchange({ options: { cost: { period: "month", offset: 0 } } }, {
    join,
    appHome: root,
    homedir: () => "C:\\Users\\me",
    env: {},
    now: "2026-11-10T12:00:00.000Z",
    mint: () => SELF,
    exists: (file) => file === join(root, "mods", "kanso-spend", "presenter.mjs"),
    fs: {
      readFile: async (file) => (file === paths.version ? `${JSON.stringify({ version: shipped })}\n` : ""),
      writeFile: async (file) => { seen.push(file); },
      mkdir: async (dir) => { seen.push(dir); },
    },
    run: async (argv) => { seen.push(argv); return { exitCode: 0, stdout: JSON.stringify(priced(2)) }; },
  });
  assert.equal(out.version, shipped);
  assert.equal(out.protocol, sync.PROTOCOL);
  assert.equal(out.rows[0].machine, SELF);
  assert.equal(seen[0], "C:\\Users\\me\\.config\\herdr-app\\data\\kanso-sync");
  assert.equal(seen.find((item) => Array.isArray(item))[2], paths.store);
});
