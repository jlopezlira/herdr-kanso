#!/usr/bin/env node
// Node side of the Spend costs panel.
//
// The native view (QuickJS) parses this output inside one time-limited step,
// so the payload stays small: every number and label arrives formatted, and
// raw rows never leave Node.
//
//   presenter.mjs snapshot --store <file> --home <dir> [--options <json>]   scan, then costs
//   presenter.mjs prepare  --store <file> [--home <dir>] [--options <json>] costs from the store
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSnapshot } from "./collector.mjs";
import { loadStore, snapshotRows } from "./core/store.mjs";
import { loadLabels, updateLabels } from "./core/labels.mjs";
import { deriveCosts, loadCatalog, loadOverrides } from "./core/costs.mjs";
import { demoData } from "./core/demo.mjs";
import { existsSync } from "node:fs";
import { tryOrAsync } from "./pure.js";
import { ExitError, exitWith } from "./core/util.mjs";

export const PAYLOAD_KIND = "kanso-spend-costs";
export const PAYLOAD_VERSION = 1;

// herdr stops an exec after 30 s; everything below must finish well before.
const LABEL_DEADLINE_MS = 25_000;
const CATALOG_REFRESH_BEFORE_MS = 16_000;

function usage() {
  return [
    "Usage:",
    "  presenter.mjs snapshot --store <file> --home <dir> [--options <json>]",
    "  presenter.mjs prepare --store <file> [--home <dir>] [--options <json>]",
  ].join("\n");
}

// The flags after the command, one at a time: `--key=value` takes one
// argument, `--key value` two, and a key with no value left is an error.
function parseFlags(argv, index = 1, options = {}) {
  if (index >= argv.length) return options;
  const arg = argv[index];
  if (arg === "--help" || arg === "-h") return parseFlags(argv, index + 1, { ...options, help: true });
  const match = /^-{2}(store|home|options|sources)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error(`unknown argument ${arg}`);
  const inline = match[2] !== undefined;
  const value = inline ? match[2] : argv[index + 1];
  if (value === undefined) throw new Error(`--${match[1]} needs a value`);
  return parseFlags(argv, index + (inline ? 1 : 2), { ...options, [match[1]]: value });
}

function parseArgs(argv) {
  return { command: argv[0], options: parseFlags(argv) };
}

// JSON text as a value; a parse error becomes a usage error (exit 2) that
// names the flag it came from.
function parseFlagJson(raw, flag) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ExitError(`invalid ${flag}: ${error.message}`, 2);
  }
}

function parseOptions(raw) {
  if (raw === undefined) return {};
  const parsed = parseFlagJson(raw, "--options");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExitError("invalid --options: expected one JSON object", 2);
  }
  return parsed;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What the view shows about the scan itself: when, and whether it is still catching up. */
function scanState(snapshot, lastScanAt) {
  const stats = snapshot?.stats ?? {};
  return {
    lastScanAt: lastScanAt ?? snapshot?.lastScanAt ?? null,
    partial: Boolean(stats.partial),
    processed: Number(stats.processed) || 0,
    total: Number(stats.total) || 0,
    errors: Number(stats.errors) || 0,
    warnings: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0,
  };
}

const LIVE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Sessions whose transcript changed recently, with when (ms). One pass over
 * the rows of the recent files, grouped by session once: a session's time is
 * the latest of its files.
 */
function liveSessions(store) {
  const now = Date.now();
  const seen = Object.values(store?.files ?? {}).flatMap((file) => {
    const at = Number(file?.mtimeMs) || 0;
    if (!at || now - at > LIVE_WINDOW_MS) return [];
    return (file.rows ?? []).filter((row) => typeof row.session === "string").map((row) => ({ session: row.session, at }));
  });
  return new Map([...Map.groupBy(seen, (s) => s.session)].map(([session, list]) => (
    [session, list.reduce((latest, s) => Math.max(latest, s.at), 0)]
  )));
}

async function costsFor(rows, storePath, home, options, { refresh = false, labels = null, store = null, live = null } = {}) {
  const catalog = await loadCatalog(storePath, { home, refresh });
  return deriveCosts(rows, {
    live: live ?? liveSessions(store),
    catalog,
    overrides: await loadOverrides(storePath),
    labels: labels ?? await loadLabels(storePath),
    options: options.cost ?? {},
    today: typeof options.today === "string" ? options.today : today(),
  });
}

