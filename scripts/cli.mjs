// Shared by the scripts: whether one runs from the command line, and whether it only checks.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const isMain = (url) => process.argv[1] === fileURLToPath(url);
export const CHECK = process.argv.includes("--check");
export const ROOT_URL = new URL("../", import.meta.url);
export const REPO_ROOT = fileURLToPath(ROOT_URL);

export function generated(name, text, { from, script }) {
  const target = new URL(name, ROOT_URL);
  const current = (() => { try { return readFileSync(target, "utf8"); } catch { return null; } })();
  if (CHECK) {
    if (current !== text) { console.error(`${name} differs from ${from}: run npm run ${script}`); process.exit(1); }
    console.log(`${name} matches ${from}`);
  } else if (current !== text) {
    writeFileSync(target, text);
    console.log(`wrote ${name}`);
  }
}
