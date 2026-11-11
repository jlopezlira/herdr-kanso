// Budgets count production paths through their first loading draw.
import test from "node:test";
import assert from "node:assert/strict";
import { temporary } from "./helpers.mjs";
import { fixture, firstDraw, PANEL_IDS, loadMod } from "./perf-harness.mjs";

for (const id of [...PANEL_IDS, "spaces", "tabs", "strip"]) {
  test(`${id} opens and switches projects within the first-draw budget`, async (t) => {
    const result = await firstDraw(id);
    for (const [path, row] of [["open", result.open], ["switch", result.switchProject]]) {
      assert.ok(row.processes <= 3, `${id} ${path} started ${row.processes} processes before first draw; budget 3`);
      assert.ok(row.ms < 100, `${id} ${path} took ${row.ms.toFixed(2)} ms before first draw; budget 100 ms`);
    }
    t.diagnostic(JSON.stringify(result));
  });
}

for (const quiet of ["sleeping", "off"]) {
  test(`${quiet} projects start zero background processes or file reads`, async () => {
    const f = fixture({ quiet });
    const { Spaces } = await loadMod("kanso-spaces/main.js", ["Spaces"], f.host);
    const view = Object.assign(new Spaces(), { threads: Object.fromEntries(f.list.map((a, i) => [a.address, { pid: 200 + i, file: `/session-${i}.jsonl` }])), tasks: {}, git: {}, at: {}, ready: {}, busy: {}, checked: {}, unsure: new Set(), folded: new Set() });
    const places = new Map(f.projects.map((p) => [p.id, { on: p.machine ?? null, cwd: p.folder, key: JSON.stringify([p.machine ?? null, p.folder]) }]));
    for (const now of [0, 5000, 30_000, 60_000]) {
      f.state.now = 1_000_000 + now;
      view.checkTasks(f.cx);
      view.checkAlive(f.cx);
      view.refreshThreads(f.cx);
      const due = view.due(f.state.now, f.host.spaces(), f.ps, places, true);
      assert.equal(due.size, 0, `${quiet} project scheduled ${due.size} git reads; budget 0`);
    }
    await f.settle();
    assert.equal(f.state.processes.length, 0, `${quiet} project started ${f.state.processes.length} processes; budget 0`);
    assert.equal(f.state.reads.length, 0, `${quiet} project read ${f.state.reads.length} files; budget 0`);
    assert.equal(f.state.timers.length, 0, `${quiet} project scheduled ${f.state.timers.length} timers; budget 0`);
  });
}

for (const [working, budget] of [[2, 15], [0, 3]]) test(`sidebar at rest with 10 agents, ${working} working, in 4 projects starts at most ${budget} processes per minute`, async (t) => {
  const dir = await temporary(t), f = fixture({ dir, working });
  const { Kdb } = await loadMod("kanso-spaces/kdb.js", ["Kdb"], f.host);
  f.host.Kdb = Kdb;
  const db = new Kdb();
  await db.open();
  await db.migrate();
  const { Spaces } = await loadMod("kanso-spaces/main.js", ["Spaces"], f.host);
  const view = new Spaces();
  f.state.draw = () => view.render();
  view.init({}, f.cx);
  view.render();
  await f.settle();
  await f.advance(60_000);
  assert.equal(Object.keys(view.threads ?? {}).length, 10, "rest fixture must locate all 10 transcripts during warm-up");
  for (const term of f.terms) assert.equal(view.threads[term.address]?.pid, term.foreground.pid, `${term.address} must retain its located transcript before the rest measurement`);
  f.state.processes.length = 0;
  f.state.reads.length = 0;
  await f.advance(60_000);
  t.diagnostic(JSON.stringify({ working, processes: f.state.processes.length, commands: f.state.processes.reduce((out, p) => ({ ...out, [p.command]: (out[p.command] ?? 0) + 1 }), {}), shells: f.state.processes.filter((p) => p.command === "sh").reduce((out, p) => {
    const kind = p.args[1].startsWith('pid="$1"') ? "transcript discovery" : p.args[1].startsWith("for d;") ? "project folders" : p.args[1].startsWith("printf") ? "home" : "other";
    return { ...out, [kind]: (out[kind] ?? 0) + 1 };
  }, {}), files: f.state.reads.length }));
  assert.equal(f.state.timers.filter((timer) => timer.every && timer.ms === 1000).length, 0, "sleep kick registered a separate 1-second timer; budget 0");
  const sqlite = f.state.processes.filter((p) => p.command === "sqlite3").length;
  const sizes = f.state.processes.filter((p) => p.command === "wc").length;
  assert.equal(sizes, 0, `sidebar at rest (${working} working) started ${sizes} transcript size checks per minute; budget 0`);
  if (working === 0) assert.ok(sqlite <= 2, `sidebar idle database timers started ${sqlite} sqlite3 processes per minute; budget 2`);
  if (working === 0) {
    const ps = f.state.processes.filter((p) => p.command === "ps").length;
    assert.equal(ps, 0, `sidebar idle liveness started ${ps} ps processes per minute; budget 0`);
  }
  assert.ok(f.state.processes.length <= budget, `sidebar at rest (${working} working) started ${f.state.processes.length} processes per minute; budget ${budget}`);
});
