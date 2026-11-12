import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { databaseTimer, load, clone, temporary, exec, singleUse, context, tape } from "./helpers.mjs";
import { AWAY_MS, KEEP_MS, EVENT_CAP, MAINTENANCE_MS, targetOf, parseTarget, returnSignature, changes, digest, lines, focusedTarget, agentSnapshot, observedAgents, present, RETURN_LABEL, destinationOf, livePlaces, eventLabel, oneLine, awayShown, AWAY_PIECE, DID_CAP } from "../kanso/mods/kanso-spaces/since-left-model.js";

const project = ":C:\\work\\kanso";
const event = (id, kind = "finished", at = id) => ({ id, project, target: `agent:${id}`, kind, text: `Agent ${id}`, at });
const snapshot = (status, name = "Padme") => ({ source: "agent:c1", project, value: { type: "agent", status, name, target: "agent:c1" } });
const cx = { notify() {} };

async function database(t) {
  const dir = await temporary(t);
  const { Kdb, rowsOfOutput } = await load("kanso-spaces/kdb.js", ["Kdb", "rowsOfOutput"], { exec, appHome: () => dir });
  const { SinceStore } = await load("kanso-spaces/since-left-store.js", ["SinceStore"], { exec, appHome: () => dir });
  const db = new Kdb(databaseTimer, join(dir, "data"));
  await db.open();
  return { db, store: new SinceStore(db), rowsOfOutput };
}

const saveEvents = (db, events) => db.run(["BEGIN;", ...events.map((row) => `INSERT INTO since_events(id,project,target,kind,text,at) VALUES(${row.id},'${project}','${row.target}','${row.kind}','${row.text}',${row.at});`), "COMMIT;"]);

test("return events put blocked, errors, PRs, and finishes first, newest within each priority", () => {
  const events = [event(1), event(3, "pr"), event(2, "blocked"), event(4, "error"), event(5, "blocked"), event(6, "finished")];
  const rows = digest(events, { focused_at: 0 }, AWAY_MS);
  assert.deepEqual(rows.map((row) => row.id), [5, 2, 4, 3, 6, 1]);
  assert.deepEqual(events.map((row) => row.id), [1, 3, 2, 4, 5, 6]);
});

test("a return has no more than three lines, including its +N, and expands to all events", () => {
  for (const count of [0, 1, 2, 3, 4, 15]) {
    const events = Array.from({ length: count }, (_, i) => event(i + 1));
    const compact = lines(events);
    assert.equal(compact.length, Math.min(count, 3));
    if (count > 3) assert.equal(compact.at(-1).more, count - 2);
    assert.deepEqual(lines(events, true), events);
  }
});

test("five minutes away is the boundary, a first visit and nothing happened stay empty", () => {
  assert.deepEqual(digest([event(1)], undefined, AWAY_MS), []);
  assert.deepEqual(digest([event(1)], { focused_at: 0 }, AWAY_MS - 1), []);
  assert.equal(digest([event(1)], { focused_at: 0 }, AWAY_MS).length, 1);
  assert.deepEqual(digest([], { focused_at: 0 }, AWAY_MS), []);
  assert.deepEqual(digest([event(1, "finished", 0), event(2, "finished", AWAY_MS + 1)], { focused_at: 0 }, AWAY_MS), []);
});

test("a pending return survives a short visit and dismisses only through its own events", () => {
  const events = [event(1), event(2), event(3)];
  const focus = { focused_at: 200, pending_json: "[1,2]", dismissed_to: 1 };
  assert.deepEqual(digest(events, focus, 201).map((row) => row.id), [2]);
  assert.equal(focusedTarget(events, "agent:1", "agent:1"), false);
  assert.equal(focusedTarget(events, "agent:1", "agent:2"), true);
  assert.equal(focusedTarget(events, "agent:1", null), false);
  assert.equal(focusedTarget(events, "agent:1", "elsewhere"), false);
});

