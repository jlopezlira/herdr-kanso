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
  const up = () => Object.values(store["kanso.toasts"] ?? {}).flat().map((s) => s.id).filter((id) => !closed.includes(id));
  return { post, up, closed, store };
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
  assert.equal(admit(shown, { overlay: "y", title: "Saved" }, 4999).show, false, "still up");
  const late = admit(shown, { overlay: "y", title: "Saved" }, 5100);
  assert.equal(late.show, true, "gone by its clock");
  assert.deepEqual(clone(late.close), ["x"], "and closed here, in case Herdr's poll has not taken it down yet");
  assert.equal(onScreen("junk", 0).length, 0, "a list from elsewhere is nothing on screen");
  assert.notEqual(keyOf({ title: "a", body: "b" }), keyOf({ title: "a b" }), "title and body kept apart");

  const { post, up } = await screen();
  const first = post("t1", { title: "Saved" });
  first.dismiss();
  assert.deepEqual(up(), [], "clicked away");
  post("t2", { title: "Saved" });
  assert.deepEqual(up(), ["t2"], "and shown again");
});

test("Two agents of one name finishing are two toasts, each going to its own", async () => {
  const { post, up } = await screen();
  const done = (terminal) => ({ title: "api finished", level: "success", action: { name: "agent.focus", args: { terminal } } });
  post("t1", done("w1"));
  post("t2", done("w2"));
  post("t3", done("w2"));
  assert.deepEqual(up(), ["t1", "t2"]);
});

test("Toasts from before a restart, or from another window, are never read or closed: Herdr numbers overlays afresh", async () => {
  const { post, up, closed, store } = await screen();
  store["kanso.toasts"] = { "old-start": [{ id: "o1", key: JSON.stringify(["", "Saved", "", null]), until: Date.now() + 60000 }] };
  post("o1", { title: "Saved" });
  assert.deepEqual(closed, [], "the same words and the same id, but another start's: shown, nothing closed");
  ["o2", "o3", "o4"].forEach((id) => post(id, { title: id }));
  assert.deepEqual(closed, ["o1"], "only this window's own oldest makes room");
  assert.deepEqual(store["kanso.toasts"]["old-start"].map((s) => s.id), ["o1"], "the other start's list kept while it is up, never touched");
  assert.deepEqual(up().filter((id) => id !== "o1"), ["o2", "o3", "o4"]);
  const { keep } = await load("kanso-toast/stack.js", ["keep"]);
  assert.deepEqual(Object.keys(keep({ gone: [{ id: "x", until: 1 }], here: [{ id: "y", until: 9 }] }, "now", [], 5)), ["here"], "a start with nothing up is dropped");
});
