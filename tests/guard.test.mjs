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

// Ports' history, from the guard's ports.json.
const portsModel = () => load("kanso-panel/ports-model.js", ["STALE_MS", "parsePorts", "historyOf", "activeSeries", "portStats", "historyLists", "lasted"]);
const portsSample = (at = NOW - 30_000) => {
  const minutes = [], hours = [];
  for (let i = 1; i <= 24 * 60; i += 1) minutes.push([NOW - i * MIN, i === 300 ? 5 : 2, i === 300 ? 2 : 1, 900]);
  for (let i = 1; i <= 10 * 24; i += 1) hours.push([NOW - i * HOUR, i === 50 ? 7 : 3, 1, 1200]);
  return {
    v: 1, at,
    now: [
      { key: "41@1", pid: 41, ports: [5173], command: "node", args: "vite --port 5173", cwd: "/h/secret-app", project: "secret-app", owner: "t2", mb: 300, startedAt: NOW - 3 * HOUR, firstSeen: NOW - 3 * HOUR },
      { key: "42@1", pid: 42, ports: [3000], command: "node", args: "next dev", cwd: "/h/other", project: "other", owner: null, mb: 500, startedAt: NOW - 2 * DAY, firstSeen: NOW - 2 * DAY },
    ],
    minutes, hours,
    servers: [
      { key: "41@1", pid: 41, ports: [5173], command: "node", args: "vite", project: "secret-app", startedAt: NOW - 3 * HOUR, firstSeen: NOW - 3 * HOUR, lastSeen: NOW - MIN, peakMB: 320, owner: "t2", everLoose: false, ended: null },
      { key: "42@1", pid: 42, ports: [3000], command: "node", args: "next dev", project: "other", startedAt: NOW - 2 * DAY, firstSeen: NOW - 2 * DAY, lastSeen: NOW - MIN, peakMB: 600, owner: null, everLoose: true, ended: null },
      { key: "43@1", pid: 43, ports: [8000], command: "python3", args: "manage.py runserver", project: "django-thing", startedAt: NOW - 5 * HOUR, firstSeen: NOW - 5 * HOUR, lastSeen: NOW - 4 * HOUR, peakMB: 140, owner: null, everLoose: true, ended: { at: NOW - 4 * HOUR, how: "stopped", freedMB: 130 } },
      { key: "44@1", pid: 44, ports: [4321], command: "node", args: "astro dev", project: "blog", startedAt: NOW - 3 * DAY, firstSeen: NOW - 3 * DAY, lastSeen: NOW - 2 * DAY, peakMB: 210, owner: "t5", everLoose: false, ended: { at: NOW - 2 * DAY, how: "exited" } },
      { key: "45@1", pid: 45, ports: [9000], command: "node", args: "x", project: "old", startedAt: NOW - 20 * DAY, firstSeen: NOW - 20 * DAY, lastSeen: NOW - 19 * DAY, peakMB: 90, owner: null, everLoose: true, ended: { at: NOW - 19 * DAY, how: "stopped", freedMB: 80 } },
    ],
    totals: { opened: 30, stopped: 6, exited: 9, freedMB: 2400, since: NOW - 25 * DAY },
  };
};

test("Ports tells a working guard's ports.json from one that is missing, stopped or unreadable", async () => {
  const { parsePorts, STALE_MS } = await portsModel();
  assert.equal(parsePorts(null, NOW).state, "off");
  assert.equal(parsePorts("{nope", NOW).state, "bad");
  assert.equal(parsePorts(JSON.stringify({ v: 2, at: NOW }), NOW).state, "bad", "a format it does not know");
  assert.equal(parsePorts(JSON.stringify(portsSample(NOW - STALE_MS - 1)), NOW).state, "stale");
  const { state, data } = parsePorts(JSON.stringify(portsSample()), NOW);
  assert.equal(state, "ok");
  assert.equal(data.now.length, 2);
  assert.equal(data.servers[4].ended.how, "stopped");
  assert.equal(data.servers.find((s) => s.pid === 44).ended.freedMB, 0, "an exit gives nothing back");
  const bare = parsePorts(JSON.stringify({ v: 1, at: NOW, now: [null, { nope: 1 }], minutes: [[NOW, 1, 0, 1], "x"] }), NOW).data;
  assert.deepEqual(clone([bare.now, bare.servers, bare.hours, bare.minutes.length, bare.totals.stopped]), [[], [], [], 1, 0], "missing or broken parts read as empty");
});