test("agent facts distinguish blocked and errors and count a finished turn once", () => {
  const base = { type: "agent", name: "Padme", status: "working" };
  assert.deepEqual(changes(null, { ...base, status: "done" }), []);
  for (const [status, kind] of [["blocked", "blocked"], ["error", "error"], ["done", "finished"], ["idle", "finished"]]) {
    const fact = changes(base, { ...base, status })[0];
    assert.equal(fact.kind, kind);
    assert.equal(fact.text, "Padme");
  }
  assert.deepEqual(changes({ ...base, status: "done" }, { ...base, status: "idle" }), []);
  assert.deepEqual(changes({ ...base, status: "idle" }, { ...base, status: "done" }), []);
  assert.deepEqual(changes(base, base), []);
  const agent = { address: "t1", status: "blocked", title: "Padme" };
  const first = agentSnapshot(agent, null, { created_ms: 1, status: "error" }, project);
  assert.equal(first.value.status, "error");
  assert.notEqual(first.source, agentSnapshot(agent, null, { created_ms: 2 }, project).source);
  assert.equal(agentSnapshot(agent, { conversation: "c1", name: "Luke" }, {}, project).value.name, "Luke");
  const titled = { address: "t1", status: "done", title: "Implement performance budget CI | herdr-kanso" };
  assert.equal(agentSnapshot(titled, { name: titled.title }, { labels: { "kanso.name": "Kylo-ren" } }, project).value.name, "Kylo-ren");
  assert.equal(agentSnapshot(titled, { title: "Compatibilizar Kanso con Windows", name: titled.title }, {}, project).value.name, "Compatibilizar Kanso con Windows");
  assert.equal(agentSnapshot(titled, null, null, project).value.name, "Implement performance budget CI");
});

test("PR facts include approval, requested changes, failed checks, and merges without guessing disappearance", () => {
  const base = { type: "pr", number: 14, state: "OPEN", review: "REVIEW_REQUIRED", checks: "pass" };
  for (const [field, value, word] of [["review", "APPROVED", "approved"], ["review", "CHANGES_REQUESTED", "changes requested"], ["checks", "fail", "checks failed"], ["state", "MERGED", "merged"]]) {
    const after = { ...base, [field]: value };
    assert.deepEqual(changes(base, after), [{ kind: "pr", text: `PR #14 ${word}` }]);
    assert.deepEqual(changes(after, after), []);
  }
  assert.deepEqual(changes(base, { ...base, state: "CLOSED" }), []);
});

test("the database remembers projects separately, persists dismissal, and keeps new events", async (t) => {
  const { db, store } = await database(t);
  await store.enter(project, 0);
  await store.observe([snapshot("working")], 1);
  await store.observe([snapshot("blocked")], 2);
  assert.deepEqual(clone(await store.enter(":other", AWAY_MS)), []);
  const rows = await store.enter(project, AWAY_MS);
  assert.equal(rows[0].kind, "blocked");
  assert.equal((await store.enter(project, AWAY_MS + 1)).length, 1);
  await store.dismiss(project, rows[0].id);
  assert.equal((await store.enter(project, AWAY_MS * 2)).length, 0);
  await store.observe([snapshot("working")], AWAY_MS * 2 + 1);
  await store.observe([snapshot("error")], AWAY_MS * 2 + 2);
  assert.equal((await store.enter(project, AWAY_MS * 3))[0].kind, "error");
  assert.equal((await db.read("SELECT COUNT(*) AS n FROM since_focus;"))[0].n, 2);
});

test("two observers record one transition, reject older sightings, and do not replay a seeded cache", async (t) => {
  const { db, store } = await database(t);
  await store.observe([snapshot("working")], 100);
  await Promise.all([store.observe([snapshot("done")], 200), store.observe([snapshot("done")], 200)]);
  await store.observe([snapshot("working")], 150);
  await store.seed([snapshot("working")], 300);
  await store.observe([snapshot("done")], 400);
  assert.equal((await db.read("SELECT COUNT(*) AS n FROM since_events;"))[0].n, 1);
});

