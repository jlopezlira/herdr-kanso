import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exec, stdoutOf, git, load, committedRepo, plain, success, temporary } from "./helpers.mjs";

const now = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();

const schedulesFile = "kanso-spaces/schedules.js";
const schedules = await load(schedulesFile, ["clockTodo", "scheduleOf", "spaceOf", "placeOfKey", "scheduleName", "SPACE_LABEL", "REV_LABEL", "SCHEDULE_KIND"]);
const dialog = await load("kanso-spaces/schedule-dialog.js", ["draftOf", "checkDraft", "whenOfDraft"]);
const clock = await load("kanso-spaces/clock-model.js", ["scheduleWaiter", "waiterPlan", "agentLaunch"]);
const { ADD_WORKTREE } = await load("kanso-spaces/platform-repositories.js", ["ADD_WORKTREE"]);

const unixOnly = { skip: process.platform === "win32" };
const withStubs = (bin, env) => ({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, ...env });
const writeStub = (bin, name, script) => writeFile(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
const logCall = `printf '%s\\n' "$*" >> "$LOG"`;
const runSchedule = (job, bin, env) => {
  const [command, ...args] = clock.scheduleWaiter(job);
  return exec(command, args, { env: withStubs(bin, env), limit: 8000 });
};

const assertPowerShell = (argv) => {
  assert.equal(argv[0], "powershell.exe");
  const command = argv.indexOf("-Command");
  assert.ok(command > 0);
  assert.ok(argv[command + 1]?.trim());
};

const draft = (patch = {}) => ({
  agent: "claude", prompt: "Triage the failures", kind: "daily", time: "09:00", days: [5, 1, 3], every: "15", unit: "minutes", at: "2026-11-23 09:00", tree: false, ...patch,
});

test("A time of day, an interval and a one-time schedule are valid, and a missing agent, an empty prompt, a bad time, no day, a fraction or a past date is not", () => {
  const daily = dialog.checkDraft(draft(), now);
  assert.deepEqual(plain(daily.when), { kind: "daily", time: "09:00", days: [1, 3, 5] });
  const minutes = dialog.checkDraft(draft({ kind: "every", every: "15", unit: "minutes" }), now);
  assert.deepEqual(plain(minutes.when), { kind: "every", every: 15, unit: "minutes", start: now });
  const hours = dialog.checkDraft(draft({ kind: "every", every: "2", unit: "hours" }), now);
  assert.deepEqual(plain(hours.when), { kind: "every", every: 2, unit: "hours", start: now });
  const once = dialog.checkDraft(draft({ kind: "once" }), now);
  assert.equal(once.when.kind, "once");
  assert.ok(once.when.at > now);
  assert.equal(dialog.checkDraft(draft({ agent: null }), now).error, "Pick an agent.");
  assert.equal(dialog.checkDraft(draft({ prompt: "  " }), now).error, "Write what the agent is asked.");
  assert.equal(dialog.whenOfDraft(draft({ time: "25:00" }), now).error, "Write the time as 09:00.");
  assert.equal(dialog.whenOfDraft(draft({ days: [] }), now).error, "Pick at least one day.");
  assert.equal(dialog.whenOfDraft(draft({ kind: "every", every: "1.5" }), now).error, "Every how many? Write a whole number.");
  assert.equal(dialog.whenOfDraft(draft({ kind: "once", at: "2020-01-01 09:00" }), now).error, "Write a later date and time, as 2026-11-23 09:00.");
  for (const when of [daily.when, minutes.when, hours.when, { kind: "once", at: once.when.at }]) {
    const again = dialog.checkDraft(dialog.draftOf({ agent: "claude", prompt: "Triage the failures", when, tree: true }, now), now);
    assert.equal(again.error, undefined);
    assert.equal(again.when.kind, when.kind);
  }
});

test("A schedule is armed when it has no waiter or its space or revision differs, a matching one is left, and a paused or deleted one is stopped", () => {
  const row = { id: "s1", project: ":/work", agent: "claude", agent_name: "Claude", run: "[\"claude\"]", prompt: "Triage the failures", when_json: "{\"kind\":\"daily\",\"time\":\"09:00\",\"days\":[1,2,3,4,5]}", tree: 0, base: "main", paused: 0, created: 1, updated: 10 };
  const s = schedules.scheduleOf(row);
  assert.equal(s.agentName, "Claude");
  assert.deepEqual(plain(s.run), ["claude"]);
  assert.equal(s.paused, false);
  assert.deepEqual(plain(schedules.placeOfKey("box:/work")), { machine: "box", folder: "/work" });
  assert.deepEqual(plain(schedules.placeOfKey(":/work")), { machine: null, folder: "/work" });
  const open = [{ id: "mac/sp9", machine: null, folder: "/work" }];
  assert.equal(schedules.spaceOf(s, open, "/home"), "mac/sp9");
  assert.equal(schedules.spaceOf({ ...s, project: ":/other" }, open, "/home"), "sps1");
  const name = schedules.scheduleName(s.id);
  const live = (labels) => ({ name, state: "live", labels: { "kanso.clock": schedules.SCHEDULE_KIND, ...labels } });
  const match = live({ [schedules.SPACE_LABEL]: "sp9", [schedules.REV_LABEL]: "10" });
  const todo = (list, terms) => plain(schedules.clockTodo(list, terms, open, "/home"));
  const ids = (list, terms) => todo(list, terms).arm.map((x) => x.id);
  assert.deepEqual(ids([s], []), ["s1"]);
  assert.deepEqual(todo([s], []).stop, []);
  assert.deepEqual(todo([s], [match]), { arm: [], stop: [] });
  assert.deepEqual(todo([s], [live({ [schedules.SPACE_LABEL]: "other", [schedules.REV_LABEL]: "10" })]).arm.map((x) => x.id), ["s1"]);
  assert.deepEqual(todo([s], [live({ [schedules.SPACE_LABEL]: "sp9", [schedules.REV_LABEL]: "9" })]).arm.map((x) => x.id), ["s1"]);
  assert.deepEqual(todo([{ ...s, paused: true }], [match]), { arm: [], stop: [name] });
  assert.deepEqual(todo([], [match]), { arm: [], stop: [name] });
});

test("A missed run is caught up once, at now", () => {
  const since = new Date(2026, 5, 8, 0, 0, 0, 0).getTime();
  const plan = clock.waiterPlan({ kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] }, { now, since });
  const times = plan.spec.split(" ").map(Number);
  assert.equal(plan.mode, "at");
  assert.equal(times[0], Math.floor(now / 1000));
  assert.equal(times.filter((t) => t === times[0]).length, 1);
});

