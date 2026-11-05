import assert from "node:assert/strict";
import test from "node:test";
import { clone, load } from "./helpers.mjs";

const model = () => load("kanso-guard/model.js", ["STALE_MS", "size", "span", "clock", "parseNow", "agentsMB", "agentMeta", "limitsNote", "freeSeries", "agentSparks", "sparkFor", "digestHistory"]);

const NOW = new Date(2026, 10, 5, 15, 0, 0).getTime();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const sample = (at = NOW - 30_000) => ({
  v: 1, at,
  machine: { totalMB: 65536, freePct: 31.6, swapMB: 1300, swapTotalMB: 4096 },
  window: { pid: 10, mb: 980, oom: false, limitMB: 1200 },
  core: { mb: 240 },
  agents: [
    { pid: 21, kind: "claude", name: "api", terminal: "t1", mb: 420, status: "working", idleMin: 0, session: "s-api", ageMin: 3000, recyclable: false, why: "working" },
    { pid: 22, kind: "claude", name: "web", terminal: "t2", mb: 1210, status: "idle", idleMin: 44, session: "s-web", ageMin: 9000, recyclable: true, why: null },
    { pid: 23, kind: "codex", name: "docs", terminal: "t3", mb: 300, status: "idle", idleMin: 5, ageMin: 50, recyclable: false, why: "not Claude" },
  ],
  heaviest: [{ pid: 5, name: "com.apple.Virtualization", mb: 8000, ageMin: 20000 }],
  helpers: 2,
  limits: { windowMB: 1200, agentMB: 900, agentIdleMin: 20, lowFreePct: 20, recycle: true },
  paused: false,
  events: [{ at: NOW - 2 * HOUR, kind: "reap", text: "ended 3 helpers" }, { at: NOW - HOUR, kind: "recycle", text: "recycled web" }],
});

test("Memory reads the guard's sizes, spans and moments the way a person does", async () => {
  const { size, span, clock } = await model();
  assert.equal(size(640), "640 MB");
  assert.equal(size(1434), "1.4 GB");
  assert.equal(size(1024), "1 GB");
  assert.equal(size(14_500), "14 GB");
  assert.equal(size(undefined), "–");
  assert.deepEqual([span(0.4), span(12), span(300), span(5 * 1440)], ["now", "12 min", "5 h", "5 d"]);
  assert.equal(clock(NOW - HOUR, NOW), "14:00");
  assert.equal(clock(NOW - 2 * DAY, NOW), "Nov 3 15:00");
});

test("Memory tells a working guard from one that is off, stopped or unreadable", async () => {
  const { parseNow, STALE_MS } = await model();
  assert.equal(parseNow(null, NOW).state, "off");
  assert.equal(parseNow("", NOW).state, "off");
  assert.equal(parseNow("{nope", NOW).state, "bad");
  assert.equal(parseNow(JSON.stringify({ v: 2, at: NOW }), NOW).state, "bad", "a format it does not know");
  assert.equal(parseNow(JSON.stringify(sample(NOW - STALE_MS - 1)), NOW).state, "stale");
  const { state, data } = parseNow(JSON.stringify(sample()), NOW);
  assert.equal(state, "ok");
  assert.deepEqual(clone(data.agents.map((a) => a.name)), ["web", "api", "docs"], "heaviest agent first");
  assert.deepEqual(clone(data.events.map((e) => e.kind)), ["recycle", "reap"], "newest event first");
  const bare = parseNow(JSON.stringify({ v: 1, at: NOW }), NOW).data;
  assert.deepEqual(clone([bare.agents, bare.events, bare.limits]), [[], [], {}], "missing parts read as empty");
});

test("Memory words an agent's line and the guard's limits", async () => {
  const { parseNow, agentsMB, agentMeta, limitsNote } = await model();
  const data = parseNow(JSON.stringify(sample()), NOW).data;
  assert.equal(agentsMB(data), 1930);
  assert.deepEqual(clone(agentMeta(data.agents[0])), ["claude", "t2", "idle 44 min", "up 6 d"]);
  assert.deepEqual(clone(agentMeta(data.agents[1])), ["claude", "t1", "working", "up 2 d"]);
  assert.equal(limitsNote(data.limits), "Window restarts past 1.2 GB · idle agents recycle past 900 MB after 20 min · notice under 20% free");
  assert.equal(limitsNote({ windowMB: 1200, recycle: false }), "Window restarts past 1.2 GB · agents are never recycled");
});