test("the event log prunes by age and cap and sqlite output accepts Windows line endings", async (t) => {
  const { db, store, rowsOfOutput } = await database(t);
  const now = KEEP_MS + 1000;
  await saveEvents(db, [event(1, "finished", 1), ...Array.from({ length: EVENT_CAP + 5 }, (_, i) => event(i + 2, "pr", now))]);
  await store.prune(now);
  const rows = await db.read("SELECT id FROM since_events ORDER BY id;");
  assert.equal(rows.length, EVENT_CAP);
  assert.equal(rows[0].id, 7);
  assert.deepEqual(clone(rowsOfOutput('[{"n":1}]\r\n[{"n":2}]\r\n')), [{ n: 1 }, { n: 2 }]);
});

test("PR observations use only known local project mappings and keep check results across partial reads", async (t) => {
  const { db } = await database(t);
  await db.run("INSERT INTO projects(id,name,folder,machine,added) VALUES('p1','Kanso','C:\\work\\kanso','',0);");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id) VALUES('r1','github','ghe.example','o','r','p1');");
  const { recordPrFacts } = await load("kanso-panel/pr-inbox.js", ["recordPrFacts"]);
  const pr = { url: "https://ghe.example/o/r/pull/2", number: 2, state: "OPEN", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [] };
  await recordPrFacts(db, [pr], 1);
  await recordPrFacts(db, [{ ...pr, reviewDecision: "APPROVED", statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" }] }], 2);
  await recordPrFacts(db, [{ url: pr.url, number: 2, state: "MERGED" }], 3);
  await recordPrFacts(db, [{ ...pr, url: "https://github.com/unknown/r/pull/2" }], 4);
  const rows = await db.read("SELECT project, text FROM since_events ORDER BY id;");
  assert.deepEqual(clone(rows), ["approved", "checks failed", "merged"].map((word) => ({ project, text: `PR #2 ${word}` })));
});

test("the return view expands inline, never focuses a handle, and stays silent while absent", async (t) => {
  const { db } = await database(t);
  const clicks = new Map(), nav = [];
  const ui = singleUse();
  const button = ui.Button.new;
  ui.Button.new = (id) => {
    const element = button(id);
    return new Proxy(element, { get: (target, key) => key === "on_click" ? (fn) => { clicks.set(id, fn); return target; } : target[key] });
  };
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], { ...ui });
  const view = new SinceLeft(db);
  view.project = project;
  view.rows = Array.from({ length: 4 }, (_, i) => event(i + 1));
  const register = (id, go) => { nav.push({ id, go }); return false; };
  const heads = [];
  view.render({}, project, register, () => true, (label, count) => { heads.push([label, count]); return {}; });
  assert.deepEqual(heads, [[RETURN_LABEL, 4]]);
  assert.equal(nav.length, 3);
  nav.at(-1).go(cx);
  assert.equal(view.lineCount(), 4);
  view.render({}, project, register, () => true);
  assert.equal(nav.length, 7);
  await view.dismiss(cx);
  assert.equal(view.rows.length, 0);
  view.render({}, project, register, () => true);
  assert.equal(nav.length, 7);
});

test("a second finished turn is recorded even when both observed states are done", () => {
  const before = { type: "agent", name: "Padme", status: "done", turn: 1 };
  const fact = changes(before, { ...before, turn: 2 })[0];
  assert.equal(fact.kind, "finished");
  assert.equal(fact.text, "Padme");
  assert.deepEqual(changes(before, { ...before, name: "Luke" }), []);
});

