// What the pull request panel says, and the one action that state can take.
import { checkSummary, isWriter, jobLabel, mergeReadiness, runIdOf } from "./ghchecks.js";

export const LOG_LINES = 12;
export const COMMENT_LINES = 8;
export const COMMIT_LINES = 5;
export const CLI_URL = "https://cli.github.com";

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const commitLine = (n, tail) => (n > 0 ? `${count(n, "commit", "commits")} ${tail}` : `Commits ${tail}`);

const blank = (partial) => ({
  facts: null, details: false, detailsNote: null, body: null, primary: null, quiet: null,
  more: null, note: null, writes: [], logKey: null, runId: null, ...partial,
});

const push = { id: "pr-push", label: "Push", press: "Press again to push", target: "push", armed: true, write: true, busy: "Push", busyLabel: "Pushing…" };
const pull = { id: "pr-pull", label: "Pull", press: "Press again to pull", target: "pull", armed: true, write: true, busy: "Pull", busyLabel: "Pulling…" };
const update = { id: "pr-update", label: "Update branch", press: "Press again to update the branch", target: "update", armed: true, write: true, busy: "Update", busyLabel: "Updating…" };
const ready = { id: "pr-ready", label: "Ready for review", press: "Press again to mark it ready", target: "ready", armed: true, write: true, busy: "Ready", busyLabel: "Marking ready…" };
const merge = { id: "pr-merge", label: "Squash and merge", press: "Press again to squash and merge", target: "merge", armed: true, write: true, busy: "Merge", busyLabel: "Merging…" };
const send = { id: "pr-send", label: "Send", target: "send", armed: false, write: false };
const create = { id: "pr-create", label: "Create on GitHub", target: "create", armed: false, write: false, busy: "Create", busyLabel: "Opening GitHub…" };
const signIn = { id: "pr-sign-in", label: "Sign in", target: "sign-in", armed: false, write: false };
const reopen = { id: "pr-reopen", label: "Reopen", press: "Press again to reopen", target: "reopen", armed: true, write: true, busy: "Reopen", busyLabel: "Reopening…" };

const close = { id: "pr-close", label: "Close", press: "Press again to close", target: "close", armed: true, write: true, busy: "Close", busyLabel: "Closing…" };
const draftBack = { id: "pr-draft", label: "Back to draft", press: "Press again to return to draft", target: "draft", armed: true, write: true, busy: "Draft", busyLabel: "Returning…" };

const link = (id, label, target, url) => ({ id, label, target, url, armed: false, write: false });

