import { readFile } from "node:fs/promises";
import { stdoutOf } from "./helpers.mjs";

export const releaseNamespace = "kanso-release";

export const makeReleaseKey = async (path) => {
  await stdoutOf("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path]);
  const [type, key] = (await readFile(`${path}.pub`, "utf8")).trim().split(/\s+/);
  return { path, allowedSigners: `${releaseNamespace} namespaces="${releaseNamespace}" ${type} ${key}\n` };
};

export const signArchive = (key, archive) => stdoutOf("ssh-keygen", [
  "-Y", "sign", "-q", "-f", key.path, "-n", releaseNamespace, archive,
]);