test("a return row is a mark, a name and an age, and one agent keeps its latest state", async () => {
  const { duration } = await load("kanso-spaces/agents.js", ["duration"]);
  const now = 10 * 60_000;
  const row = (id, target, kind, text, at) => ({ id, target, kind, text, at });
  const events = [
    row(1, "agent:a", "finished", "Kylo-ren finished", now - 4 * 60_000),
    row(2, "agent:a", "blocked", "Kylo-ren needs you", now - 60_000),
    row(3, "agent:b", "error", "Implement performance budget CI | herdr-kanso errored", now - 3_600_000),
    row(4, "pr:https://x/pull/12", "pr", "PR #12 approved", now - 60_000),
  ];
  const shown = present(events, { now, expanded: true, format: duration });
  assert.equal(shown.count, 3);
  const by = Object.fromEntries(shown.rows.map((item) => [item.target, item]));
  assert.deepEqual(shown.rows.map((item) => item.target), ["agent:a", "agent:b", "pr:https://x/pull/12"]);
  assert.equal(by["agent:a"].mark, "blocked");
  assert.equal(by["agent:a"].name, "Kylo-ren");
  assert.equal(by["agent:a"].age, "1m");
  assert.equal(by["agent:b"].mark, "error");
  assert.equal(by["agent:b"].name, "Implement performance budget CI");
  assert.equal(by["agent:b"].age, "1h");
  assert.equal(by["pr:https://x/pull/12"].mark, "pr");
  assert.equal(by["pr:https://x/pull/12"].name, "PR #12");
  assert.equal(by["pr:https://x/pull/12"].outcome, "Approved");
  assert.equal(by["pr:https://x/pull/12"].age, duration(60_000));
  assert.deepEqual(shown.rows.map((item) => [item.outcome, item.did]), [["Needs you", null], ["Failed", null], ["Approved", null]]);
  const away = present(events, { now, focus: "agent:a", format: duration });
  assert.equal(away.count, 2);
  assert.equal(away.rows.some((item) => item.target === "agent:a"), false);
});

test("more than three agents stay at three rows, the last of them +N", async () => {
  const { duration } = await load("kanso-spaces/agents.js", ["duration"]);
  const events = [1, 2, 3, 4].map((id) => ({ id, target: `agent:${id}`, kind: "finished", text: `Agent ${id}`, at: id }));
  const compact = present(events, { now: 10, format: duration });
  assert.equal(compact.count, 4);
  assert.equal(compact.rows.length, 3);
  assert.equal(compact.rows.at(-1).more, 2);
  assert.equal(present(events, { now: 10, format: duration, expanded: true }).rows.length, 4);
  assert.equal(present(events, { now: 10, focus: "agent:1", format: duration }).rows.length, 3);
});

test("the return head shows the count and its dismiss clears the rows", async (t) => {
  const { db } = await database(t);
  const texts = [], clicks = new Map();
  const node = (initial = null) => {
    const self = { id: initial };
    const el = new Proxy({}, { get(_target, key) {
      if (key === "then") return undefined;
      if (key === "id") return (value) => { self.id = value; return el; };
      if (key === "child") return (value) => { if (typeof value === "string" || typeof value === "number") texts.push(String(value)); return el; };
      if (key === "children") return (list) => list;
      if (key === "when") return (on, apply) => (on ? apply(el) : el);
      if (key === "on_click") return (fn) => { clicks.set(self.id, fn); return el; };
      return () => el;
    } });
    return el;
  };
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], { div: node, svg: node, h_flex: node, v_flex: node, Button: { new: node } });
  const view = new SinceLeft(db);
  view.project = project;
  view.target = "agent:1";
  view.rows = [
    { id: 1, target: "agent:1", kind: "finished", text: "Kylo-ren finished", at: 1 },
    { id: 2, target: "agent:2", kind: "blocked", text: "Implement performance budget CI | herdr-kanso needs you", at: 2 },
  ];
  const heads = [];
  view.render({ foreground: "#fff", dim: "#666", muted: "#888", done: "#9a9", blocked: "#c99" }, project, () => false, () => true,
    (label, count, dismiss) => { heads.push([label, count, dismiss]); return dismiss; });
  assert.deepEqual(heads.map(([label, count]) => [label, count]), [[RETURN_LABEL, 1]]);
  assert.equal(texts.includes("Kylo-ren"), false);
  assert.equal(texts.includes("Kylo-ren finished"), false);
  assert.ok(texts.includes("Implement performance budget CI"));
  assert.equal(texts.includes("needs you"), false);
  assert.equal(texts.includes("finished"), false);
  await clicks.get("since-dismiss")(null, { ...cx, stop_propagation() {} });
  assert.equal(view.rows.length, 0);
});

