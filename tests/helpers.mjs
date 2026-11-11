// Shared by the tests: load a mod's real source into a fake Herdr host.
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { modScript } from "../scripts/mod-source.mjs";

const runFile = promisify(execFile);
export const clone = (value) => JSON.parse(JSON.stringify(value));
const mods = new URL("../kanso/mods/", import.meta.url);

// Load the actual mod logic (its own-folder imports included) with the
// desktop host supplied by each fixture.
export async function load(file, names, host = {}) {
  const dir = file.slice(0, file.lastIndexOf("/") + 1);
  const read = async (name) => readFile(new URL(name, mods), "utf8");
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
  return vm.runInNewContext(`${source}\n;({ ${names.join(", ")} });`, { View: class {}, setShared() {}, ...host });
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
    const result = await runFile(command, args, { cwd: options.cwd, maxBuffer: 4 * 1024 * 1024, timeout: options.limit ?? 30000, killSignal: "SIGKILL" });
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
