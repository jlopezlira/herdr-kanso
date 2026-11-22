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
const pr = (head, outcome) => ({ number: 12, url: "https://github.com/acme/shop/pull/12", head, run: outcome });

test("A failure names each failed job and its link, a cancelled job is not a failure, only cancelled besides passes is cancelled, passes or skips pass, and pending or unknown gives nothing", async () => {
  const { checksOutcome } = await load("kanso-strip/checks-to-agent.js", ["checksOutcome"]);
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
const quietTerm = { address: "t0", labels: {} };
const stripCase = (pieces, status, pull = null, extra = {}) => ({
  pieces, panes: [{ pane: "p1", terminal: "t0", status, ...extra }], terminals: [quietTerm], pr: pull,
});
const pullView = (head, rollup) => ({
  number: 12, url: "https://github.com/acme/shop/pull/12", headRefOid: head, state: "OPEN", statusCheckRollup: rollup,
});

const stripHost = (state) => {
  const hcCalls = [];
  const afters = [];
  const execCalls = [];
  const host = {
    panes: () => state.panes,
    terminals: () => state.terminals,
    spaces: () => [],
    shared: (key) => (key === "kanso.pieces" ? state.pieces : null),
    setShared: () => {},
    exec: async (cmd, args) => {
      execCalls.push([cmd, args]);
      return cmd === "gh" ? { code: 0, stdout: JSON.stringify(state.pr), stderr: "" } : { code: 1, stdout: "", stderr: "" };
    },
    hc: async (args) => { hcCalls.push(args); return { code: 0, stdout: "", stderr: "" }; },
  };
  const timer = { after: (ms, fn) => { afters.push([ms, fn]); } };
  return { host, hcCalls, afters, execCalls, timer };
};

const openStrip = async (state) => {
  const kit = stripHost(state);
  const { Strip } = await load("kanso-strip/main.js", ["Strip"], kit.host);
  const view = Object.assign(new Strip(), { polling: new Set(), digesting: new Set() });
  let job = null;
  const cx = { timer: kit.timer, spawn: (fn) => { job = fn(); } };
  return { ...kit, view, cx, done: () => job };
};

test("Pending checks schedule one poll, a failed idle agent is told once and labeled, a working agent is not told, and a hidden setting calls nothing", async () => {
  const { POLL_MS } = await load("kanso-strip/checks-to-agent.js", ["POLL_MS"]);
  const pending = await openStrip(stripCase({ "header.digest": "hide" }, "idle", pullView("abc", [
    { __typename: "CheckRun", name: "test", status: "IN_PROGRESS" },
  ]), { tab: "t1", cwd: "/work" }));
  pending.view.digest(pending.host.panes()[0], pending.cx);
  await pending.done();
  pending.view.checksTurn(pending.host.panes()[0], { head: "abc" }, pending.cx);
  assert.equal(pending.execCalls.some((call) => call[0] === "gh" && call[1][0] === "pr"), true);
  assert.deepEqual(pending.afters.map(([ms]) => ms).filter((ms) => ms === POLL_MS), [POLL_MS]);

  const failed = await openStrip(stripCase({ "header.digest": "hide" }, "idle", pullView("abc123", [
    run("test", "FAILURE", { detailsUrl: "https://github.com/acme/shop/actions/runs/9" }),
  ]), { tab: "t1", cwd: "/work" }));
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

  const hidden = await openStrip(stripCase({ "agents.checks": "hide" }, "idle"));
  hidden.view.checksTurn(hidden.host.panes()[0], pr("abc", failedRun), hidden.cx);
  assert.equal(hidden.hcCalls.length, 0);
  assert.equal(hidden.afters.length, 0);
});

test("A waiting row whose terminal is labeled checks failed shows that as its question", async () => {
  const drawn = tape();
  const state = {
    agents: [{ address: "t0", name: "checkout", title: "checkout" }],
    terminals: [{ address: "t0", labels: { "kanso.needs": "checks failed" }, report: { msg: "other question" } }],
    shared: { "kanso.needs-you": { rows: [{ address: "t0", status: "blocked", pane: "p1", name: "checkout" }] } },
  };
  const { WorkspaceStatus } = await load("kanso-status/main.js", ["WorkspaceStatus"], {
    ...drawn.host,
    Button: { new: (id) => drawn.host.div().id(id) },
    theme: chromeTheme,
    spaces: () => [], agents: () => state.agents, terminals: () => state.terminals, machines: () => [],
    props: () => ({ side: "right" }), window: () => ({ platform: "macos" }), keys: () => [],
    shared: (key) => state.shared[key], run: () => {},
  });
  new WorkspaceStatus().render();
  assert.ok(drawn.texts.includes("checks failed"));
  assert.equal(drawn.texts.includes("other question"), false);
});

test("An idle agent whose checks failed lands in the Needs you section of Status", async () => {
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    agents: () => [{ address: "t0", status: "idle", pane: "p1", name: "checkout", space: "s1" }],
    panes: () => [{ pane: "p1", tab: "t1", terminal: "t0" }],
    spaces: () => [{ id: "s1", name: "acme", tabs: [{ id: "t1", name: "Main" }] }],
    terminals: () => [{ address: "t0", state: "live", labels: { "kanso.needs": "checks failed" } }],
  });
  const { bySection } = await load("kanso-spaces/agents.js", ["bySection"]);
  const rows = new Spaces().listed(
    [{ pane: "p1", tab: "t1", terminal: "t0" }],
    [{ id: "s1", name: "acme", tabs: [{ id: "t1", name: "Main" }] }],
    [{ address: "t0", state: "live", labels: { "kanso.needs": "checks failed" } }],
  );
  const needs = bySection(rows.map((agent) => ({ a: agent, lines: [] }))).find((section) => section.label === "Needs you");
  assert.equal(needs?.entries.some((entry) => entry.a.address === "t0" && entry.a.msg === "checks failed"), true);
});
