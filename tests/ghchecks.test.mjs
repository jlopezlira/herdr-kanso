// A pull request's checks, read once (ghchecks.js) for the PR panel and the header's digest.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

const run = (status, conclusion = "", name) => ({ __typename: "CheckRun", status, conclusion, ...(name ? { name } : {}) });
const commit = (state, context) => ({ __typename: "StatusContext", state, ...(context ? { context } : {}) });

test("A check run reads by its status, then its conclusion", async () => {
  const { checkState } = await load("kanso-panel/ghchecks.js", ["checkState"]);
  assert.equal(checkState(run("COMPLETED", "SUCCESS")), "pass");
  assert.equal(checkState(run("COMPLETED", "NEUTRAL")), "pass");
  assert.equal(checkState(run("COMPLETED", "SKIPPED")), "skipped", "its own state, counted as passed");
  for (const c of ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]) assert.equal(checkState(run("COMPLETED", c)), "fail", c);
  assert.equal(checkState(run("COMPLETED", "STALE")), "fail", "GitHub gave up on it: only a rerun passes");
  for (const s of ["QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "PENDING"]) assert.equal(checkState(run(s)), "pending", s);
  assert.equal(checkState(run("in_progress")), "pending", "any case");
});

test("A commit status reads by its state", async () => {
  const { checkState } = await load("kanso-panel/ghchecks.js", ["checkState"]);
  assert.equal(checkState(commit("SUCCESS")), "pass");
  assert.equal(checkState(commit("FAILURE")), "fail");
  assert.equal(checkState(commit("ERROR")), "fail");
  assert.equal(checkState(commit("PENDING")), "pending");
  assert.equal(checkState(commit("EXPECTED")), "pending", "required, not reported yet");
  assert.equal(checkState({ state: "SUCCESS" }), "pass", "a state alone is a commit status");
});

test("A value GitHub has not told us about is unknown, never a pass", async () => {
  const { checkState, rollupState } = await load("kanso-panel/ghchecks.js", ["checkState", "rollupState"]);
  assert.equal(checkState(run("COMPLETED", "SOMETHING_NEW")), "unknown");
  assert.equal(checkState(run("COMPLETED", "")), "unknown", "completed without a conclusion");
  assert.equal(checkState(run("PAUSED")), "unknown", "an unknown status");
  assert.equal(checkState(commit("SOMETHING_NEW")), "unknown");
  assert.equal(checkState({}), "unknown");
  assert.equal(checkState(null), "unknown");
  assert.equal(rollupState([run("COMPLETED", "SUCCESS"), run("COMPLETED", "SOMETHING_NEW")]), "unknown");
});

test("All of a pull request's checks: none, then failure, running, unknown, and pass only when all passed", async () => {
  const { rollupState } = await load("kanso-panel/ghchecks.js", ["rollupState"]);
  assert.equal(rollupState([]), null);
  assert.equal(rollupState(null), null);
  assert.equal(rollupState([run("COMPLETED", "SUCCESS"), commit("SUCCESS"), run("COMPLETED", "SKIPPED")]), "pass");
  assert.equal(rollupState([run("COMPLETED", "SUCCESS"), commit("EXPECTED")]), "pending");
  assert.equal(rollupState([run("IN_PROGRESS"), run("COMPLETED", "SOMETHING_NEW")]), "pending", "still running before unknown");
  assert.equal(rollupState([run("IN_PROGRESS"), run("COMPLETED", "STALE")]), "fail", "a failure wins over one still running");
  assert.equal(rollupState([run("COMPLETED", "SKIPPED"), run("COMPLETED", "SKIPPED")]), "pass", "all skipped");
});

test("The counts of each state, and what they say together", async () => {
  const { checkSummary } = await load("kanso-panel/ghchecks.js", ["checkSummary"]);
  assert.deepEqual({ ...checkSummary(["pass", "skipped", "fail", "pending", "pending"]) }, { fail: 1, pending: 2, unknown: 0, pass: 1, skipped: 1, total: 5, state: "fail" });
  assert.equal(checkSummary([]).state, null);
  assert.equal(checkSummary(["pass", "unknown"]).state, "unknown");
});

const job = (workflowName, name, conclusion, startedAt) => ({ ...run("COMPLETED", conclusion, name), workflowName, startedAt });

test("One job is its kind, workflow and name: a namesake never hides a failure", async () => {
  const { rollupState, onePerJob } = await load("kanso-panel/ghchecks.js", ["rollupState", "onePerJob"]);
  const twoWorkflows = [job("CI", "test", "SUCCESS"), job("Nightly", "test", "FAILURE")];
  assert.equal(onePerJob(twoWorkflows).length, 2);
  assert.equal(rollupState(twoWorkflows), "fail", "two workflows, each with a job called test");
  const kinds = [run("COMPLETED", "SUCCESS", "deploy"), commit("FAILURE", "deploy")];
  assert.equal(onePerJob(kinds).length, 2);
  assert.equal(rollupState(kinds), "fail", "a check run and a commit status with the same name");
  assert.equal(rollupState([job("CI", "lint", "SUCCESS"), job("Other", "lint", "SOMETHING_NEW")]), "unknown", "an unknown is not hidden by a successful namesake");
  const viaSuite = (workflow, conclusion) => ({ ...run("COMPLETED", conclusion, "test"), checkSuite: { workflowRun: { workflow: { name: workflow } } } });
  assert.equal(rollupState([viaSuite("CI", "SUCCESS"), viaSuite("Nightly", "FAILURE")]), "fail", "the workflow from its check suite");
});

test("Of the same key the worst is kept, whatever the times say", async () => {
  const { rollupState, onePerJob, checkState } = await load("kanso-panel/ghchecks.js", ["rollupState", "onePerJob", "checkState"]);
  // Two workflow files both named CI, each with a job called test: one key, two jobs.
  const sameName = [job("CI", "test", "FAILURE", "2026-11-08T10:00:00Z"), job("CI", "test", "SUCCESS", "2026-11-08T11:00:00Z")];
  assert.equal(rollupState(sameName), "fail", "a later success never hides an independent failure");
  assert.equal(rollupState(sameName.toReversed()), "fail", "whatever the order listed");
  const apps = [job("", "test", "SUCCESS"), job("", "test", "FAILURE")];
  assert.equal(rollupState(apps), "fail", "two apps both reporting test, no workflow");
  // gh exports a queued run's missing start as the zero time.
  const queued = [job("CI", "test", "SUCCESS", "2026-11-08T10:00:00Z"), { ...run("QUEUED", "", "test"), workflowName: "CI", startedAt: "0001-01-01T00:00:00Z" }];
  assert.equal(rollupState(queued), "pending", "a queued rerun is not hidden by the old success");
  assert.equal(checkState(onePerJob(queued)[0]), "pending");
  assert.equal(rollupState([job("CI", "test", "SUCCESS"), job("CI", "test", "SOMETHING_NEW")]), "unknown");
  assert.equal(onePerJob([job("CI", "test", "SUCCESS"), job("CI", "test", "SUCCESS")]).length, 1, "equals: the first listed");
  assert.equal(onePerJob([run("COMPLETED", "SUCCESS"), run("COMPLETED", "FAILURE")]).length, 2, "nameless ones are all kept");
});

test("The header's digest and the PR panel agree on the same checks", async () => {
  const { checksOf } = await load("kanso-strip/main.js", ["checksOf"]);
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {});
  const panel = Object.create(PullRequest.prototype);
  const colors = { dim: "dim", red: "red", yellow: "yellow", green: "green", violet: "violet" };
  // The panel's row says it in words; the header in one of four.
  const panelSays = (rollup) => {
    const text = panel.rowState({ state: "OPEN", statusCheckRollup: rollup }, colors).text;
    return /failing$/.test(text) ? "failing" : /running$/.test(text) ? "running" : /unknown$/.test(text) ? "unknown" : text === "Checks passed" ? "passing" : null;
  };
  const cases = [
    [],
    [run("COMPLETED", "SUCCESS", "a"), commit("SUCCESS", "b")],
    [run("COMPLETED", "STALE", "a")],
    [run("COMPLETED", "SUCCESS", "a"), run("COMPLETED", "SOMETHING_NEW", "b")],
    [run("COMPLETED", "SUCCESS", "a"), commit("EXPECTED", "b")],
    [run("QUEUED", "", "a"), run("COMPLETED", "TIMED_OUT", "b")],
    [run("COMPLETED", "", "a")],
    [commit("ERROR", "a"), run("COMPLETED", "SKIPPED", "b")],
    [job("CI", "test", "SUCCESS"), job("Nightly", "test", "FAILURE")],
    [run("COMPLETED", "SUCCESS", "deploy"), commit("PENDING", "deploy")],
    [job("CI", "test", "FAILURE", "2026-11-08T10:00:00Z"), job("CI", "test", "SUCCESS", "2026-11-08T11:00:00Z")],
    [run("COMPLETED", "SKIPPED", "a"), run("COMPLETED", "NEUTRAL", "b")],
    [job("CI", "test", "SUCCESS", "2026-11-08T10:00:00Z"), { ...run("QUEUED", "", "test"), workflowName: "CI", startedAt: "0001-01-01T00:00:00Z" }],
  ];
  for (const rollup of cases) assert.equal(checksOf(rollup), panelSays(rollup), JSON.stringify(rollup));
});
