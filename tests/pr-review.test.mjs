import assert from "node:assert/strict";
import test from "node:test";
import { clone as plain, context, failure, load, success } from "./helpers.mjs";
import { openedPanel, recorder, reviewFields } from "./pr-fixtures.mjs";

const api = await load("kanso-panel/pr-review.js", ["REVIEWS", "reviewArgs", "createdId", "reviewable", "ready"]);
const acts = await load("kanso-panel/pr-act.js", ["undoCalls", "pendingOf", "doneOf", "refusedOf", "undoneOf", "canUndo", "saidOf", "refusedTitle"]);
const { REVIEWS, reviewArgs, createdId, reviewable, ready } = api;
const { undoCalls, pendingOf, doneOf, refusedOf, undoneOf, canUndo, saidOf, refusedTitle } = acts;
const pull = { o: "acme", r: "app", number: 12 };
const open = (login) => ({ state: "OPEN", author: { login } });

test("An approve, a request for changes and a comment each post with -f, and a body that starts with @ stays text", () => {
  const approve = reviewArgs("approve", { ...pull, body: "ship" });
  const changes = reviewArgs("changes", { ...pull, body: "@ada please" });
  const comment = reviewArgs("comment", { ...pull, body: "@ada please" });
  assert.deepEqual(plain(approve), ["api", "-X", "POST", "repos/acme/app/pulls/12/reviews", "-f", "event=APPROVE", "-f", "body=ship"]);
  assert.deepEqual(plain(changes), ["api", "-X", "POST", "repos/acme/app/pulls/12/reviews", "-f", "event=REQUEST_CHANGES", "-f", "body=@ada please"]);
  assert.deepEqual(plain(comment), ["api", "-X", "POST", "repos/acme/app/issues/12/comments", "-f", "body=@ada please"]);
  assert.equal([...approve, ...changes, ...comment].includes("-F"), false);
});

test("Undoing an approval or a request for changes dismisses that review, and undoing a comment deletes it", () => {
  assert.deepEqual(plain(undoCalls({ kind: "approve", id: 7 }, pull)), [["api", "-X", "PUT", "repos/acme/app/pulls/12/reviews/7/dismissals", "-f", "message=Undone from kansō", "-f", "event=DISMISS"]]);
  assert.deepEqual(plain(undoCalls({ kind: "changes", id: 8 }, pull)), [["api", "-X", "PUT", "repos/acme/app/pulls/12/reviews/8/dismissals", "-f", "message=Undone from kansō", "-f", "event=DISMISS"]]);
  assert.deepEqual(plain(undoCalls({ kind: "comment", id: 9 }, pull)), [["api", "-X", "DELETE", "repos/acme/app/issues/comments/9"]]);
});

test("A created review's id is read, and a bad answer is not", () => {
  assert.equal(createdId('{"id":42,"state":"APPROVED"}\n'), 42);
  assert.equal(createdId("not json"), null);
  assert.equal(createdId("{}"), null);
  assert.equal(createdId('{"id":"42"}'), null);
});

test("The author of an open pull request can comment, someone else can approve, and a closed one can do neither", () => {
  assert.deepEqual(plain(reviewable(open("ada"), "Ada")), { approve: false, changes: false, comment: true });
  assert.deepEqual(plain(reviewable(open("ada"), "bea")), { approve: true, changes: true, comment: true });
  assert.deepEqual(plain(reviewable(open("ada"), "")), { approve: false, changes: false, comment: true });
  assert.deepEqual(plain(reviewable({ state: "CLOSED", author: { login: "ada" } }, "bea")), { approve: false, changes: false, comment: false });
});

test("A review is ready when it needs no body, or the body is not blank", () => {
  assert.equal(REVIEWS.approve.needsBody, false);
  assert.equal(ready("approve", ""), true);
  assert.equal(ready("changes", "  "), false);
  assert.equal(ready("comment", "@ada"), true);
});

