// Dragging a project row in the sidebar: where it shows it lands, and where it moves.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const theme = { foreground: "#fff", muted: "#888", dim: "#666", blocked: "#c44", input: "#222", accent: "#09f", chrome: "#111", hover: "#222", ansi2: "#0f0", border: "#333", popover: "#111", selected: "#222" };

function recorder() {
  const handlers = {}, lines = {};
  const node = () => {
    let id = null;
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return undefined;
        if (prop === "id") return (x) => { id = x; return proxy; };
        if (prop === "on_mouse_up" || prop === "on_mouse_down") return (button, fn) => { if (id) handlers[`${prop}:${button}:${id}`] = fn; return proxy; };
        if (prop === "on_mouse_move" || prop === "on_hover") return (fn) => { if (id) handlers[`${prop}:${id}`] = fn; return proxy; };
        if (prop === "border_t" || prop === "border_b") return () => { if (id) lines[id] = prop === "border_t" ? "above" : "below"; return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        return () => proxy;
      },
    });
    return proxy;
  };
  const clear = () => { for (const o of [handlers, lines]) for (const k of Object.keys(o)) delete o[k]; };
  return { node, handlers, lines, clear };
}

const space = (id, extra = {}) => ({ id, name: id, folder: `/Users/me/${id}`, machine: null, tabs: [], ...extra });

async function draw(list, extra = {}) {
  const { node, handlers, lines, clear } = recorder();
  const runs = [];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Button: { new: node }, Popover: { new: node },
    theme: () => theme, shared: () => null, setShared: () => {}, spaces: () => list, panes: () => [], agents: () => [], terminals: () => [], machines: () => [{ name: null, layout: "ready" }, { name: "m2", layout: "ready" }],
    run: (cmd, args) => runs.push([cmd, args]), home: () => "/Users/me", openOverlay: () => {}, props: () => ({}),
  });
  const view = Object.assign(new Spaces(), {
    view: "spaces", git: {}, shown: new Set(list.map((w) => w.id)), born: {}, custom: {}, order: "updated", machines: [{ name: "m2", state: "connected" }],
    folded: new Set(), agentsFolded: new Set(), tasks: {}, steps: {}, since: {}, foldH: {}, folding: null,
    pressed: null, over: null, hoverRow: null, hoverSpace: null, sectionsFolded: new Set(), shelvesOpen: new Set(),
    threadGroup: true, threadOrder: "said", statusOrder: "latest", threads: null, alive: null, armed: { is: () => false },
    waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(), hints: {}, sync: { config: {}, status: {} }, ...extra,
  });
  const render = () => { clear(); view.render(); };
  render();
  const press = (id) => { handlers[`on_mouse_down:left:space-${id}`]({ click_count: 1 }, cx); render(); };
  const move = (id) => { handlers[`on_mouse_move:space-${id}`]?.({}, cx); render(); };
  const release = (id) => { handlers[`on_mouse_up:left:space-${id}`]({}, cx); render(); };
  return { view, handlers, lines, render, runs, press, move, release };
}

const cx = { stop_propagation() {}, notify() {} };
const moves = (runs) => clone(runs.filter(([cmd]) => cmd === "space.move"));

test("a project held over another shows a line where it will land", async () => {
  const d = await draw([space("a"), space("b"), space("c")]);
  d.press("c");
  d.move("a");
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
  assert.equal(d.view.pressed, null);
  assert.equal(d.view.over, null);
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
  assert.deepEqual(clone(d.runs.filter(([cmd]) => cmd === "space.select")), [["space.select", { id: "other" }], ["space.select", { id: "wt" }]], "its click still selects it");
});

test("a project released anywhere else is let go", async () => {
  const d = await draw([space("a"), space("b"), space("c")]);
  d.press("c");
  d.move("a");
  assert.equal(d.lines["space-a"], "above");
  d.handlers["on_mouse_up:left:spaces-list-spaces"]({}, cx);
  d.render();
  assert.equal(d.view.pressed, null);
  assert.equal(d.view.over, null);
  assert.equal(d.lines["space-a"], undefined);
  assert.deepEqual(moves(d.runs), []);
});
