// Shared by the menu tests: the pane menu and the tab bar, each drawn by its real view against a fake Herdr.
import { load, clone, chain, gpuiHost, CHROME_NIGHT, fieldWith } from "./helpers.mjs";

// The pane menu, as Herdr mounts it for a right-click on pane p1; `target.piece` draws a piece's menu instead.
export async function paneMenu({ pane = {}, terminal = {}, machine = null, agent = true, keys = [], parent = null, target = { pane: "p1", terminal: "T1" }, store = {} } = {}) {
  const info = { pane: "p1", tab: "t1", terminal: "T1", cwd: "/work/acme", name: "tests", ...(agent ? { status: "idle", program: { agent: true } } : {}), ...pane };
  const other = { pane: "p2", tab: "t1", terminal: "T2", status: "idle", program: { agent: true } };
  const closed = [], opened = [];
  const host = {
    ...gpuiHost(), theme: () => CHROME_NIGHT, props: () => ({ target, overlay: "o1" }), keys: () => keys, window: () => ({ platform: "macos" }),
    panes: () => [info, other], terminals: () => [{ address: "T1", name: "tests", labels: {}, ...(parent ? { parent: parent.address } : {}), ...terminal }, ...(parent ? [parent] : [])], agents: () => (agent ? [{ address: "T1" }] : []),
    spaces: () => [{ id: "s1", machine, tabs: [{ id: "t1" }] }], shared: (key) => store[key] ?? null, setShared: () => {},
    run: (cmd) => closed.push(cmd), closeOverlay: () => closed.push("closeOverlay"), openOverlay: (spec) => opened.push(spec),
  };
  const { KansoMenu } = await load("kanso-menu/main.js", ["KansoMenu"], host);
  const view = new KansoMenu();
  view.init({}, { notify() {}, focus_handle: () => ({ focus() {} }) });
  return { view, closed };
}

export const TABS = [
  { id: "t1", index: 1, name: "checkout", active: true, status: "working" },
  { id: "t2", index: 2, name: "cart-ui", active: false, status: "blocked" },
  { id: "t3", index: 3, name: "tests", active: false, status: "done" },
];

// One bar, drawn by the real view against a fake Herdr; `space.tabs` is what Herdr reports now.
export async function tabBar({ tabs = TABS, machine = null, computers = [], panes = [], fails = null } = {}) {
  const store = {}, ran = [], toasts = [], opened = [];
  const space = { id: "s1", active: true, machine, tabs: clone(tabs) };
  const host = {
    ...gpuiHost(), Popover: { new: (id) => chain(id) },
    InputState: { new: fieldWith },
    theme: () => CHROME_NIGHT, spaces: () => [space], panes: () => panes, machines: () => computers,
    layout: () => null, home: () => "/home/me", shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
    run: (cmd, args) => { if (cmd === fails) throw new Error("refused"); ran.push([cmd, args]); }, notify: (note) => { toasts.push(note); }, openOverlay: (spec) => { opened.push(spec); },
  };
  const { Tabs, tokens, W } = await load("kanso-tabs/main.js", ["Tabs", "tokens", "W"], host);
  const { PENDING } = await load("kanso-tabs/ui-state.js", ["PENDING"], gpuiHost());
  const view = new Tabs();
  const cx = { stop_propagation() {}, notify() {}, timer: { after() {} } };
  return { view, cx, ran, toasts, opened, space, c: tokens(CHROME_NIGHT), W, PENDING };
}
