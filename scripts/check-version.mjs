#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bareRelease, parseRelease } from "../kanso/mods/kanso-chrome/release.js";

export const VERSION_FILE = "kanso/mods/kanso-chrome/version.json";
export const CHANGELOG = "CHANGELOG.md";
export const INSTALLED = ["kanso/mods", "kanso/themes", "kanso/layouts", "kanso/keys.json", "kanso/keys.windows.json"];
export const CATEGORIES = ["Breaking", "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security", "Upgrade"];
export const UNRELEASED = "Unreleased";

export const parse = (v) => {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v ?? ""));
  return m ? m.slice(1).map(Number) : null;
};

export function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function requiredBump(categories) {
  if (categories.some((c) => c === "Breaking" || c === "Removed")) return "major";
  if (categories.some((c) => c === "Added" || c === "Deprecated")) return "minor";
  return "patch";
}

export function bump(version, kind) {
  const [major, minor, patch] = parse(version);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function versionBranch(env = process.env, argv = process.argv) {
  const i = argv.indexOf("--branch");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return env.KANSO_BRANCH || "main";
}

export function stableTags(tags) {
  return [...new Set(tags.map(bareRelease).filter(parse))];
}

export function parseChangelog(text) {
  const sections = [], errors = [];
  let section = null, category = null;
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trimEnd(), at = i + 1;
    if (line === `## [${UNRELEASED}]`) {
      if (sections.length) errors.push(`${CHANGELOG}:${at}: "## [${UNRELEASED}]" goes first, above every release`);
      section = { version: UNRELEASED, date: null, categories: {}, body: [], line: at };
      sections.push(section); category = null;
      return;
    }
    if (line.startsWith("## ")) {
      const m = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
      if (!m) { errors.push(`${CHANGELOG}:${at}: a version heading reads "## [X.Y.Z] - YYYY-MM-DD", not "${line}"`); section = null; return; }
      if (!parse(m[1])) errors.push(`${CHANGELOG}:${at}: "${m[1]}" is not a semantic version (X.Y.Z)`);
      section = { version: m[1], date: m[2], categories: {}, body: [], line: at };
      sections.push(section); category = null;
      return;
    }
    if (!section) return;
    section.body.push(raw);
    if (line.startsWith("### ")) {
      const name = line.slice(4).trim();
      if (!CATEGORIES.includes(name)) errors.push(`${CHANGELOG}:${at}: "${name}" is not one of ${CATEGORIES.join(", ")}`);
      category = name; section.categories[name] ??= [];
    } else if (line.startsWith("- ")) {
      if (!category) errors.push(`${CHANGELOG}:${at}: an entry before any "### <Category>" heading`);
      else section.categories[category].push(line.slice(2));
    } else if (category && section.categories[category].length) {
      const entries = section.categories[category];
      entries[entries.length - 1] += `\n${raw}`;
    }
  });
  for (const s of sections) {
    s.body = s.body.join("\n").trim();
    for (const [name, entries] of Object.entries(s.categories)) {
      entries.forEach((entry, i) => { entries[i] = entry.trimEnd(); });
      if (!entries.length) errors.push(`${CHANGELOG}:${s.line}: ${s.version} has an empty "### ${name}"`);
    }
    if (!Object.keys(s.categories).length) errors.push(`${CHANGELOG}:${s.line}: ${s.version} lists no changes`);
  }
  return { sections, errors };
}

