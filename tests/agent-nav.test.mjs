// Moving between agents by keyboard: the sidebar's row above or below, and back and forward through the agents visited.
import { loadDescribe } from "./mod-fixtures.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, clone } from "./helpers.mjs";

const project = (id, tabs, machine = null) => ({ id, name: id, folder: `/work/${id}`, machine, active: id === "one", tabs: tabs.map((tab) => ({ id: tab })) });
const agent = (address, space, tab, extra = {}) => ({ address, pane: `p-${address}`, tab, space, space_name: space, status: "idle", program: { agent: true, name: "Claude Code" }, title: address, seq: 1, ...extra });

async function sidebar(agents, { collapsed = false, folded = [], view = "spaces", spaces = [project("one", ["t1", "t2"]), project("two", ["t3"])] } = {}) {
  const state = { agents, calls: [] };
  const { Spaces } = await loadSidebar(recorder().host, {
    shared: (key) => (key === "sidebar.collapsed" ? collapsed : null),
    spaces: () => spaces, agents: () => state.agents,
    machines: () => [{ name: null, layout: "ready" }, { name: "m2", layout: "ready" }], run: (cmd, args) => state.calls.push([cmd, clone(args ?? null)]),
    window: () => ({ platform: "macos", active: true }),
    focused: () => ({ terminal: state.agents.find((a) => a.focused)?.address ?? null }),
  });
  const mount = () => Object.assign(new Spaces(), mountedState({ shown: new Set(spaces.map((s) => s.id)), agentsFolded: new Set(folded), view }));
  const s = { view: mount(), state };
  const cx = { notify() {}, stop_propagation() {}, timer: { after() {} } };
  // Focus moves and the sidebar's focus watch sees it; nothing is drawn.
  s.focus = (address) => { state.agents = state.agents.map((a) => ({ ...a, focused: a.address === address })); s.view.trackFocus(); };
  s.press = (command) => {
    const before = state.calls.length;
    s.view.command(command, cx);
    const sent = state.calls.slice(before);
    const to = sent.map(([, args]) => args?.pane ?? args?.terminal).find(Boolean);
    if (to) s.focus(state.agents.find((a) => a.pane === to || a.address === to).address);
    return sent;
  };
  s.here = () => state.agents.find((a) => a.focused)?.address ?? null;
  s.remount = () => { s.view = mount(); };
  return s;
}

const three = () => [agent("x", "one", "t1"), agent("y", "one", "t2"), agent("z", "two", "t3")];
// Two visits: a1, then a8.
const visited = async () => {
  const s = await sidebar(eight());
  s.focus("a1");
  s.focus("a8");
  return s;
};
const backAndForth = (s, back, forward) => {
  s.press("agent-back");
  assert.equal(s.here(), back);
  s.press("agent-forward");
  assert.equal(s.here(), forward);
};
const upTwiceTo = (s, address) => {
  s.press("agent-up");
  s.press("agent-up");
  assert.equal(s.here(), address);
};
const eight = () => ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].map((a, i) => agent(a, i < 6 ? "one" : "two", i < 3 ? "t1" : i < 6 ? "t2" : "t3"));

test("Cmd+Shift+Up and Down go to the agent above and below in the sidebar, across tabs and projects, as a click on its row", async () => {
  const s = await sidebar(three());
  s.focus("x");
  assert.deepEqual(s.press("agent-down"), [["pane.focus", { pane: "p-y" }]], "the next tab's agent, opened as its row's click");
  assert.equal(s.here(), "y");
  s.press("agent-down");
  assert.equal(s.here(), "z", "on into the next project");
  assert.deepEqual(s.press("agent-down"), [], "the last row stays where it is");
  upTwiceTo(s, "x");
  assert.deepEqual(s.press("agent-up"), [], "the first row stays where it is");
});

test("Back and forward walk the agents visited: on 1, a jump to 8, Left goes back to 1 and Right forward to 8", async () => {
  const s = await visited();
  backAndForth(s, "a1", "a8");
  s.press("agent-back");
  assert.equal(s.here(), "a1", "going back twice in a row lands the same");
});

