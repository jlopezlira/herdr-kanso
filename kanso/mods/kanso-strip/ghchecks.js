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

// The states, worst first: what a pull request's checks say together, and the order to list them in.
export const STATES = ["fail", "pending", "unknown", "skipped", "pass"];
const rank = (s) => STATES.indexOf(s);

// A job is its kind, workflow and name. Neither that nor gh's times tell a rerun
// from an independent namesake (two workflow files both called CI, two apps both
// reporting `test`; a queued rerun has no start time), so of the same key the
// worst is kept: a duplicate never turns a failure, a rerun or an unknown into a pass.
const nameOf = (c) => (isStatus(c) ? c.context : c.name) ?? null;
const workflowOf = (c) => c.workflowName ?? c.checkSuite?.workflowRun?.workflow?.name ?? "";
const keyOf = (c) => (c && typeof c === "object" && nameOf(c) != null ? JSON.stringify([isStatus(c) ? "status" : "run", workflowOf(c), nameOf(c)]) : null);

// One check per job, the worst of it (the first listed of equals). Checks without a name are all kept.
export function onePerJob(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  const keys = list.map(keyOf), ranks = list.map((c) => rank(checkState(c)));
  const beats = (j, i) => ranks[j] < ranks[i] || (ranks[j] === ranks[i] && j < i);
  return list.filter((_c, i) => keys[i] === null || !list.some((_x, j) => j !== i && keys[j] === keys[i] && beats(j, i)));
}

// The count of each state, and what they say together: null with none, else the
// worst there is; "pass" only when every check passed or was skipped.
export function checkSummary(states) {
  const n = states.reduce((acc, s) => ({ ...acc, [s]: acc[s] + 1 }), Object.fromEntries(STATES.map((s) => [s, 0])));
  const worst = STATES.find((s) => n[s] > 0) ?? null;
  return { ...n, total: states.length, state: worst === "skipped" ? "pass" : worst };
}

export const rollupState = (rollup) => checkSummary(onePerJob(rollup).map(checkState)).state;
