// Shared by the tests: load a mod's real source into a fake Herdr host.
import { execFile, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { bannedGlobals } from "../scripts/herdr-api.mjs";
import { modScript } from "../scripts/mod-source.mjs";

const runFile = promisify(execFile);
export const fileExists = (path) => access(path).then(() => true, () => false);
// A file of this repository as text.
export const repoText = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
// Each Storybook composition a mod draws is copied into it byte for byte.
export const sameCopies = (names, mod = "kanso-spaces") => {
  for (const name of names) assert.equal(repoText(`kanso/mods/${mod}/${name}.js`), repoText(`stories/kit/${name}.js`), name);
};
// An SVG's shapes as [tag, attributes], the form of tests/fixtures/lucide-icons.json.
export const svgShapes = (markup) => [...markup.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/?>/g)]
  .map(([, tag, attrs]) => [tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))]);
const api = JSON.parse(readFileSync(new URL("./herdr-api.json", import.meta.url), "utf8"));
export { api as herdrApi };
const declaredNames = (mod) => api.modules[mod] ?? [];
const HERDR_MODULES = {
  "fs/promises": declaredNames("fs/promises"),
  net: declaredNames("net").filter((name) => name !== "default"),
  websocket: declaredNames("websocket"),
};
export function bindHerdrModules(text) {
  return text.replace(/^import\s+(?:(\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']([^"']+)["'];[ \t]*(?:\r?\n|$)/gm, (full, clause, from) => {
    if (from.startsWith(".")) return full;
    const declared = api.modules[from];
    if (!declared) throw new Error(`Could not find module '${from}'`);
    if (!clause) return HERDR_MODULES[from] ? "" : full;
    if (clause.startsWith("*")) {
      if (!HERDR_MODULES[from]) return full;
      return `const ${clause.match(/\*\s+as\s+(\w+)/)[1]} = __herdrModule(${JSON.stringify(from)});\n`;
    }
    if (!clause.startsWith("{")) {
      if (!declared.includes("default") || (HERDR_MODULES[from] && from !== "net")) throw new Error(`Could not find export 'default' in module '${from}'`);
      if (!HERDR_MODULES[from]) return full;
      return `const ${clause} = __herdrModule(${JSON.stringify(from)});\n`;
    }
    const specs = clause.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [orig, alias] = part.split(/\s+as\s+/).map((name) => name.trim());
      if (!declared.includes(orig)) throw new Error(`Could not find export '${orig}' in module '${from}'`);
      return alias ? `${orig}: ${alias}` : orig;
    });
    if (!HERDR_MODULES[from]) return full;
    return `const { ${specs.join(", ")} } = __herdrModule(${JSON.stringify(from)});\n`;
  });
}

const herdrModules = (host) => {
  const overlay = (name, base) => Object.freeze({
    ...base,
    ...Object.fromEntries(HERDR_MODULES[name].filter((key) => host[key] !== undefined).map((key) => [key, host[key]])),
  });
  return {
    "fs/promises": overlay("fs/promises", { readFile, writeFile, readdir, exists: fileExists, unlink, rmdir, mkdir }),
    net: overlay("net", { connect() { throw new Error("net.connect is not available to a mod"); } }),
    websocket: overlay("websocket", { WebSocket: { connect() { throw new Error("WebSocket.connect is not available to a mod"); } } }),
  };
};

export const clone = (value) => JSON.parse(JSON.stringify(value));
export const success = (stdout) => ({ code: 0, stdout, stderr: "" });
export const failure = (stderr, code = 1) => ({ code, stdout: "", stderr });
export const readOrNull = async (path) => { try { return await readFile(path, "utf8"); } catch { return null; } };
// What `base64 -D -i <in> -o <out>` does, as exec answers it.
export const isDecode = (cmd, args) => (cmd === "base64" || cmd === "/usr/bin/base64") && args[0] === "-D";
export const decoded = async (args) => {
  const text = await readFile(args[2], "utf8");
  await writeFile(args[4], Buffer.from(text.replace(/\s/g, ""), "base64"));
  return success("");
};
// What `mv <from> <to>` does, as exec answers it.
export const moved = async (args) => {
  await rename(args.at(-2), args.at(-1));
  return success("");
};
export const calls = (el, name) => el.calls.filter((call) => call[0] === name);
export const one = (el, name) => {
  const found = calls(el, name);
  assert.equal(found.length, 1, name);
  return found[0][1];
};
export const styled = (el, name) => {
  const style = chain();
  one(el, name)(style);
  return style.calls;
};
export const arg = (el, name) => calls(el, name).at(-1)?.[1];
export const find = (el, test) => (test(el) ? el : el.kids.map((kid) => find(kid, test)).find(Boolean) ?? null);
export const all = (el, test) => [...(test(el) ? [el] : []), ...el.kids.flatMap((kid) => all(kid, test))];
// A drawing as plain data: handlers compare by kind, since each draw makes new ones.
export const drawn = (el) => ({ tag: el.tag, calls: el.calls.map((call) => call.map((arg) => (typeof arg === "function" ? "handler" : arg?.calls ? "element" : arg))), kids: el.kids.map(drawn) });
export const nativePlatform = ({ darwin: "macos", win32: "windows" })[process.platform] ?? "linux";
export const nativeWindow = () => ({ platform: nativePlatform });
const mods = new URL("../kanso/mods/", import.meta.url);
const ban = (name) => {
  const fail = () => { throw new Error(`${name} is not available to a mod`); };
  return new Proxy(function banned() { fail(); }, { get: fail, apply: fail, construct: fail });
};

