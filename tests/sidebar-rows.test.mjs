// Sidebar controls are drawn only when they can act, and a pull asks twice.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASLEEP_ROW, showPlus, showDots, projectControls, pullKey, pullLabel, pullCommand, refusalLine,
  aheadOpen, gitControls, runPull, activityTone, machineWordTone, canWake, enterOpens, asleepControls,
} from "../kanso/mods/kanso-spaces/sidebar-rows.js";

const place = { cwd: "/work/app", on: "dark", key: "[dark]" };
const git = { branch: "feat", ahead: 2, behind: 3 };

test("plus stays on the active project and the menu stays on hover", () => {
  assert.equal(showPlus(true, false), true);
  assert.equal(showPlus(false, true), true);
  assert.equal(showPlus(false, false), false);
  assert.equal(showDots(true), true);
  assert.equal(showDots(false), false);
  assert.deepEqual(projectControls({ active: true, hovered: false, place: { folder: "/work" } }), { plus: true, dots: false });
  assert.deepEqual(projectControls({ active: false, hovered: true, place: { folder: "/work" } }), { plus: true, dots: true });
  assert.deepEqual(projectControls({ active: true, hovered: false, place: null }), { plus: false, dots: false });
  assert.deepEqual(projectControls({ active: false, hovered: false, place: { folder: "/work" } }), { plus: false, dots: false });
});

test("a count behind pulls with git on that computer at one press", () => {
  assert.equal(pullLabel(0), null);
  assert.equal(pullLabel(3), "\u21933");
  assert.equal(pullKey("/work/app", "dark"), "pull:dark:/work/app");
  assert.equal(pullKey("/work/app", null), "pull::/work/app");
  assert.deepEqual(pullCommand("/work/app", "dark"), { command: "git", args: ["-C", "/work/app", "pull", "--ff-only"], on: "dark" });
  assert.deepEqual(pullCommand("/work/app", null), { command: "git", args: ["-C", "/work/app", "pull", "--ff-only"], on: null });
  assert.equal(pullCommand("", "dark"), null);
  assert.equal(pullCommand(null, null), null);
  const rest = gitControls(git, { folder: place.cwd, on: place.on });
  assert.equal(rest.find((item) => item.kind === "behind").label, "\u21933");
  assert.deepEqual(rest.find((item) => item.kind === "behind").command, pullCommand(place.cwd, place.on));
  const pulling = gitControls(git, { folder: place.cwd, on: place.on, pulling: true });
  const behind = pulling.find((item) => item.kind === "behind");
  assert.equal(behind.pulling, true, "drawn pending: the count gives way to the breathing dot");
  assert.equal(behind.command, null);
});

test("a refusal shows git's own first line and a clean pull says nothing", async () => {
  assert.equal(refusalLine(null), null);
  assert.equal(refusalLine({ code: 0, stderr: "already up to date" }), null);
  assert.equal(refusalLine({ code: 1, stderr: "\nfatal: Not possible to fast-forward\nmore", stdout: "hint" }), "fatal: Not possible to fast-forward");
  assert.equal(refusalLine({ code: 1, stderr: "  ", stdout: "could not read\nrest" }), "could not read");
  assert.equal(refusalLine({ code: 1, stderr: "", stdout: "" }), null);
  const calls = [];
  const notes = [];
  const exec = async (command, args, options) => { calls.push({ command, args, options }); return { code: 1, stderr: "fatal: no\nmore", stdout: "" }; };
  const notify = (note) => notes.push(note);
  const failed = await runPull(exec, notify, { folder: "/work/app", on: "dark" });
  assert.equal(failed.code, 1);
  assert.deepEqual(calls, [{ command: "git", args: ["-C", "/work/app", "pull", "--ff-only"], options: { on: "dark" } }]);
  assert.deepEqual(notes, [{ title: "Pull refused", body: "fatal: no", level: "error" }]);
  const quiet = [];
  const ok = await runPull(async () => ({ code: 0, stdout: "Updating" }), (note) => quiet.push(note), { folder: "/work/app", on: null });
  assert.equal(ok.code, 0);
  assert.deepEqual(quiet, []);
  assert.equal(await runPull(async () => { throw new Error("ran"); }, notify, { folder: "", on: "dark" }), null);
});

test("a count ahead goes to that project and opens the pull request panel", () => {
  assert.equal(aheadOpen(0, { folder: "/work/app", id: "app", active: false }), null);
  assert.equal(aheadOpen(2, { folder: "", id: "app", active: false }), null);
  assert.deepEqual(aheadOpen(2, { folder: "/work/app", id: "app", active: false }), { panel: "pr", select: "app" });
  assert.deepEqual(aheadOpen(2, { folder: "/work/app", id: "app", active: true }), { panel: "pr", select: null });
  const controls = gitControls(git, { folder: "/work/app", on: "dark", id: "app", active: false });
  assert.deepEqual(controls.find((item) => item.kind === "ahead").open, { panel: "pr", select: "app" });
  assert.equal(controls.find((item) => item.kind === "ahead").label, "\u21912");
});

test("an agent's second line is full ink while it waits, quiet while it works, and dim when it is finished", () => {
  assert.equal(activityTone("blocked"), "foreground");
  assert.equal(activityTone("working"), "muted");
  assert.equal(activityTone("done"), "dim");
  assert.equal(activityTone("idle"), "dim");
  assert.equal(activityTone("asleep"), "muted");
});

test("A computer's state on its row is a dim word, unreachable included", () => {
  assert.equal(machineWordTone("unavailable"), "dim");
  assert.equal(machineWordTone("connected"), "dim");
  assert.equal(machineWordTone("off"), "dim");
  assert.equal(machineWordTone("login"), "dim");
  assert.equal(machineWordTone("loading"), "dim");
});

test("Enter on an asleep row wakes it", () => {
  const z = { id: "tb1", tabId: "tb1", settled: true, space: "sp1" };
  const asleep = { address: "zz:t1", asleep: z };
  assert.equal(ASLEEP_ROW, 32);
  assert.equal(canWake(asleep), true);
  assert.deepEqual(enterOpens(asleep), { wake: z });
  assert.deepEqual(asleepControls(asleep), [{ id: "wake", label: "Wake" }]);
  assert.equal(canWake({ address: "d" }), false);
  assert.deepEqual(asleepControls({ address: "d" }), []);
  assert.deepEqual(enterOpens({ address: "e", pane: "p1" }), { focus: "p1" });
  assert.deepEqual(enterOpens({ address: "f" }), { peek: "f" });
});

test("nothing is painted that cannot act", () => {
  assert.deepEqual(gitControls({ ahead: 0, behind: 0, branch: "main" }, { folder: "/work/app", on: null }), []);
  assert.deepEqual(gitControls({ ahead: 2, behind: 0, branch: "main" }, { folder: "", on: "dark" }), []);
  assert.equal(gitControls({ ahead: 0, behind: 4, branch: "main" }, { folder: "/work/app", on: null }).some((item) => item.kind === "ahead"), false);
  assert.equal(gitControls({ ahead: 4, behind: 0, branch: "main" }, { folder: "/work/app", on: null }).some((item) => item.kind === "behind"), false);
  assert.equal(gitControls(null, { folder: "/work/app", on: null }).length, 0);
});


