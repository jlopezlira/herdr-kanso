import assert from "node:assert/strict";
import test from "node:test";
import { context, load, singleUse, tape } from "./helpers.mjs";

const state = (value) => ({ value: () => value, on() {}, focus() {}, set_value(next) { value = next; } });

async function snippets(host = {}) {
  return load("kanso-snippets/main.js", ["KansoSnippets", "normalizeSnippets", "relativeHome", "absoluteHome", "requireWorkingDirectory", "promptAgentArgs", "currentDirectory"], {
    appHome: () => "/app",
    home: () => "/Users/test",
    exec: async (command) => command === "test" ? { code: 0 } : { code: 1 },
    InputState: { new: ({ value }) => state(value) },
    EditorState: { new: ({ value }) => state(value) },
    ...host,
  });
}

test("snippet normalization keeps valid entries and supplies unique ids", async () => {
  const { normalizeSnippets } = await snippets();
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeSnippets([
    { name: "Review", kind: "prompt", body: "Review this." },
    { id: "terminal", name: "Status", kind: "terminal", body: "git status" },
    { id: "terminal", name: "Duplicate id", kind: "prompt", body: "Check it." },
    { name: "Bad type", kind: "unknown", body: "ignored" },
  ]))), [
    { id: "snippet-0", name: "Review", kind: "prompt", body: "Review this.", cwd: "", agent: null, place: "new" },
    { id: "terminal", name: "Status", kind: "terminal", body: "git status", cwd: "", agent: null, place: "current" },
    { id: "snippet-2", name: "Duplicate id", kind: "prompt", body: "Check it.", cwd: "", agent: null, place: "new" },
  ]);
  assert.equal(normalizeSnippets([{ name: "New tab prompt", kind: "prompt", body: "Check", place: "current", cwd: "~/repo" }])[0].place, "new");
  assert.equal(normalizeSnippets([{ name: "New tab prompt", kind: "prompt", body: "Check", place: "current", cwd: "~/repo" }])[0].cwd, "~/repo");
});

test("working-directory paths are shown relative to home and expanded on launch", async () => {
  const { relativeHome, absoluteHome } = await snippets();
  assert.equal(relativeHome("/Users/test/Projects/app"), "~/Projects/app");
  assert.equal(relativeHome("/tmp/app"), "/tmp/app");
  assert.equal(absoluteHome("~/Projects/app"), "/Users/test/Projects/app");
  assert.equal(absoluteHome("~"), "/Users/test");
});

test("working-directory validation gives a clear error for a missing folder", async () => {
  const { requireWorkingDirectory } = await snippets();
  let call;
  await assert.rejects(
    requireWorkingDirectory("/Users/test/missing", "macos", async (command, args) => {
      call = [command, args];
      return { code: 1 };
    }),
    /Working directory does not exist or is not a directory: \/Users\/test\/missing/,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(call)), ["test", ["-d", "/Users/test/missing"]]);
});

test("working-directory validation checks folders safely on Windows", async () => {
  const { requireWorkingDirectory } = await snippets();
  let call;
  await requireWorkingDirectory("C:\\Projects\\app", "windows", async (command, args) => {
    call = [command, args];
    return { code: 0 };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(call)), ["powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    "if (Test-Path -LiteralPath $args[0] -PathType Container) { exit 0 } else { exit 1 }",
    "C:\\Projects\\app",
  ]]);
});

test("Copilot prompt launches use prompt mode rather than interactive mode", async () => {
  const { promptAgentArgs } = await snippets();
  assert.deepEqual(JSON.parse(JSON.stringify(promptAgentArgs(["copilot", "-i"]))), ["copilot", "-p"]);
  assert.deepEqual(JSON.parse(JSON.stringify(promptAgentArgs(["copilot.exe", "--interactive"]))), ["copilot.exe", "--prompt"]);
  assert.deepEqual(JSON.parse(JSON.stringify(promptAgentArgs(["copilot"]))), ["copilot", "-p"]);
  assert.deepEqual(JSON.parse(JSON.stringify(promptAgentArgs(["claude", "--continue"]))), ["claude", "--continue"]);
});

