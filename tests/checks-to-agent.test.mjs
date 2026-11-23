import test from "node:test";
import assert from "node:assert/strict";
import { load, tape } from "./helpers.mjs";
import { chromeTheme } from "./mod-fixtures.mjs";

const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

const run = (name, conclusion, extra = {}) => ({
  __typename: "CheckRun", name, status: "COMPLETED", conclusion,
  detailsUrl: "https://github.com/acme/shop/actions/runs/" + name, ...extra,
});
const context = (name, state) => ({
  __typename: "StatusContext", context: name, state, targetUrl: "https://ci.example/" + name,
});
const failedRun = {
  result: "failed",
  failed: [{ name: "test", url: "https://github.com/acme/shop/actions/runs/test" }],
};
const PR_URL = "https://github.com/acme/shop/pull/12";
const OPENER = { "kanso.pr": PR_URL };
const pr = (head, outcome) => ({ number: 12, url: PR_URL, head, run: outcome });

test("A failure names each failed job and its link, a cancelled job is not a failure, only cancelled besides passes is cancelled, passes or skips pass, and pending or unknown gives nothing", async () => {
  const { checksOutcome } = await loadOutcome();
  const failed = checksOutcome([
    run("test", "FAILURE"),
    context("coverage", "FAILURE"),
    run("lint", "CANCELLED"),
    run("build", "SUCCESS"),
  ]);
  same(failed, { ...failedRun, failed: [...failedRun.failed, { name: "coverage", url: "https://ci.example/coverage" }] });
  assert.equal(checksOutcome([run("lint", "SUCCESS"), run("test", "CANCELLED")]).result, "cancelled");
  assert.equal(checksOutcome([run("lint", "SUCCESS"), run("docs", "SKIPPED")]).result, "passed");
  assert.equal(checksOutcome([run("lint", "SUCCESS"), { ...run("test", null), status: "IN_PROGRESS", conclusion: null }]), null);
  assert.equal(checksOutcome([run("lint", "SUCCESS"), run("test", "WEIRD")]), null);
});

test("The message says the checks failed, with each failed job, or that they passed", async () => {
  const { checksMessage } = await load("kanso-strip/checks-to-agent.js", ["checksMessage"]);
  const named = { number: 12, url: "https://github.com/acme/shop/pull/12" };
  assert.equal(checksMessage(named, { ...failedRun, failed: [failedRun.failed[0], { name: "coverage", url: null }] }), [
    "The checks on pull request #12 (https://github.com/acme/shop/pull/12) failed:",
    "- test: https://github.com/acme/shop/actions/runs/test",
    "- coverage",
  ].join("\n"));
  assert.equal(checksMessage(named, { result: "passed", failed: [] }), "The checks on pull request #12 (https://github.com/acme/shop/pull/12) passed.");
});

test("The setting off does nothing, a pending run polls, a finished run waits while the agent is working or blocked, and an idle or done agent is sent once with the checks and needs labels", async () => {
  const { checksStep } = await loadChecksStep();
  const finished = pr("abc", failedRun);
  same(checksStep({ pr: finished, status: "idle", on: false }), { act: "none" });
  same(checksStep({ pr: { head: "abc" }, status: "idle" }), { act: "poll", labels: [] });
  assert.equal(checksStep({ pr: finished, status: "working" }).act, "wait");
  assert.equal(checksStep({ pr: finished, status: "blocked" }).act, "wait");
  const sent = checksStep({ pr: finished, status: "idle" });
  assert.equal(sent.act, "send");
  same(sent.labels, ["kanso.checks=abc", "kanso.needs=checks failed"]);
  assert.match(sent.text, /failed:/);
  same(checksStep({ pr: finished, status: "done" }).labels, ["kanso.checks=abc", "kanso.needs=checks failed"]);
  same(checksStep({ pr: pr("abc", { result: "passed", failed: [] }), status: "idle" }).labels, ["kanso.checks=abc", "kanso.needs="]);
});

