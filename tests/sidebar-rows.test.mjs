// Sidebar controls are drawn only when they can act, and a pull asks twice.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASLEEP_ROW, showPlus, showDots, projectControls, pullKey, pullLabel, pullCommand, refusalLine,
  aheadOpen, gitControls, runPull, activityTone, machineWordTone, canWake, enterOpens, asleepControls,
  gitTask, behindTip, aheadTip, foldTail, sectionMarkOf, sectionCount, rowDirectory, timePlace, untilWord, readWord,
  threadWord, threadActions, closedControls, signInCommand, noProjectsOn, sortOf, viewChord,
} from "../kanso/mods/kanso-spaces/sidebar-rows.js";
import { readFile } from "node:fs/promises";
import { load } from "./helpers.mjs";

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



test("a project row names its repository when it differs, its branch, or a detached commit's short id", () => {
  assert.deepEqual(gitTask({ name: "herdr-kanso", branch: "main" }, "kansō", null), { repo: "herdr-kanso", branch: "main", commit: "" });
  assert.deepEqual(gitTask({ name: "prjct", branch: "(detached)", oid: "a1b2c3d4e5f6" }, "prjct", null), { repo: "", branch: "", commit: "a1b2c3d" });
  assert.deepEqual(gitTask({ name: "kanso", branch: "site" }, "site", { last: true }), { repo: "", branch: "", commit: "" }, "a worktree row is its branch already");
  assert.deepEqual(gitTask(null, "agile", null), { repo: "", branch: "", commit: "" }, "no repository: the name alone");
});

test("the counts say what a press does: pull from the upstream, or open the PR panel", () => {
  assert.equal(behindTip(12, "origin/main"), "Pull 12 from origin/main");
  assert.equal(behindTip(12, "origin/main", true), "Pulling 12 from origin/main");
  assert.equal(behindTip(3, null), "Pull 3");
  assert.equal(aheadTip(2), "2 commits not on GitHub · PR panel");
  assert.equal(aheadTip(1), "1 commit not on GitHub · PR panel");
  const controls = gitControls({ ahead: 2, behind: 12, upstream: "origin/main" }, { folder: "/work/app", on: null, id: "s1", active: true });
  assert.deepEqual(controls.map((c) => c.tip), ["2 commits not on GitHub · PR panel", "Pull 12 from origin/main"]);
});

test("an open group draws nothing of its own, and a folded one its most urgent mark and how many", () => {
  assert.equal(foldTail(true, ["blocked", "working"]), null);
  assert.deepEqual(foldTail(false, ["working", "blocked", "idle"]), { mark: "blocked", count: 3 });
  assert.deepEqual(foldTail(false, ["idle", null]), { mark: null, count: 2 }, "idle is never the mark");
});

test("a section head carries a mark only for Needs you, and its count only once folded", () => {
  assert.equal(sectionMarkOf("blocked"), "blocked");
  for (const id of ["working", "done", "idle", "asleep", "other", "pinned", "snoozed", "settled"]) assert.equal(sectionMarkOf(id), null, id);
  assert.equal(sectionCount(true, 2), null);
  assert.equal(sectionCount(false, 2), 2);
});

test("a session row puts its project after the name, the computer when not this one, and its time after what it is on", () => {
  assert.equal(rowDirectory("kansō", null), "kansō");
  assert.equal(rowDirectory("ops", "dark"), "ops · dark");
  assert.equal(rowDirectory(null, null), null);
  assert.equal(timePlace("Reviewing step 01", "3m"), "line");
  assert.equal(timePlace(null, "3m"), "end", "with no second line the time keeps its place at the end");
  assert.equal(timePlace("x", null), null);
});

test("a thread row says it cannot be read, until when it sleeps, or that it woke", () => {
  const now = new Date(2026, 10, 13, 15, 0).getTime();
  const later = new Date(2026, 10, 13, 18, 30).getTime();
  const thursday = new Date(2026, 10, 19, 9, 0).getTime();
  assert.equal(untilWord(later, now), "18:30");
  assert.equal(untilWord(thursday, now), "Thu 9:00");
  assert.equal(threadWord({ unreadable: true, now }), "Can't read");
  assert.equal(threadWord({ snoozedUntil: thursday, now }), "Thu 9:00");
  assert.equal(threadWord({ snoozedUntil: now - 1, woke: true, now }), "Woke");
  assert.equal(threadWord({ now }), null);
  assert.equal(readWord(new Date(2026, 10, 13, 14, 2).getTime()), "Read 14:02");
  assert.equal(readWord(null), null);
});

test("under the pointer a finished thread offers Settle, a settled one Bring back, and one at work neither", () => {
  assert.deepEqual(threadActions({ settled: false, status: "done", pinned: false }).map((a) => a.tip), ["Settle"]);
  assert.deepEqual(threadActions({ settled: true, status: "done", pinned: false }).map((a) => a.tip), ["Bring back"]);
  assert.deepEqual(threadActions({ settled: false, status: "working", pinned: false }), []);
  assert.deepEqual(threadActions({ settled: false, status: "idle", pinned: true }), []);
});

test("a kept project shows + and the menu under the pointer, and Locate when its folder is gone", () => {
  assert.deepEqual(closedControls({ hovered: false, missing: false }), { plus: false, dots: false, locate: false });
  assert.deepEqual(closedControls({ hovered: true, missing: false }), { plus: true, dots: true, locate: false });
  assert.deepEqual(closedControls({ hovered: false, missing: true }), { plus: false, dots: false, locate: true });
});

test("a computer that needs a login signs in from a terminal pane, and one with no project says so", () => {
  assert.deepEqual(signInCommand("dark"), { argv: ["hc", "machine", "login", "dark"], place: "right" });
  assert.equal(noProjectsOn("dark"), "No projects on dark yet");
});

test("the sort of each view is known, and away from its default it is not the quiet one", async () => {
  const kit = await load("kanso-spaces/agents.js", ["ORDERS", "STATUS_ORDERS", "THREAD_ORDERS", "DEFAULT_ORDER"]);
  const rest = { order: "updated", statusOrder: "latest", threadOrder: "said" };
  for (const view of ["spaces", "agents", "threads"]) assert.equal(sortOf(view, rest, kit).plain, true, view);
  assert.deepEqual(Object.fromEntries(["spaces", "agents", "threads"].map((v) => [v, sortOf(v, { order: "attention", statusOrder: "longest", threadOrder: "started" }, kit)]).map(([v, s]) => [v, [s.key, s.current, s.plain]])), {
    spaces: ["order", "attention", false], agents: ["statusOrder", "longest", false], threads: ["threadOrder", "started", false],
  });
});

test("the view switch names each view's key the way this platform binds it", async () => {
  const bound = async (file) => Object.fromEntries(Object.entries(JSON.parse(await readFile(new URL(`../kanso/${file}`, import.meta.url), "utf8"))["layout:kanso"] ?? {})
    .filter(([, c]) => String(c).startsWith("kanso-spaces.view-")).map(([chord, c]) => [c.slice("kanso-spaces.view-".length), chord]));
  const mac = await bound("keys.json"), windows = await bound("keys.windows.json");
  for (const view of ["spaces", "agents", "threads"]) {
    assert.equal(viewChord(view, "macos"), mac[view], view);
    assert.equal(viewChord(view, "windows"), windows[view], view);
  }
  assert.equal(viewChord("threads", "macos"), "ctrl-alt-t");
});