test("empty working directory resolves to the focused terminal process cwd", async () => {
  const { currentDirectory } = await snippets();
  const result = await currentDirectory({
    focus: { terminal: "term-1" },
    allTerminals: [{ address: "term-1", cwd: "/old/terminal/cwd" }],
    allPanes: [],
    allSpaces: [{ active: true, folder: "/space/folder" }],
    getTerminal: async () => ({ code: 0, stdout: JSON.stringify({ foreground: { cwd: "/current/shell/cwd" } }) }),
  });
  assert.equal(result, "/current/shell/cwd");
});

test("empty working directory falls back to terminal, pane, then active space folder", async () => {
  const { currentDirectory } = await snippets();
  const getTerminal = async () => ({ code: 1 });
  assert.equal(await currentDirectory({
    focus: { terminal: "term-1" }, allTerminals: [{ address: "term-1", cwd: "/terminal/cwd" }],
    allPanes: [{ terminal: "term-1", cwd: "/pane/cwd" }], allSpaces: [{ active: true, folder: "/space" }], getTerminal,
  }), "/terminal/cwd");
  assert.equal(await currentDirectory({
    focus: { terminal: "term-1" }, allTerminals: [], allPanes: [{ terminal: "term-1", cwd: "/pane/cwd" }],
    allSpaces: [{ active: true, folder: "/space" }], getTerminal,
  }), "/pane/cwd");
  assert.equal(await currentDirectory({
    focus: { terminal: "term-1" }, allTerminals: [], allPanes: [], allSpaces: [{ active: true, folder: "/space" }], getTerminal,
  }), "/space");
});

test("snippets load and save persistently as a JSON list", async () => {
  const calls = [];
  const notifications = [];
  let written;
  const { KansoSnippets } = await snippets({
    View: class {},
    appHome: () => "/app",
    notify: (message) => notifications.push(message),
    readTextFile: async (path) => { calls.push(["read", path]); return null; },
    exec: async (...args) => { calls.push(["exec", ...args]); return { code: 0, stdout: "none" }; },
    writeTextFile: async (...args) => { calls.push(["write", ...args]); written = args[1]; },
  });
  const { cx, drain } = context();
  const view = new KansoSnippets();
  view.init(null, { ...cx, focus_handle: () => ({}) });
  await drain();
  assert.equal(view.loading, false);
  assert.equal(view.error, null);

  view.edit({ kind: "prompt" }, cx);
  view.name = state("Daily review");
  view.body = state("Check tests.\nSummarize failures.");
  view.cwd = state("/Users/test/work/project");
  view.agent = "claude";
  await view.save(cx);
  assert.equal(view.error, null);
  assert.equal(view.editor, null, "successful save exits the editor");
  assert.deepEqual(JSON.parse(JSON.stringify(notifications)), [
    { title: "Snippet saved", body: "Daily review", level: "success" },
  ]);
  assert.deepEqual(JSON.parse(written), [{
    id: view.snippets[0].id,
    name: "Daily review",
    kind: "prompt",
    body: "Check tests.\nSummarize failures.",
    cwd: "~/work/project",
    agent: "claude",
    place: "new",
  }]);
  assert.ok(calls.some((call) => JSON.stringify(call).includes("/app/data/kanso-snippets/snippets.json")));
});

test("deleting a snippet refreshes the list immediately and persists it", async () => {
  let releaseWrite;
  let written;
  const { KansoSnippets } = await snippets({
    View: class {},
    writeTextFile: async (_path, disk) => {
      await new Promise((resolve) => { releaseWrite = resolve; });
      written = disk;
    },
  });
  let notifications = 0;
  const cx = { notify() { notifications++; } };
  const view = new KansoSnippets();
  const snippet = { id: "remove-me", name: "Old snippet", kind: "prompt", body: "Review" };
  view.snippets = [snippet, { ...snippet, id: "keep", name: "Keep" }];
  const deleting = view.remove(snippet, cx);
  assert.deepEqual(JSON.parse(JSON.stringify(view.snippets)), [{ ...snippet, id: "keep", name: "Keep" }]);
  assert.equal(notifications, 1, "the view redraws immediately");
  releaseWrite();
  await deleting;
  assert.deepEqual(JSON.parse(written), [{ ...snippet, id: "keep", name: "Keep" }]);
  assert.equal(view.saving, false);
  assert.equal(view.error, null);
});

