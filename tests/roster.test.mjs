// The left nav's roster: who sleeps where, one name per agent, asleep as a status.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const spaces = [
  { id: "sp-shield", name: "shield", folder: "/f", tabs: [{ id: "tb-s" }] },
  { id: "sp-agile", name: "agile", folder: "/f", tabs: [{ id: "tb-a" }] },
  { id: "sp-kanso", name: "herdr-kanso", folder: "/f", tabs: [{ id: "tb-k" }] },
];
const C1 = "78efdf1f-a14a-432a-acf8-0a964fcc0b1a", C2 = "019a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";

test("an agent asleep is in its own space, never another that shares its folder", async () => {
  const { sleepingNow } = await load("kanso-spaces/roster.js", ["sleepingNow"], {});
  const slept = [{ id: "z1", from: ":/f", name: "Hashiko", space: "herdr-kanso", spaceId: "sp-kanso", saved: 1, agents: [{ name: "Hashiko", terminal: "t3q", resume: "c1", spaceId: "sp-kanso", at: 2 }] },
    { id: "z2", from: ":/f", name: "old", space: "agile", saved: 2, agents: [{ name: "Old", terminal: "t9", resume: "c2" }] },
    { id: "z3", from: ":/f", name: "lost", spaceId: "gone-id", saved: 3, agents: [{ name: "Lost", terminal: "t8", resume: "c3" }] }];
  const { rows } = clone(sleepingNow(spaces, [], slept, () => ""));
  assert.deepEqual(rows.map((r) => [r.name, r.space, r.status, r.asleep.at]), [["Hashiko", "sp-kanso", "asleep", 2], ["Old", "sp-agile", "asleep", null], ["Lost", null, "asleep", null]], "the third fits three spaces: none is guessed");
  assert.deepEqual(rows.map((r) => r.address), ["zz:c1", "zz:c2", "zz:c3"], "each row by its conversation");
});

test("a terminal address given to another agent after a sleep neither hides the one asleep nor marks the new one", async () => {
  const { sleepingNow } = await load("kanso-spaces/roster.js", ["sleepingNow"], {});
  const terms = [{ address: "t1", state: "live" }];
  const slept = (pending) => [{ id: "z1", from: ":/f", name: "Alice", spaceId: "sp-kanso", saved: 1, pending, agents: [{ name: "Alice", terminal: "t1", resume: "c1" }] }];
  const settled = sleepingNow(spaces, terms, slept(false));
  assert.deepEqual([settled.rows.length, settled.dozing.size], [1, 0], "asleep, and t1 is Bob's now");
  const going = sleepingNow(spaces, terms, slept(true));
  assert.equal(going.rows.length, 0);
  assert.equal(going.dozing.has("t1"), true, "on its way to sleep: its own terminal shows the moon");
});

test("one name per agent, kept with its conversation: the one you gave it, else its conversation's title", async () => {
  const { nameOf, seenNow } = await load("kanso-spaces/roster.js", ["nameOf", "seenNow"], {});
  const a = (extra) => ({ address: "t5c", labels: {}, program: { name: "claude" }, ...extra });
  assert.equal(nameOf(a({ name: "morpheus" }), { title: "a thread" }, { name: "old" }), "morpheus", "the terminal's own name first");
  assert.equal(nameOf(a(), { title: "a thread" }, { name: "morpheus" }), "morpheus", "a new terminal for the same conversation keeps the name you gave it");
  assert.equal(nameOf(a(), { title: "a thread" }, null), "a thread");
  const th = { t5c: { file: `/h/.claude/projects/-w/${C1}.jsonl`, title: "T", pid: 1 }, t9: { file: `/h/.codex/rollout-x-${C2}.jsonl`, pid: 2 } };
  const ctx = { terms: [{ address: "t5c", state: "live", foreground: { pid: 1 } }, { address: "t9", state: "live", foreground: { pid: 2 } }], rowsBy: new Map([["sp-agile", [a({ name: "morpheus", tab: "tb-a", status: "working" }), { address: "t9", labels: {}, status: "idle" }]]]) };
  const seen = clone([...seenNow(spaces, ctx, th, new Map(), (x) => x.name ?? "codex").values()]);
  assert.deepEqual(seen.map((s) => [s.conversation, s.given, s.space, s.pos, s.status]), [[C1, "morpheus", "sp-agile", 0, "working"], [C2, null, "sp-agile", 1, "idle"]]);
});

test("asleep is a status like working, idle or done: its own section in Status, its own mark", async () => {
  const { bySection } = await load("kanso-spaces/agents.js", ["bySection"], { shared: () => null });
  const e = (address, status) => ({ a: { address, status }, lines: [] });
  const sections = bySection([e("t1", "working"), e("zz:1", "asleep"), e("t2", "idle"), e("t3", "done")]);
  assert.deepEqual(clone(sections.map((s) => [s.id, s.entries.map((x) => x.a.address)])), [["working", ["t1"]], ["done", ["t3"]], ["idle", ["t2"]], ["asleep", ["zz:1"]]]);
});

