// Beta, release candidate and stable tags: which is newer, and which run may publish one.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { channelOf, compareReleases, hostInstall, installedRelease, newestTag, offerRelease, parseRelease, stableStay } from "../kanso/mods/kanso-chrome/release.js";
import { planRelease } from "../scripts/release-plan.mjs";

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

const beta = (over = {}) => planRelease({ kind: "beta", branch: "develop", version: "1.2.0", tags: ["1.1.0"], installedChangedSince: () => true, ...over });

test("A beta is the next number for that version, and it is skipped when nothing installed changed", () => {
  const seen = [];
  assert.deepEqual(beta({ installedChangedSince: (tag) => { seen.push(tag); return true; } }), { action: "release", tag: "v1.2.0-beta.1", title: "Kanso 1.2.0-beta.1", prerelease: true, message: "publish v1.2.0-beta.1" });
  assert.deepEqual(seen, ["1.1.0"], "the first beta is compared with the newest stable tag");
  assert.deepEqual(beta({ installedChangedSince: () => false }), { action: "skip", message: "what Kanso installs has not changed since v1.1.0; no beta." });
  const again = [];
  assert.equal(beta({ tags: ["v1.1.0", "v1.2.0-beta.1", "1.2.0-beta.2", "v1.2.0-beta.10", "v1.2.0-rc.3"], installedChangedSince: (tag) => { again.push(tag); return true; } }).tag, "v1.2.0-beta.11");
  assert.deepEqual(again, ["1.2.0-beta.10"], "a release candidate is not the mark a beta compares against");
  assert.equal(beta({ tags: ["1.1.0", "1.2.0-beta.2"], installedChangedSince: () => false }).action, "skip");
  assert.equal(beta({ tags: ["1.1.0", "1.2.0-beta.1", "1.2.0-beta.4"] }).tag, "v1.2.0-beta.5", "a missing number is not reused");
  let called = false;
  assert.equal(beta({ tags: [], installedChangedSince: () => { called = true; return false; } }).tag, "v1.2.0-beta.1");
  assert.equal(called, false, "with no earlier tag there is nothing to compare");
  called = false;
  assert.deepEqual(beta({ tags: ["v1.2.0", "1.2.0-beta.1"], installedChangedSince: () => { called = true; return true; } }), { action: "skip", message: "v1.2.0 is already stable; no beta." });
  assert.equal(called, false);
  assert.deepEqual(beta({ branch: "main" }), { action: "fail", message: "a beta is published only from develop (this is main)" });
  assert.match(beta({ branch: "" }).message, /unknown branch/);
  assert.equal(beta({ version: "1.2.0-beta.1" }).action, "fail");
});

test("A release candidate is published only from develop, and never for a version that is already stable", () => {
  let called = false;
  assert.deepEqual(planRelease({ kind: "rc", branch: "develop", version: "1.2.0", tags: ["1.1.0", "1.2.0-beta.4", "v1.2.0-rc.1", "1.2.0-rc.2"], installedChangedSince: () => { called = true; return false; } }), { action: "release", tag: "v1.2.0-rc.3", title: "Kanso 1.2.0-rc.3", prerelease: true, message: "publish v1.2.0-rc.3" });
  assert.equal(called, false, "a release candidate is cut by hand, even when the files match a beta");
  assert.deepEqual(planRelease({ kind: "rc", branch: "develop", version: "1.2.0", tags: ["v1.2.0"], installedChangedSince: () => true }), { action: "fail", message: "v1.2.0 is already stable; refusing a release candidate" });
  assert.match(planRelease({ kind: "rc", branch: "main", version: "1.2.0", tags: [], installedChangedSince: () => true }).message, /only from develop/);
});

test("A stable tag is published only from main, and a prerelease of that version does not count as it", () => {
  assert.deepEqual(planRelease({ kind: "stable", branch: "main", version: "1.2.0", tags: ["1.1.0", "1.2.0-beta.3", "1.2.0-rc.1"], installedChangedSince: () => false }), { action: "release", tag: "v1.2.0", title: "Kanso 1.2.0", prerelease: false, message: "publish v1.2.0" });
  assert.deepEqual(planRelease({ kind: "stable", branch: "main", version: "1.2.0", tags: ["v1.2.0"], installedChangedSince: () => true }), { action: "skip", message: "v1.2.0 is already released." });
  assert.deepEqual(planRelease({ kind: "stable", branch: "develop", version: "1.2.0", tags: [], installedChangedSince: () => true }), { action: "fail", message: "a stable release is published only from main (this is develop)" });
});

test("Workflows publish a beta from develop, a release candidate on demand, and a stable release from main", async () => {
  const read = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
  const ci = await read("ci.yml");
  assert.match(ci, /branches: \[main, develop\]/);
  assert.match(ci, /KANSO_BRANCH: \$\{\{ github\.event_name == 'pull_request' && github\.base_ref \|\| github\.ref_name \}\}/);
  const release = await read("release.yml");
  assert.match(release, /branches: \[main\]/);
  assert.match(release, /release-plan\.mjs stable/);
  assert.doesNotMatch(release, /workflow_dispatch/);
  assert.doesNotMatch(release, /--prerelease/);
  const betaWorkflow = await read("beta.yml");
  assert.match(betaWorkflow, /branches: \[develop\]/);
  assert.match(betaWorkflow, /release-plan\.mjs beta/);
  assert.match(betaWorkflow, /--prerelease/);
  assert.doesNotMatch(betaWorkflow, /workflow_dispatch/);
  const rc = await read("rc.yml");
  assert.match(rc, /workflow_dispatch/);
  assert.match(rc, /release-plan\.mjs rc/);
  assert.match(rc, /--prerelease/);
  assert.doesNotMatch(rc, /\n\s*push:/);
  const pages = await read("pages.yml");
  assert.match(pages, /branches: \[main\]/);
  assert.match(pages, /the site deploys only from main/);
  assert.doesNotMatch(pages, /develop/);
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
