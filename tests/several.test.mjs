import test from "node:test";
import assert from "node:assert/strict";
import { exec, load, committedRepo, plain } from "./helpers.mjs";

const { treeBranch } = await load("kanso-spaces/several.js", ["treeBranch"]);
const of = (args, key) => args.find((part, i) => args[i - 1] === "--label" && String(part).startsWith(`${key}=`))?.slice(key.length + 1);

const valid = async (branch) => assert.equal((await exec("git", ["check-ref-format", "--branch", branch])).code, 0, branch);

test("A task with spaces makes a distinct valid branch for each agent", async () => {
  const two = ["claude", "codex"].map((key) => treeBranch("fix the login bug", key));
  const three = ["claude", "codex", "grok"].map((key) => treeBranch("fix the login bug", key));
  assert.equal(new Set(two).size, 2);
  assert.equal(new Set(three).size, 3);
  for (const branch of three) {
    await valid(branch);
    assert.match(branch, /^fix-the-login-bug-/);
  }
});

test("Two or three agents open in the same tab, each under its own name, a task that already has a worktree starts nothing, one worktree failure does not stop the others, and a launch that throws is an error", async (t) => {
  const { dir, repo } = await committedRepo(t);
  process.env.KANSO_TEST_HOME = dir;
  t.after(() => { delete process.env.KANSO_TEST_HOME; });
  const fail = treeBranch("ship the notes", "codex");
  const calls = [];
  let down = false;
  const { startInTree: start } = await load("kanso-spaces/several.js", ["startInTree"], {
    window: () => ({ platform: "macos" }),
    appHome: () => dir,
    home: () => dir,
    exec: (cmd, args, options) => ((args ?? []).includes(fail) ? Promise.resolve({ code: 1, stdout: "", stderr: "That is not a branch name git takes.\n" }) : exec(cmd, args, options)),
    hc: (args) => { if (down) throw new Error("the core is down"); calls.push([...args]); return Promise.resolve({ code: 0, stdout: "", stderr: "" }); },
  });
  const run = { place: { folder: repo }, machine: null, platform: "macos", viewed: (argv) => argv, space: "mac/sp1", tab: "mac/tb1" };
  const agent = (key, name) => ({ key, name, run: [key] });
  const ask = { task: "fix the login bug", from: "main", prompt: "Fix the login bug" };
  const two = [agent("claude", "Claude"), agent("grok", "Grok")];
  const sameTab = () => {
    assert.deepEqual(calls.map((args) => of(args, "herdr.space")), ["sp1", "sp1"]);
    assert.deepEqual(calls.map((args) => of(args, "herdr.tab")), ["tb1", "tb1"]);
    assert.deepEqual(calls.map((args) => of(args, "kanso.name")), ["Claude", "Grok"]);
  };
  for (const one of two) assert.equal((await start(run, one, ask)).error, undefined);
  sameTab();
  const again = plain(await start(run, two[0], ask));
  assert.match(again.error, /already has a worktree/);
  assert.equal(calls.length, 2);
  calls.length = 0;
  const three = [agent("claude", "Claude"), agent("codex", "Codex"), agent("grok", "Grok")];
  const next = { ...ask, task: "ship the notes" };
  const results = [];
  for (const one of three) results.push(plain(await start(run, one, next)));
  assert.equal(results[1].error, "That is not a branch name git takes.");
  assert.equal(results[0].error, undefined);
  assert.equal(results[2].error, undefined);
  assert.equal(calls.length, 2);
  sameTab();
  down = true;
  assert.equal(plain(await start(run, agent("pi", "Pi"), { ...ask, task: "write the notes" })).error, "the core is down");
  assert.equal(calls.length, 2);
});
