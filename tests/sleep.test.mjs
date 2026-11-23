import test from "node:test";
import assert from "node:assert/strict";
import { arg, calls, drawingHost, find, KIT_NIGHT, load, texts } from "./helpers.mjs";

const sleep = async ({ order, busy = null, error = null, closed = [] } = {}) => {
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], {
    ...drawingHost(),
    theme: () => KIT_NIGHT,
    props: () => ({ overlay: "sleep-overlay" }),
    closeOverlay: (id) => closed.push(id),
    home: () => "/home/me",
  });
  const view = Object.assign(new Sleep(), {
    handle: {}, order, busy, error, reads: [], space: { name: "App", folder: "/repo" },
  });
  return { view, closed };
};

const secondary = (el) => find(el, (node) => node.tag === "kanso-sleep-secondary");

test("The Wake dialog and the agent and tab sleep dialogs show Close, and it closes the overlay", async () => {
  for (const order of [null, { scope: "agent" }, { scope: "tab" }]) {
    const { view, closed } = await sleep({ order });
    const close = secondary(view.render());
    assert.equal(arg(close, "accessibility_label"), "Close");
    assert.equal(arg(close, "disabled") ?? false, false);
    arg(close, "on_click")({}, { stop_propagation() {} });
    assert.deepEqual(closed, ["sleep-overlay"]);
  }
});

test("A project sleep shows Cancel beside Sleep, Close once it failed, and the button is disabled while busy", async () => {
  const open = await sleep({ order: { scope: "project" } });
  const drawn = open.view.render();
  assert.ok(texts(drawn).includes("Cancel") && texts(drawn).includes("Sleep"));
  assert.equal(texts(drawn).includes("Close"), false);
  const failed = await sleep({ order: { scope: "project" }, error: "It can't sleep now: nothing here keeps a conversation to wake on." });
  const close = secondary(failed.view.render());
  assert.equal(arg(close, "accessibility_label"), "Close");
  assert.equal(texts(failed.view.render()).includes("Cancel"), false);
  arg(close, "on_click")({}, { stop_propagation() {} });
  assert.deepEqual(failed.closed, ["sleep-overlay"]);
  for (const order of [null, { scope: "agent" }, { scope: "tab" }, { scope: "project" }]) {
    const held = await sleep({ order, busy: "Going to sleep" });
    const button = secondary(held.view.render());
    assert.equal(arg(button, "disabled"), true, order?.scope ?? "wake");
    assert.equal(calls(button, "on_click").length, 0);
  }
});