export function check({ version, changelog, tags, installedChangedSince, branch = "main", pullRequest }) {
  const errors = [];
  if (!parse(version)) errors.push(`${VERSION_FILE} says "${version}", not a semantic version (X.Y.Z)`);
  const { sections, errors: read } = parseChangelog(changelog);
  errors.push(...read);
  if (!sections.length) errors.push(`${CHANGELOG} has no "## [X.Y.Z] - YYYY-MM-DD" sections`);
  const valid = sections.filter((s) => parse(s.version));
  if (sections.filter((s) => s.version === UNRELEASED).length > 1) errors.push(`${CHANGELOG}: Unreleased appears twice`);
  const seen = new Set();
  for (const s of valid) {
    if (seen.has(s.version)) errors.push(`${CHANGELOG}:${s.line}: ${s.version} appears twice`);
    seen.add(s.version);
  }
  for (let i = 0; i + 1 < valid.length; i++) {
    const newer = valid[i], older = valid[i + 1];
    if (compare(newer.version, older.version) <= 0) {
      errors.push(`${CHANGELOG}:${newer.line}: ${newer.version} comes before ${older.version}; newest first`);
      continue;
    }
    if (newer.date < older.date) errors.push(`${CHANGELOG}:${newer.line}: ${newer.version} is dated before ${older.version}`);
    const kind = requiredBump(Object.keys(newer.categories)), want = bump(older.version, kind);
    if (newer.version !== want) {
      errors.push(`${CHANGELOG}:${newer.line}: after ${older.version}, a release with ${Object.keys(newer.categories).join(", ")} is a ${kind} bump: ${want}, not ${newer.version}`);
    }
  }
  if (parse(version) && valid.length && valid[0].version !== version) {
    errors.push(`${VERSION_FILE} says ${version}, but the newest ${CHANGELOG} section is ${valid[0].version}`);
  }
  const stable = stableTags(tags);
  for (const tag of stable) {
    if (!seen.has(tag)) errors.push(`tag v${tag} has no ${CHANGELOG} section`);
  }
  const latest = [...stable].sort(compare).at(-1);
  const waiting = sections.some((s) => s.version === UNRELEASED);
  if (branch === "develop") {
    if (!latest) errors.push("develop needs a stable tag to compute its next version");
    if (latest && parse(version)) {
      const ahead = valid.filter((s) => compare(s.version, latest) > 0);
      if (ahead.length > 1) errors.push(`${CHANGELOG}: develop prepares one version after v${latest}; found ${ahead.map((s) => s.version).join(", ")}`);
      if (version !== latest && !isCandidate(version, tags)) {
        errors.push(`${VERSION_FILE}: develop keeps ${latest} until the Release candidate workflow prepares the next version`);
      }
      for (const section of ahead) {
        if (!isCandidate(section.version, tags)) errors.push(`${CHANGELOG}: develop entries go under "## [${UNRELEASED}]"; only the Release candidate workflow writes a numbered section`);
      }
      if (installedChangedSince(latest) && !waiting && !ahead.length) errors.push(`what Kanso installs changed since v${latest}: add entries under "## [${UNRELEASED}]"`);
    }
    if (pullRequest) errors.push(...checkDevelopPullRequest({ ...pullRequest, changelog, tags }));
    return errors;
  }
  if (latest && parse(version)) {
    if (compare(version, latest) < 0) errors.push(`${VERSION_FILE} says ${version}, older than the released v${latest}`);
    else if (compare(version, latest) === 0 && installedChangedSince(latest) && !waiting) {
      errors.push(`what Kanso installs changed since v${latest}, but ${VERSION_FILE} still says ${version}: bump it and add its ${CHANGELOG} section, or list it under "## [${UNRELEASED}]" if it is technical debt, or the updater will never offer this change`);
    }
    if (compare(version, latest) > 0 && waiting) errors.push(`${version} is a new release: move the "## [${UNRELEASED}]" entries into its ${CHANGELOG} section`);
  }
  return errors;
}

export function isCandidate(version, tags) {
  return tags.some((tag) => {
    const rel = parseRelease(tag);
    return rel?.channel === "rc" && `${rel.major}.${rel.minor}.${rel.patch}` === version;
  });
}

export function nextVersion(changelog, tags) {
  const latest = stableTags(tags).sort(compare).at(-1);
  if (!latest) throw new Error("no stable tag to compute the next version from");
  const { sections, errors } = parseChangelog(changelog);
  if (errors.length) throw new Error(errors.join("; "));
  const pending = sections.filter((s) => s.version === UNRELEASED || (parse(s.version) && compare(s.version, latest) > 0));
  return pending.length ? bump(latest, requiredBump(pending.flatMap((s) => Object.keys(s.categories)))) : null;
}

