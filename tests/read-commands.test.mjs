import assert from "node:assert/strict";
import test from "node:test";
import { clone, load } from "./helpers.mjs";

const pure = () => load("kanso-spaces/pure.js", ["readCommands", "focusOn", "nodeById", "tellsSomething", "dayWord", "sizeMB", "RANGES"]);

// A cx whose timer.after runs are kept, and whose spawn runs the task at once.
const hostCx = () => {
  const starts = [];
  const draws = { count: 0 };
  const cx = {
    timer: { after: (ms, start) => { starts.push(start); return { cancel() {} }; } },
    spawn: (loop) => { const task = loop(cx); starts.task = task; return { cancel() {} }; },
    notify: () => { draws.count += 1; },
  };
  return { cx, starts, draws };
};

test("The command reader hands each command over, redraws, and stops when the build is replaced", async () => {
  const { readCommands } = await pure();
  const { cx, starts, draws } = hostCx();
  const queue = ["one", "two"];
  const seen = [];
  readCommands(cx, async () => {
    if (!queue.length) throw new Error("the build was replaced");
    return queue.shift();
  }, (command) => { seen.push(command); });
  assert.equal(starts.length, 1, "it waits one timer turn, like afterMount");
  await starts[0](cx);
  await starts.task;
  assert.deepEqual(seen, ["one", "two"]);
  assert.equal(draws.count, 2, "each command redraws before it is served");
});

test("The command reader stops at once when its act says false, and never starts on a closed view", async () => {
  const { readCommands } = await pure();
  const hosted = hostCx();
  const { cx, starts } = hosted;
  const queue = ["back", "never"];
  const seen = [];
  readCommands(cx, async () => queue.shift(), (command) => { seen.push(command); return command === "back" ? false : true; });
  await starts[0](cx);
  await starts.task;
  assert.deepEqual(seen, ["back"]);
  assert.deepEqual(queue, ["never"], "the unread command stays for the next view");

  const closedHost = hostCx();
  let spawned = 0;
  const guardedCx = { ...closedHost.cx, spawn: (loop) => { spawned += 1; return closedHost.cx.spawn(loop); } };
  readCommands(guardedCx, async () => "x", () => {}, { closed: () => true });
  await closedHost.starts[0](guardedCx);
  assert.equal(spawned, 0, "a view closed before the turn starts never reads");
  assert.equal(closedHost.draws.count, 0);
});

test("The command reader's keep takes the task, so a close in time can cancel it", async () => {
  const { readCommands } = await pure();
  const { cx, starts } = hostCx();
  const kept = [];
  readCommands(cx, async () => new Promise(() => {}), () => {}, { keep: (task) => kept.push(task) });
  await starts[0](cx);
  assert.equal(kept.length, 1);
  assert.equal(typeof kept[0].cancel, "function");
});

test("A dialog's handle is made and focused in one step", async () => {
  const { focusOn } = await pure();
  let focuses = 0;
  const handle = { focus: () => { focuses += 1; } };
  const made = focusOn({ focus_handle: () => handle });
  assert.equal(made, handle);
  assert.equal(focuses, 1);
});

test("A layout node is found by its id anywhere in the tree, and a missing id finds nothing", async () => {
  const { nodeById } = await pure();
  const deep = { id: "a", children: [{ id: "b" }, { id: "c", children: [{ id: "d" }] }] };
  assert.equal(nodeById(deep, "d").id, "d");
  assert.equal(nodeById(deep, "a"), deep);
  assert.equal(nodeById(deep, "gone"), null);
  assert.equal(nodeById(null, "a"), null);
});

test("A title tells something when it is no path, no user@host and no program name", async () => {
  const { tellsSomething } = await pure();
  assert.equal(tellsSomething("Fixing the flaky test", "Fixing the flaky test", { key: "claude", name: "Claude" }), true);
  assert.equal(tellsSomething("~/src/app", "~/src/app", null), false, "a path tells nothing");
  assert.equal(tellsSomething("C:\\work", "C:\\work", null), false, "a Windows path tells nothing");
  assert.equal(tellsSomething("jj@big", "jj@big", null), false, "a prompt tells nothing");
  assert.equal(tellsSomething("Claude", "Claude", { key: "claude", name: "Claude" }), false, "the program's own name tells nothing");
  assert.equal(tellsSomething("", "", null), false);
});

test("A day's words, a size a person reads, and the meter panels' three ranges", async () => {
  const { dayWord, sizeMB, RANGES } = await pure();
  assert.equal(dayWord(new Date(2026, 10, 16, 9, 0)), "Nov 16");
  assert.deepEqual([sizeMB(640), sizeMB(1434), sizeMB(14_500), sizeMB(null)], ["640 MB", "1.4 GB", "14 GB", "–"]);
  const DAY = 86_400_000;
  const asked = clone(RANGES).map(({ key, label, ms, buckets }) => [key, label, ms / DAY, buckets]);
  assert.deepEqual(asked, [["day", "24 h", 1, 96], ["week", "7 days", 7, 84], ["month", "30 days", 30, 90]]);
});
