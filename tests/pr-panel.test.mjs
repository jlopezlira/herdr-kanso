import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { load, context, exec as realExec, singleUse, temporary } from "./helpers.mjs";

test("PR agent edit actions open the prompt editor with the right task and checkout", async () => {
  const overlays = [];
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    knownAgents: async () => [{ installed: true, run: ["agent", "--flag"] }],
    openOverlay: (overlay) => overlays.push(overlay),
    location: () => ({ space: "space-1" }),
  });
  const panel = new PullRequest();
  panel.pr = {
    number: 42, url: "https://github.com/o/r/pull/42",
    headRefName: "feature", baseRefName: "main",
  };
  panel.root = "/repo";
  panel.cwd = "/repo";
  panel.on = "machine-1";

  for (const [task, title, promptStart] of [
    ["explain", "Explain", "Explain pull request #42"],
    ["feedback", "Feedback", "Address the actionable feedback"],
    ["conflicts", "Conflicts", "Resolve the conflicts of pull request #42"],
  ]) {
    panel.agentTask(task, true);
    await Promise.resolve();
    const overlay = overlays.at(-1);
    assert.equal(overlay.mod, "kanso-prompt-editor");
    assert.equal(overlay.kind, "dialog");
    assert.equal(overlay.props.title, `${title} prompt for #42`);
    assert.equal(overlay.props.name, `#42 ${title}`);
    assert.equal(overlay.props.value.startsWith(promptStart), true);
    assert.equal(overlay.props.multiline, true);
    assert.equal(overlay.props.submit_button_title, "Run in new tab");
    assert.deepEqual(JSON.parse(JSON.stringify(overlay.props.command)), {
      name: "tab.new",
      args: { name: `#42 ${title}`, space: "space-1", folder: "/repo", argv: ["agent", "--flag"] },
      key: "task",
    });
  }
});

test("PR agent quick action still starts a tab without opening the editor", async () => {
  const runs = [];
  const overlays = [];
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    knownAgents: async () => [{ installed: true, run: ["agent"] }],
    openOverlay: (overlay) => overlays.push(overlay),
    run: (...args) => runs.push(args),
    location: () => ({ space: "space-1" }),
  });
  const panel = new PullRequest();
  panel.pr = { number: 9, url: "https://github.com/o/r/pull/9", headRefName: "feature", baseRefName: "main" };
  panel.root = "/repo";
  panel.cwd = "/repo";
  panel.on = null;
  panel.agentTask("explain");
  await Promise.resolve();

  assert.equal(overlays.length, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0][0], "tab.new");
  assert.equal(runs[0][1].name, "#9 Explain");
  assert.match(runs[0][1].task, /^Explain pull request #9/);
  assert.equal(runs[0][1].folder, "/repo");
});

test("Pull request panel lists the repository's open ones, by anyone, and shows the one you pick", async () => {
  const url = (n) => `https://github.com/o/here/pull/${n}`;
  const prs = {
    [url(1)]: { number: 1, title: "Branch work", url: url(1), author: { login: "me" }, headRefName: "feat", updatedAt: "2026-10-01T00:00:00Z" },
    [url(2)]: { number: 2, title: "Other work", url: url(2), author: { login: "me" }, headRefName: "other", updatedAt: "2026-10-02T00:00:00Z" },
    [url(3)]: { number: 3, title: "Bump a dependency", url: url(3), author: { login: "app/dependabot" }, headRefName: "deps", updatedAt: "2026-10-03T00:00:00Z" },
  };
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args].join(" "));
    if (command === "git") {
      const out = { "rev-parse": "/repo\n", branch: "feat\n", remote: "git@github.com:o/here.git\n" }[args[0]];
      return { code: 0, stdout: out, stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: JSON.stringify(Object.values(prs)), stderr: "" };
    if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify(prs[args[2] === "--json" ? url(1) : args[2]]), stderr: "" };
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
  });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.pr.number, 1);
  assert.equal(calls.some((c) => c.includes("pr list")), false, "the branch's pull request does not ask for every open one");
  panel.listing = true;
  panel.loading = false;
  panel.refresh(cx); await drain();
  assert.deepEqual([...panel.openPrs].map((p) => p.number), [3, 2, 1], "every author, newest first");
  assert.ok(calls.includes(`gh pr list --state open --limit 100 --json ${calls.find((c) => c.startsWith("gh pr list")).split("--json ")[1]}`));
  assert.ok(!calls.some((c) => c.includes("--author")), "not only yours");
  panel.listing = true; // the page of open ones
  panel.choose(prs[url(3)], cx); await drain();
  assert.equal(panel.pr.number, 3, "someone else's opens too");
  assert.equal(panel.listing, false, "a pick goes back to the one shown");
  assert.equal(panel.selected, url(3));
  panel.choose(prs[url(1)], cx); await drain();
  assert.equal(panel.pr.number, 1);
  assert.equal(panel.selected, null, "the branch's own follows the branch again");
});