test("A review goes pending, then done, and only a done review with an id can be undone", () => {
  const pending = pendingOf("approve");
  const done = doneOf("changes", 7);
  const refused = refusedOf("comment", "HTTP 422\nmore");
  const undone = undoneOf(done);
  assert.deepEqual(plain(pending), { kind: "approve", state: "pending", at: null });
  assert.equal(String(saidOf(pending)), "Approving…");
  assert.equal(String(saidOf(pendingOf("changes"))), "Requesting changes…");
  assert.equal(String(saidOf(pendingOf("comment"))), "Commenting…");
  assert.deepEqual(plain(done), { kind: "changes", state: "done", id: 7, at: null });
  assert.equal(String(saidOf(done)), "Changes requested");
  assert.equal(canUndo(done), true);
  assert.equal(canUndo(doneOf("approve", null)), false);
  assert.equal(canUndo(pending), false);
  assert.equal(String(saidOf(refused)), "HTTP 422");
  assert.equal(plain(undone).state, "undone");
  assert.equal(String(saidOf(undone)), "Undone");
  assert.equal(canUndo(undone), false);
});

const tone = new Proxy({}, { get: () => "#888" });

test("An open pull request by someone else offers Approve, Request changes and Comment, and your own offers Comment only", async () => {
  const ui = recorder();
  const panel = await openedPanel({
    ...ui,
    ...reviewFields(ui),
    exec: async () => failure("offline"),
    appHome: () => "/tmp",
    home: () => "/Users/x",
    key: () => JSON.stringify({ cwd: "/work/review", on: null }),
    location: () => ({ cwd: "/work/review", on: null }),
  });
  const drawn = context();
  drawn.cx.timer = { every() {} };
  panel.init(drawn.cx);
  await drawn.drain();
  const url = "https://github.com/acme/app/pull/3";
  const has = (text) => ui.texts.some((line) => line === text);
  panel.viewer = "jj";
  panel.session.pr = { number: 3, title: "Ship", url, state: "OPEN", author: { login: "ada" }, headRefName: "feat", baseRefName: "main" };
  panel.session.loading = false;
  ui.texts.length = 0;
  panel.hero(tone);
  assert.equal(has("Approve"), true);
  assert.equal(has("Request changes"), true);
  assert.equal(has("Comment"), true);
  ui.texts.length = 0;
  panel.session.pr = { ...panel.session.pr, author: { login: "jj" } };
  panel.hero(tone);
  assert.equal(has("Comment"), true);
  assert.equal(has("Approve"), false);
  assert.equal(has("Request changes"), false);
  ui.texts.length = 0;
  panel.session.acted = doneOf("approve", 7);
  panel.session.actedFor = url;
  panel.hero(tone);
  assert.equal(has("Approved"), true);
  assert.equal(has("Undo"), true);
});

const issue = (number) => ({
  number, title: "Pull " + number, url: "https://github.com/jlopezlira/herdr-kanso/pull/" + number,
  state: "OPEN", isDraft: false, author: { login: "ada" }, headRefName: "feat", baseRefName: "main",
  updatedAt: "2026-11-20T00:00:00Z", additions: 1, deletions: 0, changedFiles: 1,
});

