// Beta, release candidate and stable tags: which is newer, and which run may publish one.
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { channelOf, compareReleases, hostInstall, installedRelease, newestTag, offerRelease, parseRelease, stableStay } from "../kanso/mods/kanso-chrome/release.js";
import { planRelease, prepareCandidate } from "../scripts/release-plan.mjs";

const order = ["1.0.0-beta.1", "1.0.0-beta.2", "1.0.0-beta.10", "1.0.0-rc.1", "1.0.0-rc.2", "1.0.0", "1.0.1-beta.1", "1.1.0-rc.1", "1.1.0", "2.0.0-beta.1", "2.0.0"];

test("A beta is older than its release candidate, and both are older than the stable version", () => {
  assert.deepEqual([...order].reverse().sort(compareReleases), order);
  assert.ok(compareReleases("v1.2.0-beta.9", "1.2.0-rc.1") < 0);
  assert.ok(compareReleases("2.0.0-beta.1", "1.9.9") > 0, "a prerelease of a higher version is newer than a lower stable");
  assert.ok(compareReleases("1.0.0-rc.4", "v1.0.0") < 0);
  assert.equal(compareReleases("1.0.0", "1.0.0"), 0);
  assert.equal(compareReleases("1.0.0-beta.2", "v1.0.0-beta.2"), 0);
  assert.equal(parseRelease("1.0.0-alpha.1"), null);
  assert.equal(parseRelease("1.0.0-beta"), null);
  assert.equal(parseRelease("01.0.0"), null);
  assert.equal(compareReleases("nope", "1.0.0"), null);
  assert.deepEqual(parseRelease("v1.2.3-rc.4"), { major: 1, minor: 2, patch: 3, channel: "rc", n: 4 });
  assert.deepEqual(parseRelease("1.2.3"), { major: 1, minor: 2, patch: 3, channel: null, n: null });
});

const stableLog = "## [1.1.0] - 2026-11-01\n\n### Added\n\n- Stable.\n";
const pendingLog = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature.\n\n${stableLog}`;
const beta = (over = {}) => planRelease({ kind: "beta", branch: "develop", version: "1.1.0", changelog: pendingLog, tags: ["1.1.0"], installedChangedSince: () => true, ...over });

test("A beta computes its version from stable and Unreleased, and continues existing numbers", () => {
  const seen = [];
  assert.deepEqual(beta({ installedChangedSince: (tag) => { seen.push(tag); return true; } }), { action: "release", tag: "v1.2.0-beta.1", title: "Kanso 1.2.0-beta.1", prerelease: true, message: "publish v1.2.0-beta.1" });
  assert.deepEqual(seen, ["1.1.0"]);
  assert.equal(beta({ tags: ["v1.1.0", "v1.2.0-beta.1", "1.2.0-beta.2", "v1.2.0-beta.13"] }).tag, "v1.2.0-beta.14");
  assert.equal(beta({ tags: ["1.1.0", "1.2.0-beta.1", "1.2.0-beta.4"] }).tag, "v1.2.0-beta.5");
  const again = [];
  assert.equal(beta({ tags: ["1.1.0", "1.2.0-beta.10"], installedChangedSince: (tag) => { again.push(tag); return true; } }).tag, "v1.2.0-beta.11");
  assert.deepEqual(again, ["1.2.0-beta.10"]);
  for (const [category, next] of [["Removed", "2.0.0"], ["Breaking", "2.0.0"], ["Deprecated", "1.2.0"], ["Fixed", "1.1.1"], ["Changed", "1.1.1"], ["Security", "1.1.1"]]) {
    assert.equal(beta({ changelog: pendingLog.replace("### Added", `### ${category}`) }).tag, `v${next}-beta.1`);
  }
  assert.equal(beta({ version: "3.30.0", tags: ["v3.30.0", "v3.31.0-beta.13"], changelog: pendingLog.replaceAll("1.1.0", "3.30.0") }).tag, "v3.31.0-beta.14");
});

test("A beta skips unchanged installs and missing entries, and refuses the wrong branch or missing stable baseline", () => {
  assert.deepEqual(beta({ installedChangedSince: () => false }), { action: "skip", message: "what Kanso installs has not changed since v1.1.0; no beta." });
  assert.equal(beta({ tags: ["1.1.0", "1.2.0-beta.2"], installedChangedSince: () => false }).action, "skip");
  assert.deepEqual(beta({ changelog: stableLog }), { action: "skip", message: "no Unreleased entries; no beta." });
  assert.equal(beta({ tags: [] }).action, "fail");
  assert.deepEqual(beta({ branch: "main" }), { action: "fail", message: "a beta is published only from develop (this is main)" });
  assert.match(beta({ branch: "" }).message, /unknown branch/);
  assert.equal(beta({ version: "1.2.0-beta.1" }).action, "fail");
});