test("A failed one-time run is still listed, and the last try means it is not armed again", () => {
  const due = now - 60_000;
  const once = schedules.scheduleOf({ id: "once", project: ":/work", agent: "claude", run: "[]", prompt: "once", when_json: JSON.stringify({ kind: "once", at: due }), tree: 0, paused: 0, created: 1, updated: due - 1000 });
  const open = [{ id: "sp9", machine: null, folder: "/work" }];
  assert.deepEqual(plain(schedules.clockTodo([once], [], open, "/home")).arm.map((s) => s.id), ["once"]);
  assert.equal(clock.waiterPlan(once.when, { now, since: now - 1000 }), null);
  assert.equal(clock.waiterPlan(once.when, { now, since: once.updated }).spec.split(" ")[0], String(Math.floor(now / 1000)));
});

test("A Windows schedule builds a PowerShell waiter with a command script", () => {
  const argv = clock.scheduleWaiter({
    platform: "windows", id: "s1", db: "C:/kanso.db", mode: "at", spec: String(Math.floor(now / 1000)),
    folder: "C:/work", space: "sp9", argv: ["claude"],
  });
  assertPowerShell(argv);
});

for (const [action, title] of [
  ["armFor", "Arming a schedule on Windows starts a PowerShell waiter through hc run"],
  ["runNow", "Running a schedule now on Windows starts a PowerShell waiter through hc run"],
]) {
  test(title, async (t) => {
    const folder = "C:/work";
    const home = () => "C:/Users/test";
    const hc = t.mock.fn(async () => success(""));
    const windows = await load(schedulesFile, [action], {
      window: () => ({ platform: "windows" }),
      home,
      appHome: home,
      spaces: () => [{ id: "sp9", machine: null, folder }],
      hc,
    });
    const schedule = schedules.scheduleOf({
      id: "s1", project: `:${folder}`, agent: "claude", run: '["claude"]', prompt: "Triage the failures",
      when_json: JSON.stringify({ kind: "once", at: now + 60_000 }), updated: now,
    });
    await windows[action]({ file: "C:/kanso.db" }, schedule, { now });
    const runs = hc.mock.calls.map(({ arguments: [args] }) => args).filter(([command]) => command === "run");
    assert.equal(runs.length, 1);
    assertPowerShell(runs[0].slice(runs[0].indexOf("--") + 1));
  });
}

