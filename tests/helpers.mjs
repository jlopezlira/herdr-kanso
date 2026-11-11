// Shared by the tests: load a mod's real source into a fake Herdr host.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { bannedGlobals } from "../scripts/herdr-api.mjs";
import { modScript } from "../scripts/mod-source.mjs";

const runFile = promisify(execFile);
const fileExists = (path) => access(path).then(() => true, () => false);
const api = JSON.parse(readFileSync(new URL("./herdr-api.json", import.meta.url), "utf8"));
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
    for (const m of text.matchAll(/^import\s+(?:\{[^}]*\}\s+from\s+)?["'](\.\/[^"']+)["'];/gm)) {
      const sibling = `${dir}${m[1].slice(2)}`;
      if (!sources.has(sibling)) { sources.set(sibling, await read(sibling)); pending.push(sibling); }
    }
  }
  const source = modScript(sources.get(file), (name) => sources.get(`${dir}${name.slice(2)}`));
  return vm.runInContext(`${source}\n;({ ${names.join(", ")} });`, modSandbox({ View: class {}, join, basename, shared() {}, setShared() {}, writeTextFile: (path, text) => writeFile(path, text, { flag: "wx" }), exec: async () => { throw new Error("Unexpected command in fixture"); }, window: host.exec === exec ? nativeWindow : () => ({ platform: "macos" }), layout: () => null, focused: () => null, panes: () => [], terminals: () => [], settings: () => ({}), ...host, __herdrModule: (name) => modules[name] }));
}

// Tests that watch real processes need ps; a sandbox that denies it skips them, saying so, rather than failing.
export const psMissing = (() => {
  try { execFileSync("ps", ["-p", String(process.pid), "-o", "comm="], { stdio: "pipe" }); return false; } catch { return "ps can't see processes here"; }
})();

export async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "kanso-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Herdr's exec, backed by the real programs, and like Herdr's it kills one that runs past its
// limit (30 s; `limit` in ms makes it shorter for a test).
export async function exec(command, args, options = {}) {
  try {
    const result = await runFile(command, args, { cwd: options.cwd, ...(options.env ? { env: options.env } : {}), maxBuffer: 4 * 1024 * 1024, timeout: options.limit ?? 30000, killSignal: "SIGKILL" });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.killed ? 137 : error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
}

// A view context whose spawned tasks can be awaited.
export function context() {
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const task = fn(cx); pending.push(task); return task; } };
  return { cx, async drain() { while (pending.length) await pending.shift(); } };
}

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
export function tape() {
  const texts = [], handlers = new Map();
  const node = (initial = null) => {
    let id = initial;
    const el = new Proxy({}, { get(_target, key) {
      if (key === "then") return undefined;
      if (key === "id") return (value) => { id = value; return el; };
      if (key === "child") return (value) => { if (typeof value === "string") texts.push(value); return el; };
      if (key === "when") return (on, apply) => on ? apply(el) : el;
      if (key === "on_click") return (fn) => { handlers.set(id, fn); return el; };
      return () => el;
    } });
    return el;
  };
  return { texts, handlers, host: { div: node, svg: node, h_flex: node, v_flex: node, Button: { new: node } } };
}
