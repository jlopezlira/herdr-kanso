// Timeline: one prompt per thing a person typed, and the panel that shows it.
import assert from "node:assert/strict";
import test from "node:test";
import { readTurns } from "../kanso/mods/kanso-panel/find.js";
import { applyTimeline, freshTimeline, readTimeline } from "../kanso/mods/kanso-panel/timeline-model.js";
import { span, typedText } from "../kanso/mods/kanso-spaces/pure.js";
import { context, drawingHost, load, texts, until } from "./helpers.mjs";

const at = "2026-11-10T15:04:00.000Z";
const line = (row) => JSON.stringify(row);
const later = "2026-11-10T15:04:04.000Z";

test("A typed message is one prompt, kept as typed, and a message that is not from a person is not", () => {
  const prompts = readTimeline([
    line({ type: "user", message: { content: "keep\nthe break" }, timestamp: at }),
    line({ type: "user", origin: { kind: "task_notification" }, message: { content: "not typed" }, timestamp: at }),
    line({ type: "user", origin: { kind: "human" }, message: { content: "second" }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(prompts.map((p) => p.text), ["keep\nthe break", "second"]);
});

test("A note queued while it worked joins While it worked, and one from a task notification does not", () => {
  const prompts = readTimeline([
    line({ type: "user", message: { content: "do this" }, timestamp: at }),
    line({ type: "attachment", attachment: { type: "queued_command", prompt: "and this", origin: { kind: "human" } }, timestamp: at }),
    line({ type: "attachment", attachment: { type: "queued_command", prompt: "from the task", origin: { kind: "task_notification" } }, timestamp: at }),
  ].join("\n"));
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].also.map((item) => item.text), ["and this"]);
});

test("A prompt given in parts keeps its text", () => {
  const prompts = readTimeline([
    line({ type: "user", origin: { kind: "human" }, message: { content: [{ type: "text", text: "first part" }, { type: "text", text: "second part" }] }, timestamp: at }),
  ].join("\n"));
  assert.equal(prompts[0].text, "first part\nsecond part");
});

test("The turn's duration closes the prompt, and an interrupted request closes it as stopped", () => {
  const done = readTimeline([
    line({ type: "user", message: { content: "go" }, timestamp: at }),
    line({ type: "system", subtype: "turn_duration", durationMs: 4000, timestamp: later }),
  ].join("\n"));
  assert.equal(done.length, 1);
  assert.equal(done[0].ms, 4000);
  assert.equal(done[0].stopped, false);
  assert.equal(done[0].end, Date.parse(later));
  const stopped = readTimeline([
    line({ type: "user", message: { content: "go" }, timestamp: at }),
    line({ type: "user", message: { content: "[Request interrupted by user]" }, timestamp: later }),
  ].join("\n"));
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].stopped, true);
  assert.equal(stopped[0].text, "go");
});

test("A failed edit is not a file changed, a successful one is, a shell command counts, and the last reply is the reply", () => {
  const prompts = readTimeline([
    line({ type: "user", message: { content: "edit it" }, timestamp: at }),
    line({ type: "assistant", message: { content: [
      { type: "tool_use", id: "bad", name: "Write", input: { file_path: "a.js" } },
      { type: "tool_use", id: "good", name: "Edit", input: { file_path: "b.js" } },
      { type: "tool_use", id: "sh", name: "Bash", input: { command: "ls" } },
    ] }, timestamp: at }),
    line({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "bad", is_error: true, content: "no" },
      { type: "tool_result", tool_use_id: "good", content: "ok" },
      { type: "tool_result", tool_use_id: "sh", content: "listed" },
    ] }, timestamp: at }),
    line({ type: "assistant", message: { content: "first reply" }, timestamp: at }),
    line({ type: "assistant", message: { content: "last reply" }, timestamp: at }),
  ].join("\n"));
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].files, ["b.js"]);
  assert.equal(prompts[0].commands, 1);
  assert.equal(prompts[0].reply, "last reply");
});

