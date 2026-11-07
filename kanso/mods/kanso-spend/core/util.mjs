import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  constants as fsConstants,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findAsync, range } from "../pure.js";

export const STORE_VERSION = 1;
export const STORE_LOCK_STALE_MS = 10 * 60 * 1000;
export const MAX_LINE_BYTES = 16 * 1024 * 1024;
// Caps a turn without harness-reported boundaries, so idle time never becomes active time.
export const MAX_TURN_MS = 2 * 60 * 60 * 1000;

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value, fallback = "unknown") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function expandHome(input, home) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  if (input.startsWith("~")) return path.join(home, input.slice(1));
  return path.resolve(home, input);
}

export function toNonNegInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeTokens(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const counts = {
    input: toNonNegInt(source.input),
    output: toNonNegInt(source.output),
    cacheRead: toNonNegInt(source.cacheRead),
    cacheWrite: toNonNegInt(source.cacheWrite),
    reasoning: toNonNegInt(source.reasoning),
  };
  const nonzero =
    counts.input > 0 ||
    counts.output > 0 ||
    counts.cacheRead > 0 ||
    counts.cacheWrite > 0 ||
    counts.reasoning > 0;
  return { ...counts, nonzero };
}

export function tokenTotal(tokens) {
  return (
    toNonNegInt(tokens?.input) +
    toNonNegInt(tokens?.output) +
    toNonNegInt(tokens?.cacheRead) +
    toNonNegInt(tokens?.cacheWrite)
  );
}

export function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e14) return Math.floor(value / 1000); // microseconds
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    return Math.floor(value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return parseTimestamp(Number(text));
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function localDay(ms) {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hashKey(...parts) {
  return parts
    .reduce((hash, part) => hash.update(typeof part === "string" ? part : JSON.stringify(part)).update("\u0000"), createHash("sha256"))
    .digest("hex")
    .slice(0, 24);
}

export function sessionHash(session) {
  return hashKey("session", session);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExitError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

// A nonzero exit only after printed output is out; 0 ends as Node would, so success is never cut short.
export async function exitWith(code) {
  if (!code) return;
  await new Promise((resolve) => process.stdout.write("", resolve));
  await new Promise((resolve) => process.stderr.write("", resolve));
  process.exit(code);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function tempSibling(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
  );
}

export async function ensureParent(file, mode = 0o700) {
  await mkdir(path.dirname(file), { recursive: true, mode });
}

async function writeNewSynced(file, text) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
  await handle.close();
}

export async function atomicWriteJson(file, value) {
  await ensureParent(file);
  const temp = tempSibling(file);
  try {
    await writeNewSynced(temp, `${JSON.stringify(value)}\n`);
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function readJsonFile(file) {
  const text = await readFile(file, "utf8");
  return JSON.parse(text);
}

export async function backupCorruptStore(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${file}.corrupt-${stamp}`;
  const saved = await findAsync(range(100).map((index) => (index === 0 ? base : `${base}-${index}`)), async (target) => {
    try {
      await copyFile(file, target, fsConstants.COPYFILE_EXCL);
      await chmod(target, 0o600).catch(() => {});
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      return false;
    }
  });
  if (saved) return saved;
  throw new Error(`could not preserve corrupt store ${file}`);
}

async function readLockInfo(lockPath) {
  const kind = await stat(lockPath).then((info) => ({ directory: info.isDirectory() }), (error) => ({ failed: true, error }));
  if (kind.failed) return kind.error?.code === "ENOENT" ? null : { invalid: true, directory: false };
  const { directory } = kind;
  try {
    const owners = directory ? (await readdir(lockPath)).filter((name) => /^owner-.+\.json$/.test(name)) : [];
    // An empty acquisition directory has no provable dead owner. Fail closed.
    if (directory && owners.length !== 1) return { invalid: true, directory };
    const ownerPath = directory ? path.join(lockPath, owners[0]) : lockPath;
    const value = JSON.parse(await readFile(ownerPath, "utf8"));
    return isPlainObject(value) ? { ...value, ownerPath, directory } : { invalid: true, directory };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { invalid: true, directory };
  }
}

async function lockAgeMs(lockPath) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs;
  } catch {
    return 0;
  }
}

async function tryUnlinkStaleLock(lockPath, observed) {
  const current = await readLockInfo(lockPath);
  if (!current) return true;
  if (observed?.token && current.token !== observed.token) return false;
  if (!observed?.token && current.token) return false;
  if (observed?.directory) {
    if (!observed.ownerPath || current.ownerPath !== observed.ownerPath) return false;
    try {
      // Only the reclaimer that removed this unique owner file may rmdir: a late second cannot delete a new owner's lock.
      await unlink(observed.ownerPath);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    await rmdir(lockPath).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    });
    return true;
  }
  // Legacy file locks: unlink cannot remove a directory lock that replaced them.
  await unlink(lockPath).catch((error) => {
    if (!["ENOENT", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  });
  return true;
}

async function takeLock(lockPath, ownerPath, owner) {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    return { error };
  }
  try {
    await writeNewSynced(ownerPath, owner);
    return null;
  } catch (error) {
    await unlink(ownerPath).catch(() => {});
    await rmdir(lockPath).catch(() => {});
    return { error };
  }
}

export async function withStoreLock(
  storePath,
  callback,
  { timeoutMs = 20_000, staleMs = STORE_LOCK_STALE_MS } = {},
) {
  const lockPath = `${storePath}.lock`;
  await ensureParent(lockPath);
  const token = `${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const host = os.hostname();
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const ownerPath = path.join(lockPath, `owner-${token}.json`);
  const owner = `${JSON.stringify({ pid: process.pid, host, startedAt, token })}\n`;

  const acquire = async () => {
    const failure = await takeLock(lockPath, ownerPath, owner);
    if (!failure) return;
    const { error } = failure;
    if (error?.code !== "EEXIST") throw error;
    const observed = await readLockInfo(lockPath);
    const age = await lockAgeMs(lockPath);
    const sameHost = observed?.host === host;
    const pid = Number(observed?.pid);
    const dead = sameHost && Number.isInteger(pid) && !isProcessAlive(pid);
    // Only provably dead local owners are evicted; foreign or empty locks fail closed rather than trusting elapsed time.
    const malformedOld = !observed?.directory && observed?.invalid && age > Math.max(staleMs, 60_000);

    if (dead || malformedOld) {
      const removed = await tryUnlinkStaleLock(lockPath, observed);
      if (removed) return acquire();
    }
    if (Date.now() >= deadline) {
      throw new Error(`spend store is busy (lock ${lockPath})`, {
        cause: error,
      });
    }
    await sleep(60 + Math.floor(Math.random() * 40));
    return acquire();
  };
  await acquire();

  try {
    return await callback();
  } finally {
    const current = await readLockInfo(lockPath);
    if (current?.token === token) {
      await unlink(ownerPath).catch(() => {});
      await rmdir(lockPath).catch(() => {});
    }
  }
}
