#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bareRelease, compareReleases, parseRelease } from "../kanso/mods/kanso-chrome/release.js";
import { CATEGORIES, CHANGELOG, UNRELEASED, VERSION_FILE, check, compare, installedChangedSince, isCandidate, listTags, nextVersion, notes, parse, parseChangelog, readChangelog, readVersion, stableTags, versionBranch } from "./check-version.mjs";

const fail = (message) => ({ action: "fail", message });
const skip = (message) => ({ action: "skip", message });
const publish = (version, prerelease) => ({ action: "release", tag: `v${version}`, title: `Kanso ${version}`, prerelease, message: `publish v${version}` });
const where = (branch) => branch || "an unknown branch";
const core = (rel) => `${rel.major}.${rel.minor}.${rel.patch}`;

function nextN(names, version, channel) {
  const ns = names.map(parseRelease).filter((rel) => rel?.channel === channel && core(rel) === version).map((rel) => rel.n);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

function baseline(names, version) {
  const betas = names.filter((name) => {
    const rel = parseRelease(name);
    return rel?.channel === "beta" && core(rel) === version;
  });
  const pool = betas.length ? betas : names.filter((name) => parse(name));
  return pool.length ? [...pool].sort(compareReleases).at(-1) : null;
}

export function activeCandidate(version, tags) {
  const latest = stableTags(tags).sort(compare).at(-1);
  return latest && parse(version) && compare(version, latest) > 0 && isCandidate(version, tags) ? version : null;
}

export function prepareCandidate({ version, changelog, tags, date = new Date().toISOString().slice(0, 10) }) {
  const { sections, errors } = parseChangelog(changelog);
  if (errors.length) throw new Error(errors.join("; "));
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

export function planRelease({ kind, branch, version, changelog, tags, installedChangedSince: changedSince = () => true }) {
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
    const next = nextVersion(changelog, tags);
    const base = baseline(names, next);
    if (base && !changedSince(base)) return skip(`what Kanso installs has not changed since v${base}; no beta.`);
    return publish(`${next}-beta.${nextN(names, next, "beta")}`, true);
  } catch (error) {
    return fail(error.message);
  }
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
  const tags = listTags();
  const branch = versionBranch();
  const errors = check({ version, changelog, tags, installedChangedSince, branch });
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const changedSince = kind === "beta" ? (tag) => installedChangedSince(tag, { ignoreVersion: true }) : installedChangedSince;
  const plan = planRelease({ kind, branch, version, changelog, tags, installedChangedSince: changedSince });
  if (plan.action === "fail") {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  console.log(plan.message);
  if (plan.action === "skip") {
    writeOutputs([["action", "skip"]]);
    return;
  }
  if (kind === "rc") {
    const candidate = prepareCandidate({ version, changelog, tags });
    if (process.argv.includes("--prepare")) {
      if (candidate.changelog !== changelog) writeFileSync(CHANGELOG, candidate.changelog);
      if (candidate.version !== version) {
        const data = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
        writeFileSync(VERSION_FILE, `${JSON.stringify({ ...data, version: candidate.version }, null, 2)}\n`);
      }
    }
    version = candidate.version;
    changelog = candidate.changelog;
  }
  const body = notes(changelog, kind === "beta" ? UNRELEASED : version);
  if (body === null) {
    console.error(`error: ${CHANGELOG} has no section for ${version}`);
    process.exit(1);
  }
  const path = join(process.env.RUNNER_TEMP || tmpdir(), "kanso-release-notes.md");
  writeFileSync(path, `${body}\n`);
  writeOutputs([["action", "release"], ["tag", plan.tag], ["title", plan.title], ["prerelease", plan.prerelease ? "true" : "false"], ["notes", path]]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
