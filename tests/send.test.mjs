import test from "node:test";
import assert from "node:assert/strict";
import { load, texts, calls, clone, nodes, timedContext } from "./helpers.mjs";
import { byTag, keyDown, openedSend } from "./mod-fixtures.mjs";

const agent = (address, name, project = "App") => ({ address, state: "live", status: "idle", labels: { "kanso.shown": name, "kanso.project": project } });
const primaryOf = (el) => byTag(el, "kanso-send-primary");
const last = (el, name) => calls(el, name).at(-1)?.[1];
const renders = (send, times = 3) => Array.from({ length: times }, () => send.render()).at(-1);
const UNKNOWN = "Can't see the agents right now.", NO_MATCH = "No agent or project by that name.", NO_AGENT = "No other agent is running. Start one in a pane, then send.";
const CMD_ENTER = { key: "enter", modifiers: { platform: true } };

const TARGETS = {
  agent: { to: "t1", terms: [agent("t1", "Nova")], panes: [{ pane: "p1", terminal: "t1", status: "idle", program: { agent: true } }] },
  shell: { to: "t1", terms: [{ address: "t1", state: "live", program: { name: "zsh", shell: true }, labels: { "kanso.shown": "Nova", "kanso.project": "App" } }], panes: [{ pane: "p1", terminal: "t1", program: { name: "zsh", shell: true } }] },
  gone: { to: "t1", terms: [], panes: [] },
  remote: { to: "box/t9", terms: [], panes: [{ pane: "p9", terminal: "box/t9", status: "idle", program: { agent: true } }] },
};
const SOURCE = { terms: [agent("t0", "Me")], panes: [{ pane: "p0", terminal: "t0", tab: "tab0", status: "idle", program: { agent: true } }] };
const OTHER = { terms: [agent("t2", "Atlas")], panes: [{ pane: "p2", terminal: "t2", status: "idle", program: { agent: true } }] };

const cases = Object.keys(TARGETS).flatMap((target) => [true, false].flatMap((source) => [true, false].flatMap((snapshots) => ["", "Nova"].flatMap((query) =>
  [false, true].map((project) => ({ target, source, snapshots, query, project }))))));

const opened = async ({ target, source, snapshots, query, project }) => {
  const sent = [];
  const parts = [TARGETS[target], OTHER, ...(source ? [SOURCE] : [])];
  const send = await openedSend({
    terminals: () => (snapshots ? parts.flatMap((p) => p.terms) : []),
    panes: () => (snapshots ? parts.flatMap((p) => p.panes) : []),
    spaces: () => [{ name: "App", tabs: [{ id: "tab0" }] }],
    machines: () => [{ name: "box", layout: "unavailable" }],
    hc: async (args) => { sent.push(args); return { code: 0, stdout: "", stderr: "" }; },
  }, { from: { terminal: "t0", pane: "p0" }, to: TARGETS[target].to, query });
  if (project) send.toProject = "App";
  return { send, sent };
};

test("What Send shows and what a press sends come from one place, whatever the snapshots, the target, the search and the choice", async (t) => {
  for (const c of cases) {
    await t.test(JSON.stringify(c), async () => {
      const { send, sent } = await opened(c);
      const chose = { to: send.to, toProject: send.toProject };
      const el = renders(send);
      const named = clone(send.state().recipients.map((x) => x.terminal));
      const { cx, pending } = timedContext([], { stop_propagation() {} });
      keyDown(el, CMD_ENTER, cx);
      while (pending.length) await pending.shift();
      assert.deepEqual(sent.filter(([verb]) => verb === "send").map(([, to]) => to), named, "the calls are the recipients");
      assert.ok(named.every((to) => byTag(el, `to-${to}`)), "every recipient is drawn");
      if (c.project && byTag(el, "to-project-App")) assert.ok(texts(byTag(el, "to-project-App")).includes(`All ${named.length}`), "the count shown is the count sent");
      if (c.target === "shell") assert.equal(named.includes("t1"), false, "a shell gets nothing");
      if (c.target === "shell" && c.snapshots && !c.project) assert.ok(texts(byTag(el, "to-t1")).includes("zsh"), "the shell stays chosen and says what it is");
      if (!c.snapshots) assert.equal(texts(el).some((word) => word === NO_MATCH || word === NO_AGENT), false, "an unread roster is never no match or no agent");
      if (!c.snapshots && !nodes(el).some((kid) => String(kid.tag).startsWith("to-"))) assert.ok(texts(el).includes(UNKNOWN));
      assert.equal(last(primaryOf(el), "disabled"), !named.length, "Send is on exactly when a press would send");
      assert.deepEqual({ to: send.to, toProject: send.toProject }, chose, "the choice is the user's");
    });
  }
});

