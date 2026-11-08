// Kanso's GitHub checks, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: npm run sync:share copies it, and a test fails when a copy differs.
// The pull request panel and the pane strip read checks here, so they never disagree.
// gh's statusCheckRollup holds check runs (status, then a conclusion once
// completed) and commit statuses (a state). A value not listed below is
// "unknown", never a pass: GitHub adds values, and a new one must not read as green.

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
// STALE: GitHub gave up on a run left incomplete; only a rerun passes it.
const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const WAITING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"]);

const upper = (v) => String(v ?? "").toUpperCase();
const valueState = (v) => (PASSED.has(v) ? "pass" : FAILED.has(v) ? "fail" : WAITING.has(v) ? "pending" : "unknown");
const isStatus = (c) => c.__typename === "StatusContext" || (!c.__typename && c.state != null && c.status == null && c.conclusion == null);

// One check: "pass", "pending", "fail" or "unknown".
export function checkState(c) {
  if (!c || typeof c !== "object") return "unknown";
  if (isStatus(c)) return valueState(upper(c.state));
  const status = upper(c.status), conclusion = upper(c.conclusion);
  if (status && status !== "COMPLETED") return WAITING.has(status) ? "pending" : "unknown";
  // Completed with no conclusion says nothing; without a status, the conclusion is all there is.
  return conclusion ? valueState(conclusion) : "unknown";
}

// The first of each name, as the panel lists them: a rerun or a second trigger
// repeats a name, and both surfaces must count the same ones.
export function latestChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  const nameOf = (c) => c?.name ?? c?.context ?? null;
  return list.filter((c, i) => nameOf(c) == null || list.findIndex((x) => nameOf(x) === nameOf(c)) === i);
}

// All of them: null with none; any failure wins, then one still running, then
// one unknown; "pass" only when every check passed.
const RANK = ["fail", "pending", "unknown", "pass"];
export function rollupState(rollup) {
  const states = latestChecks(rollup).map(checkState);
  return states.length ? RANK.find((s) => states.includes(s)) : null;
}
