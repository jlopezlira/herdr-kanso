import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { REPORT_LINE } from "../scripts/release-plan.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const versionFile = "kanso/mods/kanso-chrome/version.json";
const stable = "## [1.1.0] - 2026-11-01\n\n### Added\n\n- Stable.\n";
const footer = REPORT_LINE;
const rcIntro = "Release candidate for 1.2.0. It becomes 1.2.0 stable if nothing blocks it.";
const pending = "### Added\n\n- Feature.\n\n  Detail kept in release notes.";

const releaseFixture = (t) => {
  const root = mkdtempSync(join(project, ".release-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => writeFileSync(join(root, path), text);
  const read = (path) => readFileSync(join(root, path), "utf8");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (message) => {
    git("add", ".");
    git("-c", "user.name=Release", "-c", "user.email=release@example.test", "commit", "-m", message);
  };
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "kanso/mods/kanso-chrome"), { recursive: true });
  for (const path of [".gitattributes", "scripts/check-version.mjs", "scripts/release-plan.mjs", "scripts/release-tag.mjs", "kanso/mods/kanso-chrome/release.js"]) copyFileSync(join(project, path), join(root, path));
  write("package.json", '{"type":"module"}\n');
  write(".gitignore", "output\nkanso-release-notes.md\nevent.json\nremote.git/\n");
  write(versionFile, '{ "version": "1.1.0" }\n');
  write("CHANGELOG.md", `# Changelog\n\n${stable}`);
  git("init", "-b", "develop");
  git("config", "user.name", "Release");
  git("config", "user.email", "release@example.test");
  commit("Stable");
  git("tag", "v1.1.0");
  const env = { ...process.env, KANSO_BRANCH: "develop", GITHUB_EVENT_NAME: "push", GITHUB_OUTPUT: join(root, "output"), RUNNER_TEMP: root };
  const node = (script, args = [], extra = {}) => {
    write("output", "");
    return spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" });
  };
  const run = (script, args = [], extra = {}) => {
    const result = node(script, args, extra);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const addFeature = () => {
    write("CHANGELOG.md", `# Changelog\n\n## [Unreleased]\n\n${pending}\n\n${stable}`);
    write("kanso/mods/kanso-chrome/feature.js", "export const feature = true;\n");
    commit("Add feature");
  };
  const pushDevelop = () => {
    git("init", "--bare", join(root, "remote.git"));
    git("remote", "add", "origin", join(root, "remote.git"));
    git("push", "origin", "develop");
  };
  return { write, read, git, commit, node, run, root, addFeature, pushDevelop };
};

test("Workflow commands preserve PR history, publish computed notes and prepare successive RCs", (t) => {
  const { write, read, git, commit, run, node, root, addFeature, pushDevelop } = releaseFixture(t);
  git("tag", "v1.2.0-beta.13");
  const base = git("rev-parse", "HEAD");
  addFeature();
  pushDevelop();
  // The next release candidate prepared, and the version file it leaves.
  const prepareRc = () => {
    run("release-plan", ["rc", "--prepare"]);
    return read(versionFile);
  };
  const checkedBeta = () => {
    run("check-version", [], pr);
    run("release-plan", ["beta"]);
  };
  write("event.json", JSON.stringify({ pull_request: { base: { sha: base } } }));
  const pr = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: join(root, "event.json") };
  run("check-version", [], pr);
  write(versionFile, '{ "version": "1.2.0" }\n');
  assert.match(node("check-version", [], pr).stderr, /must not change this file/);
  write(versionFile, '{ "version": "1.1.0" }\n');
  const original = read("CHANGELOG.md");
  write("CHANGELOG.md", original.replace("Stable.", "Edited stable."));
  assert.match(node("check-version", [], pr).stderr, /must not change numbered sections/);
  write("CHANGELOG.md", original);
  run("release-plan", ["beta"]);
  assert.match(read("output"), /tag=v1\.2\.0-beta\.14\n/);
  assert.equal(read("kanso-release-notes.md"), `${pending}\n\n${footer}\n`);
  assert.equal(read(versionFile), '{ "version": "1.1.0" }\n');
  assert.equal(read("CHANGELOG.md"), original);
  const developHead = git("rev-parse", "develop");
  run("release-tag", ["v1.2.0-beta.14"]);
  const betaCommit = git("rev-parse", "v1.2.0-beta.14");
  assert.equal(git("rev-parse", `${betaCommit}^`), developHead);
  assert.equal(git("diff", "--name-only", developHead, betaCommit), versionFile);
  assert.equal(JSON.parse(git("show", `v1.2.0-beta.14:${versionFile}`)).version, "1.2.0");
  assert.equal(JSON.parse(git("show", `develop:${versionFile}`)).version, "1.1.0");
  assert.equal(git("rev-parse", "develop"), developHead);
  git("push", "origin", "refs/tags/v1.2.0-beta.14");
  assert.equal(git("ls-remote", "origin", "refs/heads/develop").split("\t")[0], developHead);
  assert.equal(git("ls-remote", "origin", "refs/tags/v1.2.0-beta.14").split("\t")[0], betaCommit);
  git("checkout", "develop");
  assert.equal(read(versionFile), '{ "version": "1.1.0" }\n');
  run("release-plan", ["beta"]);
  assert.equal(read("output"), "action=skip\n", "the detached version stamp alone does not publish another beta");
  run("release-plan", ["rc", "--prepare"]);
  assert.match(read("output"), /tag=v1\.2\.0-rc\.1\n/);
  assert.equal(JSON.parse(read(versionFile)).version, "1.2.0");
  assert.ok(!read("CHANGELOG.md").includes("[Unreleased]"));
  assert.ok(read("CHANGELOG.md").endsWith(stable));
  commit("Prepare release candidate");
  const candidateHead = git("rev-parse", "HEAD");
  run("release-tag", ["v1.2.0-rc.1"]);
  assert.equal(git("rev-parse", "v1.2.0-rc.1"), candidateHead);
  git("push", "--atomic", "origin", "HEAD:refs/heads/develop", "refs/tags/v1.2.0-rc.1");
  const fixedVersion = read(versionFile), fixedLog = read("CHANGELOG.md");
  run("check-version");
  assert.equal(prepareRc(), fixedVersion);
  assert.equal(read("CHANGELOG.md"), fixedLog);
  assert.match(read("output"), /tag=v1\.2\.0-rc\.2\n/);
  const fixedBase = git("rev-parse", "HEAD");
  write("CHANGELOG.md", fixedLog.replace("## [1.2.0]", "## [Unreleased]\n\n### Fixed\n\n- Bug.\n\n## [1.2.0]"));
  write("kanso/mods/kanso-chrome/feature.js", "export const feature = false;\n");
  commit("Fix feature");
  write("event.json", JSON.stringify({ pull_request: { base: { sha: fixedBase } } }));
  checkedBeta();
  assert.equal(read("kanso-release-notes.md"), `### Fixed\n\n- Bug.\n\n${footer}\n`);
  assert.match(read("output"), /tag=v1\.2\.0-rc\.2\n/, "a develop release after an RC is the next RC, which Early ranks above every beta");
  const fixHead = git("rev-parse", "develop");
  run("release-tag", ["v1.2.0-rc.2"]);
  assert.equal(git("rev-parse", "v1.2.0-rc.2"), fixHead, "the develop commit already has the candidate's core version");
  assert.equal(git("rev-parse", "develop"), fixHead);
  git("checkout", "develop");
  assert.equal(prepareRc(), fixedVersion);
  assert.match(read("CHANGELOG.md"), /- Feature\.[\s\S]*- Bug\./);
  assert.equal(read("kanso-release-notes.md"), `${rcIntro}\n\n## Changes\n\n${pending}\n\n### Fixed\n\n- Bug.\n\n${footer}\n`);
  assert.match(read("output"), /tag=v1\.2\.0-rc\.3\n/);
  commit("Update release candidate");
  run("release-tag", ["v1.2.0-rc.3"]);
  const minorHead = git("rev-parse", "HEAD");
  write("CHANGELOG.md", read("CHANGELOG.md").replace("## [1.2.0]", "## [Unreleased]\n\n### Removed\n\n- Old behavior.\n\n## [1.2.0]"));
  write("kanso/mods/kanso-chrome/feature.js", "export const feature = null;\n");
  commit("Remove old behavior");
  write("event.json", JSON.stringify({ pull_request: { base: { sha: minorHead } } }));
  checkedBeta();
  assert.match(read("output"), /tag=v2\.0\.0-beta\.1\n/);
  run("release-tag", ["v2.0.0-beta.1"]);
  assert.equal(JSON.parse(git("show", `v2.0.0-beta.1:${versionFile}`)).version, "2.0.0");
  assert.equal(JSON.parse(git("show", `develop:${versionFile}`)).version, "1.2.0");
  git("checkout", "develop");
  prepareRc();
  assert.match(read("output"), /tag=v2\.0\.0-rc\.1\n/);
  assert.equal(JSON.parse(read(versionFile)).version, "2.0.0");
  assert.ok(!read("CHANGELOG.md").includes("[1.2.0]"));
  assert.ok(!read("CHANGELOG.md").includes("[Unreleased]"));
  for (const entry of ["- Feature.", "- Bug.", "- Old behavior."]) assert.ok(read("CHANGELOG.md").includes(entry));
  assert.ok(read("CHANGELOG.md").endsWith(stable));
  commit("Prepare major release candidate");
  run("release-tag", ["v2.0.0-rc.1"]);
  run("check-version", [], { KANSO_BRANCH: "main" });
  run("release-plan", ["stable"], { KANSO_BRANCH: "main" });
  assert.match(read("output"), /tag=v2\.0\.0\n/);
  git("tag", "v2.0.0");
  write("CHANGELOG.md", read("CHANGELOG.md").replace("## [2.0.0]", "## [Unreleased]\n\n### Fixed\n\n- Next bug.\n\n## [2.0.0]"));
  write("kanso/mods/kanso-chrome/feature.js", "export const feature = true;\n");
  commit("Fix next bug");
  run("release-plan", ["beta"]);
  assert.match(read("output"), /tag=v2\.0\.1-beta\.1\n/);
  const stableHead = git("rev-parse", "develop");
  run("release-tag", ["v2.0.1-rc.1"]);
  assert.equal(git("rev-parse", "v2.0.1-rc.1^"), stableHead);
  assert.equal(JSON.parse(git("show", `v2.0.1-rc.1:${versionFile}`)).version, "2.0.1");
  assert.equal(JSON.parse(git("show", `develop:${versionFile}`)).version, "2.0.0");
});