test("The model gives the rows, their states and the recipients without drawing anything", async () => {
  const { sendState } = await load("kanso-send/send-model.js", ["sendState"], {});
  const shell = sendState({ terms: [...TARGETS.shell.terms, ...OTHER.terms], ps: [], to: "t1" });
  assert.deepEqual([shell.chosen.state, shell.recipients.length], ["shell", 0]);
  const unknown = sendState({ to: "t1", query: "zz" });
  assert.deepEqual([unknown.known, unknown.chosen.state, unknown.empty, unknown.recipients.length], [false, "unknown", "unknown", 0]);
  const gone = sendState({ terms: OTHER.terms, to: "t1" });
  assert.deepEqual([gone.chosen.state, gone.recipients.length], ["gone", 0]);
  const remote = sendState({ terms: OTHER.terms, computers: [{ name: "box", layout: "unavailable" }], to: "box/t9" });
  assert.deepEqual(clone([remote.chosen.state, remote.recipients.map((x) => x.terminal)]), ["unreachable", ["box/t9"]]);
  const searched = sendState({ terms: [agent("t1", "Nova"), agent("t2", "Atlas")], toProject: "App", query: "Nova" });
  assert.deepEqual(clone(searched.recipients.map((x) => x.terminal)), ["t1"], "a project sends to the agents shown for it");
});

test("A batch says who got it, who refused and who did not confirm, and a later press sends to the chosen agent at once", async () => {
  const asked = [];
  const names = { "t-nova": "Nova", "t-atlas": "Atlas", "t-vega": "Vega", "t-lyra": "Lyra" };
  const send = await openedSend({
    hc: (args) => {
      asked.push(args);
      if (args[0] === "label") return new Promise(() => {});
      if (args[1] === "t-nova") return Promise.resolve({ code: 1, stdout: "", stderr: "no such terminal" });
      if (args[1] === "t-atlas") return Promise.reject(new Error("hc took longer than 30 s and was stopped"));
      if (args[1] === "t-vega") return new Promise(() => {});
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    terminals: () => Object.entries(names).map(([address, name]) => agent(address, name)),
  });
  const timers = [];
  const { cx, pending } = timedContext(timers);
  send.toProject = "App";
  send.send(cx, send.state());
  const { SEND_MS } = await load("kanso-send/deliver.js", ["SEND_MS"], { hc: async () => ({}) });
  assert.ok(SEND_MS > 30_000 && SEND_MS <= 32_000, "the view waits the host's 30 s and a moment more");
  assert.ok(timers.some(([ms]) => ms === SEND_MS), "every send has that deadline");
  timers.filter(([ms]) => ms === SEND_MS).forEach(([, fn]) => fn());
  while (pending.length) await pending.shift();
  assert.equal(send.sending, false);
  assert.match(send.error, /Not sent to Nova \(no such terminal\)\./);
  assert.match(send.error, /Not confirmed for Atlas, Vega: it may have arrived/);
  assert.doesNotMatch(send.error, /Not sent to (?:Atlas|Vega)|Lyra/);
  const el = send.render();
  assert.deepEqual(Object.keys(names).map((t) => texts(byTag(el, `to-${t}`)).includes("Not confirmed")), [false, true, true, false]);
  const sends = () => asked.filter(([verb]) => verb === "send").length;
  const before = sends();
  send.toProject = null;
  send.to = "t-atlas";
  send.send(cx, send.state());
  assert.equal(sends(), before + 1, "one press, one send, to what is chosen");
});

test("The shared delivery keeps its own deadline: a caller without a timer is refused, and one that never answers is not confirmed", async () => {
  const { deliver, SEND_MS } = await load("kanso-send/deliver.js", ["deliver", "SEND_MS"], { hc: () => new Promise(() => {}) });
  await assert.rejects(deliver("t1", "hi", "you"), /timer/);
  const timers = [];
  const { cx } = timedContext(timers);
  const result = deliver(cx.timer, "t1", "hi", "you");
  timers.filter(([ms]) => ms === SEND_MS).forEach(([, fn]) => fn());
  const r = await result;
  assert.equal(r.unconfirmed, true);
  assert.notEqual(r.code, 0);
});
