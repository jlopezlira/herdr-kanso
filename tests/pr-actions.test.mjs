import assert from "node:assert/strict";
import test from "node:test";
import { clone as plain, context, failure, load, success } from "./helpers.mjs";
import { loadPullRequest } from "./mod-fixtures.mjs";
import { blankPanel, recorder, reviewFields } from "./pr-fixtures.mjs";

const tone = new Proxy({}, { get: () => "#888" });
const pull = { o: "acme", r: "app", number: 12 };
const url = "https://github.com/acme/app/pull/12";

test("Undoing each action names the one GitHub call that takes it back, and a merge cannot be undone", async () => {
  const { undoCalls, canUndo, doneOf } = await load("kanso-panel/pr-act.js", ["undoCalls", "canUndo", "doneOf"], {});
  const dismiss = (id) => [["api", "-X", "PUT", "repos/acme/app/pulls/12/reviews/" + id + "/dismissals", "-f", "message=Undone from kansō", "-f", "event=DISMISS"]];
  assert.deepEqual(plain(undoCalls(doneOf("approve", 7), pull)), dismiss(7));
  assert.deepEqual(plain(undoCalls(doneOf("changes", 8), pull)), dismiss(8));
  assert.deepEqual(plain(undoCalls(doneOf("comment", 9), pull)), [["api", "-X", "DELETE", "repos/acme/app/issues/comments/9"]]);
  assert.deepEqual(plain(undoCalls(doneOf("reply", 10), pull)), [["api", "-X", "DELETE", "repos/acme/app/pulls/comments/10"]]);
  assert.deepEqual(plain(undoCalls(doneOf("rerun", ["11", "12"]), pull)), [["run", "cancel", "11", "-R", "acme/app"], ["run", "cancel", "12", "-R", "acme/app"]]);
  assert.deepEqual(plain(undoCalls(doneOf("close", url), pull)), [["pr", "reopen", url]]);
  assert.deepEqual(plain(undoCalls(doneOf("ready", url), pull)), [["pr", "ready", url, "--undo"]]);
  assert.deepEqual(plain(undoCalls(doneOf("create", url), pull)), [["pr", "close", url]]);
  assert.deepEqual(plain(undoCalls(doneOf("merge", url), pull)), []);
  assert.equal(canUndo(doneOf("merge", url)), false);
});

const ghOf = (calls) => calls.filter((call) => call[0] === "gh").map((call) => call.slice(1));

const actionPanel = async (answer) => {
  const ui = recorder();
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args]);
    const given = answer(command, args);
    return given ?? failure("offline");
  };
  const { PullRequest } = await loadPullRequest({ ...ui, ...reviewFields(ui), exec, notify: () => {}, appHome: () => "/tmp/pr-actions", home: () => "/Users/x", key: () => "repo", location: () => ({ cwd: "/repo", on: null }) });
  const panel = blankPanel(PullRequest, {});
  const tasks = context();
  tasks.cx.timer = { every() {}, after() {} };
  panel.init(tasks.cx);
  await tasks.drain();
  panel.session.context = "repo";
  panel.session.pr = { number: 12, title: "Ship", url, state: "OPEN", author: { login: "ada" }, headRefName: "feat", baseRefName: "main", mergeStateStatus: "CLEAN" };
  panel.session.branch = "feat";
  panel.session.root = "/repo";
  panel.viewer = "jj";
  panel.session.permission = "WRITE";
  return { panel, ui, calls, tasks };
};

test("Re-run asks GitHub once per distinct run, naming the repository, and Undo cancels each", async () => {
  const { panel, calls, tasks } = await actionPanel((command, args) => (command === "gh" && args[0] === "run" ? success("") : undefined));
  panel.session.rerun(["11", "11", null, "12"], tasks.cx);
  await tasks.drain();
  const reran = ghOf(calls).filter((args) => args[0] === "run" && args[1] === "rerun");
  assert.deepEqual(reran, [["run", "rerun", "11", "--failed", "-R", "acme/app"], ["run", "rerun", "12", "--failed", "-R", "acme/app"]]);
  assert.deepEqual(plain(panel.session.acted), { kind: "rerun", state: "done", id: ["11", "12"], at: null });
  calls.length = 0;
  panel.session.undo(tasks.cx);
  await tasks.drain();
  const cancelled = ghOf(calls).filter((args) => args[0] === "run" && args[1] === "cancel");
  assert.deepEqual(cancelled, [["run", "cancel", "11", "-R", "acme/app"], ["run", "cancel", "12", "-R", "acme/app"]]);
});

