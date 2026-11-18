// A subagent under an agent opens the same Session menu as the agent, with only the rows that act on it.
import test from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, mountedState, recorder, world } from "./sidebar-fixtures.mjs";

const SPACES = [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs: [{ id: "tb0", name: "Main", index: 0, active: true }] }];
const AGENTS = [
  { address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "fury", status: "working", name: "J", seq: 1 },
  { address: "t9", pane: "p9", tab: "tb0", space: "sp1", space_name: "fury", status: "idle", name: "Kay", seq: 2 },
];
const PANES = [{ pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/fury", branch: "main" }, { pane: "p9", tab: "tb0", terminal: "t9", cwd: "/Users/me/fury" }];
const TERMINALS = [
  { address: "t0", state: "live", program: { agent: true }, labels: {} },
  { address: "t9", state: "live", program: { agent: true }, labels: {}, parent: "t0" },
  { address: "s1", state: "live", status: "working", program: { agent: true }, name: "Zed", labels: {}, parent: "t0" },
];
const VIEWS = ["spaces", "agents"];

async function sidebar(menu = null) {
  const el = recorder(), opened = [];
  const { Spaces } = await loadSidebar(el.host, {
    ...world(SPACES, AGENTS, PANES, TERMINALS),
    props: () => (menu ? { menu, overlay: "o" } : {}), openOverlay: (o) => opened.push(o.props.menu.address), closeOverlay: () => {},
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(["sp1"]), armed: { is: () => false }, menuAt: -1 }));
  return { el, view, opened };
}

const rightClick = (el, address) => el.handlers[`on_mouse_down:right:space-agent-${address}`];

for (const name of VIEWS) {
  test(`In ${name === "spaces" ? "Projects" : "Status"}, a right click on a subagent opens the Session menu for it, as on its parent`, async () => {
    const { el, view, opened } = await sidebar();
    view.view = name;
    view.render();
    for (const address of ["t0", "t9", "s1"]) {
      const press = rightClick(el, address);
      assert.ok(press, `${address} takes a right click`);
      press({}, { stop_propagation() {} });
    }
    assert.deepEqual(opened, ["t0", "t9", "s1"]);
  });
}

const ACTIONS = ["Open", "Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Copy", "Sleep this agent", "Sleep its tab", "Close agent", "Close terminal"];

const menuRows = async (address) => {
  const { el, view } = await sidebar({ address, view: "spaces" });
  view.render();
  return el.texts;
};

test("A subagent with no pane of its own is offered Rename, Pin, Settle, Mark read, Snooze, Move and Close, and no Open, Copy or Sleep, which its parent is", async () => {
  const parent = await menuRows("t0"), child = await menuRows("s1");
  for (const row of ["Open", "Copy", "Sleep this agent", "Sleep its tab"]) {
    assert.ok(parent.includes(row), `the parent offers ${row}`);
    assert.ok(!child.includes(row), `the subagent does not offer ${row}`);
  }
  const offered = child.filter((text) => ACTIONS.includes(text));
  assert.deepEqual(offered, ["Rename…", "Pin to the top", "Settle", "Mark unread", "Snooze", "Move to project", "Close terminal"]);
});

test("A subagent in a pane of its own is offered the rows its pane gives, as any agent is", async () => {
  const child = await menuRows("t9");
  for (const row of ["Open", "Copy", "Sleep this agent", "Sleep its tab"]) assert.ok(child.includes(row), `it offers ${row}`);
});
