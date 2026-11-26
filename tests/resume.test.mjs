import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, exec, load, temporary } from "./helpers.mjs";
import { resumeOf } from "../kanso/mods/kanso-sleep/resume.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("A listed conversation keeps Claude, Codex and Pi, decodes a Windows folder, and drops a line with no folder or id", async () => {
  const { listedOf } = await load("kanso-spaces/resume-list.js", ["listedOf"]);
  const lines = [
    "/home/me/.claude/projects/-work-repo/abc.jsonl\t/work/repo\t",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t/work/repo\t" + ID,
    "/home/me/.pi/agent/sessions/main/pi.jsonl\t/work/repo\tpi-1",
    "C:\\Users\\me\\.claude\\projects\\x\\abc.jsonl\tC:\\\\work\\\\repo\tabc",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t\tok",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t/work/repo\t",
    "/tmp/notes.jsonl\t/work/repo\tok",
  ].join("\n");
  const listed = listedOf(lines);
  assert.deepEqual(clone(listed.map((row) => row.program)), ["claude", "codex", "pi", "claude"]);
  assert.equal(listed[0].id, "abc");
  assert.equal(listed[1].id, ID);
  assert.equal(listed[3].cwd, "C:\\work\\repo");
});

test("A search matches the title, the folder or the computer, and an open space is the one already on that folder", async () => {
  const { findsIn, openSpaceAt } = await load("kanso-spaces/resume-list.js", ["findsIn", "openSpaceAt"]);
  const rows = [{ title: "The plan", cwd: "/work/Alpha", machine: "devbox" }];
  assert.equal(rows.filter(findsIn("")).length, 1);
  assert.equal(rows.filter(findsIn(" PLAN ")).length, 1);
  assert.equal(rows.filter(findsIn("alpha")).length, 1);
  assert.equal(rows.filter(findsIn("Dev")).length, 1);
  assert.equal(rows.filter(findsIn("missing")).length, 0);
  const spaces = [{ id: "sp", folder: "/work/alpha/", machine: "devbox" }, { id: "other", folder: "/work/alpha", machine: "lab" }];
  assert.equal(openSpaceAt(spaces, "/work/alpha", "devbox")?.id, "sp");
  assert.equal(openSpaceAt(spaces, "/work/alpha", ""), null);
});

test("Sleep resumes Claude, Codex and Pi, and leaves an unknown program", () => {
  assert.deepEqual(resumeOf("claude", ["claude", "--model", "opus"], { id: ID }), ["claude", "--model", "opus", "--resume", ID]);
  assert.deepEqual(resumeOf("codex", ["codex"], { id: ID }), ["codex", "resume", ID]);
  assert.equal(resumeOf("codex", ["codex"], { id: "nope" }), null);
  assert.deepEqual(resumeOf("pi", ["pi"], { file: "/tmp/s.jsonl" }), ["pi", "--session", "/tmp/s.jsonl"]);
  assert.equal(resumeOf("pi", ["pi"], {}), null);
  assert.equal(resumeOf("vim", ["vim"], { id: ID, file: "/tmp/s.jsonl" }), null);
});

test("The focused agent leads the recent list, a dead one drops, fifty is the most, and an unchanged list is not written", async () => {
  const live = ["focus", "old", ...Array.from({ length: 55 }, (_, i) => "a" + i)];
  const state = {};
  const writes = [];
  let focused = "focus";
  const { recentWith, noteFocus, RECENT } = await load("kanso-menu/recent.js", ["recentWith", "noteFocus", "RECENT"], {
    focused: () => ({ agent: focused }),
    agents: () => live.map((address) => ({ address })),
    shared: (key) => state[key] ?? null,
    setShared: (key, value) => { writes.push(key); state[key] = value; },
  });
  const next = recentWith(["dead", "old", "focus", ...live.slice(2), "extra"], "focus", new Set(live));
  assert.equal(next[0], "focus");
  assert.equal(next.includes("dead"), false);
  assert.equal(next.includes("extra"), false);
  assert.equal(next.length, 50);
  state[RECENT] = ["dead", "old", "focus"];
  noteFocus();
  assert.equal(state[RECENT][0], "focus");
  assert.equal(state[RECENT].includes("dead"), false);
  const written = writes.length;
  noteFocus();
  assert.equal(writes.length, written, "an unchanged list is not written");
  focused = "gone";
  noteFocus();
  assert.equal(writes.length, written, "an agent that is not running is not written");
});