test("The first RC moves Unreleased, fixes the version, and keeps stable history", () => {
  const input = { version: "1.1.0", changelog: pendingLog, tags: ["v1.1.0", "v1.2.0-beta.13"], date: "2026-11-12" };
  const candidate = prepareCandidate(input);
  assert.equal(candidate.version, "1.2.0");
  assert.equal(candidate.changelog, `# Changelog\n\n## [1.2.0] - 2026-11-12\n\n### Added\n\n- Feature.\n\n${stableLog}`);
  assert.equal(planRelease({ ...input, kind: "rc", branch: "develop" }).tag, "v1.2.0-rc.1");
  assert.equal(planRelease({ ...input, kind: "rc", branch: "main" }).action, "fail");
  assert.equal(planRelease({ ...input, kind: "rc", branch: "develop", changelog: stableLog }).action, "fail");
});

test("Later RCs retain the version when the combined categories need no larger bump", () => {
  const first = prepareCandidate({ version: "1.1.0", changelog: pendingLog, tags: ["1.1.0"], date: "2026-11-02" });
  const tags = ["1.1.0", "1.2.0-beta.13", "1.2.0-rc.1", "v1.2.0-rc.2"];
  assert.deepEqual(prepareCandidate({ ...first, tags, date: "2026-11-12" }), first, "no entries means no file changes");
  assert.equal(planRelease({ ...first, tags, kind: "rc", branch: "develop" }).tag, "v1.2.0-rc.3");
  const pending = "## [Unreleased]\n\n### Fixed\n\n- Bug.\n\n  More detail.\n\n### Added\n\n- Another feature.\n\n";
  const changelog = first.changelog.replace("## [1.2.0]", `${pending}## [1.2.0]`);
  const merged = prepareCandidate({ ...first, changelog, tags, date: "2026-11-12" });
  assert.equal(merged.version, "1.2.0");
  assert.ok(merged.changelog.includes("## [1.2.0] - 2026-11-02"));
  assert.ok(merged.changelog.includes("- Feature.\n- Another feature."));
  assert.ok(merged.changelog.includes("- Bug.\n\n  More detail."));
  assert.ok(merged.changelog.endsWith(stableLog));
  assert.ok(!merged.changelog.includes("[Unreleased]"));
  assert.equal(planRelease({ ...first, changelog, tags, kind: "rc", branch: "develop" }).tag, "v1.2.0-rc.3");
  assert.equal(beta({ ...first, changelog, tags }).tag, "v1.2.0-beta.14");
  assert.equal(beta({ ...first, changelog: changelog.replace("### Added\n\n- Another feature.\n\n", ""), tags }).tag, "v1.2.0-beta.14", "Fixed entries keep the candidate's minor version");
});

test("A later RC recomputes all unreleased entries and renames a minor candidate for Breaking or Removed", () => {
  const first = prepareCandidate({ version: "1.1.0", changelog: pendingLog, tags: ["1.1.0"], date: "2026-11-02" });
  const tags = ["1.1.0", "1.2.0-rc.1", "1.2.0-rc.7"];
  for (const category of ["Breaking", "Removed"]) {
    const changelog = first.changelog.replace("## [1.2.0]", `## [Unreleased]\n\n### ${category}\n\n- Old behavior.\n\n## [1.2.0]`);
    const candidate = prepareCandidate({ ...first, changelog, tags });
    assert.equal(candidate.version, "2.0.0");
    assert.ok(candidate.changelog.includes("## [2.0.0]"));
    assert.ok(!candidate.changelog.includes("## [1.2.0]"));
    assert.ok(candidate.changelog.includes("- Feature."));
    assert.ok(candidate.changelog.includes("- Old behavior."));
    assert.ok(candidate.changelog.endsWith(stableLog));
    assert.equal(planRelease({ ...first, changelog, tags, kind: "rc", branch: "develop" }).tag, "v2.0.0-rc.1");
    assert.equal(beta({ ...first, changelog, tags }).tag, "v2.0.0-beta.1");
  }
  const patch = prepareCandidate({ version: "1.1.0", changelog: pendingLog.replace("### Added", "### Fixed"), tags: ["1.1.0"] });
  const changelog = patch.changelog.replace("## [1.1.1]", "## [Unreleased]\n\n### Deprecated\n\n- Old API.\n\n## [1.1.1]");
  assert.equal(planRelease({ ...patch, changelog, tags: ["1.1.0", "1.1.1-rc.3"], kind: "rc", branch: "develop" }).tag, "v1.2.0-rc.1");
});