test("Memory's chart keeps each bucket's lowest free memory and marks the lowest of all", async () => {
  const { freeSeries } = await model();
  const minutes = [];
  for (let i = 0; i < 24 * 60; i += 1) minutes.push([NOW - (24 * 60 - i) * MIN + 1, 50, 0, 900, 1800]);
  minutes[600][1] = 12; // one dip
  minutes[601][1] = 18;
  const day = freeSeries({ minutes, hours: [] }, "day", NOW, 20);
  assert.equal(day.bars.length, 96);
  assert.equal(day.bars.filter((b) => b.mark).length, 1);
  const marked = day.bars.find((b) => b.mark);
  assert.equal(marked.value, "12%");
  assert.equal(marked.low, true, "under the guard's low mark");
  assert.equal(day.lowest, "12%");
  assert.equal(day.bars[0].ratio, 0.5);
  assert.equal(day.first, "15:00");
  assert.equal(day.last, "now");

  const hours = [[NOW - 2 * DAY, 40, 45, 0, 900, 1500], [NOW - 10 * DAY, 25, 30, 0, 900, 1500]];
  const week = freeSeries({ minutes, hours }, "week", NOW, 20);
  assert.equal(week.bars.length, 84);
  assert.equal(week.lowest, "40%", "ten days ago is outside the week");
  assert.equal(week.bars.filter((b) => !b.empty).length, 1, "the week reads hours, not minutes");
  const month = freeSeries({ hours }, "month", NOW, 20);
  assert.equal(month.lowest, "25%");
  assert.equal(month.first, "Oct 6");
  assert.equal(freeSeries({}, "day", NOW).empty, true);
});

test("Memory draws each agent's 14 days on one scale and finds it by session or name", async () => {
  const { agentSparks, sparkFor } = await model();
  const sparks = agentSparks({ agents: {
    "s-web": { name: "web", kind: "claude", points: [[NOW - HOUR, 1200], [NOW - 2 * HOUR, 600], [NOW - 3 * DAY, 300], [NOW - 20 * DAY, 9000]] },
    "codex:docs": { name: "docs", kind: "codex", points: [[NOW - HOUR, 600]] },
  } }, NOW);
  assert.equal(sparks["s-web"].ratios.length, 14);
  assert.equal(sparks["s-web"].ratios[13], 1, "today's largest is the top of the scale; 20 days ago is out");
  assert.equal(sparks["s-web"].ratios[11], 0.25, "three days ago");
  assert.equal(sparks["codex:docs"].ratios[13], 0.5, "same scale as the others");
  assert.equal(sparkFor(sparks, { session: "s-web", name: "x" }), sparks["s-web"]);
  assert.equal(sparkFor(sparks, { kind: "codex", name: "docs" }), sparks["codex:docs"]);
  assert.equal(sparkFor(sparks, { kind: "claude", name: "docs" }), null, "a name of another kind is not it");
});

test("Memory reduces history.json to what it draws, and ignores what it can't read", async () => {
  const { digestHistory } = await model();
  assert.equal(digestHistory(null, NOW), null);
  assert.equal(digestHistory("{", NOW), null);
  const d = digestHistory(JSON.stringify({ v: 1, minutes: [[NOW - MIN, 30, 0, 900, 1800]], hours: [], agents: {}, totals: { recycles: 4, restarts: 1, reaped: 9, freedMB: 5120, since: NOW - 9 * DAY } }), NOW, 20);
  assert.deepEqual(Object.keys(d.series), ["day", "week", "month"]);
  assert.equal(d.series.day.lowest, "30%");
  assert.equal(d.totals.recycles, 4);
  assert.equal(d.totals.freedMB, 5120);
});