test("return tracking holds the initial focus, dismisses on a later target, and retries a failed load silently", async () => {
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"]);
  const view = new SinceLeft(null), calls = [];
  let fails = true;
  view.store = {
    async observe() {}, async prune() {}, async touch() {},
    async enter() { if (fails) throw new Error("locked"); return [event(1)]; },
    async dismiss(...args) { calls.push(args); },
  };
  const update = (target, now, seenTarget = null) => view.update({ project, target, seenTarget, snapshots: [], now }, cx);
  await assert.rejects(update("agent:1", 1), /locked/);
  assert.equal(view.busy, false);
  assert.equal(view.rows.length, 0);
  fails = false;
  await update("agent:1", 2);
  view.showing = true;
  await update("agent:1", 3);
  assert.equal(view.rows.length, 1, "returning to the same pane leaves time to see the digest");
  await update("other", 4);
  await update("agent:1", 5);
  assert.equal(view.rows.length, 0);
  assert.deepEqual(calls, [[project, 1]]);
  await view.update({ project: null, target: null, snapshots: [], now: 6 }, cx);
  await update("other", 7);
  view.rows = [{ ...event(2), target: "pr:url" }];
  view.showing = true;
  await update("other", 8, "pr:url");
  assert.equal(view.rows.length, 0);
});

test("a return row takes you to the agent's pane, the menu that wakes it, or the PR, and a gone one nowhere", async () => {
  const calls = [], commits = [], overlays = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    run: (...args) => calls.push(clone(args)), commitLayout: (patch) => commits.push(clone(patch)), openOverlay: (overlay) => overlays.push(clone(overlay)),
  });
  const view = new Spaces();
  view.returnPlaces = livePlaces([{ address: "t1" }], () => ["agent:c1", "agent:t1:5"]);
  view.sleepingRows = { rows: [{ address: "zz:t9", name: "Leia", asleep: { id: "t9", resume: "c9" } }] };
  view.returnGo({ target: "agent:t1:5" })();
  assert.deepEqual(calls, [["agent.focus", { terminal: "t1" }]]);
  view.returnGo({ target: "agent:c9" })();
  assert.deepEqual(overlays.map((o) => o.props.menu.asleep.id), ["t9"]);
  view.returnGo({ target: "pr:https://ghe.example/o/r/pull/2" })();
  assert.equal(commits[0].panel.content.props.url, "https://ghe.example/o/r/pull/2");
  for (const target of ["agent:gone", "sleep:s1", "unknown:id", "constructor:id"]) assert.equal(view.returnGo({ target }), null);
});

test("each kind of event leads where it happened: a waiting or failed agent to its pane, an asleep one to its wake menu", () => {
  const live = new Map([["agent:c1", "t1"]]);
  const asleep = [{ asleep: { id: "t9", resume: "c9" } }];
  const kinds = { blocked: "agent:c1", error: "agent:c1", finished: "agent:c1", pr: "pr:https://github.com/o/r/pull/4" };
  const to = Object.fromEntries(Object.entries(kinds).map(([kind, target]) => [kind, destinationOf(target, live, asleep)]));
  for (const kind of ["blocked", "error", "finished"]) assert.deepEqual(to[kind], { kind: "agent", address: "t1" });
  assert.deepEqual(to.pr, { kind: "pr", url: "https://github.com/o/r/pull/4" });
  assert.equal(destinationOf("agent:c9", live, asleep).row, asleep[0]);
});

test("a first detailed PR read compares against the inbox cache, including a merged PR", async (t) => {
  const { db } = await database(t);
  await db.run("INSERT INTO projects(id,name,folder,machine,added) VALUES('p1','App','C:\\work\\app','',0);");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id) VALUES('r1','github','github.com','o','r','p1');");
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,review_decision,role,fetched_at) VALUES('https://github.com/o/r/pull/4','github','github.com','o','r',4,'Fix','OPEN','REVIEW_REQUIRED','author',1);");
  const { recordPrFacts } = await load("kanso-panel/pr-inbox.js", ["recordPrFacts"]);
  await recordPrFacts(db, [{ url: "https://github.com/o/r/pull/4", number: 4, state: "MERGED" }], 2);
  assert.equal((await db.read("SELECT text FROM since_events;"))[0].text, "PR #4 merged");
  await recordPrFacts(db, [], 3);
  await recordPrFacts(db, [{ url: "https://github.com/o/r/pull/4", number: 4, state: "MERGED" }], 4);
  assert.equal((await db.read("SELECT COUNT(*) AS n FROM since_events;"))[0].n, 1);
});

