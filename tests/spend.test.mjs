import assert from "node:assert/strict";
import test from "node:test";
import fs, { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import { arg, calls, exec, find, KIT_NIGHT, load, popoverHost, storeShared, success, temporary, texts, timedContext } from "./helpers.mjs";
import { keyDown, loadTokenSpend, spendPage } from "./mod-fixtures.mjs";
import { chooserKey, readPlan } from "../kanso/mods/kanso-spend/spend-model.js";
import { run as presentSpend } from "../kanso/mods/kanso-spend/presenter.mjs";

const presenter = fileURLToPath(new URL("../kanso/mods/kanso-spend/presenter.mjs", import.meta.url));

// A home with one Claude Code session, and a fresh price list so nothing is fetched.
async function fixture(t) {
  const root = await temporary(t);
  const home = join(root, "home"), data = join(root, "data");
  const project = join(home, ".claude", "projects", "-Users-me-Apps-secret-project");
  await mkdir(project, { recursive: true });
  await mkdir(data, { recursive: true });
  const now = new Date().toISOString();
  const lines = [
    { type: "user", sessionId: "s1", timestamp: now, cwd: "/Users/me/Apps/secret-project", uuid: "u1", message: { role: "user", content: "hi" } },
    { type: "assistant", sessionId: "s1", timestamp: now, cwd: "/Users/me/Apps/secret-project", uuid: "a1", requestId: "r1",
      message: { id: "m1", role: "assistant", model: "claude-opus-4-1", usage: { input_tokens: 1000000, output_tokens: 100000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  await writeFile(join(project, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  await writeFile(join(data, "pricing.json"), JSON.stringify({ fetchedAt: Date.now(), rates: [{ id: "anthropic/claude-opus-4.1", input: 0.000015, output: 0.000075 }] }));
  return { home, data };
}

const run = async (f, command) => {
  const r = await exec(process.execPath, [presenter, command, "--store", join(f.data, "store.json"), "--home", f.home]);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("Spend, now part of Kanso, prices your AI sessions at list price", async (t) => {
  const f = await fixture(t);
  const out = await run(f, "snapshot");
  assert.equal(out.kind, "kanso-spend-costs");
  assert.equal(out.costs.hero.value, "$22.50", "1M in at $15/M plus 100K out at $75/M");
  assert.equal(out.costs.live[0].detail.project, "secret-project");
  assert.ok((await stat(join(f.data, "spend.db"))).size > 0, "the store is kept in SQLite");
  assert.equal(await stat(join(f.data, "store.json")).catch(() => null), null, "no JSON store");

  // Prepared again from the store alone: the same numbers, nothing scanned.
  const again = await run(f, "prepare");
  assert.equal(again.costs.hero.value, "$22.50");
});

test("Spend moves a store.json from before into SQLite once", async (t) => {
  const f = await fixture(t);
  await run(f, "snapshot");
  // The store as the JSON file it used to be.
  const { loadStore } = await import("../kanso/mods/kanso-spend/core/store.mjs");
  const legacy = (await loadStore(join(f.data, "store.json"))).store;
  const old = join(f.data, "..", "old");
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "store.json"), JSON.stringify(legacy));
  await writeFile(join(old, "pricing.json"), await readFile(join(f.data, "pricing.json")));
  const g = { home: f.home, data: old };

  const read = await run(g, "prepare");
  assert.equal(read.costs.hero.value, "$22.50", "read as it is, before any scan");
  assert.equal(await stat(join(old, "spend.db")).catch(() => null), null, "a read moves nothing");

  const scanned = await run(g, "snapshot");
  assert.equal(scanned.costs.hero.value, "$22.50", "the same numbers after the move");
  assert.ok(await stat(join(old, "spend.db")));
  assert.ok(await stat(join(old, "store.json.migrated")), "the old file is kept aside");
  assert.equal(await stat(join(old, "store.json")).catch(() => null), null);

  // A rescan from SQLite: the same numbers, one row per scanned file.
  assert.equal((await run(g, "snapshot")).costs.hero.value, "$22.50");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(old, "spend.db"), { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) n FROM files").get().n, Object.keys(legacy.files).length); }
  finally { db.close(); }
});

const said = "token-spend: store is locked", unread = "Spend could not read your sessions.";
const bare = { hero: { title: "Today", value: "$0.00", stats: [], tip: "", note: "", empty: "Nothing used today.", plan: "" }, projects: [], models: [], projectCount: 0, modelCount: 0,
  tasks: [], live: [], facets: {}, footnote: [], machines: [], chart: { bars: [], first: "", title: "", last: "" }, tasksNote: "" };
const detail = { title: "Tidy", ticket: "", project: "kanso", tools: "", when: "", usdText: "$1", usdExact: "$1.00", parts: [], models: [], sessions: [], sessionCount: 0, projectPath: "/work/kanso" };
const failureOn = (drawn) => find(drawn, (el) => arg(el, "id") === "spend-failed");

test("What Refresh can do is decided once: a read in step shows the failure and Refresh, a runtime failure offers Retry and keeps Refresh on, and while it reads Refresh is off", () => {
  const plan = (state, loaded) => { const { failure, refresh } = readPlan(state, loaded); return [failure && [failure.text, failure.source, failure.fix ?? null], refresh.enabled]; };
  assert.deepEqual(plan({ nodeBinary: "node" }, false), [null, true]);
  assert.deepEqual(plan({ nodeBinary: "node", error: said, running: "snapshot" }, true), [null, false], "while it reads, nothing is said yet");
  assert.deepEqual([false, true].map((loaded) => plan({ nodeBinary: "node", error: said }, loaded)), [[[unread, said, "Refresh"], true], [["Last update failed", said, "Refresh"], true]]);
  assert.deepEqual(plan({ runtimeError: "runtime.json needs a node path." }, false), [[unread, "runtime.json needs a node path.", "Retry"], true]);
  assert.deepEqual(plan({}, false), [null, false], "Node not found yet: nothing to refresh");
});

test("The header Refresh with the collector failing shows the tool's words with Refresh on the page it was pressed from: waiting, home, Settings, a project and a task", async () => {
  const pages = { waiting: {}, home: { costs: bare }, settings: { costs: bare, page: "settings" }, "settings before its first read": { page: "settings" },
    project: { costs: bare, stack: [{ kind: "project", label: "kanso", value: "/work/kanso", prevCost: {} }] }, task: { costs: bare, stack: [{ kind: "task", label: "Tidy", task: detail }] } };
  const collector = async () => ({ code: 1, stdout: "", stderr: said });
  for (const [name, fields] of Object.entries(pages)) {
    const { cx, drain } = timedContext([]);
    const page = await spendPage({ nodeBinary: "node", awake: false, ...fields }, { exec: collector, readTextFile: async () => '{"node":"node"}' });
    const header = () => find(page.render(cx), (el) => el.tag === "spend-refresh");
    assert.equal(arg(header(), "disabled"), false, name);
    arg(header(), "on_click")({}, cx);
    assert.equal(arg(header(), "disabled"), true, `${name}: Refresh is off while it reads`);
    assert.equal(failureOn(page.render(cx)) ?? null, null, `${name}: nothing is said while it reads`);
    await drain();
    const drawn = page.render(cx);
    assert.deepEqual(texts(failureOn(drawn)).filter((words) => words !== "!"), [fields.costs ? "Last update failed" : unread, said, "Refresh"], name);
    assert.equal(find(drawn, (el) => arg(el, "id") === "kanso-skeleton") ?? null, null, `${name}: no skeleton beside a failure`);
    assert.equal(arg(find(drawn, (el) => el.tag === "spend-refresh"), "disabled"), false, `${name}: Refresh is on again`);
  }
});

test("With no Node to run, Spend says why, offers Retry, and keeps Refresh on", async () => {
  const page = await spendPage({ runtimeError: "runtime.json needs a node path.", page: "settings" });
  const drawn = page.render({});
  assert.deepEqual(texts(failureOn(drawn)).filter((words) => words !== "!"), [unread, "runtime.json needs a node path.", "Retry"]);
  assert.equal(arg(find(drawn, (el) => el.tag === "spend-failed-fix"), "disabled") ?? false, false);
  assert.equal(arg(find(drawn, (el) => el.tag === "spend-refresh"), "disabled"), false);
  assert.equal(arg(find(drawn, (el) => el.tag === "spend-settings") ?? find(drawn, (el) => el.tag === "spend-back"), "disabled") ?? false, false, "the page's own actions stay");
});

test("The project and model chooser walks its options with the list keys: j and k, gg and G, Home and End, Enter and Escape", async () => {
  const key = (name, modifiers = {}) => ({ key: name, modifiers });
  const step = (e, at, gAt = 0) => chooserKey(e, { at, gAt, count: 4 }, 1000);
  assert.deepEqual(["j", "down", "k", "up", "end", "home"].map((name) => step(key(name), 1).at), [2, 2, 0, 0, 3, 0]);
  assert.equal(step(key("g", { shift: true }), 1).at, 3);
  const waiting = step(key("g"), 2);
  assert.deepEqual([waiting.does, waiting.at, step(key("g"), 2, waiting.gAt).at], [null, 2, 0], "one g waits for the second");
  assert.deepEqual([key("enter"), key("escape")].map((e) => step(e, 2).does), ["choose", "close"]);
  assert.deepEqual([key("x"), key("j", { platform: true })].map((e) => step(e, 1).handled), [false, false], "another key and a Command chord are left alone");

  const facets = { project: [{ value: "/work/kanso", label: "kanso", meta: "$3.00" }, { value: "/work/site", label: "site", meta: "$1.00" }] };
  const page = await spendPage({ costs: { facets }, setCost(patch) { this.cost = { ...this.cost, ...patch }; } });
  const cx = { notify() {}, stop_propagation() {} };
  const chooser = () => page.menu("project", {});
  arg(chooser(), "on_open_change")(true, cx);
  const list = () => arg(chooser(), "content");
  const lit = () => texts(find(list(), (el) => arg(el, "selected") === true))[0];
  assert.equal(lit(), "All projects", "it opens on the current choice");
  keyDown(list(), key("j"), cx);
  assert.equal(lit(), "kanso");
  keyDown(list(), key("g", { shift: true }), cx);
  assert.equal(lit(), "site");
  keyDown(list(), key("k"), cx);
  keyDown(list(), key("enter"), cx);
  assert.deepEqual([page.cost.project, page.openMenu], ["/work/kanso", null], "Enter chooses the lit one and shuts the chooser");
  arg(chooser(), "on_open_change")(true, cx);
  keyDown(list(), key("escape"), cx);
  assert.equal(calls(chooser(), "content").length, 0, "Escape shuts it");
});

test("The chooser shows the lit choice when it opens, and Spend lets go of its handles when it closes", async () => {
  const facets = { model: Array.from({ length: 12 }, (_, i) => ({ value: `m${i}`, label: `model ${i}`, meta: "" })) };
  const revealed = [], released = [];
  const handle = (name) => ({ focus() {}, scroll_to_item: (at) => revealed.push(at), release: () => released.push(name) });
  const page = await spendPage({ costs: { facets }, cost: { period: "day", offset: 0, project: "all", model: "m9" }, chooserFocus: { project: handle("project"), model: handle("model") }, chooserScroll: handle("scroll") });
  arg(page.menu("model", {}), "on_open_change")(true, { notify() {} });
  assert.deepEqual(revealed, [10], "the current choice is the tenth row (after All models), brought into view at once");
  page.close();
  assert.deepEqual(released.toSorted(), ["model", "project", "scroll"]);
});

const repaired = JSON.stringify({ node: "/usr/local/bin/node" });
const mountedSpendHost = () => ({
  ...popoverHost(), theme: () => KIT_NIGHT, appHome: () => "/app", home: () => "/home/me",
  ScrollHandle: { new: () => ({ release() {} }) },
});
const runtimeHost = (reads, ran) => ({
  readTextFile: async (file) => {
    reads.push(file);
    return String(file).endsWith("runtime.json") ? repaired : null;
  },
  exec: async (command, args) => {
    ran.push([command, ...(args ?? [])]);
    return { code: 0, stdout: "{}", stderr: "" };
  },
});

test("Pressing Retry, or kanso-spend.refresh, after runtime.json was repaired reads it again and takes a snapshot", async () => {
  const reads = [], ran = [];
  const page = await spendPage({ runtimeError: "runtime.json needs a node path.", page: "settings" }, runtimeHost(reads, ran));
  const { cx, drain } = timedContext([]);
  const retry = find(page.render(cx), (el) => el.tag === "spend-failed-fix");
  arg(retry, "on_click")({}, cx);
  await drain();
  assert.ok(reads.some((file) => String(file).endsWith("runtime.json")));
  assert.equal(page.nodeBinary, "/usr/local/bin/node");
  assert.ok(ran.some((args) => args.includes("snapshot")));

  const again = [], asked = [];
  let deliver, open = true;
  const { TokenSpend } = await load("kanso-spend/main.js", ["TokenSpend"], {
    ...mountedSpendHost(),
    layout: () => ({ content: { mod: "kanso-spend" }, hidden: true }), shared: () => null, setShared() {},
    ...runtimeHost(again, asked),
    nextCommand: () => new Promise((resolve, reject) => {
      if (!open) reject(new Error("stop"));
      else deliver = (command) => { open = false; resolve(command); };
    }),
  });
  const timers = [];
  const command = timedContext(timers, { focus_handle: () => ({ focus() {}, is_focused: () => false, release() {} }) });
  const view = new TokenSpend();
  view.init({}, command.cx);
  for (const [, fn] of timers.filter(([ms]) => ms === 0)) fn(command.cx);
  view.runtimeError = "runtime.json needs a node path.";
  view.nodeBinary = null;
  assert.equal(typeof deliver, "function");
  deliver("kanso-spend.refresh");
  await command.drain();
  assert.ok(again.some((file) => String(file).endsWith("runtime.json")));
  assert.equal(view.nodeBinary, "/usr/local/bin/node");
  assert.ok(asked.some((args) => args.includes("snapshot")));
});

test("After a snapshot fails on the Node named in runtime.json, Refresh reads that file again and the next snapshot runs the Node it names now", async () => {
  const reads = [], ran = [];
  let node = "/old-node";
  const page = await spendPage({ runtimeError: "runtime.json needs a node path." }, {
    readTextFile: async (file) => {
      if (!String(file).endsWith("runtime.json")) return null;
      reads.push(file);
      return JSON.stringify({ node });
    },
    exec: async (command, args = []) => {
      ran.push([command, ...args]);
      return command === "/old-node"
        ? { code: 1, stdout: "", stderr: "No such executable" }
        : { code: 0, stdout: "{}", stderr: "" };
    },
  });
  const { cx, drain } = timedContext([]);
  const failureButton = () => find(page.render(cx), (el) => el.tag === "spend-failed-fix");
  const snapshots = () => ran.filter((args) => args.includes("snapshot")).map((args) => args[0]);
  const press = async () => { arg(failureButton(), "on_click")({}, cx); await drain(); };
  await press();
  assert.match(page.error, /No such executable/);
  assert.deepEqual(snapshots(), ["/old-node"]);
  assert.equal(reads.length, 1);
  node = process.execPath;
  assert.ok(texts(failureButton()).includes("Refresh"));
  await press();
  assert.equal(reads.length, 2);
  assert.deepEqual(snapshots(), ["/old-node", process.execPath]);
});


const spendPayload = (costs = bare) => ({ kind: "kanso-spend-costs", version: 1, costs });
const pricedScan = (usd, partial) => ({ ...spendPayload({ ...bare, local: { usd } }), scan: { partial } });
const captureExchange = (exchanges) => async function (_cx, force, everyone) {
  exchanges.push([this.costs.local.usd, force, everyone]);
};
const snapshotClock = (state, now) => ({
  ...storeShared(state),
  Date: class extends Date { static now() { return now(); } },
});

const clockedSpend = (fields, state, now) =>
  spendPage({ nodeBinary: "node", exchange() {}, ...fields }, snapshotClock(state, now));

const spendTicker = (cx) => {
  let tick;
  cx.timer.every = (_ms, fire) => {
    tick = fire;
    return { cancel() {} };
  };
  return () => tick(cx);
};

const peerHost = ({ probe, presenter = async () => success(""), files = {} }) => {
  const disk = {
    "runtime.json": repaired,
    "config.json": JSON.stringify({ peers: { odin: { enabled: true } } }),
    ...files,
  };
  const basename = (file) => String(file).split(/[/\\]/).at(-1);
  return {
    hc: async () => success("[]"),
    machines: () => [{ name: "odin", layout: "ready" }],
    readTextFile: async (file) => disk[basename(file)] ?? null,
    writeTextFile: async (file, text) => { disk[basename(file)] = text; },
    exec: async (command, args, options) => {
      if (options?.on && command === "uname") return success("Linux");
      if (options?.on && command === "node") {
        probe(options.on, JSON.parse(args[1]));
        return success(JSON.stringify({ version: "4.2.0", protocol: 2, rows: [] }));
      }
      return presenter(command, args);
    },
  };
};

const initSpend = (TokenSpend) => {
  const timers = [];
  const { cx, drain } = timedContext(timers, { focus_handle: () => ({ release() {} }) });
  const view = new TokenSpend();
  view.init({}, cx);
  const start = async () => {
    for (const [ms, fn] of timers.filter(([ms]) => ms === 0)) fn(cx);
    await drain();
  };
  return { view, cx, drain, timers, start };
};
const mountSpend = async (TokenSpend) => {
  const mounted = initSpend(TokenSpend);
  await mounted.start();
  return mounted;
};

test("Spend reopens from its ledger within twelve hours and scans and exchanges again on Refresh.", async () => {
  const commands = [], probes = [], state = {};
  const firstAt = Date.UTC(2026, 10, 10, 12);
  let now = firstAt;
  const { TokenSpend } = await loadTokenSpend({
    ...mountedSpendHost(), ...storeShared(state), Date: class extends Date { static now() { return now; } },
    ...peerHost({
      files: { "status.json": JSON.stringify({ peers: { odin: { at: firstAt, failures: 0, period: "day:0" } } }) },
      probe: (peer) => probes.push(peer),
      presenter: async (command, args) => {
        if (command !== "/usr/local/bin/node") return success("");
        commands.push(args[2]);
        return success(JSON.stringify(spendPayload()));
      },
    }),
  });
  const first = await mountSpend(TokenSpend);
  first.view.close();
  assert.deepEqual(commands.splice(0), ["snapshot"]);
  assert.deepEqual(probes, []);

  now += 12 * 60 * 60 * 1000 - 1000;
  const { view, cx, drain } = await mountSpend(TokenSpend);
  const onOpen = { commands: commands.splice(0), probes: probes.splice(0) };
  view.reload(cx);
  await drain();
  assert.deepEqual({ onOpen, onRefresh: { commands, probes } }, {
    onOpen: { commands: ["prepare"], probes: [] },
    onRefresh: { commands: ["snapshot", "prepare"], probes: ["odin"] },
  });
});

const HOUR_MS = 60 * 60_000;
const RETRY_MS = 10 * 60_000;
const retryStamp = (deadline) => deadline - 12 * HOUR_MS;

const sharedSpend = async ({ failResumption = false, sleepingBeforeRefresh = false, restartPartial = false, deferRefresh = false } = {}) => {
  const commands = [], exchanges = [];
  let now = Date.UTC(2026, 10, 10, 12), snapshots = 0;
  const state = { "kanso.spend.snapshotAt": now - HOUR_MS };
  const { TokenSpend } = await loadTokenSpend({
    ...mountedSpendHost(), ...snapshotClock(state, () => now), ...peerHost({ probe() {} }),
  });
  class Spend extends TokenSpend {
    async ask(command) {
      commands.push(command);
      if (command === "snapshot") snapshots += 1;
      if (failResumption && command === "snapshot" && snapshots === 2) throw new Error("Scan could not resume");
      if (command === "snapshot" && (snapshots === 1 || (restartPartial && snapshots === 3))) {
        const payload = pricedScan(snapshots, true);
        return { ...payload, scan: { ...payload.scan, processed: snapshots === 1 ? 8 : 2, total: 20 } };
      }
      return pricedScan(Math.max(snapshots, 1), false);
    }
  }
  Spend.prototype.exchangeOnce = captureExchange(exchanges);
  const first = await mountSpend(Spend);
  const sleeping = sleepingBeforeRefresh ? initSpend(Spend) : null;
  const refresh = async () => {
    commands.length = 0;
    exchanges.length = 0;
    first.view.reload(first.cx);
    await first.drain();
    assert.equal(first.view.scan.partial, true);
  };
  if (!deferRefresh) await refresh();
  const continueFirst = async () => {
    first.timers.find(([ms]) => ms === 1000)[1](first.cx);
    await first.drain();
  };
  return { Spend, first, sleeping, refresh, continueFirst, commands, exchanges, advance: (ms) => { now += ms; } };
};

test("Spend resumes an unfinished scan when reopened at ten minutes and shares only the completed totals.", async () => {
  const { Spend, first, commands, exchanges, advance } = await sharedSpend();
  first.view.close();
  advance(RETRY_MS + 1);

  const reopened = await mountSpend(Spend);
  reopened.view.close();
  assert.deepEqual({ commands, exchanges }, { commands: ["snapshot", "snapshot"], exchanges: [[2, true, false]] });
});

test("A sleeping Spend view does not exchange another view's partial ledger when it wakes.", async () => {
  const { sleeping, commands, exchanges } = await sharedSpend({ sleepingBeforeRefresh: true });
  await sleeping.start();
  assert.deepEqual({ commands, exchanges }, { commands: ["snapshot", "prepare"], exchanges: [] });
});

test("A sleeping Spend view forgets partial progress if another view completes before it wakes.", async () => {
  const { Spend, commands, continueFirst } = await sharedSpend();
  const sleeping = initSpend(Spend);
  await continueFirst();

  await sleeping.start();
  assert.ok(!texts(sleeping.view.hero({}, bare.hero, false)).some((line) => line.includes("8 of 20")));
  assert.ok(!sleeping.timers.some(([ms]) => ms === 1000));
  assert.deepEqual(commands, ["snapshot", "snapshot", "prepare"]);
});

test("Spend backs off a failed resumption across another reopen until the new retry deadline.", async () => {
  const scenario = await sharedSpend({ failResumption: true });
  const { Spend, commands, exchanges, advance } = scenario;
  scenario.first.view.close();
  advance(RETRY_MS + 1);
  const resumed = await mountSpend(Spend);
  assert.equal(resumed.view.error, "Scan could not resume");
  resumed.view.close();

  advance(RETRY_MS - 1);
  const reopened = await mountSpend(Spend);
  assert.deepEqual({ commands, exchanges }, { commands: ["snapshot", "snapshot", "prepare"], exchanges: [] });
  advance(1);
  reopened.view.catchUp(reopened.cx);
  await reopened.drain();
  assert.deepEqual(commands, ["snapshot", "snapshot", "prepare", "snapshot"]);
});

const finishInOtherSpendView = async (scenario) => {
  const second = await mountSpend(scenario.Spend);
  second.view.run("snapshot", second.cx);
  await second.drain();
  assert.equal(second.view.scan.partial, false);
  return second;
};

const sharedSpendCompleted = async () => {
  const scenario = await sharedSpend();
  const other = await finishInOtherSpendView(scenario);
  other.view.close();
  return scenario;
};

test("A pending Spend continuation prices the completed ledger without rescanning it.", async () => {
  const { commands, continueFirst } = await sharedSpendCompleted();

  const start = commands.length;
  await continueFirst();
  assert.deepEqual(commands.slice(start), ["prepare"]);
});

const interceptSpendPrepare = (view, prepare) => {
  const ask = view.ask.bind(view);
  view.ask = (command, ...args) =>
    command === "prepare" ? prepare(() => ask(command, ...args)) : ask(command, ...args);
};

const checkShareAfterRepricing = async (reopen) => {
  const { first, commands, exchanges, continueFirst } = await sharedSpendCompleted();
  const start = commands.length;
  exchanges.length = 0;
  const priced = Promise.withResolvers();
  interceptSpendPrepare(first.view, async (read) => {
    const payload = await read();
    await priced.promise;
    return payload;
  });

  if (reopen) first.view.wake(first.cx);
  const done = reopen ? first.drain() : continueFirst();
  try {
    assert.deepEqual(exchanges, [], "The partial total must not go out while pricing is pending");
    assert.deepEqual(commands.slice(start), ["prepare"]);
  } finally {
    priced.resolve();
    await done;
    first.view.close();
  }
  assert.deepEqual(exchanges, [[2, true, true]]);
};

test("Waking Spend after another view completes shares only repriced totals.", () => checkShareAfterRepricing(true));

test("Spend's continuation after another view completes shares only repriced totals.", () => checkShareAfterRepricing(false));

test("Reopening an already-awake Spend view cannot overwrite the other view's completed total.", async () => {
  const { first, exchanges } = await sharedSpendCompleted();
  const start = exchanges.findIndex(([usd]) => usd === 2);
  assert.notEqual(start, -1);
  first.view.wake(first.cx);
  await first.drain();
  assert.deepEqual(exchanges.slice(start).map(([usd]) => usd), [2, 2]);
});

const checkPrepareDuringPartial = async (fresh, beforeScan = false) => {
  const scenario = await sharedSpend({ deferRefresh: beforeScan });
  const { first, exchanges } = scenario;
  const pricingView = fresh ? initSpend(scenario.Spend) : first;
  const partial = Promise.withResolvers(), complete = Promise.withResolvers();
  const pricing = Promise.withResolvers(), repricing = Promise.withResolvers();
  const started = Promise.withResolvers(), allowRead = Promise.withResolvers();
  let prepares = 0;
  interceptSpendPrepare(pricingView.view, async (read) => {
    prepares += 1;
    if (prepares > 1) {
      const payload = await read();
      repricing.resolve();
      await complete.promise;
      return payload;
    }
    if (beforeScan) {
      started.resolve(true);
      await allowRead.promise;
    }
    const payload = await read();
    pricing.resolve(payload.costs.local.usd);
    await partial.promise;
    return payload;
  });
  if (!fresh) pricingView.view.run("prepare", pricingView.cx);
  const done = fresh ? pricingView.start() : pricingView.drain();
  let other;
  try {
    if (beforeScan) {
      assert.equal(await Promise.race([started.promise, done]), true);
      await scenario.refresh();
      allowRead.resolve();
    }
    assert.equal(await Promise.race([pricing.promise, done]), 1);
    other = await finishInOtherSpendView(scenario);
    exchanges.length = 0;
    partial.resolve();
    await Promise.race([repricing.promise, done]);
    assert.deepEqual(exchanges, []);
    assert.equal(prepares, 2);
  } finally {
    allowRead.resolve();
    partial.resolve();
    complete.resolve();
    await done;
    other?.view.close();
  }
  assert.deepEqual(exchanges, [[2, true, !fresh]]);
};

test("The Spend view that started a partial scan reprices if another view completes during prepare.", () =>
  checkPrepareDuringPartial(false));

test("A fresh Spend view reprices if another view completes while it is pricing partial totals.", () =>
  checkPrepareDuringPartial(true));

test("Spend discards partial pricing read by a prepare that started before another view's scan.", () =>
  checkPrepareDuringPartial(true, true));

test("A pending Spend continuation does not follow a newer partial scan from another view.", async () => {
  const scenario = await sharedSpend({ restartPartial: true });
  const other = await finishInOtherSpendView(scenario);
  scenario.advance(1);
  other.view.run("snapshot", other.cx);
  await other.drain();
  assert.equal(other.view.scan.partial, true);

  const before = scenario.commands.length;
  await scenario.continueFirst();
  assert.deepEqual(scenario.commands.slice(before), []);
});

test("Spend saves a ten-minute retry deadline instead of marking a failed scan fresh.", async () => {
  const started = Date.UTC(2026, 10, 10, 12), retryAt = started + 10 * 60 * 1000;
  const state = {}, commands = [];
  const { cx, drain } = timedContext([]);
  let now = started, failed = true;
  const page = await spendPage({
    nodeBinary: "node", costs: bare, exchange() {},
    async ask(command) {
      commands.push(command);
      if (failed) throw new Error("scan failed");
      return spendPayload();
    },
  }, snapshotClock(state, () => now));

  page.catchUp(cx);
  await drain();
  assert.equal(page.error, "scan failed");
  assert.equal(state["kanso.spend.snapshotAt"], retryStamp(retryAt));
  now = retryAt - 1;
  page.catchUp(cx);
  await drain();
  assert.deepEqual(commands, ["snapshot"]);

  failed = false;
  now = retryAt;
  page.catchUp(cx);
  await drain();
  assert.deepEqual(commands, ["snapshot", "snapshot"]);
  assert.equal(state["kanso.spend.snapshotAt"], retryAt);
  assert.equal(page.error, null);
});

const timedSnapshots = async (ask) => {
  const state = {};
  const { cx, drain } = timedContext([]);
  const started = Date.UTC(2026, 10, 10, 12);
  let now = started;
  const page = await clockedSpend({ ask: (command) => ask(command, now) }, state, () => now);
  const readAt = async (at, command) => {
    now = at;
    if (command) page.run(command, cx);
    else page.catchUp(cx);
    await drain();
    assert.equal(page.error, null);
    return state["kanso.spend.snapshotAt"];
  };
  return { started, readAt };
};

test("Spend retries a locked source in ten minutes but treats a permanently skipped row as fresh.", async (t) => {
  const f = await fixture(t);
  const source = join(f.home, ".local", "share", "opencode");
  await mkdir(source, { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(source, "opencode.db"));
  try {
    db.exec("CREATE TABLE message (session_id, id, time_created, data); INSERT INTO message VALUES ('s', 'm', 0, 'not JSON'); BEGIN EXCLUSIVE;");
    const attempts = [];
    const { started, readAt } = await timedSnapshots(async (command, now) => {
      const answer = await run(f, command);
      attempts.push([command, now, answer.scan.errors]);
      return answer;
    });
    const retryAt = started + 10 * 60_000;

    const lockedAt = await readAt(started);
    db.exec("COMMIT;");
    await readAt(retryAt - 1);
    await readAt(retryAt);
    const savedAt = await readAt(retryAt + 12 * 60 * 60_000 - 1);

    assert.deepEqual({ lockedAt, savedAt, attempts }, {
      lockedAt: retryStamp(retryAt),
      savedAt: retryAt,
      attempts: [["snapshot", started, 1], ["snapshot", retryAt, 1]],
    });
  } finally { db.close(); }
});

test("Spend retries a newly enabled source ten minutes after configuration could not read it.", async () => {
  const commands = [];
  const { started, readAt } = await timedSnapshots(async (command) => {
    commands.push(command);
    return { ...spendPayload(), scan: { retry: command === "configure" ? 1 : 0 } };
  });
  const retryAt = started + 10 * 60_000;
  await readAt(started);
  await readAt(started, "configure");
  await readAt(retryAt - 1);
  const savedAt = await readAt(retryAt);
  assert.deepEqual({ commands, savedAt }, { commands: ["snapshot", "configure", "snapshot"], savedAt: retryAt });
});

test("Spend retries an archive whose file permissions prevent it from reading.", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async (t) => {
  const f = await fixture(t);
  const folder = join(f.home, ".codex", "sessions");
  await mkdir(folder, { recursive: true });
  const archive = join(folder, "session.jsonl.zst");
  await writeFile(archive, zstdCompressSync(Buffer.from("{}\n")));
  try {
    await chmod(archive, 0o000);
    const { scan } = await run(f, "snapshot");
    assert.deepEqual([scan.partial, scan.errors, scan.retry], [false, 1, 1]);
  } finally {
    await chmod(archive, 0o600);
  }
});

test("Spend marks a capped source fresh without scanning the unchanged root again in ten minutes.", async (t) => {
  const f = await fixture(t);
  const root = join(f.home, ".local", "share", "opencode");
  await mkdir(root, { recursive: true });
  const canonical = await realpath(root);
  const entry = { name: "directory", isDirectory: () => true };
  const entries = Array(250_001).fill(entry);
  const readdir = fs.readdir;
  const directory = t.mock.method(fs, "readdir", (dir, options) =>
    dir === canonical && options?.withFileTypes ? Promise.resolve(entries) : readdir(dir, options));
  syncBuiltinESMExports();
  try {
    const scans = [];
    const { started, readAt } = await timedSnapshots(async (command, now) => {
      const out = await presentSpend([command, "--store", join(f.data, "store.json"), "--home", f.home]);
      const payload = JSON.parse(out.stdout);
      assert.equal(payload.scan.errors, 1);
      assert.ok(payload.scan.warnings > 0);
      scans.push(now);
      return payload;
    });

    await readAt(started);
    const savedAt = await readAt(started + 10 * 60_000);
    assert.deepEqual({ savedAt, scans }, { savedAt: started, scans: [started] });
  } finally {
    directory.mock.restore();
    syncBuiltinESMExports();
  }
});

test("Spend forces a peer exchange after the Refresh queued behind a read finishes.", async () => {
  const events = [];
  const { cx, drain } = timedContext([]);
  const page = await spendPage({
    nodeBinary: "node",
    async ask(command) { events.push(command); return spendPayload(); },
    exchange(_cx, force, everyone) { events.push({ force, everyone }); },
  });
  page.run("prepare", cx);
  page.reload(cx);
  await drain();
  assert.deepEqual(events, ["prepare", "snapshot", { force: true, everyone: true }]);
});

test("Spend sends only refreshed totals to a peer after the scan and its queued prepare finish.", async () => {
  const me = "11111111-2222-4333-8444-555555555555", sent = [], reads = [];
  const costs = (usd) => ({ ...bare, syncSelf: me, local: { usd, tokens: 100 } });
  const scan = Promise.withResolvers(), prepare = Promise.withResolvers();
  const { cx, drain, pending } = timedContext([]);
  const page = await spendPage({
    costs: costs(2), db: { machinesOff: async () => [] },
    async ask(command) {
      reads.push(command);
      if (command === "snapshot") return scan.promise;
      if (reads.length === 2) return prepare.promise;
      return spendPayload(costs(12));
    },
  }, peerHost({
    probe: (_peer, { push }) => sent.push(push.find((row) => row.machine === me)?.body.usd),
  }));
  page.reload(cx);
  try {
    await pending[0];
    assert.deepEqual(reads, ["snapshot"], page.runtimeError);
    page.run("prepare", cx);
    await Promise.all(pending.slice(2));
    scan.resolve(spendPayload(costs(8)));
    await pending[1];
    assert.deepEqual(reads, ["snapshot", "prepare"]);
  } finally {
    scan.resolve(spendPayload(costs(8)));
    prepare.resolve(spendPayload(costs(12)));
    await drain();
  }
  assert.deepEqual(sent, [12]);
});

const checkTwoChunkRefresh = async (betweenChunks) => {
  const timers = [], exchanges = [];
  const { cx, drain } = timedContext(timers);
  const tick = spendTicker(cx);
  let usd = 0;
  const page = await spendPage({
    async ask() {
      usd += 1;
      return pricedScan(usd, usd === 1);
    },
    exchangeOnce: captureExchange(exchanges),
  }, peerHost({ probe() {} }));

  page.reload(cx);
  await drain();
  betweenChunks({ page, cx, tick });
  const [, continueScan] = timers.find(([ms]) => ms === 1000);
  continueScan(cx);
  await drain();
  assert.deepEqual(exchanges, [[2, true, true]]);
};

test("Spend exchanges only final Refresh totals even when a peer exchange is due between scan chunks.", () =>
  checkTwoChunkRefresh(({ tick }) => tick()));

test("Opening Spend between scan chunks still exchanges the final Refresh totals with everyone.", () =>
  checkTwoChunkRefresh(({ page, cx }) => page.wake(cx)));

const queuePrepareDuringSnapshot = (page, { cx, drain }) => {
  page.run("snapshot", cx);
  page.run("prepare", cx);
  return drain();
};

test("Spend continues a partial Refresh through a queued prepare and exchanges only the final totals.", async () => {
  const timers = [], exchanges = [], commands = [];
  const { cx, drain } = timedContext(timers);
  const page = await spendPage({
    nodeBinary: "node", forceNext: true,
    async ask(command) {
      commands.push(command);
      if (command === "prepare") return pricedScan(1, false);
      return commands.length === 1 ? pricedScan(1, true) : pricedScan(2, false);
    },
    exchangeOnce: captureExchange(exchanges),
  });
  await queuePrepareDuringSnapshot(page, { cx, drain });
  timers.find(([ms]) => ms === 1000)?.[1](cx);
  await drain();
  assert.deepEqual({ commands, exchanges }, {
    commands: ["snapshot", "prepare", "snapshot"], exchanges: [[2, true, true]],
  });
});

test("Spend keeps the scan's 8 of 20 file progress after pricing the partial ledger.", async () => {
  const partial = pricedScan(1, true);
  const page = await spendPage({
    nodeBinary: "node",
    async ask(command) {
      return command === "snapshot"
        ? { ...partial, scan: { ...partial.scan, processed: 8, total: 20 } }
        : { ...pricedScan(1, false), scan: { partial: false, processed: 0, total: 0 } };
    },
  });
  await queuePrepareDuringSnapshot(page, timedContext([]));
  assert.deepEqual([page.scan.processed, page.scan.total], [8, 20]);
});

test("Spend retries a partial snapshot in ten minutes if the queued prepare fails.", async () => {
  const { cx, drain } = timedContext([]);
  const commands = [], first = Date.UTC(2026, 10, 10, 12), retryAt = first + 10 * 60_000;
  let now = first;
  const page = await clockedSpend({
    async ask(command) {
      commands.push([command, now]);
      if (command === "prepare") throw new Error("Pricing unavailable");
      return pricedScan(1, now === first);
    },
  }, {}, () => now);
  await queuePrepareDuringSnapshot(page, { cx, drain });
  assert.equal(page.error, "Pricing unavailable");
  for (now of [retryAt - 1, retryAt]) {
    page.catchUp(cx);
    await drain();
  }
  assert.deepEqual(commands, [["snapshot", first], ["prepare", first], ["snapshot", retryAt]]);
});

test("Spend retries a timed-out scan ten minutes after its watchdog fires.", async () => {
  const state = {}, timers = [], attempts = [];
  const { cx, drain } = timedContext(timers);
  const hung = Promise.withResolvers();
  let now = Date.UTC(2026, 10, 10, 12);
  const page = await spendPage({
    costs: bare, nodeBinary: "node",
    exchange() {},
    ask(command) {
      attempts.push([command, now]);
      return attempts.length === 1 ? hung.promise : Promise.resolve(spendPayload());
    },
  }, snapshotClock(state, () => now));
  const first = now;
  page.catchUp(cx);
  const [[watchdog, expire]] = timers;
  now += watchdog;
  expire(cx);
  hung.resolve(spendPayload());
  await drain();
  assert.match(page.error, /took too long/);
  const retry = now + RETRY_MS;
  assert.equal(state["kanso.spend.snapshotAt"], retryStamp(retry));

  for (now of [retry - 1, retry]) {
    page.catchUp(cx);
    await drain();
  }
  assert.deepEqual(attempts, [["snapshot", first], ["snapshot", retry]]);
  assert.equal(state["kanso.spend.snapshotAt"], retry);
});

test("Spend skips a due peer exchange while a Refresh scan is still running.", async () => {
  const scan = Promise.withResolvers(), exchanges = [];
  const { cx, drain, pending } = timedContext([]);
  const tick = spendTicker(cx);
  const page = await spendPage({
    costs: bare, ask: () => scan.promise,
    exchange(_cx, force, everyone) { exchanges.push([this.running, force, everyone]); },
  }, peerHost({ probe() {} }));

  page.reload(cx);
  try {
    await pending[0];
    assert.equal(page.running, "snapshot");
    tick();
  } finally {
    scan.resolve(spendPayload());
    await drain();
  }
  assert.deepEqual(exchanges, [[null, true, true]]);
});