const vmNames = vm.runInContext("Object.getOwnPropertyNames(globalThis)", vm.createContext({}));
export const MOD_BANNED_GLOBALS = bannedGlobals(vmNames, api.globals);

// The mod runtime has none of these. Using one throws, even when a fixture passed the real one in.
export function modSandbox(host = {}) {
  const sandbox = vm.createContext({ ...host });
  for (const name of MOD_BANNED_GLOBALS) sandbox[name] = ban(name);
  return sandbox;
}

// Load the actual mod logic (its own-folder imports included) with the
// desktop host supplied by each fixture.
export async function load(file, names, host = {}, root = mods) {
  const dir = file.slice(0, file.lastIndexOf("/") + 1);
  const modules = herdrModules(host);
  const read = async (name) => bindHerdrModules(await readFile(new URL(name, root), "utf8"));
  // Siblings are read up front: the inliner is synchronous.
  const sources = new Map([[file, await read(file)]]);
  const pending = [file];
  while (pending.length) {
    const text = sources.get(pending.pop());
    for (const m of text.matchAll(/^(?:import\s+(?:\{[^}]*\}\s+from\s+)?|export\s+\{[^}]*\}\s+from\s+)["'](\.\/[^"']+)["'];/gm)) {
      const sibling = `${dir}${m[1].slice(2)}`;
      if (!sources.has(sibling)) { sources.set(sibling, await read(sibling)); pending.push(sibling); }
    }
  }
  const source = modScript(sources.get(file), (name) => sources.get(`${dir}${name.slice(2)}`));
  return vm.runInContext(`${source}\n;({ ${names.join(", ")} });`, modSandbox({ View: class {}, join, basename, shared() {}, setShared() {}, writeTextFile: (path, text) => writeFile(path, text, { flag: "wx" }), exec: async () => { throw new Error("Unexpected command in fixture"); }, window: host.exec === exec ? nativeWindow : () => ({ platform: "macos" }), layout: () => null, focused: () => null, panes: () => [], terminals: () => [], machines: () => [], keys: () => [], settings: () => ({}), ...host, __herdrModule: (name) => modules[name] }));
}

// Tests that watch real processes need ps; a sandbox that denies it skips them, saying so, rather than failing.
export const psMissing = (() => {
  try { execFileSync("ps", ["-p", String(process.pid), "-o", "comm="], { stdio: "pipe" }); return false; } catch { return "ps can't see processes here"; }
})();

const removeTree = async (dir) => {
  for (let tries = 1; ; tries += 1) {
    try {
      return await rm(dir, { recursive: true, force: true });
    } catch (error) {
      if (tries === 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, tries * 100));
    }
  }
};
const afterTheOtherCleanups = (t, fn) => t.after(() => t.after(fn));

export async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "kanso-test-"));
  afterTheOtherCleanups(t, () => removeTree(dir));
  return dir;
}

// Waits for a state real processes or files bring, never longer than exec's own limit.
export async function until(ready, limit = 30000) {
  const deadline = Date.now() + limit;
  do {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (await ready()) return;
  } while (Date.now() < deadline);
  throw new Error(`Still not true after ${limit} ms: ${ready}`);
}

