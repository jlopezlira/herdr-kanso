// Kanso's GitHub checks, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: npm run sync:share copies it, and a test fails when a copy differs.
// The pull request panel and the pane strip read checks here, so they never disagree.
// gh's statusCheckRollup holds check runs (status, then a conclusion once
// completed) and commit statuses (a state). A value not listed below is
// "unknown", never a pass: GitHub adds values, and a new one must not read as green.
import { plural } from "./pure.js";

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
export const isWriter = (permission) => WRITERS.has(String(permission ?? "").toUpperCase());
export const READY_TEXT = "Ready to merge";

export function jobLabel(check) {
  const name = check?.name || "";
  const workflow = check?.workflowName || "";
  if (!name) return "Check";
  if (!workflow || workflow === name) return name;
  return `${workflow} / ${name}`;
}

export function runIdOf(check) {
  if (!check || typeof check !== "object") return null;
  const fromUrl = /\/actions\/runs\/(\d+)/.exec(String(check.detailsUrl || check.url || ""));
  if (fromUrl) return fromUrl[1];
  const id = check.checkSuite?.workflowRun?.databaseId;
  return id != null && id !== "" ? String(id) : null;
}
const NO_PERMISSION = "No permission to merge";
const CHANGES = "Changes requested";
const REVIEW = "Review required";
const DRAFT = "Draft";
const BLOCKED = "Blocked by branch rules";
const CHECKING = "Checking whether it can merge…";
const CLOSED = "Closed without merging";

export function checkLine(checks) {
  if (!checks?.state || checks.state === "pass") return null;
  const verb = { fail: "failing", pending: "running", unknown: "unknown" }[checks.state];
  if (!verb) return null;
  const n = checks[checks.state] || 1;
  return `${plural(n, "check", "checks")} ${verb}`;
}

const say = (id, text, tone, extra = {}) => ({ offer: false, text, tone, id, ...extra });

// Whether GitHub would merge this, and the few words for why not. UNKNOWN is still computing.
export function mergeReadiness(pr, { permission = null, checks = null } = {}) {
  const status = String(pr?.mergeStateStatus ?? "").toUpperCase();
  const review = pr?.reviewDecision || null;
  const state = String(pr?.state ?? "OPEN").toUpperCase();
  const base = pr?.baseRefName || "base";
  const blocked = () => {
    if (review === "CHANGES_REQUESTED") return say("changes", CHANGES, "red");
    if (review === "REVIEW_REQUIRED") return say("review", REVIEW, "yellow");
    const line = checkLine(checks);
    if (line) return say(checks.state === "fail" ? "failed" : checks.state === "pending" ? "running" : "unknown", line, checks.state === "fail" ? "red" : "yellow");
    return say("blocked", BLOCKED, "yellow");
  };
  if (state === "MERGED") return say("merged", "Merged", "violet");
  if (state === "CLOSED") return say("closed", CLOSED, "red");
  if (pr?.isDraft || status === "DRAFT") return say("draft", DRAFT, "dim");
  if (pr?.mergeable === "CONFLICTING" || status === "DIRTY") return say("conflicts", `Conflicts with ${base}`, "red");
  if (!status || status === "UNKNOWN") return say("computing", CHECKING, "dim");
  if (status === "BEHIND") return say("behind", `Behind ${base}`, "yellow");
  if (status === "BLOCKED" || !CAN_MERGE.has(status)) return blocked();
  if (!isWriter(permission)) {
    return permission
      ? say("permission", NO_PERMISSION, "dim")
      : say("computing", CHECKING, "dim", { awaitingPermission: true });
  }
  return { offer: true, text: READY_TEXT, tone: "green", id: "ready" };
}

// A list row never waits on permission: the check or review line, never "ready".
export function listHold(pr, checks) {
  const line = checkLine(checks);
  if (checks?.state === "fail" && line) return say("failed", line, "red");
  if (pr?.reviewDecision === "CHANGES_REQUESTED") return say("changes", CHANGES, "red");
  if (line) return say(checks.state === "pending" ? "running" : "unknown", line, "yellow");
  if (pr?.isDraft) return say("draft", DRAFT, "dim");
  if (pr?.reviewDecision === "APPROVED") return say("approved", "Approved", "green");
  if (pr?.reviewDecision === "REVIEW_REQUIRED") return say("review", REVIEW, "yellow");
  if (checks?.state === "pass") return say("passed", "Checks passed", "green");
  return say("open", "Open", "dim");
}

// The strip never reads permission, so the header claims nothing about it.
export function headerHold(view) {
  const checks = checkSummary(onePerJob(view?.statusCheckRollup).map(checkState));
  const gate = mergeReadiness(view, { permission: view?.viewerPermission ?? null, checks });
  if (gate.awaitingPermission || gate.text === NO_PERMISSION || gate.text === READY_TEXT) return null;
  return gate.text;
}
