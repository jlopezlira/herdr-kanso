import { loadPullRequest, loadTokens, recordCases, recordsFor } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { load, context, exec as realExec, singleUse, temporary, success, failure, refreshedContext, timedContext, gpuiHost, nodes, KIT_NIGHT } from "./helpers.mjs";
import { blankPanel, refreshAgain, PASSED } from "./pr-fixtures.mjs";

const url = (n) => `https://github.com/o/here/pull/${n}`;
const openOne = { number: 8, title: "Open", url: url(8), state: "OPEN", author: { login: "you" }, headRefName: "c", updatedAt: "2026-10-05T00:00:00Z" };

// git on `branch` of o/here and gh signed in as me: `answer` goes first.
const repoExec = (branch, answer, calls = []) => async (command, args) => {
  calls.push([command, ...args].join(" "));
  if (command === "git") return success({ "rev-parse": "/repo\n", branch: `${branch}\n`, remote: "git@github.com:o/here.git\n" }[args[0]] ?? "");
  const own = await answer(args);
  if (own) return own;
  if (args[0] === "api" && args[1] === "user") return success("me\n");
  return failure("offline");
};

const listing = (args) => args[0] === "pr" && args[1] === "list";

// A panel in /repo, read once.
const panelOn = async (exec, host = {}, state = {}) => {
  const { PullRequest } = await loadPullRequest({ exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }), ...host });
  const panel = blankPanel(PullRequest, undefined, state);
  return { panel, ...await refreshedContext(panel) };
};

const sendingPanel = async (hc, agent = { status: "working" }, toasts = [], records = null) => {
  const { PullRequest } = await loadPullRequest({
    focused: () => ({ terminal: records?.address ?? "t1" }), machines: () => records?.machines ?? [],
    panes: () => records?.panes ?? [{ terminal: "t1", status: agent.status, program: { agent: true, name: "checkout" } }],
    terminals: () => records?.terminals ?? [{ address: "t1", status: agent.status, program: { agent: true, name: "checkout" } }],
    hc, notify: (toast) => toasts.push(toast),
  });
  const panel = new PullRequest();
  panel.session.pr = {
    number: 42, title: "Ship", url: "https://github.com/o/r/pull/42", state: "OPEN",
    headRefName: "feat", baseRefName: "main", mergeStateStatus: "UNSTABLE", mergeable: "MERGEABLE",
    statusCheckRollup: [{
      __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "test", workflowName: "CI",
      detailsUrl: "https://github.com/o/r/actions/runs/99",
    }],
  };
  panel.session.threads = [];
  panel.session.permission = "WRITE";
  panel.session.failedLog = "CI / test\tRun tests\tFAIL no such file\n";
  panel.session.root = "/repo";
  panel.session.cwd = "/repo";
  const timers = [];
  return { panel, timers, toasts, ...timedContext(timers) };
};

test("Send shows the failing log, then hands it to the agent in front", async () => {
  const sent = [], agent = { status: "working" };
  const { panel, cx, drain } = await sendingPanel(async (args) => { sent.push(args); return success(""); }, agent);
  assert.equal(panel.view().primary.label, "Send to checkout");
  panel.send(cx);
  assert.equal(sent.length, 0);
  assert.match(panel.session.sendFor, /FAIL no such file/);
  assert.match(panel.session.sendFor, /https:\/\/github.com\/o\/r\/pull\/42/);
  const shown = panel.session.sendFor;
  panel.send(cx);
  panel.send(cx);
  await drain();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.filter((args) => args[0] === "send"))), [["send", "t1", shown]]);
  agent.status = "blocked";
  assert.match(panel.view().text, /checkout needs you first$/);
  assert.equal(panel.view().primary, null);
});

test("A send the agent never confirms in time says Not confirmed, never Not sent, and the panel is free again", async () => {
  const { SEND_MS } = await load("kanso-panel/deliver.js", ["SEND_MS"], { hc: async () => ({}) });
  const { panel, cx, drain, timers, toasts } = await sendingPanel((args) => (args[0] === "send" ? new Promise(() => {}) : success("")));
  panel.send(cx);
  panel.send(cx);
  assert.equal(panel.session.busy, "Send");
  timers.filter(([ms]) => ms === SEND_MS).forEach(([, fn]) => fn());
  await drain();
  assert.equal(panel.session.busy, null);
  const said = [panel.session.note?.text, panel.session.note?.source, ...toasts.flatMap((t) => [t.title, t.body])].filter(Boolean).join(" | ");
  assert.match(said, /Not confirmed/);
  assert.match(said, /it may have arrived/);
  assert.doesNotMatch(said, /Not sent/);
});

