// What each pull request state says, and the one action that state can take.
import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers.mjs";

const host = (value) => JSON.parse(JSON.stringify(value));
const agent = { isAgent: true, name: "checkout", address: "t1", blocked: false };
const now = Date.parse("2026-11-11T18:00:00Z");

const open = (over = {}) => ({
  number: 12, title: "Ship it", url: "https://github.com/o/r/pull/12", state: "OPEN", isDraft: false,
  headRefName: "feat", baseRefName: "main", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  reviewDecision: null, author: { login: "ada" }, additions: 3, deletions: 1, changedFiles: 2,
  commits: [{ oid: "a" }, { oid: "b" }],
  latestReviews: [{ state: "APPROVED", author: { login: "bea" } }],
  reviewRequests: [], assignees: [],
  ...over,
});

const job = (over = {}) => ({
  name: "ci", state: "pass", workflow: "", workflowName: "", url: "https://github.com/o/r/pull/12",
  runId: null, startedAt: null, completedAt: null, ...over,
});

const scene = (over = {}) => ({
  kind: "pr", pr: open(), checks: [job()], threads: [], permission: "WRITE", agent, stale: false,
  baseBehind: null, log: null, now, branch: "feat", canCreate: false, ahead: 0, behindCount: 0, subjects: [],
  ...over,
});

const failing = job({
  state: "fail", name: "test", workflowName: "CI", workflow: "CI", runId: "99",
  url: "https://github.com/o/r/actions/runs/99",
  startedAt: "2026-11-11T17:58:00Z", completedAt: "2026-11-11T17:59:30Z",
});

function painted(view) {
  const actions = [view.primary, view.quiet, view.more, ...(view.writes ?? [])].filter(Boolean);
  for (const action of actions) {
    if (view.dimmed && action.write) {
      assert.equal(action.acts, false, action.id);
      assert.equal(action.disabled, true, action.id);
    } else {
      assert.equal(action.acts, true, action.id);
      assert.equal(Boolean(action.target), true, action.id);
    }
  }
}

