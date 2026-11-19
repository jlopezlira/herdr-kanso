import test from "node:test";
import assert from "node:assert/strict";
import { load, texts, calls, clone, timedContext } from "./helpers.mjs";
import { byTag, classOf, keyDown, openedSend, recordPairs, recordsFor } from "./mod-fixtures.mjs";

const agent = (address, name, project = "App") => ({ address, state: "live", status: "idle", labels: { "kanso.shown": name, "kanso.project": project } });
const primaryOf = (el) => byTag(el, "kanso-send-primary");
const last = (el, name) => calls(el, name).at(-1)?.[1];
const renders = (send, times = 3) => Array.from({ length: times }, () => send.render()).at(-1);
const UNKNOWN = "Can't see the agents right now.", NO_MATCH = "No agent or project by that name.", NO_AGENT = "No other agent is running. Start one in a pane, then send.";
const CMD_ENTER = { key: "enter", modifiers: { platform: true } };
const pressed = async (el) => {
  const { cx, pending } = timedContext([], { stop_propagation() {} });
  keyDown(el, CMD_ENTER, cx);
  while (pending.length) await pending.shift();
};

const TARGETS = {
  agent: { to: "t1", terms: [agent("t1", "Nova")], panes: [{ pane: "p1", terminal: "t1", status: "idle", program: { agent: true } }] },
  shell: { to: "t1", terms: [{ address: "t1", state: "live", program: { name: "zsh", shell: true }, labels: { "kanso.shown": "Nova", "kanso.project": "App" } }], panes: [{ pane: "p1", terminal: "t1", program: { name: "zsh", shell: true } }] },
  blocked: { to: "t1", terms: [{ ...agent("t1", "Nova"), status: "blocked" }], panes: [{ pane: "p1", terminal: "t1", status: "blocked", program: { agent: true } }] },
  gone: { to: "t1", terms: [], panes: [] },
  remote: { to: "box/t9", terms: [], panes: [{ pane: "p9", terminal: "box/t9", status: "idle", program: { agent: true } }] },
};
const SOURCE = { terms: [agent("t0", "Me")], panes: [{ pane: "p0", terminal: "t0", tab: "tab0", status: "idle", program: { agent: true } }] };
const OTHER = { terms: [agent("t2", "Atlas")], panes: [{ pane: "p2", terminal: "t2", status: "idle", program: { agent: true } }] };

const CHANGES = {
  none: (world) => world,
  "box ready": (world) => world,
  "became a shell": (world) => ({ ...world, terms: world.terms.map((k) => (k.address === "t1" ? { ...TARGETS.shell.terms[0] } : k)), panes: world.panes.map((p) => (p.terminal === "t1" ? { ...TARGETS.shell.panes[0] } : p)) }),
  "project emptied": (world) => ({ terms: world.terms.filter((k) => k.address === "t0"), panes: world.panes.filter((p) => p.terminal === "t0") }),
  "pane says blocked": (world) => ({ ...world, panes: world.panes.map((p) => (p.terminal === "t1" ? { ...p, status: "blocked" } : p)) }),
  "shell and ended": (world) => ({ ...world, terms: world.terms.map((k) => (k.address === "box/t9" || k.address === "t1" ? { ...k, state: "exited", program: { name: "zsh", shell: true } } : k)) }),
  "agent appeared": (world) => (world.terms.length ? { terms: [...world.terms, agent("t3", "Nova Two")], panes: world.panes } : world),
};
const cases = Object.keys(TARGETS).flatMap((target) => [true, false].flatMap((source) => [true, false].flatMap((snapshots) => ["", "Nova"].flatMap((query) =>
  [false, true].flatMap((project) => Object.keys(CHANGES).map((change) => ({ target, source, snapshots, query, project, change })))))));

const opened = async ({ target, source, snapshots, query, project, change = "none" }) => {
  const sent = [];
  const parts = [TARGETS[target], OTHER, ...(source ? [SOURCE] : [])];
  const box = { name: "box", layout: change === "box ready" ? "ready" : "unavailable" };
  const world = { terms: snapshots ? parts.flatMap((p) => p.terms) : [], panes: snapshots ? parts.flatMap((p) => p.panes) : [] };
  const live = { now: world };
  const send = await openedSend({
    terminals: () => live.now.terms,
    panes: () => live.now.panes,
    spaces: () => [{ name: "App", tabs: [{ id: "tab0" }] }],
    machines: () => [box],
    hc: async (args) => { sent.push(args); return { code: 0, stdout: "", stderr: "" }; },
  }, { from: { terminal: "t0", pane: "p0" }, to: TARGETS[target].to, query });
  if (project) send.toProject = "App";
  return { send, sent, shift: () => { live.now = CHANGES[change](world); } };
};
const model = () => load("kanso-send/send-model.js", ["sendState"], {});
const kept = (send, chose) => assert.deepEqual({ to: send.to, toProject: send.toProject }, chose, "the choice is the user's");
const aimed = (state) => clone([state.recipients, state.waiting].map((list) => list.map((x) => x.terminal)));

