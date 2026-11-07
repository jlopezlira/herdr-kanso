#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrateLoadedConfig, normalizeConfig, sourcesSignature } from "./core/config.mjs";
import { scanSources } from "./core/scan.mjs";
import {
  clearCollectedData,
  loadStore,
  saveStore,
  snapshotRows,
  storeWith,
} from "./core/store.mjs";
import { ExitError, exitWith, withStoreLock } from "./core/util.mjs";

// herdr stops an exec after 30 s; leave room for the save, derivation and startup, then continue next run.
export const SCAN_BUDGET_MS = 18_000;

function usage() {
  return [
    "Usage:",
    "  collector.mjs snapshot --store <file> [--home <dir>] [--rebuild]",
    "  collector.mjs configure --store <file> [--home <dir>] --config <json> [--rebuild]",
  ].join("\n");
}

function parseFlags(argv, index = 1, options = { rebuild: false }) {
  if (index >= argv.length) return options;
  const arg = argv[index];
  if (arg === "--rebuild") return parseFlags(argv, index + 1, { ...options, rebuild: true });
  if (arg === "--help" || arg === "-h") return parseFlags(argv, index + 1, { ...options, help: true });
  const match = /^-{2}(store|home|config)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error(`unknown argument ${arg}`);
  const key = match[1];
  const inline = match[2] !== undefined;
  const value = inline ? match[2] : argv[index + 1];
  if (value === undefined) throw new Error(`--${key} needs a value`);
  return parseFlags(argv, index + (inline ? 1 : 2), { ...options, [key]: value });
}

function parseArgs(argv) {
  return { command: argv[0], options: parseFlags(argv) };
}

/** The in-process caller (presenter) reuses the scanned store instead of parsing it again. */
function withStore(snapshot, store) {
  return Object.create(Object.prototype, {
    ...Object.getOwnPropertyDescriptors(snapshot),
    store: { value: store, enumerable: false },
  });
}

async function buildSnapshot(store, scan, nowIso, loadWarnings = [], loadErrors = 0) {
  const warnings = [
    ...loadWarnings,
    ...scan.warnings,
    ...(scan.stats.partial
      ? [`First scan in progress: ${scan.stats.processed} of ${scan.stats.total} files indexed; it continues on the next refresh.`]
      : []),
  ];
  const stats = {
    ...scan.stats,
    errors: scan.stats.errors + loadErrors,
  };
  return {
    version: 1,
    generatedAt: nowIso,
    lastScanAt: nowIso,
    config: store.config,
    rows: snapshotRows(store),
    stats,
    sourceStats: scan.sourceStats ?? undefined,
    warnings,
  };
}

/** Best-effort scan-progress sidecar next to the store; removed when the scan settles. */
class ProgressWriter {
  constructor(storePath) {
    this.progressPath = `${storePath}.progress.json`;
    this.tempPath = `${this.progressPath}.${process.pid}-${randomUUID()}.tmp`;
    this.lastWrite = 0;
  }

  update(state) {
    const now = Date.now();
    if (now - this.lastWrite < 250 && state.processed < state.total) return;
    this.lastWrite = now;
    const { progressPath, tempPath } = this;
    try {
      // Atomic replacement also avoids following an existing sidecar link.
      writeFileSync(tempPath, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tempPath, progressPath);
    } catch { /* progress is best-effort */ }
    finally {
      try { unlinkSync(tempPath); } catch { /* renamed or not created */ }
    }
  }

  remove() {
    try {
      unlinkSync(this.progressPath);
    } catch { /* already gone */ }
  }
}

export function progressWriter(storePath) {
  return new ProgressWriter(storePath);
}

async function scanWithProgress(store, storePath, home, deadline) {
  const progress = progressWriter(storePath);
  try {
    return await scanSources(store, {
      home,
      onProgress: (state) => progress.update(state),
      deadline,
    });
  } finally {
    progress.remove();
  }
}

async function snapshotWithStore(storePath, home, { rebuild = false } = {}) {
  const scanStartedAt = Date.now();
  return withStoreLock(storePath, async () => {
    const loaded = await loadStore(storePath);
    const store = rebuild ? clearCollectedData(loaded.store) : loaded.store;
    const dirty = loaded.dirty || rebuild;
    const scan = await scanWithProgress(store, storePath, home, scanStartedAt + SCAN_BUDGET_MS);
    const saved = dirty || scan.dirty ? await saveStore(storePath, scan.store) : scan.store;
    const now = new Date().toISOString();
    return withStore(await buildSnapshot(saved, scan, now, loaded.warnings, loaded.errors), saved);
  });
}

async function configureStore(storePath, home, rawConfig, { rebuild = false } = {}) {
  const scanStartedAt = Date.now();
  const config = (() => {
    try {
      const parsed = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
      return migrateLoadedConfig(normalizeConfig(parsed)).config;
    } catch (error) {
      throw new ExitError(`invalid --config: ${error.message}`, 2);
    }
  })();

  return withStoreLock(storePath, async () => {
    const loaded = await loadStore(storePath);
    const configChanged = JSON.stringify(loaded.store.config) !== JSON.stringify(config);
    const mappingsChanged =
      sourcesSignature(loaded.store.config) !== sourcesSignature(config);
    const configured = configChanged ? storeWith(loaded.store, { config }) : loaded.store;
    const cleared = mappingsChanged || rebuild ? clearCollectedData(configured) : configured;

    // Save the accepted config before scanning: if the scan fails, the UI still has the new sources.
    const store = loaded.dirty || configChanged || mappingsChanged || rebuild
      ? await saveStore(storePath, cleared)
      : cleared;

    const scan = await scanWithProgress(store, storePath, home, scanStartedAt + SCAN_BUDGET_MS);
    const saved = scan.dirty ? await saveStore(storePath, scan.store) : scan.store;
    const now = new Date().toISOString();
    return withStore(await buildSnapshot(saved, scan, now, loaded.warnings, loaded.errors), saved);
  });
}

export async function run(argv) {
  const { command, options } = parseArgs(argv);
  if (options.help || !command) {
    return { exitCode: 0, stdout: "", stderr: `${usage()}\n` };
  }
  if (command !== "snapshot" && command !== "configure") {
    return { exitCode: 2, stdout: "", stderr: `unknown command ${command}\n${usage()}\n` };
  }
  if (!options.store) {
    return { exitCode: 2, stdout: "", stderr: "--store is required\n" };
  }
  if (command === "configure" && options.config === undefined) {
    return { exitCode: 2, stdout: "", stderr: "--config is required\n" };
  }
  const snapshot = await collectSnapshot(command, options);
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(snapshot)}\n`,
    stderr: "",
  };
}

/** In-process API: the presenter never serializes and reparses raw rows. */
export async function collectSnapshot(command, options) {
  if (!["snapshot", "configure"].includes(command)) throw new Error("unknown collector command");
  if (!options?.store) throw new Error("--store is required");
  if (command === "configure" && options.config === undefined) throw new Error("--config is required");
  const storePath = path.resolve(options.store);
  const home = path.resolve(options.home ?? os.homedir());
  return command === "snapshot"
    ? snapshotWithStore(storePath, home, { rebuild: options.rebuild })
    : configureStore(storePath, home, options.config, { rebuild: options.rebuild });
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    await exitWith(result.exitCode);
  } catch (error) {
    process.stderr.write(`kanso-spend collector: ${error.message}\n`);
    await exitWith(error.exitCode ?? 1);
  }
}

function isInvokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(entry).href === import.meta.url;
  }
}

if (isInvokedDirectly()) {
  await main();
}