test("Pull request panel shows the newest open one when the branch has none, and offers to create it", async () => {
  const url = (n) => `https://github.com/o/here/pull/${n}`;
  const prs = {
    [url(4)]: { number: 4, title: "Older", url: url(4), author: { login: "me" }, headRefName: "a", updatedAt: "2026-10-01T00:00:00Z" },
    [url(5)]: { number: 5, title: "Newest", url: url(5), author: { login: "you" }, headRefName: "b", updatedAt: "2026-10-05T00:00:00Z" },
  };
  const exec = async (command, args) => {
    if (command === "git") {
      const out = { "rev-parse": "/repo\n", branch: "lonely\n", remote: "git@github.com:o/here.git\n" }[args[0]];
      return { code: 0, stdout: out, stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: JSON.stringify(Object.values(prs)), stderr: "" };
    if (args[0] === "pr" && args[1] === "view") {
      if (args[2] === "--json") return { code: 1, stdout: "", stderr: 'no pull requests found for branch "lonely"' };
      return { code: 0, stdout: JSON.stringify(prs[args[2]]), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
  });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.pr.number, 5, "the newest stands in");
  assert.equal(panel.fallback, true);
  assert.equal(panel.none, false);
  assert.equal(panel.selected, null, "it keeps following the branch");
  assert.equal(panel.branchUrl, null);
  panel.choose(prs[url(4)], cx); await drain();
  assert.equal(panel.pr.number, 4);
  assert.equal(panel.fallback, false);
});

test("Pull request panel skips the branch's merged or closed one", async () => {
  const url = (n) => `https://github.com/o/here/pull/${n}`;
  const done = { 6: { number: 6, title: "Merged", url: url(6), state: "MERGED" }, 7: { number: 7, title: "Closed", url: url(7), state: "CLOSED" } };
  const openOne = { number: 8, title: "Open", url: url(8), state: "OPEN", author: { login: "you" }, headRefName: "c", updatedAt: "2026-10-05T00:00:00Z" };
  for (const n of [6, 7]) {
    for (const open of [[openOne], []]) {
      const exec = async (command, args) => {
        if (command === "git") {
          const out = { "rev-parse": "/repo\n", branch: "develop\n", remote: "git@github.com:o/here.git\n" }[args[0]];
          return { code: 0, stdout: out, stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: JSON.stringify(open), stderr: "" };
        if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify(args[2] === "--json" ? done[n] : openOne), stderr: "" };
        if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "offline" };
      };
      const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
        exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
      });
      const panel = new PullRequest();
      Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
      const { cx, drain } = context();
      panel.refresh(cx); await drain();
      assert.equal(panel.branchUrl, null, `#${n} is not the branch's any more`);
      if (open.length) {
        assert.equal(panel.pr.number, 8, "the newest open one stands in");
        assert.equal(panel.fallback, true);
      } else {
        assert.equal(panel.pr, null, "nothing finished is shown");
        assert.equal(panel.none, true, "the branch offers to create its own");
      }
    }
  }
});

test("Pull request panel shows a quiet placeholder outside a repository, not an error", async () => {
  const exec = async (command) => command === "git" ? { code: 128, stdout: "", stderr: "not a git repository" } : { code: 1, stdout: "", stderr: "" };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], { exec, key: () => "home", location: () => ({ cwd: "/home", on: null }) });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.outside, true);
  assert.equal(panel.error, null);
});

test("Pull request panel reads the description and folds it only when long", async () => {
  const { cleanBody, longBody, FIELDS } = await load("kanso-panel/pr.js", ["cleanBody", "longBody", "FIELDS"], {});
  assert.ok(FIELDS.split(",").includes("body"), "gh reads the body");
  assert.equal(cleanBody("## Summary\r\n<!-- template hint -->\r\nFixes it.\r\n\r\n\r\n\r\nDone."), "## Summary\n\nFixes it.\n\nDone.");
  assert.equal(cleanBody("<!-- only a template -->"), "");
  assert.equal(cleanBody(null), "");
  assert.equal(longBody("One line."), false);
  assert.equal(longBody(Array.from({ length: 10 }, (_, i) => `- item ${i}`).join("\n")), true);
  assert.equal(longBody("x".repeat(600)), true);
});

