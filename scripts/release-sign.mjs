#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const NAMESPACE = "kanso-release";
export const SIGNERS = "kanso/mods/kanso-tabs/allowed_signers";
const TAG = /^v\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/;

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options });
const commitOf = (tag) => {
  try { return run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]).trim(); }
  catch { return run("git", ["rev-parse", "HEAD"]).trim(); }
};

export function signRelease(tag, out, { key = process.env.SIGNING_KEY ?? "", keyFile = process.env.KANSO_RELEASE_KEY_FILE ?? "" } = {}) {
  if (!TAG.test(tag)) throw new Error(`${tag} is not a release tag`);
  if (!key.trim() && !keyFile) throw new Error("no signing key: set the KANSO_RELEASE_KEY secret, or KANSO_RELEASE_KEY_FILE locally");
  const commit = commitOf(tag);
  const archive = join(out, `kanso-${tag}.tar.gz`);
  run("git", ["archive", "--format=tar.gz", `--prefix=herdr-kanso-${tag.slice(1)}/`, "-o", archive, commit]);
  const scratch = mkdtempSync(join(tmpdir(), "kanso-sign-"));
  try {
    const signer = keyFile || join(scratch, "key");
    if (!keyFile) writeFileSync(signer, `${key.trim()}\n`, { mode: 0o600 });
    run("ssh-keygen", ["-Y", "sign", "-q", "-f", signer, "-n", NAMESPACE, archive]);
    const signers = join(scratch, "allowed_signers");
    writeFileSync(signers, run("git", ["show", `${commit}:${SIGNERS}`]));
    run("ssh-keygen", ["-Y", "verify", "-f", signers, "-I", NAMESPACE, "-n", NAMESPACE, "-s", `${archive}.sig`], { input: readFileSync(archive), stdio: ["pipe", "ignore", "pipe"] });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return [archive, `${archive}.sig`];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(signRelease(process.argv[2] ?? "", process.argv[3] ?? ".").join("\n")); }
  catch (error) { console.error(`error: ${error.message}`); process.exit(1); }
}
