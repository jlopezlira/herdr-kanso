// Dragging a project row in the sidebar: where it shows it lands, and where it moves.
import { drawEachTime, loadSidebar, mountedState, withParts, recorder } from "./sidebar-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { clone } from "./helpers.mjs";

const space = (id, extra = {}) => ({ id, name: id, folder: `/Users/me/${id}`, machine: null, tabs: [], ...extra });

async function draw(list, extra = {}) {
  const { host, handlers, lines, clear } = recorder();
  const runs = [];
  const { Spaces } = await loadSidebar(host, {
    spaces: () => list, machines: () => [{ name: null, layout: "ready" }, { name: "m2", layout: "ready" }],
    run: (cmd, args) => runs.push([cmd, args]),
  });
  const view = withParts(Object.assign(new Spaces(), mountedState({
    shown: new Set(list.map((w) => w.id)), machines: [{ name: "m2", state: "connected" }],
    threadGroup: true, armed: { is: () => false }, ...extra,
  })));
  const render = drawEachTime(view, clear);
  const press = (id) => { handlers[`on_mouse_down:left:space-${id}`]({ click_count: 1 }, cx); render(); };
  const move = (id) => { handlers[`on_mouse_move:space-${id}`]?.({}, cx); render(); };
  const release = (id) => { handlers[`on_mouse_up:left:space-${id}`]({}, cx); render(); };
  return { view, handlers, lines, render, runs, press, move, release };
}

const cx = { stop_propagation() {}, notify() {} };
// c held over a, the first of three.
const heldOverFirst = async () => {
  const d = await draw([space("a"), space("b"), space("c")]);
  d.press("c");
  d.move("a");
  return d;
};
const letGo = (d) => {
  assert.equal(d.view.pressed, null);
  assert.equal(d.view.over, null);
};
const moves = (runs) => clone(runs.filter(([cmd]) => cmd === "space.move"));

test("a project held over another shows a line where it will land", async () => {
  const d = await heldOverFirst();
  assert.equal(d.lines["space-a"], "above", "held from below, it lands above");
  assert.equal(d.lines["space-c"], undefined, "the held row itself shows nothing");
  d.release("a");
  d.press("a");
  d.move("c");
  assert.equal(d.lines["space-c"], "below", "held from above, it lands below");
});

test("a project dropped on another moves by its id to that project's place, with a computer turned off", async () => {
  const list = [space("a"), space("x", { machine: "m1" }), space("y", { machine: "m2" }), space("z", { machine: "m2" })];
  const d = await draw(list, { parked: [{ name: "m1" }] });
  d.press("z");
  d.move("y");
  d.release("y");
  assert.deepEqual(moves(d.runs), [["space.move", { id: "z", index: 3 }]]);
  letGo(d);
});

test("a project dropped on another computer's project stays where it is", async () => {
  const d = await draw([space("a"), space("y", { machine: "m2" })]);
  d.press("a");
  d.move("y");
  assert.equal(d.lines["space-y"], undefined, "nothing is marked on another computer");
  d.release("y");
  assert.deepEqual(moves(d.runs), []);
});

test("a worktree drawn under its checkout neither starts a drag nor takes a drop", async () => {
  const key = (folder) => JSON.stringify([null, folder]);
  const git = { [key("/Users/me/main")]: { repo: "/r", name: "r", branch: "main", linked: false }, [key("/Users/me/wt")]: { repo: "/r", name: "r", branch: "wt", linked: true } };
  const d = await draw([space("main"), space("other"), space("wt")], { git });
  d.press("wt");
  assert.equal(d.view.pressed, null, "a press on the worktree holds nothing");
  d.move("other");
  d.release("other");
  d.press("other");
  d.move("wt");
  assert.equal(d.lines["space-wt"], undefined);
  d.release("wt");
  assert.deepEqual(moves(d.runs), []);
  d.press("wt");
  d.release("wt");
  assert.deepEqual(clone(d.runs.filter(([cmd]) => cmd === "space.select")), [["space.select", { id: "wt" }]], "its click still selects it; a press let go on another row selects neither");
});

test("a project released anywhere else is let go", async () => {
  const d = await heldOverFirst();
  assert.equal(d.lines["space-a"], "above");
  d.handlers["on_mouse_up:left:spaces-list-spaces"]({}, cx);
  d.render();
  letGo(d);
  assert.equal(d.lines["space-a"], undefined);
  assert.deepEqual(moves(d.runs), []);
});
