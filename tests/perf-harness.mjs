// Real mod code with a fake clock, inert native elements and counted host boundaries.
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { load, exec as runFile, clone } from "./helpers.mjs";

export const PANEL_IDS = ["files", "pr", "preview", "shipped", "worktrees", "ports", "look", "find"];
const source = process.env.PERF_SOURCE_ROOT ? pathToFileURL(`${process.env.PERF_SOURCE_ROOT}/kanso/mods/`) : undefined;
export const loadMod = (file, names, host) => load(file, names, host, source);

function element() {
  const proxy = new Proxy({}, { get: (_target, key) => {
    if (key === "then") return undefined;
    if (key === "when") return (condition, apply) => condition ? apply(proxy) : proxy;
    if (key === "value") return () => "";
    if (key === "is_focused") return () => false;
    return () => proxy;
  } });
  return proxy;
}

export function fixture({ dir = "/fixture", blocked = false, quiet = null, working = 10 } = {}) {
  const state = { now: 1_000_000, project: 0, processes: [], reads: [], watches: [], timers: [], errors: [], inFlight: 0, layouts: [{ name: null, layout: "ready" }] };
  const shared = new Map();
  const projects = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, name: `Project ${i}`, folder: `/projects/p${i}`, machine: null,
    tabs: [{ id: `tab${i}`, name: "Main", active: true }] }));
  const list = Array.from({ length: 10 }, (_, i) => ({ address: `t${i}`, pane: `p${i}`, space: `s${i % 4}`, tab: `tab${i % 4}`, space_name: `Project ${i % 4}`,
    name: `Agent ${i}`, status: i < working ? "working" : "idle", app: "agent", seq: i, program: { agent: true, name: "Agent" }, focused: i === 0 }));
  const terms = list.map((a, i) => ({ address: a.address, state: "live", status: a.status, status_ms: state.now - 1000, created_ms: state.now - 2000 + i, pid: 100 + i, foreground: { pid: 200 + i, argv: ["claude"] },
    labels: { "kanso.id": `id${i}`, "kanso.shown": a.name, "kanso.project": a.space_name, "herdr.space": a.space }, program: a.program, title: a.name }));
  const ps = list.map((a, i) => ({ pane: a.pane, terminal: a.address, tab: a.tab, cwd: projects[i % 4].folder, status: a.status, program: a.program }));
  if (quiet === "sleeping") {
    shared.set("kanso.asleep", projects.map((p) => ({ id: `sleep-${p.id}`, from: `:${p.folder}`, spaceId: p.id, state: "asleep", saved: state.now,
      agents: list.filter((a) => a.space === p.id).map((a) => ({ terminal: a.address, resume: `session-${a.address}` })) })));
  }
  if (quiet === "off") {
    state.layouts = [{ name: "remote", layout: "unavailable" }];
    projects.forEach((p) => { p.machine = "remote"; });
    list.forEach((a) => { a.address = `remote/${a.address}`; });
    terms.forEach((t) => { t.address = `remote/${t.address}`; });
    ps.forEach((p) => { p.terminal = `remote/${p.terminal}`; });
  }
  shared.set("kanso.registry", projects.map((p) => ({ ...p, machine: p.machine ?? "", missing: false })));
  class Clock extends Date { static now() { return state.now; } }
  const pending = () => new Promise(() => {});
  const counted = async (command, args = [], options = {}) => {
    state.processes.push({ command, args, options, at: state.now });
    if (blocked) return pending();
    state.inFlight += 1;
    try {
      if (command === "sqlite3" || command === "mkdir") return await runFile(command, args, options);
      if (command === "ps") return { code: 0, stdout: terms.map((t, i) => `${200 + i} 1 00:01 agent`).join("\n"), stderr: "" };
      if (command === "hc") {
        if (args[0] === "label") {
          const term = terms.find((t) => t.address === args[1]);
          for (const pair of args.slice(2)) { const at = pair.indexOf("="); if (term) term.labels[pair.slice(0, at)] = pair.slice(at + 1); }
        }
        return { code: 0, stdout: JSON.stringify(args[0] === "get" ? terms.find((term) => term.address === args[1]) ?? {} : { machines: [] }), stderr: "" };
      }
      if (command === "git") return { code: 128, stdout: "", stderr: "not a git repository" };
      return { code: 0, stdout: "", stderr: "" };
    } finally { state.inFlight -= 1; }
  };
  const cx = {
    notify() { state.dirty = true; }, stop_propagation() {}, focus_handle: element,
    timer: {
      every(ms, fn) { const timer = { ms, fn, next: state.now + ms, every: true }; state.timers.push(timer); return element(); },
      after(ms, fn) { const timer = { ms, fn, next: state.now + ms, every: false }; state.timers.push(timer); return element(); },
    },
    spawn(fn) { const task = Promise.resolve(fn(cx)); task.catch((error) => state.errors.push(error)); return task; },
  };
  const storage = new Map();
  const factory = { new: element, vertical: element, markdown: element };
  const colors = new Proxy({}, { get: () => "#888888" });
  const host = {
    Date: Clock, div: element, svg: element, image: element, canvas: element, h_flex: element, v_flex: element, v_virtual_list: element,
    Button: factory, Toggle: factory, Input: factory, InputState: factory, Textarea: factory, TextareaState: factory, Editor: factory, EditorState: factory,
    VirtualListScrollHandle: factory, ScrollHandle: factory, Scrollbar: factory, Popover: factory, HoverCard: factory, TextView: factory,
    props: () => state.props ?? {}, theme: () => colors, settings: () => ({}), window: () => ({ active: true, platform: "macos" }),
    spaces: () => clone(projects.map((p, i) => ({ ...p, active: i === state.project }))), panes: () => clone(ps), agents: () => clone(list), terminals: () => clone(terms),
    machines: () => clone(state.layouts), focused: () => ({ space: `s${state.project}`, tab: `tab${state.project}`, terminal: list[state.project].address, cwd: projects[state.project].folder }),
    shared: (key) => clone(shared.get(key) ?? null), setShared: (key, value) => { if (JSON.stringify(value) !== JSON.stringify(shared.get(key))) state.dirty = true; shared.set(key, clone(value)); },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    exec: counted, hc: (args) => counted("hc", args), appHome: () => dir, home: () => "/home/fixture",
    readTextFile: (file) => { state.reads.push({ file, at: state.now }); return blocked ? pending() : Promise.resolve(""); },
    watchFolder: (file) => { state.watches.push(file); return pending(); }, nextCommand: pending,
    layout: () => ({ id: "root", children: [{ id: "sidebar" }, { id: "work-body", children: [{ id: "main", content: { tab: "active" } }, { id: "panel-body", hidden: true, children: [] }] }, { id: "strip-map" }] }),
    run() {}, openOverlay() {}, closeOverlay() {}, notify() {}, setAgentOrder() {}, fetch: async () => ({ ok: false, status: 503 }),
  };
  const settle = async () => {
    for (let idle = 0, turns = 0; idle < 4 && turns < 3000; turns += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (state.dirty && state.draw) { state.dirty = false; state.draw(); }
      idle = state.inFlight || state.dirty && state.draw ? 0 : idle + 1;
    }
    if (state.inFlight) throw new Error(`performance harness has ${state.inFlight} unfinished host calls`);
    if (state.errors.length) throw state.errors[0];
  };
  const advance = async (ms) => {
    const end = state.now + ms;
    while (state.timers.some((timer) => timer.next <= end)) {
      const next = Math.min(...state.timers.map((timer) => timer.next));
      state.now = next;
      for (const timer of state.timers.filter((timer) => timer.next === next)) {
        timer.next = timer.every ? next + timer.ms : Infinity;
        timer.fn(cx);
      }
      await settle();
    }
    state.now = end;
  };
  return { state, host, cx, shared, projects, list, terms, ps, settle, advance };
}