export function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function elapsed(from, to, now) {
  const start = Date.parse(from);
  const end = to == null ? now : Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const s = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function firstLines(text, n) {
  return String(text ?? "").split("\n").slice(0, n).join("\n");
}

const BAD_LINE = /^(?:FAIL|ERROR)\b|##\[error\]|AssertionError/i;
export const logLineTone = (line) => (BAD_LINE.test(line) ? "blocked" : "muted");

const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;

export function failedLog(text) {
  const rows = String(text ?? "").split("\n").filter((line) => line.length > 0);
  const groups = rows.reduce((acc, row) => {
    const parts = row.split("\t");
    const job = parts.length >= 3 ? parts[0] : "";
    const step = parts.length >= 3 ? parts[1] : "";
    const line = (parts.length >= 3 ? parts.slice(2).join("\t") : row).replace(STAMP, "");
    const last = acc.at(-1);
    if (last && last.job === job && last.step === step) return [...acc.slice(0, -1), { ...last, lines: [...last.lines, line] }];
    return [...acc, { job, step, lines: [line] }];
  }, []);
  return groups.map((group) => ({ ...group, lines: group.lines.slice(-LOG_LINES) }));
}

const sameJob = (group, check) => {
  const job = String(group?.job ?? "").toLowerCase();
  const name = String(check?.name ?? "").toLowerCase();
  const label = jobLabel(check).toLowerCase();
  if (!job) return false;
  return job === name || job === label || label.endsWith(` / ${job}`) || label.endsWith(job);
};

export function logGroup(groups, check) {
  if (!groups?.length) return null;
  return groups.find((group) => sameJob(group, check)) ?? groups[0];
}

function peopleOf(pr) {
  const names = [
    pr.author?.login,
    ...(pr.assignees ?? []).map((a) => a.login),
    ...(pr.latestReviews ?? []).map((r) => r.author?.login),
    ...(pr.reviewRequests ?? []).map((r) => r.login),
  ].filter(Boolean);
  return new Set(names).size;
}

function factLine(pr, threads) {
  const commits = Array.isArray(pr.commits) ? pr.commits.length : null;
  return [
    pr.changedFiles != null ? `${count(pr.changedFiles, "file", "files")}  +${pr.additions ?? 0} −${pr.deletions ?? 0}` : null,
    commits != null ? count(commits, "commit", "commits") : null,
    threads > 0 ? count(threads, "thread", "threads") : null,
  ].filter(Boolean).join(" · ");
}

function noteLine(pr, checks) {
  return [
    count(checks.length, "check", "checks"),
    count(peopleOf(pr), "person", "people"),
    pr.changedFiles != null ? count(pr.changedFiles, "file", "files") : null,
  ].filter(Boolean).join(" · ");
}

function withFacts(view, scene) {
  const pr = scene.pr;
  if (!pr) return view;
  return { ...view, facts: factLine(pr, (scene.threads ?? []).length), detailsNote: noteLine(pr, scene.checks ?? []) };
}

function writesFor(pr) {
  if (String(pr.state ?? "OPEN").toUpperCase() !== "OPEN") return [];
  if (pr.isDraft || String(pr.mergeStateStatus ?? "").toUpperCase() === "DRAFT") return [close];
  return [draftBack, close];
}

function failedView(scene, failing) {
  const first = failing[0];
  const group = logGroup(scene.log, first);
  const lines = (group?.lines ?? []).map((text) => ({ text, tone: logLineTone(text) }));
  const extra = failing.length - 1;
  const runId = first.runId || runIdOf(first);
  return blank({
    id: "failed",
    text: `${jobLabel(first)} failed`,
    tone: "blocked",
    details: true,
    writes: writesFor(scene.pr),
    logKey: runId ? String(runId) : null,
    runId: runId ? String(runId) : null,
    body: { kind: "log", job: jobLabel(first), step: group?.step || "", elapsed: elapsed(first.startedAt, first.completedAt, scene.now), lines },
    primary: send,
    quiet: link("pr-log", "Open log on GitHub", "log", first.url || scene.pr.url),
    more: extra > 0 ? link("pr-more-fail", extra === 1 ? "+1 more" : `+${extra} more`, "failures") : null,
  });
}

function commentView(scene, threads) {
  const th = threads[0];
  const extra = threads.length - 1;
  const card = th ? {
    kind: "comment",
    author: th.author || "",
    letter: String(th.author || "?").slice(0, 1).toUpperCase(),
    path: th.path || "",
    line: th.line || "",
    text: firstLines(th.body, COMMENT_LINES),
  } : null;
  return blank({
    id: "changes",
    text: "Changes requested",
    tone: "blocked",
    details: true,
    writes: writesFor(scene.pr),
    body: card,
    primary: send,
    quiet: link("pr-reply", "Reply on GitHub", "reply", th?.url || scene.pr.url),
    more: extra > 0 ? link("pr-more-thread", extra === 1 ? "+1 more thread" : `+${extra} more threads`, "details") : null,
  });
}

function heldRows(checks) {
  return checks.filter((c) => c.state === "fail" || c.state === "pending" || c.state === "unknown");
}

function draftNote(checks) {
  const sum = checkSummary(checks.map((c) => c.state));
  if (!sum.state || sum.state === "pass") return null;
  const word = { fail: "failing", pending: "running", unknown: "unknown" }[sum.state];
  return word ? `${count(sum[sum.state], "check", "checks")} ${word}` : null;
}

function prVerdict(scene) {
  const pr = scene.pr;
  const state = String(pr.state ?? "OPEN").toUpperCase();
  const status = String(pr.mergeStateStatus ?? "").toUpperCase();
  const checks = scene.checks ?? [];
  const threads = scene.threads ?? [];
  const failing = checks.filter((c) => c.state === "fail");
  const pending = checks.filter((c) => c.state === "pending");
  const unknown = checks.filter((c) => c.state === "unknown");
  const base = pr.baseRefName || "main";
  const head = pr.headRefName || scene.branch || "the branch";
  const gate = mergeReadiness(pr, { permission: scene.permission ?? null, checks: checkSummary(checks.map((c) => c.state)) });
  const writes = writesFor(pr);
  if (state === "MERGED") {
    const when = clockOf(pr.mergedAt || pr.closedAt || pr.updatedAt);
    return blank({ id: "merged", text: when ? `Merged ${when}` : "Merged", tone: "violet", details: true });
  }
  if (state === "CLOSED") return blank({ id: "closed", text: "Closed without merging", tone: "dim", details: true, quiet: reopen });
  if (pr.isDraft || status === "DRAFT") {
    const held = heldRows(checks);
    return blank({
      id: "draft", text: "Draft", tone: "dim", details: true, writes, primary: ready, note: draftNote(checks),
      body: held.length ? { kind: "checks", summary: draftNote(checks), rows: held.map((c) => ({ name: jobLabel(c), state: c.state })) } : null,
    });
  }
  if (pr.mergeable === "CONFLICTING" || status === "DIRTY") {
    return blank({
      id: "conflicts", text: `Conflicts with ${base}`, tone: "blocked", details: true, writes, primary: send,
      quiet: link("pr-github", "Open on GitHub", "github", pr.url), head, base,
    });
  }
  if (failing.length) return failedView(scene, failing);
  if (pr.reviewDecision === "CHANGES_REQUESTED") return commentView(scene, threads);
  if (status === "BEHIND") {
    const n = scene.baseBehind;
    return blank({
      id: "behind-base",
      text: n > 0 ? `Behind ${base} by ${n}` : `Behind ${base}`,
      tone: "working",
      details: true,
      writes,
      primary: isWriter(scene.permission) ? update : null,
    });
  }
  if (pending.length) {
    return blank({
      id: "running",
      text: `Checks running · ${pending.length} of ${checks.length}`,
      tone: "working",
      details: true,
      writes,
      body: { kind: "running", rows: pending.map((c) => ({ name: c.name, workflow: c.workflow || "", elapsed: elapsed(c.startedAt, null, scene.now) })) },
    });
  }
  if (unknown.length) {
    return blank({
      id: "unknown",
      text: `${count(unknown.length, "check", "checks")} unknown`,
      tone: "working",
      details: true,
      writes,
      body: { kind: "checks", rows: unknown.map((c) => ({ name: jobLabel(c), state: c.state })) },
    });
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") {
    const asked = (pr.reviewRequests ?? []).map((r) => r.login || r.name).filter(Boolean);
    return blank({ id: "review", text: "Review required", tone: "working", details: true, writes, body: asked.length ? { kind: "lines", lines: asked } : null });
  }
  if (status === "BLOCKED") return blank({ id: "blocked", text: "Blocked by branch rules", tone: "working", details: true, writes });
  if (!status || status === "UNKNOWN") return blank({ id: "computing", text: "Checking whether it can merge…", tone: "dim", details: true, writes });
  if (!isWriter(scene.permission)) {
    return scene.permission
      ? blank({ id: "permission", text: "No permission to merge", tone: "muted", details: true, writes })
      : blank({ id: "computing", text: "Checking whether it can merge…", tone: "dim", details: true, writes });
  }
  if (gate.offer) {
    const sum = checkSummary(checks.map((c) => c.state));
    const approvals = (pr.latestReviews ?? []).filter((r) => r.state === "APPROVED").length;
    const passed = (sum.pass || 0) + (sum.skipped || 0);
    return blank({
      id: "ready", text: "Ready to merge", tone: "done", details: true, writes, primary: merge,
      body: { kind: "note", text: `${count(approvals, "approval", "approvals")} · ${count(passed, "check", "checks")} passed` },
    });
  }
  return blank({ id: "blocked", text: gate.text || "Blocked by branch rules", tone: "working", details: true, writes, head, base });
}

function emptyVerdict(scene) {
  const kind = scene.kind;
  if (kind === "folder" || kind === "outside") return blank({ id: "folder", text: `No repository in ${scene.place || "~"}`, tone: "muted" });
  if (kind === "absent") return blank({ id: "absent", text: "GitHub CLI not installed", tone: "muted", quiet: link("pr-cli", "cli.github.com", "cli", CLI_URL) });
  if (kind === "auth") {
    const text = scene.computer ? `Not signed in to GitHub on ${scene.computer}` : "Not signed in to GitHub";
    return blank({ id: "auth", text, tone: "muted", primary: signIn });
  }
  if (kind === "missing") return blank({ id: "missing", text: scene.title || "No remote", tone: "muted" });
  if (kind === "detached") return blank({ id: "detached", text: "No branch checked out", tone: "muted" });
  if (kind === "base") return blank({ id: "base", text: `${scene.branch} is the default branch`, tone: "muted", details: true });
  if (kind === "behind") return blank({ id: "behind", text: commitLine(scene.behindCount, "behind GitHub"), tone: "working", primary: pull });
  if (kind === "unpushed") {
    return blank({
      id: "unpushed", text: commitLine(scene.ahead, "not on GitHub"), tone: "working", primary: push,
      body: { kind: "commits", lines: (scene.subjects ?? []).slice(0, COMMIT_LINES) },
    });
  }
  if (kind === "none") {
    return blank({
      id: "none", text: `No pull request for ${scene.branch}`, tone: "muted", details: true,
      primary: scene.canCreate ? create : null,
    });
  }
  return blank({ id: "empty", text: "", tone: "muted" });
}

function applyAgent(view, agent) {
  if (view.primary?.target !== "send") return view;
  if (agent?.blocked) return { ...view, text: `${view.text} · ${agent.name} needs you first`, primary: null };
  if (!agent?.isAgent) {
    if (!view.quiet) return { ...view, primary: null };
    return { ...view, primary: { ...view.quiet, armed: false, write: false }, quiet: null };
  }
  return { ...view, primary: { ...view.primary, label: `Send to ${agent.name}` } };
}

function settle(view, stale) {
  const mark = (action) => {
    if (!action) return null;
    const disabled = Boolean(action.disabled) || (Boolean(stale) && Boolean(action.write));
    return { ...action, disabled, acts: !disabled };
  };
  return {
    ...view,
    dimmed: Boolean(stale),
    primary: mark(view.primary),
    quiet: mark(view.quiet),
    more: mark(view.more),
    writes: (view.writes ?? []).map(mark),
  };
}

export function verdictOf(scene = {}) {
  const built = scene.pr ? withFacts(prVerdict(scene), scene) : emptyVerdict(scene);
  return settle(applyAgent(built, scene.agent), scene.stale);
}

export function sendText(scene, verdict) {
  const url = scene.pr?.url || "";
  if (verdict?.id === "failed") {
    const card = verdict.body;
    return [card?.job, card?.step, ...(card?.lines ?? []).map((line) => line.text), url].filter((line) => line != null && line !== "").join("\n");
  }
  if (verdict?.id === "changes") {
    const card = verdict.body;
    if (!card) return url;
    const where = `${card.author} ${card.path}${card.line ? `:${card.line}` : ""}`.trim();
    return [where, card.text, url].filter((line) => line != null && line !== "").join("\n");
  }
  if (verdict?.id === "conflicts") {
    const base = scene.pr?.baseRefName || "main";
    const head = scene.pr?.headRefName || scene.branch || "the branch";
    return `Merge origin/${base} into ${head} and resolve the conflicts.\n${url}`;
  }
  return url;
}

export function sendStep(shown, message) {
  if (!message) return { show: false, deliver: false };
  if (!shown) return { show: true, deliver: false };
  return { show: false, deliver: true };
}