test("raw errors and nested agents keep their project even when absent from the main agent list", () => {
  const list = [{ address: "t1", space: "p1" }];
  const terms = [
    { address: "t2", parent: "t1", program: { agent: true }, status: "error" },
    { address: "t3", parent: "t2", program: { agent: true }, status: "blocked" },
    { address: "t4", parent: "t5", program: { agent: true }, status: "error" },
    { address: "t5", parent: "t4", program: { agent: true }, status: "error" },
    { address: "t6", program: { agent: true }, status: "error" },
    { address: "shell", program: { agent: false }, status: "idle" },
  ];
  const result = observedAgents(list, [{ terminal: "t6", tab: "tab1" }], [{ id: "p2", tabs: [{ id: "tab1" }] }], terms);
  assert.deepEqual(result.map((agent) => [agent.address, agent.space]), [["t1", "p1"], ["t2", "p1"], ["t3", "p1"], ["t6", "p2"]]);
  assert.equal(list.length, 1);
});

test("an unseen digest adds the next absence's events and skips events from the visit between them", async (t) => {
  const { db, store } = await database(t);
  await store.enter(project, 0);
  await saveEvents(db, [event(1, "blocked", 1)]);
  assert.equal((await store.enter(project, AWAY_MS)).length, 1);
  await saveEvents(db, [event(2, "finished", AWAY_MS + 1)]);
  await store.touch(project, AWAY_MS + 2);
  await saveEvents(db, [event(3, "error", AWAY_MS + 3)]);
  assert.deepEqual(clone(await store.enter(project, AWAY_MS * 2 + 2)).map((row) => row.id), [1, 3]);
  await store.prune(KEEP_MS * 2);
  assert.equal((await db.read("SELECT COUNT(*) AS n FROM since_focus;"))[0].n, 1);
});

test("pruning the log also forgets a conversation with no project", async (t) => {
  const { db, store } = await database(t);
  const now = KEEP_MS * 2;
  await db.observe([{ conversation: "c-free", given: "free", space: "s", pos: 0, status: "idle", terminal: "t1" }], 1);
  await db.observe([], KEEP_MS);
  await store.prune(now);
  assert.equal((await db.read("SELECT id FROM agents WHERE id='c-free'")).length, 0);
});

test("targets round trip ids containing colons", () => {
  for (const [kind, id] of [["pr", "https://ghe.example/o/r/pull/1"], ["agent", "t1:123"]]) {
    assert.deepEqual(parseTarget(targetOf(kind, id)), { kind, id });
  }
});

test("PR facts reuse remote identities, sanitize URLs, and query only received PRs", async (t) => {
  const { db } = await database(t);
  const { parsePullRequest } = await load("kanso-panel/pr-remote.js", ["parsePullRequest"]);
  assert.deepEqual(clone(parsePullRequest("https://token@ghe.example/Group/sub/repo/pull/12")), {
    host: "ghe.example", owner: "Group/sub", name: "repo", number: 12, url: "https://ghe.example/Group/sub/repo/pull/12",
  });
  for (const url of ["bad", "https://ghe.example/o/r/pull/no", "https://ghe.example/o/r/issues/1", "https://ghe.example/o/../r/pull/1"]) assert.equal(parsePullRequest(url), null);
  const { recordPrFacts, seedPrFacts } = await load("kanso-panel/pr-inbox.js", ["recordPrFacts", "seedPrFacts"]);
  const reads = [];
  const tracked = { read(sql) { reads.push(sql); return db.read(sql); }, run: (sql) => db.run(sql) };
  await recordPrFacts(tracked, [], 1);
  await seedPrFacts(tracked, [], 1);
  assert.equal(reads.length, 0);
  await db.run("INSERT INTO projects(id,name,folder,added) VALUES('p','App','app',0);");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id) VALUES('r','github','ghe.example','Group/sub','repo','p');");
  const pr = { url: "https://ghe.example/Group/sub/repo/pull/12", state: "OPEN" };
  await seedPrFacts(tracked, [pr], 1);
  await recordPrFacts(tracked, [{ ...pr, state: "MERGED" }], 2);
  assert.equal((await db.read("SELECT text FROM since_events;"))[0].text, "PR #12 merged");
  assert.ok(reads.filter((sql) => sql.includes("FROM pr_items")).every((sql) => sql.includes("WHERE url IN")));
  assert.ok(reads.filter((sql) => sql.includes("FROM since_observed")).every((sql) => sql.includes("WHERE source IN")));
});