test("each pull request state names what stops it, in that colour, with one action that can act", async () => {
  const { verdictOf, clockOf } = await load("kanso-panel/pr-verdict.js", ["verdictOf", "clockOf"], {});
  const mergedAt = "2026-11-11T15:04:00Z";
  const cases = [
    { scene: scene({ pr: open({ state: "MERGED", mergedAt }) }), text: "Merged", tone: "violet", target: null, writes: [], note: clockOf(mergedAt) },
    { scene: scene({ pr: open({ state: "CLOSED" }) }), text: "Closed without merging", tone: "red", target: null, quiet: "reopen", writes: [] },
    { scene: scene({ pr: open({ isDraft: true, mergeStateStatus: "CLEAN" }) }), text: "Draft", tone: "dim", target: "ready", id: "pr-ready", writes: ["pr-close"] },
    { scene: scene({ pr: open({ isDraft: true }), checks: [failing] }), text: "Draft", tone: "dim", target: "ready", note: "1 check failing", writes: ["pr-close"] },
    { scene: scene({ pr: open({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), checks: [failing] }), text: "Conflicts with main", tone: "red", target: "send", id: "pr-send", quiet: "github" },
    { scene: scene({ pr: open({ mergeStateStatus: "UNSTABLE" }), checks: [failing, job()], log: [{ job: "CI / test", step: "Run", lines: ["ok", "FAIL no"] }] }), text: "1 check failing", tone: "red", target: "send", id: "pr-send", quiet: "log" },
    { scene: scene({ pr: open({ reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }), checks: [failing] }), text: "Changes requested", tone: "red", target: "send" },
    { scene: scene({ pr: open({ reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }) }), text: "Changes requested", tone: "red", target: "send", quiet: "reply" },
    { scene: scene({ pr: open({ mergeStateStatus: "BEHIND" }), baseBehind: 4, checks: [job({ state: "pending", name: "ci" }), job()] }), text: "Behind main", tone: "yellow", target: "update", id: "pr-update", body: "4 commits" },
    { scene: scene({ pr: open({ mergeStateStatus: "BEHIND" }) }), text: "Behind main", tone: "yellow", target: "update" },
    { scene: scene({ pr: open({ mergeStateStatus: "BEHIND" }), permission: "READ" }), text: "Behind main", tone: "yellow", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "BLOCKED" }), checks: [job({ state: "pending" }), job({ state: "pending", name: "lint" }), job(), job({ name: "docs" }), job({ name: "e2e" })] }), text: "2 checks running", tone: "yellow", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "BLOCKED" }), checks: [job({ state: "unknown" }), job({ state: "unknown", name: "lint" })] }), text: "2 checks unknown", tone: "yellow", target: null },
    { scene: scene({ pr: open({ reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", reviewRequests: [{ login: "bea" }] }) }), text: "Review required", tone: "yellow", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "BLOCKED", reviewDecision: "APPROVED" }) }), text: "Blocked by branch rules", tone: "yellow", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "UNSTABLE", reviewDecision: "APPROVED" }) }), text: "Blocked by branch rules", tone: "yellow", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" }) }), text: "Checking whether it can merge…", tone: "dim", target: null },
    { scene: scene({ permission: "" }), text: "Checking whether it can merge…", tone: "dim", target: null },
    { scene: scene({ permission: "READ" }), text: "No permission to merge", tone: "dim", target: null },
    { scene: scene({ pr: open({ mergeStateStatus: "HAS_HOOKS", reviewDecision: "APPROVED" }) }), text: "Ready to merge", tone: "green", target: "merge", id: "pr-merge", label: "Squash and merge" },
    { scene: scene(), text: "Ready to merge", tone: "green", target: "merge", id: "pr-merge", label: "Squash and merge", writes: ["pr-draft", "pr-close"] },
  ];
  for (const item of cases) {
    const view = verdictOf(item.scene);
    assert.equal(view.text, item.text, item.text);
    assert.equal(view.tone, item.tone, item.text);
    assert.equal(view.primary?.target ?? null, item.target, item.text);
    if (item.id) assert.equal(view.primary.id, item.id, item.text);
    if (item.label) assert.equal(view.primary.label, item.label, item.text);
    if (item.quiet) assert.equal(view.quiet?.target, item.quiet, item.text);
    if (item.note) assert.equal(view.note, item.note, item.text);
    if (item.body) assert.equal(view.body?.text, item.body, item.text);
    if (item.writes) assert.deepEqual(host(view.writes.map((action) => action.id)), item.writes, item.text);
    if (item.target === null) assert.equal(view.primary, null, item.text);
    painted(view);
  }
  const ready = verdictOf(scene());
  assert.equal(ready.primary.verb, "squash and merge");
  assert.equal(ready.primary.armed, true);
  assert.equal(ready.primary.write, true);
  assert.equal(ready.body.kind, "note");
  assert.equal(ready.body.text, "1 approval · 1 check passed");
  assert.equal(ready.facts, "2 files  +3 −1 · 2 commits");
  assert.equal(ready.detailsNote, "1 check · 2 people · 2 files");
});

