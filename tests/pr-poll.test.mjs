// What the pull request panel asks, and what it keeps when GitHub does not answer.
import { loadPullRequest, loadAuthTiming } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { load, context, tape, singleUse, failure, success, KIT_NIGHT } from "./helpers.mjs";
import { blankPanel, refreshAgain, openInbox, SIGNED_OUT, PASSED } from "./pr-fixtures.mjs";

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
  const { LATE } = await load("kanso-panel/pure.js", ["LATE"], {});
  const { readyProviders } = await load("kanso-panel/pr-providers.js", ["readyProviders"], {});
  assert.equal(await readyProviders(async () => LATE), null);
  const signedOut = await readyProviders(async () => (failure("You are not logged into any GitHub hosts. To log in, run: gh auth login")));
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
    statusCheckRollup: PASSED,
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

// git on branch feat of o/here; `more` answers what that does not know.
const gitAnswer = (more = () => undefined) => (args) => {
  const known = gitOut(args);
  return known ? success(known) : more(args.join(" ")) ?? success("");
};

function pull(over = {}) {
  return {
    number: 7, title: "Branch", url: "https://github.com/o/here/pull/7", state: "OPEN",
    author: { login: "me" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-11T00:00:00Z",
    files: [], additions: 1, deletions: 0, changedFiles: 1, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    statusCheckRollup: [], ...over,
  };
}

// A signed-out gh on that branch: `answer` goes first, then `view` for the branch's pull request, then the threads, login and permission.
const branchExec = (answer = () => undefined, { git = gitAnswer(), view = () => success(JSON.stringify(pull())) } = {}) => async (command, args) => {
  const own = await answer(command, args);
  if (own) return own;
  if (command === "git") return git(args);
  if (args[0] === "auth") return failure(SIGNED_OUT);
  if (args[1] === "view") return view();
  if (args[1] === "graphql") return success(THREADS);
  if (args[1] === "user") return success("me\n");
  if (args.includes("viewerPermission")) return success("WRITE\n");
  return failure("offline");
};

async function openPanel(exec, host = {}) {
  const { PullRequest } = await loadPullRequest({
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }), ...host,
  });
  return { panel: blankPanel(PullRequest), ...context() };
}

// The panel after its first read.
const readPanel = async (exec, host) => {
  const opened = await openPanel(exec, host);
  opened.panel.refresh(opened.cx);
  await opened.drain();
  return opened;
};

// Only git, the account and the pull request answer.
const viewOnly = (command, args) => command !== "git" && args[0] !== "auth" && args[1] !== "view" ? failure("offline") : undefined;

const keptPull = (panel) => {
  assert.equal(panel.pr.number, 7);
  assert.equal(panel.error, null);
};

test("at rest one open pull request is one view, and a running check does not add the list", async () => {
  const { CALL_MS } = await load("kanso-panel/pr-poll.js", ["CALL_MS"], {});
  let current = pull();
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args: [...args], timeout: options?.timeout });
    return branchExec((command, asked) => command === "gh" && asked[1] === "list" ? success("[]") : undefined, { view: () => success(JSON.stringify(current)) })(command, args);
  };
  const { panel, cx, drain } = await readPanel(exec);
  const again = async () => {
    calls.length = 0;
    await refreshAgain(panel, cx, drain);
  };
  await again();
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
  await again();
  assert.equal(panel.checks().some((check) => check.state === "pending"), true);
  assert.equal(calls.filter((call) => call.command === "gh" && call.args[1] === "view").length, 1);
  assert.equal(calls.some((call) => call.args[1] === "list"), false);
  const { readDue, TICK_MS } = await load("kanso-panel/pr-poll.js", ["readDue", "TICK_MS"], {});
  assert.equal(refreshTicks({ pending: true, readDue, tick: TICK_MS }).length, 3);

  panel.listing = true;
  await again();
  const listed = (state) => calls.filter((call) => call.command === "gh" && call.args[1] === "list" && call.args[3] === state).length;
  assert.equal(listed("open"), 1);
  panel.tab = "closed";
  await again();
  assert.equal(listed("open"), 1);
  assert.equal(listed("closed"), 1);
});