test("a conversation read from a terminal is its agent's only while that process still runs there", async () => {
  const { readNow, seenNow } = await load("kanso-spaces/roster.js", ["readNow", "seenNow"], {});
  const th = { file: `/h/.claude/projects/-w/${C1}.jsonl`, pid: 10 };
  assert.equal(readNow(th, { foreground: { pid: 10 } }), true);
  assert.equal(readNow(th, { foreground: { pid: 11 } }), false, "Bob started in Alice's terminal: not Alice's conversation");
  assert.equal(readNow(th, { foreground: null }), false, "nothing runs there now");
  assert.equal(readNow(th, {}), false, "a terminal that does not say what runs in it proves nothing");
  assert.equal(readNow(null, { foreground: { pid: 10 } }), false);
  const ctx = { terms: [{ address: "t1", state: "live", foreground: { pid: 11 } }], rowsBy: new Map([["sp-agile", [{ address: "t1", labels: {}, name: "Bob", status: "working" }]]]) };
  const [bob] = [...seenNow(spaces, ctx, { t1: th }, new Map(), (x) => x.name).values()];
  assert.equal(bob.conversation, null, "Bob is not written as Alice");
  const { shownThread } = await load("kanso-spaces/roster.js", ["shownThread"], {});
  assert.equal(shownThread(th, { foreground: { pid: 11 } }), null, "nor shown with Alice's title");
  assert.equal(shownThread(th, { address: "t1" }), null, "nor when the terminal does not say what runs in it");
});

test("where Herdr's terminal list does not say what runs in front, a reading counts only while its process lives", async () => {
  const { readNow, seenNow } = await load("kanso-spaces/roster.js", ["readNow", "seenNow"], {});
  const th = { file: `/h/.claude/projects/-w/${C1}.jsonl`, pid: 10 };
  assert.equal(readNow(th, { address: "t1" }, new Set([10])), true, "Alice still runs: hers");
  assert.equal(readNow(th, { address: "t1" }, new Set([11])), false, "Alice ended (Bob runs there now): not Bob's");
  assert.equal(readNow(th, { address: "t1" }, null), false, "not looked yet: no");
  assert.equal(readNow(th, { address: "t1", foreground: { pid: 11 } }, new Set([10])), false, "the terminal says another runs in front: that wins");
  const ctx = { terms: [{ address: "t1", state: "live" }], alive: new Set([10]), rowsBy: new Map([["sp-agile", [{ address: "t1", labels: {}, status: "idle" }]]]) };
  const [alice] = [...seenNow(spaces, ctx, { t1: th }, new Map(), () => "x").values()];
  assert.equal(alice.conversation, C1, "kept by her conversation");
});

test("every terminal has a name in Herdr, whatever its program, and no two share one", async () => {
  const { terminalNames } = await load("kanso-spaces/roster.js", ["terminalNames"], {});
  const terms = [
    { address: "t5t", state: "live", title: "qb2      ", agent: "qwen-code", labels: { "herdr.space": "sp-f" } },
    { address: "t5s", state: "live", title: "\u25d0\ufe0e qwen    ", labels: { "kanso.name": "qwen", "herdr.space": "sp-a" } },
    { address: "t2c", state: "live", title: "x", labels: { "kanso.name": "Lead", "herdr.space": "sp-f" } },
    { address: "t5r", state: "live", title: "", program: { name: "zsh" }, labels: {} },
    { address: "t3", state: "live", program: { name: "Claude Code" }, labels: {} },
    { address: "t4", state: "live", program: { name: "Claude Code" }, labels: {} },
    { address: "box/t1", state: "live", title: "remote" },
    { address: "t9", state: "gone", title: "ended" },
  ];
  const seen = new Map([["t5g", { name: "morpheus", project: "herdr-kanso" }], ["t5t", { name: "qb2", project: "herdr-kanso" }]]);
  const names = clone([...terminalNames([...terms, { address: "t5g", state: "live", title: "morpheus" }], seen, (k) => ({ "sp-f": "fluenty", "sp-a": "agile" })[k.labels?.["herdr.space"]] ?? null)]);
  assert.deepEqual(names, [
    ["t2c", { name: "Lead", project: "fluenty" }],
    ["t3", { name: "Claude Code", project: null }],
    ["t4", { name: "Claude Code 2", project: null }],
    ["t5g", { name: "morpheus", project: "herdr-kanso" }],
    ["t5r", { name: "zsh", project: null }],
    ["t5s", { name: "qwen", project: "agile" }],
    ["t5t", { name: "qb2", project: "herdr-kanso" }],
  ], "named by Kanso even with no name from its program; another machine's and ended ones are not this sidebar's");
});

test("an agent's key: its conversation while it runs there, else its terminal's own id in Herdr", async () => {
  const { agentKey } = await load("kanso-spaces/roster.js", ["agentKey"], {});
  const th = { file: `/h/.claude/projects/-w/${C1}.jsonl`, pid: 10 };
  assert.equal(agentKey(th, { foreground: { pid: 10 }, labels: { "kanso.id": "x1" } }), C1);
  assert.equal(agentKey(null, { labels: { "kanso.id": "x1" } }), "term:x1", "a qwen, a shell: by its terminal");
  assert.equal(agentKey(th, { foreground: { pid: 11 }, labels: {} }), null, "not named yet");
});

test("names stay unique even when one is already called like a second", async () => {
  const { terminalNames } = await load("kanso-spaces/roster.js", ["terminalNames"], {});
  const terms = ["t1", "t2", "t3"].map((address, i) => ({ address, state: "live", labels: { "kanso.name": ["Lead", "Lead", "Lead 2"][i] } }));
  assert.deepEqual(clone([...terminalNames(terms).values()].map((x) => x.name)), ["Lead", "Lead 3", "Lead 2"]);
});
