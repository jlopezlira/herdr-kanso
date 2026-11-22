import { spawnSync } from "node:child_process";
import { isMain, REPO_ROOT } from "./cli.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

export const checks = (branch = process.env.KANSO_BRANCH || "develop") => [
  ["check:version", "--", "--branch", branch],
  ["sync:share", "--", "--check"],
  ["build:site", "--", "--check"],
  ["build:issue-forms", "--", "--check"],
  ["build:linux-keys", "--", "--check"],
  ["check:dupes"],
].map(([script, ...args]) => ({ name: ["npm run", script, ...args].join(" "), argv: ["run", "-s", script, ...args] }));

export const TESTS = { name: "npm test", argv: ["test"] };

export const steps = (argv = process.argv) => (argv.includes("--checks-only") ? checks() : [...checks(), TESTS]);

export const summary = (results) => results.map(({ name, ok }) => `- ${name}: ${ok ? "passed" : "failed"}`).join("\n");

function main() {
  const results = steps().map(({ name, argv }) => {
    console.log(`\n> ${name}`);
    const run = spawnSync(npm, argv, { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
    return { name, ok: run.status === 0 };
  });
  console.log(`\nPre-PR\n${summary(results)}`);
  process.exitCode = results.every(({ ok }) => ok) ? 0 : 1;
}

if (isMain(import.meta.url)) main();
