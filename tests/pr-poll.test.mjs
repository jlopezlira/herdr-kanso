// What the pull request panel asks, and what it keeps when GitHub does not answer.
import assert from "node:assert/strict";
import test from "node:test";
import { load, context, tape, singleUse } from "./helpers.mjs";

const TONE = { dim: "dim", muted: "muted", text: "text", border: "border", red: "red", yellow: "yellow", green: "green" };

const ticksFrom = (t, from, pending, until, readDue, tick) => {
  if (t > until) return [];
  const due = readDue(from, t, pending);
  const rest = ticksFrom(t + tick, due ? t : from, pending, until, readDue, tick);
  return due ? [t, ...rest] : rest;
};

const refreshTicks = ({ pending = false, until = 60_000, loadedAt = 0, readDue, tick }) => ticksFrom(tick, loadedAt, pending, until, readDue, tick);

test("the panel reads once a minute at rest, and every 20 seconds while a check runs", async () => {
  const { readDue, TICK_MS, QUIET_MS } = await load("kanso-panel/pr-poll.js", ["readDue", "TICK_MS", "QUIET_MS"], {});
  const at = (opts) => refreshTicks({ readDue, tick: TICK_MS, ...opts });
  assert.equal(at().join(","), "60000");
  assert.equal(at({ pending: true }).join(","), "20000,40000,60000");
  assert.equal(readDue(0, TICK_MS, false), false);
  assert.equal(readDue(0, QUIET_MS + 1, false), true);
  assert.equal(readDue(0, TICK_MS, true), true);
});

test("a limit from GitHub names the time to wait, and a review does not take the branch's page", async () => {
  const { waitLine, stayOnBranch, authFresh, needsThreads, needsPermission, asOfAge, ageOf, AUTH_MS } = await load(
    "kanso-panel/pr-poll.js",
    ["waitLine", "stayOnBranch", "authFresh", "needsThreads", "needsPermission", "asOfAge", "ageOf", "AUTH_MS"],
    {},
  );
  assert.equal(waitLine(new Date(2026, 10, 11, 15, 4).getTime()), "GitHub asks to wait until 15:04");
  assert.equal(stayOnBranch(null), false);
  assert.equal(stayOnBranch(true), true);
  assert.equal(stayOnBranch(false), false);
  assert.equal(authFresh({ at: 1_000, ready: [] }, 1_000 + AUTH_MS - 1), true);
  assert.equal(authFresh({ at: 1_000, ready: [] }, 1_000 + AUTH_MS), false);
  assert.equal(authFresh(null, 1), false);
  assert.equal(needsThreads(null, "https://github.com/o/r/pull/1", "t"), true);
  assert.equal(needsThreads("https://github.com/o/r/pull/1\0t", "https://github.com/o/r/pull/1", "t"), false);
  assert.equal(needsThreads("https://github.com/o/r/pull/1\0t", "https://github.com/o/r/pull/1", "t2"), true);
  assert.equal(needsPermission("WRITE", "o/r", "o/r"), false);
  assert.equal(needsPermission("WRITE", "o/r", "o/other"), true);
  assert.equal(needsPermission(null, "o/r", "o/r"), true);
  assert.equal(asOfAge(0, 0), "as of just now");
  assert.equal(asOfAge(0, 120_000), "as of 2 min ago");
  assert.equal(ageOf(0, 3_700_000), "1 h ago");
});

test("a timed-out sign-in check is not kept", async () => {
  const { LATE } = await load("kanso-panel/pr-poll.js", ["LATE"], {});
  const { readyProviders } = await load("kanso-panel/pr-providers.js", ["readyProviders"], {});
  assert.equal(await readyProviders(async () => LATE), null);
  const signedOut = await readyProviders(async () => ({
    code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login",
  }));
  assert.equal(signedOut.length, 0);
});