test("What Send shows and what a press sends come from one place, whatever the snapshots, the target, the search and the choice", async (t) => {
  for (const c of cases) {
    await t.test(JSON.stringify(c), async () => {
      const { send, sent, shift } = await opened(c);
      const chose = { to: send.to, toProject: send.toProject };
      const el = renders(send);
      const state = send.state();
      const named = clone(state.recipients.map((x) => x.terminal)), waits = state.waiting.length > 0;
      const sends = () => sent.filter(([verb]) => verb === "send").map(([, to]) => to);
      shift();
      const now = send.state(), same = JSON.stringify(aimed(now)) === JSON.stringify(aimed(state));
      await pressed(el);
      assert.deepEqual(sends(), same ? named : [], "a press sends only what is still true, never the old set or an unseen new one");
      if (!same) {
        const redrawn = renders(send, 1), fresh = clone(now.recipients.map((x) => x.terminal));
        assert.equal(last(primaryOf(redrawn), "disabled"), !fresh.length && !now.waiting.length, "the redraw shows the new state first");
        await pressed(redrawn);
        assert.deepEqual(sends(), fresh, "the next press sends to what the redraw showed");
        kept(send, chose);
        return;
      }
      assert.ok(named.every((to) => byTag(el, `to-${to}`)), "every recipient is drawn");
      if (c.project && byTag(el, "to-project-App")) assert.ok(texts(byTag(el, "to-project-App")).includes(`All ${named.length}`), "the count shown is the count sent");
      if (c.target === "shell") assert.equal(named.includes("t1"), false, "a shell gets nothing");
      if (c.target === "shell" && c.snapshots && !c.project) assert.ok(texts(byTag(el, "to-t1")).includes("zsh"), "the shell stays chosen and says what it is");
      if (!state.complete) assert.equal(texts(el).some((word) => word === NO_MATCH || word === NO_AGENT), false, "a roster with any computer unread is never no match or no agent");
      if (!state.complete) assert.ok(texts(el).includes(UNKNOWN), "it says it cannot see them all");
      assert.equal(last(primaryOf(el), "disabled"), !named.length && !waits, "Send is on exactly when a press sends or says who waits");
      if (!named.length && waits) assert.match(send.error, /waiting on (?:its|their) own question/, "a press that sends nothing says why");
      if (c.target === "blocked") assert.equal(named.includes("t1"), false, "an agent waiting on its own question gets nothing");
      kept(send, chose);
    });
  }
});

test("One classification for every record pair: anything against delivery wins, and only ready is sent to", async () => {
  const { classify } = await load("kanso-send/deliver.js", ["classify"], { hc: async () => ({}) });
  const { sendState } = await model();
  for (const [term, pane] of recordPairs) {
    const records = recordsFor(term, pane);
    const kind = classOf(term, pane);
    assert.equal(classify([records.terminals[0], records.panes[0]]), kind, `${term} + ${pane}`);
    const state = sendState({ terms: [...SOURCE.terms, ...records.terminals], ps: records.panes, from: "t0", to: "t1" });
    assert.deepEqual(clone([state.chosen.state, state.recipients.length, state.waiting.length]), [kind, kind === "ready" ? 1 : 0, kind === "waiting" ? 1 : 0], `${term} + ${pane} in Send`);
    const send = await openedSend({ terminals: () => [...SOURCE.terms, ...records.terminals], panes: () => records.panes }, { from: { terminal: "t0", pane: "p0" }, to: "t1" });
    const sent = [];
    send.send = (cx, now) => sent.push(...now.recipients.map((x) => x.terminal));
    keyDown(renders(send), CMD_ENTER);
    assert.deepEqual(clone(sent), kind === "ready" ? ["t1"] : [], `${term} + ${pane} through the dialog`);
  }
  assert.equal(classify([{ status: "idle", program: { agent: true } }], { reachable: false }), "unreachable", "unreachable only with no evidence against delivery");
  assert.equal(classify([{ state: "exited", program: { name: "zsh", shell: true } }], { reachable: false }), "shell");
});

