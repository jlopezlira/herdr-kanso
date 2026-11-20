import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
const IMPORT = /^import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;

const packageOf = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
const bare = (specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:") && !builtinModules.includes(packageOf(specifier));

test("Every package a script or test imports is declared in package.json, so CI's npm ci installs it", () => {
  const files = execFileSync("git", ["ls-files", "scripts/*.mjs", "tests/*.mjs"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const missing = files.flatMap((file) => [...readFileSync(`${root}${file}`, "utf8").matchAll(IMPORT)]
    .map(([, specifier]) => specifier).filter(bare).map(packageOf).filter((name) => !declared.has(name)).map((name) => `${file}: ${name}`));
  assert.deepEqual(missing, []);
});
