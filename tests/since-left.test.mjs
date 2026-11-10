import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { load, clone, temporary, exec, singleUse } from "./helpers.mjs";
import { AWAY_MS, KEEP_MS, EVENT_CAP, changes, digest, lines, focusedTarget, agentSnapshot, observedAgents } from "../kanso/mods/kanso-spaces/since-left-model.js";

const project = ":C:\\work\\kanso";
const event = (id, kind = "finished", at = id) => ({ id, project, target: `agent:${id}`, kind, text: `Agent ${id}`, at });
const snapshot = (status, name = "Padme") => ({ source: "agent:c1", project, value: { type: "agent", status, name, target: "agent:c1" } });
const cx = { notify() {} };

async function database(t) {
  const dir = await temporary(t);
  const { Kdb, rowsOfOutput } = await load("kanso-spaces/kdb.js", ["Kdb", "rowsOfOutput"], { exec, appHome: () => dir });
  const { SinceStore } = await load("kanso-spaces/since-left-store.js", ["SinceStore"], { exec, appHome: () => dir });
  const db = new Kdb(join(dir, "data"));
  await db.open();
  return { db, store: new SinceStore(db), rowsOfOutput };
}

const saveEvents = (db, events) => db.run(events.map((row) => `INSERT INTO since_events(id,project,target,kind,text,at) VALUES(${row.id},'${project}','${row.target}','${row.kind}','${row.text}',${row.at});`));

test("return events put blocked, errors, PRs, and finishes first, newest within each priority", () => {
  const events = [event(1), event(3, "pr"), event(2, "blocked"), event(4, "error"), event(5, "blocked"), event(6, "sleep_failed"), event(7, "sleep_finished")];
  const rows = digest(events, { focused_at: 0 }, AWAY_MS);
  assert.deepEqual(rows.map((row) => row.id), [5, 2, 6, 4, 3, 7, 1]);
  assert.deepEqual(events.map((row) => row.id), [1, 3, 2, 4, 5, 6, 7]);
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
    assert.equal(changes(base, { ...base, status })[0].kind, kind);
  }
  assert.deepEqual(changes({ ...base, status: "done" }, { ...base, status: "idle" }), []);
  assert.deepEqual(changes({ ...base, status: "idle" }, { ...base, status: "done" }), []);
  assert.deepEqual(changes(base, base), []);
  const agent = { address: "t1", status: "blocked", title: "Padme" };
  const first = agentSnapshot(agent, null, { created_ms: 1, status: "error" }, project);
  assert.equal(first.value.status, "error");
  assert.notEqual(first.source, agentSnapshot(agent, null, { created_ms: 2 }, project).source);
  assert.equal(agentSnapshot(agent, { conversation: "c1", name: "Luke" }, {}, project).value.name, "Luke");
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
  await store.observe([snapshot("working")], 300, true);
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

test("sleep completion and failure log only a transition held by its owner", async (t) => {
  const { db } = await database(t);
  await db.run(`INSERT INTO sleeps(id,name,project,layout,saved,pending,state) VALUES('s1','Padme','${project}','{}',0,'owner','sleeping');`);
  assert.equal(await db.setWorkState("s1", "other", "sleeping", "stuck", "failed", 10), false);
  assert.equal(await db.setWorkState("s1", "owner", "sleeping", "stuck", "failed", 11), true);
  assert.equal(await db.setWorkState("s1", "owner", "sleeping", "stuck", "failed", 12), false);
  await db.run("UPDATE sleeps SET state='sleeping',pending='owner' WHERE id='s1';");
  assert.equal(await db.finishSleep("s1", "other", null, 13), false);
  assert.equal(await db.finishSleep("s1", "owner", null, 14), true);
  assert.deepEqual(clone(await db.read("SELECT kind, target FROM since_events ORDER BY id;")), [
    { kind: "sleep_failed", target: "sleep:s1" }, { kind: "sleep_finished", target: "sleep:s1" },
  ]);
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
  view.render({}, project, register, () => true);
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
  assert.equal(changes(before, { ...before, turn: 2 })[0].kind, "finished");
  assert.deepEqual(changes(before, { ...before, name: "Luke" }), []);
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

test("return targets focus an agent, open an explicit PR panel, or show the sleep control", async () => {
  const calls = [], commits = [], overlays = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    panes: () => [], spaces: () => [], agents: () => [{ address: "t1", title: "Padme" }], terminals: () => [{ address: "t1", labels: { "kanso.id": "stable" } }],
    run: (...args) => calls.push(clone(args)), commitLayout: (patch) => commits.push(clone(patch)), openOverlay: (overlay) => overlays.push(clone(overlay)),
  });
  const view = new Spaces();
  view.jumpReturn({ target: "agent:stable" });
  assert.deepEqual(calls, [["agent.focus", { terminal: "t1" }]]);
  assert.equal(view.jumpReturn({ target: "agent:gone" }), false);
  view.jumpReturn({ target: "pr:https://ghe.example/o/r/pull/2" });
  assert.equal(commits[0].panel.content.props.url, "https://ghe.example/o/r/pull/2");
  view.jumpReturn({ target: "sleep:s1" });
  assert.equal(overlays[0].props.wake.id, "s1");
});

test("a first detailed PR read compares against the inbox cache, including a merged PR", async (t) => {
  const { db } = await database(t);
  await db.run("INSERT INTO projects(id,name,folder,machine,added) VALUES('p1','App','C:\\work\\app','',0);");
  await db.run("INSERT INTO pr_repos(id,provider,host,owner,name,project_id) VALUES('r1','github','github.com','o','r','p1');");
  await db.run("INSERT INTO pr_items(url,provider,host,owner,name,number,title,state,review_decision,role,fetched_at) VALUES('https://github.com/o/r/pull/4','github','github.com','o','r',4,'Fix','OPEN','REVIEW_REQUIRED','author',1);");
  const { recordPrFacts } = await load("kanso-panel/pr-inbox.js", ["recordPrFacts"]);
  await recordPrFacts(db, [{ url: "https://github.com/o/r/pull/4", number: 4, state: "MERGED" }], 2);
  assert.equal((await db.read("SELECT text FROM since_events;"))[0].text, "PR #4 merged");
  await recordPrFacts(db, [], 3, true);
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
