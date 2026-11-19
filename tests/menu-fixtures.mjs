import { readFileSync } from "node:fs";
import { load, clone, gpuiHost, drawingHost, popoverHost, CHROME_NIGHT, fieldWith } from "./helpers.mjs";
import { mountChrome } from "./mod-fixtures.mjs";

const TABLE = JSON.parse(readFileSync(new URL("../kanso/keys.json", import.meta.url), "utf8"));
export const BINDINGS = [...Object.entries(TABLE).flatMap(([section, keys]) => Object.entries(keys).map(([chord, action]) => ({ section, keys: chord, action }))),
  { section: "app", keys: "cmd-t", action: "tab.new" }, { section: "app", keys: "cmd-w", action: "tab.close" }];

export async function paneMenu({ pane = {}, terminal = {}, machine = null, agent = true, keys = [], parent = null, target = { pane: "p1", terminal: "T1" }, store = {} } = {}) {
  const info = { pane: "p1", tab: "t1", terminal: "T1", cwd: "/work/acme", name: "tests", ...(agent ? { status: "idle", program: { agent: true } } : {}), ...pane };
  const other = { pane: "p2", tab: "t1", terminal: "T2", status: "idle", program: { agent: true } };
  const closed = [], opened = [];
  const host = {
    ...drawingHost(), theme: () => CHROME_NIGHT, props: () => ({ target, overlay: "o1" }), keys: () => keys, window: () => ({ platform: "macos" }),
    panes: () => [info, other], terminals: () => [{ address: "T1", name: "tests", labels: {}, ...(parent ? { parent: parent.address } : {}), ...terminal }, ...(parent ? [parent] : [])], agents: () => (agent ? [{ address: "T1" }] : []),
    spaces: () => [{ id: "s1", machine, tabs: [{ id: "t1" }] }], shared: (key) => store[key] ?? null, setShared: () => {},
    run: (cmd) => closed.push(cmd), closeOverlay: () => closed.push("closeOverlay"), openOverlay: (spec) => opened.push(spec),
  };
  const { KansoMenu } = await load("kanso-menu/main.js", ["KansoMenu"], host);
  const view = new KansoMenu();
  view.init({}, { notify() {}, focus_handle: () => ({ focus() {} }) });
  return { view, closed, opened };
}

export const TABS = [
  { id: "t1", index: 1, name: "checkout", active: true, status: "working" },
  { id: "t2", index: 2, name: "cart-ui", active: false, status: "blocked" },
  { id: "t3", index: 3, name: "tests", active: false, status: "done" },
];

export async function tabBar({ tabs = TABS, machine = null, computers = [], panes = [], fails = null, keys = [], stored = {}, tree = null, buttons = false, exec = null } = {}) {
  const store = { "kanso.sim.tools": { ios: null }, ...stored }, ran = [], toasts = [], opened = [];
  const space = { id: "s1", active: true, machine, tabs: clone(tabs) };
  const host = {
    ...popoverHost(), ...(exec ? { exec } : {}),
    InputState: { new: fieldWith },
    theme: () => CHROME_NIGHT, spaces: () => [space], panes: () => panes, machines: () => computers, keys: () => keys, window: () => ({ platform: buttons ? "windows" : "macos", buttons }),
    layout: () => tree, home: () => "/home/me", shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
    run: (cmd, args) => { if (cmd === fails) throw new Error("refused"); ran.push([cmd, args]); }, notify: (note) => { toasts.push(note); }, openOverlay: (spec) => { opened.push(spec); },
  };
  const { Tabs, tokens } = await load("kanso-tabs/main.js", ["Tabs", "tokens"], host);
  const { W } = await load("kanso-tabs/ui.js", ["W"], gpuiHost());
  const { PENDING } = await load("kanso-tabs/ui-state.js", ["PENDING"], gpuiHost());
  const view = new Tabs();
  const cx = { stop_propagation() {}, notify() {}, timer: { after() {} } };
  return { view, cx, ran, toasts, opened, space, store, c: tokens(CHROME_NIGHT), W, PENDING };
}

export const FOOTER_NIGHT = { background: "#1b1b19", foreground: "#d8d4cb", chrome: "#161615", hover: "#232321", selected: "#2b2b28", dim: "#6b6860", muted: "#949086", blocked: "#d5674f", accent: "#c9a46a" };

export async function footer({ shared = {}, ready = null, bindings = [{ action: "kanso-tabs.settings", keys: "ctrl-shift-," }], updater = {}, agents = async () => [] } = {}) {
  const ran = [], overlays = [], installs = [], notices = [], lookups = [];
  const host = {
    ...popoverHost(),
    appHome: () => "/home/me/.config/herdr-app", notify: (notice) => { notices.push(notice); }, knownAgents: (options) => { lookups.push(options); return agents(options); },
    theme: () => FOOTER_NIGHT, props: () => ({ footer: true }), shared: (key) => shared[key] ?? null, setShared: () => {},
    run: (name, args) => { ran.push([name, args]); }, openOverlay: (spec) => { overlays.push(spec); return "o"; },
    updates: () => ({ app: { ready } }), keys: () => bindings, settings: () => ({ font_family: "Mono" }), window: () => ({ platform: "macos" }),
  };
  const view = await mountChrome(host);
  const kit = await load("kanso-chrome/ui.js", ["H", "G", "T", "SIDEBAR", "PANE", "SPIN"], host);
  view.updater = { available: () => null, busy: false, refused: () => null, install: (context) => installs.push(context), ...updater };
  return { view, ran, overlays, installs, notices, lookups, ...kit };
}
