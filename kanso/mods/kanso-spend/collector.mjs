#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateLoadedConfig, normalizeConfig, sourcesSignature } from "./core/config.mjs";
import { scanSources } from "./core/scan.mjs";
import { clearCollectedData, loadStore, saveStore, snapshotRows, storeWith } from "./core/store.mjs";
import { ExitError, withStoreLock, parseCommand, unknownCommand, entryPoint, entryUrlMatches, runCommand } from "./core/util.mjs";

// herdr stops an exec after 30 s; leave room for the save, derivation and startup, then continue next run.
export const SCAN_BUDGET_MS = 18_000;

function usage() {
  return [
    "Usage:",
    "  collector.mjs snapshot --store <file> [--home <dir>] [--rebuild]",
    "  collector.mjs configure --store <file> [--home <dir>] --config <json> [--rebuild]",
  ].join("\n");
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
  return withLoadedStore(storePath, async (loaded) => {
    const store = rebuild ? clearCollectedData(loaded.store) : loaded.store;
    const dirty = loaded.dirty || rebuild;
    const scan = await scanStore(store, storePath, home, scanStartedAt);
    const saved = dirty || scan.dirty ? await saveStore(storePath, scan.store) : scan.store;
    return collectedSnapshot(saved, scan, loaded);
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

  return withLoadedStore(storePath, async (loaded) => {
    const configChanged = JSON.stringify(loaded.store.config) !== JSON.stringify(config);
    const mappingsChanged =
      sourcesSignature(loaded.store.config) !== sourcesSignature(config);
    const configured = configChanged ? storeWith(loaded.store, { config }) : loaded.store;
    const cleared = mappingsChanged || rebuild ? clearCollectedData(configured) : configured;

    // Save the accepted config before scanning: if the scan fails, the UI still has the new sources.
    const store = loaded.dirty || configChanged || mappingsChanged || rebuild
      ? await saveStore(storePath, cleared)
      : cleared;

    const scan = await scanStore(store, storePath, home, scanStartedAt);
    const saved = scan.dirty ? await saveStore(storePath, scan.store) : scan.store;
    return collectedSnapshot(saved, scan, loaded);
  });
}

export async function run(argv) {
  const { command, options } = parseCommand(argv, ["store", "home", "config"], { rebuild: false });
  if (options.help || !command) {
    return { exitCode: 0, stdout: "", stderr: `${usage()}\n` };
  }
  if (command !== "snapshot" && command !== "configure") {
    return unknownCommand(command, usage);
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

const collectedSnapshot = async (saved, scan, loaded) => withStore(
  await buildSnapshot(saved, scan, new Date().toISOString(), loaded.warnings, loaded.errors), saved,
);

const scanStore = (store, storePath, home, startedAt) => scanWithProgress(store, storePath, home, startedAt + SCAN_BUDGET_MS);

const withLoadedStore = (storePath, work) => withStoreLock(storePath, async () => work(await loadStore(storePath)));
if (entryPoint(import.meta.url, entryUrlMatches)) await runCommand(run, "kanso-spend collector");