test("permission is kept for the repository, and the account is checked at most every 10 minutes", async () => {
  const { AUTH_MS } = await loadAuthTiming();
  let url = "https://github.com/o/here/pull/7";
  let permissions = 0;
  let auths = 0;
  const exec = branchExec((command, args) => {
    if (command === "git") return undefined;
    if (args[0] === "auth") auths += 1;
    if (args.includes("viewerPermission")) { permissions += 1; return success("WRITE\n"); }
  }, { view: () => success(JSON.stringify(pull({ url }))) });
  const { panel, cx, drain } = await readPanel(exec);
  await refreshAgain(panel, cx, drain);
  assert.equal(permissions, 1);
  assert.equal(auths, 1);
  url = "https://github.com/other/repo/pull/9";
  await refreshAgain(panel, cx, drain);
  assert.equal(permissions, 2, "another repository is asked");
  panel.auth.at = Date.now() - AUTH_MS - 1;
  await refreshAgain(panel, cx, drain);
  assert.equal(auths, 2);
});

test("a limit from GitHub holds the panel, including a manual refresh", async () => {
  const asked = [];
  const exec = branchExec((command, args) => {
    asked.push([command, ...(args ?? [])].join(" "));
    return viewOnly(command, args);
  });
  const { panel, cx, drain } = await openPanel(exec);
  panel.context = "repo";
  panel.pr = pull();
  panel.freshAt = Date.now() - 10_000;
  panel.auth = { at: Date.now(), ready: [] };
  const until = Date.now() + 3_600_000;
  panel.db = { open: async () => {}, read: async () => [{ retry_at: until }] };
  panel.refresh(cx); await drain();
  assert.equal(asked.some((call) => call.includes("pr view")), false);
  assert.match(panel.wait, /^GitHub asks to wait until \d{2}:\d{2}$/);
  keptPull(panel);
  asked.length = 0;
  panel.loading = false;
  panel.again(cx); await drain();
  assert.equal(asked.some((call) => call.startsWith("gh")), false);
  assert.equal(panel.pr.number, 7);
});

const readDrawn = async (exec, host = {}) => {
  const shown = tape();
  const ui = singleUse();
  return {
    shown,
    ...await readPanel(exec, {
      ...ui, ...shown.host,
      Popover: ui.Button, Input: ui.Button,
      InputState: { new: () => ({ on() {}, value() { return ""; } }) },
      TextView: { markdown: () => shown.host.div() },
      ...host,
    }),
  };
};

test("a missed answer keeps the last pull request, with its age and Retry", async () => {
  let fail = false;
  const { shown, panel, cx, drain } = await readDrawn(branchExec(undefined, { view: () => fail ? failure("HTTP 500") : success(JSON.stringify(pull())) }));
  const fresh = panel.freshAt;
  assert.equal(panel.pr.number, 7);
  fail = true;
  await refreshAgain(panel, cx, drain);
  keptPull(panel);
  assert.equal(panel.stale.at, fresh);
  assert.equal(panel.loading, false);
  assert.match(panel.readNote(), /^as of /);
  panel.hero(TONE);
  assert.ok(shown.texts.includes("Retry"));
  assert.equal(shown.texts.some((text) => /rereads|Read from GitHub/.test(String(text))), false);
});

const drawnRead = async (host) => {
  let drawing = false;
  const started = [];
  const after = [];
  const exec = branchExec((command, args) => {
    started.push([command, ...args].join(" "));
    if (drawing) return new Promise(() => {});
  });
  const opened = await readDrawn(exec, {
    theme: () => KIT_NIGHT,
    ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    ...host,
  });
  opened.cx.timer = { after(_ms, fn) { after.push(fn); }, every() {} };
  const viewed = () => started.filter((line) => line.startsWith("gh pr view")).length;
  return {
    ...opened, after, viewed, seen: started.length,
    draw() {
      drawing = true;
      opened.panel.render(opened.cx);
      opened.panel.render(opened.cx);
      drawing = false;
    },
    startedDuring: () => started.length,
  };
};

test("a folder change seen while the panel is drawn starts its read on the next turn, where Herdr keeps it", async () => {
  let folder = "/repo";
  const turn = await drawnRead({ key: () => folder, props: () => ({}) });
  assert.equal(turn.viewed(), 1);
  folder = "/other";
  turn.draw();
  assert.equal(turn.startedDuring(), turn.seen);
  assert.equal(turn.after.length, 1);
  turn.after[0](turn.cx);
  await turn.drain();
  assert.equal(turn.viewed(), 2);
  assert.equal(turn.panel.context, "/other");
});

test("a pane asking for the push section while the panel is drawn starts its read on the next turn, where Herdr keeps it", async () => {
  let asked = null;
  const turn = await drawnRead({ key: () => "/repo", props: () => asked });
  const views = turn.viewed();
  asked = { section: "push", at: 1 };
  turn.draw();
  assert.equal(turn.startedDuring(), turn.seen);
  assert.equal(turn.after.length, 1);
  assert.equal(turn.panel.section, "push");
  assert.equal(turn.panel.selected, null);
  turn.after[0](turn.cx);
  await turn.drain();
  assert.equal(turn.viewed(), views + 1);
  assert.equal(turn.panel.loading, false);
});