test("merge is offered only when it is ready, and the header does not say ready before it knows", async () => {
  const { mergeReadiness, headerHold, READY_TEXT } = await load("kanso-panel/ghchecks.js", ["mergeReadiness", "headerHold", "READY_TEXT"], {});
  const checks = { fail: 1, pending: 0, unknown: 0, skipped: 0, pass: 0, total: 1, state: "fail" };
  const unstable = mergeReadiness({ state: "OPEN", mergeStateStatus: "UNSTABLE" }, { permission: "WRITE", checks });
  assert.equal(unstable.offer, false);
  assert.equal(unstable.text, "1 check failing");
  assert.equal(unstable.text === READY_TEXT, false);
  const clean = {
    number: 1, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", baseRefName: "main",
    statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
  };
  assert.equal(headerHold(clean), null);
  assert.equal(headerHold({ ...clean, viewerPermission: "WRITE" }), null);
  assert.equal(headerHold({ ...clean, viewerPermission: "READ" }), null);
  const { digestPr } = await load("kanso-strip/main.js", ["digestPr"], {});
  assert.equal(digestPr(clean).hold, null);
  assert.equal(digestPr({ ...clean, viewerPermission: "WRITE" }).hold, null);
  assert.equal(digestPr({ ...clean, viewerPermission: "READ" }).hold, null);
  const blocked = digestPr({ ...clean, mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" });
  assert.equal(blocked.hold, "Review required");
});

const THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });

function gitOut(args) {
  const line = args.join(" ");
  if (line.includes("--show-toplevel")) return "/repo\n";
  if (line.startsWith("branch")) return "feat\n";
  if (line.startsWith("remote")) return "https://github.com/o/here.git\n";
  return "";
}

function pull(over = {}) {
  return {
    number: 7, title: "Branch", url: "https://github.com/o/here/pull/7", state: "OPEN",
    author: { login: "me" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-11T00:00:00Z",
    files: [], additions: 1, deletions: 0, changedFiles: 1, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    statusCheckRollup: [], ...over,
  };
}

async function openPanel(exec, host = {}) {
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }), ...host,
  });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  const { cx, drain } = context();
  return { panel, cx, drain };
}

test("at rest one open pull request is one view, and a running check does not add the list", async () => {
  const { CALL_MS } = await load("kanso-panel/pr-poll.js", ["CALL_MS"], {});
  let current = pull();
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args: [...args], timeout: options?.timeout });
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    if (args[1] === "list") return { code: 0, stdout: "[]", stderr: "" };
    if (args[1] === "view") return { code: 0, stdout: JSON.stringify(current), stderr: "" };
    if (args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    if (args[1] === "graphql") return { code: 0, stdout: THREADS, stderr: "" };
    if (args.includes("viewerPermission")) return { code: 0, stdout: "WRITE\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { panel, cx, drain } = await openPanel(exec);
  panel.refresh(cx); await drain();
  calls.length = 0;
  panel.loading = false;
  panel.refresh(cx); await drain();
  const gh = calls.filter((call) => call.command === "gh");
  const git = calls.filter((call) => call.command === "git").map((call) => call.args.join(" ")).toSorted();
  assert.deepEqual(git, [
    "branch --show-current",
    "remote get-url origin",
    "rev-list --left-right --count @{u}...HEAD",
    "rev-parse --show-toplevel",
    "rev-parse --symbolic-full-name @{u}",
  ].toSorted());
  assert.equal(gh.length, 1);
  assert.deepEqual(gh[0].args.slice(0, 2), ["pr", "view"]);
  assert.equal(calls.every((call) => call.timeout === CALL_MS), true);
  assert.equal(panel.checks().some((check) => check.state === "pending"), false);

  current = pull({ statusCheckRollup: [{ __typename: "CheckRun", status: "IN_PROGRESS", name: "ci" }] });
  calls.length = 0;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(panel.checks().some((check) => check.state === "pending"), true);
  assert.equal(calls.filter((call) => call.command === "gh" && call.args[1] === "view").length, 1);
  assert.equal(calls.some((call) => call.args[1] === "list"), false);
  const { readDue, TICK_MS } = await load("kanso-panel/pr-poll.js", ["readDue", "TICK_MS"], {});
  assert.equal(refreshTicks({ pending: true, readDue, tick: TICK_MS }).length, 3);

  calls.length = 0;
  panel.listing = true;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(calls.filter((call) => call.command === "gh" && call.args[1] === "list" && call.args[3] === "open").length, 1);
  panel.tab = "closed";
  panel.loading = false;
  calls.length = 0;
  panel.refresh(cx); await drain();
  assert.equal(calls.filter((call) => call.args[1] === "list" && call.args[3] === "open").length, 1);
  assert.equal(calls.filter((call) => call.args[1] === "list" && call.args[3] === "closed").length, 1);
});

