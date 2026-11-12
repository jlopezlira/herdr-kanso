// The sidebar's agents: how long each has been in its state, what it is on,
// sub-agents under their parent, and the Agents view's sections.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const NAMES = ["track", "elapsed", "duration", "activityOf", "nest", "bySection", "subStatus", "said", "trackSteps", "stepOf", "tasksOf", "unwrap"];
const lib = () => load("kanso-spaces/agents.js", NAMES);
const MIN = 60000;

test("Each agent's state is stamped when it changes; done and idle are one", async () => {
  const { track } = await lib();
  const a = (address, status, tab = "tb") => ({ address, status, tab });
  const tabs = { tb: { working_since: 1000, changed_at: 2000 } };
  let since = track({}, [a("t1", "working"), a("t2", "done"), a("t3", null)], 50000, (id) => tabs[id]);
  assert.deepEqual(clone(since), { t1: { s: "working", at: 1000 }, t2: { s: "rest", at: 2000 } },
    "first sight takes the tab's times; a terminal with no status is not stamped");
  assert.equal(track(since, [a("t1", "working"), a("t2", "idle")], 60000), null, "nothing changed: looking at a done agent is not a change");
  since = track(since, [a("t1", "blocked"), a("t2", "idle")], 70000);
  assert.deepEqual(clone(since.t1), { s: "blocked", at: 70000 });
  assert.deepEqual(clone(since.t2), { s: "rest", at: 2000 }, "it still finished when it did");
  const fresh = track({}, [a("t9", "working", "none")], 5000, () => null);
  assert.deepEqual(clone(fresh.t9), { s: "working", at: null }, "no time is better than a made-up one");
  const old = { gone: { s: "rest", at: 1 }, recent: { s: "rest", at: 90 * 86400000 } };
  assert.deepEqual(Object.keys(track(old, [], 100 * 86400000)), ["recent"], "agents gone a month are forgotten");
});

test("The time beside a row: working, waiting on you or since it finished", async () => {
  const { elapsed, duration } = await lib();
  const since = { t1: { s: "working", at: 0 } };
  assert.equal(elapsed({ address: "t1", status: "working" }, since, 4 * MIN), "4m");
  assert.equal(elapsed({ address: "t1", status: "idle" }, since, 4 * MIN), null, "a seen agent says nothing");
  assert.equal(elapsed({ address: "t2", status: "working" }, since, 4 * MIN), null, "unknown start: no time");
  assert.equal(duration(30000), "<1m");
  assert.equal(duration(90 * MIN), "1h");
  assert.equal(duration(50 * 60 * MIN), "2d");
});

test("What a row says under its name", async () => {
  const { activityOf } = await lib();
  const program = { key: "claude", name: "Claude Code" };
  const digest = { files: 2, add: 12, del: 3, ahead: 1, pr: { number: 41, checks: "failing" } };
  assert.equal(activityOf({ status: "working", name: "Lead", title: "✳ Release notes 2.3", program }), "Release notes 2.3",
    "named by you: its own title is what it is on");
  assert.equal(activityOf({ status: "working", title: "Release notes 2.3", program }), null, "unnamed: the title already is the name");
  assert.equal(activityOf({ status: "blocked", name: "Lead", title: "~/Apps/fluenty", program }), null, "a path tells nothing");
  assert.equal(activityOf({ status: "working", name: "Lead", title: "Claude Code", program }), null, "nor the program's name");
  assert.equal(activityOf({ status: "working", name: "Fury", title: "fury", program }), null, "nor the name again in other letters");
  assert.equal(activityOf({ status: "done" }, digest), null, "finished: its last words, never the header's digest");
  assert.equal(activityOf({ status: "idle" }, digest), null, "once seen, one line");
  assert.equal(activityOf({ status: "done", msg: "" }, digest), null, "no words: still not the digest");
});

test("What the agent says it is on comes first, its first line", async () => {
  const { activityOf, said } = await lib();
  const program = { key: "claude", name: "Claude Code" };
  assert.equal(said({ msg: "  \n Wait for PR #1025 checks\n  to finish " }), "Wait for PR #1025 checks");
  assert.equal(said({ msg: "   " }), null);
  assert.equal(activityOf({ status: "working", title: "Release notes", program, msg: "Running the tests" }), "Running the tests", "over its title");
  assert.equal(activityOf({ status: "done", msg: "Gallery updated at the same link. Awaiting your word." }, { files: 2, add: 12, del: 3 }),
    "Gallery updated at the same link. Awaiting your word.", "its last words, not the digest");
  assert.equal(activityOf({ status: "done", msg: "" }, { files: 2, add: 12, del: 3 }), null, "no words: the header keeps the digest");
  assert.equal(activityOf({ status: "idle", msg: "All green." }), "All green.", "resting: what it said last");
});