test("A daily schedule still runs once on its weekday after its planned runs are exhausted", unixOnly, async (t) => {
  const bin = await temporary(t);
  const log = join(bin, "hc.log");
  await writeFile(log, "");
  const start = Date.UTC(2026, 5, 10, 8, 59) / 1000;
  await Promise.all(Object.entries({
    hc: logCall,
    sqlite3: "exit 0",
    date: `if grep -q '^tick$' "$LOG"; then
  hm=0900; epoch=${start + 60}
else
  hm=0859; epoch=${start}
fi
case "$1" in
  +%H%M) echo "$hm" ;;
  +%w) echo 3 ;;
  +%Y%m%d) echo 20260610 ;;
  +%s) echo "$epoch" ;;
  *) exit 1 ;;
esac`,
    sleep: `echo tick >> "$LOG"
if [ "$(grep -c '^tick$' "$LOG")" -eq 3 ]; then kill -TERM "$PPID"; fi`,
  }).map(([name, script]) => writeStub(bin, name, script)));
  const env = { LOG: log };
  const fakeDate = (format) => stdoutOf("date", [format], { env: withStubs(bin, env) });
  const [epoch, weekday] = await Promise.all([fakeDate("+%s"), fakeDate("+%w")]);
  const next = new Date((Number(epoch) + 60) * 1000);
  const tail = `${next.toISOString().slice(11, 16).replace(":", "")} ${weekday}`;
  const result = await runSchedule({
    platform: "macos", id: "s1", db: join(bin, "kanso.db"), mode: "at", spec: "", tail,
    folder: bin, space: "sp9", argv: ["claude"],
  }, bin, env);
  const events = (await readFile(log, "utf8")).split("\n").filter(Boolean).map((line) => line.split(" ")[0]);
  assert.deepEqual(events, ["tick", "run", "tick", "tick"], result.stderr);
});

test("A scheduled run in a worktree of main records that it ran, and a start that fails records the reason once and waits for the next time", unixOnly, async (t) => {
  const { dir, repo } = await committedRepo(t);
  const bin = join(dir, "bin");
  await exec("mkdir", ["-p", bin]);
  await writeStub(bin, "hc", `${logCall}
if [ "$1" = exec ]; then shift; exec "$@"; fi
if [ "$1" = run ] && [ -n "$FAIL" ]; then printf '%s\\n' "$FAIL" >&2; exit 1; fi
exit 0`);
  const run = async (fail) => {
    const root = join(dir, fail ? "fail" : "ok");
    await exec("mkdir", ["-p", root]);
    const past = Math.floor(Date.now() / 1000) - 30;
    const calls = join(root, "hc.log");
    const db = join(root, "kanso.db");
    await exec("sqlite3", [db, "CREATE TABLE schedule_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, schedule TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, why TEXT);"]);
    const job = {
      platform: "macos", id: "s1", db, mode: "at",
      spec: fail ? `${past} ${past + 3600}` : String(past), on: "", folder: repo, space: "sp9", tree: true, from: "main",
      dir: join(root, "trees"), slug: "triage", add: ADD_WORKTREE,
      argv: clock.agentLaunch("macos", ["claude"], "Triage the failures\nName each one"),
    };
    const result = await runSchedule(job, bin, { LOG: calls, FAIL: fail ? "the agent did not start" : "" });
    const rows = await exec("sqlite3", ["-separator", "\t", db, "SELECT ok, ifnull(why, '') FROM schedule_runs;"]);
    return { code: result.code, rows: rows.stdout.trim(), calls: await readFile(calls, "utf8").catch(() => ""), stderr: result.stderr };
  };
  const ok = await run(false);
  assert.equal(ok.code, 0, ok.stderr + ok.rows);
  assert.equal(ok.rows, "1");
  const listed = await git(repo, "worktree", "list", "--porcelain");
  const made = listed.stdout.split("\n\n").map((block) => block.match(/^worktree (.*)$/m)?.[1]).find((path) => path && path !== repo);
  assert.ok(made, listed.stdout);
  assert.equal((await git(made, "rev-parse", "HEAD")).stdout.trim(), (await git(repo, "rev-parse", "main")).stdout.trim());
  const failed = await run(true);
  assert.equal(failed.code, 137, failed.stderr + failed.rows);
  assert.equal(failed.rows, "0\tthe agent did not start");
  assert.equal(failed.calls.split("\n").filter((line) => line.startsWith("run ")).length, 1);
});