const queuedDevelopFixture = (t) => {
  const { write, read, git, commit, node, run, addFeature, pushDevelop } = releaseFixture(t);
  addFeature();
  const green = git("rev-parse", "HEAD");
  write("CHANGELOG.md", read("CHANGELOG.md").replace(stable, `### Fixed\n\n- Follow-up.\n\n${stable}`));
  write("kanso/mods/kanso-chrome/feature.js", "export const feature = false;\n");
  commit("Fix feature");
  const newer = git("rev-parse", "HEAD");
  pushDevelop();
  const tag = "v1.2.0-beta.1";
  const plan = (sha, ref = sha) => {
    git("checkout", "--detach", ref);
    return node("release-plan", ["beta"], { KANSO_RELEASE_SHA: sha });
  };
  const publishNewer = () => {
    run("release-tag", [tag]);
    assert.equal(git("rev-parse", `${tag}^`), newer);
    git("push", "origin", `refs/tags/${tag}`);
  };
  return { read, green, newer, plan, publishNewer, tag };
};

test("A green develop run still publishes when a newer push has not released", (t) => {
  const { read, green, plan, tag } = queuedDevelopFixture(t);
  const planned = plan(green);
  assert.equal(planned.status, 0, planned.stderr);
  assert.ok(read("output").includes(`tag=${tag}\n`), planned.stdout);
});

