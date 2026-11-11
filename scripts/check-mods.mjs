#!/usr/bin/env node
// Runs `herdr-app check` on every mod. CI does not run this: it has no Herdr.
//
//   npm run check:mods
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { modDirs } from "./check-imports.mjs";

export const SKIPPED = "skipped: Herdr app not found";

export function checkMods(dirs, spawn) {
  const failures = [];
  for (const dir of dirs) {
    const result = spawn(dir);
    if (result.error?.code === "ENOENT") return { skipped: true, failures: [] };
    if ((result.status ?? 1) !== 0) failures.push(dir);
  }
  return { skipped: false, failures };
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const outcome = checkMods(modDirs(root), (dir) => spawnSync("herdr-app", ["check", dir], { cwd: root, stdio: "inherit" }));
  if (outcome.skipped) { console.log(SKIPPED); return; }
  if (outcome.failures.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
