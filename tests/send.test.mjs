import test from "node:test";
import assert from "node:assert/strict";
import { load, texts, calls, timedContext } from "./helpers.mjs";
import { byTag, openedSend } from "./mod-fixtures.mjs";

const agent = (address, name, project = "App") => ({ address, state: "live", status: "idle", labels: { "kanso.shown": name, "kanso.project": project } });
const pane = (id, terminal) => ({ pane: id, terminal, status: "idle", program: { agent: true } });
const press = (el, tag, cx = { notify() {} }) => calls(byTag(el, tag), "on_click").forEach(([, fn]) => fn({}, cx));
const primaryOf = (el) => byTag(el, "kanso-send-primary");
const last = (el, name) => calls(el, name).at(-1)?.[1];
const renders = (send, times = 3) => Array.from({ length: times }, () => send.render()).at(-1);
const fire = async (timers, pending, at) => {
  timers.filter(([ms]) => ms === at).forEach(([, fn]) => fn());
  while (pending.length) await pending.shift();
};

test("Every agent the app knows stays listed: one on another computer is chosen, one whose computer is unreachable says so and stays the target", async () => {
  const send = await openedSend({
    terminals: () => [agent("t1", "local"), agent("far/t8", "Far")],
    panes: () => [pane("p1", "t1"), pane("p2", "box/t9")],
    machines: () => [{ name: "far", layout: "ready" }, { name: "box", layout: "unavailable" }],
  }, { from: { terminal: "t1", pane: "p1" }, to: "box/t9" });
  const el = renders(send);
  assert.equal(send.to, "box/t9", "the chosen agent is kept, not swapped for another");
  assert.ok(byTag(el, "to-box/t9"), "an agent known only by its pane is listed");
  assert.ok(texts(byTag(el, "to-box/t9")).includes("Unreachable"), "and says its computer cannot be reached");
  assert.equal(texts(el).includes("No other agent is running. Start one in a pane, then send."), false);
  assert.equal(texts(byTag(el, "to-far/t8")).includes("Unreachable"), false);
  press(el, "to-far/t8");
  assert.equal(send.to, "far/t8");
});

test("The chosen agent stays the recipient through any number of renders while its snapshot is missing; only a press changes it", async () => {
  const send = await openedSend({ terminals: () => [agent("t2", "Nova")], machines: () => [{ name: "box", layout: "unavailable" }] }, { to: "box/t9" });
  const el = renders(send);
  assert.equal(send.to, "box/t9");
  assert.ok(texts(byTag(el, "to-box/t9")).includes("Unreachable"), "its row is drawn and says its computer cannot be reached");
  assert.equal(last(primaryOf(el), "disabled"), false, "Send still means the chosen agent");
  const local = await openedSend({ terminals: () => [agent("t2", "Nova")] }, { to: "t7" });
  assert.ok(texts(byTag(renders(local), "to-t7")).includes("Unknown"));
  assert.equal(local.to, "t7");
  press(renders(local), "to-t2");
  assert.equal(local.to, "t2", "a press picks another");
});

test("A roster not read yet is never drawn as no agent running, and the chosen agent stays on it", async () => {
  const none = await openedSend({});
  const el = renders(none);
  assert.ok(texts(el).includes("Can't see the agents right now."));
  assert.equal(texts(el).includes("No other agent is running. Start one in a pane, then send."), false);
  const chosen = await openedSend({}, { to: "box/t9" });
  assert.ok(byTag(renders(chosen), "to-box/t9"));
  assert.equal(chosen.to, "box/t9");
});

test("A batch says who got it, who refused and who did not confirm, and a later press sends to the chosen agent at once", async () => {
  const asked = [];
  const send = await openedSend({
    hc: (args) => {
      asked.push(args);
      if (args[0] === "label") return new Promise(() => {});
      if (args[1] === "t-nova") return Promise.resolve({ code: 1, stdout: "", stderr: "no such terminal" });
      if (args[1] === "t-atlas") return Promise.reject(new Error("hc took longer than 30 s and was stopped"));
      if (args[1] === "t-vega") return new Promise(() => {});
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    terminals: () => [agent("t-nova", "Nova"), agent("t-atlas", "Atlas"), agent("t-vega", "Vega"), agent("t-lyra", "Lyra")],
  });
  const timers = [];
  const { cx, pending } = timedContext(timers);
  send.toProject = "App";
  send.send(cx, [{ project: "App", agents: ["t-nova", "t-atlas", "t-vega", "t-lyra"].map((terminal) => ({ terminal, name: { "t-nova": "Nova", "t-atlas": "Atlas", "t-vega": "Vega", "t-lyra": "Lyra" }[terminal], status: "idle" })) }]);
  const { SEND_MS } = await load("kanso-send/deliver.js", ["SEND_MS"], { hc: async () => ({}) });
  assert.ok(SEND_MS > 30_000 && SEND_MS <= 32_000, "the view waits the host's 30 s and a moment more");
  assert.ok(timers.some(([ms]) => ms === SEND_MS), "every send has that deadline");
  await fire(timers, pending, SEND_MS);
  assert.equal(send.sending, false);
  assert.match(send.error, /Not sent to Nova \(no such terminal\)\./);
  assert.match(send.error, /Not confirmed for Atlas, Vega: it may have arrived/);
  assert.doesNotMatch(send.error, /Not sent to (?:Atlas|Vega)|Lyra/);
  const el = send.render();
  assert.deepEqual(["t-nova", "t-atlas", "t-vega", "t-lyra"].map((t) => texts(byTag(el, `to-${t}`)).includes("Not confirmed")), [false, true, true, false]);
  const sends = () => asked.filter(([verb]) => verb === "send").length;
  const before = sends();
  send.toProject = null;
  send.to = "t-atlas";
  send.send(cx, [{ project: "App", agents: [{ terminal: "t-atlas", name: "Atlas", status: "idle" }] }]);
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
