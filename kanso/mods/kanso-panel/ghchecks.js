// Kanso's GitHub checks, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: npm run sync:share copies it, and a test fails when a copy differs.
// The pull request panel and the pane strip read checks here, so they never disagree.
// gh's statusCheckRollup holds check runs (status, then a conclusion once
// completed) and commit statuses (a state). A value not listed below is
// "unknown", never a pass: GitHub adds values, and a new one must not read as green.

const PASSED = new Set(["SUCCESS", "NEUTRAL"]);
// STALE: GitHub gave up on a run left incomplete; only a rerun passes it.
const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const WAITING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"]);

const upper = (v) => String(v ?? "").toUpperCase();
const valueState = (v) => (v === "SKIPPED" ? "skipped" : PASSED.has(v) ? "pass" : FAILED.has(v) ? "fail" : WAITING.has(v) ? "pending" : "unknown");
const isStatus = (c) => c.__typename === "StatusContext" || (!c.__typename && c.state != null && c.status == null && c.conclusion == null);

// One check: "pass", "skipped", "pending", "fail" or "unknown". Skipped counts as passed.
export function checkState(c) {
  if (!c || typeof c !== "object") return "unknown";
  if (isStatus(c)) return valueState(upper(c.state));
  const status = upper(c.status), conclusion = upper(c.conclusion);
  if (status && status !== "COMPLETED") return WAITING.has(status) ? "pending" : "unknown";
  // Completed with no conclusion says nothing; without a status, the conclusion is all there is.
  return conclusion ? valueState(conclusion) : "unknown";
}

// One job is its kind, workflow and name: two workflows may each have a `test`,
// and a commit status may share a check run's name; none of them hides another.
const nameOf = (c) => (isStatus(c) ? c.context : c.name) ?? null;
const workflowOf = (c) => c.workflowName ?? c.checkSuite?.workflowRun?.workflow?.name ?? "";
const keyOf = (c) => (c && typeof c === "object" && nameOf(c) != null ? JSON.stringify([isStatus(c) ? "status" : "run", workflowOf(c), nameOf(c)]) : null);
const startOf = (c) => String(c.startedAt ?? c.createdAt ?? "");

// Each job's latest run (the first listed when they started together): a rerun
// replaces the run before it. Checks without a name are all kept.
export function latestChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  const keys = list.map(keyOf);
  const newer = (x, j, c, i) => startOf(x) > startOf(c) || (startOf(x) === startOf(c) && j < i);
  return list.filter((c, i) => keys[i] === null || !list.some((x, j) => j !== i && keys[j] === keys[i] && newer(x, j, c, i)));
}

// The count of each state, and what they say together: null with none; any
// failure wins, then one still running, then one unknown; "pass" only when every
// check passed or was skipped.
const RANK = ["fail", "pending", "unknown"];
export function checkSummary(states) {
  const zero = { fail: 0, pending: 0, unknown: 0, pass: 0, skipped: 0 };
  const n = states.reduce((acc, s) => ({ ...acc, [s]: acc[s] + 1 }), zero);
  return { ...n, total: states.length, state: states.length ? RANK.find((s) => n[s] > 0) ?? "pass" : null };
}

export const rollupState = (rollup) => checkSummary(latestChecks(rollup).map(checkState)).state;
