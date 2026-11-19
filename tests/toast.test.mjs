// kanso-toast: a toast already on screen is not shown again, and the stack keeps the newest three.
import { loadToast, loadTokens } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, nodes, texts, svgsOf, calls, arg, numberArguments, drawingHost, KIT_NIGHT } from "./helpers.mjs";

// Herdr's side: posting opens a copy of the mod with the notification as its props.
async function screen(clock = null) {
  const store = {}, closed = [];
  const current = { props: null };
  const host = {
    theme: () => ({}), run: () => {},
    props: () => current.props,
    shared: (k) => store[k], setShared: (k, v) => { store[k] = clone(v); },
    closeOverlay: (id) => closed.push(id),
    ...(clock ? { Date: { now: () => clock.now } } : {}),
  };
  const { Toast } = await loadToast(host);
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

test("Clicking one away closes those past their clock too, so none is forgotten while still drawn", async () => {
  const clock = { now: 1000 };
  const { post, up, closed } = await screen(clock);
  post("t1", { title: "Saved", timeout: 100 });
  const two = post("t2", { title: "Other", timeout: 60000 });
  clock.now = 1200;
  two.dismiss();
  assert.deepEqual(closed, ["t1", "t2"], "t1 is past its clock but maybe still drawn: closed, not just dropped");
  assert.deepEqual(up(), []);
});

// Draws a toast as Herdr shows it, with a host that records every element and call, so a test reads what is on screen.
const night = { ...KIT_NIGHT, popover: "#20201e" };
const { tokens } = await loadTokens(drawingHost());
const c = tokens(night);
async function drawn(notification) {
  const ran = [], closed = [];
  const { Toast } = await loadToast({
    ...drawingHost(), theme: () => night, props: () => ({ overlay: "o1", ...notification }),
    run: (name, args) => ran.push([name, args]), shared: () => undefined, setShared: () => {}, closeOverlay: (id) => closed.push(id),
  });
  const el = new Toast().render();
  const inked = (tag, color) => nodes(el).some((kid) => kid.tag === tag && calls(kid, "text_color").some(([, ink]) => ink === color));
  const filled = (color) => nodes(el).some((kid) => calls(kid, "bg").some(([, fill]) => fill === color));
  const click = (cx = {}) => calls(el, "on_click").forEach(([, handler]) => handler(null, cx));
  return { el, ran, closed, inked, filled, click, svgs: svgsOf(el), words: texts(el), tip: arg(el, "tooltip") };
}

test("A failure leads with the blocked mark, even with an icon, and offers its fix", async () => {
  const shown = await drawn({ level: "error", title: "kansō was not updated", body: "permission denied", icon: "refresh-cw", action: { name: "kanso-tabs.update", args: { label: "Update" } } });
  assert.ok(shown.filled(c.blocked), "the blocked mark");
  assert.ok(!shown.svgs.some((path) => path.includes("refresh-cw")), "not the home's icon");
  assert.ok(shown.words.includes("Update"), "the fix word on a button");
});

test("A toast with a home's icon draws it in its state's colour: done green, a fact muted", async () => {
  const done = await drawn({ level: "success", title: "kansō updated to 3.31.0", icon: "refresh-cw" });
  assert.deepEqual(done.svgs, ["mods/kanso-chrome/icons/refresh-cw.svg"]);
  assert.ok(done.inked("svg", c.done));
  const fact = await drawn({ level: "info", title: "kansō is up to date", icon: "refresh-cw" });
  assert.ok(fact.inked("svg", c.muted));
});

test("Without an icon, a success leads with the check and the rest with their level's dot", async () => {
  const success = await drawn({ level: "success", title: "Merged #142" });
  assert.deepEqual(success.svgs, ["mods/kanso-chrome/icons/check.svg"]);
  assert.ok(success.inked("svg", c.done));
  assert.ok((await drawn({ level: "warning", title: "Slow" })).filled(c.working));
  assert.ok((await drawn({ title: "Saved" })).filled(c.accent));
});

test("Herdr's own toasts keep their picture", async () => {
  const pictures = (shown) => nodes(shown.el).flatMap((kid) => calls(kid, "image").map(([, path]) => path));
  const agent = await drawn({ level: "success", title: "api finished", icon: "/Applications/Claude.app/icon.png" });
  assert.deepEqual(pictures(agent), ["/Applications/Claude.app/icon.png"]);
  const windows = await drawn({ level: "success", title: "api finished", icon: "C:\\Program Files\\Claude\\icon.png" });
  assert.deepEqual(pictures(windows), ["C:\\Program Files\\Claude\\icon.png"], "a Windows path too");
  assert.deepEqual(windows.svgs, []);
});

test("A toast says one sentence on one line; its detail is its tooltip, or the sentence when it has none", async () => {
  const shown = await drawn({ level: "error", title: "kansō was not updated", body: "permission denied" });
  assert.ok(shown.words.includes("kansō was not updated"));
  assert.ok(!shown.words.includes("permission denied"), "no second line");
  assert.equal(shown.tip, "permission denied", "the detail alone, not the sentence again");
  assert.ok(nodes(shown.el).some((kid) => calls(kid, "truncate").length), "a long sentence is cut on its one line");
  const bare = await drawn({ title: "Saved" });
  assert.equal(bare.tip, "Saved", "a cut sentence can still be read whole");
  assert.ok(!nodes(bare.el).some((kid) => kid.tag === "toast-fix"), "no fix word, no button");
});

test("A toast is a button: Tab reaches it, and its focus ring shows", async () => {
  const shown = await drawn({ title: "Saved" });
  assert.equal(shown.el.tag, "toast");
  assert.equal(calls(shown.el, "focus").length, 1);
});

test("A click runs the toast's command without its fix word, and closes it", async () => {
  const shown = await drawn({ level: "error", title: "Herdr's mod runtime is out of memory", action: { name: "kanso-chrome.restart", args: { label: "Restart" } } });
  shown.click();
  assert.deepEqual(clone(shown.ran), [["kanso-chrome.restart", {}]]);
  assert.deepEqual(shown.closed, ["o1"]);
  const agent = await drawn({ title: "api finished", action: { name: "agent.focus", args: { terminal: "w1" } } });
  agent.click();
  assert.deepEqual(clone(agent.ran), [["agent.focus", { terminal: "w1" }]], "other args go through");
  const plain = await drawn({ title: "Saved" });
  plain.click();
  assert.deepEqual(plain.ran, [], "nothing to run");
  assert.deepEqual(plain.closed, ["o1"]);
});

test("Pressing the fix word runs the command once and closes the toast", async () => {
  const shown = await drawn({ level: "error", title: "GitHub could not be reached", action: { name: "kanso-tabs.check", args: { label: "Refresh" } } });
  const stopped = [];
  const fix = nodes(shown.el).find((kid) => kid.tag === "toast-fix");
  calls(fix, "on_click").forEach(([, handler]) => handler({}, { stop_propagation: () => stopped.push(true) }));
  assert.deepEqual(clone(shown.ran), [["kanso-tabs.check", {}]]);
  assert.deepEqual(stopped, [true], "the toast's own click does not run it a second time");
  assert.deepEqual(shown.closed, ["o1"]);
});

// Each Notice state on the Toast page: the notification Herdr gives, and what both kits draw from the same props.
const NOTICES = {
  Failure: { level: "error", title: "Couldn't pull checkout", body: "not a fast-forward", action: { name: "x", args: { label: "Retry" } } },
  Information: { level: "info", title: "kansō is up to date" },
  "Long source": { level: "error", title: "Couldn't push feat/checkout-countdown-with-a-very-long-branch-name to origin", body: "remote: rejected" },
  Success: { level: "success", title: "Merged #142" },
  Warning: { level: "warning", title: "GitHub is slow to answer" },
  "With action": { level: "success", title: "kansō 3.31.0 is ready", action: { name: "y", args: { label: "Update" } } },
};

test("Each Notice state draws its sentence, its detail as the tooltip and its fix", async () => {
  const { toastOf } = await load("kanso-toast/toast-model.js", ["toastOf"]);
  for (const [state, notification] of Object.entries(NOTICES)) {
    const props = clone(toastOf(notification));
    const shown = await drawn(notification);
    assert.deepEqual([shown.words.includes(notification.title), shown.tip], [true, props.detail], state);
    assert.equal(props.detail, notification.body ?? notification.title, `${state}: the detail is the tooltip`);
    assert.equal(shown.words.includes(props.action), Boolean(props.action), `${state}: the fix`);
  }
});

test("The toast piece reads every size from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-toast.js"), []);
});
