// Return-digest maintenance touches the active project and prunes in one database call.
import test from "node:test";
import assert from "node:assert/strict";
import { load, temporary, exec, clone } from "./helpers.mjs";

test("since-left touches and prunes in one process at the two-minute maintenance boundary", async (t) => {
  const dir = await temporary(t), calls = [];
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { appHome: () => dir, exec: (cmd, args) => { calls.push(cmd); return exec(cmd, args); } });
  const db = new Kdb();
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"]);
  const view = new SinceLeft(db);
  await view.update({ project: "A", target: null, snapshots: [], now: 1 }, { notify() {} });
  calls.length = 0;
  for (const now of [30_001, 60_001, 90_001]) await view.update({ project: "A", target: null, now }, { notify() {} });
  assert.equal(calls.length, 0, "unchanged return state schedules no database work before its fallback");
  await view.update({ project: "A", target: null, now: 120_001 }, { notify() {} });
  assert.equal(calls.length, 1, `since-left maintenance started ${calls.length} processes; budget 1`);
  assert.equal(view.pruned, 120_001);
  assert.deepEqual(clone(await db.read("SELECT focused_at FROM since_focus WHERE project='A';")), [{ focused_at: 120_001 }]);
});