test("No agent and no match are said only when every computer was read; with one unread the agents shown stay and the note says so", async () => {
  const { sendState } = await model();
  const down = [{ name: "box", layout: "unavailable" }];
  assert.deepEqual(clone([sendState({ terms: SOURCE.terms, from: "t0", computers: down }).empty, sendState({ terms: SOURCE.terms, from: "t0", computers: down, query: "Remote" }).empty]), ["unknown", "unknown"]);
  assert.deepEqual(clone([sendState({ terms: SOURCE.terms, from: "t0", computers: [{ name: "box", layout: "ready" }] }).empty, sendState({ terms: SOURCE.terms, from: "t0", query: "Remote" }).empty]), ["none", "no match"]);
  const here = [{ name: null, layout: "loading" }, { name: "box", layout: "ready" }];
  assert.deepEqual(clone([sendState({ terms: SOURCE.terms, from: "t0", computers: here }).empty, sendState({ terms: SOURCE.terms, from: "t0", computers: here, query: "Remote" }).empty]), ["unknown", "unknown"], "this computer counts too");
  const send = await openedSend({ terminals: () => [...SOURCE.terms, ...OTHER.terms], machines: () => down }, { from: { terminal: "t0", pane: "p0" }, to: "t2" });
  const el = renders(send);
  assert.ok(byTag(el, "to-t2"), "the agents it can see stay listed");
  assert.ok(texts(el).includes(UNKNOWN));
});

test("Two agents with one name read apart on their rows and in every sentence about them", async () => {
  const { labelled } = await load("kanso-send/send-model.js", ["labelled"], {});
  const named = (terminal, branch) => ({ terminal, name: "Nova", pane: branch ? { branch } : null });
  assert.deepEqual(clone(labelled([named("t1", "main"), named("t2", "feat")]).map((x) => x.label)), ["Nova (main)", "Nova (feat)"], "by branch when the branches differ");
  assert.deepEqual(clone(labelled([named("t1", "main"), named("t2", "main"), { terminal: "t3", name: "Atlas" }]).map((x) => x.label)), ["Nova (t1)", "Nova (t2)", "Atlas"], "else by address; a unique name stays as it is");
  const tricky = clone(labelled([named("t1", "t2"), named("t2")]).map((x) => x.label));
  assert.equal(new Set(tricky).size, 2, `a branch named like another agent's address never reads the same: ${tricky.join(" / ")}`);
  assert.deepEqual(clone(labelled([named("t1", "main"), named("t2", "feat")]).map((x) => x.title)), ["Nova", "Nova"], "a row says its branch once, in its detail");
  const send = await openedSend({
    terminals: () => [agent("t1", "Nova"), agent("t2", "Nova"), { ...agent("t3", "Nova"), status: "blocked" }],
    hc: async (args) => (args[1] === "t2" ? { code: 1, stdout: "", stderr: "refused" } : { code: 0, stdout: "", stderr: "" }),
  });
  send.toProject = "App";
  const el = renders(send);
  assert.ok(["Nova (t1)", "Nova (t2)", "Nova (t3)"].every((label) => texts(el).includes(label)), texts(el).join(" | "));
  await pressed(el);
  assert.match(send.error, /Not sent to Nova \(t2\) \(refused\)\./);
  assert.match(send.error, /Nova \(t3\) waited on its own question/);
  assert.doesNotMatch(send.error, /Nova \(t1\)/);
});

test("A press compares who gets it as sets: the same agents in another order still send", async () => {
  const order = { now: [agent("t1", "Nova"), agent("t2", "Atlas")] };
  const sent = [];
  const send = await openedSend({ terminals: () => order.now, hc: async (args) => { sent.push(args); return { code: 0, stdout: "", stderr: "" }; } });
  send.toProject = "App";
  const el = renders(send);
  order.now = order.now.toReversed();
  await pressed(el);
  assert.deepEqual(sent.filter(([verb]) => verb === "send").map(([, to]) => to).toSorted(), ["t1", "t2"]);
});

test("The model gives the rows, their states and the recipients without drawing anything", async () => {
  const { sendState } = await model();
  const shell = sendState({ terms: [...TARGETS.shell.terms, ...OTHER.terms], ps: [], to: "t1" });
  assert.deepEqual([shell.chosen.state, shell.recipients.length], ["shell", 0]);
  const unknown = sendState({ to: "t1", query: "zz" });
  assert.deepEqual([unknown.known, unknown.chosen.state, unknown.empty, unknown.recipients.length], [false, "unknown", "unknown", 0]);
  const gone = sendState({ terms: OTHER.terms, to: "t1" });
  assert.deepEqual([gone.chosen.state, gone.recipients.length], ["gone", 0]);
  const remote = sendState({ terms: OTHER.terms, computers: [{ name: "box", layout: "unavailable" }], to: "box/t9" });
  assert.deepEqual(clone([remote.chosen.state, remote.recipients.map((x) => x.terminal)]), ["unreachable", []], "only ready is sent to");
  const asking = { ...agent("t1", "Nova"), status: "blocked" };
  const single = sendState({ terms: [asking], to: "t1" }), all = sendState({ terms: [asking], toProject: "App" });
  assert.deepEqual(clone([single.recipients.length, single.waiting.map((x) => x.terminal), all.recipients.length, all.waiting.map((x) => x.terminal)]), [0, ["t1"], 0, ["t1"]],
    "waiting on its own question is its own outcome, for one agent and for a project whose agents all wait");
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