test("A reply posts under that thread's comment, draws there and not on the verdict, and keeps a draft that changed", async () => {
  let release;
  const gate = new Promise((resolve) => { release = () => resolve(success("{\"id\":44}\n")); });
  const view = success(JSON.stringify({ number: 12, title: "Ship", url, state: "OPEN", author: { login: "ada" }, headRefName: "feat", baseRefName: "main", updatedAt: "2026-11-20T00:00:00Z" }));
  const { panel, ui, calls, tasks } = await actionPanel((command, args) => {
    if (command === "gh" && args[0] === "pr" && args[1] === "view") return view;
    if (command === "gh" && args[0] === "api") return gate;
    return undefined;
  });
  panel.session.selected = url;
  const thread = { comment: 30, author: "ada", body: "look here", path: "a.js", line: 4, replies: 0 };
  panel.session.threads = [thread];
  panel.replies = { 30: "first" };
  panel.replyOpen = 30;
  panel.session.reply(thread, "first", tasks.cx);
  panel.replies = { 30: "second" };
  release();
  await tasks.drain();
  const posted = ghOf(calls).find((args) => args[0] === "api" && args[2] === "POST");
  assert.deepEqual(posted, ["api", "-X", "POST", "repos/acme/app/pulls/12/comments/30/replies", "-f", "body=first"]);
  assert.equal(plain(panel.session.acted).at, 30);
  assert.equal(panel.replies[30], "second");
  ui.texts.length = 0;
  panel.discussion(tone);
  assert.equal(ui.texts.includes("Replied"), true);
  ui.texts.length = 0;
  panel.hero(tone);
  assert.equal(ui.texts.includes("Replied"), false);
});

test("Creating a pull request refuses an unpushed branch and keeps the text, and a pushed one opens then closes on Undo", async () => {
  const unpushed = await actionPanel(() => undefined);
  unpushed.panel.newTitle.set_value("Ship it");
  unpushed.panel.newBody.set_value("the why");
  unpushed.panel.page = { kind: "new" };
  unpushed.panel.session.createHere("Ship it", "the why", unpushed.tasks.cx);
  await unpushed.tasks.drain();
  assert.match(String(unpushed.panel.session.created?.error), /push feat first/);
  assert.equal(unpushed.panel.newTitle.value(), "Ship it");
  assert.equal(unpushed.panel.newBody.value(), "the why");

  const pushed = await actionPanel((command, args) => {
    if (command === "git" && args[0] === "rev-parse") return success("refs/remotes/origin/feat\n");
    if (command === "git" && args[0] === "rev-list") return success("0\t0\n");
    if (command === "gh" && args[1] === "create") return success("created\nhttps://github.com/acme/app/pull/9\n");
    if (command === "gh" && args[1] === "close") return success("");
    return undefined;
  });
  pushed.panel.page = { kind: "new" };
  pushed.panel.newTitle.set_value("Ship it");
  pushed.panel.session.createHere("Ship it", "notes", pushed.tasks.cx);
  await pushed.tasks.drain();
  const created = ghOf(pushed.calls).find((args) => args[0] === "pr" && args[1] === "create");
  assert.deepEqual(created, ["pr", "create", "--head", "feat", "--title", "Ship it", "--body", "notes"]);
  assert.equal(plain(pushed.panel.session.acted).id, "https://github.com/acme/app/pull/9");
  assert.equal(pushed.panel.page, null);
  pushed.calls.length = 0;
  pushed.panel.session.undo(pushed.tasks.cx);
  await pushed.tasks.drain();
  assert.deepEqual(ghOf(pushed.calls).find((args) => args[0] === "pr"), ["pr", "close", "https://github.com/acme/app/pull/9"]);
});

const failing = {
  __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE",
  detailsUrl: "https://github.com/acme/app/actions/runs/77", workflowName: "CI",
};