const reviewPanel = async () => {
  const ui = recorder();
  const calls = [];
  const gate = { current: null };
  const after = [];
  const exec = async (command, args) => {
    if (command !== "gh") return failure("offline");
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return success(JSON.stringify(issue(Number(String(args[2]).split("/").at(-1)))));
    if (args[0] === "api" && args[2] === "POST" && String(args[3]).includes("/comments")) return gate.current ?? success("{\"id\":19}\n");
    if (args[0] === "api" && args[2] === "DELETE") return failure("gh: HTTP 403: Forbidden");
    if (args[0] === "api" && args[1] === "user") return success("jj\n");
    return failure("offline");
  };
  const panel = await openedPanel({
    ...ui, ...reviewFields(ui), exec,
    appHome: () => "/tmp/pr-review-drafts", home: () => "/Users/x",
    key: () => JSON.stringify({ cwd: "/work/reviews", on: null }),
    location: () => ({ cwd: "/work/reviews", on: null }),
  });
  const tasks = context();
  tasks.cx.timer = { every() {}, after(_ms, fn) { after.push(fn); } };
  const flush = () => { const queued = after.splice(0); for (const fn of queued) fn(tasks.cx); };
  panel.viewer = "jj";
  panel.init(tasks.cx);
  await tasks.drain();
  const open = async (number) => {
    panel.choose(issue(number), tasks.cx);
    await tasks.drain();
    flush();
    panel.showDraft?.(tasks.cx);
    flush();
  };
  const press = (id) => {
    ui.texts.length = 0;
    panel.hero(tone);
    const click = ui.clicks.get(id);
    if (!click) return false;
    click({}, tasks.cx);
    return true;
  };
  return { panel, ui, calls, gate, tasks, open, press, flush };
};

const commentBodies = (calls) => calls.filter((args) => args[0] === "api" && args[2] === "POST" && String(args[3]).includes("/comments")).map((args) => String(args.find((arg) => String(arg).startsWith("body=")) ?? ""));

test("Words typed for one pull request are not sent as the comment on another", async () => {
  const { panel, calls, open, press, tasks } = await reviewPanel();
  await open(436);
  panel.reviewText.state.type("draft for #436", tasks.cx);
  await open(437);
  assert.equal(panel.session.pr.number, 437);
  press("pr-review-comment");
  await tasks.drain();
  assert.equal(commentBodies(calls).some((body) => body.includes("draft for #436")), false);
  await open(436);
  assert.equal(panel.draftOf(issue(436).url), "draft for #436");
});

test("Words typed while a review is being sent stay on that pull request", async () => {
  const { panel, gate, tasks, open, press } = await reviewPanel();
  let release;
  gate.current = new Promise((resolve) => { release = () => resolve(success("{\"id\":19}\n")); });
  await open(436);
  panel.reviewText.state.type("first", tasks.cx);
  assert.equal(press("pr-review-comment"), true);
  panel.reviewText.state.type("second", tasks.cx);
  release();
  await tasks.drain();
  assert.equal(panel.draftOf(issue(436).url), "second");
});

test("A refused Undo keeps the review as sent and says the Undo failed", async () => {
  const { panel, ui, tasks, open, press } = await reviewPanel();
  await open(436);
  panel.reviewText.state.type("a note", tasks.cx);
  assert.equal(press("pr-review-comment"), true);
  await tasks.drain();
  assert.equal(press("pr-act-undo"), true);
  await tasks.drain();
  const outcome = plain(panel.session.acted);
  assert.equal(outcome.state, "done");
  assert.equal(outcome.id, 19);
  assert.match(String(outcome.undoError), /403/);
  ui.texts.length = 0;
  panel.hero(tone);
  assert.equal(ui.texts.includes("Commented"), true);
  assert.equal(ui.texts.includes("Undo failed"), true);
  assert.equal(ui.texts.includes(String(refusedTitle({ kind: "comment" }))), false);
  assert.equal(ui.texts.includes("Review not sent"), false);
});

test("A refused Undo keeps the sent review, and undoing drops that refusal", async () => {
  const { undoRefusedOf: refuseUndo, undoneOf: clearUndo, doneOf: finished } = await load("kanso-panel/pr-act.js", ["undoRefusedOf", "undoneOf", "doneOf"]);
  const refused = refuseUndo(finished("comment", 19), "gh: HTTP 403: Forbidden");
  assert.equal(plain(refused).state, "done");
  assert.equal(plain(refused).id, 19);
  assert.equal(String(plain(refused).undoError), "gh: HTTP 403: Forbidden");
  const cleared = plain(clearUndo(refused));
  assert.equal(cleared.state, "undone");
  assert.equal(Object.hasOwn(cleared, "undoError"), false);
});