test("permission is kept for the repository, and the account is checked at most every 10 minutes", async () => {
  const { AUTH_MS } = await load("kanso-panel/pr-poll.js", ["AUTH_MS"], {});
  let url = "https://github.com/o/here/pull/7";
  let permissions = 0;
  let auths = 0;
  const exec = async (command, args) => {
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") { auths += 1; return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" }; }
    if (args.includes("viewerPermission")) { permissions += 1; return { code: 0, stdout: "WRITE\n", stderr: "" }; }
    if (args[1] === "view") return { code: 0, stdout: JSON.stringify(pull({ url })), stderr: "" };
    if (args[1] === "graphql") return { code: 0, stdout: THREADS, stderr: "" };
    if (args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { panel, cx, drain } = await openPanel(exec);
  panel.refresh(cx); await drain();
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(permissions, 1);
  assert.equal(auths, 1);
  url = "https://github.com/other/repo/pull/9";
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(permissions, 2, "another repository is asked");
  panel.auth.at = Date.now() - AUTH_MS - 1;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(auths, 2);
});

test("a limit from GitHub holds the panel, including a manual refresh", async () => {
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...(args ?? [])].join(" "));
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    if (args[1] === "view") return { code: 0, stdout: JSON.stringify(pull()), stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { panel, cx, drain } = await openPanel(exec);
  panel.context = "repo";
  panel.pr = pull();
  panel.freshAt = Date.now() - 10_000;
  panel.auth = { at: Date.now(), ready: [] };
  const until = Date.now() + 3_600_000;
  panel.db = { open: async () => {}, read: async () => [{ retry_at: until }] };
  panel.refresh(cx); await drain();
  assert.equal(calls.some((call) => call.includes("pr view")), false);
  assert.match(panel.wait, /^GitHub asks to wait until \d{2}:\d{2}$/);
  assert.equal(panel.pr.number, 7);
  assert.equal(panel.error, null);
  calls.length = 0;
  panel.loading = false;
  panel.again(cx); await drain();
  assert.equal(calls.some((call) => call.startsWith("gh")), false);
  assert.equal(panel.pr.number, 7);
});

