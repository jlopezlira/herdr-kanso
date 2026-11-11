// The pane header's three controls: words, colour, and where a click goes.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const gh = () => load("kanso-panel/ghchecks.js", ["prLine", "prFacts", "headerHold"]);
const strip = () => load("kanso-strip/main.js", ["digestSegments", "digestOpen", "headerTools", "readClock", "digestPr"]);
const panel = () => load("kanso-panel/pr.js", ["sectionIndex", "checksFirst"]);

const run = (name, conclusion, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const view = (over, rollup) => ({
  number: 142, state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED",
  reviewDecision: null, baseRefName: "main", statusCheckRollup: rollup ?? [], ...over,
});

test("one verdict for every pull request state, and ready is never said", async () => {
  const { prLine, prFacts, headerHold } = await gh();
  const job = "test / unit";
  const long = "abcdefghijklmnopqrstuvwxyz";
  const cases = [
    [view({ mergeStateStatus: "UNSTABLE" }, [run(job, "FAILURE")]), { text: "test / unit failed", tone: "blocked", section: "checks", check: job }],
    [view({ mergeStateStatus: "UNSTABLE" }, [run(long, "FAILURE")]), { text: `${long.slice(0, 24)} failed`, tone: "blocked", section: "checks", check: long }],
    [view({ mergeStateStatus: "UNSTABLE" }, [run("a", "FAILURE"), run("b", "FAILURE")]), { text: "2 checks failing", tone: "blocked", section: "checks", check: null }],
    [view({ mergeStateStatus: "UNSTABLE" }, [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }]), { text: "checks failing", tone: "blocked", section: "checks", check: null }],
    [view({ mergeStateStatus: "BLOCKED" }, [run("ci", "SUCCESS", "IN_PROGRESS")]), { text: "checks running", tone: "working", section: "checks", check: null }],
    [view({ reviewDecision: "CHANGES_REQUESTED" }, [run("ci", "SUCCESS")]), { text: "changes requested", tone: "blocked", section: "threads", check: null }],
    [view({ reviewDecision: "REVIEW_REQUIRED" }, [run("ci", "SUCCESS")]), { text: "review required", tone: "working", section: "review", check: null }],
    [view({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, [run(job, "FAILURE")]), { text: "conflicts with main", tone: "blocked", section: "conflicts", check: null }],
    [view({ mergeStateStatus: "BEHIND" }, [run(job, "FAILURE")]), { text: "behind main", tone: "working", section: "behind", check: null }],
    [view({ isDraft: true, mergeStateStatus: "DIRTY" }, [run(job, "FAILURE")]), { text: "draft", tone: "dim", section: "draft", check: null }],
    [view({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }, [run(job, "FAILURE")]), { text: "test / unit failed", tone: "blocked", section: "checks", check: job }],
  ];
  for (const [input, want] of cases) assert.deepEqual(clone(prLine(input)), want);
  const clean = view({ mergeStateStatus: "CLEAN", viewerPermission: "WRITE" }, [run("ci", "SUCCESS")]);
  assert.equal(prLine(clean), null);
  assert.equal(headerHold(clean), null);
  assert.equal(prLine(view({ mergeStateStatus: "CLEAN", viewerPermission: "READ" }, [run("ci", "SUCCESS")])), null);
  assert.equal(prLine(view({ mergeStateStatus: "UNKNOWN" })), null);
  assert.equal(prLine(view({ mergeStateStatus: "" })), null);
  assert.equal(prLine(view({ state: "CLOSED", mergeStateStatus: "CLEAN" })), null);
  assert.equal(prLine(view({ state: "MERGED" })), null);
  assert.equal(prLine(null), null);
  const facts = prFacts(view({ mergeStateStatus: "UNSTABLE" }, [run(job, "FAILURE"), run("lint", "SUCCESS")]));
  assert.equal(facts.failed, job);
  assert.equal(facts.statusCheckRollup, undefined);
  assert.deepEqual(clone(prLine({ pr: facts })), { text: "test / unit failed", tone: "blocked", section: "checks", check: job });
  const two = prFacts(view({ mergeStateStatus: "UNSTABLE" }, [run("a", "FAILURE"), run("b", "FAILURE")]));
  assert.equal(two.failed, null);
  assert.equal(prLine({ pr: two }).text, "2 checks failing");
  assert.equal(prLine({ pr: two }).check, null);
  const placed = ["hero", "review", "threads", "checks", "conflicts"];
  const { sectionIndex } = await panel();
  for (const [input] of cases) {
    const line = prLine(input);
    assert.equal(sectionIndex(line.section, placed) != null, true, line.section);
  }
});

test("each segment's words, colour and click, and nothing that cannot act", async () => {
  const { digestSegments, digestOpen, readClock, digestPr } = await strip();
  const at = new Date(2026, 10, 11, 14, 2).getTime();
  assert.equal(readClock(at), "14:02");
  assert.equal(readClock(new Date(2026, 10, 11, 9, 5).getTime()), "09:05");
  assert.equal(readClock(null), null);
  const idle = clone(digestSegments({ files: 2, add: 5, del: 1, ahead: 1, at, pr: { number: 41, state: "OPEN", mergeStateStatus: "UNSTABLE", fail: 1, failed: "test / unit", pending: 0 } }));
  assert.deepEqual(idle.map((s) => s.kind), ["files", "commits", "pr"]);
  assert.equal(idle[0].tone, "muted");
  assert.equal(idle[0].diff, "+5 −1");
  assert.equal(idle[0].diffTone, "dim");
  assert.equal(idle[0].tip, "Open the diff");
  assert.equal(idle[1].tone, "muted");
  assert.equal(idle[1].tip, "1 commit not on GitHub");
  assert.equal(idle[2].verdict, "test / unit failed");
  assert.equal(idle[2].verdictTone, "blocked");
  assert.equal(idle[2].dot, "blocked");
  assert.equal(idle[2].numberTone, "muted");
  assert.equal(idle[2].number, "#41");
  const working = clone(digestSegments({ files: 1, add: 0, del: 0, ahead: 3, at, pr: { number: 142, state: "OPEN", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", fail: 0, pending: 0 } }, { working: true }));
  assert.equal(working[0].tone, "dim");
  assert.equal(working[0].diff, null);
  assert.equal(working[0].tip, "Open the diff · read 14:02");
  assert.equal(working[1].tone, "dim");
  assert.equal(working[1].tip, "3 commits not on GitHub · read 14:02");
  assert.equal(working[2].tone, "working");
  assert.equal(working[2].verdict, "review required");
  assert.equal(working[2].dot, "working");
  assert.equal(working[2].tip, "review required");
  const draft = clone(digestSegments({ pr: { number: 7, state: "OPEN", isDraft: true, mergeStateStatus: "DRAFT" } }));
  assert.equal(draft[0].verdict, "draft");
  assert.equal(draft[0].verdictTone, "dim");
  assert.equal(draft[0].dot, null);
  const ready = clone(digestSegments({ pr: { number: 141, state: "OPEN", mergeStateStatus: "CLEAN", fail: 0, pending: 0 } }));
  assert.equal(ready.length, 1);
  assert.equal(ready[0].number, "#141");
  assert.equal(ready[0].verdict, null);
  assert.equal(ready[0].dot, null);
  assert.equal(ready[0].tip, "Pull request #141");
  assert.equal(/ready/i.test(ready[0].tip), false);
  assert.deepEqual(clone(digestSegments({ files: 0, ahead: 0, pr: null })), []);
  assert.deepEqual(clone(digestSegments({ pr: { number: 1, state: "CLOSED" } })), []);
  assert.deepEqual(clone(digestSegments(null)), []);
  for (const seg of [...idle, ...working, ...draft, ...ready]) assert.ok(seg.open?.panel);
  assert.deepEqual(clone(digestOpen(idle[0], "/repo")), { panel: "files", page: "changes", cwd: "/repo" });
  assert.deepEqual(clone(digestOpen(idle[0], undefined)), { panel: "files", page: "changes", cwd: null });
  assert.deepEqual(clone(digestOpen(idle[1], "/repo")), { panel: "pr", section: "push", check: null });
  assert.deepEqual(clone(digestOpen(idle[2], "/repo")), { panel: "pr", section: "checks", check: "test / unit" });
  assert.equal(digestOpen(null), null);
  assert.equal(digestOpen({}), null);
  const stored = digestPr(view({ reviewDecision: "REVIEW_REQUIRED" }, [run("ci", "SUCCESS")]));
  assert.equal(stored.hold, "Review required");
  assert.equal(stored.fail, 0);
  assert.equal(/ready/i.test(JSON.stringify(stored)), false);
  assert.equal(digestSegments({ pr: stored })[0].verdict, "review required");
});

test("Sleep and Send stay on a finished focused pane, and a blocked pane has no Send", async () => {
  const { headerTools } = await strip();
  const both = { canSend: true, canSleep: true };
  assert.deepEqual(clone(headerTools({ focused: true, status: "done", ...both })), { sleep: "shown", send: "shown" });
  assert.deepEqual(clone(headerTools({ focused: true, status: "idle", ...both })), { sleep: "shown", send: "shown" });
  assert.deepEqual(clone(headerTools({ focused: true, status: "working", ...both })), { sleep: "hover", send: "hover" });
  assert.deepEqual(clone(headerTools({ focused: true, status: "blocked", ...both })), { sleep: "hover", send: "hidden" });
  assert.deepEqual(clone(headerTools({ focused: false, status: "done", ...both })), { sleep: "hover", send: "hover" });
  assert.deepEqual(clone(headerTools({ focused: false, status: "blocked", ...both })), { sleep: "hover", send: "hidden" });
  assert.deepEqual(clone(headerTools({ focused: true, status: "done", canSend: false, canSleep: false })), { sleep: "hidden", send: "hidden" });
  assert.deepEqual(clone(headerTools({ focused: true, status: "idle", canSend: false, canSleep: true })), { sleep: "shown", send: "hidden" });
});

test("the pull request panel lands on the named section and shows the failed check first", async () => {
  const { sectionIndex, checksFirst } = await panel();
  const ids = ["header", "hero", "description", "review", "checks", "threads", "conflicts", "files", "note"];
  assert.equal(sectionIndex("draft", ids), 1);
  assert.equal(sectionIndex("behind", ids), 1);
  assert.equal(sectionIndex("review", ids), 3);
  assert.equal(sectionIndex("checks", ids), 4);
  assert.equal(sectionIndex("threads", ids), 5);
  assert.equal(sectionIndex("conflicts", ids), 6);
  assert.equal(sectionIndex("push", ids), null);
  assert.equal(sectionIndex(null, ids), null);
  assert.equal(sectionIndex("checks", ["header", "hero"]), null);
  const checks = [{ name: "a", state: "fail" }, { name: "b", state: "pass" }, { name: "c", state: "fail" }];
  assert.deepEqual(clone(checksFirst(checks, "c")).map((c) => c.name), ["c", "a", "b"]);
  assert.deepEqual(clone(checksFirst(checks, "missing")), checks);
  assert.deepEqual(clone(checksFirst(checks, null)), checks);
});
