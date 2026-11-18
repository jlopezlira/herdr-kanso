// Shared by the sidebar tests: elements that record what the sidebar draws, the host it draws in, and its state before a draw.
import { loadSpaces } from "./mod-fixtures.mjs";

export const SIDEBAR_THEME = { foreground: "#fff", muted: "#888", dim: "#666", chrome: "#111", hover: "#222", input: "#333", ansi2: "#0f0", blocked: "#c44", border: "#333", raised: "#222", accent: "#09f", popover: "#111", selected: "#222" };

const strings = (list) => (value) => { if (typeof value === "string") list.push(value); };
const forget = (record) => Object.keys(record).forEach((key) => delete record[key]);

// Elements that keep their ids, words, tooltips, icons, border lines and handlers: `on_x:id`, and `on_x:button:id` for a mouse button.
export function recorder() {
  const ids = [], texts = [], tips = [], icons = [], handlers = {}, lines = {};
  // A row's drop line: a child in the accent at its top (above) or its bottom (below).
  const drops = new WeakMap();
  const node = () => {
    let id = null;
    const edge = { top: false, bottom: false, accent: false };
    const keep = (prop, args) => {
      if (!id) return;
      handlers[`${prop}:${id}`] = args.at(-1);
      if (args.length > 1) handlers[`${prop}:${args[0]}:${id}`] = args.at(-1);
    };
    const lineOf = (kid) => {
      const at = drops.get(kid);
      if (id && at?.accent && at.top !== at.bottom) lines[id] = at.top ? "above" : "below";
    };
    const onCall = {
      id: (value) => { id = value; ids.push(value); },
      child: (value) => { strings(texts)(value); lineOf(value); },
      children: (list) => { [list].flat().forEach(lineOf); },
      tooltip: strings(tips),
      top_0: () => { edge.top = true; },
      bottom_0: () => { edge.bottom = true; },
      bg: (value) => { if (value === SIDEBAR_THEME.accent) edge.accent = true; },
    };
    const proxy = new Proxy(() => {}, {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        if (Object.hasOwn(onCall, prop)) return (...args) => { onCall[prop](...args); return proxy; };
        if (String(prop).startsWith("on_")) return (...args) => { keep(prop, args); return proxy; };
        return () => proxy;
      },
      apply: () => proxy,
    });
    drops.set(proxy, edge);
    return proxy;
  };
  const named = { new: (value) => (value ? node().id(value) : node()) };
  const host = { div: node, image: node, h_flex: node, v_flex: node, svg: (path) => { icons.push(path); return node(); }, Popover: named, Toggle: named, Button: named, Input: { new: node } };
  const clear = () => {
    [ids, texts, tips, icons].forEach((list) => { list.length = 0; });
    [handlers, lines].forEach(forget);
  };
  return { node, host, ids, texts, tips, icons, handlers, lines, clear };
}

// Draws `view` now, and again on each call, from a clean record.
export const drawEachTime = (view, clear) => {
  const render = () => { clear(); view.render(); };
  render();
  return render;
};

// The sidebar's Spaces, drawing with `elements`, in a host that `over` changes.
export const loadSidebar = (elements, over = {}) => loadSpaces({
  ...elements, theme: () => SIDEBAR_THEME, shared: () => null, setShared: () => {},
  spaces: () => [], panes: () => [], agents: () => [], terminals: () => [], machines: () => [{ name: null, layout: "ready" }],
  run: () => {}, home: () => "/Users/me", props: () => ({}), openOverlay: () => {}, ...over,
});

export const world = (spaces, agents, panes, terminals) => ({
  InputState: { new: () => ({ on() {}, value: () => "", focus() {}, release() {} }) },
  spaces: () => spaces, agents: () => agents, panes: () => panes, terminals: () => terminals,
});

// A terminal at its prompt that keeps a conversation: what Herdr calls asleep once its tab is settled.
export const shell = (address, resume, name) => ({ address, state: "live", program: { shell: true }, labels: { "kanso.resume": resume, "kanso.name": name } });

// What a mounted sidebar holds before its first draw.
export const mountedState = (extra = {}) => ({
  view: "spaces", git: {}, shown: new Set(), born: {}, custom: {}, order: "updated", statusOrder: "latest", threadOrder: "said", threadGroup: false,
  machines: [], parked: [], folded: new Set(), agentsFolded: new Set(), sectionsFolded: new Set(), shelvesOpen: new Set(),
  waking: new Set(), login: new Set(), failed: new Set(), powerBusy: new Set(), hints: {}, hoverSpace: null, hoverRow: null,
  handle: { is_focused: () => false, focus() {} }, hostName: "macbook", sync: { config: {}, status: {} },
  panel: { set() {}, agents: new Map() }, threads: null, tasks: {}, steps: {}, since: {}, foldH: {}, folding: null,
  pressed: null, over: null, alive: null, ...extra,
});
