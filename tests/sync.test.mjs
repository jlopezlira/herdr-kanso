// Each computer keeps its own spend ledger. Sync only adds the others.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { temporary } from "./helpers.mjs";

const runFile = promisify(execFile);
const { exchange } = await import("../kanso/mods/kanso-spend/sync-probe.mjs");
const { foldCosts } = await import("../kanso/mods/kanso-spend/sync-spend.js");
const sync = await import("../kanso/mods/kanso-settings/sync.js");

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
      return { code: 0, stdout: JSON.stringify({ machine: PEER, rows: forged }) };
    },
  }, {
    config: on(), peers: ready(), status: {}, rows: local, self: SELF, own: local[0],
    now: NOW, periodKey: "month:0", options: { cost: { period: "month", offset: 0 } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "node");
  assert.ok(Array.isArray(calls[0].args));
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
  const status = { odin: { at: NOW - 10_000, failures: 0, reason: null, synced_at: "2026-11-10T14:00:00.000Z", machine: PEER, period: "month:0" } };
  const kept = sync.applyExchange(rows, status, { id: "odin", name: "odin" }, null, NOW, "month:0");
  assert.equal(kept.rows, rows);
  assert.equal(kept.status.odin.synced_at, status.odin.synced_at);
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

test("A computer without kansō is said so, and nothing is written there", async (t) => {
  const empty = await temporary(t);
  const missing = await exchange({}, { appHome: empty });
  assert.deepEqual(missing, { reason: "no-kanso" });
  assert.deepEqual(await readdir(empty), []);

  const rows = [spend(PEER, 7, "2026-11-10T01:00:00.000Z")];
  const out = await sync.exchangeAll({
    exec: async () => ({ code: 0, stdout: "noise\n" + JSON.stringify({ reason: "no-kanso" }) }),
  }, { config: on(), peers: ready(), status: {}, rows, self: SELF, now: NOW, periodKey: "month:0" });
  assert.equal(out.rows, rows);
  assert.equal(out.status.odin.reason, "no-kanso");
  assert.equal(out.status.odin.failures, 1);

  const home = await temporary(t);
  const { stdout } = await runFile(process.execPath, ["--input-type=module", "-e", sync.LOADER_SOURCE, "--", "{}"], {
    env: { ...process.env, HERDR_APP_HOME: home, HOME: home, USERPROFILE: home },
  });
  assert.deepEqual(JSON.parse(stdout), { reason: "no-kanso" });
  assert.deepEqual(await readdir(home), []);

  const day = new Date(2026, 10, 10, 9, 5, 0);
  const later = new Date(2026, 10, 10, 15, 4, 0);
  assert.equal(sync.clock(day.toISOString(), later.getTime()), "09:05");
  assert.equal(sync.clock(new Date(2026, 10, 9, 9, 5, 0).toISOString(), later.getTime()), "Nov 9");
  const roster = sync.syncRoster(
    [{ name: null, layout: "ready" }, { name: "odin", layout: "ready" }],
    on(),
    { odin: out.status.odin },
    later.getTime(),
  );
  assert.equal(roster.state, "peers");
  assert.equal(roster.peers[0].state.text, "No kansō there");
  assert.equal(sync.syncRoster([{ name: null, layout: "ready" }], {}, {}, later.getTime()).state, "empty");
  assert.equal(sync.syncRoster([], {}, {}, later.getTime()).state, "loading");
  const enabled = sync.withPeer({ version: 1, peers: {} }, "odin", true);
  assert.equal(enabled.peers.odin.kinds.spend, true);
  assert.equal(sync.syncOn(sync.withKind(enabled, "odin", "spend", false)), false);
});

test("Paths are built with the other computer's path API", () => {
  const join = path.win32.join;
  const home = sync.appHomeFrom({}, "C:\\Users\\me", join);
  const paths = sync.syncPaths(home, join);
  assert.equal(home, "C:\\Users\\me\\.config\\herdr-app");
  assert.equal(paths.store, "C:\\Users\\me\\.config\\herdr-app\\data\\kanso-spend\\store.json");
  assert.equal(paths.probe, "C:\\Users\\me\\.config\\herdr-app\\mods\\kanso-spend\\sync-probe.mjs");
  assert.equal(sync.appHomeFrom({ HERDR_APP_HOME: "D:\\herdr" }, "C:\\Users\\me", join), "D:\\herdr");
  const argv = sync.loaderArgv({ push: [] });
  assert.ok(argv.every((part) => typeof part === "string"));
  assert.deepEqual(argv.slice(0, 2), ["--input-type=module", "-e"]);
  assert.equal(argv[3], "--");
  assert.doesNotMatch(argv[2], /kanso-spend\/presenter\.mjs/);
  assert.match(argv[2], /path\.join/);
});
