import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { check, parseChangelog, requiredBump, notes, versionBranch } from "../scripts/check-version.mjs";

const log = (...sections) => `# Changelog\n\n${sections.join("\n")}`;
const section = (v, date, body) => `## [${v}] - ${date}\n\n${body}\n`;
const ok = { tags: [], installedChangedSince: () => false };

test("The repository's own versioning passes", async () => {
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const { version } = JSON.parse(await readFile(new URL("../kanso/mods/kanso-chrome/version.json", import.meta.url), "utf8"));
  // Its version as the newest tag: technical debt waiting under Unreleased is then in order (npm run check:version reads the real tags).
  assert.deepEqual(check({ version, changelog, tags: ["1.0.0", version], installedChangedSince: () => false }), []);
  assert.equal(parseChangelog(changelog).sections.at(-1).version, "1.0.0", "history down to the first release");
});

test("Each release is the exact semantic successor of the one before", () => {
  assert.equal(requiredBump(["Fixed", "Changed"]), "patch");
  assert.equal(requiredBump(["Fixed", "Added"]), "minor");
  assert.equal(requiredBump(["Added", "Removed"]), "major");
  const base = section("1.0.0", "2026-11-01", "### Added\n\n- First.");
  const run = (v, body) => check({ version: v, changelog: log(section(v, "2026-11-02", body), base), ...ok });
  assert.deepEqual(run("1.0.1", "### Fixed\n\n- A bug."), []);
  assert.deepEqual(run("1.1.0", "### Added\n\n- A feature."), []);
  assert.deepEqual(run("2.0.0", "### Breaking\n\n- A key moved."), []);
  assert.match(run("1.1.0", "### Fixed\n\n- A bug.").join(), /patch bump: 1\.0\.1, not 1\.1\.0/);
  assert.match(run("1.0.1", "### Added\n\n- A feature.").join(), /minor bump: 1\.1\.0, not 1\.0\.1/);
  assert.match(run("1.2.0", "### Added\n\n- A feature.").join(), /minor bump: 1\.1\.0, not 1\.2\.0/, "no skipped versions");
});

test("A change to what Kanso installs needs a new version and its section", () => {
  const changelog = log(section("1.0.0", "2026-11-01", "### Added\n\n- First."));
  const errors = check({ version: "1.0.0", changelog, tags: ["1.0.0"], installedChangedSince: () => true });
  assert.match(errors.join(), /changed since v1\.0\.0, but .* still says 1\.0\.0/);
  assert.deepEqual(check({ version: "1.0.0", changelog, tags: ["1.0.0"], installedChangedSince: () => false }), [], "docs-only changes need none");
  assert.match(check({ version: "1.1.0", changelog, ...ok }).join(), /says 1\.1\.0, but the newest CHANGELOG\.md section is 1\.0\.0/);
});

test("Technical debt merges without a version: listed under Unreleased, it goes out with the next release", () => {
  const one = section("1.0.0", "2026-11-01", "### Added\n\n- First.");
  const debt = "## [Unreleased]\n\n### Changed\n\n- One process reading instead of two.\n";
  const changed = { tags: ["1.0.0"], installedChangedSince: () => true };
  assert.deepEqual(check({ version: "1.0.0", changelog: log(debt, one), ...changed }), [], "a change to what Kanso installs, waiting under Unreleased");
  assert.match(check({ version: "1.0.0", changelog: log("## [Unreleased]\n", one), ...changed }).join(), /Unreleased lists no changes/, "an empty Unreleased lets nothing through");
  assert.match(check({ version: "1.0.0", changelog: log(one, debt), ...changed }).join(), /goes first/);
  const release = section("1.0.1", "2026-11-02", "### Changed\n\n- One process reading instead of two.");
  assert.deepEqual(check({ version: "1.0.1", changelog: log(release, one), ...changed }), [], "the next release takes the entries");
  assert.match(check({ version: "1.0.1", changelog: log(debt, release, one), ...changed }).join(), /move the "## \[Unreleased\]" entries into its CHANGELOG\.md section/, "and leaves nothing behind");
  assert.equal(notes(log(debt, one), "1.0.0"), "### Added\n\n- First.", "release notes never carry what waits");
});