test("Memory starts the guard detached for an action and reads its files again", async () => {
  const calls = [], timers = [];
  const files = { "/app/data/kanso-guard/now.json": JSON.stringify(sample(Date.now())), "/app/mods/kanso-guard/runtime.json": "{\"node\": \"/opt/node\"}" };
  const host = {
    appHome: () => "/app",
    readTextFile: async (path) => files[path] ?? null,
    exec: async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    layout: () => ({ id: "root", children: [{ id: "memory", type: "block", content: { mod: "kanso-guard" } }] }),
    nextCommand: async () => { throw new Error("no commands here"); },
  };
  const { Memory } = await load("kanso-guard/main.js", ["Memory"], host);
  const pending = [];
  const cx = {
    notify() {},
    spawn(fn) { const p = fn(cx); pending.push(p); return { cancel() {} }; },
    timer: { every: () => ({ cancel() {} }), after: (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; } },
  };
  const drain = async () => { while (pending.length) await pending.shift(); };
  const view = new Memory();
  view.init({}, cx);
  await drain();
  assert.equal(view.now.state, "ok");
  assert.equal(calls.length, 0, "reading runs no process");

  const web = view.now.data.agents[0];
  view.recycle(web, cx);
  await drain();
  assert.deepEqual(calls[0], ["sh", "-c", 'nohup "$0" "$@" >/dev/null 2>&1 &', "/opt/node", "/app/mods/kanso-guard/guard.mjs", "recycle", "22"]);
  assert.ok(view.busy["recycle:22"], "shows it is on its way");
  view.recycle(web, cx);
  await drain();
  assert.equal(calls.length, 1, "a second press while it runs starts nothing");
  assert.deepEqual(timers.map(([ms]) => ms).filter((ms) => ms >= 3000), [3000, 8000, 20_000], "reads again after a few seconds");

  const gone = sample(Date.now());
  gone.agents = gone.agents.filter((a) => a.pid !== 22);
  files["/app/data/kanso-guard/now.json"] = JSON.stringify(gone);
  view.read(cx);
  await drain();
  assert.equal(view.busy["recycle:22"], undefined, "done once the guard no longer lists it");

  view.sleep();
  assert.equal(view.now, null, "hidden, it keeps nothing");
});

