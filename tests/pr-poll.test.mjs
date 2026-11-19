// What the pull request panel asks, and what it keeps when GitHub does not answer.
import { loadPullRequest, loadAuthTiming } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { load, context, tape, singleUse, failure, success, KIT_NIGHT, storeShared, until } from "./helpers.mjs";
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
  assert.equal(panel.session.pr.number, 7);
  assert.equal(panel.session.error, null);
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

  panel.session.listing = true;
  await again();
  const listed = (state) => calls.filter((call) => call.command === "gh" && call.args[1] === "list" && call.args[3] === state).length;
  assert.equal(listed("open"), 1);
  panel.session.tab = "closed";
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
  panel.session.context = "repo";
  panel.session.pr = pull();
  panel.session.freshAt = Date.now() - 10_000;
  panel.auth = { at: Date.now(), ready: [] };
  const until = Date.now() + 3_600_000;
  panel.db = { open: async () => {}, read: async () => [{ retry_at: until }] };
  panel.refresh(cx); await drain();
  assert.equal(asked.some((call) => call.includes("pr view")), false);
  assert.match(panel.session.wait, /^GitHub asks to wait until \d{2}:\d{2}$/);
  keptPull(panel);
  asked.length = 0;
  panel.session.loading = false;
  panel.again(cx); await drain();
  assert.equal(asked.some((call) => call.startsWith("gh")), false);
  assert.equal(panel.session.pr.number, 7);
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
  const fresh = panel.session.freshAt;
  assert.equal(panel.session.pr.number, 7);
  fail = true;
  await refreshAgain(panel, cx, drain);
  keptPull(panel);
  assert.equal(panel.session.stale.at, fresh);
  assert.equal(panel.session.loading, false);
  assert.match(panel.readNote(), /^as of /);
  panel.hero(TONE);
  assert.ok(shown.texts.includes("Retry"));
  assert.equal(shown.texts.some((text) => /rereads|Read from GitHub/.test(String(text))), false);
});

const night = {
  theme: () => KIT_NIGHT,
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
};

const folderView = (read, extra) => ({
  key: read,
  location: () => ({ cwd: read(), on: null }),
  ...night,
  ...extra,
});

const zeroTimers = (cx) => {
  const after = [];
  cx.timer = { after(ms, fn) { after.push({ ms, fn }); }, every() {} };
  return () => { after.filter((item) => item.ms === 0).forEach((item) => item.fn(cx)); };
};

const drawnRead = async (host) => {
  let drawing = false;
  const started = [];
  const after = [];
  const exec = branchExec((command, args) => {
    started.push([command, ...args].join(" "));
    if (drawing) return new Promise(() => {});
  });
  const opened = await readDrawn(exec, { ...night, ...host });
  opened.cx.timer = { after(_ms, fn) { after.push(fn); }, every() {} };
  const viewed = () => started.filter((line) => line.startsWith("gh pr view")).length;
  return {
    ...opened, after, viewed, seen: started.length,
    roots: () => started.filter((line) => line.includes("rev-parse --show-toplevel")).length,
    draw() {
      drawing = true;
      opened.panel.render(opened.cx);
      opened.panel.render(opened.cx);
      drawing = false;
    },
    startedDuring: () => started.length,
  };
};

const drawnQuiet = (turn) => {
  turn.draw();
  assert.equal(turn.startedDuring(), turn.seen);
  assert.equal(turn.after.length, 1);
};

const nextTurn = async (turn) => {
  turn.after[0](turn.cx);
  await turn.drain();
};

const readOther = async (turn) => {
  await nextTurn(turn);
  assert.equal(turn.viewed(), 2);
  assert.equal(turn.panel.session.context, "/other");
};

test("a folder change seen while the panel is drawn starts its read on the next turn, where Herdr keeps it", async () => {
  let folder = "/repo";
  const turn = await drawnRead({ key: () => folder, props: () => ({}) });
  assert.equal(turn.viewed(), 1);
  folder = "/other";
  drawnQuiet(turn);
  await readOther(turn);
});

test("a pane asking for the push section while the panel is drawn starts its read on the next turn, where Herdr keeps it", async () => {
  let asked = null;
  const turn = await drawnRead({ key: () => "/repo", props: () => asked });
  const views = turn.viewed();
  asked = { section: "push", at: 1 };
  drawnQuiet(turn);
  assert.equal(turn.panel.section, "push");
  assert.equal(turn.panel.session.selected, null);
  await nextTurn(turn);
  assert.equal(turn.viewed(), views + 1);
  assert.equal(turn.panel.session.loading, false);
});

