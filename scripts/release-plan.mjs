#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bareRelease, compareReleases, parseRelease } from "../kanso/mods/kanso-chrome/release.js";
import { CATEGORIES, CHANGELOG, UNRELEASED, VERSION_FILE, check, compare, installedChangedSince, isCandidate, listTags, nextVersion, notes, parse, parseChangelog, changelogSections, readReleaseFiles, stableTags, versionBranch } from "./check-version.mjs";

const fail = (message) => ({ action: "fail", message });
const skip = (message) => ({ action: "skip", message });
const publish = (version, prerelease) => ({ action: "release", tag: `v${version}`, title: `Kanso ${version}`, prerelease, message: `publish v${version}` });
const where = (branch) => branch || "an unknown branch";
const core = (rel) => `${rel.major}.${rel.minor}.${rel.patch}`;

function nextN(names, version, channel) {
  const ns = names.map(parseRelease).filter((rel) => rel?.channel === channel && core(rel) === version).map((rel) => rel.n);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

const prereleasesOf = (names, version, channel = null) => names.filter((name) => {
  const rel = parseRelease(name);
  return rel?.channel && (!channel || rel.channel === channel) && core(rel) === version;
});

function trainOf(names, computed) {
  const highest = names.map(parseRelease).filter((rel) => rel?.channel).map(core).sort(compare).at(-1);
  return highest && compare(highest, computed) > 0 ? highest : computed;
}

function baseline(names, version) {
  const prereleases = prereleasesOf(names, version);
  const pool = prereleases.length ? prereleases : names.filter((name) => parse(name));
  return pool.length ? [...pool].sort(compareReleases).at(-1) : null;
}

export function activeCandidate(version, tags) {
  const latest = stableTags(tags).sort(compare).at(-1);
  return latest && parse(version) && compare(version, latest) > 0 && isCandidate(version, tags) ? version : null;
}

export function prepareCandidate({ version, changelog, tags, date = new Date().toISOString().slice(0, 10) }) {
  const sections = changelogSections(changelog);
  const pending = sections.find((s) => s.version === UNRELEASED);
  const current = activeCandidate(version, tags);
  const computed = nextVersion(changelog, tags);
  const next = current && computed && compare(current, computed) > 0 ? current : computed;
  if (!next) throw new Error(`v${version} is already stable; refusing a release candidate without Unreleased entries`);
  const candidate = current ? sections.find((s) => s.version === current) : null;
  if (current && !candidate) throw new Error(`${CHANGELOG} has no section for ${current}`);
  if (!pending) return { version: next, changelog };
  const categories = {};
  for (const name of CATEGORIES) {
    const entries = [...(candidate?.categories[name] || []), ...(pending.categories[name] || [])];
    if (entries.length) categories[name] = entries;
  }
  const body = Object.entries(categories).map(([name, entries]) => `### ${name}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`).join("\n\n");
  const lines = changelog.split("\n");
  const last = candidate || pending;
  const after = sections[sections.indexOf(last) + 1];
  const before = lines.slice(0, pending.line - 1).join("\n");
  const history = after ? lines.slice(after.line - 1).join("\n") : "";
  return { version: next, changelog: `${before}${before ? "\n" : ""}## [${next}] - ${candidate?.date || date}\n\n${body}\n${history ? `\n${history}` : ""}` };
}

const commitOf = (ref) => execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8" }).trim();

function isAncestor(a, b) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

const subjectOf = (commit) => execFileSync("git", ["log", "-1", "--format=%s", commit], { encoding: "utf8" }).trim();

export function releasedAfter(sha, tags) {
  const head = commitOf(sha);
  for (const tag of tags) {
    const commit = commitOf(`v${tag}`);
    const source = subjectOf(commit) === `Prepare v${tag}` ? commitOf(`${commit}^`) : commit;
    if (source !== head && isAncestor(head, source)) return tag;
  }
  return null;
}

export function planRelease({ kind, branch, version, changelog, tags, installedChangedSince: changedSince = () => true, releasedAfter: later = () => null }) {
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
  try {
    if (kind === "rc") {
      const candidate = prepareCandidate({ version, changelog, tags });
      const plan = publish(`${candidate.version}-rc.${nextN(names, candidate.version, "rc")}`, true);
      const errors = check({ ...candidate, tags: [...tags, plan.tag], installedChangedSince: () => false, branch });
      return errors.length ? fail(errors.join("; ")) : plan;
    }
    if (notes(changelog, UNRELEASED) === null) return skip("no Unreleased entries; no beta.");
    const newer = later();
    if (newer) return skip(`v${newer} was published from a newer commit; no beta.`);
    const next = trainOf(names, nextVersion(changelog, tags));
    const base = baseline(names, next);
    if (base && !changedSince(base)) return skip(`what Kanso installs has not changed since v${base}; no beta.`);
    const channel = prereleasesOf(names, next, "rc").length ? "rc" : "beta";
    const plan = publish(`${next}-${channel}.${nextN(names, next, channel)}`, true);
    const above = names.find((name) => compareReleases(plan.tag, name) <= 0 && compareReleases(plan.tag, name) !== null);
    return above ? fail(`${plan.tag} would not reach Early: v${above} already ranks above it`) : plan;
  } catch (error) {
    return fail(error.message);
  }
}

export const REPORT_LINE = "Report a problem: https://github.com/jlopezlira/herdr-kanso/issues/new?template=bug.yml";

export function releaseNotes({ kind, version, changelog }) {
  const section = parseChangelog(changelog).sections.find((s) => s.version === (kind === "beta" ? UNRELEASED : version));
  if (!section) return null;
  if (kind === "stable") return section.body;
  if (kind === "beta") return `${section.body}\n\n${REPORT_LINE}`;
  let upgrade = false;
  const changes = section.body.split("\n").filter((line) => {
    if (line.startsWith("### ")) upgrade = line.slice(4).trim() === "Upgrade";
    return !upgrade;
  }).join("\n").trim();
  const parts = [
    `Release candidate for ${version}. It becomes ${version} stable if nothing blocks it.`,
    ["## Changes", changes].filter(Boolean).join("\n\n"),
  ];
  if (section.categories.Upgrade) parts.push(`## Before you update\n\n${section.categories.Upgrade.map((entry) => `- ${entry}`).join("\n")}`);
  return [...parts, REPORT_LINE].join("\n\n");
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
  const read = readReleaseFiles();
  const tags = listTags();
  const branch = versionBranch();
  const errors = check({ ...read, tags, installedChangedSince, branch });
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const changedSince = kind === "beta" ? (tag) => installedChangedSince(tag, { ignoreVersion: true }) : installedChangedSince;
  const sha = process.env.KANSO_RELEASE_SHA;
  const plan = planRelease({ kind, branch, ...read, tags, installedChangedSince: changedSince, releasedAfter: () => (sha ? releasedAfter(sha, tags.filter((tag) => parseRelease(tag))) : null) });
  if (plan.action === "fail") {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  if (plan.action === "release" && !/^v\d+\.\d+\.\d+(-(beta|rc)\.\d+)?$/.test(plan.tag)) {
    console.error(`error: ${plan.tag} is not vX.Y.Z, vX.Y.Z-beta.N or vX.Y.Z-rc.N`);
    process.exit(1);
  }
  console.log(plan.message);
  if (plan.action === "skip") {
    writeOutputs([["action", "skip"]]);
    return;
  }
  const { version, changelog } = kind === "rc" ? prepareCandidate({ ...read, tags }) : read;
  if (kind === "rc" && process.argv.includes("--prepare")) {
    if (changelog !== read.changelog) writeFileSync(CHANGELOG, changelog);
    if (version !== read.version) {
      const data = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
      writeFileSync(VERSION_FILE, `${JSON.stringify({ ...data, version }, null, 2)}\n`);
    }
  }
  const body = releaseNotes({ kind, version, changelog });
  if (body === null) {
    console.error(`error: ${CHANGELOG} has no section for ${version}`);
    process.exit(1);
  }
  const path = join(process.env.RUNNER_TEMP || tmpdir(), "kanso-release-notes.md");
  writeFileSync(path, `${body}\n`);
  writeOutputs([["action", "release"], ["tag", plan.tag], ["title", plan.title], ["prerelease", plan.prerelease ? "true" : "false"], ["notes", path]]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