test("Ports finds a live row's history by pid and start, not by a reused pid", async () => {
  const { parsePorts, historyOf } = await portsModel();
  const data = parsePorts(JSON.stringify(portsSample()), NOW).data;
  assert.equal(historyOf({ pid: 41, secs: 3 * 3600 + 30 }, data, NOW).mb, 300);
  assert.equal(historyOf({ pid: 41, secs: 60 }, data, NOW), null, "same pid, started later: another process");
  assert.equal(historyOf({ pid: 99, secs: 60 }, data, NOW), null);
});

test("Ports' chart keeps each bucket's most at once and its part with no pane", async () => {
  const { parsePorts, activeSeries } = await portsModel();
  const data = parsePorts(JSON.stringify(portsSample()), NOW).data;
  const day = activeSeries(data, "day", NOW);
  assert.equal(day.bars.length, 96);
  assert.equal(day.peak, 5);
  assert.equal(day.bars.filter((b) => b.mark).length, 1);
  const mark = day.bars.find((b) => b.mark);
  assert.deepEqual(clone([mark.active, mark.loose, mark.ratio, mark.looseRatio]), [5, 2, 1, 0.4]);
  assert.equal(day.bars[95].ratio, 0.4, "the rest at 2 of 5");
  assert.equal(day.first, "15:00");
  const week = activeSeries(data, "week", NOW);
  assert.equal(week.bars.length, 84);
  assert.equal(week.peak, 7, "the week reads the hours");
  assert.equal(week.filled, 84);
  const month = activeSeries(data, "month", NOW);
  assert.equal(month.first, "Oct 6");
  assert.ok(month.bars.slice(0, 60).every((b) => b.empty), "no hours before ten days ago");
  assert.equal(activeSeries(null, "day", NOW).empty, true);
});

test("Ports' numbers and lists: opened today, what ended and how", async () => {
  const { parsePorts, portStats, historyLists } = await portsModel();
  const data = parsePorts(JSON.stringify(portsSample()), NOW).data;
  const s = portStats(data, NOW);
  assert.deepEqual(clone([s.running, s.loose, s.heldMB, s.openedToday, s.openedWeek, s.weekPeak, s.leftBehind, s.stoppedLoose, s.stoppedLooseMB, s.stopped, s.freedMB]),
    [2, 1, 800, 2, 4, 7, 3, 2, 210, 6, 2400]);
  const l = historyLists(data, NOW);
  assert.deepEqual(clone(l.opened.map((r) => r.name)), ["secret-app", "django-thing"], "newest first");
  assert.deepEqual(clone(l.opened[1]), { key: "43@1", name: "django-thing", ports: ":8000", opened: "opened 10:00", ran: "ran 1 h", how: "stopped by you · 130 MB back", loose: false, peak: "140 MB" });
  assert.equal(l.opened[0].ran, "running");
  assert.deepEqual(clone(l.ended.map((r) => [r.name, r.how])), [["django-thing", "stopped by you · 130 MB back"], ["blog", "exited"], ["old", "stopped by you · 80 MB back"]]);
});

test("ports share card: counts and sizes only, a brag once you stopped what agents left", async () => {
  const card = await load("kanso-panel/ports-card.js", ["portsSpec", "portsText"]);
  const { parsePorts } = await portsModel();
  const data = parsePorts(JSON.stringify(portsSample()), NOW).data;
  const spec = card.portsSpec(data, NOW), words = card.portsText(data, NOW);
  const all = JSON.stringify(spec) + words;
  for (const leak of ["5173", "3000", "8000", "secret", "other", "django", "blog", "vite", "next dev", "runserver", "/h/"]) assert.ok(!all.includes(leak), `no ${leak} in the card`);
  assert.deepEqual(clone([spec.hero.big, spec.hero.small, spec.hero.delta.text]), ["2", "servers", "210 MB of memory given back"]);
  assert.deepEqual(clone(spec.stats.map((x) => x.unit)), ["running now", "at once at the peak", "opened this week", "left with no pane"]);
  assert.equal(spec.blocks[0].kind, "bars");
  assert.equal(spec.blocks[0].values.length, 84);
  assert.match(words, /^2 dev servers my agents left running, found and stopped: 210 MB back/);

  // Nothing stopped yet, one day of hours: the week's openings, no chart.
  const quiet = portsSample();
  quiet.servers = quiet.servers.filter((s) => !s.ended);
  quiet.hours = quiet.hours.slice(0, 20);
  const q = card.portsSpec(parsePorts(JSON.stringify(quiet), NOW).data, NOW);
  assert.deepEqual(clone([q.hero.big, q.hero.label, q.right]), ["2", "opened by my agents", "last 7 days"]);
  assert.ok(q.stats.some((x) => x.unit === "given back"));
  assert.equal(q.blocks.length, 0, "less than two days reads as a blank");
});