const cleared = (turn, store, folder) => {
  const frame = turn.shown.texts.join("\n");
  assert.equal(turn.panel.session.context, folder);
  assert.equal(turn.panel.session.pr, null);
  assert.equal(turn.panel.session.branch, null);
  assert.equal(turn.panel.session.home, null);
  assert.equal(frame.includes("#7"), false);
  assert.equal(frame.includes("Branch"), false);
  assert.equal(frame.includes("feat \u2192 main"), false);
  assert.equal(frame.includes("here"), false);
  assert.equal(JSON.stringify(store["kanso.pr.details"]), JSON.stringify({ [folder]: true }));
};

const openFolder = async (store, on = null) => {
  let folder = "/repo";
  let asked = null;
  const turn = await drawnRead({
    key: () => folder,
    location: () => ({ cwd: folder, on: folder === "/repo" ? on : null }),
    props: () => asked,
    ...storeShared(store),
  });
  return {
    turn,
    move(next, ask) {
      folder = next;
      if (ask !== undefined) asked = ask;
      turn.shown.texts.length = 0;
      turn.draw();
    },
  };
};

const blankFolder = async () => {
  const store = {};
  return { store, ...(await openFolder(store)) };
};

const still = (turn, move, folder, ask) => {
  const seen = turn.startedDuring();
  move(folder, ask);
  assert.equal(turn.startedDuring(), seen);
};

test("a folder change clears the previous pull request on that draw, and the fold it opens belongs to the new folder", async () => {
  const store = { "kanso.alias": { remote1: "remote1" } };
  const { turn, move } = await openFolder(store, "remote1");
  assert.equal(turn.panel.session.pr.number, 7);
  still(turn, move, "/other", { section: "checks", at: 2 });
  assert.equal(turn.shown.texts.join("\n").includes("remote1"), false);
  cleared(turn, store, "/other");
  await readOther(turn);
});

test("a folder change during Refresh clears that pull request before the read finishes, and the fold belongs to the new folder", async () => {
  const { store, turn, move } = await blankFolder();
  turn.panel.again(turn.cx);
  still(turn, move, "/other", { section: "checks", at: 2 });
  cleared(turn, store, "/other");
  await turn.drain();
  assert.equal(turn.panel.session.context, "/other");
  assert.equal(store["kanso.pr.details"]["/repo"], undefined);
});

const gate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

const parked = (cx) => {
  const tasks = [];
  const skip = new Set();
  const spawn = cx.spawn.bind(cx);
  cx.spawn = (fn) => {
    const task = spawn(fn);
    tasks.push(task);
    return task;
  };
  return {
    tasks,
    hold(task) { skip.add(task); },
    async settle() {
      const done = new Set();
      for (let guard = 0; guard < 30; guard += 1) {
        const pending = tasks.filter((task) => !skip.has(task) && !done.has(task));
        if (!pending.length) return;
        await Promise.all(pending);
        pending.forEach((task) => done.add(task));
      }
    },
  };
};

test("a late Details list does not replace a newer list of the same folder", async () => {
  let folder = "/repo";
  const lists = [];
  const { panel, cx } = await readDrawn(branchExec(async (command, args) => {
    if (command !== "gh" || args[1] !== "list") return;
    const held = gate();
    lists.push(held);
    return held.promise;
  }), folderView(() => folder, { props: () => null }));
  const bag = parked(cx);
  const fire = zeroTimers(cx);
  panel.setDetails(cx, true);
  bag.hold(bag.tasks.at(-1));
  folder = "/B";
  panel.render(cx);
  folder = "/repo";
  panel.render(cx);
  fire();
  await bag.settle();
  panel.setDetails(cx, true);
  lists[1].release(success(JSON.stringify([{ number: 2, title: "current", updatedAt: "2026-11-12T00:00:00Z" }])));
  await bag.settle();
  lists[0].release(success(JSON.stringify([{ number: 1, title: "obsolete", updatedAt: "2026-11-10T00:00:00Z" }])));
  await lists[0].promise;
  await bag.settle();
  assert.equal(panel.session.openPrs.length, 1);
  assert.equal(String(panel.session.openPrs[0].title), "current");
});

