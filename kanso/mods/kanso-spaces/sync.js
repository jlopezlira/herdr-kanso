// Machine sync: a stable id, peers, and rows moved each way. No machine is in charge.
import { isOff, machineState } from "./machines.js";
import { clock, parseOr, reduceSeries } from "./pure.js";
import { paths, pathApi } from "./platform-paths.js";

export const KINDS = ["spend"];
export const EXCHANGE_MS = 180_000;
export const BACKOFF_MAX_MS = 1_800_000;
export const RETRY_FLOOR_MS = 15_000;
export const MIN_VERSION = "3.24.0";
export const PROTOCOL = 1;
export const UPDATE_TEXT = "Update kanso there";
// The sidebar bumps it after a save, so Spend exchanges at once.
export const SYNC_KICK = "kanso.sync.kick";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const REL = {
  probe: ["mods", "kanso-spend", "sync-probe.mjs"],
  presenter: ["mods", "kanso-spend", "presenter.mjs"],
  store: ["data", "kanso-spend", "store.json"],
  dir: ["data", "kanso-sync"],
  version: ["mods", "kanso-chrome", "version.json"],
};
// Node resolves it from the other computer's home, joined by that computer's own separator.
export const PROBE = [".config", "herdr-app", ...REL.probe];
export const probeApi = (platform, run) => ({ exchange: (payload) => run("node", [pathApi(platform).join(...PROBE), payload], { timeout: 25_000 }) });

export function appHomeFrom(env, homedir, join) {
  const set = String(env?.HERDR_APP_HOME ?? "").trim();
  return set || join(homedir, ".config", "herdr-app");
}

export function syncPaths(appHome, join) {
  const at = (parts) => parts.reduce((dir, part) => join(dir, part), appHome);
  return { probe: at(REL.probe), presenter: at(REL.presenter), store: at(REL.store), dir: at(REL.dir), version: at(REL.version) };
}

export function syncDir(root) {
  return paths.join(root, ...REL.dir);
}

export function identityFrom(text, mint, now) {
  const parsed = parseOr(typeof text === "string" ? text : "", null);
  if (parsed && ID.test(parsed.id)) return { id: parsed.id, created_at: parsed.created_at || now, fresh: false };
  return { id: mint(), created_at: now, fresh: true };
}

export function identityText(identity) {
  return `${JSON.stringify({ id: identity.id, created_at: identity.created_at })}\n`;
}

export function configFrom(text) {
  const parsed = parseOr(typeof text === "string" ? text : "", null);
  const peers = parsed?.peers;
  return { version: 1, peers: peers && typeof peers === "object" && !Array.isArray(peers) ? peers : {} };
}

export const peerOn = (config, id) => Boolean(config?.peers?.[id]?.enabled);

export function configText(config) {
  return `${JSON.stringify(config)}\n`;
}

export function syncOn(config) {
  return Object.keys(config?.peers ?? {}).some((id) => peerOn(config, id));
}

export function withPeer(config, id, enabled) {
  const base = configFrom(JSON.stringify(config ?? {}));
  return { ...base, peers: { ...base.peers, [id]: { enabled: Boolean(enabled) } } };
}

export function peersOf(list, stored = [], live = []) {
  const named = (Array.isArray(list) ? list : [])
    .filter((machine) => machine && typeof machine.name === "string" && machine.name && !machine.temporary)
    .map((machine) => ({
      id: machine.name,
      name: machine.name,
      layout: machine.layout === "ready" || machine.layout === "unavailable" ? machine.layout : "loading",
      off: isOff(machine.name, stored, live),
    }));
  const ids = named.map((peer) => peer.id);
  const parked = (Array.isArray(stored) ? stored : [])
    .filter((row) => row?.name && !row.temporary && !ids.includes(row.name))
    .map((row) => ({ id: row.name, name: row.name, layout: "unavailable", off: isOff(row.name, stored, live) }));
  return [...named, ...parked];
}

export function periodKeyOf(cost) {
  return `${cost?.period ?? "month"}:${Number(cost?.offset) || 0}`;
}

export function rowsFrom(text) {
  const parsed = parseOr(typeof text === "string" ? text : "", null);
  return Array.isArray(parsed?.rows) ? parsed.rows : [];
}

export function rowsText(rows) {
  return `${JSON.stringify({ rows })}\n`;
}

export function statusFrom(text) {
  const parsed = parseOr(typeof text === "string" ? text : "", null);
  const peers = parsed?.peers;
  return peers && typeof peers === "object" && !Array.isArray(peers) ? peers : {};
}

export function statusText(status) {
  return `${JSON.stringify({ peers: status ?? {} })}\n`;
}

const rowKey = (row) => `${row.kind}\0${row.machine}`;
const kept = (row) => Boolean(row && row.machine && row.kind && row.updated_at);

export function mergeRows(local, incoming) {
  const picked = [...(local ?? []), ...(incoming ?? [])].filter(kept).reduce((acc, row) => {
    const key = rowKey(row);
    const prev = acc[key];
    return !prev || String(row.updated_at) > String(prev.updated_at) ? { ...acc, [key]: row } : acc;
  }, {});
  return Object.values(picked);
}

export function pull(local, incoming, self) {
  const list = (Array.isArray(incoming) ? incoming : []).filter((row) => !self || row?.machine !== self);
  return mergeRows(local, list);
}

export function push(local) {
  return (Array.isArray(local) ? local : []).filter(kept);
}

export function stampName(rows, machine, name) {
  if (!machine || !name) return rows;
  return rows.map((row) => (row.machine === machine ? { ...row, body: { ...row.body, name } } : row));
}