const numberedHistory = (text, skip = 0) => {
  const lines = text.split("\n");
  const first = lines.map((line, i) => /^## \[\d/.test(line) ? i : -1).filter((i) => i >= 0)[skip];
  return first === undefined ? "" : lines.slice(first).join("\n");
};

export function checkDevelopPullRequest({ versionText, baseVersionText, changelog, baseChangelog, tags, installedChanged = false }) {
  const errors = [];
  const current = parseChangelog(changelog).sections;
  const base = parseChangelog(baseChangelog).sections;
  const latest = stableTags(tags).sort(compare).at(-1);
  const baseVersion = JSON.parse(baseVersionText).version;
  const version = JSON.parse(versionText).version;
  const legacy = base.filter((s) => parse(s.version) && latest && compare(s.version, latest) > 0);
  const migrated = latest && version === latest && parse(baseVersion) && compare(baseVersion, latest) > 0
    && !isCandidate(baseVersion, tags) && legacy.length === 1 && legacy[0].version === baseVersion
    && base[0] === legacy[0] && current[0]?.version === UNRELEASED && current[0].body === legacy[0].body
    && numberedHistory(changelog) === numberedHistory(baseChangelog, 1);
  if (migrated) return errors;
  if (versionText !== baseVersionText) errors.push(`${VERSION_FILE}: a pull request to develop must not change this file`);
  if (numberedHistory(changelog) !== numberedHistory(baseChangelog)) errors.push(`${CHANGELOG}: a pull request to develop must not change numbered sections; add entries under "## [${UNRELEASED}]"`);
  const pending = current.find((s) => s.version === UNRELEASED);
  const previous = base.find((s) => s.version === UNRELEASED);
  const addedEntry = pending && Object.entries(pending.categories).some(([category, entries]) => entries.some((entry) => !previous?.categories[category]?.includes(entry)));
  if (installedChanged && !addedEntry) {
    errors.push(`${CHANGELOG}: an installed change in a pull request needs entries under "## [${UNRELEASED}]"`);
  }
  return errors;
}

export function notes(changelog, version) {
  return parseChangelog(changelog).sections.find((s) => s.version === version)?.body ?? null;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

export function listTags() {
  return git(["tag", "--list", "v*"]).split("\n").map(bareRelease).filter(Boolean);
}

export function readVersion() {
  return JSON.parse(readFileSync(VERSION_FILE, "utf8")).version;
}

export function readChangelog() {
  return readFileSync(CHANGELOG, "utf8");
}

export function installedChangedSince(tag, { isTag = true, ignoreVersion = false } = {}) {
  const paths = ignoreVersion ? [...INSTALLED, `:(exclude)${VERSION_FILE}`] : INSTALLED;
  try { git(["diff", "--quiet", isTag ? `v${bareRelease(tag)}` : tag, "HEAD", "--", ...paths]); return false; }
  catch (error) { if (error.status === 1) return true; throw error; }
}

function main() {
  let version, changelog;
  try { version = readVersion(); }
  catch (e) { console.error(`error: ${VERSION_FILE} could not be read: ${e.message}`); process.exit(1); }
  try { changelog = readChangelog(); }
  catch (e) { console.error(`error: ${CHANGELOG} could not be read: ${e.message}`); process.exit(1); }
  if (process.argv.includes("--notes")) {
    const body = notes(changelog, version);
    if (body === null) { console.error(`${CHANGELOG} has no section for ${version}`); process.exit(1); }
    process.stdout.write(`${body}\n`);
    return;
  }
  const branch = versionBranch();
  const tags = listTags();
  let pullRequest;
  if (branch === "develop" && process.env.GITHUB_EVENT_NAME === "pull_request") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const base = event.pull_request.base.sha;
    pullRequest = {
      versionText: readFileSync(VERSION_FILE, "utf8"),
      baseVersionText: git(["show", `${base}:${VERSION_FILE}`]),
      baseChangelog: git(["show", `${base}:${CHANGELOG}`]),
      installedChanged: installedChangedSince(base, { isTag: false }),
    };
  }
  const errors = check({ version, changelog, tags, installedChangedSince, branch, pullRequest });
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  const latest = stableTags(tags).sort(compare).at(-1);
  if (branch === "develop") {
    console.log(`Kanso ${version}: versioned correctly for develop.`);
    return;
  }
  console.log(latest && compare(version, latest) === 0
    ? `Kanso ${version}: released as v${latest}, nothing new to release.`
    : `Kanso ${version}: versioned correctly; merging to main releases v${version}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