test("The pull request panel sends only to an agent every record agrees on, whatever the terminal and pane say", async () => {
  for (const { term, pane, address, layout, kind, at } of recordCases) {
    const sent = [];
    const { panel, cx, drain } = await sendingPanel(async (args) => { sent.push(args); return success(""); }, undefined, [], recordsFor(term, pane, address, {}, layout));
    const agent = panel.frontAgent();
    assert.deepEqual([agent.kind, agent.blocked], [kind, kind === "waiting"], at);
    panel.send(cx);
    panel.send(cx);
    await drain();
    assert.equal(sent.some(([verb]) => verb === "send"), kind === "ready", `${at}: sent only when ready`);
    if (kind === "unreachable") assert.match(panel.session.note?.text ?? "", /is unreachable$/, at);
  }
});

test("The pull request panel sends nothing to an agent whose computer goes unavailable before the press, and says why", async () => {
  const sent = [], records = recordsFor("agent", "agent", "box/t9");
  const { panel, cx, drain } = await sendingPanel(async (args) => { sent.push(args); return success(""); }, undefined, [], records);
  panel.send(cx);
  records.machines = [{ name: "box", layout: "unavailable" }];
  panel.send(cx);
  await drain();
  assert.equal(sent.some(([verb]) => verb === "send"), false);
  assert.match(panel.session.note?.text ?? "", /^Not sent: .+ is unreachable$/);
});

test("Sign in opens gh auth login in the space already on screen", async () => {
  const runs = [];
  const { PullRequest } = await loadPullRequest({
    run: (...args) => runs.push(args),
  });
  const panel = new PullRequest();
  Object.assign(panel.session, { root: "/repo", cwd: "/repo", on: "mac-2" });
  panel.signIn();
  assert.deepEqual(JSON.parse(JSON.stringify(runs)), [["terminal.open", { argv: ["gh", "auth", "login"], folder: "/repo", place: "right" }]]);
  assert.equal(runs[0][1].on, undefined);
});

test("Pull request panel lists the repository's open ones, by anyone, and shows the one you pick", async () => {
  const prs = {
    [url(1)]: { number: 1, title: "Branch work", url: url(1), author: { login: "me" }, headRefName: "feat", updatedAt: "2026-10-01T00:00:00Z" },
    [url(2)]: { number: 2, title: "Other work", url: url(2), author: { login: "me" }, headRefName: "other", updatedAt: "2026-10-02T00:00:00Z" },
    [url(3)]: { number: 3, title: "Bump a dependency", url: url(3), author: { login: "app/dependabot" }, headRefName: "deps", updatedAt: "2026-10-03T00:00:00Z" },
  };
  const calls = [];
  const { panel, cx, drain } = await panelOn(repoExec("feat", (args) => {
    if (listing(args)) return success(JSON.stringify(Object.values(prs)));
    if (args[0] === "pr" && args[1] === "view") return success(JSON.stringify(prs[args[2] === "--json" ? url(1) : args[2]]));
  }, calls));
  assert.equal(panel.session.pr.number, 1);
  assert.equal(calls.some((c) => c.includes("pr list")), false, "the branch's pull request does not ask for every open one");
  panel.session.listing = true;
  await refreshAgain(panel, cx, drain);
  assert.deepEqual([...panel.session.openPrs].map((p) => p.number), [3, 2, 1], "every author, newest first");
  assert.ok(calls.includes(`gh pr list --state open --limit 100 --json ${calls.find((c) => c.startsWith("gh pr list")).split("--json ")[1]}`));
  assert.ok(!calls.some((c) => c.includes("--author")), "not only yours");
  panel.session.listing = true; // the page of open ones
  panel.choose(prs[url(3)], cx); await drain();
  assert.equal(panel.session.pr.number, 3, "someone else's opens too");
  assert.equal(panel.session.listing, false, "a pick goes back to the one shown");
  assert.equal(panel.session.selected, url(3));
  panel.choose(prs[url(1)], cx); await drain();
  assert.equal(panel.session.pr.number, 1);
  assert.equal(panel.session.selected, null, "the branch's own follows the branch again");
});

