import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { committedRepo, exec, gitOk, stdoutOf } from "./helpers.mjs";
import { makeReleaseKey, releaseNamespace } from "./release-fixture.mjs";

const signer = fileURLToPath(new URL("../scripts/release-sign.mjs", import.meta.url));
const signersPath = "kanso/mods/kanso-tabs/allowed_signers";
const git = gitOk();
const sign = ({ dir, repo }, tag, key = "") => exec(process.execPath, [signer, tag, dir], {
  cwd: repo,
  env: { ...process.env, SIGNING_KEY: "", KANSO_RELEASE_KEY_FILE: key },
});

const refused = (result, message) => {
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, message);
};

const commitTrust = async ({ repo }, key, text) => {
  await mkdir(join(repo, "kanso/mods/kanso-tabs"), { recursive: true });
  await writeFile(join(repo, signersPath), key.allowedSigners);
  await writeFile(join(repo, "readme"), text);
  await git(repo, "add", "--", signersPath, "readme");
  await git(repo, "commit", "-m", text);
};

test("The release signer refuses a non-release tag", async (t) => {
  const fixture = await committedRepo(t);
  const key = await makeReleaseKey(join(fixture.dir, "signing-key"));
  refused(await sign(fixture, "nightly", key.path), /nightly is not a release tag/);
});

test("The release signer refuses a release without a signing key", async (t) => {
  const fixture = await committedRepo(t);
  refused(await sign(fixture, "v1.2.3"), /no signing key/);
});

for (const tagged of [true, false]) {
  const source = tagged ? "tagged commit" : "HEAD commit if the tag does not exist";
  test(`The release signer archives and signs the ${source}`, async (t) => {
    const fixture = await committedRepo(t);
    const tag = "v1.2.3";
    const key = await makeReleaseKey(join(fixture.dir, "signing-key"));
    const other = await makeReleaseKey(join(fixture.dir, "other-key"));
    if (!tagged) await commitTrust(fixture, other, "Earlier commit");
    const text = tagged ? "Tagged commit" : "Head commit";
    await commitTrust(fixture, key, text);
    if (tagged) {
      await git(fixture.repo, "tag", tag);
      await commitTrust(fixture, other, "Later commit");
    } else {
      await writeFile(join(fixture.repo, signersPath), other.allowedSigners);
    }

    const result = await sign(fixture, tag, key.path);
    assert.equal(result.code, 0, result.stderr);
    const archive = join(fixture.dir, `kanso-${tag}.tar.gz`);
    const signature = `${archive}.sig`;
    const prefix = "herdr-kanso-1.2.3/";
    const entries = (await stdoutOf("tar", ["-tzf", archive])).split(/\r?\n/);
    assert.equal(entries[0], prefix);
    assert.ok(entries.every((entry) => entry.startsWith(prefix)));
    const extract = (path) => stdoutOf("tar", ["-xOf", archive, `${prefix}${path}`]);
    assert.equal(await extract("readme"), text);
    const trust = await extract(signersPath);
    assert.equal(trust, key.allowedSigners.trim());
    const allowed = join(fixture.dir, "archive-signers");
    await writeFile(allowed, `${trust}\n`);
    execFileSync("ssh-keygen", [
      "-Y", "verify", "-f", allowed, "-I", releaseNamespace, "-n", releaseNamespace, "-s", signature,
    ], { input: await readFile(archive), stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  });
}

test("The release signer refuses a key that the archived commit does not trust", async (t) => {
  const fixture = await committedRepo(t);
  const key = await makeReleaseKey(join(fixture.dir, "signing-key"));
  const other = await makeReleaseKey(join(fixture.dir, "other-key"));
  await commitTrust(fixture, other, "Commit trusts another key");
  await writeFile(join(fixture.repo, signersPath), key.allowedSigners);
  refused(await sign(fixture, "v1.2.3", key.path), /ssh-keygen -Y verify/);
});