const heldRoots = async (releaseFirst) => {
  let folder = "/repo";
  let asked = null;
  const looked = [];
  let hold = null;
  let watch = false;
  const { panel, cx, drain } = await readDrawn(branchExec(async (command, args) => {
    if (!watch || command !== "git" || !args.includes("--show-toplevel")) return;
    const started = folder;
    looked.push(started);
    if (!hold) return success(`${started}\n`);
    const pending = hold;
    hold = null;
    return pending.promise.then(() => success(`${started}\n`));
  }), folderView(() => folder, { props: () => asked }));
  const fire = zeroTimers(cx);
  watch = true;
  const held = gate();
  hold = held;
  panel.again(cx);
  folder = "/B";
  panel.render(cx);
  folder = "/C";
  asked = { section: "push", at: 4 };
  panel.render(cx);
  const finish = async () => { held.release(); await drain(); };
  if (releaseFirst) { await finish(); fire(); }
  else { fire(); await finish(); }
  await drain();
  assert.deepEqual(looked, ["/repo", "/C"]);
};

test("a queued folder change and a push ask are one read of the latest folder, either order", async () => {
  await heldRoots(true);
  await heldRoots(false);
});

const closedRow = JSON.stringify([{ number: 3, title: "kept", url: "https://github.com/o/here/pull/3", state: "MERGED", updatedAt: "2026-11-12T00:00:00Z", author: { login: "me" }, headRefName: "feat", baseRefName: "main", additions: 0, deletions: 0 }]);
const failedCheck = { name: "ci", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/o/here/actions/runs/9" };

const AGENT = { terminal: "t1", address: "t1", status: "working", program: { agent: true, name: "checkout" } };
const BUSY_LABELS = ["Merging…", "Opening GitHub…", "Pushing…", "Pulling…", "Updating…", "Marking ready…", "Returning…", "Closing…", "Reopening…"];

const failing = (panel) => {
  panel.session.pr = { ...panel.session.pr, mergeStateStatus: "BLOCKED", statusCheckRollup: [failedCheck] };
  panel.session.permission = "WRITE";
  panel.checked = null;
};

const eachFolder = (own) => {
  const base = branchExec();
  return async (command, args, options) => {
    const answer = await own(command, args, options);
    if (answer) return answer;
    if (command === "git" && args.includes("--show-toplevel")) return success(`${options?.cwd}\n`);
    if (args.includes("viewerPermission")) return success("WRITE\n");
    return base(command, args);
  };
};

const twoFolders = async (hold, host = {}, own = () => undefined) => {
  let folder = "/repo";
  let arm = false;
  const held = [];
  const calls = [];
  const toasts = [];
  const exec = eachFolder((command, args, options) => {
    calls.push({ command, line: [command, ...args].join(" "), cwd: options?.cwd });
    if (own(command, args)) return own(command, args);
    if (!arm || !hold(command, args)) return undefined;
    const pending = { ...gate(), cwd: options?.cwd, tasks: [] };
    held.push(pending);
    return pending.promise;
  });
  const opened = await readDrawn(exec, folderView(() => folder, { props: () => null, notify: (message) => toasts.push(message), hc: (args) => exec("hc", args, {}), ...host }));
  const { panel, cx, shown } = opened;
  const bag = parked(cx), fire = zeroTimers(cx);
  return {
    panel, cx, held, calls, toasts,
    holding(start) {
      arm = true;
      start();
      arm = false;
    },
    begin(start) {
      const from = bag.tasks.length, count = held.length;
      arm = true;
      start(panel, cx);
      arm = false;
      const spawned = bag.tasks.slice(from);
      spawned.forEach((task) => bag.hold(task));
      held.slice(count).forEach((pending) => pending.tasks.push(...spawned));
    },
    async move(next) {
      folder = next;
      panel.render(cx);
      fire();
      await bag.settle();
    },
    async release(at, body) {
      held[at].release(body);
      await Promise.all(held[at].tasks);
      await bag.settle();
    },
    frame() {
      shown.texts.length = 0;
      shown.handlers.clear();
      panel.render(cx);
      return { text: shown.texts.join("\n"), handlers: shown.handlers };
    },
    since: (from) => calls.slice(from),
  };
};

const notHere = (calls, cwd) => calls.filter((call) => call.cwd === cwd);
const quiet = () => new Promise((resolve) => { setImmediate(resolve); });

const heldCases = {
  refresh: { hold: (command, args) => command === "git" && args.includes("--show-toplevel"), begin: (panel, cx) => panel.again(cx), answer: (cwd) => success(`${cwd}\n`) },
  inbox: { hold: (command, args) => command === "gh" && args[0] === "auth", begin: (panel, cx) => { panel.auth = null; panel.again(cx); }, answer: () => failure(SIGNED_OUT) },
  log: { hold: (_command, args) => args[0] === "run" && args[1] === "view", begin: (panel, cx) => { failing(panel); panel.readLog(cx); }, answer: () => success("log") },
  closed: { hold: (_command, args) => args[1] === "list" && args.includes("closed"), begin: (panel, cx) => { panel.session.listing = true; panel.showTab("closed", cx); }, answer: () => success(closedRow), shows: "kept" },
  details: { hold: (_command, args) => args[1] === "list" && args.includes("open"), begin: (panel, cx) => panel.setDetails(cx, true), answer: () => success(closedRow) },
  diff: { hold: (_command, args) => args[1] === "diff", begin: (panel, cx) => panel.pickFile("a.js", cx), answer: () => success("") },
  picker: { hold: (_command, args) => args[1] === "graphql", begin: (panel, cx) => { panel.search = { set_value() {}, focus() {}, value: () => "" }; panel.openPicker("labels", true, cx); }, answer: () => failure("no") },
  labels: { hold: (_command, args) => args[0] === "api" && args.includes("-X"), begin: (panel, cx) => panel.toggle("labels", "bug", false, cx), answer: () => failure("no") },
  merge: { hold: (_command, args) => args.join(" ").includes("squashMergeAllowed"), begin: (panel, cx) => panel.runWrite({ target: "merge" }, cx), answer: () => failure("no") },
  create: { hold: (command, args) => command === "git" && args.includes("--symbolic-full-name"), begin: (panel, cx) => panel.runWrite({ target: "create" }, cx), answer: () => success("refs/remotes/origin/feat\n") },
  push: { hold: (command, args) => command === "git" && args[0] === "push", begin: (panel, cx) => panel.runWrite({ target: "push" }, cx), answer: () => failure("no") },
  pull: { hold: (command, args) => command === "git" && args[0] === "pull", begin: (panel, cx) => panel.runWrite({ target: "pull" }, cx), answer: () => failure("no") },
  update: { hold: (_command, args) => args.join(" ").includes("update-branch"), begin: (panel, cx) => panel.runWrite({ target: "update" }, cx), answer: () => failure("no") },
  ready: { hold: (_command, args) => args[1] === "ready" && !args.includes("--undo"), begin: (panel, cx) => panel.runWrite({ target: "ready" }, cx), answer: () => failure("no") },
  draft: { hold: (_command, args) => args[1] === "ready" && args.includes("--undo"), begin: (panel, cx) => panel.runWrite({ target: "draft" }, cx), answer: () => failure("no") },
  close: { hold: (_command, args) => args[1] === "close", begin: (panel, cx) => panel.runWrite({ target: "close" }, cx), answer: () => failure("no") },
  reopen: { hold: (_command, args) => args[1] === "reopen", begin: (panel, cx) => panel.runWrite({ target: "reopen" }, cx), answer: () => failure("no") },
  send: {
    hold: (command, args) => command === "hc" && args[0] === "send",
    begin: (panel, cx) => { failing(panel); panel.session.failedLog = "CI / ci\tRun tests\tFAIL no such file\n"; panel.send(cx); panel.send(cx); },
    answer: () => failure("no"),
    host: { focused: () => ({ terminal: "t1" }), panes: () => [AGENT], terminals: () => [AGENT] },
  },
};

const SENT = ["labels", "merge", "create", "push", "pull", "update", "ready", "draft", "close", "reopen", "send"];

const toldFor = (toasts, name, asked) => {
  const said = toasts.map((toast) => `${toast.title} ${toast.body ?? ""}`);
  if (!SENT.includes(name)) { assert.deepEqual(said, [], `${name}: a read for A says nothing in B`); return; }
  assert.equal(said.length, 1, `${name}: A's sent action tells its outcome once`);
  assert.equal(said[0].includes(asked ? `#${asked.number} in repo` : "in repo"), true, `${name}: ${said[0]}`);
};

const freeInB = (panel, name) => {
  assert.equal(panel.session.context, "/B", name);
  assert.equal(Boolean(panel.session.busy), false, name);
  assert.equal(Boolean(panel.session.pending), false, name);
  assert.equal(panel.session.loading, false, name);
};

const heldInAThenB = async (name, spec, oldFirst) => {
  const run = await twoFolders(spec.hold, spec.host);
  const { panel, held } = run;
  run.begin(spec.begin);
  const asked = panel.session.pr;
  assert.equal(held.length, 1, name);
  assert.notEqual(held[0].cwd, "/B", name);
  await run.move("/B");
  const idle = run.frame();
  freeInB(panel, name);
  assert.equal(BUSY_LABELS.some((label) => idle.text.includes(label)), false, name);
  assert.equal(idle.handlers.has("pr-merge"), true, `${name}: B's action is clickable`);
  run.begin(spec.begin);
  assert.equal(held.length, 2, `${name}: B asks for itself`);
  if (held[1].cwd !== undefined) assert.equal(held[1].cwd, "/B", name);
  for (const at of oldFirst ? [0, 1] : [1, 0]) {
    await quiet();
    const before = run.frame().text, from = run.calls.length, told = run.toasts.length;
    await run.release(at, spec.answer(held[at].cwd));
    if (at === 1) continue;
    toldFor(run.toasts.slice(told), name, asked);
    assert.equal(run.frame().text, before, `${name}: A's result is not shown in B`);
    assert.deepEqual(notHere(run.since(from), "/B"), [], `${name}: A finishes in A`);
  }
  const last = run.frame().text;
  assert.equal(last.includes("GitHub could not be read"), false, name);
  freeInB(panel, name);
  if (spec.shows) assert.equal(last.includes(spec.shows), true, name);
};

test("a read or action held in one folder leaves the next folder's frame, buttons and calls its own, in either order, and an action already sent tells its outcome naming its pull request and folder", async () => {
  for (const [name, spec] of Object.entries(heldCases)) {
    await heldInAThenB(name, spec, true);
    await heldInAThenB(name, spec, false);
  }
});

const createdInA = async () => {
  const run = await twoFolders(heldCases.create.hold);
  run.begin(heldCases.create.begin);
  await run.move("/B");
  return run;
};

test("Create on GitHub started in one folder opens GitHub for that folder, never for the folder shown after", async () => {
  const run = await createdInA();
  const from = run.calls.length;
  await run.release(0, heldCases.create.answer());
  const created = run.since(from).filter((call) => call.line.startsWith("gh pr create"));
  assert.deepEqual(created.map((call) => call.cwd), ["/repo"]);
  assert.equal(run.calls.some((call) => call.line.startsWith("gh pr create") && call.cwd === "/B"), false);
});

test("while Create waits in one folder, the next folder's buttons are enabled and a press runs there", async () => {
  const run = await createdInA();
  const { text, handlers } = run.frame();
  assert.equal(text.includes("Opening GitHub…"), false);
  const press = handlers.get("pr-merge");
  assert.equal(typeof press, "function");
  press(null, run.cx);
  run.frame().handlers.get("pr-merge")(null, run.cx);
  const merging = run.frame().text;
  assert.equal(merging.includes("Merging…"), true);
  assert.deepEqual(run.calls.filter((call) => call.line.includes("squashMergeAllowed")).map((call) => call.cwd), ["/B"]);
});

test("an older folder's Refresh that settles after the next folder asks for its list leaves that list to be read", async () => {
  let folder = "/repo";
  let holding = false;
  const views = [];
  const lists = [];
  const exec = eachFolder((command, args, options) => {
    if (command === "gh" && args[1] === "list") lists.push(options?.cwd);
    if (!holding || command !== "gh" || args[0] !== "pr" || args[1] !== "view") return undefined;
    const pending = gate();
    views.push(pending);
    return pending.promise;
  });
  const { panel, cx, shown } = await readDrawn(exec, folderView(() => folder, { props: () => null, notify() {} }));
  const fire = zeroTimers(cx);
  holding = true;
  panel.again(cx);
  await until(() => views.length === 1);
  folder = "/B";
  panel.render(cx);
  fire();
  await until(() => views.length === 2);
  shown.handlers.clear();
  panel.render(cx);
  shown.handlers.get("pr-switch")(null, cx);
  assert.equal(panel.session.listing, true);
  views[0].release(success(JSON.stringify(pull())));
  await quiet();
  assert.deepEqual(lists, []);
  views[1].release(success(JSON.stringify(pull())));
  await until(() => lists.length === 1);
  assert.deepEqual(lists, ["/B"]);
});

const ownedContexts = () => {
  const ended = [];
  const tasks = new Map();
  const make = (id) => {
    const live = () => { if (ended.includes(id)) throw new Error(`expired task ${id}`); };
    const cx = {
      timer: { after() { live(); }, every() { live(); } },
      notify() { live(); },
      spawn(fn) {
        const own = tasks.size + 1;
        tasks.set(own, null);
        const task = Promise.resolve(fn(make(own))).finally(() => { ended.push(own); });
        tasks.set(own, task);
        return task;
      },
    };
    return cx;
  };
  return { cx: make(0), tasks };
};

test("two overlapping tasks in one folder each keep their own deadline: Create opens GitHub after Details has finished", async () => {
  const opened = (command, args) => (command === "gh" && args[1] === "create" ? success("") : undefined);
  const { panel, held, calls, toasts, holding } = await twoFolders(heldCases.create.hold, {}, opened);
  const owned = ownedContexts();
  holding(() => panel.runWrite({ target: "create" }, owned.cx));
  assert.equal(held.length, 1);
  panel.setDetails(owned.cx, true);
  await owned.tasks.get(2);
  held[0].release(heldCases.create.answer());
  await owned.tasks.get(1);
  assert.deepEqual(calls.filter((call) => call.line.startsWith("gh pr create")).map((call) => call.cwd), ["/repo"]);
  assert.equal(panel.session.note, null, String(panel.session.note?.detail ?? panel.session.note));
  assert.deepEqual(toasts, []);
});

test("a label sent for one pull request reports once, naming that pull request and folder, after another is chosen and the folder changes", async () => {
  const labelOrRoot = (command, args) => heldCases.labels.hold(command, args) || heldCases.refresh.hold(command, args);
  const run = await twoFolders(labelOrRoot);
  run.begin((panel, cx) => panel.toggle("labels", "bug", false, cx));
  assert.equal(run.held.length, 1);
  run.begin((panel, cx) => panel.choose({ url: "https://github.com/o/r/pull/8", number: 8 }, cx));
  assert.equal(run.held.length, 2);
  await run.move("/B");
  await run.release(0, success(""));
  assert.deepEqual(run.toasts.map((toast) => [toast.title, toast.level, toast.body]), [["Put bug on", "success", "#7 in repo"]]);
});

test("Details shows its rows loading while the open list is out, and says nothing else is open only once it answers", async () => {
  const run = await twoFolders(heldCases.details.hold, storeShared({}));
  run.begin(heldCases.details.begin);
  assert.equal(run.held.length, 1);
  assert.equal(run.panel.session.flying("details"), true);
  assert.equal(run.frame().text.includes("Nothing else open."), false);
  await run.release(0, success("[]"));
  assert.equal(run.frame().text.includes("Nothing else open."), true);
});

test("two folder changes before the wake are one read of the latest folder", async () => {
  const { store, turn, move } = await blankFolder();
  const roots = turn.roots();
  move("/B");
  move("/C", { section: "checks", at: 3 });
  assert.equal(turn.roots(), roots);
  cleared(turn, store, "/C");
  await nextTurn(turn);
  assert.equal(turn.panel.session.context, "/C");
  assert.equal(turn.roots(), roots + 1);
  const pending = turn.after.length;
  turn.draw();
  if (turn.after.length > pending) {
    turn.after[pending](turn.cx);
    await turn.drain();
  }
  assert.equal(turn.roots(), roots + 1);
  assert.equal(turn.panel.session.context, "/C");
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
  panel.session.loading = false;
  panel.refresh(cx);
  for (let i = 0; i < 80 && hung === 0; i += 1) await Promise.resolve();
  assert.equal(hung, 1);
  for (const fn of [...timers]) fn();
  await drain();
  assert.equal(panel.session.loading, false);
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
  panel.session.inboxOpen = null;
  panel.paintInbox({ unseen: 3, needs: [{}, {}, {}], yours: [] }, true);
  openInbox(panel);
  panel.paintInbox({ unseen: 0, needs: [], yours: [] }, true);
  assert.equal(panel.session.inboxOpen, true);
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
  assert.equal(unpushed.panel.session.pr, null);
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
  assert.equal(behind.panel.session.baseBehind, 4);
});