test("The switcher lists the recent ones first, then the rest in agent order, and a sleeping one last with the Claude icon", async () => {
  const { switchOrder } = await load("kanso-menu/switcher.js", ["switchOrder"]);
  const live = [
    { address: "c", program: { key: "codex", icon: "icons/codex.svg" } },
    { address: "a", program: { key: "claude", icon: "icons/claude.svg" } },
    { address: "b", program: { key: "pi", icon: "icons/pi.svg" } },
  ];
  const order = switchOrder(["b", "missing", "a"], live, [{ address: "z" }]);
  assert.deepEqual(clone(order.map((row) => row.address)), ["b", "a", "c", "z"]);
  assert.equal(order.at(-1).asleep, true);
  assert.deepEqual(clone(order.at(-1).program), { key: "claude", icon: "icons/claude.svg" });
});

const stamp = async (file, body, ms) => { await writeFile(file, body); await utimes(file, ms / 1000, ms / 1000); };

test("A folder's conversations are the newest of that folder, only as many as asked, and a modern Codex line still has its first prompt", async (t) => {
  const home = await temporary(t);
  const alpha = join(home, ".claude", "projects", "-work-alpha");
  const beta = join(home, ".claude", "projects", "-work-beta");
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "10");
  const piDir = join(home, ".pi", "agent", "sessions", "main");
  await mkdir(alpha, { recursive: true });
  await mkdir(beta, { recursive: true });
  await mkdir(codexDir, { recursive: true });
  await mkdir(piDir, { recursive: true });
  const claude = (cwd, title) => [JSON.stringify({ type: "user", message: { content: "plan the release" }, cwd, timestamp: "2026-11-10T10:00:00.000Z" }), JSON.stringify({ type: "ai-title", aiTitle: title })].join("\n") + "\n";
  const newer = join(alpha, "new.jsonl");
  const older = join(alpha, "old.jsonl");
  const other = join(beta, "beta.jsonl");
  await stamp(newer, claude("/work/alpha", "The new plan"), 4000);
  await stamp(older, claude("/work/alpha", "The old plan"), 2000);
  await stamp(other, claude("/work/beta", "The other plan"), 3000);
  const codex = join(codexDir, "rollout-2026-11-10T12-00-00-" + ID + ".jsonl");
  const first = JSON.stringify({ type: "session_meta", payload: { id: ID, cwd: "/work/codex", note: "x".repeat(4001) } });
  assert.ok(first.length > 4000, first.length);
  const prompt = JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "ship the long one" }] } }, timestamp: "2026-11-10T12:00:00.000Z" });
  assert.equal(prompt.includes("user_message"), false);
  await stamp(codex, first + "\n" + prompt + "\n", 3500);
  const pi = join(piDir, "draw.jsonl");
  await stamp(pi, JSON.stringify({ type: "message", message: { role: "user", content: "draw the menu" }, id: "pi-1", cwd: "/work/pi", timestamp: "2026-11-10T09:00:00.000Z" }) + "\n", 1000);
  await writeFile(join(home, ".codex", "session_index.jsonl"), JSON.stringify({ id: ID, thread_name: "The rollout" }) + "\n");
  const { transcriptApi } = await load("kanso-panel/platform-transcripts.js", ["transcriptApi"]);
  const { threadIn } = await load("kanso-spaces/threads.js", ["threadIn"]);
  const { listedOf, recordsOf } = await load("kanso-spaces/resume-list.js", ["listedOf", "recordsOf"]);
  const run = (command, args, options = {}) => exec(command, args, { ...options, env: { ...process.env, HOME: home } });
  const api = transcriptApi("macos", run);
  const scoped = await api.listing(home, { folder: "/work/alpha", shown: 10, most: 20 });
  assert.equal(scoped.code, 0, scoped.stderr);
  assert.deepEqual(clone(listedOf(scoped.stdout).map((row) => row.file)), [newer, older]);
  const one = await api.listing(home, { folder: "/work/alpha", shown: 1, most: 20 });
  assert.deepEqual(clone(listedOf(one.stdout).map((row) => row.file)), [newer]);
  const all = await api.listing(home, { shown: 10, most: 20 });
  assert.deepEqual(clone(listedOf(all.stdout).map((row) => row.file)), [newer, codex, other, older, pi]);
  const read = await api.threads([newer, codex, pi]);
  assert.equal(read.code, 0, read.stderr);
  const threads = recordsOf(read.stdout).filter(Boolean);
  assert.equal(threads.length, 3, read.stdout);
  const [claudeThread, codexThread, piThread] = threads.map((text, i) => threadIn(["claude", "codex", "pi"][i], text));
  assert.equal(claudeThread.title, "The new plan");
  assert.equal(codexThread.title, "The rollout");
  assert.equal(codexThread.prompt, "ship the long one");
  assert.equal(piThread.title, "draw the menu");
});
