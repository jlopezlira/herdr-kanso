import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers.mjs";

function element() {
  let node;
  node = new Proxy({}, {
    get(_target, prop) {
      if (prop === "when") return (condition, build) => condition ? build(node) : node;
      if (prop === "child" || prop === "children") return () => node;
      return () => node;
    },
  });
  return node;
}

test("prompt editor uses a multiline plain-text Editor and submits edited newlines", async () => {
  const calls = [];
  let changed;
  const editorState = {
    value: () => "Explain this pull request.",
    on(event, handler) {
      if (event === "change") changed = handler;
    },
  };
  const p = {
    value: "Explain this pull request.",
    overlay: "overlay-1",
    command: { name: "tab.new", args: { name: "#42 Explain" }, key: "task" },
  };
  const { PromptEditor } = await load("kanso-prompt-editor/main.js", ["PromptEditor"], {
    props: () => p,
    EditorState: { new: (options) => { calls.push(["state", options]); return editorState; } },
    Editor: { new: (state) => { calls.push(["editor", state]); return element(); } },
    div: element,
    v_flex: element,
    h_flex: element,
    svg: element,
    Button: { new: element },
    theme: () => ({ dim: "", solid: "", input: "", solid_foreground: "", foreground: "", raised: "", background: "", popover: "", accent: "" }),
    closeOverlay: (overlay) => calls.push(["close", overlay]),
    run: (...args) => calls.push(["run", ...args]),
  });
  const prompt = new PromptEditor();
  prompt.init(null, { focus_handle: () => ({}) });
  prompt.render();

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["state", {
    value: "Explain this pull request.",
    language: "plain",
    soft_wrap: true,
    line_numbers: false,
    folding: false,
  }]);
  assert.ok(calls.some(([type, state]) => type === "editor" && state === editorState));

  editorState.value = () => "Explain this pull request.\nList the risks.\nDo not change code.";
  changed(null, { notify() {} });
  prompt.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(-2))), [
    ["close", "overlay-1"],
    ["run", "tab.new", { name: "#42 Explain", task: "Explain this pull request.\nList the risks.\nDo not change code." }],
  ]);
});
