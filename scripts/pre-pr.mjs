import { spawnSync } from "node:child_process";
import { isMain, REPO_ROOT } from "./cli.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

export const checks = (branch = process.env.KANSO_BRANCH || "develop") => [
  ["check:version", "--", "--branch", branch],
  ["sync:share", "--", "--check"],
  ["build:site", "--", "--check"],
  ["build:issue-forms", "--", "--check"],
  ["build:linux-keys", "--", "--check"],
  ["build:link-rules", "--", "--check"],
  ["check:dupes"],
].map(([script, ...args]) => ({ name: ["npm run", script, ...args].join(" "), argv: ["run", "-s", script, ...args] }));

export const TESTS = { name: "npm test", argv: ["test"] };

export const steps = (argv = process.argv) => (argv.includes("--checks-only") ? checks() : [...checks(), TESTS]);

export const CONTEXT = "kanso/pre-pr";

export const marks = ({ env = process.env, argv = process.argv, dirty = "" } = {}) => !env.CI && !argv.includes("--checks-only") && !dirty.trim();

const run = (command, args) => spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32" });

function mark(ok) {
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"]).stdout ?? "";
  if (!marks({ dirty })) {
    if (dirty.trim()) console.log("Uncommitted changes: no commit is marked on GitHub.");
    return;
  }
  const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).stdout?.trim();
  const state = ok ? "success" : "failure";
  const posted = repo && run("gh", ["api", `repos/${repo}/statuses/${sha}`, "-f", `state=${state}`, "-f", `context=${CONTEXT}`, "-f", `description=npm run pre-pr ${ok ? "passed" : "failed"}`]);
  console.log(posted?.status === 0
    ? `${CONTEXT}: ${state} on ${sha.slice(0, 8)}`
    : `${sha.slice(0, 8)} is not on GitHub yet: push it, then run npm run pre-pr again so the pull request can merge.`);
}

export const summary = (results) => results.map(({ name, ok }) => `- ${name}: ${ok ? "passed" : "failed"}`).join("\n");

function main() {
  const results = steps().map(({ name, argv }) => {
    console.log(`\n> ${name}`);
    const run = spawnSync(npm, argv, { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
    return { name, ok: run.status === 0 };
  });
  console.log(`\nPre-PR\n${summary(results)}`);
  const ok = results.every((r) => r.ok);
  mark(ok);
  process.exitCode = ok ? 0 : 1;
}

if (isMain(import.meta.url)) main();
