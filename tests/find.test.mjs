// Find in a conversation: capitals and accents do not matter, newest match first, and a shell keeps the terminal's Find.
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, temporary, nativePlatform } from "./helpers.mjs";
import {
  fold, foldSpan, searchTurns, matchSpan, partsOf, placeOf, countLabel, enterMatch, retarget, extendIndex,
  readTurns, freshRead, applySlice, parseSlice, readSlice, whoOf, whenLabel,
  resolveFind, locateConversation, kindOf, sessionLive,
} from "../kanso/mods/kanso-panel/find.js";

const line = (row) => JSON.stringify(row);
const at = "2026-11-10T15:04:00.000Z";

test("Capitals and accents fold together, and Ñ folds to n", () => {
  assert.equal(fold("Código"), "codigo");
  assert.equal(fold("codigo"), fold("CÓDIGO"));
  assert.equal(fold("Ñ"), "n");
  assert.equal(fold("ñ"), "n");
  assert.equal(fold("n"), "n");
  const marked = "el código final";
  assert.equal(foldSpan(marked).text, fold(marked));
  const hit = searchTurns([{ text: marked }], "codigo")[0];
  const span = matchSpan(marked, hit);
  assert.equal(marked.slice(span.start, span.end), "código");
  const tilde = "ESPAÑA";
  const n = searchTurns([{ text: tilde }], "n")[0];
  assert.equal(tilde.slice(matchSpan(tilde, n).start, matchSpan(tilde, n).end), "Ñ");
  const composed = "co\u0301digo";
  assert.equal(foldSpan(composed).text, "codigo");
  const whole = composed.slice(matchSpan(composed, searchTurns([{ text: composed }], "codigo")[0]).start, matchSpan(composed, searchTurns([{ text: composed }], "codigo")[0]).end);
  assert.equal(whole, composed);
});

test("A phrase matches as typed, newest first, and Enter moves without skipping the newest", () => {
  const turns = [{ text: "alpha one" }, { text: "foo  bar" }, { text: "foo bar baz" }, { text: "ALPHA two" }];
  const hits = searchTurns(turns, "  alpha ");
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.turn), [3, 0], "newest first");
  assert.equal(placeOf(0, 12), "1 of 12");
  assert.equal(placeOf(2, 12), "3 of 12");
  assert.equal(countLabel("alpha", 2, 12), "3 of 12");
  assert.equal(countLabel("   ", 0, 0), "");
  assert.equal(countLabel("missing", 0, 0), "0");
  assert.equal(searchTurns([{ text: "foo bar" }], "foo bar").length, 1);
  assert.equal(searchTurns([{ text: "foo  bar" }], "foo bar").length, 0);
  assert.equal(searchTurns([{ text: "foobar" }], "foo bar").length, 0);
  assert.equal(searchTurns([{ text: "aaaa" }], "aa").map((h) => h.at).join(","), "2,0", "no overlap, later match first");
  assert.deepEqual(searchTurns([{ text: "x" }], ""), []);
  const box = { pending: "alpha", query: "", hits: [], at: 0 };
  const index = extendIndex([], turns, 0, true);
  const stayed = enterMatch(box, index, false);
  assert.equal(stayed.moved, "query");
  assert.equal(stayed.at, 0, "the first Enter stays on the newest");
  assert.equal(placeOf(stayed.at, stayed.hits.length), "1 of 2");
  const moved = enterMatch(stayed, index, false);
  assert.equal(moved.moved, "move");
  assert.equal(moved.hits[moved.at].turn, 0);
  const back = enterMatch(moved, index, true);
  assert.equal(back.moved, "move");
  assert.equal(back.hits[back.at].turn, 3, "Shift+Enter wraps to the newest");
  const kept = back.hits[back.at];
  const more = [...turns, { text: "alpha three" }];
  const grown = extendIndex(index, more, turns.length, false);
  const held = retarget(grown, back.query, kept);
  assert.equal(held.hits[held.at].turn, 3, "a new match does not take the one you are on");
  assert.equal(held.hits.length, 3);
});