test("Pull request panel stays empty when the branch has none, and does not stand in another", async () => {
  const prs = {
    [url(4)]: { number: 4, title: "Older", url: url(4), author: { login: "me" }, headRefName: "a", updatedAt: "2026-10-01T00:00:00Z" },
    [url(5)]: { number: 5, title: "Newest", url: url(5), author: { login: "you" }, headRefName: "b", updatedAt: "2026-10-05T00:00:00Z" },
  };
  const { panel, cx, drain } = await panelOn(repoExec("lonely", (args) => {
    if (listing(args)) return success(JSON.stringify(Object.values(prs)));
    if (args[0] === "pr" && args[1] === "view") {
      if (args[2] === "--json") return failure('no pull requests found for branch "lonely"');
      return success(JSON.stringify(prs[args[2]]));
    }
  }));
  assert.equal(panel.session.pr, null, "another open pull request does not stand in");
  assert.equal(panel.session.none, true);
  assert.equal(panel.session.selected, null, "it keeps following the branch");
  assert.equal(panel.session.branchUrl, null);
  panel.choose(prs[url(4)], cx); await drain();
  assert.equal(panel.session.pr.number, 4);
});

test("Pull request panel skips the branch's merged or closed one", async () => {
  const done = { 6: { number: 6, title: "Merged", url: url(6), state: "MERGED" }, 7: { number: 7, title: "Closed", url: url(7), state: "CLOSED" } };
  for (const n of [6, 7]) {
    for (const open of [[openOne], []]) {
      const { panel } = await panelOn(repoExec("develop", (args) => {
        if (args[0] === "pr" && args[1] === "list") return success(JSON.stringify(open));
        if (args[0] === "pr" && args[1] === "view") return success(JSON.stringify(args[2] === "--json" ? done[n] : openOne));
      }));
      assert.equal(panel.session.branchUrl, null, `#${n} is not the branch's any more`);
      assert.equal(panel.session.pr, null, "a finished one is not shown, and neither is another open one");
      assert.equal(panel.session.none, true);
        }
  }
});

test("Pull request panel shows a quiet placeholder outside a repository, not an error", async () => {
  const exec = async (command) => command === "git" ? failure("not a git repository", 128) : failure("");
  const { panel } = await panelOn(exec, { key: () => "home", location: () => ({ cwd: "/home", on: null }) });
  assert.equal(panel.session.outside, true);
  assert.equal(panel.session.error, null);
});

test("Pull request panel reads the description and folds it only when long", async () => {
  const { cleanBody, longBody } = await load("kanso-panel/pr.js", ["cleanBody", "longBody"], {});
  const { FIELDS } = await load("kanso-panel/pr-session.js", ["FIELDS"], {});
  assert.ok(FIELDS.split(",").includes("body"), "gh reads the body");
  assert.equal(cleanBody("## Summary\r\n<!-- template hint -->\r\nFixes it.\r\n\r\n\r\n\r\nDone."), "## Summary\n\nFixes it.\n\nDone.");
  assert.equal(cleanBody("<!-- only a template -->"), "");
  assert.equal(cleanBody(null), "");
  assert.equal(longBody("One line."), false);
  assert.equal(longBody(Array.from({ length: 10 }, (_, i) => `- item ${i}`).join("\n")), true);
  assert.equal(longBody("x".repeat(600)), true);
});