test("A long step shows its time; stuck past fifteen minutes", async () => {
  const { trackSteps, stepOf } = await lib();
  const a = (address, status, msg, status_ms) => ({ address, status, msg, status_ms });
  let steps = trackSteps({}, [a("t1", "working", "Wait for CI", 1000), a("t2", "working", null), a("t3", null, "x")], 5000);
  assert.deepEqual(clone(steps), { t1: { msg: "Wait for CI", at: 5000 }, t2: { msg: null, at: 5000 } }, "first seen: counted from now; no status, no step");
  assert.equal(trackSteps(steps, [a("t1", "working", "Wait for CI", 1000), a("t2", "working", null)], 9000), null, "the same step: nothing changed");
  steps = trackSteps(steps, [a("t1", "working", "Merge it", 9000)], 9000);
  assert.deepEqual(clone(steps), { t1: { msg: "Merge it", at: 9000 } }, "a new step is stamped now; a gone agent is dropped");
  assert.equal(stepOf({ address: "t1", status: "working" }, steps, 9000 + 2 * MIN), null, "two minutes: nothing yet");
  assert.deepEqual(clone(stepOf({ address: "t1", status: "working" }, steps, 9000 + 9 * MIN)), { time: "9m", stuck: false });
  assert.deepEqual(clone(stepOf({ address: "t1", status: "working" }, steps, 9000 + 20 * MIN)), { time: "20m", stuck: true });
  assert.equal(stepOf({ address: "t1", status: "done" }, steps, 9000 + 20 * MIN), null, "only while working");
  assert.equal(stepOf({ address: "t2", status: "working" }, { t2: { msg: null, at: 0 } }, 20 * MIN), null, "no step to time");
});

test("What still runs under an agent: its children, less its helpers", async () => {
  const { tasksOf, unwrap } = await lib();
  const { parseProcesses, etimeMs } = await load("kanso-spaces/procs.js", ["parseProcesses", "etimeMs"]);
  const ps = [
    "96083     1    05:03:28 /bin/zsh -l",
    "48343 96083    05:03:21 claude --resume 51fb0c9a",
    "48384 48343    05:03:18 /Users/jj/.local/node/bin/node /opt/homebrew/bin/railway mcp",
    "67833 48343       01:31 caffeinate -i -t 300",
    "70001 48343       08:34 /bin/zsh -c source /Users/jj/.claude/shell-snapshots/snap.sh 2>/dev/null || true && eval 'f=/tmp/x.output; until grep -q \"written\\|rror\" \"$f\" 2>/dev/null; do sleep 3; done; cat \"$f\"' < /dev/null && pwd -P >| /tmp/cwd",
    "70002 70001       00:02 sleep 3",
    "70003 48343    01-02:00:05 /Applications/Herdr.app/Contents/MacOS/Herdr",
  ].join("\n");
  const tasks = tasksOf(ps, 48343);
  assert.deepEqual(clone(tasks.map((x) => [x.pid, x.ms, x.command])), [
    [70001, 514000, 'f=/tmp/x.output; until grep -q "written\\|rror" "$f" 2>/dev/null; do sleep 3; done; cat "$f"'],
    [70003, (26 * 3600 + 5) * 1000, "/Applications/Herdr.app/Contents/MacOS/Herdr"],
  ], "the monitor loop as typed and the app it started; not the MCP server, caffeinate or the loop's own sleep");
  assert.deepEqual(clone(tasksOf(ps, 96083, false).map((x) => x.pid)), [70001, 70003], "from the shell: under its one child");
  assert.deepEqual(clone(tasksOf(ps, 11111, false)), [], "a shell with nothing under it");
  const table = parseProcesses(ps);
  assert.deepEqual(clone([tasksOf(table, 48343), tasksOf(table, 96083, false), tasksOf(table, 11111, false)]),
    clone([tasks, tasksOf(ps, 96083, false), []]), "the table read once gives the same as the text");
  assert.deepEqual([...table.byParent.get(48343)].map((r) => r.pid), [48384, 67833, 70001, 70003], "children in the table's order");
  assert.equal(etimeMs("01:31"), 91000);
  assert.equal(etimeMs("05:53:18"), (5 * 3600 + 53 * 60 + 18) * 1000);
  assert.equal(etimeMs("01-05:28:18"), (29 * 3600 + 28 * 60 + 18) * 1000);
  assert.equal(unwrap("/bin/sh -c npm test -- --watch"), "npm test -- --watch");
  assert.equal(unwrap("bash -lc 'pnpm dev'"), "'pnpm dev'");
  assert.equal(unwrap("/bin/zsh -c x && eval 'echo '\\''hi'\\''' < /dev/null"), "echo 'hi'", "a quote inside the command");
});

