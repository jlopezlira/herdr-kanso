// The prompt of many lines: the dialog piece with one multiline kit field, and its keys.
import assert from "node:assert/strict";
import test from "node:test";
import { load, gpuiHost, chain, clone, nodes, texts, press, KIT_NIGHT } from "./helpers.mjs";

// Herdr's multi-line text state, recording what the view asks of it.
const textarea = (log) => ({
  new: (options) => {
    const handlers = {};
    let value = options?.value ?? "";
    log.push(["state", options]);
    return {
      on: (event, fn) => { (handlers[event] ??= []).push(fn); return true; },
      value: () => value,
      set_value: (next) => { value = next; },
      set_auto_grow: (...rows) => log.push(["grow", ...rows]),
      focus: () => log.push(["focus"]),
      type: (next) => { value = next; (handlers.change ?? []).forEach((fn) => fn(null, { notify() {} })); },
      handlers,
    };
  },
});

const open = async (p) => {
  const log = [], timers = [];
  const { PromptEditor } = await load("kanso-prompt-editor/main.js", ["PromptEditor"], {
    ...gpuiHost(), Textarea: { new: () => chain("textarea") }, TextareaState: textarea(log), InputState: textarea(log),
    EditorState: textarea(log), Editor: { new: () => chain("editor") },
    props: () => p, theme: () => KIT_NIGHT,
    closeOverlay: (overlay) => log.push(["close", overlay]),
    run: (...args) => log.push(["run", ...args]),
  });
  const view = new PromptEditor();
  view.init(null, { focus_handle: () => ({}), timer: { after: (ms, fn) => timers.push([ms, fn]) } });
  return { view, log, timers };
};

const keyDown = (el, key) => {
  const stopped = [];
  nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "on_key_down"))
    .forEach(([, handler]) => handler({ key }, { stop_propagation: () => stopped.push(key) }));
  return stopped;
};

const TASK = { value: "Explain this pull request.", title: "task", hint: "The new tab starts its agent on this.", overlay: "overlay-1",
  command: { name: "tab.new", args: { name: "#42 Explain" }, key: "task" } };

test("The prompt of many lines is the dialog with one multiline kit field, its hint a note, Cancel before Save", async () => {
  const { view, log } = await open(TASK);
  const el = view.render();
  assert.equal(el.tag, "v_flex");
  assert.ok(nodes(el).some((kid) => kid.tag === "textarea"), "the kit field's multiline frame");
  assert.ok(!nodes(el).some((kid) => kid.tag === "editor"), "no hand-drawn code editor");
  assert.deepEqual(clone(log.find(([kind]) => kind === "state")), ["state", { value: "Explain this pull request." }]);
  assert.ok(log.some(([kind]) => kind === "grow"), "it grows with its lines, then scrolls");
  const words = texts(el);
  assert.ok(["Task", "task", "The new tab starts its agent on this.", "Cancel", "Save"].every((word) => words.includes(word)), words.join(" | "));
  assert.ok(words.indexOf("Cancel") < words.indexOf("Save"));
  assert.ok(nodes(el).some((kid) => kid.tag === "prompt-secondary") && nodes(el).some((kid) => kid.tag === "prompt-primary"), "Cancel and Save are kit buttons");
});

test("Save sends the typed lines, newlines kept; Cancel closes and sends nothing", async () => {
  const { view, log } = await open(TASK);
  const state = view.input.state;
  state.type("Explain this pull request.\nList the risks.\nDo not change code.");
  press(view.render(), "prompt-primary");
  assert.deepEqual(clone(log.slice(-2)), [
    ["close", "overlay-1"],
    ["run", "tab.new", { name: "#42 Explain", task: "Explain this pull request.\nList the risks.\nDo not change code." }],
  ]);
  const again = await open(TASK);
  press(again.view.render(), "prompt-secondary");
  assert.deepEqual(clone(again.log.filter(([kind]) => kind === "close" || kind === "run")), [["close", "overlay-1"]]);
});

test("Keys: the field has the keyboard as it opens; Escape closes and stops there; Enter is the field's own new line, never a submit", async () => {
  const { view, log, timers } = await open(TASK);
  assert.ok(log.some(([kind]) => kind === "focus"), "the field takes the keyboard as the dialog opens");
  timers.forEach(([, fn]) => fn());
  assert.ok(log.filter(([kind]) => kind === "focus").length >= 2, "and again once the overlay has the window's keyboard");
  const el = view.render();
  assert.deepEqual(keyDown(el, "enter"), [], "Enter is not taken by the dialog");
  assert.equal(log.filter(([kind]) => kind === "close" || kind === "run").length, 0, "Enter neither closes nor sends");
  assert.equal(view.input.state.handlers.submit, undefined, "no submit on the field: Enter writes a new line");
  assert.deepEqual(keyDown(el, "escape"), ["escape"]);
  assert.deepEqual(clone(log.filter(([kind]) => kind === "close" || kind === "run")), [["close", "overlay-1"]], "Escape closes without sending");
});

test("The one-line rename keeps its keys through the shared field: the name chosen whole, then the keyboard; Enter answers, Escape answers nothing", async () => {
  const log = [], timers = [], store = {};
  const p = { value: "web", title: "rename tab", overlay: "o2", shared: "kanso.ask", token: "t1" };
  const { Prompt } = await load("kanso-prompt/main.js", ["Prompt"], {
    ...gpuiHost(), InputState: { new: (options) => {
      const state = textarea(log).new(options);
      return { ...state, set_selected_range: (range) => log.push(["select", range]) };
    } },
    props: () => p, theme: () => KIT_NIGHT, closeOverlay: (overlay) => log.push(["close", overlay]),
    shared: (key) => store[key], setShared: (key, value) => { store[key] = value; },
  });
  const view = new Prompt();
  view.init(null, { focus_handle: () => ({}), timer: { after: (ms, fn) => timers.push([ms, fn]) } });
  assert.deepEqual(clone(log.filter(([kind]) => kind === "select" || kind === "focus")), [["select", { start: 0, end: 3 }], ["focus"]]);
  assert.equal(timers[0][0], 600);
  view.input.state.type("api");
  view.input.state.handlers.submit[0]();
  assert.deepEqual(store["kanso.ask"].t1.text, "api", "Enter answers with the typed name");
  assert.deepEqual(keyDown(view.render(), "escape"), ["escape"]);
  assert.equal(store["kanso.ask"].t1.text, null, "Escape answers nothing");
});
