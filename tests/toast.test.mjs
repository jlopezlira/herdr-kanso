// kanso-toast: a toast already on screen is not shown again, and the stack keeps the newest three.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

// Herdr's side: posting opens a copy of the mod with the notification as its props.
async function screen() {
  const store = {}, closed = [];
  const current = { props: null };
  const host = {
    theme: () => ({}), run: () => {},
    props: () => current.props,
    shared: (k) => store[k], setShared: (k, v) => { store[k] = clone(v); },
    closeOverlay: (id) => closed.push(id),
  };
  const { Toast } = await load("kanso-toast/main.js", ["Toast"], host);
  const post = (overlay, n) => {
    current.props = { overlay, ...n };
    const t = new Toast();
    t.init({}, {});
    return t;
  };
  const up = () => (store["kanso.toasts"] ?? []).map((s) => s.id).filter((id) => !closed.includes(id));
  return { post, up, closed };
}

test("A burst of the same toast shows it once", async () => {
  const { post, up, closed } = await screen();
  post("t1", { title: "The image could not be made", body: "Text file exceeds 1 MiB", level: "error" });
  post("t2", { title: "The image could not be made", body: "Text file exceeds 1 MiB", level: "error" });
  post("t3", { title: "The image could not be made", body: "Text file exceeds 1 MiB", level: "error" });
  assert.deepEqual(up(), ["t1"], "the first stays");
  assert.deepEqual(closed, ["t2", "t3"], "the repeats close before they are seen");
  post("t4", { title: "The image could not be made", body: "Another reason", level: "error" });
  assert.deepEqual(up(), ["t1", "t4"], "a different message is a different toast");
});

test("The stack keeps the newest three; the oldest makes room", async () => {
  const { post, up, closed } = await screen();
  ["a", "b", "c", "d", "e"].forEach((id) => post(id, { title: id }));
  assert.deepEqual(up(), ["c", "d", "e"]);
  assert.deepEqual(closed, ["a", "b"]);
});

test("A toast gone, by its clock or a click, can be shown again", async () => {
  const { lasts, onScreen, admit, keyOf } = await load("kanso-toast/stack.js", ["lasts", "onScreen", "admit", "keyOf"]);
  assert.equal(lasts({ level: "error" }), 8000, "Herdr's clock: errors and warnings 8 s");
  assert.equal(lasts({}), 5000, "the rest 5 s");
  assert.equal(lasts({ timeout: 1200 }), 1200, "or the toast's own");
  const shown = admit([], { overlay: "x", title: "Saved" }, 0).next;
  assert.equal(admit(onScreen(shown, 4999), { overlay: "y", title: "Saved" }, 4999).show, false, "still up");
  assert.equal(admit(onScreen(shown, 5000), { overlay: "y", title: "Saved" }, 5000).show, true, "gone by its clock");
  assert.equal(onScreen("junk", 0).length, 0, "a list from elsewhere is nothing on screen");
  assert.notEqual(keyOf({ title: "a", body: "b" }), keyOf({ title: "a b" }), "title and body kept apart");

  const { post, up } = await screen();
  const first = post("t1", { title: "Saved" });
  first.dismiss();
  assert.deepEqual(up(), [], "clicked away");
  post("t2", { title: "Saved" });
  assert.deepEqual(up(), ["t2"], "and shown again");
});