test("failed snippet deletion restores the item and reports the error", async () => {
  const { KansoSnippets } = await snippets({
    View: class {},
    writeTextFile: async () => { throw new Error("disk full"); },
  });
  const { cx } = context();
  const view = new KansoSnippets();
  const snippet = { id: "restore-me", name: "Keep me", kind: "terminal", body: "npm test" };
  view.snippets = [snippet];
  await view.remove(snippet, cx);
  assert.deepEqual(JSON.parse(JSON.stringify(view.snippets)), [snippet]);
  assert.equal(view.error, "Could not delete snippet: disk full");
  assert.equal(view.saving, false);
});

test("the snippets list and editor render with the saved entry", async () => {
  const ui = singleUse();
  const { KansoSnippets } = await snippets({
    View: class {},
    ...ui,
    Editor: { new: () => ui.div() },
    theme: () => ({ popover: "", foreground: "", dim: "", solid: "", input: "", solid_foreground: "", raised: "", background: "", border: "", blocked: "" }),
    props: () => ({ overlay: "snippets-overlay" }),
  });
  const view = new KansoSnippets();
  view.loading = false;
  view.snippets = [{ id: "s1", name: "Review", kind: "prompt", body: "Review this." }];
  view.render();
  view.edit(null, context().cx);
  view.render();
});

test("a new snippet defaults to a terminal command", async () => {
  const { KansoSnippets } = await snippets({ View: class {} });
  const view = new KansoSnippets();
  view.edit(null, context().cx);
  assert.equal(view.editor.kind, "terminal");
});

test("the prompt editor lists only installed agents", async () => {
  const agents = [
    { key: "claude", name: "Claude Code", installed: true, run: ["claude"] },
    { key: "codex", name: "Codex", installed: false, run: ["codex"] },
  ];
  const { KansoSnippets } = await snippets({
    View: class {},
    knownAgents: async () => agents,
    exec: async () => ({ code: 0, stdout: "none" }),
    readTextFile: async () => null,
  });
  const { cx, drain } = context();
  const view = new KansoSnippets();
  view.init(null, { ...cx, focus_handle: () => ({}) });
  await drain();
  assert.deepEqual(JSON.parse(JSON.stringify(view.agents)), [agents[0]]);
});

test("the prompt editor lets the user select a listed installed agent", async () => {
  const agents = [
    { key: "claude", name: "Claude Code", installed: true, run: ["claude"] },
    { key: "codex", name: "Codex", installed: false, run: ["codex"] },
  ];
  const ui = tape();
  const { KansoSnippets } = await snippets({
    View: class {},
    ...ui.host,
    Input: { new: () => ui.host.div() },
    Editor: { new: () => ui.host.div() },
    theme: () => ({ popover: "", foreground: "", dim: "", solid: "selected", input: "", solid_foreground: "", raised: "", background: "", border: "", blocked: "" }),
    props: () => ({}),
    knownAgents: async () => agents,
    exec: async () => ({ code: 0, stdout: "none" }),
    readTextFile: async () => null,
  });
  const { cx, drain } = context();
  const view = new KansoSnippets();
  view.init(null, { ...cx, focus_handle: () => ({}) });
  await drain();
  view.edit({ kind: "prompt", place: "current" }, cx);
  view.render();
  assert.ok(ui.texts.some((text) => text.includes("always open in a new tab")));
  assert.equal(view.place, "new");
  assert.equal(ui.handlers.has("snippet-place-current"), false);
  assert.equal(ui.handlers.has("snippet-place-new"), false);
  assert.equal(typeof ui.handlers.get("snippet-agent-claude"), "function");
  assert.equal(ui.handlers.has("snippet-agent-codex"), false);
  ui.handlers.get("snippet-agent-claude")({}, cx);
  assert.equal(view.agent, "claude");
  ui.handlers.get("snippet-kind-terminal")({}, cx);
  view.render();
  assert.ok(ui.texts.lastIndexOf("Type") < ui.texts.lastIndexOf("Run in"));
  assert.equal(ui.handlers.has("snippet-place-current"), true);
  assert.equal(ui.handlers.has("snippet-place-new"), true);
  view.render();
});