test("The same head is not sent again, a new head clears our needs label, a cancelled run sends nothing, and no pull request clears the label", async () => {
  const { checksStep } = await loadChecksStep();
  const labeled = { "kanso.checks": "old", "kanso.needs": "checks failed" };
  same(checksStep({ pr: pr("abc", failedRun), labels: { "kanso.checks": "abc" }, status: "idle" }), { act: "none" });
  same(checksStep({ pr: { head: "abc" }, labels: labeled, status: "idle" }), { act: "poll", labels: ["kanso.needs="] });
  same(checksStep({ pr: pr("abc", { result: "cancelled", failed: [] }), status: "idle" }), { act: "none" });
  same(checksStep({ pr: null, labels: labeled }), { act: "label", labels: ["kanso.needs="] });
});

test("A needs label makes an idle or done agent blocked with that reason, and leaves a working, blocked or unlabeled agent unchanged", async () => {
  const { withNeeds } = await load("kanso-strip/needs.js", ["withNeeds"]);
  const terms = [{ address: "t0", labels: { "kanso.needs": "checks failed" } }, { address: "t1", labels: {} }];
  const list = [
    { address: "t0", status: "idle", name: "checkout" },
    { address: "t2", status: "done", name: "review" },
    { address: "t3", status: "working", name: "busy" },
    { address: "t4", status: "blocked", name: "held", msg: "Which file?" },
    { address: "t1", status: "idle", name: "plain" },
  ];
  const next = withNeeds(list, [
    ...terms,
    { address: "t2", labels: { "kanso.needs": "checks failed" } },
    { address: "t3", labels: { "kanso.needs": "checks failed" } },
    { address: "t4", labels: { "kanso.needs": "checks failed" } },
  ]);
  same(next[0], { address: "t0", status: "blocked", name: "checkout", msg: "checks failed" });
  same(next[1], { address: "t2", status: "blocked", name: "review", msg: "checks failed" });
  same(next[2], list[2]);
  same(next[3], list[3]);
  same(next[4], list[4]);
});

const loadChecksStep = () => load("kanso-strip/checks-to-agent.js", ["checksStep"]);
const loadOutcome = () => load("kanso-strip/checks-to-agent.js", ["checksOutcome"]);
const stripCase = (pieces, status, pull = null, extra = {}, labels = {}) => ({
  pieces, panes: [{ pane: "p1", terminal: "t0", status, ...extra }], terminals: [{ address: "t0", labels }], pr: pull,
});
const pullView = (head, rollup) => ({
  number: 12, url: PR_URL, headRefOid: head, state: "OPEN", statusCheckRollup: rollup,
});
const running = (name) => ({ __typename: "CheckRun", name, status: "IN_PROGRESS" });

const stripHost = (state) => {
  const hcCalls = [];
  const afters = [];
  const execCalls = [];
  const host = {
    panes: () => state.panes,
    terminals: () => state.terminals,
    spaces: () => [],
    shared: (key) => (key === "kanso.pieces" ? state.pieces : (state.store ?? {})[key] ?? null),
    setShared: (key, value) => { state.store = { ...(state.store ?? {}), [key]: value }; },
    exec: async (cmd, args) => {
      execCalls.push([cmd, args]);
      if (state.ghFail && cmd === "gh") return { code: 1, stdout: "", stderr: "could not resolve host" };
      if (cmd === "gh") return { code: 0, stdout: JSON.stringify(state.pr ?? {}), stderr: "" };
      if (cmd !== "git") return { code: 1, stdout: "", stderr: "" };
      if (args.includes("--is-inside-work-tree")) return { code: 0, stdout: "true\n", stderr: "" };
      if (args.includes("symbolic-ref")) return { code: 0, stdout: "feat\n", stderr: "" };
      return { code: 0, stdout: args.includes("--porcelain") ? "" : "0\n", stderr: "" };
    },
    hc: async (args) => {
      hcCalls.push(args);
      if (args[0] === "read" && state.holdRead) return new Promise((resolve) => { state.releaseRead = () => resolve({ code: 0, stdout: state.history?.[args[1]] ?? "", stderr: "" }); });
      if (args[0] === "read") return { code: 0, stdout: state.history?.[args[1]] ?? "", stderr: "" };
      if (args[0] === "send" && state.holdSend) return new Promise((resolve) => { state.releaseSend = () => resolve({ code: state.sendCode ?? 0, stdout: "", stderr: "" }); });
      const code = args[0] === "label" ? state.labelCode : args[0] === "send" ? state.sendCode : 0;
      return { code: code ?? 0, stdout: "", stderr: "" };
    },
  };
  const timer = { after: (ms, fn) => { afters.push([ms, fn]); } };
  return { host, hcCalls, afters, execCalls, timer };
};

