import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exec, load, temporary } from "./helpers.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

const model = await load("kanso-strip/clock-model.js", [
  "nextRuns", "lastDue", "waiterPlan", "outcomesOf", "clockName", "resumeWaiter", "agentLaunch",
]);
const { resumesToArm } = await load("kanso-strip/clock.js", ["resumesToArm"], {
  window: () => ({ platform: "macos" }),
  appHome: () => "/tmp/kanso-test",
  hc: async () => ({ code: 0, stdout: "", stderr: "" }),
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
});

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

test("A daily schedule keeps its time and weekdays after its planned runs, and a one-time schedule does not", () => {
  const options = { now, since: now };
  const daily = model.waiterPlan({ kind: "daily", time: "9:05", days: [1, 2, 3] }, options);
  const once = model.waiterPlan({ kind: "once", at: now + 60_000 }, options);
  assert.equal(daily.tail, "0905 123");
  assert.equal(Object.hasOwn(once, "tail"), false);
});

test("The last successful run and the last try are kept apart, and a failure is recorded only when the last try failed", () => {
  const rows = (ok) => [{ schedule: "s1", id: 1, at: 100_000, ok: 1, why: null }, { schedule: "s1", id: 2, at: 200_000, ok: 0, why: "worktree missing" }, { schedule: "s1", id: 3, at: 300_000, ok, why: ok ? null : "boom" }];
  assert.deepEqual(plain(model.outcomesOf(rows(1)).get("s1")), { lastRun: 300_000, lastTry: 300_000, failed: null });
  assert.deepEqual(plain(model.outcomesOf(rows(0)).get("s1")), { lastRun: 100_000, lastTry: 300_000, failed: { at: 300_000, why: "boom" } });
});

test("A clock name stays short, and two long addresses do not share one", () => {
  const short = model.clockName("resume", "t7");
  const one = model.clockName("resume", `${"machine".repeat(8)}/t1`);
  const two = model.clockName("resume", `${"machine".repeat(8)}/t2`);
  assert.ok(short.length <= 32 && one.length <= 32 && two.length <= 32);
  assert.notEqual(one, two);
});

const clearLimit = "label t9 kanso.limit= kanso.limit.resume= kanso.limit.cmd=";
const resumeTarget = "get t9 --json";
const continueAgent = "send t9 continue";
const unixOnly = { skip: process.platform === "win32" };

const resumeCalls = async (t, state) => {
  const dir = await temporary(t);
  const log = join(dir, `${state}.log`);
  await writeFile(join(dir, "hc"), `#!/bin/sh
if [ "$1" = get ] && [ ! -s "$LOG" ]; then printf '%s\\n' "$GET"; fi
printf '%s\\n' "$*" >> "$LOG"
`, { mode: 0o755 });
  await writeFile(join(dir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const until = Date.now() - 120_000;
  const token = "TOKEN";
  const argv = model.resumeWaiter({ platform: "macos", address: "t9", until, token });
  assert.equal(argv[4], String(Math.floor(until / 1000)));
  const result = await exec(argv[0], argv.slice(1), {
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
      LOG: log,
      GET: JSON.stringify({ labels: { "kanso.limit.resume": token }, status: { state } }),
    },
    limit: 8000,
  });
  assert.equal(result.code, 0, result.stderr);
  return (await readFile(log, "utf8")).trimEnd().split("\n");
};

test("The resume clock sends continue and clears the limit when the agent is done, and clears without sending when it is working", unixOnly, async (t) => {
  const done = await resumeCalls(t, "done");
  assert.deepEqual(done, [resumeTarget, continueAgent, clearLimit]);
  const working = await resumeCalls(t, "working");
  assert.deepEqual(working, [resumeTarget, clearLimit]);
});

test("The resume clock sends continue once and clears all three limit labels when the agent is blocked", unixOnly, async (t) => {
  const blocked = await resumeCalls(t, "blocked");
  assert.deepEqual(blocked, [resumeTarget, continueAgent, clearLimit]);
});

test("A Windows launch keeps a prompt that has more than one line", () => {
  assert.ok(Array.isArray(model.agentLaunch("windows", ["codex"], "a\nb")));
});

test("A restart before the reset re-arms an agent whose resume is still ours, a waiter with no command stays, that waiter is re-armed once the command is known, a typed resume is left, and a different resume token does nothing", () => {
  const until = "5000";
  const words = ["claude", "--resume", "abc"];
  const cmd = JSON.stringify(words);
  const agent = (labels) => ({ address: "t9", state: "live", labels });
  const ours = { "kanso.limit": until, "kanso.limit.resume": until };
  const waiter = (kind) => ({ address: "w1", name: model.clockName("resume", "t9"), state: "live", labels: { "kanso.clock": kind } });
  const arms = (terms) => plain(resumesToArm(terms));
  assert.deepEqual(arms([agent({ ...ours, "kanso.limit.cmd": cmd })]), [{ address: "t9", until: 5000, command: words }]);
  assert.deepEqual(arms([agent(ours), waiter("resume")]), []);
  assert.deepEqual(arms([agent({ ...ours, "kanso.limit.cmd": cmd }), waiter("resume")]), [{ address: "t9", until: 5000, command: words }]);
  assert.deepEqual(arms([agent({ ...ours, "kanso.limit.cmd": cmd }), waiter("resume-typed")]), []);
  assert.deepEqual(arms([agent({ "kanso.limit": until, "kanso.limit.resume": "1", "kanso.limit.cmd": cmd })]), []);
});