// Herdr's exec, backed by the real programs, and like Herdr's it kills one that runs past its
// limit (30 s; `limit` in ms makes it shorter for a test).
export async function exec(command, args, options = {}) {
  try {
    const result = await runFile(command, args, { cwd: options.cwd, ...(options.env ? { env: options.env } : {}), maxBuffer: 4 * 1024 * 1024, timeout: options.limit ?? options.timeout ?? 30000, killSignal: "SIGKILL", windowsHide: true });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.killed ? 137 : error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
}

// A host whose shared state lives in `state` and whose layout is `tree()`, each read as a copy.
export const layoutHost = (state, tree, run) => ({
  shared: (key) => clone(state[key] ?? null), setShared: (key, value) => { state[key] = clone(value); },
  layout: () => clone(tree()), window: () => ({ platform: "macos" }), run,
});

// git in `cwd` as a test user, with `config` first; a failing git fails the test.
export const gitOk = (...config) => async (cwd, ...args) => {
  const r = await exec("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...config, ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

export const databaseTimer = { after(ms, fn) { const timer = setTimeout(fn, ms); timer.unref(); return { cancel: () => clearTimeout(timer) }; } };

export const openedKdb = async (Kdb) => {
  const db = new Kdb(databaseTimer);
  await db.open();
  return db;
};

// A view context whose timers wait in `timers` as [ms, fn] and whose spawned tasks can be awaited; `extra` adds to it.
export const timedContext = (timers, extra = {}) => {
  const pending = [];
  const cx = {
    notify() {}, ...extra,
    spawn(fn) { const p = fn(cx); pending.push(p); return { cancel() {} }; },
    timer: { every: () => ({ cancel() {} }), after: (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; } },
  };
  return { cx, pending, drain: async () => { while (pending.length) await pending.shift(); } };
};

// Elements that keep their children in order, every id and every word drawn.
const KIDS = Symbol("kids");
export const keeping = () => {
  const ids = [], words = [];
  const element = () => {
    const kids = [];
    const proxy = new Proxy(function el() {}, { get: (_target, method) => {
      if (method === KIDS) return kids;
      return (...args) => {
        if (method === "when" && args[0]) args[1](proxy);
        if (method === "id") ids.push(args[0]);
        if (method === "child") kids.push(args[0]);
        if (method === "child" && typeof args[0] === "string") words.push(args[0]);
        if (method === "children") kids.push(...args[0]);
        return proxy;
      };
    } });
    return proxy;
  };
  return { element, ids, words };
};
// The words under a kept element, in the order they show.
export const wordsOf = (node) => (typeof node === "string" ? [node] : node?.[KIDS] ? node[KIDS].flatMap(wordsOf) : []);

// Herdr's shared state, kept in `store`.
export const storeShared = (store, missing = undefined) => ({ shared: (key) => store[key] ?? missing, setShared: (key, value) => { store[key] = value; } });

// A view context whose spawned tasks can be awaited.
export function context() {
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const task = fn(cx); pending.push(task); return task; } };
  return { cx, async drain() { while (pending.length) await pending.shift(); } };
}

export function callContext() {
  const tasks = context();
  tasks.cx.timer = { after() {} };
  let over = false;
  const stale = () => { throw new Error("cx is no longer valid: it was captured during an earlier call and used later. Use cx.spawn or take cx from the callback arguments instead."); };
  const cx = {
    get timer() { return { after() { if (over) stale(); } }; },
    notify() { if (over) stale(); },
    spawn(fn) { if (over) stale(); return tasks.cx.spawn(fn); },
  };
  return { cx, drain: tasks.drain, end() { over = true; } };
}

// A context whose every() ticks wait in `timers` as { ms, fn }.
export const tickingContext = (timers) => {
  const tasks = context();
  tasks.cx.timer = { every(ms, fn) { timers.push({ ms, fn }); } };
  return tasks;
};

export const refreshedContext = async (view) => {
  const tasks = context();
  view.refresh(tasks.cx);
  await tasks.drain();
  return tasks;
};

// GPUI's elements are single-use: one added to a second parent fails the render
// ("element was already added to a parent"). These fakes fail the same way.
export function singleUse() {
  const make = () => {
    const self = { parented: false };
    const adopt = (c) => {
      if (c && c.__single) { if (c.__single.parented) throw new Error("element was already added to a parent; elements are single-use values"); c.__single.parented = true; }
    };
    const proxy = new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "__single") return self;
        if (prop === "child") return (c) => { adopt(c); return proxy; };
        if (prop === "children") return (list) => { [...(list ?? [])].forEach(adopt); return proxy; };
        if (prop === "when") return (cond, f) => (cond ? f(proxy) : proxy);
        return () => proxy;
      },
    });
    return proxy;
  };
  const factory = { new: () => make() };
  return { div: make, svg: make, v_flex: make, h_flex: make, Button: factory, Toggle: factory, Input: factory, Textarea: factory };
}