test("A Codex conversation counts each completed message, command and file change once, and a message while it worked joins While it worked", () => {
  const prompts = readTimeline([
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "ship the fix" }] } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "task_started" }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "also check the tests" }] } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", command: "npm test", status: "completed", aggregated_output: "ok" } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", status: "completed", changes: { "src/a.js": { type: "update" } } } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", status: "failed", changes: { "src/b.js": {} } } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "text", text: "shipped" }] } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "task_complete", duration_ms: 12500 }, timestamp: later }),
  ].join("\n"));
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].text, "ship the fix");
  assert.deepEqual(prompts[0].also.map((item) => item.text), ["also check the tests"]);
  assert.equal(prompts[0].commands, 1);
  assert.deepEqual(prompts[0].files, ["src/a.js"]);
  assert.equal(prompts[0].reply, "shipped");
  assert.equal(prompts[0].ms, 12500);
  assert.equal(prompts[0].stopped, false);
  const aborted = readTimeline([
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "go" }] } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "task_started" }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "turn_aborted" }, timestamp: later }),
  ].join("\n"));
  assert.equal(aborted[0].stopped, true);
  assert.equal(aborted[0].text, "go");
});

test("An older Codex file counts the message and a patch once", () => {
  const prompts = readTimeline([
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "copy" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "user_message", message: "real question" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "nope" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "agent_message", message: "the answer" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "custom_tool_call", call_id: "p1", name: "apply_patch", input: "*** Update File: src/app.js\n" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "p1", output: "Success. Updated the following files:\nM src/app.js" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "function_call", call_id: "f1", name: "apply_patch", input: "*** Add File: src/other.js\n" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "function_call_output", call_id: "f1", output: "ok" }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(prompts.map((p) => p.text), ["real question"]);
  assert.equal(prompts[0].reply, "the answer");
  assert.deepEqual(prompts[0].files, ["src/app.js", "src/other.js"]);
});

test("A conversation file that shrank is read from the start again", () => {
  const grown = applyTimeline(freshTimeline(), { end: 30, size: 30, body: line({ type: "user", message: { content: "old" }, timestamp: at }) + "\n" });
  assert.equal(grown.state.prompts[0].text, "old");
  const shrunk = applyTimeline(grown.state, { end: 4, size: 4, body: "" });
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.reset, true);
  assert.deepEqual(shrunk.state.prompts, []);
  assert.equal(shrunk.state.size, 0);
});