const openStrip = async (state) => {
  const kit = stripHost(state);
  const { Strip } = await load("kanso-strip/main.js", ["Strip"], kit.host);
  const view = Object.assign(new Strip(), {
    polling: new Set(), digesting: new Set(), watching: new Map(), sent: new Map(), openers: new Map(), lastStatus: new Map(),
  });
  const jobs = [];
  const cx = { timer: kit.timer, spawn(fn) { jobs.push(Promise.resolve(fn(cx))); return { cancel() {} }; } };
  return { ...kit, view, cx, done: async () => { while (jobs.length) await jobs.shift(); } };
};

test("Pending checks schedule one poll, a failed idle agent is told once and labeled, a working agent is not told, and a hidden setting calls nothing", async () => {
  const { POLL_MS } = await load("kanso-strip/checks-to-agent.js", ["POLL_MS"]);
  const pending = await openStrip(stripCase({ "header.digest": "hide" }, "idle", pullView("abc", [running("test")]), { tab: "t1", cwd: "/work" }, OPENER));
  pending.view.digest(pending.host.panes()[0], pending.cx);
  await pending.done();
  pending.view.checksTurn(pending.host.panes()[0], { head: "abc" }, pending.cx);
  assert.equal(pending.execCalls.some((call) => call[0] === "gh" && call[1][0] === "pr"), true);
  assert.deepEqual(pending.afters.map(([ms]) => ms).filter((ms) => ms === POLL_MS), [POLL_MS]);

  const failed = await openStrip(stripCase({ "header.digest": "hide" }, "idle", pullView("abc123", [
    run("test", "FAILURE", { detailsUrl: "https://github.com/acme/shop/actions/runs/9" }),
  ]), { tab: "t1", cwd: "/work" }, OPENER));
  failed.view.digest(failed.host.panes()[0], failed.cx);
  await failed.done();
  await settle();
  const sends = failed.hcCalls.filter((call) => call[0] === "send");
  const labels = failed.hcCalls.filter((call) => call[0] === "label" && call.includes("kanso.checks=abc123"));
  assert.equal(sends.length, 1);
  assert.ok(sends[0][2].includes("pull request #12"));
  assert.ok(sends[0][2].includes("test: https://github.com/acme/shop/actions/runs/9"));
  assert.ok(failed.hcCalls.indexOf(sends[0]) < failed.hcCalls.indexOf(labels[0]));
  assert.ok(labels[0].includes("kanso.needs=checks failed"));

  const working = await openStrip(stripCase({}, "working"));
  working.view.checksTurn(working.host.panes()[0], pr("abc", failedRun), working.cx);
  assert.equal(working.hcCalls.some((call) => call[0] === "send"), false);

  const hidden = await openStrip(stripCase({ "agents.checks": "hide" }, "idle", pullView("abc", [
    run("test", "FAILURE"),
  ]), { tab: "t1", cwd: "/work" }, OPENER));
  hidden.view.digest(hidden.host.panes()[0], hidden.cx);
  await hidden.done();
  assert.equal(hidden.hcCalls.length, 0);
  assert.equal(hidden.afters.length, 0);
});

const waiting = (agent, pieces = {}) => ({
  agents: [agent],
  terminals: [{ address: "t0", labels: { "kanso.needs": "checks failed" }, report: { msg: "other question" } }],
  shared: { "kanso.needs-you": { rows: [{ address: "t0", status: "blocked", pane: "p1", name: "checkout" }] }, "kanso.pieces": pieces },
});