test("a missed answer keeps the last pull request, with its age and Retry", async () => {
  let fail = false;
  const shown = tape();
  const ui = singleUse();
  const exec = async (command, args) => {
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    if (args[1] === "view") return fail ? { code: 1, stdout: "", stderr: "HTTP 500" } : { code: 0, stdout: JSON.stringify(pull()), stderr: "" };
    if (args[1] === "graphql") return { code: 0, stdout: THREADS, stderr: "" };
    if (args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    if (args.includes("viewerPermission")) return { code: 0, stdout: "WRITE\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { panel, cx, drain } = await openPanel(exec, {
    ...ui, ...shown.host,
    Popover: ui.Button, Input: ui.Button,
    InputState: { new: () => ({ on() {}, value() { return ""; } }) },
    TextView: { markdown: () => shown.host.div() },
  });
  panel.refresh(cx); await drain();
  const fresh = panel.freshAt;
  assert.equal(panel.pr.number, 7);
  fail = true;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.equal(panel.pr.number, 7);
  assert.equal(panel.stale.at, fresh);
  assert.equal(panel.error, null);
  assert.equal(panel.loading, false);
  assert.match(panel.readNote(), /^as of /);
  panel.footnote(TONE);
  assert.ok(shown.texts.includes("Retry"));
});

test("a read that never answers still finishes, and the last pull request stays", async () => {
  let hang = false;
  let hung = 0;
  const timers = [];
  const pending = [];
  const cx = {
    notify() {},
    spawn(fn) { pending.push(fn(cx)); },
    timer: { after(_ms, fn) { timers.push(fn); }, every() {} },
  };
  const exec = async (command, args) => {
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    if (args[1] === "view" && hang) { hung += 1; return new Promise(() => {}); }
    if (args[1] === "view") return { code: 0, stdout: JSON.stringify(pull()), stderr: "" };
    if (args[1] === "graphql") return { code: 0, stdout: THREADS, stderr: "" };
    if (args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    if (args.includes("viewerPermission")) return { code: 0, stdout: "WRITE\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { panel } = await openPanel(exec);
  const first = context();
  panel.refresh(first.cx); await first.drain();
  hang = true;
  panel.loading = false;
  panel.bind(cx);
  panel.refresh(cx);
  for (let i = 0; i < 80 && hung === 0; i += 1) await Promise.resolve();
  assert.equal(hung, 1);
  for (const fn of [...timers]) fn();
  while (pending.length) await pending.shift();
  assert.equal(panel.loading, false);
  assert.equal(panel.pr.number, 7);
  assert.equal(panel.error, null);
  assert.match(panel.readNote(), /^as of /);
});

test("the timer returns while the window is behind or the panel is hidden, and reads when it comes forward", async () => {
  const { pollTick, pollFacing } = await load("kanso-panel/pr-poll.js", ["pollTick", "pollFacing"], {});
  assert.equal(pollFacing(false, false), false);
  assert.equal(pollFacing(true, true), false);
  assert.equal(pollFacing(undefined, undefined), true);
  const behind = pollTick({ shown: false, away: false, picker: false, due: true });
  assert.equal(behind.away, true);
  assert.equal(behind.read, false);
  const quiet = pollTick({ shown: true, away: false, picker: false, due: false });
  assert.equal(quiet.read, false);
  const held = pollTick({ shown: true, away: true, picker: true, due: true });
  assert.equal(held.read, false);
  assert.equal(held.away, true);
  const forward = pollTick({ shown: true, away: true, picker: false, due: false });
  assert.equal(forward.read, true);
  assert.equal(forward.away, false);

  let active = true;
  let hidden = false;
  const views = [];
  const exec = async (command, args) => {
    if (command === "gh" && args[0] === "pr" && args[1] === "view") views.push(args[2] ?? "");
    if (command === "git") return { code: 0, stdout: gitOut(args), stderr: "" };
    if (args[0] === "auth") return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" };
    if (args[1] === "view") return { code: 0, stdout: JSON.stringify(pull()), stderr: "" };
    if (args[1] === "graphql") return { code: 0, stdout: THREADS, stderr: "" };
    if (args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    if (args.includes("viewerPermission")) return { code: 0, stdout: "WRITE\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const pending = [];
  const after = [];
  let tick = null;
  const cx = {
    notify() {},
    spawn(fn) { pending.push(fn(cx)); },
    timer: { every(_ms, fn) { tick = fn; }, after(_ms, fn) { after.push(fn); } },
  };
  const drain = async () => { while (pending.length) await pending.shift(); };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    exec,
    key: () => "repo",
    location: () => ({ cwd: "/repo", on: null }),
    window: () => ({ active }),
    layout: () => ({ id: "panel-body", hidden }),
    InputState: { new: () => ({ on() {} }) },
  });
  const panel = new PullRequest();
  panel.init(cx);
  await drain();
  const seen = views.length;
  assert.equal(seen > 0, true);
  assert.equal(typeof tick, "function");

  active = false;
  const queued = after.length;
  tick(cx);
  panel.comeForward(cx);
  await drain();
  assert.equal(views.length, seen);
  assert.equal(panel.away, true);
  assert.equal(after.length, queued);

  active = true;
  hidden = true;
  tick(cx);
  panel.comeForward(cx);
  await drain();
  assert.equal(views.length, seen);
  assert.equal(panel.away, true);
  assert.equal(after.length, queued);

  hidden = false;
  panel.comeForward(cx);
  assert.equal(after.length, queued + 1);
  after.at(-1)(cx);
  await drain();
  assert.equal(views.length, seen + 1);
  assert.equal(panel.away, false);
});

test("unseen reviews do not replace the branch's pull request", async () => {
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {});
  const panel = new PullRequest();
  panel.inboxOpen = null;
  panel.paintInbox({ unseen: 3, needs: [{}, {}, {}], yours: [] }, true);
  assert.equal(panel.inboxOpen, false);
  panel.inboxOpen = true;
  panel.paintInbox({ unseen: 0, needs: [], yours: [] }, true);
  assert.equal(panel.inboxOpen, true);
});
