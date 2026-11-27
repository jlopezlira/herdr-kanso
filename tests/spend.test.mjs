import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, calls, exec, find, KIT_NIGHT, load, popoverHost, storeShared, success, temporary, texts, timedContext } from "./helpers.mjs";
import { keyDown, loadTokenSpend, spendPage } from "./mod-fixtures.mjs";
import { chooserKey, readPlan } from "../kanso/mods/kanso-spend/spend-model.js";

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


test("Spend reopens from its ledger within twelve hours and scans and exchanges again on Refresh.", async () => {
  const commands = [], probes = [], state = {};
  const firstAt = Date.UTC(2026, 10, 10, 12);
  let now = firstAt;
  const files = {
    "runtime.json": repaired,
    "config.json": JSON.stringify({ version: 1, peers: { odin: { enabled: true } } }),
    "status.json": JSON.stringify({ peers: { odin: { at: firstAt, failures: 0, period: "day:0" } } }),
  };
  const { TokenSpend } = await loadTokenSpend({
    ...mountedSpendHost(), ...storeShared(state), Date: class extends Date { static now() { return now; } },
    machines: () => [{ name: "odin", layout: "ready" }],
    readTextFile: async (file) => files[String(file).split(/[/\\]/).at(-1)] ?? null,
    writeTextFile: async (file, text) => { files[String(file).split(/[/\\]/).at(-1)] = text; },
    exec: async (command, args, options) => {
      if (options?.on && command === "uname") return success("Linux");
      if (options?.on && command === "node") {
        probes.push(options.on);
        return success(JSON.stringify({ version: "4.2.0", protocol: 2, rows: [] }));
      }
      if (command !== "/usr/local/bin/node") return success("");
      commands.push(args[2]);
      return success(JSON.stringify({ kind: "kanso-spend-costs", version: 1, costs: bare }));
    },
  });
  const mount = async () => {
    const timers = [];
    const { cx, drain } = timedContext(timers, { focus_handle: () => ({ release() {} }) });
    const view = new TokenSpend();
    view.init({}, cx);
    for (const [ms, fn] of timers.filter(([ms]) => ms === 0)) fn(cx);
    await drain();
    return { view, cx, drain };
  };

  const first = await mount();
  first.view.close();
  assert.deepEqual(commands.splice(0), ["snapshot"]);
  assert.deepEqual(probes, []);

  now += 12 * 60 * 60 * 1000 - 1000;
  const { view, cx, drain } = await mount();
  const onOpen = { commands: commands.splice(0), probes: probes.splice(0) };
  view.reload(cx);
  await drain();
  assert.deepEqual({ onOpen, onRefresh: { commands, probes } }, {
    onOpen: { commands: ["prepare"], probes: [] },
    onRefresh: { commands: ["snapshot", "prepare"], probes: ["odin"] },
  });
});
