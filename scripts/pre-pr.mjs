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

export const marks = ({ env = process.env, argv = process.argv, before, after }) =>
  !env.CI && !argv.includes("--checks-only") && (env.KANSO_BRANCH || "develop") === "develop"
  && Boolean(before?.sha) && before.clean && after?.sha === before.sha && after.clean;

const run = (command, args) => spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });
const firstLine = (r) => (r.error?.message ?? (r.stderr || r.stdout || "").trim().split("\n")[0]) || `exit ${r.status}`;

export function tree() {
  const head = run("git", ["rev-parse", "HEAD"]);
  const status = run("git", ["status", "--porcelain"]);
  return { sha: head.status === 0 ? head.stdout.trim() : null, clean: status.status === 0 && !status.stdout.trim() };
}

function mark(ok, before) {
  const after = tree();
  if (!marks({ before, after })) {
    if (!process.env.CI && !process.argv.includes("--checks-only")) console.log("No commit marked on GitHub: the run needs a committed, unchanged tree checked against develop.");
    return;
  }
  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  if (repo.status !== 0) { console.log(`No commit marked on GitHub: ${firstLine(repo)}`); return; }
  const state = ok ? "success" : "failure";
  const posted = run("gh", ["api", `repos/${repo.stdout.trim()}/statuses/${before.sha}`, "-f", `state=${state}`, "-f", `context=${CONTEXT}`, "-f", `description=npm run pre-pr ${ok ? "passed" : "failed"}`]);
  console.log(posted.status === 0 ? `${CONTEXT}: ${state} on ${before.sha.slice(0, 8)}` : `No commit marked on GitHub (push ${before.sha.slice(0, 8)} first if it is not there): ${firstLine(posted)}`);
}

export const summary = (results) => results.map(({ name, ok }) => `- ${name}: ${ok ? "passed" : "failed"}`).join("\n");

function main() {
  const before = tree();
  const results = steps().map(({ name, argv }) => {
    console.log(`\n> ${name}`);
    const run = spawnSync(npm, argv, { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
    return { name, ok: run.status === 0 };
  });
  console.log(`\nPre-PR\n${summary(results)}`);
  const ok = results.every((r) => r.ok);
  mark(ok, before);
  process.exitCode = ok ? 0 : 1;
}

if (isMain(import.meta.url)) main();
