// Files used by more than one mod. Herdr loads a mod's files from its own
// folder only, so the source (the one you edit) is copied into every other
// mod that uses it. `--check` fails instead when a copy differs.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// Each shared file (relative to the repo), and where it is copied.
export const SHARED = [
  { source: "kanso/mods/kanso-panel/share.js", copies: ["kanso/mods/kanso-spend/share.js"] },
  // An agent's state mark, the same in the tabs, headers, status bar and sidebar.
  { source: "kanso/mods/kanso-spaces/marks.js", copies: ["kanso/mods/kanso-tabs/marks.js", "kanso/mods/kanso-strip/marks.js", "kanso/mods/kanso-status/marks.js"] },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { source: from, copies } of SHARED) {
    const source = await readFile(new URL(from, root), "utf8");
    for (const copy of copies) {
      const target = new URL(copy, root);
      const current = await readFile(target, "utf8").catch(() => null);
      if (current === source) continue;
      if (check) { console.error(`${copy} differs from ${from}: run npm run sync:share`); stale += 1; }
      else { await writeFile(target, source); console.log(`copied ${from} to ${copy}`); }
    }
  }
  process.exit(stale ? 1 : 0);
}