test("A late develop run skips after an archive from a newer commit was published", (t) => {
  const { read, green, plan, publishNewer, tag } = queuedDevelopFixture(t);
  publishNewer();
  const planned = plan(green);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(planned.stdout.trim(), `${tag} was published from a newer commit; no beta.`);
  assert.equal(read("output"), "action=skip\n");
});

test("A develop run treats its own detached release tag as unchanged, not newer", (t) => {
  const { read, newer, plan, publishNewer, tag } = queuedDevelopFixture(t);
  publishNewer();
  const planned = plan(newer);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(planned.stdout.trim(), `what Kanso installs has not changed since ${tag}; no beta.`);
  assert.equal(read("output"), "action=skip\n");
});

test("A develop run fails rather than skipping when its release commit is unknown", (t) => {
  const { read, green, plan } = queuedDevelopFixture(t);
  const unknown = "f".repeat(green.length);
  const planned = plan(unknown, green);
  assert.equal(planned.status, 1, planned.stdout);
  assert.ok(planned.stderr.includes(unknown), planned.stderr);
  assert.equal(read("output"), "");
});

test("The release planner refuses a beta whose planned tag is not a release version", (t) => {
  const { read, git, node, addFeature } = releaseFixture(t);
  git("tag", "v1.2.0-beta.1000000000000000000000");
  addFeature();

  const planned = node("release-plan", ["beta"]);
  assert.equal(planned.status, 1, planned.stdout);
  assert.match(planned.stderr, /is not vX\.Y\.Z, vX\.Y\.Z-beta\.N or vX\.Y\.Z-rc\.N/);
  assert.equal(read("output"), "");
});