test("Pull request panel keeps finished ones in the list's Closed tab, never as the one it opens on", async () => {
  const url = (n) => `https://github.com/o/here/pull/${n}`;
  const openOne = { number: 8, title: "Open", url: url(8), state: "OPEN", author: { login: "you" }, headRefName: "c", updatedAt: "2026-10-05T00:00:00Z" };
  const closed = [
    { number: 6, title: "Merged by a colleague", url: url(6), state: "MERGED", author: { login: "ana" }, headRefName: "x", updatedAt: "2026-10-02T00:00:00Z", mergedAt: "2026-10-02T00:00:00Z" },
    { number: 7, title: "Closed", url: url(7), state: "CLOSED", author: { login: "me" }, headRefName: "develop", updatedAt: "2026-10-04T00:00:00Z", closedAt: "2026-10-04T00:00:00Z" },
  ];
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args].join(" "));
    if (command === "git") {
      const out = { "rev-parse": "/repo\n", branch: "develop\n", remote: "git@github.com:o/here.git\n" }[args[0]];
      return { code: 0, stdout: out, stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "list" && args[3] === "open") return { code: 0, stdout: JSON.stringify([openOne]), stderr: "" };
    if (args[0] === "pr" && args[1] === "list" && args[3] === "closed") return { code: 0, stdout: JSON.stringify(closed), stderr: "" };
    if (args[0] === "pr" && args[1] === "view") {
      const pick = args[2] === "--json" ? closed[1] : [openOne, ...closed].find((p) => p.url === args[2]);
      return { code: 0, stdout: JSON.stringify(pick), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
  });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [], tab: "open", closedPrs: null });
  const { cx, drain } = context();
  panel.refresh(cx); await drain();
  assert.equal(panel.pr.number, 8, "it opens on an open one");
  assert.ok(!calls.some((c) => c.includes("--state closed")), "closed ones are read only when asked for");
  assert.ok(panel.canSwitch(), "the list is there to reach them");

  panel.listing = true;
  panel.showTab("closed", cx); await drain();
  assert.deepEqual([...panel.closedPrs].map((p) => p.number), [7, 6], "newest finished first, anyone's");
  panel.choose(closed[0], cx); await drain();
  assert.equal(panel.pr.number, 6, "a colleague's merged one opens when picked");
  assert.equal(panel.pr.state, "MERGED");
  assert.equal(panel.listing, false);
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
  const noPr = { code: 1, stdout: "", stderr: 'no pull requests found for branch "feat"' };
  const other = { number: 3, title: "Other", url: "https://github.com/o/here/pull/3", state: "OPEN", author: { login: "you" }, headRefName: "x", updatedAt: "2026-10-05T00:00:00Z" };
  const show = async (cwd, view, open = []) => {
    const ids = [];
    const ui = singleUse();
    const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
      ...ui, Popover: ui.Button, Button: { new: (id) => { ids.push(id); return ui.Button.new(); } },
      exec: (command, args, options) => command === "gh"
        ? Promise.resolve(args[1] === "list" ? { code: 0, stdout: JSON.stringify(open), stderr: "" }
          : args[0] === "repo" ? { code: 0, stdout: "main\n", stderr: "" }
            : args[1] === "view" && args[2] !== "--json" ? { code: 0, stdout: JSON.stringify(other), stderr: "" }
              : args[1] === "view" ? view : { code: 1, stdout: "", stderr: "offline" })
        : realExec(command, args, options),
      key: () => cwd, location: () => ({ cwd, on: null }),
    });
    const panel = new PullRequest();
    Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
    const { cx, drain } = context();
    panel.refresh(cx); await drain();
    let said = null;
    const waiting = panel.waiting.bind(panel);
    panel.waiting = (c, title, detail, action) => { said = { title, detail }; return waiting(c, title, detail, action); };
    panel.body({}, true);
    const link = ids.includes("pr-create");
    panel.listing = true; panel.tab = "open"; ids.length = 0;
    panel.body({}, true);
    return { panel, said, link, listLink: ids.includes("pr-create-list") };
  };

  const plain = join(await temporary(t), "plain");
  await mkdir(plain);
  let r = await show(plain, noPr);
  assert.equal(r.panel.outside, true);
  assert.equal(r.link, false, "not a repository");

  r = await show(await repo("alone"), { code: 1, stdout: "", stderr: "no git remotes found\n" });
  assert.deepEqual(r.said, { title: "No remote", detail: null });
  assert.equal(r.panel.error, null, "a missing remote is not a failure");
  assert.equal(r.panel.canSwitch(), false);
  assert.equal(r.link, false, "no remote");

  const gitlab = await repo("gitlab");
  await git(gitlab, "remote", "add", "origin", "git@gitlab.com:o/here.git");
  r = await show(gitlab, { code: 1, stdout: "", stderr: "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n" });
  assert.equal(r.said.title, "No GitHub remote");
  assert.equal(r.link, false, "remote not on GitHub");

  const github = await repo("github");
  await git(github, "remote", "add", "origin", "https://github.com/o/here.git");
  r = await show(github, { code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login\n" });
  assert.equal(r.said.title, "Not signed in to GitHub");
  assert.equal(r.link, false, "no gh login");

  r = await show(github, noPr);
  assert.equal(r.panel.none, true);
  assert.equal(r.panel.pushed, false);
  assert.deepEqual(r.said, { title: "No pull request for feat.", detail: "Push it to GitHub to open one." });
  assert.equal(r.link, false, "branch not pushed");

  await git(github, "commit", "-q", "--allow-empty", "-m", "two");
  await git(github, "checkout", "-q", "--detach", "HEAD~1");
  r = await show(github, { code: 1, stdout: "", stderr: "could not determine current branch: failed to run git: not on any branch\n" });
  assert.equal(r.panel.branch, null);
  assert.equal(r.said.title, "No branch checked out");
  assert.equal(r.link, false, "detached HEAD");

  await git(github, "checkout", "-q", "feat");
  const bare = join(await temporary(t), "bare.git");
  await git(github, "init", "-q", "--bare", bare);
  await git(github, "remote", "set-url", "origin", bare);
  await git(github, "push", "-q", "-u", "origin", "feat");
  await git(github, "remote", "set-url", "origin", "https://github.com/o/here.git");
  r = await show(github, noPr);
  assert.equal(r.panel.pushed, true);
  assert.equal(r.said.title, "No pull request for feat.");
  assert.equal(r.link, true, "a pushed branch on GitHub keeps the link");
  r = await show(github, noPr, [other]);
  assert.equal(r.panel.fallback, true);
  assert.equal(r.listLink, true, "and the list's link");

  await git(github, "commit", "-q", "--allow-empty", "-m", "three");
  r = await show(github, noPr);
  assert.equal(r.panel.pushed, false, "a commit past the upstream is not on GitHub");
  assert.equal(r.said.detail, "Push it to GitHub to open one.");
  assert.equal(r.link, false, "branch ahead of its upstream");
  r = await show(github, noPr, [other]);
  assert.equal(r.listLink, false, "nor in the list");

  await git(github, "remote", "set-url", "origin", bare);
  await git(github, "push", "-q", "origin", "feat");
  await git(github, "remote", "set-url", "origin", "https://github.com/o/here.git");
  await git(github, "reset", "-q", "--hard", "HEAD~1");
  r = await show(github, noPr);
  assert.equal(r.panel.pushed, false, "an upstream past HEAD is not this branch on GitHub");
  assert.equal(r.panel.behind, true);
  assert.equal(r.said.detail, "Pull it from GitHub to open one.");
  assert.equal(r.link, false, "branch behind its upstream");
  r = await show(github, noPr, [other]);
  assert.equal(r.listLink, false, "nor in the list");

  await git(github, "checkout", "-q", "-b", "main");
  await git(github, "remote", "set-url", "origin", bare);
  await git(github, "push", "-q", "-u", "origin", "main");
  await git(github, "remote", "set-url", "origin", "https://github.com/o/here.git");
  r = await show(github, { code: 1, stdout: "", stderr: 'no pull requests found for branch "main"' });
  assert.equal(r.panel.pushed, true);
  assert.equal(r.said.detail, "It is the default branch; open one from another.");
  assert.equal(r.link, false, "the default branch");
  r = await show(github, { code: 1, stdout: "", stderr: 'no pull requests found for branch "main"' }, [other]);
  assert.equal(r.listLink, false, "nor in the list");
});

