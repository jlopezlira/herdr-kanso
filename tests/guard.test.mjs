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