test("the return signature changes with event facts and project assignment", () => {
  const agent = { address: "t1", status: "working", space: "s" };
  const term = { address: "t1", turn: 1, created_ms: 1 };
  const space = { id: "s", folder: "C:\\work" };
  const signature = (a = agent, t = term, s = space, seen = new Map(), assigned = new Map()) => returnSignature([a], [t], [s], [], seen, assigned);
  const before = signature();
  assert.equal(signature({ ...agent }, { ...term }, { ...space }), before);
  for (const next of [signature({ ...agent, status: "done" }), signature(agent, { ...term, turn: 2 }), signature(agent, term, { ...space, machine: "remote" }),
    signature(agent, term, space, new Map([["t1", { conversation: "c1" }]])), signature(agent, term, space, new Map(), new Map([["t1:1", { project: "other" }]])),
    signature(agent, { ...term, labels: { "kanso.name": "Kylo-ren" } }, space)]) assert.notEqual(next, before);
});

test("unchanged return polling skips snapshots and sleeping projects never read the log", async () => {
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"]);
  const view = new SinceLeft(null), calls = [];
  view.store = { async observe(rows) { if (rows.length) calls.push("observe"); }, async prune() { calls.push("prune"); }, async touchSources() { calls.push("heartbeat"); } };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { agents: () => [], terminals: () => [], focused: () => null, shared: () => null, machines: () => [], home: () => "" });
  const spaces = new Spaces();
  spaces.panel = { agents: new Map() };
  const updates = [];
  spaces.sinceLeft = { update(args) { updates.push(args); return view.update(args, cx); } };
  spaces.trackReturn([], [], false, 1, cx);
  await new Promise((resolve) => setImmediate(resolve));
  spaces.trackReturn([], [], false, MAINTENANCE_MS * 3, cx);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(clone(updates[0].snapshots), []);
  assert.equal(updates[1].snapshots, undefined);
  assert.deepEqual(calls, []);
  await view.update({ project: null, snapshots: [snapshot("working")], now: 1 }, cx);
  await view.update({ project: null, now: MAINTENANCE_MS + 1 }, cx);
  assert.deepEqual(calls, ["observe", "heartbeat", "prune"]);
});

test("each kind of event says its outcome in words beside the name", () => {
  const outcome = (kind, text = "Cassian") => eventLabel({ kind, text }).outcome;
  assert.deepEqual(["finished", "blocked", "error"].map((kind) => outcome(kind)), ["Finished", "Needs you", "Failed"]);
  assert.deepEqual(eventLabel({ kind: "pr", text: "PR #12 changes requested" }), { name: "PR #12", outcome: "Changes requested" });
  assert.equal(outcome("unknown"), null);
});

test("what the agent did is one line, capped, and absent when it said nothing", () => {
  assert.equal(oneLine("\n  Ran the tests\n\nthen pushed"), "Ran the tests");
  assert.equal(oneLine("a   b\tc"), "a b c");
  for (const empty of [null, undefined, "", "  \n "]) assert.equal(oneLine(empty), null);
  const long = oneLine("x".repeat(DID_CAP * 2));
  assert.equal(long.length, DID_CAP);
  assert.ok(long.endsWith("\u2026"));
  const rows = present([{ id: 1, target: "agent:a", kind: "finished", text: "Cassian", at: 0 }], { now: 0, format: String }).rows;
  assert.equal(rows[0].did, null);
});