test("copy puts the snippet text on the clipboard", async () => {
  const notifications = [];
  const { KansoSnippets } = await snippets({ View: class {}, notify: (message) => notifications.push(message) });
  const view = new KansoSnippets();
  const copied = [];
  const { cx } = context();
  cx.write_to_clipboard = async (text) => copied.push(text);
  await view.copy({ id: "cmd-1", name: "Run tests", kind: "terminal", body: "npm test" }, cx);
  assert.deepEqual(copied, ["npm test"]);
  assert.equal(view.error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(notifications)), [
    { title: "Copied terminal", level: "success" },
  ]);
});

test("copy reports clipboard failures", async () => {
  const notifications = [];
  const { KansoSnippets } = await snippets({ View: class {}, notify: (message) => notifications.push(message) });
  const view = new KansoSnippets();
  const { cx } = context();
  cx.write_to_clipboard = async () => { throw new Error("permission denied"); };
  await view.copy({ id: "cmd-1", body: "npm test" }, cx);
  assert.equal(view.error, "Could not copy snippet: permission denied");
  assert.deepEqual(notifications, []);
});

test("prompt snippets start the selected agent in a new tab without checking installation", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    props: () => ({ overlay: "snippets-overlay" }),
    knownAgents: async () => [{ key: "claude", installed: false, run: ["claude"] }],
    spaces: () => [{ id: "space-1", active: true }],
    run: (...args) => calls.push(["run", ...args]),
    closeOverlay: (...args) => calls.push(["close", ...args]),
  });
  const view = new KansoSnippets();
  await view.run({ id: "s1", name: "Review", kind: "prompt", body: "Explain the failing test.", cwd: "~/repo", agent: "claude" }, context().cx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["run", "tab.new", { name: "Review", space: "space-1", folder: "/Users/test/repo", argv: ["claude"], task: "Explain the failing test." }],
    ["close", "snippets-overlay"],
  ]);
});

test("prompt snippets without a saved directory inherit the focused terminal cwd", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    knownAgents: async () => [{ key: "claude", installed: true, run: ["claude"] }],
    focused: () => ({ terminal: "term-1" }),
    terminals: () => [{ address: "term-1" }],
    panes: () => [],
    spaces: () => [{ id: "space-1", active: true }],
    hc: async () => ({ code: 0, stdout: JSON.stringify({ foreground: { cwd: "/current/project" } }) }),
    run: (...args) => calls.push(["run", ...args]),
    closeOverlay: (...args) => calls.push(["close", ...args]),
  });
  await new KansoSnippets().run({ name: "Review", kind: "prompt", body: "Review", agent: "claude" }, context().cx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "run", "tab.new", { name: "Review", space: "space-1", folder: "/current/project", argv: ["claude"], task: "Review" },
  ]);
});

test("prompt snippets report a missing working directory without opening a tab", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    knownAgents: async () => [{ key: "claude", run: ["claude"] }],
    spaces: () => [{ id: "space-1", active: true }],
    exec: async () => ({ code: 1 }),
    run: (...args) => calls.push(args),
  });
  const view = new KansoSnippets();
  await view.run({ name: "Review", kind: "prompt", body: "Review", cwd: "~/missing", agent: "claude" }, context().cx);
  assert.equal(view.error, "Could not start agent: Working directory does not exist or is not a directory: /Users/test/missing");
  assert.deepEqual(calls, []);
});

test("prompt snippets launched from the panel start an agent without closing the panel", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    props: () => ({ panel: true }),
    knownAgents: async () => [{ key: "codex", installed: true, run: ["codex"] }],
    spaces: () => [],
    focused: () => null,
    terminals: () => [],
    panes: () => [],
    hc: async () => ({ code: 1 }),
    run: (...args) => calls.push(["run", ...args]),
    closeOverlay: (...args) => calls.push(["close", ...args]),
  });
  const view = new KansoSnippets();
  await view.run({ name: "Review", kind: "prompt", body: "Review this.", agent: "codex" }, context().cx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["run", "tab.new", { name: "Review", argv: ["codex"], task: "Review this." }],
  ], view.error);
});

test("Copilot snippets pass prompt mode to the new tab launch", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    knownAgents: async () => [{ key: "copilot", installed: true, run: ["copilot", "-i"] }],
    spaces: () => [],
    focused: () => null,
    terminals: () => [],
    panes: () => [],
    hc: async () => ({ code: 1 }),
    run: (...args) => calls.push(args),
  });
  const view = new KansoSnippets();
  await view.run({ name: "Review", kind: "prompt", body: "test claude", agent: "copilot" }, context().cx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["tab.new", { name: "Review", argv: ["copilot", "-p"], task: "test claude" }],
  ]);
});

