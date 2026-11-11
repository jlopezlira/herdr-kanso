// Runs on one computer: writes only that computer's spend row, and keeps everyone else's as they arrived.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseOr } from "./pure.js";
import { appHomeFrom, syncPaths, identityFrom, identityText, rowsFrom, rowsText, pull, mergeRows, rowFromCosts, versionFrom, PROTOCOL } from "./sync.js";

const costsOf = (body) => (body?.costs?.hero ? body.costs : body);
const samePath = (left, right) => {
  try { return Boolean(left) && realpathSync(left) === realpathSync(right); }
  catch { return false; }
};

export async function exchange(payload, deps = {}) {
  const join = deps.join ?? path.join;
  const exists = deps.exists ?? existsSync;
  const fs = deps.fs ?? { readFile, writeFile, mkdir };
  const read = (file) => fs.readFile(file, "utf8").catch(() => "");
  const home = deps.homedir ?? os.homedir();
  const appHome = deps.appHome ?? appHomeFrom(deps.env ?? process.env, home, join);
  const paths = syncPaths(appHome, join);
  const version = versionFrom(await read(paths.version));
  if (!exists(paths.presenter)) return { reason: "update", version, protocol: PROTOCOL };
  await fs.mkdir(paths.dir, { recursive: true });
  const idFile = join(paths.dir, "identity.json");
  const rowFile = join(paths.dir, "rows.json");
  const now = deps.now ?? new Date().toISOString();
  const identity = identityFrom(await read(idFile), () => (deps.mint ?? randomUUID)(), now);
  if (identity.fresh) await fs.writeFile(idFile, identityText(identity));
  const pulled = pull(rowsFrom(await read(rowFile)), payload?.push, identity.id);
  const run = deps.run ?? (async (argv) => {
    const { run: present } = await import(pathToFileURL(paths.presenter).href);
    return present(argv);
  });
  const result = await run(["prepare", "--store", paths.store, "--home", home, "--options", JSON.stringify(payload?.options ?? {})]).catch(() => null);
  const own = (() => {
    try {
      return result?.exitCode === 0 ? rowFromCosts(costsOf(JSON.parse(result.stdout)), identity.id, now, payload?.options) : null;
    } catch { return null; } // their ledger stays; the caller keeps the last figures
  })();
  const rows = own ? mergeRows(pulled, [own]) : pulled;
  await fs.writeFile(rowFile, rowsText(rows));
  return { machine: identity.id, version, protocol: PROTOCOL, rows };
}

if (samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  exchange(parseOr(process.argv[2] ?? "", {})).then(
    (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
    () => process.stdout.write(`${JSON.stringify({ reason: "update", version: "", protocol: PROTOCOL })}\n`),
  );
}