test("The part around a match keeps the word itself and who said it", () => {
  const text = `${"word ".repeat(40)}código${" word".repeat(40)}`;
  const hit = searchTurns([{ text }], "codigo")[0];
  const parts = partsOf(text, hit, 30);
  assert.equal(parts.find((p) => p.mark).text, "código");
  assert.ok(parts[0].text.startsWith("\u2026") || parts.some((p) => p.text.includes("\u2026")) || parts[0].text === "\u2026");
  assert.equal(whoOf({ role: "user" }), "You");
  assert.equal(whoOf({ role: "assistant" }), "Agent");
  assert.equal(whoOf({ role: "tool", name: "git" }), "git");
  assert.match(whenLabel(Date.parse(at)), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(whenLabel(null), "");
});

test("Claude's transcript yields what was said and the tool's reply, not its thinking or a picture", () => {
  const turns = readTurns([
    line({ type: "ai-title", aiTitle: "no" }),
    line({ type: "user", isMeta: true, message: { content: "ignore this reminder" }, timestamp: at }),
    line({ type: "assistant", message: { content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "El código está" }, { type: "tool_use", id: "t1", name: "repo/bin/git" }] }, timestamp: at }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "clean" }, { type: "image", source: {} }] }] }, timestamp: at }),
    line({ type: "user", message: { content: "¿Dónde?" }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(turns.map((t) => [t.role, t.name ?? "", t.text]), [
    ["assistant", "", "El código está"],
    ["tool", "git", "clean"],
    ["user", "", "¿Dónde?"],
  ]);
  assert.equal(searchTurns(turns, "codigo").length, 1);
  assert.equal(searchTurns(turns, "secret").length, 0);
  assert.equal(searchTurns(turns, "ignore").length, 0);
});

test("A Codex conversation prefers the completed items and does not count the copy twice", () => {
  const modern = [
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "hello" }] } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "Reasoning", summary: "skip" } }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "Text", text: "ready" }] } }, timestamp: at }),
    line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ready" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", command: "/usr/bin/git status", aggregated_output: "clean" } }, timestamp: at }),
    line({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "clean again" }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "item_completed", item: { type: "ImageView", path: "/a.png" } }, timestamp: at }),
  ].join("\n");
  const turns = readTurns(modern);
  assert.deepEqual(turns.map((t) => [t.role, t.name ?? "", t.text]), [
    ["user", "", "hello"],
    ["assistant", "", "ready"],
    ["tool", "git", "clean"],
  ]);
  const older = line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] }, timestamp: at });
  const first = applySlice(freshRead(), parseSlice(`10 20\n${older}\n`));
  assert.equal(first.state.turns[0].text, "first");
  const done = line({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "only" }] } }, timestamp: at });
  const second = applySlice(first.state, parseSlice(`40 40\n${done}\n`));
  assert.deepEqual(second.state.turns.map((t) => t.text), ["only"], "a later completed item drops the copy read before it");
});

test("An older Codex file reads the message once, with the tool's name", () => {
  const event = readTurns([
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "dup" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "user_message", message: "real" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "nope" }] }, timestamp: at }),
    line({ type: "event_msg", payload: { type: "agent_message", message: "answer" }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(event.map((t) => t.text), ["real", "answer"]);
  const calls = readTurns([
    line({ type: "response_item", payload: { type: "function_call", call_id: "c1", name: "npm test" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "ok" }, timestamp: at }),
    line({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "hidden" }] }, timestamp: at }),
  ].join("\n"));
  assert.deepEqual(calls.map((t) => [t.role, t.name ?? "", t.text]), [["tool", "npm", "ok"]]);
  assert.equal(searchTurns(calls, "hidden").length, 0);
});