test("A failing check offers Re-run to a writer and Full log to anyone, and the log page keeps the lines", async () => {
  const log = ["CI\ttest\t2026-11-20T00:00:00.000Z hello", ...Array.from({ length: 400 }, (_, i) => "CI\ttest\t2026-11-20T00:00:01.000Z line " + (i + 2))].join("\n");
  const { panel, ui, calls, tasks } = await actionPanel((command, args) => (command === "gh" && args[0] === "run" && args[1] === "view" ? success(log) : undefined));
  panel.session.pr = { ...panel.session.pr, statusCheckRollup: [failing] };
  panel.session.permission = "READ";
  ui.texts.length = 0;
  panel.checksList(tone);
  assert.equal(ui.texts.includes("Re-run"), false);
  assert.equal(ui.texts.includes("Full log"), true);
  panel.session.permission = "WRITE";
  ui.texts.length = 0;
  panel.checksList(tone);
  assert.equal(ui.texts.includes("Re-run"), true);
  assert.equal(ui.clicks.get("pr-check-0-verb-1")({}, tasks.cx), undefined);
  await tasks.drain();
  const viewed = ghOf(calls).filter((args) => args[0] === "run" && args[1] === "view");
  assert.deepEqual(viewed, [["run", "view", "77", "--log-failed", "-R", "acme/app"]]);
  ui.texts.length = 0;
  panel.logPage(tone);
  assert.equal(ui.texts.includes("line 2"), true);
  assert.equal(ui.texts.includes("hello"), false);
  assert.equal(ui.texts.some((text) => text.includes("2026-11-20") || text.includes("CI\ttest")), false);
  assert.equal(ui.texts.includes("The last 400 lines; the rest is on GitHub."), true);
  ui.clicks.get("pr-page-back")({}, tasks.cx);
  assert.equal(panel.page, null);
  assert.equal(panel.session.pr.number, 12);
});

const pressKey = (panel, tasks, key, modifiers = {}) => {
  panel.key({ key, modifiers }, tasks.cx);
};

test("Keys on a pull request send the matching action, and only when the field is not focused", async () => {
  const view = success(JSON.stringify({ number: 12, title: "Ship", url, state: "OPEN", author: { login: "ada" }, headRefName: "feat", baseRefName: "main", mergeStateStatus: "CLEAN", updatedAt: "2026-11-20T00:00:00Z" }));
  const { panel, calls, tasks } = await actionPanel((command, args) => {
    if (command === "gh" && args[0] === "pr" && args[1] === "view") return view;
    if (command === "gh" && args[0] === "api") return success("{\"id\":3}\n");
    if (command === "gh" && args[0] === "repo") return success("{\"squashMergeAllowed\":true}\n");
    if (command === "gh" && args[0] === "pr" && args[1] === "merge") return success("");
    if (command === "gh" && args[0] === "run") return success("");
    return undefined;
  });
  panel.session.selected = url;
  let focused = 0;
  panel.reviewText.state.focus = () => { focused += 1; };
  pressKey(panel, tasks, "a");
  await tasks.drain();
  assert.equal(ghOf(calls).some((args) => args.includes("event=APPROVE") && String(args[3]).includes("/pulls/12/reviews")), true);
  calls.length = 0;
  pressKey(panel, tasks, "r");
  await tasks.drain();
  assert.equal(focused, 1);
  assert.equal(ghOf(calls).some((args) => args.includes("event=REQUEST_CHANGES")), false);
  panel.drafts = { [url]: "please" };
  pressKey(panel, tasks, "r");
  await tasks.drain();
  assert.equal(ghOf(calls).some((args) => args.includes("event=REQUEST_CHANGES")), true);
  calls.length = 0;
  panel.session.pr = { ...panel.session.pr, isDraft: true, mergeStateStatus: "DRAFT" };
  panel.checked = null;
  pressKey(panel, tasks, "m");
  pressKey(panel, tasks, "m");
  await tasks.drain();
  assert.equal(ghOf(calls).some((args) => args[1] === "merge"), false);
  panel.session.pr = { ...panel.session.pr, isDraft: false, mergeStateStatus: "CLEAN" };
  panel.session.permission = "WRITE";
  panel.session.stale = false;
  panel.checked = null;
  pressKey(panel, tasks, "m");
  assert.equal(ghOf(calls).some((args) => args[1] === "merge"), false);
  pressKey(panel, tasks, "m");
  await tasks.drain();
  assert.equal(ghOf(calls).some((args) => args[0] === "pr" && args[1] === "merge"), true);
  calls.length = 0;
  panel.session.busy = null;
  panel.session.pr = { ...panel.session.pr, statusCheckRollup: [failing] };
  panel.checked = null;
  pressKey(panel, tasks, "e");
  await tasks.drain();
  assert.deepEqual(ghOf(calls).filter((args) => args[0] === "run" && args[1] === "rerun"), [["run", "rerun", "77", "--failed", "-R", "acme/app"]]);
  calls.length = 0;
  panel.session.busy = null;
  panel.reviewText.focused = true;
  pressKey(panel, tasks, "a");
  panel.reviewText.focused = false;
  for (const name of ["platform", "control", "alt"]) pressKey(panel, tasks, "a", { [name]: true });
  await tasks.drain();
  assert.equal(ghOf(calls).length, 0);
});

