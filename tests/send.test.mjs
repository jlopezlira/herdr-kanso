// Send lists a live agent on another computer, keeps that first target, and a send that does not confirm names who.
import test from "node:test";
import assert from "node:assert/strict";
import { load, drawingHost, chain, nodes, texts, calls, clone, KIT_NIGHT, timedContext } from "./helpers.mjs";

const host = () => ({ ...drawingHost(), Textarea: { new: () => chain("textarea") }, Input: { new: () => chain("input") }, theme: () => KIT_NIGHT, closeOverlay() {}, shared: () => null, setShared() {}, spaces: () => [], props: () => ({ overlay: "o1", pane: "p1" }) });
const field = (value, multiline = false) => ({ value: () => value, state: {}, multiline, focused: false });
const agent = (address, name, project = "App") => ({ address, state: "live", status: "idle", labels: { "kanso.shown": name, "kanso.project": project } });
const pane = (id, terminal) => ({ pane: id, terminal, status: "idle", program: { agent: true } });

const opened = async (extra) => {
  const { Send } = await load("kanso-send/main.js", ["Send"], { ...host(), ...extra });
  const send = Object.assign(new Send(), {
    from: { terminal: "t1", pane: "p1" }, to: null, toProject: null, text: "Review the changes.", error: null, sending: false, missed: [],
    handle: {}, query: field(""), box: field("Review the changes.", true),
  });
  return send;
};

test("a live agent on another computer is listed and can be chosen", async () => {
  const terms = [agent("t1", "local"), agent("box/t9", "far")];
  const send = await opened({ terminals: () => terms, panes: () => [] });
  send.to = "t1";
  const el = send.render();
  assert.ok(texts(el).includes("far"), texts(el).join(" | "));
  assert.equal(texts(el).includes("No other agent is running. Start one in a pane, then send."), false, "a live agent is not an empty roster");
  calls(nodes(el).find((kid) => kid.tag === "to-box/t9"), "on_click").forEach(([, fn]) => fn({}, { notify() {} }));
  assert.equal(send.to, "box/t9");
});

test("the first target stays when that agent is on another computer", async () => {
  const panes = [pane("p1", "t1"), pane("p2", "box/t9")];
  const { targetsOf, everyone } = await load("kanso-send/main.js", ["targetsOf", "everyone"], host());
  assert.equal(targetsOf(panes, "p1", null)[0].terminal, "box/t9");
  const send = await opened({
    terminals: () => [agent("t1", "local"), agent("box/t9", "far")],
    panes: () => panes,
  });
  send.to = "box/t9";
  send.render();
  assert.equal(send.to, "box/t9");
  assert.equal(everyone([{ address: "box/t9", state: "live", status: "idle", labels: {} }], [], { from: "t1" })[0].agents[0].terminal, "box/t9");
});

test("a send that never settles names that agent, says it did not confirm, and Send can be used again", async () => {
  const timers = [];
  const { cx, pending } = timedContext(timers);
  const send = await opened({
    hc: () => new Promise(() => {}),
    terminals: () => [agent("box/t9", "far")],
    panes: () => [],
  });
  send.to = "box/t9";
  send.send(cx, [{ project: "App", agents: [{ terminal: "box/t9", name: "far", status: "idle" }] }]);
  assert.equal(send.sending, true);
  assert.ok(timers.some(([ms]) => ms > 0), "the host call has a deadline");
  timers.forEach(([, fn]) => fn());
  await pending[0];
  assert.equal(send.sending, false);
  assert.match(send.error, /far/);
  assert.match(send.error, /delivery did not confirm/);
  const el = send.render();
  assert.match(texts(el).join("\n"), /delivery did not confirm/i);
  const primary = nodes(el).find((kid) => kid.tag === "kanso-send-primary");
  assert.equal(calls(primary, "disabled").at(-1)[1], false);
  assert.equal(calls(primary, "spin").length, 0);
});

test("a batch names the recipients that failed and does not wait on a label that never settles", { timeout: 3000 }, async () => {
  const timers = [];
  const { cx, pending } = timedContext(timers);
  const send = await opened({
    hc: async (args) => {
      if (args[0] === "label") return new Promise(() => {});
      if (args[1] === "t-bad") return { code: 1, stderr: "refused" };
      return { code: 0, stdout: "", stderr: "" };
    },
    terminals: () => [],
    panes: () => [],
  });
  const agents = [
    { terminal: "t-bad", name: "Nova", status: "idle" },
    { terminal: "t-ok", name: "Atlas", status: "idle" },
  ];
  send.toProject = "App";
  send.send(cx, [{ project: "App", agents }]);
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await pending[0];
  assert.equal(send.sending, false);
  assert.match(send.error, /Nova/);
  assert.match(send.error, /refused/);
  assert.doesNotMatch(send.error, /Atlas/);
  assert.deepEqual(clone(send.missed), []);
});