test("Pull request panel keeps finished ones in the list's Closed tab, never as the one it opens on", async () => {
  const closed = [
    { number: 6, title: "Merged by a colleague", url: url(6), state: "MERGED", author: { login: "ana" }, headRefName: "x", updatedAt: "2026-10-02T00:00:00Z", mergedAt: "2026-10-02T00:00:00Z" },
    { number: 7, title: "Closed", url: url(7), state: "CLOSED", author: { login: "me" }, headRefName: "develop", updatedAt: "2026-10-04T00:00:00Z", closedAt: "2026-10-04T00:00:00Z" },
  ];
  const calls = [];
  const { panel, cx, drain } = await panelOn(repoExec("develop", (args) => {
    if (args[0] === "pr" && args[1] === "list" && args[3] === "open") return success(JSON.stringify([openOne]));
    if (args[0] === "pr" && args[1] === "list" && args[3] === "closed") return success(JSON.stringify(closed));
    if (args[0] === "pr" && args[1] === "view") {
      const pick = args[2] === "--json" ? closed[1] : [openOne, ...closed].find((p) => p.url === args[2]);
      return success(JSON.stringify(pick));
    }
  }, calls), {}, { tab: "open", closedPrs: null });
  assert.equal(panel.session.pr, null, "the branch's finished one is not the one it opens on");
  assert.equal(panel.session.none, true);
  assert.ok(!calls.some((c) => c.includes("--state closed")), "closed ones are read only when asked for");
  assert.ok(panel.canSwitch(), "the list is there to reach them");

  panel.session.listing = true;
  panel.showTab("closed", cx); await drain();
  assert.deepEqual([...panel.session.closedPrs].map((p) => p.number), [7, 6], "newest finished first, anyone's");
  panel.choose(closed[0], cx); await drain();
  assert.equal(panel.session.pr.number, 6, "a colleague's merged one opens when picked");
  assert.equal(panel.session.pr.state, "MERGED");
  assert.equal(panel.session.listing, false);
});

test("Pull request panel offers to create one only where gh can: a branch pushed to a GitHub remote", async (t) => {
  const git = (cwd, ...args) => realExec("git", ["-c", "user.email=t@e", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd });
  const repo = async (name, branch = "feat") => {
    const dir = join(await temporary(t), name);
    await mkdir(dir);
    await git(dir, "init", "-q", "-b", branch);
    await git(dir, "commit", "-q", "--allow-empty", "-m", "one");
    return dir;
  };
  const noPr = failure('no pull requests found for branch "feat"');
  const other = { number: 3, title: "Other", url: "https://github.com/o/here/pull/3", state: "OPEN", author: { login: "you" }, headRefName: "x", updatedAt: "2026-10-05T00:00:00Z" };
  const show = async (cwd, view, open = []) => {
    const ids = [];
    const ui = singleUse();
    const exec = (command, args, options) => command === "gh"
      ? Promise.resolve(args[1] === "list" ? success(JSON.stringify(open))
        : args[0] === "repo" ? success("main\n")
          : args[1] === "view" && args[2] !== "--json" ? success(JSON.stringify(other))
            : args[1] === "view" ? view : failure("offline"))
      : realExec(command, args, options);
    const { panel, cx, drain } = await panelOn(exec, {
      ...ui, home: () => "/Users/x", Popover: ui.Button, Button: { new: (id) => { ids.push(id); return ui.Button.new(); } },
      key: () => cwd, location: () => ({ cwd, on: null }),
    });
    let said = null;
    const waiting = panel.waiting.bind(panel);
    panel.waiting = (c, title, detail, action) => { said = { title, detail }; return waiting(c, title, detail, action); };
    panel.body({}, true);
    const link = ids.includes("pr-create");
    panel.session.listing = true; panel.session.tab = "open"; ids.length = 0;
    await refreshAgain(panel, cx, drain);
    panel.body({}, true);
    return { panel, said, link, listLink: ids.includes("pr-create-list") };
  };

  const plain = join(await temporary(t), "plain");
  await mkdir(plain);
  let r = await show(plain, noPr);
  assert.equal(r.panel.session.outside, true);
  assert.equal(r.link, false, "not a repository");

  r = await show(await repo("alone"), failure("no git remotes found\n"));
  assert.deepEqual(r.said, { title: "No remote", detail: null });
  assert.equal(r.panel.session.error, null, "a missing remote is not a failure");
  assert.equal(r.panel.canSwitch(), false);
  assert.equal(r.link, false, "no remote");

  const gitlab = await repo("gitlab");
  await git(gitlab, "remote", "add", "origin", "git@gitlab.com:o/here.git");
  r = await show(gitlab, failure("none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n"));
  assert.equal(r.said.title, "No GitHub remote");
  assert.equal(r.link, false, "remote not on GitHub");

  const github = await repo("github");
  await git(github, "remote", "add", "origin", "https://github.com/o/here.git");
  r = await show(github, failure("To get started with GitHub CLI, please run:  gh auth login\n", 4));
  assert.equal(r.said.title, "Not signed in to GitHub");
  assert.equal(r.link, false, "no gh login");

  r = await show(github, noPr);
  assert.equal(r.panel.session.none, true);
  assert.equal(r.panel.session.pushed, false);
  assert.deepEqual(r.said, { title: "Commits not on GitHub", detail: null });
  assert.equal(r.link, false, "branch not pushed");

  await git(github, "commit", "-q", "--allow-empty", "-m", "two");
  await git(github, "checkout", "-q", "--detach", "HEAD~1");
  r = await show(github, failure("could not determine current branch: failed to run git: not on any branch\n"));
  assert.equal(r.panel.session.branch, null);
  assert.equal(r.said.title, "No branch checked out");
  assert.equal(r.link, false, "detached HEAD");

  await git(github, "checkout", "-q", "feat");
  const bare = join(await temporary(t), "bare.git");
  await git(github, "init", "-q", "--bare", bare);
  const push = async (...args) => {
    await git(github, "remote", "set-url", "origin", bare);
    await git(github, "push", "-q", ...args);
    await git(github, "remote", "set-url", "origin", "https://github.com/o/here.git");
  };
  const notListed = async (view) => assert.equal((await show(github, view, [other])).listLink, false, "nor in the list");
  await push("-u", "origin", "feat");
  r = await show(github, noPr);
  assert.equal(r.panel.session.pushed, true);
  assert.equal(r.said.title, "No pull request for feat");
  assert.equal(r.link, true, "a pushed branch on GitHub keeps the link");
  r = await show(github, noPr, [other]);
  assert.equal(r.panel.session.pr, null);
  assert.equal(r.panel.session.none, true);
  assert.equal(r.listLink, true, "and the list's link");

  await git(github, "commit", "-q", "--allow-empty", "-m", "three");
  r = await show(github, noPr);
  assert.equal(r.panel.session.pushed, false, "a commit past the upstream is not on GitHub");
  assert.deepEqual(r.said, { title: "1 commit not on GitHub", detail: null });
  assert.equal(r.link, false, "branch ahead of its upstream");
  await notListed(noPr);

  await push("origin", "feat");
  await git(github, "reset", "-q", "--hard", "HEAD~1");
  r = await show(github, noPr);
  assert.equal(r.panel.session.pushed, false, "an upstream past HEAD is not this branch on GitHub");
  assert.equal(r.panel.session.behind, true);
  assert.deepEqual(r.said, { title: "1 commit behind GitHub", detail: null });
  assert.equal(r.link, false, "branch behind its upstream");
  await notListed(noPr);

  await git(github, "checkout", "-q", "-b", "main");
  await push("-u", "origin", "main");
  r = await show(github, failure('no pull requests found for branch "main"'));
  assert.equal(r.panel.session.pushed, true);
  assert.deepEqual(r.said, { title: "main is the default branch", detail: null });
  assert.equal(r.link, false, "the default branch");
  await notListed(failure('no pull requests found for branch "main"'));
});

