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

const CAN_MERGE = new Set(["CLEAN", "HAS_HOOKS"]);
const WRITERS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
export const READY_TEXT = "Ready to merge";
const NO_PERMISSION = "No permission to merge";

const checkLine = (checks) => {
  if (!checks?.state || checks.state === "pass") return null;
  const verb = { fail: "failing", pending: "running", unknown: "unknown" }[checks.state];
  if (!verb) return null;
  const n = checks[checks.state] || 1;
  return `${n} check${n > 1 ? "s" : ""} ${verb}`;
};

// Whether GitHub would merge this, and the few words for why not. UNKNOWN is still computing.
export function mergeReadiness(pr, { permission = null, checks = null } = {}) {
  const status = String(pr?.mergeStateStatus ?? "").toUpperCase();
  const review = pr?.reviewDecision || null;
  const state = String(pr?.state ?? "OPEN").toUpperCase();
  const base = pr?.baseRefName || "base";
  const blocked = () => {
    if (review === "CHANGES_REQUESTED") return { offer: false, text: "Changes requested", tone: "red" };
    if (review === "REVIEW_REQUIRED") return { offer: false, text: "Review required", tone: "yellow" };
    const line = checkLine(checks);
    if (line) return { offer: false, text: line, tone: checks.state === "fail" ? "red" : "yellow" };
    return { offer: false, text: "Blocked by branch rules", tone: "yellow" };
  };
  if (state === "MERGED") return { offer: false, text: "Merged", tone: "violet" };
  if (state === "CLOSED") return { offer: false, text: "Closed without merging", tone: "red" };
  if (pr?.isDraft || status === "DRAFT") return { offer: false, text: "Draft", tone: "dim" };
  if (pr?.mergeable === "CONFLICTING" || status === "DIRTY") return { offer: false, text: `Conflicts with ${base}`, tone: "red" };
  if (!status || status === "UNKNOWN") return { offer: false, text: "Checking whether it can merge…", tone: "dim" };
  if (status === "BEHIND") return { offer: false, text: `Behind ${base}`, tone: "yellow" };
  if (status === "BLOCKED" || !CAN_MERGE.has(status)) return blocked();
  if (!WRITERS.has(String(permission ?? "").toUpperCase())) {
    return permission
      ? { offer: false, text: NO_PERMISSION, tone: "dim" }
      : { offer: false, text: "Checking whether it can merge…", tone: "dim", awaitingPermission: true };
  }
  return { offer: true, text: READY_TEXT, tone: "green" };
}

// The strip never reads permission, so the header claims nothing about it.
export function headerHold(view) {
  const checks = checkSummary(onePerJob(view?.statusCheckRollup).map(checkState));
  const gate = mergeReadiness(view, { permission: view?.viewerPermission ?? null, checks });
  if (gate.awaitingPermission || gate.text === NO_PERMISSION || gate.text === READY_TEXT) return null;
  return gate.text;
}

const JOB = 24;
const clipJob = (name) => {
  const text = String(name).trim();
  return text.length <= JOB ? text : text.slice(0, JOB).trim();
};

const jobFacts = (view) => {
  if (!view || !("statusCheckRollup" in view) || view.statusCheckRollup == null) return null;
  const jobs = onePerJob(view.statusCheckRollup);
  const states = jobs.map(checkState);
  const summary = checkSummary(states);
  const names = jobs.filter((_c, i) => states[i] === "fail").map((c) => nameOf(c)).filter((n) => n != null && String(n).trim());
  return { fail: summary.fail, pending: summary.pending, failed: summary.fail === 1 ? (names[0] ?? null) : null };
};

export function prFacts(view) {
  if (view?.number == null) return null;
  const jobs = jobFacts(view) ?? { fail: view.fail ?? 0, pending: view.pending ?? 0, failed: view.failed ?? null };
  return {
    number: view.number, state: view.state ?? null, isDraft: Boolean(view.isDraft),
    mergeable: view.mergeable ?? null, mergeStateStatus: view.mergeStateStatus ?? null,
    reviewDecision: view.reviewDecision ?? null, baseRefName: view.baseRefName ?? null,
    fail: jobs.fail, pending: jobs.pending, failed: jobs.failed,
  };
}

const viewOf = (d) => {
  if (!d || typeof d !== "object") return null;
  if (d.pr && typeof d.pr === "object") return d.pr;
  if (d.number != null || d.statusCheckRollup != null || d.mergeStateStatus || d.reviewDecision || d.isDraft) return d;
  return null;
};

const said = (text, tone, section, check = null) => ({ text, tone, section, check });

export function prLine(d) {
  const view = viewOf(d);
  if (!view) return null;
  const state = String(view.state ?? "OPEN").toUpperCase();
  if (state !== "OPEN") return null;
  const status = String(view.mergeStateStatus ?? "").toUpperCase();
  const base = view.baseRefName || "base";
  if (view.isDraft || status === "DRAFT") return said("draft", "dim", "draft");
  if (view.mergeable === "CONFLICTING" || status === "DIRTY") return said(`conflicts with ${base}`, "blocked", "conflicts");
  if (!status || status === "UNKNOWN") return null;
  if (status === "BEHIND") return said(`behind ${base}`, "working", "behind");
  const jobs = jobFacts(view) ?? { fail: view.fail ?? 0, pending: view.pending ?? 0, failed: view.failed ?? null };
  if (status === "BLOCKED" || !CAN_MERGE.has(status)) {
    if (jobs.fail > 1) return said(`${jobs.fail} checks failing`, "blocked", "checks");
    if (jobs.fail === 1) return jobs.failed
      ? said(`${clipJob(jobs.failed)} failed`, "blocked", "checks", jobs.failed)
      : said("checks failing", "blocked", "checks");
    if (view.reviewDecision === "CHANGES_REQUESTED") return said("changes requested", "blocked", "threads");
    if (view.reviewDecision === "REVIEW_REQUIRED") return said("review required", "working", "review");
    if (jobs.pending > 0) return said("checks running", "working", "checks");
  }
  // The header does not know merge permission, so a clean pull request says nothing.
  return null;
}