// A UI host that keeps the text drawn and each clickable id's handler.
// An element that is never awaited and runs `when`'s branch; `handle(key, el)` answers what it records, any other call returns it.
export const recordingElement = (handle) => {
  const el = new Proxy({}, { get: (_target, key) => {
    if (key === "then") return undefined;
    if (key === "when") return (on, apply) => (on ? apply(el) : el);
    return handle(key, el) ?? (() => el);
  } });
  return el;
};

// Every call `style(recorder)` makes, as [name, ...args].
const styleCalls = (style) => {
  const seen = [];
  const recorder = new Proxy({}, { get: (_t, name) => (...args) => { seen.push([name, ...args]); return recorder; } });
  style(recorder);
  return seen;
};

// A UI host that keeps the text drawn, each clickable id's handler, and each id's tooltip, opacity and hover style.
export function tape() {
  const texts = [], colors = [], ids = [], handlers = new Map(), tips = new Map(), opacities = new Map(), hovers = new Map();
  const node = (initial = null) => {
    let id = initial;
    const by = (map) => (value) => { map.set(id, value); };
    const record = {
      id: (value) => { id = value; ids.push(value); },
      child: (value) => { if (typeof value === "string") texts.push(value); },
      on_click: by(handlers),
      tooltip: by(tips),
      opacity: by(opacities),
      hover: (style) => { hovers.set(id, styleCalls(style)); },
      text_color: (value) => { colors.push(value); },
    };
    return recordingElement((key, el) => (Object.hasOwn(record, key) ? (value) => { record[key](value); return el; } : undefined));
  };
  return { texts, colors, ids, handlers, tips, opacities, hovers, host: { div: node, svg: node, h_flex: node, v_flex: node, Button: { new: node } } };
}

// A gpui element that records its calls, and a host that builds them.
export function chain(tag) {
  const state = { calls: [], kids: [], tag, parent: null };
  const adopt = (child) => {
    if (child && typeof child === "object") { child.parent = node; state.kids.push(child); }
  };
  const node = new Proxy(state, {
    get(_target, prop) {
      if (prop === "calls" || prop === "kids" || prop === "tag" || prop === "parent") return state[prop];
      if (prop === "when") return (condition, build) => {
        state.calls.push(["when", Boolean(condition)]);
        return condition ? build(node) : node;
      };
      if (prop === "child") return (child) => { state.calls.push(["child", child]); adopt(child); return node; };
      if (prop === "children") return (list) => { state.calls.push(["children"]); for (const child of list ?? []) adopt(child); return node; };
      return (...args) => { state.calls.push([String(prop), ...args]); return node; };
    },
    set(_target, prop, value) {
      if (prop === "parent") { state.parent = value; return true; }
      return false;
    },
  });
  return node;
}

