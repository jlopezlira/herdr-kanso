import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exec, load, temporary } from "./helpers.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

const model = await load("kanso-strip/clock-model.js", [
  "nextRuns", "lastDue", "waiterPlan", "parseRunLog", "lastOutcome", "clockName", "resumeWaiter",
]);

const at = (y, m, d, h, min = 0) => new Date(y, m, d, h, min, 0, 0).getTime();
const now = at(2026, 5, 10, 12);
const weekdays = { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] };

test("A weekday schedule, an interval and a one-time schedule name their next runs", () => {
  const days = model.nextRuns(weekdays, now, 3).map((ms) => new Date(ms));
  assert.deepEqual(plain(days.map((d) => d.getDay())), [4, 5, 1]);
  assert.ok(days.every((d) => d.getHours() === 9 && d.getMinutes() === 0 && d.getTime() > now));
  assert.deepEqual(plain(model.nextRuns({ kind: "every", every: 15, unit: "minutes", start: now }, now, 2)), [now + 15 * 60_000, now + 30 * 60_000]);
  assert.deepEqual(plain(model.nextRuns({ kind: "every", every: 2, unit: "hours", start: now }, now, 2)), [now + 2 * 3_600_000, now + 4 * 3_600_000]);
  const once = now + 3_600_000;
  assert.deepEqual(plain(model.nextRuns({ kind: "once", at: once }, now)), [once]);
  assert.deepEqual(plain(model.nextRuns({ kind: "once", at: now - 1 }, now)), []);
});

test("A missed schedule catches up once, now, and a schedule that already ran does not", () => {
  const since = at(2026, 5, 8, 0);
  assert.equal(model.lastDue(weekdays, since, now), at(2026, 5, 10, 9));
  const caught = model.waiterPlan(weekdays, { now, since }).spec.split(" ").map(Number);
  assert.equal(caught[0], Math.floor(now / 1000));
  assert.equal(caught.filter((t) => t === caught[0]).length, 1);
  assert.ok(caught[1] > caught[0]);
  const later = at(2026, 5, 10, 10);
  assert.equal(model.lastDue(weekdays, later, now), null);
  assert.ok(Number(model.waiterPlan(weekdays, { now, since: later }).spec.split(" ")[0]) > Math.floor(now / 1000));
  const once = { kind: "once", at: now - 60_000 };
  assert.equal(model.waiterPlan(once, { now, since: now - 1000 }), null);
});

test("A run log names the last success and a failed start", () => {
  const text = "100 ran\n200 failed worktree missing\n300 ran\n";
  assert.deepEqual(plain(model.parseRunLog(text)), [
    { at: 100_000, ok: true, why: null },
    { at: 200_000, ok: false, why: "worktree missing" },
    { at: 300_000, ok: true, why: null },
  ]);
  assert.deepEqual(plain(model.lastOutcome(text)), { lastRun: 300_000, failed: null });
  assert.deepEqual(plain(model.lastOutcome("100 ran\n200 failed boom")), { lastRun: 100_000, failed: { at: 200_000, ok: false, why: "boom" } });
});

test("A clock name stays short, and two long addresses do not share one", () => {
  const short = model.clockName("resume", "t7");
  const one = model.clockName("resume", `${"machine".repeat(8)}/t1`);
  const two = model.clockName("resume", `${"machine".repeat(8)}/t2`);
  assert.ok(short.length <= 32 && one.length <= 32 && two.length <= 32);
  assert.notEqual(one, two);
});

test("The resume clock sends continue and clears the limit when the agent is done, and clears without sending when it is working", async (t) => {
  const dir = await temporary(t);
  const hc = join(dir, "hc");
  await writeFile(hc, `#!/bin/sh
printf '%s\\n' "$*" >> "$LOG"
if [ "$1" = get ]; then printf '%s\\n' "$GET"; fi
exit 0
`);
  await chmod(hc, 0o755);
  const run = async (state) => {
    const log = join(dir, `${state}.log`);
    const argv = model.resumeWaiter({ platform: "macos", address: "t9", until: Date.now() - 120_000, token: "TOKEN" });
    const result = await exec(argv[0], argv.slice(1), {
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, LOG: log, GET: JSON.stringify({ "kanso.limit.resume": "TOKEN", state }) },
      limit: 8000,
    });
    return { code: result.code, log: await readFile(log, "utf8"), stderr: result.stderr };
  };
  const done = await run("done");
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.log, /send t9 continue/);
  assert.match(done.log, /label t9 kanso\.limit= kanso\.limit\.resume= kanso\.limit\.cmd=/);
  assert.ok(done.log.indexOf("send t9 continue") < done.log.indexOf("label t9"));
  const working = await run("working");
  assert.equal(working.code, 0, working.stderr);
  assert.doesNotMatch(working.log, /send /);
  assert.match(working.log, /label t9 kanso\.limit= kanso\.limit\.resume= kanso\.limit\.cmd=/);
});