test("Board keys move over open rows, fold or open on Enter, and approve a Needs you row in place", async () => {
  const { panel, calls, tasks } = await actionPanel((command, args) => (command === "gh" && args[0] === "api" ? success("{\"id\":5}\n") : undefined));
  const repo = (name) => ({ provider: "github", host: "github.com", owner: "acme", name });
  const needs = { url, provider: "github", host: "github.com", owner: "acme", name: "app", number: 12, title: "Ship", updatedAt: "2026-11-01T00:00:00Z", author: "ada" };
  const yours = { ...needs, url: "https://github.com/acme/app/pull/13", number: 13, title: "Mine" };
  const other = { ...needs, url: "https://github.com/acme/also/pull/2", name: "also", number: 2, title: "Also" };
  panel.session.inboxOn = true;
  panel.session.inboxOpen = true;
  panel.session.scope = { kind: "folder", repos: [repo("app"), repo("also")], local: [] };
  panel.session.inbox = { needs: [needs, other], yours: [yours], login: "jj" };
  panel.handle = { is_focused: () => true, focus() {}, release() {} };
  const shown = panel.board();
  const head = shown.blocks[0].key;
  const openRows = () => panel.boardRows(panel.board());
  panel.session.boardOpen = [head];
  pressKey(panel, tasks, "down");
  assert.equal(panel.cursor, openRows()[0].key);
  pressKey(panel, tasks, "down");
  assert.equal(panel.cursor, openRows()[1].key);
  assert.equal(openRows()[1].needs, true);
  pressKey(panel, tasks, "up");
  assert.equal(panel.cursor, head);
  pressKey(panel, tasks, "Enter");
  assert.equal(panel.session.boardOpen.includes(head), false);
  pressKey(panel, tasks, "Enter");
  pressKey(panel, tasks, "down");
  const row = openRows().find((item) => item.key === panel.cursor);
  pressKey(panel, tasks, "Enter");
  assert.equal(panel.session.inboxOpen, false);
  assert.equal(panel.session.selected, row.pull.url);
  panel.session.inboxOpen = true;
  panel.session.selected = null;
  panel.cursor = row.key;
  pressKey(panel, tasks, "a");
  assert.equal(panel.session.inboxOpen, true);
  assert.equal(panel.session.selected, null);
  await tasks.drain();
  assert.equal(panel.session.selected, null);
  assert.equal(ghOf(calls).some((args) => args.includes("event=APPROVE") && String(args[3]).includes("/pulls/" + row.pull.number + "/reviews")), true);
});

test("Statistics name the oldest Needs you item, the new count and the review size, and the fold follows its switch", async () => {
  const { statsOf } = await load("kanso-panel/pr-board.js", ["statsOf"], {});
  const now = Date.parse("2026-11-20T12:00:00Z");
  const item = (createdAt, extra = {}) => ({ createdAt, updatedAt: createdAt, ...extra });
  const blocks = [{ title: "acme/app", needs: [
    item("2026-11-01T12:00:00Z", { additions: 2, deletions: 1, seenAt: null, title: "old" }),
    item("2026-11-19T12:00:00Z", { additions: 3, deletions: 4, seenAt: now, title: "recent" }),
  ], yours: [item("2026-11-10T12:00:00Z", { additions: 9, deletions: 9, seenAt: now })] }];
  const stats = plain(statsOf(blocks, now));
  assert.equal(stats.oldest.title, "old");
  assert.equal(stats.fresh, 1);
  assert.equal(stats.review.add, 5);
  assert.equal(stats.review.del, 5);
  assert.equal(stats.review.count, 2);
  assert.equal(stats.ages.length, 6);
  assert.equal(Math.max(...stats.ages), 1);
  assert.equal(statsOf([], now), null);
  const { panel, ui } = await actionPanel(() => undefined);
  panel.session.inbox = { needs: [item("2026-11-01T12:00:00Z", { url, provider: "github", host: "github.com", owner: "acme", name: "app", number: 12 })], yours: [], login: "jj" };
  panel.session.scope = { kind: "folder", repos: [{ provider: "github", host: "github.com", owner: "acme", name: "app" }], local: [] };
  panel.session.inboxOn = true;
  ui.texts.length = 0;
  panel.inboxPage(tone);
  assert.equal(ui.texts.includes("Statistics"), true);
  const store = { "pr.stats": "hide" };
  panel.session.inbox = panel.session.inbox;
  const hiddenUi = recorder();
  const hidden = await loadPullRequest({ ...hiddenUi, shared: (key) => (key === "kanso.pieces" ? store : undefined) });
  const quiet = blankPanel(hidden.PullRequest, {});
  quiet.session.inbox = panel.session.inbox;
  quiet.session.scope = panel.session.scope;
  quiet.inboxPage(tone);
  assert.equal(hiddenUi.texts.includes("Statistics"), false);
});