/** What the Settings view edits: which harnesses are read, and what plans cost. */
async function settingsFor(store, storePath) {
  const overrides = await loadOverrides(storePath);
  return {
    sources: (store?.config?.sources ?? []).map((source) => ({
      id: source.id,
      label: source.label ?? source.id,
      enabled: source.enabled !== false,
      roots: Array.isArray(source.roots) ? source.roots.join(", ") : "",
    })),
    plans: overrides.plans,
    pricesPath: path.join(path.dirname(storePath), "prices.json"),
  };
}

function payload(command, options, scan, costs, settings) {
  return `${JSON.stringify({ kind: PAYLOAD_KIND, version: PAYLOAD_VERSION, command, options, scan, costs, settings })}\n`;
}

export async function run(argv, environment = {}) {
  const { command, options } = parseArgs(argv);
  if (options.help || !command) return { exitCode: 0, stdout: "", stderr: `${usage()}\n` };
  if (!["snapshot", "prepare", "configure"].includes(command)) {
    return { exitCode: 2, stdout: "", stderr: `unknown command ${command}\n${usage()}\n` };
  }
  if (!options.store) return { exitCode: 2, stdout: "", stderr: "--store is required\n" };

  const storePath = path.resolve(options.store);
  const home = path.resolve(options.home ?? environment.home ?? os.homedir());
  const viewOptions = parseOptions(options.options);

  // Sample data instead of your sessions while data/<mod>/demo exists.
  if (existsSync(path.join(path.dirname(storePath), "demo")) && command !== "configure") {
    const demo = demoData(typeof viewOptions.today === "string" ? viewOptions.today : today());
    const costs = await costsFor(demo.rows, storePath, home, viewOptions, { labels: demo.labels, live: demo.live });
    const scan = { lastScanAt: new Date().toISOString(), partial: false, processed: 0, total: 0, errors: 0, warnings: 0 };
    // No store yet is fine: the settings then list no sources.
    const store = await tryOrAsync(async () => (await loadStore(storePath, { readOnly: true })).store, null);
    return { exitCode: 0, stdout: payload(command, viewOptions, scan, costs, await settingsFor(store, storePath)), stderr: "" };
  }

  if (command === "prepare") {
    const loaded = await loadStore(storePath, { readOnly: true });
    const costs = await costsFor(snapshotRows(loaded.store), storePath, home, viewOptions, { store: loaded.store });
    return {
      exitCode: 0,
      stdout: payload(command, viewOptions, scanState(null, loaded.store.lastScanAt), costs, await settingsFor(loaded.store, storePath)),
      stderr: "",
    };
  }

  const startedAt = Date.now();
  const snapshot = command === "configure"
    ? await configureSources(storePath, home, options.sources)
    : await collectSnapshot("snapshot", { store: storePath, home });
  // Task labels and list prices are best-effort and time-boxed: a slow pass
  // leaves the rest for the next refresh instead of failing this one. A store
  // that cannot be read skips the labels too; null labels fall back to the
  // cached ones.
  const store = snapshot.store ?? await tryOrAsync(async () => (await loadStore(storePath, { readOnly: true })).store, null);
  const labels = store
    ? await tryOrAsync(async () => (await updateLabels(store, storePath, { home, deadline: startedAt + LABEL_DEADLINE_MS })).labels, null)
    : null;
  const costs = await costsFor(snapshot.rows, storePath, home, viewOptions, {
    refresh: Date.now() - startedAt < CATALOG_REFRESH_BEFORE_MS,
    labels,
    store,
  });
  return { exitCode: 0, stdout: payload(command, viewOptions, scanState(snapshot), costs, await settingsFor(store, storePath)), stderr: "" };
}

// Only the enabled flags change here; everything else in the config stays.
async function configureSources(storePath, home, sources) {
  const wanted = parseFlagJson(sources ?? "{}", "--sources");
  const current = (await loadStore(storePath, { readOnly: true })).store.config;
  const config = {
    ...current,
    sources: (current.sources ?? []).map((source) => (
      typeof wanted[source.id] === "boolean" ? { ...source, enabled: wanted[source.id] } : source
    )),
  };
  return collectSnapshot("configure", { store: storePath, home, config: JSON.stringify(config) });
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    await exitWith(result.exitCode);
  } catch (error) {
    process.stderr.write(`kanso-spend: ${error.message}\n`);
    await exitWith(error.exitCode ?? 1);
  }
}

if (isEntryPoint()) await main();