const TONE = { dim: "dim", red: "red", yellow: "yellow", green: "green", violet: "violet", blocked: "red", working: "yellow", done: "green", muted: "dim" };
const canMerge = (panel) => {
  const primary = panel.view().primary;
  return Boolean(primary?.id === "pr-merge" && primary.acts !== false && !primary.disabled);
};
const failed = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "ci" }];

async function shownMerge(pr, permission = "WRITE") {
  const ids = [];
  const ui = singleUse();
  const exec = repoExec("feat", (args) => {
    if (args[0] === "pr" && args[1] === "list") return success(JSON.stringify([pr]));
    if (args[0] === "pr" && args[1] === "view") return success(JSON.stringify(pr));
    if (args[0] === "repo" && args.includes("viewerPermission")) return success(`${permission}\n`);
  });
  const { PullRequest } = await loadPullRequest({
    ...ui, Button: { new: (id) => { ids.push(id); return ui.Button.new(); } },
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
  });
  const panel = blankPanel(PullRequest);
  const { cx, drain } = context();
  panel.session.context = "repo";
  panel.session.listing = true;
  panel.refresh(cx); await drain();
  panel.hero(TONE, true);
  return { panel, merge: ids.includes("pr-merge") };
}

const pull = (over) => ({
  number: 575, title: "Ship it", url: "https://github.com/o/here/pull/575", state: "OPEN", isDraft: false,
  author: { login: "me" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-10T00:00:00Z",
  mergeable: "MERGEABLE", statusCheckRollup: PASSED, additions: 1, deletions: 0, changedFiles: 1, ...over,
});

function assertNoMerge(view) {
  assert.equal(canMerge(view.panel), false);
  assert.equal(view.merge, false);
  assert.equal(/ready/i.test(view.panel.view().text), false);
}

function assertHeld(view, text) {
  assert.equal(view.panel.view().text, text);
  assertNoMerge(view);
  assert.equal(view.panel.rowState(view.panel.session.openPrs[0], TONE).text, text);
  assert.equal(/ready/i.test(view.panel.rowState(view.panel.session.openPrs[0], TONE).text), false);
}

test("A clean pull request is ready to merge only for someone who can push", async () => {
  const yes = await shownMerge(pull({ mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }));
  assert.equal(yes.panel.view().text, "Ready to merge");
  assert.equal(yes.panel.view().primary.label, "Squash and merge");
  assert.equal(yes.panel.view().primary.target, "merge");
  assert.equal(yes.panel.view().primary.armed, true);
  assert.equal(yes.panel.view().primary.acts, true);
  assert.equal(canMerge(yes.panel), true);
  assert.equal(yes.merge, true);
  assert.equal(yes.panel.rowState(yes.panel.session.openPrs[0], TONE).text, "Ready to merge");
  const no = await shownMerge(pull({ mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }), "READ");
  assertHeld(no, "No permission to merge");
  const unread = await shownMerge(pull({ mergeStateStatus: "CLEAN" }), "");
  assertNoMerge(unread);
  assert.equal(unread.panel.rowState(unread.panel.session.openPrs[0], TONE).text, "Checks passed");
});

test("A pull request with hooks still offers merge when GitHub would", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "HAS_HOOKS", reviewDecision: "APPROVED" }));
  assert.equal(view.panel.view().text, "Ready to merge");
  assert.equal(canMerge(view.panel), true);
  assert.equal(view.merge, true);
});

