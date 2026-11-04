// Shared by the tests: load a mod's real source into a fake Herdr host.
import { execFile } from "node:child_process";
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
  return vm.runInNewContext(`${source}\n;({ ${names.join(", ")} });`, { View: class {}, ...host });
}

export async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "kanso-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Herdr's exec, backed by the real programs.
export async function exec(command, args, options = {}) {
  try {
    const result = await runFile(command, args, { cwd: options.cwd, maxBuffer: 4 * 1024 * 1024 });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
}

// A view context whose spawned tasks can be awaited.
export function context() {
  const pending = [];
  const cx = { notify() {}, spawn(fn) { const task = fn(cx); pending.push(task); return task; } };
  return { cx, async drain() { while (pending.length) await pending.shift(); } };
}