const drawStatus = async (state) => {
  const drawn = tape();
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], {
    ...drawn.host,
    Button: { new: (id) => drawn.host.div().id(id) },
    theme: chromeTheme,
    spaces: () => [], agents: () => state.agents, terminals: () => state.terminals, machines: () => [],
    props: () => ({ side: "right" }), window: () => ({ platform: "macos" }), keys: () => [],
    shared: (key) => state.shared[key], run: () => {},
  });
  new WorkspaceStatus().render();
  return drawn.texts;
};

const sidebarHost = (pieces = null) => ({
  agents: () => [{ address: "t0", status: "idle", pane: "p1", name: "checkout", space: "s1" }],
  panes: () => [{ pane: "p1", tab: "t1", terminal: "t0" }],
  spaces: () => [{ id: "s1", name: "acme", tabs: [{ id: "t1", name: "Main" }] }],
  terminals: () => [{ address: "t0", state: "live", labels: { "kanso.needs": "checks failed" } }],
  shared: (key) => (key === "kanso.pieces" ? pieces : null),
});

const listedAgents = async (pieces = null) => {
  const host = sidebarHost(pieces);
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], host);
  return new Spaces().listed(host.panes(), host.spaces(), host.terminals());
};

const needsSection = async (pieces = null) => {
  const { bySection } = await load("kanso-spaces/agents.js", ["bySection"]);
  const rows = await listedAgents(pieces);
  return bySection(rows.map((agent) => ({ a: agent, lines: [] }))).find((section) => section.label === "Needs you");
};

test("A waiting row whose terminal is labeled checks failed shows that as its question", async () => {
  const texts = await drawStatus(waiting({ address: "t0", name: "checkout", title: "checkout" }));
  assert.ok(texts.includes("checks failed"));
  assert.equal(texts.includes("other question"), false);
});

test("An idle agent whose checks failed lands in the Needs you section of Status", async () => {
  const needs = await needsSection();
  assert.equal(needs?.entries.some((entry) => entry.a.address === "t0" && entry.a.msg === "checks failed"), true);
});

const sendsTo = (calls) => calls.filter((call) => call[0] === "send").map((call) => call[1]);
const ghOnly = (calls) => calls.every((call) => call[0] === "gh" && call[1][0] === "pr" && call[1][1] === "view");

test("Two idle panes on the same branch tell only the terminal whose history opened the pull request", async () => {
  const { HISTORY_LINES } = await load("kanso-strip/checks-to-agent.js", ["HISTORY_LINES"]);
  const state = {
    pieces: { "header.digest": "hide" },
    panes: [0, 1].map((i) => ({ pane: "p" + (i + 1), tab: "t1", terminal: "t" + i, cwd: "/work", status: "idle" })),
    terminals: [0, 1].map((i) => ({ address: "t" + i, labels: {} })),
    pr: pullView("abc123", [run("test", "FAILURE")]),
    history: { t0: "gh pr create\n" + PR_URL },
  };
  const both = await openStrip(state);
  both.view.watchDigests(both.cx);
  await both.done();
  await settle();
  assert.deepEqual(sendsTo(both.hcCalls), ["t0"]);
  assert.deepEqual(both.hcCalls.filter((call) => call[0] === "label" && call.includes("kanso.pr=" + PR_URL)).map((call) => call[1]), ["t0"]);
  assert.ok(both.hcCalls.some((call) => call[0] === "read" && call[2] === "--lines" && call[3] === String(HISTORY_LINES)));
});

test("Two runs of one name wait while one is still running, both failures are listed, and an empty rollup is none", async () => {
  const { checksOutcome } = await loadOutcome();
  const still = { ...run("test", null), status: "IN_PROGRESS", conclusion: null };
  assert.equal(checksOutcome([run("test", "FAILURE"), still]), null);
  const other = "https://ci.example/other";
  same(checksOutcome([run("test", "FAILURE"), run("test", "FAILURE", { detailsUrl: other })]), {
    result: "failed",
    failed: [{ name: "test", url: "https://github.com/acme/shop/actions/runs/test" }, { name: "test", url: other }],
  });
  same(checksOutcome([]), { result: "none", failed: [] });
});