test("Ports stops a server through the guard, detached, and by itself without it", async () => {
  const calls = [];
  const files = { "/app/data/kanso-guard/ports.json": JSON.stringify(portsSample(Date.now())), "/app/mods/kanso-guard/runtime.json": "{\"node\": \"/opt/node\"}" };
  const host = {
    appHome: () => "/app", home: () => "/h", theme: () => ({}), panes: () => [], terminals: () => [],
    readTextFile: async (path) => files[path] ?? null,
    exec: async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: "", stderr: "" }; },
  };
  const { Ports, STOP_LOOP } = await load("kanso-panel/ports.js", ["Ports", "STOP_LOOP"], host);
  const pending = [], timers = [];
  const cx = {
    notify() {}, sleep: async () => {},
    spawn(fn) { const p = fn(cx); pending.push(p); return { cancel() {} }; },
    timer: { every: () => ({ cancel() {} }), after: (ms, fn) => { timers.push(ms); return { cancel() {} }; } },
  };
  const drain = async () => { while (pending.length) await pending.shift(); };
  const view = new Ports();
  view.init(cx);
  await drain();
  assert.equal(view.hist.state, "ok");
  assert.equal(view.digest.series.day.peak, 5);
  calls.length = 0;
  view.stop([{ pid: 42, owner: null }, { pid: 43, owner: null, force: true }], cx);
  await drain();
  const guard = calls.find((c) => c[0] === "sh");
  assert.deepEqual(clone(guard), ["sh", "-c", 'nohup "$0" "$@" >/dev/null 2>&1 &', "sh", "-c", STOP_LOOP, "/opt/node", "/app/mods/kanso-guard/guard.mjs", "42", "43:force"]);
  assert.ok(!calls.some((c) => c[0] === "kill"), "no signal of its own");
  assert.ok(timers.includes(4000), "reads the history again after a few seconds");

  delete files["/app/data/kanso-guard/ports.json"];
  const bare = new Ports();
  bare.init(cx);
  await drain();
  assert.equal(bare.hist.state, "off");
  calls.length = 0;
  bare.stop([{ pid: 42, owner: null }], cx);
  await drain();
  assert.deepEqual(clone(calls.find((c) => c[0] === "kill")), ["kill", "-TERM", "42"], "no guard: the signal itself");
});

test("guard: dev server history (opened, exited, minutes and hours)", async () => {
  process.env.HERDR_APP_HOME ??= (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/kg-`);
  const g = await import("../kanso/mods/kanso-guard/guard.mjs");
  const a = { key: "1@1", pid: 1, ports: [3000], command: "node", args: "next dev", cwd: "/h/p", project: "p", owner: null, mb: 200, startedAt: 1 };
  const b = { ...a, key: "2@2", pid: 2, ports: [5173], owner: "t1", mb: 100 };
  let p = g.updatePorts(null, [a, b], 1_000_000);
  assert.deepEqual([p.totals.opened, p.now.length, p.minutes[0].slice(1)], [2, 2, [2, 1, 300]]);
  p = g.updatePorts(p, [{ ...a, mb: 260 }], 1_060_000);
  assert.equal(p.totals.exited, 1);
  assert.equal(p.servers.find((s) => s.key === "2@2").ended.how, "exited");
  assert.equal(p.servers.find((s) => s.key === "1@1").peakMB, 260);
  assert.equal(p.servers.find((s) => s.key === "1@1").everLoose, true);
  assert.equal(p.hours.length, 1);
});