test("a failed check shows the step and its last lines, and one more opens the rest", async () => {
  const { verdictOf, failedLog, sendText } = await load("kanso-panel/pr-verdict.js", ["verdictOf", "failedLog", "sendText"], {});
  const raw = Array.from({ length: 13 }, (_, i) => `CI / test\tRun\t${i === 12 ? "FAIL no" : `line ${i}`}`).join("\n");
  const held = scene({
    pr: open({ mergeStateStatus: "UNSTABLE" }),
    checks: [failing, job({ state: "fail", name: "lint", workflowName: "CI", runId: "100" })],
    log: failedLog(raw),
  });
  const view = verdictOf(held);
  assert.equal(view.body.job, "CI / test");
  assert.equal(view.body.step, "Run");
  assert.equal(view.body.elapsed, "1m 30s");
  assert.equal(view.body.lines.length, 12);
  assert.equal(view.body.lines[0].text, "line 1");
  assert.equal(view.body.lines.at(-1).text, "FAIL no");
  assert.equal(view.body.lines.at(-1).tone, "blocked");
  assert.equal(view.more.label, "+1 more");
  assert.equal(view.more.target, "failures");
  assert.equal(view.logKey, "99");
  const waiting = verdictOf(scene({ pr: open({ mergeStateStatus: "UNSTABLE" }), checks: [job({ state: "fail", name: "ci" })], log: null }));
  assert.equal(waiting.text, "1 check failing");
  assert.deepEqual(host(waiting.body.lines), []);
  assert.equal(waiting.logKey, null);
  const three = verdictOf(scene({
    pr: open({ mergeStateStatus: "UNSTABLE" }),
    checks: [failing, job({ state: "fail", name: "lint" }), job({ state: "fail", name: "e2e" })],
  }));
  assert.equal(three.more.label, "+2 more");
  const sent = sendText(held, view);
  assert.match(sent, /^CI \/ test\nRun\nline 1\n/);
  assert.match(sent, /FAIL no\nhttps:\/\/github.com\/o\/r\/pull\/12$/);
  assert.equal(sent.includes("line 0"), false);
});

