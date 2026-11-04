// Some Kanso mods are also listed on their own at herdr.dev/mods. The gallery
// takes a mod only from a top-level folder with mods/<name>/, a RECIPE.md and a
// preview.png, and no layouts/, so each of them has such a folder with a copy
// of the mod. kanso/mods/<name> (what Kanso installs and updates) is the one
// you edit; this copies it into <name>/mods/<name>. `--check` fails instead
// when a copy differs.
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const STANDALONE = ["open-with"];
// Written by `herdr-app check` into the folder it checks; never shipped.
const GENERATED = new Set(["gpui-kit.d.ts", "jsconfig.json", ".DS_Store"]);

export const source = (mod) => join(ROOT, "kanso", "mods", mod);
export const copy = (mod) => join(ROOT, mod, "mods", mod);

// Every file under dir, as paths relative to it, sorted; generated files left out.
export async function files(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  return entries
    .filter((e) => e.isFile() && !GENERATED.has(e.name))
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

// What differs between a mod and its copy: missing, extra or changed files.
export async function differences(mod) {
  const [from, to] = [await files(source(mod)), await files(copy(mod))];
  if (!from) return [`kanso/mods/${mod} is missing`];
  if (!to) return [`${mod}/mods/${mod} is missing`];
  const out = [];
  for (const f of from) {
    if (!to.includes(f)) out.push(`${f} is missing from the copy`);
    else if (!(await readFile(join(source(mod), f))).equals(await readFile(join(copy(mod), f)))) out.push(`${f} differs`);
  }
  for (const f of to) if (!from.includes(f)) out.push(`${f} is only in the copy`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const mod of STANDALONE) {
    const diff = await differences(mod);
    if (!diff.length) continue;
    if (check) {
      console.error(`${mod}/mods/${mod} is out of date (run npm run sync:mods):\n  ${diff.join("\n  ")}`);
      stale += 1;
      continue;
    }
    await rm(copy(mod), { recursive: true, force: true });
    await mkdir(copy(mod), { recursive: true });
    await cp(source(mod), copy(mod), { recursive: true, filter: (p) => !GENERATED.has(p.split(/[\\/]/).pop()) });
    console.log(`copied kanso/mods/${mod} to ${mod}/mods/${mod}`);
  }
  process.exit(stale ? 1 : 0);
}