test("An unstable pull request shows the failing checks and no Merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "UNSTABLE", statusCheckRollup: failed }));
  assert.equal(view.panel.view().text, "1 check failing");
  assertNoMerge(view);
  assert.equal(view.panel.rowState(view.panel.session.openPrs[0], TONE).text, "1 check failing");
});

test("A pull request behind its base is not offered for merge", async () => {
  assertHeld(await shownMerge(pull({ mergeStateStatus: "BEHIND" })), "Behind main");
});

test("A blocked pull request says why and hides merge", async () => {
  assertHeld(await shownMerge(pull({ mergeStateStatus: "BLOCKED", reviewDecision: "APPROVED" })), "Blocked by branch rules");
  const failing = await shownMerge(pull({ mergeStateStatus: "BLOCKED", statusCheckRollup: failed }));
  assertHeld(failing, "1 check failing");
  assert.equal(/ready/i.test(failing.panel.inboxState({ reviewDecision: "APPROVED" }, TONE).text), false);
});

test("A dirty pull request is conflicts, not a merge", async () => {
  assertHeld(await shownMerge(pull({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" })), "Conflicts with main");
});

test("A draft pull request is not offered for merge", async () => {
  assertHeld(await shownMerge(pull({ mergeStateStatus: "DRAFT", isDraft: true })), "Draft");
  assertHeld(await shownMerge(pull({ mergeStateStatus: "CLEAN", isDraft: true })), "Draft");
});

test("An unknown merge state is still computing, never ready", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" }));
  assertHeld(view, "Checking whether it can merge…");
  assert.equal(view.panel.view().text.includes("Ready"), false);
});

test("A pull request that still needs a review is not ready to merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "BLOCKED", mergeable: "MERGEABLE", reviewDecision: "REVIEW_REQUIRED" }));
  assertHeld(view, "Review required");
  assert.equal(view.panel.inboxState({ draft: false, reviewDecision: "REVIEW_REQUIRED" }, TONE).text, "Review required");
  assert.equal(/ready/i.test(view.panel.inboxState({ draft: false, reviewDecision: "REVIEW_REQUIRED" }, TONE).text), false);
});

test("A pull request with changes requested is not ready to merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }));
  assertHeld(view, "Changes requested");
  assert.equal(view.panel.inboxState({ draft: false, reviewDecision: "CHANGES_REQUESTED" }, TONE).text, "Changes requested");
  assert.equal(/ready/i.test(view.panel.inboxState({ draft: false, reviewDecision: "APPROVED" }, TONE).text), false);
});

test("a failed run's log is read once, and not while the window is behind", async () => {
  let active = true;
  const runs = [];
  const pr = {
    number: 3, title: "Ship", url: "https://github.com/o/here/pull/3", state: "OPEN",
    headRefName: "feat", baseRefName: "main", mergeStateStatus: "UNSTABLE",
    statusCheckRollup: [{
      __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "ci",
      detailsUrl: "https://github.com/o/here/actions/runs/99",
    }],
  };
  const exec = repoExec("feat", (args) => {
    if (args[0] === "run" && args[1] === "view") {
      runs.push(args.join(" "));
      return success("ci\tstep\tFAIL no\n");
    }
    if (args[0] === "pr" && args[1] === "view") return success(JSON.stringify(pr));
    if (args[0] === "api" && args[1] === "graphql") return success(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }));
    if (args[0] === "repo") return success("WRITE\n");
  });
  const { panel, cx, drain } = await panelOn(exec, { window: () => ({ active }) });
  assert.deepEqual(runs, ["run view 99 --log-failed"]);
  await refreshAgain(panel, cx, drain);
  assert.equal(runs.length, 1);
  active = false;
  panel.again(cx); await drain();
  assert.equal(runs.length, 1);
});