test("changes requested opens on the first unresolved comment", async () => {
  const { verdictOf, sendText, COMMENT_LINES } = await load("kanso-panel/pr-verdict.js", ["verdictOf", "sendText", "COMMENT_LINES"], {});
  const body = Array.from({ length: 9 }, (_, i) => `row ${i}`).join("\n");
  const threads = [
    { author: "bea", path: "src/a.js", line: 4, body, url: "https://github.com/o/r/pull/12#discussion_r1" },
    { author: "cy", path: "src/b.js", line: 2, body: "And this.", url: "https://github.com/o/r/pull/12#discussion_r2" },
  ];
  const held = scene({ pr: open({ reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }), threads });
  const view = verdictOf(held);
  assert.equal(view.body.author, "bea");
  assert.equal(view.body.letter, "B");
  assert.equal(view.body.path, "src/a.js");
  assert.equal(view.body.line, 4);
  assert.equal(view.body.text.split("\n").length, COMMENT_LINES);
  assert.equal(view.more.label, "+1 more thread");
  assert.equal(view.more.target, "details");
  assert.equal(sendText(held, view), `bea src/a.js:4\n${view.body.text}\nhttps://github.com/o/r/pull/12`);
  const many = verdictOf(scene({
    pr: open({ reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" }),
    threads: [...threads, { author: "dee", path: "c.js", line: 1, body: "Third.", url: "https://x" }],
  }));
  assert.equal(many.more.label, "+2 more threads");
  const asked = verdictOf(scene({ pr: open({ reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", reviewRequests: [{ login: "bea" }, { login: "cy" }] }) }));
  assert.deepEqual(host(asked.body.lines), ["bea", "cy"]);
  assert.equal(asked.primary, null);
});

test("Send is the agent in front, and a write stays quiet until GitHub has answered", async () => {
  const { verdictOf, sendText, sendStep } = await load("kanso-panel/pr-verdict.js", ["verdictOf", "sendText", "sendStep"], {});
  const failed = scene({ pr: open({ mergeStateStatus: "UNSTABLE" }), checks: [failing] });
  const fresh = verdictOf(failed);
  assert.equal(fresh.primary.label, "Send to checkout");
  assert.equal(fresh.primary.armed, false);
  assert.equal(fresh.primary.write, false);
  const blocked = verdictOf(scene({ ...failed, agent: { ...agent, blocked: true } }));
  assert.equal(blocked.text, "1 check failing · checkout needs you first");
  assert.equal(blocked.primary, null);
  const reader = verdictOf(scene({ ...failed, agent: null }));
  assert.equal(reader.primary.id, "pr-log");
  assert.equal(reader.primary.target, "log");
  assert.equal(reader.primary.label, "Open log on GitHub");
  assert.equal(reader.quiet, null);
  assert.equal(reader.primary.armed, false);
  const stale = verdictOf(scene({ ...failed, stale: true }));
  assert.equal(stale.dimmed, true);
  assert.equal(stale.primary.acts, true);
  assert.equal(stale.quiet.acts, true);
  assert.equal(stale.quiet.id, "pr-log");
  assert.equal(stale.writes.every((action) => action.acts === false && action.write === true), true);
  const staleMerge = verdictOf(scene({ stale: true }));
  assert.equal(staleMerge.primary.id, "pr-merge");
  assert.equal(staleMerge.primary.acts, false);
  const conflict = scene({ pr: open({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }) });
  assert.equal(sendText(conflict, verdictOf(conflict)), "Merge origin/main into feat and resolve the conflicts.\nhttps://github.com/o/r/pull/12");
  assert.deepEqual(host(sendStep(false, "note")), { show: true, deliver: false });
  assert.deepEqual(host(sendStep(true, "note")), { show: false, deliver: true });
  assert.deepEqual(host(sendStep(false, "")), { show: false, deliver: false });
  painted(fresh);
  painted(reader);
  painted(stale);
  painted(staleMerge);
});

test("a branch with no pull request says where it is, and offers the one next step", async () => {
  const { verdictOf, CLI_URL } = await load("kanso-panel/pr-verdict.js", ["verdictOf", "CLI_URL"], {});
  const empty = (over) => verdictOf({ branch: "feat", ...over });
  const folder = empty({ kind: "folder", place: "/tmp" });
  assert.equal(folder.text, "No repository in /tmp");
  assert.equal(folder.tone, "muted");
  assert.equal(folder.primary, null);
  const absent = empty({ kind: "absent" });
  assert.equal(absent.text, "GitHub CLI not installed");
  assert.equal(absent.primary, null);
  assert.equal(absent.quiet.id, "pr-cli");
  assert.equal(absent.quiet.url, CLI_URL);
  const auth = empty({ kind: "auth" });
  assert.equal(auth.text, "Not signed in to GitHub");
  assert.equal(auth.primary.id, "pr-sign-in");
  assert.equal(auth.primary.armed, false);
  assert.equal(empty({ kind: "auth", computer: "mac" }).text, "Not signed in to GitHub on mac");
  assert.equal(empty({ kind: "missing", title: "No GitHub remote" }).text, "No GitHub remote");
  assert.equal(empty({ kind: "missing", title: "No GitHub remote" }).primary, null);
  assert.equal(empty({ kind: "detached" }).text, "No branch checked out");
  const base = empty({ kind: "base", branch: "main" });
  assert.equal(base.text, "main is the default branch");
  assert.equal(base.primary, null);
  assert.equal(base.details, true);
  assert.equal(empty({ kind: "behind", behindCount: 1 }).text, "1 commit behind GitHub");
  assert.equal(empty({ kind: "behind", behindCount: 1 }).primary.id, "pr-pull");
  assert.equal(empty({ kind: "behind", behindCount: 2 }).text, "2 commits behind GitHub");
  assert.equal(empty({ kind: "behind", behindCount: 0 }).text, "Commits behind GitHub");
  const subjects = ["one", "two", "three", "four", "five", "six"];
  const unpushed = empty({ kind: "unpushed", ahead: 1, subjects });
  assert.equal(unpushed.text, "1 commit not on GitHub");
  assert.equal(unpushed.primary.id, "pr-push");
  assert.equal(unpushed.primary.armed, false, "a push acts on one press");
  assert.deepEqual(host(unpushed.body.lines), subjects.slice(0, 5));
  assert.equal(empty({ kind: "unpushed", ahead: 0 }).text, "Commits not on GitHub");
  const none = empty({ kind: "none", canCreate: true });
  assert.equal(none.text, "No pull request for feat");
  assert.equal(none.primary.id, "pr-create");
  assert.equal(none.primary.armed, false);
  assert.equal(empty({ kind: "none", canCreate: false }).primary, null);
  for (const view of [folder, absent, auth, base, unpushed, none]) painted(view);
});

test("a failed log keeps the last lines of the matching step, without the timestamp", async () => {
  const { failedLog, logGroup, logLineTone, firstLines, elapsed, clockOf } = await load(
    "kanso-panel/pr-verdict.js",
    ["failedLog", "logGroup", "logLineTone", "firstLines", "elapsed", "clockOf"],
    {},
  );
  const body = ["a", "b"].map((line, i) => `CI / test\tRun\t2026-11-11T12:00:0${i}.000Z ${i === 1 ? "FAIL no" : line}`).join("\n");
  const extra = Array.from({ length: 12 }, (_, i) => `other\tStep\trow ${i}`).join("\n");
  const groups = failedLog(`${body}\n${extra}\n`);
  assert.equal(groups[0].lines[0], "a");
  assert.equal(groups[0].lines[1], "FAIL no");
  assert.equal(groups[1].lines.length, 12);
  assert.equal(logLineTone("FAIL no"), "blocked");
  assert.equal(logLineTone("##[error] boom"), "blocked");
  assert.equal(logLineTone("all well"), "muted");
  const check = { name: "test", workflowName: "CI" };
  assert.equal(logGroup(groups, check).step, "Run");
  assert.equal(logGroup([], check), null);
  assert.equal(firstLines("a\nb\nc", 2), "a\nb");
  assert.equal(elapsed("2026-11-11T12:00:00Z", null, Date.parse("2026-11-11T12:00:05Z")), "5s");
  assert.equal(elapsed("nope", "nope", now), "");
  const at = new Date("2026-11-11T15:04:00Z");
  assert.equal(clockOf("2026-11-11T15:04:00Z"), `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
  assert.equal(clockOf("nope"), "");
});

test("a check's name, its run and who can write come from the check itself", async () => {
  const { jobLabel, runIdOf, isWriter } = await load("kanso-panel/ghchecks.js", ["jobLabel", "runIdOf", "isWriter"], {});
  assert.equal(jobLabel({ name: "test", workflowName: "CI" }), "CI / test");
  assert.equal(jobLabel({ name: "CI", workflowName: "CI" }), "CI");
  assert.equal(jobLabel({ name: "" }), "Check");
  assert.equal(runIdOf({ detailsUrl: "https://github.com/o/r/actions/runs/42/job/1" }), "42");
  assert.equal(runIdOf({ databaseId: 5, url: "https://github.com/o/r/commit/abc" }), null);
  assert.equal(runIdOf({ checkSuite: { workflowRun: { databaseId: 7 } } }), "7");
  assert.equal(isWriter("write"), true);
  assert.equal(isWriter("READ"), false);
  assert.equal(isWriter(""), false);
});

test("the failed log is due once, and the footnote is only the age or the wait", async () => {
  const { logDue, footLine } = await load("kanso-panel/pr-poll.js", ["logDue", "footLine"], {});
  assert.equal(logDue({ facing: false, key: "1", have: null }), false);
  assert.equal(logDue({ facing: true, key: null, have: null }), false);
  assert.equal(logDue({ facing: true, key: "1", have: "1" }), false);
  assert.equal(logDue({ facing: true, key: "1", have: null }), true);
  assert.equal(logDue({ facing: true, key: "2", have: "1" }), true);
  assert.deepEqual(host(footLine({ wait: null, stale: false, at: now, now })), { text: null, retry: false });
  const stale = footLine({ wait: null, stale: true, at: now, now });
  assert.match(stale.text, /^as of /);
  assert.equal(stale.retry, true);
  const wait = footLine({ wait: "GitHub asks to wait until 15:04", stale: true, at: now, now });
  assert.equal(wait.text, "GitHub asks to wait until 15:04");
  assert.equal(wait.retry, false);
});