test("A slice keeps whole lines, skips a pasted picture, and a missing file is no conversation", async (t) => {
  const dir = await temporary(t);
  const file = join(dir, "c.jsonl");
  const big = "x".repeat(80);
  const rows = [line({ type: "user", message: { content: "one" } }), big, line({ type: "assistant", message: { content: "two" } })];
  await writeFile(file, `${rows.join("\n")}\n`);
  const all = await readSlice(exec, file, 0, 10000, 60, nativePlatform);
  assert.ok(all && all.end === all.size);
  assert.ok(!all.body.includes(big));
  assert.deepEqual(readTurns(all.body).map((t) => t.text), ["one", "two"]);
  const picture = join(dir, "picture.jsonl");
  await writeFile(picture, `${"y".repeat(100)}\n${line({ type: "user", message: { content: "after" } })}\n`);
  const skipped = await readSlice(exec, picture, 0, 80, 60, nativePlatform);
  assert.equal(readTurns(skipped.body).map((turn) => turn.text).join(""), "after");
  assert.equal(await readSlice(exec, join(dir, "missing.jsonl"), 0, undefined, undefined, nativePlatform), null);
  assert.equal(applySlice({ ...freshRead(), size: 50 }, { end: 10, size: 10, body: "" }).reset, true);
});

test("No conversation, a shell, or a remote terminal falls back to the terminal's Find", async () => {
  assert.equal(resolveFind(null).action, "terminal.search");
  assert.equal(resolveFind({ file: null }).action, "terminal.search");
  assert.equal(resolveFind({ file: "/tmp/a.jsonl", kind: "codex" }).action, "find");
  assert.equal(kindOf("node", "claude-code"), "claude");
  assert.equal(kindOf("/Applications/Codex.app/codex", ""), "codex");
  assert.equal(kindOf("zsh", ""), null);
  assert.equal(sessionLive({ pid: 7, sessionId: "s", startedAt: 1000 }, 7, 1000), true);
  assert.equal(sessionLive({ pid: 7, sessionId: "s", startedAt: 1000 }, 7, 1000 + 120001), false);
  assert.equal(sessionLive({ pid: 8, sessionId: "s", startedAt: 1000 }, 7, 1000), false);
  let asked = false;
  const remote = await locateConversation({ hc() { asked = true; } }, "mac/t1", "claude");
  assert.deepEqual(remote, { kind: null, file: null });
  assert.equal(asked, false);
  const shell = await locateConversation(host({ argv: ["zsh"] }), "t1", "");
  assert.equal(shell.file, null);
  assert.equal(shell.kind, null);
  const missing = await locateConversation(host({ argv: ["claude"], pid: 7 }), "t1", "");
  assert.equal(missing.file, null);
  const stale = await locateConversation(host({
    argv: ["claude"], pid: 7, etime: "02:00:00",
    session: { pid: 7, sessionId: "abc", cwd: "/repo", startedAt: Date.now() },
  }), "t1", "");
  assert.equal(stale.file, null);
  const live = await locateConversation(host({
    argv: ["node"], pid: 9, etime: "00:05", hint: "claude-code",
    session: { pid: 9, sessionId: "abc", cwd: "/repo", startedAt: Date.now() - 4000 },
  }), "t1", "claude-code");
  assert.equal(live.kind, "claude");
  assert.equal(live.file, "/home/me/.claude/projects/-repo/abc.jsonl");
  const codex = await locateConversation(host({ argv: ["codex"], pid: 4, rollout: "/home/me/.codex/sessions/rollout-1.jsonl" }), "t1", "");
  assert.deepEqual(codex, { kind: "codex", file: "/home/me/.codex/sessions/rollout-1.jsonl" });
  const none = await locateConversation(host({ argv: ["codex"], pid: 4, rollout: "" }), "t1", "");
  assert.equal(none.file, null);
});

function host({ argv = ["zsh"], pid = 1, etime = "00:01", session = null, rollout = null } = {}) {
  return {
    platform: { processes: {
      startTime: async () => Date.now() - etime.split(":").reduce((n, part) => n * 60 + Number(part), 0) * 1000,
      list: async () => ({ byParent: new Map() }),
      openFiles: async () => ({ state: "ok", values: rollout ? [{ path: rollout }] : [] }),
    } },
    home: () => "/home/me",
    hc: async () => ({ code: 0, stdout: JSON.stringify({ foreground: { pid, argv } }) }),
    readTextFile: async (path) => (session && path.endsWith(`/${pid}.json`) ? JSON.stringify(session) : null),
    exec: async (cmd, args) => {
      if (cmd === "ps") return { code: 0, stdout: `${etime}\n` };
      if (rollout) return { code: 0, stdout: `${rollout}\n` };
      return { code: 1, stdout: "" };
    },
  };
}
