import assert from "node:assert/strict";
import test from "node:test";
import { clone as plain, context, failure, load } from "./helpers.mjs";
import { openedPanel, recorder } from "./pr-fixtures.mjs";

const api = await load("kanso-panel/pr-review.js", [
  "REVIEWS", "reviewArgs", "undoArgs", "createdId", "reviewable", "ready",
  "pendingOf", "doneOf", "refusedOf", "undoneOf", "canUndo", "saidOf",
]);
const { REVIEWS, reviewArgs, undoArgs, createdId, reviewable, ready, pendingOf, doneOf, refusedOf, undoneOf, canUndo, saidOf } = api;
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
  assert.deepEqual(plain(undoArgs({ kind: "approve", id: 7 }, pull)), ["api", "-X", "PUT", "repos/acme/app/pulls/12/reviews/7/dismissals", "-f", "message=Undone from kansō", "-f", "event=DISMISS"]);
  assert.deepEqual(plain(undoArgs({ kind: "changes", id: 8 }, pull)), ["api", "-X", "PUT", "repos/acme/app/pulls/12/reviews/8/dismissals", "-f", "message=Undone from kansō", "-f", "event=DISMISS"]);
  assert.deepEqual(plain(undoArgs({ kind: "comment", id: 9 }, pull)), ["api", "-X", "DELETE", "repos/acme/app/issues/comments/9"]);
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
  assert.deepEqual(plain(pending), { kind: "approve", state: "pending" });
  assert.equal(String(saidOf(pending)), "Approving…");
  assert.equal(String(saidOf(pendingOf("changes"))), "Requesting changes…");
  assert.equal(String(saidOf(pendingOf("comment"))), "Commenting…");
  assert.deepEqual(plain(done), { kind: "changes", state: "done", id: 7 });
  assert.equal(String(saidOf(done)), "Changes requested");
  assert.equal(canUndo(done), true);
  assert.equal(canUndo(doneOf("approve", null)), false);
  assert.equal(canUndo(pending), false);
  assert.equal(String(saidOf(refused)), "HTTP 422");
  assert.equal(plain(undone).state, "undone");
  assert.equal(String(saidOf(undone)), "Undone");
  assert.equal(canUndo(undone), false);
});

const fieldState = () => ({
  value: () => "",
  set_value() {},
  set_auto_grow() {},
  set_selected_range() {},
  on() { return this; },
  focus() {},
  release() {},
});
const tone = new Proxy({}, { get: () => "#888" });

test("An open pull request by someone else offers Approve, Request changes and Comment, and your own offers Comment only", async () => {
  const ui = recorder();
  const panel = await openedPanel({
    ...ui,
    Textarea: { new: () => ui.div() },
    TextareaState: { new: fieldState },
    InputState: { new: fieldState },
    ScrollHandle: { new: () => ({}) },
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
  panel.session.reviewed = doneOf("approve", 7);
  panel.session.reviewFor = url;
  panel.hero(tone);
  assert.equal(has("Approved"), true);
  assert.equal(has("Undo"), true);
});