const TONE = { dim: "dim", red: "red", yellow: "yellow", green: "green", violet: "violet" };
const passed = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];
const failed = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "ci" }];

async function shownMerge(pr, permission = "WRITE") {
  const ids = [];
  const ui = singleUse();
  const exec = async (command, args) => {
    if (command === "git") {
      const out = { "rev-parse": "/repo\n", branch: "feat\n", remote: "git@github.com:o/here.git\n" }[args[0]];
      return { code: 0, stdout: out ?? "", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: JSON.stringify([pr]), stderr: "" };
    if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify(pr), stderr: "" };
    if (args[0] === "repo" && args.includes("viewerPermission")) return { code: 0, stdout: `${permission}\n`, stderr: "" };
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "me\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "offline" };
  };
  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], {
    ...ui, Button: { new: (id) => { ids.push(id); return ui.Button.new(); } },
    exec, key: () => "repo", location: () => ({ cwd: "/repo", on: null }),
  });
  const panel = new PullRequest();
  Object.assign(panel, { expanded: {}, openPrs: [], selected: null, threads: [] });
  const { cx, drain } = context();
  panel.context = "repo";
  panel.listing = true;
  panel.refresh(cx); await drain();
  panel.hero(TONE, true);
  return { panel, merge: ids.includes("pr-merge") };
}