export async function firstDraw(id) {
  const f = fixture({ blocked: true });
  const start = performance.now();
  const isPanel = PANEL_IDS.includes(id);
  const names = { spaces: ["kanso-spaces/main.js", "Spaces"], tabs: ["kanso-tabs/main.js", "Tabs"], strip: ["kanso-strip/main.js", "Strip"] };
  const [file, name] = isPanel ? ["kanso-panel/main.js", "PANELS"] : names[id];
  const mod = await loadMod(file, [name], f.host);
  const moduleMs = performance.now() - start;
  const draw = () => {
    const opened = performance.now();
    const view = new (isPanel ? mod.PANELS[id] : mod[name])();
    f.state.props = isPanel ? { panel: id, ...(id === "preview" ? { path: "/projects/p0/README.md" } : {}) } : {};
    if (isPanel) view.init(f.cx, f.state.props); else view.init(f.state.props, f.cx);
    view.render(f.cx);
    return { ms: performance.now() - opened, processes: f.state.processes.length, database: f.state.processes.filter((p) => p.command === "sqlite3").length, files: f.state.reads.length, timers: f.state.timers.length };
  };
  const open = draw();
  f.state.project = 1;
  f.state.processes.length = 0; f.state.reads.length = 0; f.state.timers.length = 0;
  const switchProject = draw();
  return { id, moduleMs, open, switchProject };
}
