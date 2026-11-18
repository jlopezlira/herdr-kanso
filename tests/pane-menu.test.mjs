// The pane's right-click menu as the Storybook draws it: its title, the groups in order, a check for the program's right click, and Close that asks twice with an agent.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, texts, calls, find, CHROME_NIGHT } from "./helpers.mjs";

async function menu({ pane = {}, terminal = {}, machine = null, agent = true } = {}) {
  const info = { pane: "p1", tab: "t1", terminal: "T1", cwd: "/work/acme", name: "tests", ...(agent ? { status: "idle", program: { agent: true } } : {}), ...pane };
  const other = { pane: "p2", tab: "t1", terminal: "T2", status: "idle", program: { agent: true } };
  const closed = [], opened = [];
  const host = {
    ...gpuiHost(), theme: () => CHROME_NIGHT, props: () => ({ target: { pane: "p1", terminal: "T1" }, overlay: "o1" }), keys: () => [],
    panes: () => [info, other], terminals: () => [{ address: "T1", name: "tests", labels: {}, ...terminal }], agents: () => (agent ? [{ address: "T1" }] : []),
    spaces: () => [{ id: "s1", machine, tabs: [{ id: "t1" }] }], shared: () => null, setShared: () => {},
    run: (cmd) => closed.push(cmd), closeOverlay: () => closed.push("closeOverlay"), openOverlay: (spec) => opened.push(spec),
  };
  const { KansoMenu } = await load("kanso-menu/main.js", ["KansoMenu"], host);
  const view = new KansoMenu();
  view.init({}, { notify() {}, focus_handle: () => ({ focus() {} }) });
  return { view, closed };
}

test("The menu names the pane, then keeps the story's groups in order", async () => {
  const { view } = await menu();
  const words = texts(view.render());
  const at = (label) => words.indexOf(label);
  assert.equal(words[0], "tests");
  for (const [a, b] of [["Split right", "Split down"], ["Split down", "Split left"], ["Split left", "Wider or narrower"], ["Wider or narrower", "Pin"], ["Pin", "Send to an agent…"],
    ["Send to an agent…", "Find in conversation"], ["Find in conversation", "Open with…"], ["Open with…", "Sleep"], ["Sleep", "Right-clicks go to the program"], ["Right-clicks go to the program", "Close pane"]]) {
    assert.ok(at(a) >= 0 && at(b) > at(a), `${a} comes before ${b}`);
  }
});

test("A pane on another computer carries its name in the title, and one with no agent has no Send, Find or Sleep", async () => {
  const { view } = await menu({ machine: "devbox", agent: false });
  const words = texts(view.render());
  assert.equal(words[0], "tests · devbox");
  for (const gone of ["Send to an agent…", "Find in conversation", "Sleep"]) assert.ok(!words.includes(gone), gone);
});

test("Close asks twice with an agent in the pane and once without", async () => {
  const cx = { notify() {}, timer: { after() {} } };
  const press = (m) => {
    const row = find(m.view.render(), (el) => calls(el, "accessibility_label").some((call) => /close/i.test(call[1])));
    calls(row, "on_click").at(-1)[1]({}, cx);
  };
  const withAgent = await menu();
  press(withAgent);
  assert.ok(!withAgent.closed.includes("pane.close"), "the first press only arms");
  assert.ok(texts(withAgent.view.render()).some((word) => /Press again to close tests/.test(word)));
  press(withAgent);
  assert.ok(withAgent.closed.includes("pane.close"));
  const plain = await menu({ agent: false });
  press(plain);
  assert.ok(plain.closed.includes("pane.close"));
});