// The daemon's pure parts. HERDR_APP_HOME points it at a scratch folder.
test("guard: resume command keeps safe options and refuses what it can't rebuild", async () => {
  process.env.HERDR_APP_HOME = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/kg-`);
  const g = await import("../kanso/mods/kanso-guard/guard.mjs");
  assert.deepEqual(g.resumeArgv(["claude", "--model", "haiku", "fix it"], "S"), ["claude", "--model", "haiku", "--resume", "S"]);
  assert.deepEqual(g.resumeArgv(["claude", "--resume", "old", "--fork-session", "--dangerously-skip-permissions"], "S"), ["claude", "--dangerously-skip-permissions", "--resume", "S"]);
  assert.equal(g.resumeArgv(["claude", "--disallowedTools", "Bash", "Edit"], "S"), null);
  assert.equal(g.resumeArgv(["node", "/x/cli.js"], "S"), null);
  assert.equal(g.sameStart("Sun Nov  1 06:12:52 2026", new Date(Date.UTC(2026, 10, 1, 6, 12, 52)).toString().slice(0, 24)), true);
  assert.equal(g.sameStart("Sun Nov  1 06:12:52 2026", new Date(Date.UTC(2026, 10, 1, 6, 42, 52)).toString().slice(0, 24)), false);
});

test("guard: history keeps a day by the minute and at most 40 agents", async () => {
  const g = await import("../kanso/mods/kanso-guard/guard.mjs");
  let h = null;
  const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < 1500; i++) h = g.addToHistory(h, [t0 + i * 60_000, 50, 1000, 300, 3000], i < 60 ? Array.from({ length: 50 }, (_, k) => ({ session: `s${k}-${i % 2}`, name: "a", kind: "claude", mb: 300 })) : [], t0 + i * 60_000);
  assert.ok(h.minutes.length <= 1440);
  assert.ok(Object.keys(h.agents).length <= 40);
  assert.ok(JSON.stringify(h).length < 1024 * 1024);
});

test("guard panel: agents grouped, estimate, batch progress", async () => {
  const m = await load("kanso-guard/model.js", ["groupAgents", "freedEstimate", "parseBatch", "FRESH_MB"]);
  const agents = [
    { pid: 1, mb: 300, status: "idle", recyclable: true },
    { pid: 2, mb: 800, status: "idle", recyclable: true },
    { pid: 3, mb: 500, status: "working", recyclable: false, why: "It is working" },
    { pid: 4, mb: 150, status: "idle", recyclable: false, kind: "grok", why: "Only Claude Code agents can be resumed automatically" },
  ];
  const g = m.groupAgents(agents);
  assert.deepEqual(g.ready.map((a) => a.pid), [2, 1]);
  assert.deepEqual(g.working.map((a) => a.pid), [3]);
  assert.deepEqual(g.other.map((a) => a.pid), [4]);
  assert.equal(m.freedEstimate(g.ready), (800 - m.FRESH_MB) + (300 - m.FRESH_MB));
  const now = Date.now();
  const running = m.parseBatch(JSON.stringify({ at: now - 60_000, total: 3, current: "b", done: [{ name: "a", ok: true, beforeMB: 800, afterMB: 220 }], finished: false }), now);
  assert.equal(running.finished, false);
  assert.equal(running.freed, 580);
  assert.equal(m.parseBatch(JSON.stringify({ at: now - 3_600_000, total: 1, done: [], finished: true, finishedAt: now - 3_600_000 }), now), null);
  assert.equal(m.parseBatch("not json", now), null);
  assert.equal(m.parseBatch(JSON.stringify({ at: now, total: 0, done: [], finished: true, finishedAt: now }), now).total, 0);
  const cut = m.parseBatch(JSON.stringify({ at: now - 7 * 60_000, beat: now - 6 * 60_000, total: 3, done: [], finished: false }), now);
  assert.equal(cut.interrupted, true);
  assert.deepEqual(m.groupAgents(agents, "t9").ready.batchable.map((a) => a.pid), [2, 1]);
});

test("guard panel: stale agents to close, oldest first, never the focused one", async () => {
  const m = await load("kanso-guard/model.js", ["staleAgents"]);
  const agents = [
    { pid: 1, kind: "claude", status: "idle", idleMin: 5000, terminal: "t1" },
    { pid: 2, kind: "claude", status: "idle", idleMin: 9000, terminal: "t2" },
    { pid: 3, kind: "claude", status: "working", idleMin: null, terminal: "t3" },
    { pid: 4, kind: "grok", status: "idle", idleMin: 0, terminal: "t4" },
    { pid: 5, kind: "claude", status: "idle", idleMin: 100, terminal: "t5" },
  ];
  assert.deepEqual(m.staleAgents(agents, 2880, "t1").map((a) => a.pid), [2]);
  assert.deepEqual(m.staleAgents(agents, 2880).map((a) => a.pid), [2, 1]);
});

test("ports share card: counts and sizes only, the tally adds up", async () => {
  const card = await load("kanso-panel/ports-card.js", ["portsSpec", "portsText", "readTally", "addToTally"]);
  const ports = await load("kanso-panel/ports.js", ["processTrees", "exited"], { panes: () => [], terminals: () => [], home: () => "/h", theme: () => ({}) });
  const t = card.addToTally(card.addToTally(card.readTally(null), 2, 900, 1000), 1, 300, 2000);
  assert.deepEqual(clone(t), { stopped: 3, freedMB: 1200, since: 1000 });
  const list = [{ pid: 1, ports: [5173], owner: "t1", args: "vite --port 5173", cwd: "/h/secret" }, { pid: 2, ports: [3000], owner: null, args: "next dev", cwd: "/h/x" }];
  const spec = JSON.stringify(card.portsSpec(list, t)) + card.portsText(list, t);
  for (const leak of ["5173", "3000", "secret", "vite", "next dev"]) assert.ok(!spec.includes(leak), `no ${leak} in the card`);
  assert.match(card.portsText(list, t), /3 dev servers my agents left running, found and stopped: 1\.2 GB back/);
  const trees = ports.processTrees("10 1 102400 Thu Nov  5 10:00:00 2026\n11 10 51200 Thu Nov  5 10:00:01 2026\n12 10 51200 Thu Nov  5 10:00:02 2026\n20 1 1024 Thu Nov  5 10:00:03 2026\n", [10, 11, 20]);
  assert.equal(trees.get(10).length, 3, "the server and its workers");
  assert.equal(trees.get(11).length, 0, "a worker already counted under its server is not counted again");
  const e = ports.exited(trees.get(10), "11 Thu Nov  5 10:00:01 2026\n12 Thu Nov  5 11:00:00 2026\n");
  assert.deepEqual(clone(e), { rootGone: true, kb: 102400 + 51200 }, "the root exited, a worker survives, a pid reused counts as exited");
  assert.equal(ports.exited(trees.get(20), "20 Thu Nov  5 10:00:03 2026\n").rootGone, false, "still running: not counted");
});
