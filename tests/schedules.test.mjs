import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exec, load, temporary } from "./helpers.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const now = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
const git = (cwd, ...args) => exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd });

const schedules = await load("kanso-spaces/schedules.js", ["clockTodo", "scheduleOf", "spaceOf", "placeOfKey", "scheduleName", "SPACE_LABEL", "REV_LABEL", "SCHEDULE_KIND"]);
const dialog = await load("kanso-spaces/schedule-dialog.js", ["draftOf", "checkDraft", "whenOfDraft"]);
const clock = await load("kanso-spaces/clock-model.js", ["scheduleWaiter", "waiterPlan"]);
const { ADD_WORKTREE } = await load("kanso-spaces/platform-repositories.js", ["ADD_WORKTREE"]);

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

test("A scheduled run in a worktree of main logs that it ran, and a start that fails logs the reason once and waits for the next time", async (t) => {
  const dir = await temporary(t);
  const repo = join(dir, "repo");
  const bin = join(dir, "bin");
  await exec("mkdir", ["-p", repo, bin]);
  await writeFile(join(repo, "readme"), "a\n");
  assert.equal((await git(repo, "init")).code, 0);
  assert.equal((await git(repo, "add", "readme")).code, 0);
  assert.equal((await git(repo, "commit", "-m", "start")).code, 0);
  await writeFile(join(bin, "hc"), `#!/bin/sh
printf '%s\\n' "$*" >> "$LOG"
if [ "$1" = exec ]; then shift; exec "$@"; fi
if [ "$1" = run ] && [ -n "$FAIL" ]; then printf '%s\\n' "$FAIL" >&2; exit 1; fi
exit 0
`);
  await chmod(join(bin, "hc"), 0o755);
  const run = async (fail) => {
    const root = join(dir, fail ? "fail" : "ok");
    await exec("mkdir", ["-p", root]);
    const past = Math.floor(Date.now() / 1000) - 30;
    const calls = join(root, "hc.log");
    const job = {
      platform: "macos", id: "s1", log: join(root, "run.log"), mode: "at",
      spec: fail ? `${past} ${past + 3600}` : String(past), on: "", folder: repo, space: "sp9", tree: true, from: "main",
      dir: join(root, "trees"), slug: "triage", add: ADD_WORKTREE, argv: ["claude"],
    };
    const argv = clock.scheduleWaiter(job);
    const result = await exec(argv[0], argv.slice(1), {
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, LOG: calls, FAIL: fail ? "the agent did not start" : "" },
      limit: 8000,
    });
    return { code: result.code, log: await readFile(job.log, "utf8").catch(() => ""), calls: await readFile(calls, "utf8").catch(() => ""), stderr: result.stderr };
  };
  const ok = await run(false);
  assert.equal(ok.code, 0, ok.stderr + ok.log);
  assert.match(ok.log, / ran$/m);
  const listed = await git(repo, "worktree", "list", "--porcelain");
  const made = listed.stdout.split("\n\n").map((block) => block.match(/^worktree (.*)$/m)?.[1]).find((path) => path && path !== repo);
  assert.ok(made, listed.stdout);
  assert.equal((await git(made, "rev-parse", "HEAD")).stdout.trim(), (await git(repo, "rev-parse", "main")).stdout.trim());
  const failed = await run(true);
  assert.equal(failed.code, 137, failed.stderr + failed.log);
  assert.equal(failed.log.split("\n").filter((line) => line.includes("failed the agent did not start")).length, 1);
  assert.equal(failed.calls.split("\n").filter((line) => line.startsWith("run ")).length, 1);
});