test("what the agent did is kept with the event and outlives the agent's next step", async (t) => {
  const { db, store } = await database(t);
  const term = (msg, status) => agentSnapshot({ address: "t1", status, title: "Cassian" }, { conversation: "c1" }, { report: { msg } }, project);
  await store.observe([term("Running the suite", "working")], 1);
  await store.observe([term("Fixed the away rows\nand tests", "done")], 2);
  await store.observe([term("Reading the next brief", "working")], 3);
  const [row] = await db.read("SELECT kind,text,did FROM since_events;");
  assert.deepEqual(clone(row), { kind: "finished", text: "Cassian", did: "Fixed the away rows" });
  const shown = present(await db.read("SELECT * FROM since_events;"), { now: 4, format: String });
  assert.deepEqual([shown.rows[0].name, shown.rows[0].outcome, shown.rows[0].did], ["Cassian", "Finished", "Fixed the away rows"]);
});

test("While you were away is a piece: off, nothing is recorded, read or drawn", async (t) => {
  assert.equal(awayShown(undefined), true);
  assert.equal(awayShown({ "sidebar.activity": "hide" }), true);
  assert.equal(awayShown({ [AWAY_PIECE]: "hide" }), false);
  const { cx } = context();
  const reads = [], runs = [];
  const db = { read: async (sql) => { reads.push(sql); return []; }, run: async (sql) => { runs.push(sql); } };
  const hidden = { "kanso.pieces.migrated": true, "kanso.pieces": { [AWAY_PIECE]: "hide" } };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { shared: (key) => hidden[key], setShared: (key, value) => { hidden[key] = value; } });
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"]);
  const view = new Spaces();
  Object.assign(view, { showAway: false, returnSignature: "x", sinceLeft: Object.assign(new SinceLeft(db), { project: project, rows: [event(1)] }) });
  view.trackReturn([], [], true, 10, cx);
  assert.deepEqual([reads, runs], [[], []]);
  assert.equal(view.returnSignature, null);
  assert.deepEqual(clone([view.sinceLeft.project, view.sinceLeft.rows]), [null, []]);
  assert.equal(view.returnRows({}, { folder: "C:\\work\\kanso" }).length, 0);
});

test("a row says who, what happened and what it did; a gone agent's row stays but leads nowhere", async () => {
  const ui = tape();
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], ui.host);
  const { agentRowH } = await load("kanso-spaces/agents.js", ["agentRowH"], ui.host);
  const view = Object.assign(new SinceLeft(null), { project, rows: [
    { id: 1, target: "agent:c1", kind: "finished", text: "Cassian", did: "Fixed the away rows", at: 0 },
    { id: 2, target: "agent:gone", kind: "error", text: "Bodhi", did: null, at: 0 },
  ] });
  const marked = [], went = [];
  view.render({ foreground: "#fff" }, project, (key) => { marked.push(key); return false; }, (row) => (row.target === "agent:c1" ? () => went.push(row.id) : null));
  for (const text of ["Cassian", "Finished", "Fixed the away rows", "Bodhi", "Failed"]) assert.ok(ui.texts.includes(text), text);
  assert.deepEqual(marked, ["since-1"]);
  assert.equal(ui.handlers.has("since-2"), false);
  ui.handlers.get("since-1")({}, { notify() {} });
  assert.deepEqual(went, [1]);
  assert.equal(view.blockHeight(), agentRowH({}, { activity: "x" }) + agentRowH({}, {}) + 1);
});

test("with While you were away off, a pull request read records no fact", async (t) => {
  const { db } = await database(t);
  await db.run("INSERT INTO projects(id,name,folder,machine,added) VALUES('p1','App','C:\\work\\app','',0);");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id) VALUES('r1','github','github.com','o','r','p1');");
  const observed = async (hidden) => {
    const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
      exec, shared: (key) => (key === "kanso.pieces" ? Object.fromEntries(hidden.map((id) => [id, "hide"])) : null),
    });
    await new PullRequest(db).keepPrFacts([{ url: "https://github.com/o/r/pull/4", number: 4, state: "OPEN" }]);
    return (await db.read("SELECT COUNT(*) AS n FROM since_observed;"))[0].n;
  };
  assert.equal(await observed([AWAY_PIECE]), 0);
  assert.equal(await observed([]), 1);
});
