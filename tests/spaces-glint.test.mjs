import test from "node:test";
import assert from "node:assert/strict";
import { clone, openedKdb, temporary } from "./helpers.mjs";
import { element, fixture, initialised, loadMod, sidebarOn } from "./perf-harness.mjs";

const LEAD = 80;

async function sidebar(t, working = 0) {
  const f = fixture({ dir: await temporary(t), working });
  const motion = [];
  f.host.div = () => {
    let id, left;
    return element({
      id: (value) => { id = value; },
      left: (value) => { left = value; },
      loop: (property) => { if (property === "left") motion.push({ loop: true }); },
      transition: (property) => { if (property === "left" && id?.includes("-sweep-")) motion.push({ id, left }); },
    });
  };
  const mount = async () => initialised(f, await sidebarOn(f), {}, f.cx);
  const draw = (view) => {
    motion.length = 0;
    view.parts.rows();
    return [...motion];
  };
  return { f, mount, draw };
}

const setWorking = (f, index) => {
  for (const rows of [f.list, f.terms, f.ps]) rows[index] = { ...rows[index], status: "working" };
};
const work = async (f, index = 0) => {
  setWorking(f, index);
  await f.advance(500);
};
const mountWorking = async (f, mount) => {
  const view = await mount();
  await f.advance(6000);
  await work(f);
  return view;
};

test("The Projects row starts at rest, sweeps 80 ms later and stops without polling for expiry", async (t) => {
  const { f, mount, draw } = await sidebar(t);
  const { GLINT, GLINT_MS } = await loadMod("kanso-spaces/ui.js", ["GLINT", "GLINT_MS"], f.host);
  const duration = GLINT_MS / 2, span = LEAD + duration + LEAD;
  const view = await mountWorking(f, mount);
  const started = f.state.now;
  const deadlines = () => f.state.timers.filter(({ every, ms, next }) => !every && Number.isFinite(next) && [LEAD, span - LEAD].includes(ms))
    .map(({ next }) => next - started);
  const left = () => draw(view).find(({ id }) => id?.endsWith("-sweep-0"))?.left;

  view.paint();
  assert.deepEqual(deadlines(), [LEAD], "one timer wakes the row at +80 ms, even after a repeat paint");
  assert.equal(left(), -GLINT.wide, "the first paint puts the window at the start");
  const revision = () => view.parts.rows.view.look.at;
  const startRevision = revision();
  await f.advance(LEAD - 1);
  assert.equal(revision(), startRevision);
  await f.advance(1);
  assert.ok(revision() > startRevision, "the boundary timer invalidates the rows at +80 ms");
  assert.equal(left(), GLINT.run, "the new target starts the sweep");
  assert.deepEqual(deadlines(), [span], "one more timer wakes the row at expiry");
  await f.advance(span - LEAD - 1);
  assert.equal(left(), GLINT.run);
  const runRevision = revision();
  await f.advance(1);
  assert.ok(revision() > runRevision, "expiry invalidates the rows at the exact boundary");
  assert.deepEqual(draw(view), [], "the name no longer sweeps");
  assert.deepEqual(deadlines(), [], "the sweep leaves no timer behind");
});

test("Threads shows the startup sweep for the same newly working agent as Projects", async (t) => {
  const { f, mount, draw } = await sidebar(t);
  const view = await mount();
  await f.advance(6000);
  assert.ok(view.threads?.t0, "the sidebar found the agent's conversation");
  await work(f);
  assert.equal(draw(view).length, 6, "Projects has one glint");
  view.setView("threads", f.cx);
  await f.settle();
  view.paint();
  assert.equal(draw(view).length, 6, "Threads also has one glint");
});

test("An agent first listed as working gets a startup sweep", async (t) => {
  const { f, mount, draw } = await sidebar(t);
  const rows = [f.list, f.terms, f.ps];
  const index = 4;
  const arriving = rows.map((list) => list.splice(index, 1)[0]);
  const view = await mount();
  await f.advance(6000);
  rows.forEach((list, i) => list.splice(index, 0, arriving[i]));
  await work(f, index);
  assert.equal(draw(view).length, 6, "an arrival sweeps even without a stored start time");
});

test("Reopening the sidebar does not sweep for an agent remembered as working", async (t) => {
  const { f, mount, draw } = await sidebar(t, 1);
  f.host.localStorage.setItem("spaces.since", JSON.stringify({ t0: { s: "working", at: f.state.now } }));
  const view = await mount();
  await f.advance(500);
  assert.deepEqual(draw(view), [], "the stored working state does not replay a glint");
});

