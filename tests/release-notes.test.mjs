import assert from "node:assert/strict";
import test from "node:test";
import { check, nextVersion, requiredBump } from "../scripts/check-version.mjs";
import { releaseNotes } from "../scripts/release-plan.mjs";

const footer = "Report a problem: https://github.com/jlopezlira/herdr-kanso/issues/new?template=bug.yml";
const changes = "### Added\n\n- A feature.\n\n### Fixed\n\n- A bug.";
const intro = "Release candidate for 1.1.0. It becomes 1.1.0 stable if nothing blocks it.";
const log = (body) => `# Changelog\n\n## [1.1.0] - 2026-11-12\n\n${body}\n`;

test("Beta notes contain only Unreleased entries followed by the report link", () => {
  const pending = "### Fixed\n\n- Pending bug.\n\n### Upgrade\n\n- Restart first.";
  const changelog = `# Changelog\n\n## [Unreleased]\n\n${pending}\n\n${log(changes).replace("# Changelog\n\n", "")}`;
  assert.equal(releaseNotes({ kind: "beta", version: "1.1.0", changelog }), `${pending}\n\n${footer}`);
});

test("RC notes without Upgrade contain the introduction, Changes and report link", () => {
  assert.equal(releaseNotes({ kind: "rc", version: "1.1.0", changelog: log(changes) }), `${intro}\n\n## Changes\n\n${changes}\n\n${footer}`);
});

test("RC notes move Upgrade entries out of Changes and preserve their multiline details", () => {
  const entries = "- Back up settings.\n\n  Keep the copy until the update finishes.\n- Restart the app.";
  for (const body of [
    `### Upgrade\n\n${entries}\n\n${changes}`,
    `${changes}\n\n### Upgrade\n\n${entries}`,
    changes.replace("### Fixed", `### Upgrade\n\n${entries}\n\n### Fixed`),
  ]) {
    assert.equal(releaseNotes({ kind: "rc", version: "1.1.0", changelog: log(body) }), `${intro}\n\n## Changes\n\n${changes}\n\n## Before you update\n\n${entries}\n\n${footer}`);
  }
});

test("Upgrade is accepted on develop and in stable sections without raising the bump", () => {
  const stable = "## [1.0.0] - 2026-11-01\n\n### Added\n\n- First.\n";
  const upgrade = "### Upgrade\n\n- Restart the app.\n";
  const changelog = `## [Unreleased]\n\n${upgrade}\n${stable}`;
  const base = { tags: ["1.0.0"], installedChangedSince: () => true };
  assert.deepEqual(check({ ...base, version: "1.0.0", changelog, branch: "develop" }), []);
  assert.deepEqual(check({ ...base, version: "1.0.1", changelog: changelog.replace("## [Unreleased]", "## [1.0.1] - 2026-11-12") }), []);
  assert.equal(requiredBump(["Upgrade"]), "patch");
  assert.equal(requiredBump(["Upgrade", "Added"]), "minor");
  assert.equal(requiredBump(["Upgrade", "Removed"]), "major");
  assert.equal(nextVersion(changelog, base.tags), "1.0.1");
});

test("Stable notes keep their existing changelog format", () => {
  assert.equal(releaseNotes({ kind: "stable", version: "1.1.0", changelog: log(changes) }), changes);
});