test("a read that never answers still finishes, and the last pull request stays", async () => {
  let hang = false;
  let hung = 0;
  const { cx, drain } = context();
  const timers = [];
  cx.timer = { after(_ms, fn) { timers.push(fn); }, every() {} };
  const exec = branchExec((command, args) => {
    if (command !== "git" && args[1] === "view" && hang) { hung += 1; return new Promise(() => {}); }
  });
  const { panel } = await readPanel(exec);
  hang = true;
  panel.loading = false;
  panel.refresh(cx);
  for (let i = 0; i < 80 && hung === 0; i += 1) await Promise.resolve();
  assert.equal(hung, 1);
  for (const fn of [...timers]) fn();
  await drain();
  assert.equal(panel.loading, false);
  keptPull(panel);
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
  const exec = branchExec((command, args) => {
    if (command === "gh" && args[0] === "pr" && args[1] === "view") views.push(args[2] ?? "");
  });
  const after = [];
  let tick = null;
  const { cx, drain } = context();
  cx.timer = { every(_ms, fn) { tick = fn; }, after(_ms, fn) { after.push(fn); } };
  const { PullRequest } = await loadPullRequest({
    exec,
    key: () => "repo",
    location: () => ({ cwd: "/repo", on: null }),
    window: () => ({ active }),
    layout: () => ({ id: "panel-body", hidden }),
    InputState: { new: () => ({ on() {} }) },
    ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    props: () => ({}),
  });
  const panel = new PullRequest();
  panel.init(cx);
  await drain();
  const seen = views.length;
  assert.equal(seen > 0, true);
  assert.equal(typeof tick, "function");
  const queued = after.length;
  const staysAway = async () => {
    tick(cx);
    panel.readSoon(cx);
    await drain();
    assert.equal(views.length, seen);
    assert.equal(panel.away, true);
    assert.equal(after.length, queued);
  };

  active = false;
  await staysAway();

  active = true;
  hidden = true;
  await staysAway();

  hidden = false;
  panel.readSoon(cx);
  assert.equal(after.length, queued + 1);
  after.at(-1)(cx);
  await drain();
  assert.equal(views.length, seen + 1);
  assert.equal(panel.away, false);
});

test("unseen reviews do not replace the branch's pull request", async () => {
  const { PullRequest } = await loadPullRequest();
  const panel = new PullRequest();
  panel.inboxOpen = null;
  panel.paintInbox({ unseen: 3, needs: [{}, {}, {}], yours: [] }, true);
  openInbox(panel);
  panel.paintInbox({ unseen: 0, needs: [], yours: [] }, true);
  assert.equal(panel.inboxOpen, true);
});

test("the unpushed log and the behind count are each read once", async () => {
  const tally = (calls) => ({
    log: calls.filter((call) => call.command === "git" && call.args.join(" ").startsWith("log ")).length,
    behind: calls.filter((call) => call.command === "git" && call.args.join(" ").startsWith("rev-list --count HEAD..origin/")).length,
  });
  const twice = async (exec) => {
    const calls = [];
    const { panel, cx, drain } = await readPanel(async (command, args, options) => {
      calls.push({ command, args: [...(args ?? [])] });
      return exec(command, args, options);
    });
    const first = tally(calls.splice(0));
    await refreshAgain(panel, cx, drain);
    return { panel, first, second: tally(calls) };
  };
  const unpushed = await twice(branchExec(viewOnly, {
    git: gitAnswer((line) => {
      if (line.startsWith("rev-parse")) return failure("no upstream");
      if (line.startsWith("log ")) return success("one\n");
    }),
    view: () => failure('no pull requests found for branch "feat"'),
  }));
  assert.deepEqual(unpushed.first, { log: 1, behind: 0 });
  assert.deepEqual(unpushed.second, { log: 0, behind: 0 });
  assert.equal(unpushed.panel.pr, null);
  const behind = await twice(branchExec(undefined, {
    git: gitAnswer((line) => {
      if (line.includes("symbolic-full-name")) return success("refs/remotes/origin/feat\n");
      if (line.includes("--left-right")) return success("0\t0\n");
      if (line.startsWith("rev-list --count")) return success("4\n");
    }),
    view: () => success(JSON.stringify(pull({ mergeStateStatus: "BEHIND" }))),
  }));
  assert.deepEqual(behind.first, { log: 0, behind: 1 });
  assert.deepEqual(behind.second, { log: 0, behind: 0 });
  assert.equal(behind.panel.baseBehind, 4);
});