test("terminal snippets in the current tab run in that tab without a working-directory override", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    props: () => ({ overlay: "snippets-overlay" }),
    focused: () => ({ terminal: "terminal-1" }),
    terminals: () => [{ address: "terminal-1", program: { shell: "zsh" } }],
    panes: () => [],
    spaces: () => [],
    hc: async (...args) => { calls.push(["send", ...args]); return { code: 0 }; },
    closeOverlay: (...args) => calls.push(["close", ...args]),
  });
  const view = new KansoSnippets();
  const { cx, drain } = context();
  view.run({ kind: "terminal", body: "git status", cwd: "~/repo", place: "current" }, cx);
  await drain();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["send", ["send", "terminal-1", "git status"]],
    ["close", "snippets-overlay"],
  ]);
});

test("terminal snippets can open a folder in a new tab and run the command there", async () => {
  const calls = [];
  let tabs = [], terminalPanes = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    props: () => ({ panel: true }),
    spaces: () => [{ id: "space-1", active: true, tabs }],
    panes: () => terminalPanes,
    run: (command, args) => {
      calls.push(["run", command, args]);
      if (command === "tab.new") {
        tabs = [{ id: "tab-new", name: args.name }];
        terminalPanes = [{ tab: "tab-new", terminal: "terminal-new" }];
      }
    },
    hc: async (args) => { calls.push(["hc", args]); return { code: 0 }; },
  });
  const view = new KansoSnippets();
  const { cx, drain } = context();
  cx.sleep = async () => {};
  view.run({ name: "Tests", kind: "terminal", body: "npm test", cwd: "~/repo", place: "new" }, cx);
  await drain();
  const runs = calls.filter((call) => call[0] === "run");
  assert.equal(runs[0][1], "tab.new");
  assert.deepEqual(JSON.parse(JSON.stringify(runs[0][2])), { name: runs[0][2].name, space: "space-1", folder: "/Users/test/repo" });
  assert.equal(runs[1][1], "tab.rename");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["hc", ["send", "terminal-new", "npm test"]]);
});

test("terminal snippets report a missing working directory without opening a tab", async () => {
  const calls = [];
  const { KansoSnippets } = await snippets({
    props: () => ({ panel: true }),
    spaces: () => [{ id: "space-1", active: true, tabs: [] }],
    exec: async () => ({ code: 1 }),
    run: (...args) => calls.push(["run", ...args]),
  });
  const view = new KansoSnippets();
  const { cx, drain } = context();
  view.run({ name: "Tests", kind: "terminal", body: "npm test", cwd: "~/missing", place: "new" }, cx);
  await drain();
  assert.equal(view.error, "Could not run snippet: Working directory does not exist or is not a directory: /Users/test/missing");
  assert.deepEqual(calls, []);
});

test("terminal snippets without a saved directory inherit focused terminal cwd", async () => {
  const calls = [];
  let tabs = [], terminalPanes = [];
  const { KansoSnippets } = await snippets({
    View: class {},
    props: () => ({ panel: true }),
    focused: () => ({ terminal: "term-old" }),
    terminals: () => [{ address: "term-old" }],
    spaces: () => [{ id: "space-1", active: true, tabs }],
    panes: () => terminalPanes,
    run: (command, args) => {
      calls.push(["run", command, args]);
      if (command === "tab.new") {
        tabs = [{ id: "tab-new", name: args.name }];
        terminalPanes = [{ tab: "tab-new", terminal: "term-new" }];
      }
    },
    hc: async (args) => {
      calls.push(["hc", args]);
      return args[0] === "get"
        ? { code: 0, stdout: JSON.stringify({ foreground: { cwd: "/current/project" } }) }
        : { code: 0 };
    },
  });
  const { cx, drain } = context();
  cx.sleep = async () => {};
  new KansoSnippets().run({ name: "Tests", kind: "terminal", body: "npm test", place: "new" }, cx);
  await drain();
  const tab = calls.find((call) => call[0] === "run" && call[1] === "tab.new");
  assert.deepEqual(JSON.parse(JSON.stringify(tab[2])), { name: tab[2].name, space: "space-1", folder: "/current/project" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["hc", ["send", "term-new", "npm test"]]);
});
