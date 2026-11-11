#!/usr/bin/env node
// Plans the tag a workflow may publish. It writes GitHub outputs and does not call gh.
//
//   node scripts/release-plan.mjs stable|beta|rc
//
// KANSO_BRANCH (or --branch) is the branch this run is on. The default is main,
// which refuses a beta and a release candidate.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bareRelease, compareReleases, parseRelease } from "../kanso/mods/kanso-chrome/release.js";
import { CHANGELOG, VERSION_FILE, installedChangedSince, listTags, notes, parse, readChangelog, readVersion, versionBranch } from "./check-version.mjs";

const fail = (message) => ({ action: "fail", message });
const skip = (message) => ({ action: "skip", message });
const publish = (version, prerelease) => ({ action: "release", tag: `v${version}`, title: `Kanso ${version}`, prerelease, message: `publish v${version}` });
const where = (branch) => branch || "an unknown branch";
const core = (rel) => `${rel.major}.${rel.minor}.${rel.patch}`;

function nextN(names, version, channel) {
  const ns = names.map(parseRelease).filter((rel) => rel?.channel === channel && core(rel) === version).map((rel) => rel.n);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

// The newest beta of this version, or the newest stable tag when it has no beta yet.
function baseline(names, version) {
  const betas = names.filter((name) => {
    const rel = parseRelease(name);
    return rel?.channel === "beta" && core(rel) === version;
  });
  const pool = betas.length ? betas : names.filter((name) => parse(name));
  return pool.length ? [...pool].sort(compareReleases).at(-1) : null;
}

export function planRelease({ kind, branch, version, tags, installedChangedSince: changedSince = () => true }) {
  const versionText = String(version ?? "");
  if (!parse(versionText)) return fail(`${versionText || "missing"} is not a stable version (X.Y.Z)`);
  const names = [...new Set(tags.map(bareRelease).filter((name) => parseRelease(name)))];
  if (kind === "stable") {
    if (branch !== "main") return fail(`a stable release is published only from main (this is ${where(branch)})`);
    if (names.includes(versionText)) return skip(`v${versionText} is already released.`);
    return publish(versionText, false);
  }
  if (kind !== "beta" && kind !== "rc") return fail(`unknown release ${kind}`);
  const what = kind === "beta" ? "beta" : "release candidate";
  if (branch !== "develop") return fail(`a ${what} is published only from develop (this is ${where(branch)})`);
  if (names.includes(versionText)) {
    return kind === "rc"
      ? fail(`v${versionText} is already stable; refusing a release candidate`)
      : skip(`v${versionText} is already stable; no beta.`);
  }
  if (kind === "beta") {
    const base = baseline(names, versionText);
    if (base && !changedSince(base)) return skip(`what Kanso installs has not changed since v${base}; no beta.`);
  }
  return publish(`${versionText}-${kind}.${nextN(names, versionText, kind)}`, true);
}

function writeOutputs(pairs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  writeFileSync(file, pairs.map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { flag: "a" });
}

function main() {
  const kind = process.argv[2];
  if (!["stable", "beta", "rc"].includes(kind)) {
    console.error("usage: node scripts/release-plan.mjs stable|beta|rc");
    process.exit(1);
  }
  let version, changelog;
  try { version = readVersion(); }
  catch (e) { console.error(`error: ${VERSION_FILE} could not be read: ${e.message}`); process.exit(1); }
  try { changelog = readChangelog(); }
  catch (e) { console.error(`error: ${CHANGELOG} could not be read: ${e.message}`); process.exit(1); }
  const plan = planRelease({ kind, branch: versionBranch(), version, tags: listTags(), installedChangedSince });
  if (plan.action === "fail") {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  console.log(plan.message);
  if (plan.action === "skip") {
    writeOutputs([["action", "skip"]]);
    return;
  }
  const body = notes(changelog, version);
  if (body === null) {
    console.error(`error: ${CHANGELOG} has no section for ${version}`);
    process.exit(1);
  }
  const path = join(process.env.RUNNER_TEMP || tmpdir(), "kanso-release-notes.md");
  writeFileSync(path, `${body}\n`);
  writeOutputs([["action", "release"], ["tag", plan.tag], ["title", plan.title], ["prerelease", plan.prerelease ? "true" : "false"], ["notes", path]]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