test("Sub-agents go under their parent, with tree lines", async () => {
  const { nest, subStatus } = await lib();
  const rows = [{ address: "t1" }, { address: "t2" }, { address: "t5", parent: "t2", pane: "p5" }];
  const all = [
    { address: "t3", parent: "t2", state: "live", status: "working", name: "lint" },
    { address: "t4", parent: "t3", state: "live", status: "error" },
    { address: "t6", parent: "t2", state: "exited", status: "done" },
  ];
  const out = clone(nest(rows, all).map((e) => [e.a.address, e.lines.join("")]));
  assert.deepEqual(out, [["t1", ""], ["t2", ""], ["t5", "├"], ["t3", "└"], ["t4", "└"]]);
  const lines = nest(rows, all).map((e) => clone(e.lines));
  assert.deepEqual(lines[4], ["", "└"], "the last child's own children get a blank column, not a line");
  const kid = nest(rows, all).find((e) => e.a.address === "t4").a;
  assert.equal(kid.sub, true);
  assert.equal(kid.status, "blocked", "an error counts as needing you");
  assert.equal(subStatus("done"), "idle", "a sub-agent is never done: its parent's done is the news");
  const loop = [{ address: "a", parent: "b" }, { address: "b", parent: "a" }];
  assert.equal(nest(loop, []).length, 0, "a parent loop draws nothing rather than hang");
});

test("The Agents view: by what each needs from you, a parent with its sub-agents", async () => {
  const { nest, bySection } = await lib();
  const rows = [
    { address: "t1", status: "idle", seq: 1 },
    { address: "t2", status: "working", seq: 2 },
    { address: "t3", status: "done", seq: 3 },
    { address: "t4", status: null, seq: 4 },
    { address: "t5", status: "idle", seq: 5 },
  ];
  const all = [{ address: "s1", parent: "t1", state: "live", status: "blocked" }];
  const since = { t2: { at: 10 }, t3: { at: 30 }, t5: { at: 20 } };
  const view = clone(bySection(nest(rows, all), since).map((s) => [s.id, s.entries.map((e) => e.a.address)]));
  assert.deepEqual(view, [["blocked", ["t1", "s1"]], ["working", ["t2"]], ["done", ["t3"]], ["idle", ["t5"]], ["other", ["t4"]]],
    "an idle parent whose sub-agent waits on you is under Needs you");
  const held = bySection(nest([{ address: "t5", status: "idle" }], []), {}, "t5");
  assert.equal(held[0].id, "done", "the done agent you are looking at stays in Done");
  const order = bySection(nest([{ address: "a", status: "idle" }, { address: "b", status: "idle" }], []), { a: { at: 1 }, b: { at: 2 } });
  assert.deepEqual(clone(order[0].entries.map((e) => e.a.address)), ["b", "a"], "latest change first");
});