test("Two digests of the same finished head send once before the checks label is visible", async () => {
  const twice = await openStrip(stripCase({ "header.digest": "hide" }, "idle", pullView("abc123", [run("test", "FAILURE")]), { tab: "t1", cwd: "/work" }, OPENER));
  const pane = twice.host.panes()[0];
  twice.view.digest(pane, twice.cx);
  twice.view.digest(pane, twice.cx);
  await twice.done();
  await settle();
  assert.deepEqual(sendsTo(twice.hcCalls), ["t0"]);
});

test("A poll whose GitHub read fails schedules another poll for that pane", async () => {
  const { POLL_MS } = await load("kanso-strip/checks-to-agent.js", ["POLL_MS", "EMPTY_POLLS"]);
  const state = stripCase({ "header.digest": "hide" }, "idle", pullView("abc", [running("test")]), { tab: "t1", cwd: "/work" }, OPENER);
  const watched = await openStrip(state);
  watched.view.digest(watched.host.panes()[0], watched.cx);
  await watched.done();
  state.ghFail = true;
  watched.afters.at(-1)[1](watched.cx);
  await watched.done();
  assert.equal(watched.afters.filter(([ms]) => ms === POLL_MS).length, 2);
});

test("Hiding the header still tells an idle opener, and hiding the checks setting sends nothing", async () => {
  const shown = await openStrip(stripCase(
    { "header.digest": "hide", "header.pr": "hide" }, "idle", pullView("abc123", [run("test", "FAILURE")]), { tab: "t1", cwd: "/work" }, OPENER,
  ));
  shown.view.digest(shown.host.panes()[0], shown.cx);
  await shown.done();
  await settle();
  assert.deepEqual(sendsTo(shown.hcCalls), ["t0"]);
  const off = await openStrip(stripCase({ "agents.checks": "hide" }, "idle", pullView("abc", [run("lint", "FAILURE")]), { tab: "t1", cwd: "/work" }, OPENER));
  off.view.digest(off.host.panes()[0], off.cx);
  await off.done();
  await settle();
  assert.deepEqual(sendsTo(off.hcCalls), []);
});

test("An empty rollup polls at most four times, and a poll reads the pull request without git status or diff", async () => {
  const { POLL_MS, EMPTY_POLLS } = await load("kanso-strip/checks-to-agent.js", ["EMPTY_POLLS", "POLL_MS"]);
  const quiet = await openStrip(stripCase({}, "idle", pullView("abc", []), { tab: "t1", cwd: "/work" }, OPENER));
  quiet.view.digest(quiet.host.panes()[0], quiet.cx);
  await quiet.done();
  const fire = async () => { quiet.afters.at(-1)[1](quiet.cx); await quiet.done(); };
  for (let i = 1; i < EMPTY_POLLS; i += 1) await fire();
  const before = quiet.execCalls.length;
  const scheduled = quiet.afters.length;
  await fire();
  assert.equal(quiet.afters.filter(([ms]) => ms === POLL_MS).length, EMPTY_POLLS);
  assert.equal(quiet.afters.length, scheduled);
  assert.equal(ghOnly(quiet.execCalls.slice(before)), true);
});

test("A blocked agent keeps its own question, and a hidden checks setting ignores the needs label", async () => {
  const blocked = await drawStatus(waiting({ address: "t0", status: "blocked", name: "checkout", title: "checkout" }));
  assert.ok(blocked.includes("other question"));
  assert.equal(blocked.includes("checks failed"), false);
  const hidden = await drawStatus(waiting({ address: "t0", status: "idle", name: "checkout", title: "checkout" }, { "agents.checks": "hide" }));
  assert.ok(hidden.includes("other question"));
  assert.equal(hidden.includes("checks failed"), false);
  const { withNeeds } = await load("kanso-strip/needs.js", ["withNeeds"]);
  const list = [{ address: "t0", status: "idle", name: "checkout" }];
  assert.equal(withNeeds(list, [{ address: "t0", labels: { "kanso.needs": "checks failed" } }], false), list);
  const hiddenRows = await listedAgents({ "agents.checks": "hide" });
  assert.equal(hiddenRows[0].status, "idle");
  assert.equal(hiddenRows[0].msg, null);
  assert.equal((await needsSection({ "agents.checks": "hide" }))?.entries?.some((entry) => entry.a.address === "t0") ?? false, false);
});