test("A broken record does not hide the prompts after it", () => {
  const prompts = readTimeline([
    line({ type: "user", message: { content: "before" }, timestamp: at }),
    "{not json",
    line({ type: "user", message: { content: "after" }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(prompts.map((p) => p.text), ["before", "after"]);
});

test("A write with nothing to read adds no turn to Find", () => {
  const turns = readTurns([
    line({ type: "user", message: { content: "write it" }, timestamp: at }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "Write", input: { file_path: "a.js" } }] }, timestamp: at }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w" }] }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(turns.map((turn) => turn.text), ["write it"]);
});

test("Typed text is the words a person sent, and a duration reads in hours, minutes and seconds", () => {
  assert.equal(typedText("  keep   the words  "), "keep the words");
  assert.equal(typedText(""), null);
  assert.equal(typedText("Caveat: the model wrote this"), null);
  assert.equal(typedText("[Request interrupted by user]"), null);
  assert.equal(span(0), "0s");
  assert.equal(span(90000), "1m 30s");
  assert.equal(span(3660000), "1h 1m");
});

test("The name shown for an agent is the one set on it, or its program", async () => {
  const named = await load("kanso-spaces/marks.js", ["shownName"], {
    ...drawingHost(),
    terminals: () => [{ address: "t1", labels: { "kanso.shown": "web agent", "kanso.name": "other" } }],
  });
  assert.equal(named.shownName("t1", { terminal: "t1", program: { agent: true, name: "Claude Code" } }), "web agent");
  const program = await load("kanso-spaces/marks.js", ["shownName"], {
    ...drawingHost(),
    terminals: () => [{ address: "t1", labels: {} }],
  });
  assert.equal(program.shownName("t1", { terminal: "t1", program: { agent: true, name: "Claude Code" } }), "Claude Code");
});

const promptLine = (text) => line({ type: "user", timestamp: at, origin: { kind: "human" }, message: { content: text } });
const sliceOut = (body, end = 40, size = 40) => ({ code: 0, stdout: String(end) + " " + String(size) + "\n" + body + "\n", stderr: "" });

function agent(fields) {
  return { status: "idle", seq: 1, agent: fields.key === "claude" || fields.key === "codex", ...fields };
}

async function openTimeline(world) {
  const pending = [];
  const store = {};
  const host = {
    ...drawingHost(),
    home: () => "/home/me",
    theme: () => ({}),
    run() {},
    window: () => ({ platform: world.platform, active: world.active }),
    focused: () => ({ terminal: world.focus, tab: "tab" }),
    spaces: () => [{ active: true, tabs: [{ id: "tab", active: true }] }],
    shared: (key) => store[key] ?? null,
    setShared: (key, value) => { store[key] = value; },
    agents: () => world.agents.map((item) => ({
      address: item.address, status: item.status, seq: item.seq, app: item.app, tab: "tab", focused: item.address === world.focus,
      program: { key: item.key, name: item.name, agent: item.agent },
    })),
    terminals: () => world.agents.map((item) => ({ address: item.address, cwd: "/repo", labels: { "kanso.shown": item.name } })),
    panes: () => world.agents.map((item) => ({ terminal: item.address, program: { name: item.name, key: item.key, agent: item.agent } })),
    hc: async (args) => {
      if (args[0] !== "get") return { code: 0, stdout: "" };
      const item = world.agents.find((one) => one.address === args[1]);
      return { code: 0, stdout: JSON.stringify({ foreground: item ? { pid: item.pid, argv: [item.argv] } : null }) };
    },
    readTextFile: async (path) => {
      const pid = /(\d+)\.json$/.exec(path)?.[1];
      const item = world.agents.find((one) => String(one.pid) === pid);
      return item ? JSON.stringify({ pid: item.pid, sessionId: item.sessionId, cwd: "/repo", startedAt: Date.now() - 500 }) : null;
    },
    exec: async (cmd, args = []) => {
      if (cmd === "python3" || cmd === "python") return new Promise((resolve) => pending.push({ file: args[2], resolve }));
      if (cmd === "ps") return { code: 0, stdout: "00:01\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const { Timeline } = await load("kanso-panel/timeline.js", ["Timeline"], host);
  const { cx } = context();
  cx.timer = { after() { return { cancel() {} }; }, every() { return { cancel() {} }; } };
  const view = new Timeline(null);
  view.init(cx);
  return { view, cx, pending };
}

async function became(check, view) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(JSON.stringify({
    prompts: view.state.prompts.map((p) => p.text), located: view.located, failed: view.failed, reading: view.reading,
    follow: view.follow, where: view.where, size: view.state.size,
  }));
}

test("Switching agent while a read is still out does not leave the new agent empty", async () => {
  const world = {
    platform: "macos", active: true, focus: "a",
    agents: [
      agent({ address: "a", pid: 41, sessionId: "sess-a", key: "claude", name: "Claude Code", app: "Claude", argv: "claude" }),
      agent({ address: "b", pid: 42, sessionId: "sess-b", key: "claude", name: "Claude Code", app: "Claude", argv: "claude" }),
    ],
  };
  const { view, cx, pending } = await openTimeline(world);
  await became(() => pending.some((item) => item.file.includes("sess-a")), view);
  world.focus = "b";
  view.tick(cx);
  pending.find((item) => item.file.includes("sess-a")).resolve(sliceOut(promptLine("from A")));
  await became(() => pending.some((item) => item.file.includes("sess-b")), view);
  pending.find((item) => item.file.includes("sess-b")).resolve(sliceOut(promptLine("from B")));
  await became(() => view.state.prompts.some((p) => p.text === "from B"), view);
  const said = texts(view.render(cx));
  assert.ok(said.includes("from B"), said.join(" | "));
  assert.equal(said.includes("from A"), false);
  assert.equal(said.includes("Nothing asked in this conversation yet"), false);
});

test("A status change during a read queues one more read", async () => {
  const world = {
    platform: "macos", active: true, focus: "a",
    agents: [agent({ address: "a", pid: 41, sessionId: "sess-a", key: "claude", name: "Claude Code", app: "Claude", argv: "claude" })],
  };
  const { view, cx, pending } = await openTimeline(world);
  await became(() => pending.length === 1, view);
  world.agents[0].status = "working";
  world.agents[0].seq = 2;
  view.tick(cx);
  assert.equal(pending.length, 1, "the read already out is not started again");
  pending[0].resolve(sliceOut(promptLine("asked")));
  await became(() => pending.length === 2, view);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(pending.length, 2, "one more read, not a stream of them");
});

test("A missing conversation file says nothing was asked, not that the read failed", async () => {
  const world = {
    platform: "macos", active: true, focus: "a",
    agents: [agent({ address: "a", pid: 41, sessionId: "sess-a", key: "claude", name: "Claude Code", app: "Claude", argv: "claude" })],
  };
  const { view, cx, pending } = await openTimeline(world);
  await became(() => pending.length === 1, view);
  pending[0].resolve({ code: 2, stdout: "", stderr: "" });
  await became(() => view.located && view.reading == null, view);
  const said = texts(view.render(cx));
  assert.ok(said.includes("Nothing asked in this conversation yet"), said.join(" | "));
  assert.equal(said.includes("Can't read this conversation"), false);
});

test("A Codex conversation that cannot be found on this computer says so", async () => {
  const world = {
    platform: "windows", active: true, focus: "a",
    agents: [agent({ address: "a", pid: 41, sessionId: "sess-a", key: "codex", name: "Codex", app: "Codex", argv: "codex" })],
  };
  const { view, cx } = await openTimeline(world);
  await became(() => view.located, view);
  const said = texts(view.render(cx));
  assert.ok(said.includes("Can't find this conversation on this computer"), said.join(" | "));
  assert.ok(said.includes("Open files of other processes requires a Herdr API on Windows"), said.join(" | "));
  assert.equal(said.includes("Can't read this conversation"), false);
});

test("An agent that is not Claude Code or Codex says Timeline reads those conversations", async () => {
  const world = {
    platform: "macos", active: true, focus: "a",
    agents: [agent({ address: "a", pid: 41, sessionId: "sess-a", key: "zsh", name: "Terminal", app: "Terminal", argv: "zsh" })],
  };
  const { view, cx, pending } = await openTimeline(world);
  await until(() => view.located);
  const said = texts(view.render(cx));
  assert.ok(said.includes("Timeline reads Claude Code and Codex conversations"), said.join(" | "));
  assert.equal(pending.length, 0);
});

test("Once a conversation was read, nothing is read while the window is behind", async () => {
  const world = {
    platform: "macos", active: true, focus: "a",
    agents: [agent({ address: "a", pid: 41, sessionId: "sess-a", key: "claude", name: "Claude Code", app: "Claude", argv: "claude", status: "working" })],
  };
  const { view, cx, pending } = await openTimeline(world);
  await became(() => pending.length === 1, view);
  world.active = false;
  pending[0].resolve(sliceOut(promptLine("asked"), 10, 100));
  await became(() => view.state.size > 0, view);
  await new Promise((resolve) => setTimeout(resolve, 40));
  view.tick(cx);
  assert.equal(pending.length, 1);
  assert.ok(view.state.prompts.some((p) => p.text === "asked"));
});