const t0Stage = (view) => new Map(JSON.parse(view.rowsShown()).sweeps).get("t0") ?? null;

const withPrefsHeld = async (f, check) => {
  const prefs = Promise.withResolvers();
  const exec = f.host.exec;
  let prefsRead = false;
  f.host.exec = async (command, args, options) => {
    const result = await exec(command, args, options);
    if (command === "sqlite3" && args.includes("SELECT key, value FROM prefs;")) {
      prefsRead = true;
      await prefs.promise;
    }
    return result;
  };

  try {
    return await check((view) => assert.ok(prefsRead && !view.panelReady, "the SQLite response is still withheld"));
  } finally {
    prefs.resolve();
    f.host.exec = exec;
    await f.settle();
  }
};

test("An already-working agent does not glint while its saved SQLite state loads", async (t) => {
  const { f, mount, draw } = await sidebar(t, 1);
  const key = "spaces.since", at = f.terms[0].status_ms;
  const { Kdb } = await loadMod("kanso-spaces/kdb.js", ["Kdb"], f.host);
  const db = await openedKdb(Kdb);
  await db.setPref(key, JSON.stringify({ t0: { s: "working", at } }));
  assert.equal(f.host.localStorage.getItem(key), null, "the saved state exists only in SQLite");

  const glint = (view) => ({
    stage: t0Stage(view),
    transitions: draw(view).filter(({ id }) => id?.startsWith("space-agent-t0-name-sweep-")).length,
  });
  const { view, initial, pending } = await withPrefsHeld(f, async (assertPending) => {
    const view = await mount();
    const initial = glint(view);
    await f.advance(500);
    assert.equal(view.trackedAt, f.state.now, "the first tracking tick ran");
    assertPending(view);
    return { view, initial, pending: glint(view) };
  });
  assert.ok(view.panelReady, "the preferences loaded");
  assert.equal(view.since.t0.at, at, "the saved working timestamp came from SQLite");
  const restored = glint(view);
  await f.advance(LEAD);
  const rest = { stage: null, transitions: 0 };
  assert.deepEqual({ initial, pending, restored, later: glint(view) }, {
    initial: rest, pending: rest, restored: rest, later: rest,
  }, "the t0 row stays at rest before and after the SQLite restore");
});

test("An agent that starts working while SQLite preferences load still sweeps", async (t) => {
  const { f, mount } = await sidebar(t);
  await withPrefsHeld(f, async (assertPending) => {
    const view = await mount();
    await f.advance(500);
    assertPending(view);
    assert.equal(view.since.t0.s, "rest", "the first tracking tick records t0 at rest");

    setWorking(f, 0);
    await f.advance(2000);
    assertPending(view);
    assert.equal(view.since.t0.s, "working", "the sidebar observed t0 start working");
    assert.equal(view.since.t0.at, f.state.now, "the latest tracking tick recorded the edge");
    assert.equal(t0Stage(view), "start", "t0 starts its sweep before the preferences load");
  });
});

test("The newcomers flag controls first-seen agents without suppressing observed starts", async () => {
  const { sweepBegan } = await loadMod("kanso-spaces/agents.js", ["sweepBegan"]);
  const now = 1000;
  const working = { s: "working", at: 0 };
  const since = { resumed: { s: "rest", at: 0 }, alreadyWorking: working };
  const next = { ...since, resumed: working, newcomer: working };
  const started = (newcomers) => clone(sweepBegan(since, next, now, {}, newcomers));
  assert.deepEqual(started(false), { resumed: now });
  assert.deepEqual(started(true), { resumed: now, newcomer: now });
});

test("Painting the sidebar during a glint reads only one row snapshot", async (t) => {
  const { f, mount } = await sidebar(t);
  const reads = { spaces: 0, panes: 0, terminals: 0, agents: 0, machines: 0, focused: 0 };
  for (const name of Object.keys(reads)) {
    const read = f.host[name];
    f.host[name] = () => { reads[name] += 1; return read(); };
  }
  const view = await mountWorking(f, mount);
  for (const name of Object.keys(reads)) reads[name] = 0;
  view.paint();
  assert.deepEqual(reads, { spaces: 2, panes: 1, terminals: 3, agents: 1, machines: 1, focused: 1 }, "sweep scheduling adds no host reads to a paint");
});