const checksLabels = (calls, head) => calls.filter((call) => call[0] === "label" && call.includes("kanso.checks=" + head));
const idleOpener = () => stripCase({ "header.digest": "hide" }, "idle", null, { tab: "t1", cwd: "/work" }, OPENER);
const seen = async (calls, kind) => {
  for (let i = 0; i < 8 && !calls.some((call) => call[0] === kind); i += 1) await Promise.resolve();
};

test("A review mention, a longer pull number, and another repository are not the opener, and creating that pull request is", async () => {
  const { opened } = await load("kanso-strip/checks-to-agent.js", ["opened"]);
  const ask = { url: PR_URL, number: 12 };
  assert.equal(opened("Please review " + PR_URL, ask), false);
  assert.equal(opened("gh pr create\n" + PR_URL.replace("pull/12", "pull/123"), ask), false);
  assert.equal(opened("gh pr create\nhttps://github.com/other/repo/pull/12", ask), false);
  assert.equal(opened("gh pr create\n" + PR_URL, ask), true);
  assert.equal(opened("create_pull_request\n" + PR_URL, ask), true);
});

test("A label that fails is tried again, and a remounted strip does not send the same head again", async () => {
  const state = idleOpener();
  state.labelCode = 1;
  const first = await openStrip(state);
  const pane = first.host.panes()[0];
  first.view.checksTurn(pane, pr("abc123", failedRun), first.cx);
  await settle();
  assert.equal(checksLabels(first.hcCalls, "abc123").length, 2);
  const again = await openStrip(state);
  again.view.checksTurn(again.host.panes()[0], pr("abc123", failedRun), again.cx);
  await settle();
  assert.deepEqual(sendsTo(again.hcCalls), []);
  assert.deepEqual(sendsTo(first.hcCalls), ["t0"]);
});

test("A second turn while the send is pending writes no checks label, and a refused send can be sent later", async () => {
  const state = idleOpener();
  state.holdSend = true;
  state.sendCode = 1;
  const held = await openStrip(state);
  const pane = held.host.panes()[0];
  const finished = pr("abc123", failedRun);
  held.view.checksTurn(pane, finished, held.cx);
  await seen(held.hcCalls, "send");
  held.view.checksTurn(pane, finished, held.cx);
  assert.deepEqual(sendsTo(held.hcCalls), ["t0"]);
  assert.equal(checksLabels(held.hcCalls, "abc123").length, 0);
  state.holdSend = false;
  state.releaseSend();
  await settle();
  assert.equal(checksLabels(held.hcCalls, "abc123").length, 0);
  held.view.checksTurn(pane, finished, held.cx);
  await settle();
  assert.deepEqual(sendsTo(held.hcCalls), ["t0", "t0"]);
});

test("A turn with no pull request and no watched pane clears a stale checks label", async () => {
  const quiet = await openStrip(stripCase({}, "idle", null, {}, { "kanso.needs": "checks failed" }));
  const pane = quiet.host.panes()[0];
  assert.doesNotThrow(() => quiet.view.checksTurn(pane, null, quiet.cx));
  assert.ok(quiet.hcCalls.some((call) => call[0] === "label" && call.includes("kanso.needs=")));
  assert.equal(quiet.hcCalls.some((call) => call.includes("kanso.needs=checks failed")), false);
});

test("Hiding checks while the opener history is still being read sends nothing", async () => {
  const state = stripCase({ "header.digest": "hide" }, "idle", pullView("abc123", [run("test", "FAILURE")]), { tab: "t1", cwd: "/work" });
  state.holdRead = true;
  state.history = { t0: "gh pr create\n" + PR_URL };
  const late = await openStrip(state);
  late.view.digest(late.host.panes()[0], late.cx);
  await seen(late.hcCalls, "read");
  state.pieces = { ...state.pieces, "agents.checks": "hide" };
  state.releaseRead();
  await late.done();
  await settle();
  assert.deepEqual(sendsTo(late.hcCalls), []);
});