test("each write runs the one command that state names", async () => {
  const gh = [];
  const git = [];
  const { PullRequest } = await loadPullRequest({
    location: () => ({ cwd: null, on: null }), key: () => "repo",
  });
  const panel = new PullRequest();
  panel.session.context = "repo";
  panel.session.pr = { number: 4, url: "https://github.com/o/r/pull/4", state: "OPEN" };
  panel.session.root = "/repo";
  panel.session.gh = async (_task, args) => { gh.push(args); return success(""); };
  panel.session.git = async (_task, args) => { git.push(args); return success(""); };
  const { cx, drain } = context();
  const go = async (target, bucket, expected) => {
    gh.length = 0;
    git.length = 0;
    panel.session.busy = null;
    panel.runWrite({ target, busy: target }, cx);
    await drain();
    assert.deepEqual(JSON.parse(JSON.stringify(bucket)), [expected], target);
  };
  await go("push", git, ["push", "-u", "origin", "HEAD"]);
  await go("pull", git, ["pull", "--ff-only"]);
  await go("update", gh, ["api", "-X", "PUT", "repos/o/r/pulls/4/update-branch"]);
  await go("ready", gh, ["pr", "ready", panel.session.pr.url]);
  await go("draft", gh, ["pr", "ready", panel.session.pr.url, "--undo"]);
  await go("close", gh, ["pr", "close", panel.session.pr.url]);
  await go("reopen", gh, ["pr", "reopen", panel.session.pr.url]);
});

test("a review thread's comment is drawn wrapped on its row, up to 240 characters, not only in a tooltip", async () => {
  const { PullRequest } = await loadPullRequest(gpuiHost());
  const { tokens } = await loadTokens(gpuiHost());
  const panel = new PullRequest();
  const body = `${"Retry-After is in seconds; wait once and give up after three tries. ".repeat(5)}`;
  panel.session.threads = [{ body, path: "src/api.ts", line: 4, author: "bea", replies: 2, outdated: false, url: "https://github.com/o/r/pull/4#discussion_r1" }];
  const drawn = nodes(panel.discussion(tokens(KIT_NIGHT)));
  const shown = `${body.slice(0, 240)}…`;
  const comment = drawn.find((el) => el.calls.some(([name, text]) => name === "child" && text === shown));
  assert.ok(comment, "the first 240 characters are drawn on the row");
  const calls = comment.calls.map(([name]) => name);
  assert.ok(!calls.includes("truncate"), "the comment is not cut to one line");
  assert.ok(calls.includes("line_height"), "the comment wraps over its lines");
  assert.ok(!drawn.some((el) => el.calls.some(([name]) => name === "tooltip")), "the comment is not hidden in a tooltip");
});