test("With nothing back or forward, the keys leave you where you are", async () => {
  const s = await sidebar(eight());
  assert.deepEqual(s.press("agent-back"), [], "no visits yet");
  s.focus("a3");
  assert.deepEqual(s.press("agent-back"), [], "one visit: nothing back");
  assert.deepEqual(s.press("agent-forward"), [], "nothing forward");
  s.focus("a5");
  s.press("agent-back");
  assert.deepEqual(s.press("agent-back"), [], "at the first visit");
  assert.equal(s.here(), "a3");
  s.press("agent-forward");
  assert.deepEqual(s.press("agent-forward"), [], "at the last visit");
  assert.equal(s.here(), "a5");
});

test("A new visit after going back drops the agents ahead, as a browser does", async () => {
  const s = await visited();
  s.press("agent-back");
  s.press("agent-down");
  assert.equal(s.here(), "a2", "a key that reaches an agent is a visit too");
  assert.deepEqual(s.press("agent-forward"), [], "a8 is no longer ahead");
  backAndForth(s, "a1", "a2");
});

test("A closed agent is passed over on the way back", async () => {
  const s = await sidebar(eight());
  s.focus("a1");
  s.focus("a4");
  s.focus("a8");
  s.state.agents = s.state.agents.filter((a) => a.address !== "a4");
  s.press("agent-back");
  assert.equal(s.here(), "a1");
});

test("Up and Down reach every agent with the sidebar folded to its rail and a project folded", async () => {
  const s = await sidebar(three(), { collapsed: true, folded: ["one"] });
  s.focus("x");
  s.press("agent-down");
  assert.equal(s.here(), "y", "inside the folded project");
  s.press("agent-down");
  assert.equal(s.here(), "z");
  upTwiceTo(s, "x");
});

test("Up and Down follow the Status view's order when it is the sidebar's view", async () => {
  const s = await sidebar([agent("x", "one", "t1"), agent("y", "one", "t2", { status: "blocked" }), agent("z", "two", "t3")], { view: "agents", collapsed: true });
  s.focus("y");
  s.press("agent-down");
  assert.equal(s.here(), "x", "Needs you first, then the idle ones");
  assert.deepEqual(s.press("agent-up").length, 1);
  assert.equal(s.here(), "y");
  assert.deepEqual(s.press("agent-up"), [], "y heads the list");
});

test("A focus change counts as a visit without the sidebar drawing, and the visits outlive the sidebar mounted again", async () => {
  const s = await visited();
  s.remount();
  backAndForth(s, "a1", "a8");
});

test("Up and Down keep the sidebar's computers: this one's projects first, then another computer's", async () => {
  const spaces = [project("one", ["t1"]), project("far", ["t9"], "m2"), project("two", ["t3"])];
  const s = await sidebar([agent("x", "one", "t1"), agent("m2/r", "far", "t9"), agent("z", "two", "t3")], { spaces });
  s.focus("x");
  s.press("agent-down");
  assert.equal(s.here(), "z", "this computer's next project before the other computer");
  s.press("agent-down");
  assert.equal(s.here(), "m2/r");
  assert.deepEqual(s.press("agent-down"), [], "the other computer's agent is the last");
});

test("Off the list, Down goes to the first agent and Up to the last", async () => {
  const s = await sidebar(three());
  s.focus(null);
  s.press("agent-down");
  assert.equal(s.here(), "x");
  s.focus(null);
  s.press("agent-up");
  assert.equal(s.here(), "z");
});

test("The four keys are bound on macOS and Windows, and Help and the Keys page name them", async () => {
  const keys = (file) => JSON.parse(readFileSync(new URL(`../kanso/${file}`, import.meta.url), "utf8"))["layout:kanso"];
  const actions = ["kanso-spaces.agent-up", "kanso-spaces.agent-down", "kanso-spaces.agent-back", "kanso-spaces.agent-forward"];
  const mac = keys("keys.json"), win = keys("keys.windows.json");
  assert.deepEqual(["cmd-shift-up", "cmd-shift-down", "cmd-shift-left", "cmd-shift-right"].map((k) => mac[k]), actions);
  assert.deepEqual(["ctrl-shift-up", "ctrl-shift-down", "ctrl-shift-left", "ctrl-shift-right"].map((k) => win[k]), actions);
  const { describe } = await loadDescribe();
  assert.deepEqual(clone(actions.map(describe)), ["Agent above", "Agent below", "Back through the agents visited", "Forward through the agents visited"]);
  const { GROUPS } = await load("kanso-settings/actions.js", ["GROUPS"]);
  const rows = GROUPS.flatMap((g) => g.actions).filter((r) => actions.includes(r.action));
  assert.deepEqual(clone(rows.map((r) => r.label)), clone(actions.map(describe)));
});