test("Threads: which conversation a terminal holds, and its own name", async () => {
  const { parseLocated, readThread, claudeFile } = await load("kanso-spaces/threads.js", ["parseLocated", "readThread", "claudeFile"]);
  assert.equal(claudeFile("/Users/me", "/Users/me/Apps/herdr-kanso", "s1"), "/Users/me/.claude/projects/-Users-me-Apps-herdr-kanso/s1.jsonl");
  assert.deepEqual(clone(parseLocated(`claude\t{"pid":7,"sessionId":"s1","cwd":"/r/api"}\n`, "/h")), { kind: "claude", file: "/h/.claude/projects/-r-api/s1.jsonl", name: null });
  assert.deepEqual(clone(parseLocated(`codex\t/h/.codex/sessions/rollout-x.jsonl\t{"id":"x","thread_name":"Daily quotas"}\n`, "/h")),
    { kind: "codex", file: "/h/.codex/sessions/rollout-x.jsonl", name: "Daily quotas" });
  assert.equal(parseLocated("codex\t/f.jsonl\t\n", "/h").name, null, "Codex hasn't named it yet");
  assert.equal(parseLocated("", "/h"), null);

  const j = (o) => JSON.stringify(o);
  const user = (text, at) => j({ type: "user", timestamp: at, message: { content: text } });
  const head = [user("<command-name>/clear</command-name>"), user("Enforce the daily quota", "2026-11-03T10:00:00Z")].join("\n");
  const recent = [user("Enforce the daily quota", "2026-11-03T10:00:00Z"), user("now the tests", "2026-11-03T10:05:00Z"),
    j({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }), user("/compact"),
    user("This session is being continued from a previous conversation")].join("\n");
  const tail = j({ type: "assistant", timestamp: "2026-11-03T10:06:00Z" });
  const titled = readThread("claude", j({ type: "ai-title", aiTitle: "Daily quota limiter" }), head, recent, tail);
  assert.deepEqual(clone(titled), { title: "Daily quota limiter", prompt: "now the tests", said: Date.parse("2026-11-03T10:05:00Z"),
    began: Date.parse("2026-11-03T10:00:00Z"), at: Date.parse("2026-11-03T10:06:00Z") },
    "the agent's own title; the last thing you typed, not a tool result, a slash command or a compaction note");
  assert.equal(readThread("claude", "", head, recent, tail).title, "Enforce the daily quota", "no title yet: the first thing you wrote");
  const codex = j({ type: "event_msg", timestamp: "2026-11-03T10:00:00Z", payload: { type: "user_message", message: "Run the tests" } });
  assert.equal(readThread("codex", "", codex, codex, codex, "Quotas").title, "Quotas", "Codex's thread name");
  assert.equal(readThread("codex", "", codex, codex, codex).prompt, "Run the tests");
  assert.equal(readThread("claude", "", "", "", "").prompt, null);
});

test("Threads as T3 Code keeps them: pinned, active, snoozed, settled", async () => {
  const { threadSections, shelfOf, snoozePresets, backFromSettled } = await load("kanso-spaces/agents.js", ["threadSections", "shelfOf", "snoozePresets", "backFromSettled"]);
  const now = Date.parse("2026-11-04T15:00:00");
  const a = (address, extra = {}) => ({ address, status: "idle", labels: {}, turn: 3, pin: null, space: "s1", ...extra });
  assert.equal(shelfOf(a("t", { pin: 1, labels: { "kanso.settled": "5:3" } }), now), "pinned", "a pin wins");
  assert.equal(shelfOf(a("t", { labels: { "kanso.snooze": String(now + 1000) } }), now), "snoozed");
  assert.equal(shelfOf(a("t", { status: "blocked", labels: { "kanso.snooze": String(now + 1000) } }), now), "active", "one waiting on you wakes at once");
  assert.equal(shelfOf(a("t", { labels: { "kanso.settled": "5:3" } }), now), "settled");
  assert.equal(shelfOf(a("t", { turn: 4, labels: { "kanso.settled": "5:3" } }), now), "active", "a turn since brings it back");
  assert.equal(backFromSettled(a("t", { status: "working", labels: { "kanso.settled": "5:3" } })), true);
  const rows = [
    { a: a("old"), th: { said: 100 } },
    { a: a("new", { space: "s2" }), th: { said: 300 } },
    { a: a("woken", { labels: { "kanso.snooze": String(now - 1) } }), th: { said: 50 } },
    { a: a("pin2", { pin: 2 }), th: null }, { a: a("pin1", { pin: 1 }), th: null },
    { a: a("later", { labels: { "kanso.snooze": String(now + 9000) } }), th: null },
    { a: a("soon", { labels: { "kanso.snooze": String(now + 10) } }), th: null },
    { a: a("put", { labels: { "kanso.settled": "9:3" } }), th: null },
  ];
  const ids = (list) => clone(list.map((s) => [s.id, s.rows.map((r) => r.a.address)]));
  assert.deepEqual(ids(threadSections(rows, { now })), [["pinned", ["pin1", "pin2"]], ["active", ["woken", "new", "old"]], ["snoozed", ["soon", "later"]], ["settled", ["put"]]],
    "woken first, then by your last message");
  assert.deepEqual(ids(threadSections(rows.slice(0, 3), { now, group: true })), [["project-s1", ["woken", "old"]], ["project-s2", ["new"]]]);
  const started = threadSections([{ a: a("x"), th: { said: 9, began: 1 } }, { a: a("y"), th: { said: 1, began: 9 } }], { now, order: "started" });
  assert.deepEqual(clone(started[0].rows.map((r) => r.a.address)), ["y", "x"], "by when it started");
  const presets = clone(snoozePresets(now).map((p) => p.id));
  assert.deepEqual(presets, ["1h", "3h", "evening", "tomorrow", "monday"]);
  assert.equal(snoozePresets(Date.parse("2026-11-04T17:30:00")).some((p) => p.id === "evening"), false, "this evening only while it is ahead");
});

