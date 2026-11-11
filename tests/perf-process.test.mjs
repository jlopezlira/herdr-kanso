// Sidebar process readers reuse the live host records.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, context } from "./helpers.mjs";

test("thread discovery uses each terminal's foreground pid and argv without hc get", async () => {
  const calls = [];
  const { findThreads } = await load("kanso-spaces/threads.js", ["findThreads"], {
    home: () => "/home/me",
    exec: async (command, args) => { calls.push([command, args]); return { code: 0, stdout: command === "sh" && args.length === 2 ? "/home/me" : "" }; },
    hc: () => assert.fail("thread discovery spawned hc get"),
  });
  const list = [{ address: "t1", app: "agent" }, { address: "t2", app: "agent" }, { address: "t3", app: "agent" }];
  await findThreads(list, {}, [{ address: "t1", foreground: { pid: 101, argv: ["codex"] } }, { address: "t2", foreground: { pid: 202, argv: ["claude"] } }]);
  assert.deepEqual(clone(calls.filter(([, args]) => args.length > 2).map(([, args]) => args.slice(-2))), [["101", "codex"], ["202", "claude"]]);
});

test("terminal identity labels use created_ms without another process read", async () => {
  const calls = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], { hc: async (args) => { calls.push(clone(args)); return { code: 0 }; } });
  const view = new Spaces();
  await view.labelTerminal("t1", { "kanso.shown": "Name" }, { created_ms: 123, labels: {} });
  await view.labelTerminal("t2", {}, { created_ms: 456, labels: { "kanso.id": "kept" } });
  assert.deepEqual(calls, [["label", "t1", "kanso.shown=Name", "kanso.id=t1-123"], ["label", "t2"]]);
});

test("a known pid reuses its location and an unchanged transcript is not read again", async () => {
  const calls = [];
  let size = 123;
  const file = "/session folder/rollout-01234567-1234-1234-1234-0123456789ab.jsonl";
  const { findThreads } = await load("kanso-spaces/threads.js", ["findThreads"], {
    home: () => "/home/me",
    exec: async (command, args) => {
      calls.push([command, clone(args)]);
      return { code: 0, stdout: command === "wc" ? `${size} ${file}\n` : args.length === 5 ? `codex\t${file}\t{}\n` : "" };
    },
  });
  const list = [{ address: "t1", app: "codex" }], terms = [{ address: "t1", foreground: { pid: 101 } }];
  const found = await findThreads(list, {}, terms);
  assert.deepEqual(calls.map(([command]) => command), ["sh", "wc", "sh"]);
  assert.deepEqual(calls[1], ["wc", ["-c", file]]);
  assert.equal(found.t1.size, 123);
  calls.length = 0;
  const again = await findThreads(list, found, terms);
  assert.equal(again.t1, found.t1);
  assert.deepEqual(calls.map(([command]) => command), ["wc"]);
  size = 124;
  calls.length = 0;
  const grown = await findThreads(list, found, terms);
  assert.equal(grown.t1.size, 124);
  assert.deepEqual(calls.map(([command]) => command), ["wc", "sh"]);
  calls.length = 0;
  const replaced = await findThreads(list, found, [{ address: "t1", foreground: { pid: 202 } }]);
  assert.equal(replaced.t1.pid, 202);
  assert.deepEqual(calls.map(([command]) => command), ["sh", "wc", "sh"]);
});

test("missing transcripts retry after 1, 2, 4, 8 and at most 10 minutes, resetting for a new pid", async () => {
  let now = 0;
  const attempts = [];
  const { ThreadLocator, findThreads } = await load("kanso-spaces/threads.js", ["ThreadLocator", "findThreads"], {
    Date: { now: () => now }, home: () => "/home/me",
    exec: async (command, args) => { attempts.push([now, command, args.at(-2)]); return { code: 0, stdout: "" }; },
  });
  const locator = new ThreadLocator(), list = [{ address: "t1", app: "agent" }];
  let pid = 101;
  const scan = () => findThreads(list, {}, [{ address: "t1", foreground: { pid } }], locator);
  await scan();
  const due = [60000, 180000, 420000, 900000, 1500000, 2100000];
  for (const [i, at] of due.entries()) {
    now = at - 1;
    await scan();
    assert.equal(attempts.length, i + 1, `LOCATE retried before ${at} ms`);
    now = at;
    await scan();
    assert.equal(attempts.length, i + 2);
  }
  assert.deepEqual(attempts.map(([at]) => at), [0, ...due]);
  pid = 202;
  now += 1;
  await scan();
  assert.deepEqual(attempts.at(-1), [2100001, "sh", "202"]);
  now = 2160000;
  await scan();
  assert.equal(attempts.length, 8);
  now = 2160001;
  await scan();
  assert.equal(attempts.length, 9, "a replacement pid starts with the one-minute delay again");
  await findThreads([], {}, [], locator);
  await scan();
  assert.equal(attempts.length, 10, "a terminal that leaves does not retain an old lookup delay");
});

test("machine polling stops after the first local read and resumes for a remote or parked machine", async () => {
  const calls = [];
  let layouts = [{ name: null, layout: "ready" }];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    machines: () => layouts,
    hc: async (args) => { calls.push(clone(args)); return { code: 0, stdout: '{"machines":[]}' }; },
  });
  const view = Object.assign(new Spaces(), { parked: [] });
  const { cx, drain } = context();
  view.refreshMachines(cx);
  await drain();
  view.refreshMachines(cx, true);
  await drain();
  assert.equal(calls.length, 1);
  layouts = [{ name: "remote", layout: "ready" }];
  view.refreshMachines(cx, true);
  await drain();
  layouts = [];
  view.parked = [{ name: "parked" }];
  view.refreshMachines(cx, true);
  await drain();
  assert.equal(calls.length, 3);
});