// A chain drawing's every element, its words, and a press on the tool with that id.
export const nodes = (el) => [el, ...el.kids.flatMap(nodes)];
export const svgsOf = (el) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "svg").map((call) => call[1]));
export const tipsOf = (el) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "tooltip").map((call) => call[1]));
export const texts = (el) => nodes(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const BARE = new Set([undefined, "div", "h_flex", "v_flex", "svg", "image"]);
const hung = (el) => el.calls.filter((call) => call[0] === "trigger" || call[0] === "content").map((call) => call[1]);
const placed = (el, parent = null) => [[el, parent], ...[...el.kids, ...hung(el)].flatMap((kid) => placed(kid, el))];
const last = (el, name) => el.calls.findLast((call) => call[0] === name)?.[1];
const control = (el) => !BARE.has(el.tag) && hung(el).length === 0;
const tabStop = (el) => (last(el, "tab_stop") ?? (control(el) || last(el, "tab_index") !== undefined)) && !last(el, "disabled");
export function keyboard(root) {
  const parents = new Map(placed(root));
  const stops = [...parents.keys()].filter(tabStop).map((el, i) => [el, i]).toSorted(([a, i], [b, j]) => (last(a, "tab_index") ?? 0) - (last(b, "tab_index") ?? 0) || i - j).map(([el]) => el);
  const path = (el) => (el ? [el, ...path(parents.get(el))] : []);
  let at = -1;
  return {
    stops,
    tab: () => { at = (at + 1) % stops.length; return stops[at]; },
    key: (name, cx) => {
      let stopped = false;
      const routed = { ...cx, stop_propagation: () => { stopped = true; } };
      for (const el of path(stops[at])) {
        for (const [, handler] of el.calls.filter((call) => call[0] === "on_key_down")) if (!stopped) handler({ key: name, modifiers: {} }, routed);
        if (stopped) return;
      }
      if (name === "enter" || name === "space") stops[at].calls.filter((call) => call[0] === "on_click").forEach(([, handler]) => handler({}, routed));
    },
  };
}
export const press = (el, id) => {
  const tool = nodes(el).find((kid) => kid.tag === id);
  tool.calls.filter((call) => call[0] === "on_click").forEach(([, handler]) => handler({}, { stop_propagation: () => {} }));
};

// The elements a view draws with, each made by `node`.
export const elements = (node) => ({ div: node, svg: node, image: node, h_flex: node, v_flex: node, Popover: { new: node }, Button: { new: node } });
// Every item list a sidebar popup draws, kept as it is drawn.
export const watchPopups = (view) => {
  const shown = [], popup = view.popup.bind(view);
  view.popup = (t, title, items) => { shown.push(items); return popup(t, title, items); };
  return shown;
};
// Each item's words, in the order a popup makes them.
export const watchLines = (view, made) => {
  const line = view.menuLine.bind(view);
  view.menuLine = (text, act, opts) => { made.push(text); return line(text, act, opts); };
};

export const gpuiHost = () => ({
  div: () => chain("div"),
  h_flex: () => chain("h_flex"),
  v_flex: () => chain("v_flex"),
  svg: () => chain(),
  image: () => chain(),
  Button: { new: (id) => chain(id) },
  Input: { new: () => chain() },
  Toggle: { new: (id) => { const el = chain(id); el.calls.push(["new", id]); return el; } },
});

// Every call in a kit file that takes a bare number other than 0, as the token lint counts them: a piece reads its sizes from the tokens instead.
export const numberArguments = (file) => [...readFileSync(new URL(`../kanso/mods/${file}`, import.meta.url), "utf8").matchAll(/\.\w+\([^()]*?(?<![\w.])-?(?:0\.\d|[1-9])[\d.]*\s*[,)]/g)].map((m) => m[0]);

// A kit's exports with `c`, its colours in `theme`.
export const themed = (kit, theme) => ({ ...kit, c: kit.tokens(theme) });
export const eachTheme = (tokens, ...themes) => themes.map((theme) => ({ theme, c: tokens(theme) }));
// The kit's night colours, as the row and kit tests draw them.
export const KIT_NIGHT = { foreground: "#d8d4cb", background: "#1b1b19", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f" };
// A host whose svg and image elements keep the path they draw.
const drawnAt = (tag) => (path) => { const el = chain(tag); el.calls.push([tag, path]); return el; };
export const drawingHost = () => ({ ...gpuiHost(), svg: drawnAt("svg"), image: drawnAt("image") });
// The same, with Herdr's popover.
export const popoverHost = () => ({ ...drawingHost(), Popover: { new: (id) => chain(id) } });
// Every element drawn, with what a popover holds as its trigger and content.
const heldBy = (el) => el.calls.filter((call) => call[0] === "trigger" || call[0] === "content").map((call) => call[1]);
export const everyDrawn = (el) => [el, ...[...el.kids, ...heldBy(el)].flatMap(everyDrawn)];
// How many of the blocked tone's dots an element draws.
export const blockedDots = (el, c) => nodes(el).filter((kid) => calls(kid, "rounded_full").length && calls(kid, "bg").some((call) => call[1] === c.blocked)).length;
// The one value each named call set on an element.
export const boxOf = (el, ...names) => names.map((name) => one(el, name));
// Herdr's text file reads and writes on the real disk: a missing file reads as null, a write makes its folder.
export const textFiles = {
  readTextFile: readOrNull,
  writeTextFile: async (path, text) => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, text); return null; },
};
// The night colours the strip and the tab bar draw with.
export const CHROME_NIGHT = {
  background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", dim: "#6b6860", muted: "#949086",
  blocked: "#d5674f", working: "#d9a74a", done: "#7fa66b", accent: "#7d9cd4", popover: "#222220", border: "#33332f", chrome: "#141413",
};
// A text field holding `value`.
export const fieldWith = ({ value }) => ({ on() {}, focus() {}, value: () => value, set_selected_range() {}, release() {} });
// Every .js file under dir, at any depth; a folder that is not there has none.
export async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? jsFiles(join(dir, e.name)) : Promise.resolve(e.name.endsWith(".js") ? [join(dir, e.name)] : []))));
  return nested.flat();
}
// Runs `use` in a new temporary folder, removed after, whatever happens.
export const inTemporaryDir = (prefix, use) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

export const kansoColours = async () => {
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"]);
  const theme = JSON.parse(readFileSync(new URL("../kanso/themes/kanso.json", import.meta.url), "utf8"));
  return tokens({ ...theme, ...theme.colors });
};