test("A stable tag is published only from main, and a prerelease of that version does not count as it", () => {
  assert.deepEqual(planRelease({ kind: "stable", branch: "main", version: "1.2.0", tags: ["1.1.0", "1.2.0-beta.3", "1.2.0-rc.1"], installedChangedSince: () => false }), { action: "release", tag: "v1.2.0", title: "Kanso 1.2.0", prerelease: false, message: "publish v1.2.0" });
  assert.deepEqual(planRelease({ kind: "stable", branch: "main", version: "1.2.0", tags: ["v1.2.0"], installedChangedSince: () => true }), { action: "skip", message: "v1.2.0 is already released." });
  assert.deepEqual(planRelease({ kind: "stable", branch: "develop", version: "1.2.0", tags: [], installedChangedSince: () => true }), { action: "fail", message: "a stable release is published only from main (this is develop)" });
});

const workflows = new URL("../.github/workflows/", import.meta.url);
const workflow = (name) => readFile(new URL(name, workflows), "utf8");

test("Workflows publish a beta from develop, a release candidate on demand, and a stable release from main", async () => {
  const ci = await workflow("ci.yml");
  assert.match(ci, /branches: \[main, develop\]/);
  assert.match(ci, /KANSO_BRANCH: \$\{\{ github\.event_name == 'pull_request' && github\.base_ref \|\| github\.ref_name \}\}/);
  const stable = ci.slice(ci.indexOf("\n  stable:"));
  assert.match(stable, /needs: platform\n    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/, "a stable release waits for all three platforms");
  assert.match(stable, /release-plan\.mjs stable/);
  assert.doesNotMatch(stable, /--prerelease/);
  assert.deepEqual((await readdir(workflows)).sort(), ["ci.yml", "pages.yml", "rc.yml"], "no workflow publishes a stable release beside CI");
  const beta = ci.slice(ci.indexOf("\n  beta:"), ci.indexOf("\n  stable:"));
  assert.match(beta, /needs: platform\n    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop'/, "a beta waits for all three platforms");
  assert.match(beta, /release-plan\.mjs beta/);
  assert.match(beta, /--prerelease/);
  assert.match(beta, /release-tag\.mjs "\$RELEASE_TAG"/);
  assert.match(beta, /git push origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(beta, /--verify-tag/);
  assert.doesNotMatch(beta, /--target|HEAD:refs\/heads\/develop/);
  assert.doesNotMatch(ci, /workflow_dispatch/);
  const rc = await workflow("rc.yml");
  assert.match(rc, /workflow_dispatch/);
  assert.match(rc, /release-plan\.mjs rc/);
  assert.match(rc, /--prerelease/);
  assert.doesNotMatch(rc, /\n\s*push:/);
  const pages = await workflow("pages.yml");
  assert.match(pages, /branches: \[main\]/);
  assert.match(pages, /the site deploys only from main/);
  assert.doesNotMatch(pages, /develop/);
});

test("CI drops only a pull request's older run, and every job of every workflow has a time limit", async () => {
  const ci = await workflow("ci.yml");
  assert.match(ci, /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  for (const name of await readdir(workflows)) {
    const text = await workflow(name);
    const jobs = text.slice(text.indexOf("\njobs:")).match(/^  [\w-]+:$/gm);
    assert.equal(text.match(/^    timeout-minutes: \d+$/gm)?.length, jobs.length, name);
  }
});

test("Windows runs its tests in three shards, each on its own runner, and the other platforms in one", async () => {
  const ci = await workflow("ci.yml");
  for (const n of [1, 2, 3]) assert.match(ci, new RegExp(`os: windows-latest, shard: "${n}/3"`));
  assert.equal(ci.match(/os: windows-latest/g).length, 3);
  assert.match(ci, /run: npm test\$\{\{ matrix\.shard && format\(' -- --test-shard=\{0\}', matrix\.shard\) \|\| '' \}\}/);
});

const remote = (tags) => tags.map((tag, i) => `${i}\trefs/tags/${/^\d/.test(tag) ? `v${tag}` : tag}`).join("\n");
const mixed = remote(["3.29.0", "3.30.0-beta.1", "3.30.0-beta.2", "3.30.0-rc.1", "3.30.0", "3.31.0-beta.1", "nightly", "v2.0.0-beta"]);

test("Stable takes the newest finished release, and Early takes the newest of beta, rc and stable", () => {
  assert.equal(newestTag(mixed), "3.30.0");
  assert.equal(newestTag(mixed, "stable"), "3.30.0");
  assert.equal(newestTag(mixed, "beta"), "3.31.0-beta.1");
  assert.equal(newestTag(mixed, "nightly"), "3.30.0");
  assert.equal(newestTag(""), null);
  assert.equal(newestTag(remote(["3.30.0-beta.2", "3.30.0-rc.1"]), "stable"), null);
});

test("Early walks beta, then rc, then stable, and offers the newest when later tags exist", () => {
  const offer = (tags, have) => offerRelease(newestTag(remote(tags), "beta"), have, "beta");
  assert.equal(offer(["3.30.0-beta.1", "3.30.0-beta.2"], "3.30.0-beta.1"), "3.30.0-beta.2");
  assert.equal(offer(["3.30.0-beta.1", "3.30.0-beta.2", "3.30.0-rc.1"], "3.30.0-beta.2"), "3.30.0-rc.1");
  assert.equal(offer(["3.30.0-beta.2", "3.30.0-rc.1", "3.30.0"], "3.30.0-rc.1"), "3.30.0");
  assert.equal(offer(["3.30.0-beta.1", "3.30.0-beta.2", "3.30.0-rc.1", "3.30.0", "3.31.0-beta.1"], "3.30.0-beta.1"), "3.31.0-beta.1");
});

test("Stable ignores prereleases, and a beta already installed is offered only a stable that reaches it", () => {
  assert.equal(offerRelease("3.31.0-beta.1", "3.30.0", "stable"), null);
  assert.equal(offerRelease(newestTag(mixed, "stable"), "3.30.0-beta.2", "stable"), "3.30.0");
  assert.equal(offerRelease(newestTag(remote(["3.30.0-beta.2", "3.30.0", "3.31.0"]), "stable"), "3.30.0-beta.2", "stable"), "3.31.0");
  assert.equal(offerRelease(newestTag(remote(["3.29.0", "3.30.0-beta.2"]), "stable"), "3.30.0-beta.2", "stable"), null);
});

test("Nothing older is offered, on either channel", () => {
  assert.equal(offerRelease(newestTag(remote(["3.30.0-beta.1", "3.30.0-beta.2", "3.30.0"]), "beta"), "3.30.0", "beta"), null);
  assert.equal(offerRelease(newestTag(remote(["3.30.0", "3.31.0-beta.1"]), "stable"), "3.31.0-beta.1", "stable"), null);
  assert.equal(offerRelease(newestTag(remote(["3.30.0-beta.1", "3.30.0-beta.2"]), "beta"), "3.30.0-rc.1", "beta"), null);
  assert.equal(offerRelease("3.29.0", "3.30.0-beta.2", "stable"), null);
  assert.equal(offerRelease("3.30.0-beta.2", "3.30.0-beta.2", "beta"), null);
  assert.equal(stableStay("3.30.0", "3.30.0-beta.2", "3.29.0"), "You stay on 3.30.0-beta.2 until Stable reaches it");
  assert.equal(stableStay("3.30.0", "3.30.0-beta.2", "3.30.0"), null);
  assert.equal(stableStay("3.30.0", "3.30.0-beta.2", "3.31.0"), null);
  assert.equal(stableStay("3.30.0", null, "3.29.0"), null);
});

test("An install is downloaded by its tag and checked as X.Y.Z, and the channel defaults to stable", () => {
  assert.deepEqual(hostInstall("3.30.0-beta.2", "3.30.0"), { tag: "3.30.0-beta.2", want: "3.30.0", from: "3.30.0" });
  assert.deepEqual(hostInstall("v3.30.0-rc.1"), { tag: "3.30.0-rc.1", want: "3.30.0", from: null });
  assert.deepEqual(hostInstall("3.30.0", "3.29.0"), { tag: "3.30.0", want: "3.30.0", from: "3.29.0" });
  assert.equal(hostInstall("nightly"), null);
  assert.equal(hostInstall("3.30.0-beta"), null);
  for (const value of [undefined, null, "", "nightly", "Stable", "early", "stable"]) assert.equal(channelOf(value), "stable");
  assert.equal(channelOf("beta"), "beta");
  assert.equal(installedRelease("3.30.0", null), "3.30.0");
  assert.equal(installedRelease("3.30.0", "3.30.0-beta.2"), "3.30.0-beta.2");
  assert.equal(installedRelease("v3.30.0", "v3.30.0-beta.2"), "3.30.0-beta.2");
  assert.equal(installedRelease("3.31.0", "3.30.0-beta.2"), "3.31.0");
  assert.equal(installedRelease("3.30.0", "nope"), "3.30.0");
  assert.equal(installedRelease("3.30.0-beta.2", null), null);
});