const tokensText = (costs) => (costs?.hero?.stats ?? []).find((stat) => stat.unit === "tokens")?.value ?? "";

export function rowFromCosts(costs, machine, now, options) {
  const usd = Number(costs?.hero?.usd);
  const tokens = Number(costs?.hero?.tokens);
  if (!machine || !Number.isFinite(usd) || !Number.isFinite(tokens)) return null;
  return {
    machine,
    updated_at: now,
    kind: "spend",
    body: {
      usd, tokens, value: costs.hero.value ?? "", tokensText: tokensText(costs),
      period: options?.cost?.period ?? "month", offset: Number(options?.cost?.offset) || 0,
    },
  };
}

export function delayMs(failures) {
  const n = Number(failures) || 0;
  if (n <= 0) return EXCHANGE_MS;
  return Math.min(BACKOFF_MAX_MS, EXCHANGE_MS * 2 ** n);
}

export function versionFrom(text) {
  const parsed = parseOr(typeof text === "string" ? text : "", null);
  return typeof parsed?.version === "string" ? parsed.version : "";
}

export function versionBelow(version, min = MIN_VERSION) {
  const part = (text) => String(text ?? "").split(".").map((n) => Number(n) || 0);
  const pa = part(version);
  const pb = part(min);
  const i = [0, 1, 2].find((k) => (pa[k] ?? 0) !== (pb[k] ?? 0));
  return i !== undefined && (pa[i] ?? 0) < (pb[i] ?? 0);
}

export function due(status, now, periodKey) {
  const at = Number(status?.at) || 0;
  if (!at) return true;
  const failed = status.reason === "unreachable" || status.reason === "update";
  if (failed) return now - at >= delayMs(status.failures);
  if (periodKey && status.period !== periodKey) return now - at >= RETRY_FLOOR_MS;
  return now - at >= EXCHANGE_MS;
}

export function planExchange({ config, peers, status, now, periodKey, stored = [], live = [] }) {
  return peersOf(peers, stored, live).flatMap((peer) => {
    if (peer.off || peer.layout !== "ready" || !peerOn(config, peer.id) || !due(status?.[peer.id], now, periodKey)) return [];
    return [{ id: peer.id, on: peer.id, name: peer.name, kinds: KINDS }];
  });
}

export function parseOutcome(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.reduceRight((found, line) => {
    if (found) return found;
    const parsed = parseOr(line, null);
    return parsed && typeof parsed === "object" ? parsed : null;
  }, null);
}

export function applyExchange(rows, status, peer, outcome, now, periodKey) {
  const prev = status?.[peer.id] ?? {};
  const failed = (reason) => ({
    rows,
    status: { ...status, [peer.id]: { ...prev, at: now, failures: (prev.failures ?? 0) + 1, reason } },
  });
  if (!outcome || outcome.reason === "unreachable" || outcome.error) return failed("unreachable");
  if (outcome.reason === "update" || outcome.protocol !== PROTOCOL || versionBelow(outcome.version)) return failed("update");
  const pulled = pull(rows, outcome.rows, outcome.self);
  const named = outcome.machine ? stampName(pulled, outcome.machine, peer.name) : pulled;
  return {
    rows: named,
    status: {
      ...status,
      [peer.id]: {
        at: now, failures: 0, reason: null, synced_at: new Date(now).toISOString(),
        machine: outcome.machine ?? prev.machine ?? null, period: periodKey,
      },
    },
  };
}

export async function exchangeAll(probe, input) {
  const now = input.now;
  const periodKey = input.periodKey;
  const rows = input.own ? mergeRows(input.rows ?? [], [input.own]) : (input.rows ?? []);
  const status = input.status ?? {};
  const steps = planExchange({ config: input.config, peers: input.peers, status, now, periodKey, stored: input.stored ?? [], live: input.live ?? [] });
  if (!steps.length) return { rows, status, ran: false };
  const done = await reduceSeries(steps, async (state, step) => {
    const payload = JSON.stringify({ push: push(state.rows), options: input.options, kinds: step.kinds });
    const result = await probe(step.on, payload).catch(() => null);
    const parsed = result?.code === 0 ? parseOutcome(result.stdout) : null;
    const outcome = parsed ?? { reason: result ? "update" : "unreachable" };
    return applyExchange(state.rows, state.status, step, { ...outcome, self: input.self }, now, periodKey);
  }, { rows, status });
  return { ...done, ran: true };
}

const syncedText = (at, now) => {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (!(minutes >= 0)) return "";
  if (minutes < 1) return "synced just now";
  return minutes < 60 ? `synced ${minutes} min ago` : `synced ${clock(at, now)}`;
};

const CANNOT = new Map([["update", UPDATE_TEXT], ["unreachable", machineState("unavailable")]]);

// The sidebar's sync icon for a machine; machineVisible decides whether the row shows it.
export function syncIcon({ name, config, status, now }) {
  const on = peerOn(config, name);
  const cannot = on ? CANNOT.get(status?.[name]?.reason) : null;
  const note = cannot ?? (on ? syncedText(status?.[name]?.synced_at, now) : "");
  return { state: cannot ? "cannot" : on ? "on" : "off", tip: note ? `Sync ${name}: ${note}` : `Sync ${name}` };
}

export function holdsOf(status, stored = [], live = []) {
  return Object.entries(status ?? {}).flatMap(([id, row]) => (row?.reason === "update" && !isOff(id, stored, live) ? [{ id, text: UPDATE_TEXT }] : []));
}
