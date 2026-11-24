import assert from "node:assert/strict";
import { join } from "node:path";
import { fixtureSignatureRoute, hostFor, installed, staged, started, test, tree, version } from "./update-harness.mjs";

test("The updater installs a signed release after fetching its signature", async (t) => {
  const { f, cx } = await started(t);
  await installed(f, cx);
  assert.equal(await version(f.home), "1.1.0");
  assert.ok(f.requested.has(fixtureSignatureRoute), "the updater requested the signature asset");
});

const notSigned = /not signed with kansō's key/;
for (const [signature, description, error] of [
  ["tampered", "with one byte changed", notSigned],
  ["missing", "without a signature asset", /the release's signature could not be downloaded/],
  ["other-key", "signed by another key", notSigned],
]) {
  test(`The updater refuses a release ${description} without changing the install`, async (t) => {
    const { f, cx } = await started(t, { signature });
    const before = await tree(f.home);
    await f.updater.install(cx);
    assert.match(f.updater.error ?? "", error);
    assert.equal(await version(f.home), "1.0.0");
    assert.deepEqual(await tree(f.home), before);
    assert.deepEqual(await f.checks(), [], "the archive never reached the mod checker");
    assert.deepEqual(await staged(f.home), []);
  });
}

test("The Windows updater requires ssh-keygen and verifies the archive from standard input before extracting", async () => {
  const { windowsInstallScript } = await hostFor("windows");
  const home = join("C:/app", "O'Brien home");
  const dir = join(home, ".kanso-updates");
  const script = windowsInstallScript({ home, dir }, join(dir, "op.ps1"));
  const verify = script.match(/^\s*\$verify = Start-Process -FilePath 'ssh-keygen\.exe' .* -RedirectStandardInput \$tarball .+$/m);
  assert.ok(verify, "Start-Process supplies the archive as standard input to ssh-keygen");
  const requireTool = script.indexOf("Require-Tool 'ssh-keygen'");
  const extract = script.indexOf("& tar.exe");
  assert.ok(requireTool >= 0 && requireTool < verify.index && verify.index < extract);
});