const pull = (over) => ({
  number: 575, title: "Ship it", url: "https://github.com/o/here/pull/575", state: "OPEN", isDraft: false,
  author: { login: "me" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-10T00:00:00Z",
  mergeable: "MERGEABLE", statusCheckRollup: passed, additions: 1, deletions: 0, changedFiles: 1, ...over,
});

function assertHeld(view, text) {
  assert.equal(view.panel.verdict(TONE).text, text);
  assert.equal(view.panel.canMerge(), false);
  assert.equal(view.merge, false);
  assert.equal(/ready/i.test(view.panel.verdict(TONE).text), false);
  assert.equal(view.panel.rowState(view.panel.openPrs[0], TONE).text, text);
  assert.equal(/ready/i.test(view.panel.rowState(view.panel.openPrs[0], TONE).text), false);
}

test("A clean pull request is ready to merge only for someone who can push", async () => {
  const yes = await shownMerge(pull({ mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }));
  assert.equal(yes.panel.verdict(TONE).text, "Ready to merge");
  assert.equal(yes.panel.canMerge(), true);
  assert.equal(yes.merge, true);
  assert.equal(yes.panel.rowState(yes.panel.openPrs[0], TONE).text, "Ready to merge");
  const no = await shownMerge(pull({ mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }), "READ");
  assertHeld(no, "No permission to merge");
  const unread = await shownMerge(pull({ mergeStateStatus: "CLEAN" }), "");
  assert.equal(unread.panel.canMerge(), false);
  assert.equal(unread.merge, false);
  assert.equal(/ready/i.test(unread.panel.verdict(TONE).text), false);
});

test("A pull request with hooks still offers merge when GitHub would", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "HAS_HOOKS", reviewDecision: "APPROVED" }));
  assert.equal(view.panel.verdict(TONE).text, "Ready to merge");
  assert.equal(view.panel.canMerge(), true);
  assert.equal(view.merge, true);
});

test("An unstable pull request shows the failing checks and no Merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "UNSTABLE", statusCheckRollup: failed }));
  assert.equal(view.panel.verdict(TONE).text, "1 check failing");
  assert.equal(view.panel.canMerge(), false);
  assert.equal(view.merge, false);
  assert.equal(/ready/i.test(view.panel.verdict(TONE).text), false);
  assert.equal(view.panel.rowState(view.panel.openPrs[0], TONE).text, "1 check failing");
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
  assert.equal(view.panel.verdict(TONE).text.includes("Ready"), false);
});

test("A pull request that still needs a review is not ready to merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "BLOCKED", mergeable: "MERGEABLE", reviewDecision: "REVIEW_REQUIRED" }));
  assertHeld(view, "Review required");
  assert.equal(view.panel.inboxState({ draft: false, reviewDecision: "REVIEW_REQUIRED" }, TONE).text, "Review required");
  assert.equal(/ready/i.test(view.panel.inboxState({ draft: false, reviewDecision: "REVIEW_REQUIRED" }, TONE).text), false);
});

test("A pull request with changes requested is not ready to merge", async () => {
  const view = await shownMerge(pull({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: failed }));
  assertHeld(view, "Changes requested");
  assert.equal(view.panel.inboxState({ draft: false, reviewDecision: "CHANGES_REQUESTED" }, TONE).text, "Changes requested");
  assert.equal(/ready/i.test(view.panel.inboxState({ draft: false, reviewDecision: "APPROVED" }, TONE).text), false);
});