test("The changelog keeps every release, newest first, in the agreed shape", () => {
  const one = section("1.0.0", "2026-11-01", "### Added\n\n- First.");
  const two = section("1.1.0", "2026-11-02", "### Added\n\n- Second.");
  assert.match(check({ version: "1.1.0", changelog: log(two), tags: ["1.0.0", "1.1.0"], installedChangedSince: () => false }).join(), /tag v1\.0\.0 has no CHANGELOG\.md section/);
  assert.match(check({ version: "1.1.0", changelog: log(one, two), ...ok }).join(), /newest first/);
  assert.match(check({ version: "1.0.0", changelog: log(section("1.0.0", "2026-11-01", "### Improved\n\n- x")), ...ok }).join(), /"Improved" is not one of/);
  assert.match(check({ version: "1.0.0", changelog: log(section("1.0.0", "2026-11-01", "Nothing.")), ...ok }).join(), /lists no changes/);
  assert.match(check({ version: "1.0", changelog: log("## [1.0] - 2026-11-01\n\n### Added\n\n- x\n"), ...ok }).join(), /not a semantic version/);
  assert.match(check({ version: "1.0.0", changelog: log("## 1.0.0\n"), ...ok }).join(), /a version heading reads/);
  assert.match(check({ version: "1.0.0", changelog: log(one), tags: ["1.1.0"], installedChangedSince: () => false }).join(), /older than the released v1\.1\.0/);
});

test("A prerelease tag is not a release, and develop prepares one next version", () => {
  const base = section("1.0.0", "2026-11-01", "### Added\n\n- First.");
  const same = { tags: ["1.0.0", "v2.0.0-beta.1", "2.0.0-rc.1"], installedChangedSince: () => false };
  assert.deepEqual(check({ version: "1.0.0", changelog: log(base), ...same }), [], "a beta or rc tag needs no section and is not the newest release");
  assert.deepEqual(check({ version: "1.0.0", changelog: log(base), tags: ["v1.0.0", "2.0.0-beta.1"], installedChangedSince: () => false, branch: "develop" }), []);
  assert.match(check({ version: "1.0.0", changelog: log(base), tags: ["1.0.0", "1.1.0", "1.1.0-beta.1"], installedChangedSince: () => false }).join(), /tag v1\.1\.0 has no CHANGELOG\.md section/);
  const next = section("1.1.0", "2026-11-02", "### Added\n\n- Second.");
  assert.deepEqual(check({ version: "1.1.0", changelog: log(next, base), tags: ["1.0.0", "1.1.0-beta.2", "1.1.0-rc.1"], installedChangedSince: () => true, branch: "develop" }), []);
  assert.match(check({ version: "1.2.0", changelog: log(section("1.2.0", "2026-11-02", "### Added\n\n- Second."), base), tags: ["1.0.0", "1.2.0-beta.1"], installedChangedSince: () => true, branch: "develop" }).join(), /minor bump: 1\.1\.0, not 1\.2\.0/);
  const patch = section("1.0.1", "2026-11-02", "### Fixed\n\n- A bug.");
  const minor = section("1.1.0", "2026-11-03", "### Added\n\n- Second.");
  const two = { version: "1.1.0", changelog: log(minor, patch, base), tags: ["1.0.0"], installedChangedSince: () => true };
  assert.deepEqual(check({ ...two, branch: "main" }), [], "main still allows every successor, tagged or not");
  assert.deepEqual(check({ ...two, branch: "develop" }), ["CHANGELOG.md: develop prepares one version after v1.0.0; found 1.1.0, 1.0.1"]);
});

test("The version rules follow the pull request's base branch, and otherwise stay on main", () => {
  assert.equal(versionBranch({ KANSO_BRANCH: "develop" }, ["node", "check-version.mjs"]), "develop");
  assert.equal(versionBranch({ KANSO_BRANCH: "main" }, ["node", "check-version.mjs", "--branch", "develop"]), "develop");
  assert.equal(versionBranch({}, ["node", "check-version.mjs"]), "main");
});

test("Release notes are the version's section", () => {
  const changelog = log(section("1.1.0", "2026-11-02", "### Added\n\n- Second."), section("1.0.0", "2026-11-01", "### Added\n\n- First."));
  assert.equal(notes(changelog, "1.1.0"), "### Added\n\n- Second.");
  assert.equal(notes(changelog, "9.9.9"), null);
});
