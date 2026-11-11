// Machine sync: a stable id, peers, and rows moved each way. No machine is in charge.
import { parseOr, reduceSeries } from "./pure.js";

export const KINDS = [{ id: "spend", label: "Token spend" }];
export const EXCHANGE_MS = 180_000;
export const BACKOFF_MAX_MS = 1_800_000;
export const RETRY_FLOOR_MS = 15_000;
export const MKDIR_SOURCE = "import { mkdir } from 'node:fs/promises'; await mkdir(process.argv[1], { recursive: true });";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The peer resolves these; they are joined with its path API, never a shell string.
export const REL = {
  probe: ["mods", "kanso-spend", "sync-probe.mjs"],
  presenter: ["mods", "kanso-spend", "presenter.mjs"],
  store: ["data", "kanso-spend", "store.json"],
  dir: ["data", "kanso-sync"],
};

const joinRel = (parts) => parts.map((part) => JSON.stringify(part)).join(", ");
export const LOADER_SOURCE = [
  "import { existsSync } from 'node:fs';",
  "import os from 'node:os';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  "const appHome = process.env.HERDR_APP_HOME || path.join(os.homedir(), '.config', 'herdr-app');",
  `const probe = path.join(appHome, ${joinRel(REL.probe)});`,
  `const presenter = path.join(appHome, ${joinRel(REL.presenter)});`,
  `const store = path.join(appHome, ${joinRel(REL.store)});`,
  "const payload = JSON.parse(process.argv[1] ?? '{}');",
  "const say = (value) => { console.log(JSON.stringify(value)); };",
  "if (!existsSync(probe)) {",
  "  if (!existsSync(presenter)) { say({ reason: 'no-kanso' }); process.exit(0); }",
  "  const { run } = await import(pathToFileURL(presenter).href);",
  "  const result = await run(['prepare', '--store', store, '--home', os.homedir(), '--options', JSON.stringify(payload.options ?? {})]);",
  "  if (result.exitCode !== 0) { say({ reason: 'unreachable' }); process.exit(0); }",
  "  const body = JSON.parse(result.stdout);",
  "  say({ reason: 'costs', costs: body && body.costs && body.costs.hero ? body.costs : body });",
  "  process.exit(0);",
  "}",
  "const mod = await import(pathToFileURL(probe).href);",
  "say(await mod.exchange(payload));",
].join("\n");

export function appHomeFrom(env, homedir, join) {
  const set = String(env?.HERDR_APP_HOME ?? "").trim();
  return set || join(homedir, ".config", "herdr-app");
}

export function syncPaths(appHome, join) {
  const at = (parts) => parts.reduce((dir, part) => join(dir, part), appHome);
  return { probe: at(REL.probe), presenter: at(REL.presenter), store: at(REL.store), dir: at(REL.dir) };
}

export function loaderArgv(payload) {
  return ["--input-type=module", "-e", LOADER_SOURCE, "--", JSON.stringify(payload ?? {})];
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

export function syncOn(config) {
  return Object.values(config?.peers ?? {}).some((peer) => peer?.enabled && KINDS.some((kind) => peer.kinds?.[kind.id]));
}

export function kindOn(config, id, kind) {
  const peer = config?.peers?.[id];
  return Boolean(peer?.enabled && peer.kinds?.[kind]);
}

const kindMap = (prev) => {
  const kinds = prev?.kinds;
  return kinds && typeof kinds === "object" && !Array.isArray(kinds) ? { ...kinds } : Object.fromEntries(KINDS.map((kind) => [kind.id, true]));
};

export function withPeer(config, id, enabled) {
  const base = configFrom(JSON.stringify(config ?? {}));
  return { ...base, peers: { ...base.peers, [id]: { enabled: Boolean(enabled), kinds: kindMap(base.peers[id]) } } };
}

export function withKind(config, id, kind, enabled) {
  const base = withPeer(config, id, Boolean(config?.peers?.[id]?.enabled));
  const prev = base.peers[id];
  return { ...base, peers: { ...base.peers, [id]: { ...prev, kinds: { ...prev.kinds, [kind]: Boolean(enabled) } } } };
}

export function peersOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((machine) => machine && typeof machine.name === "string" && machine.name && !machine.temporary)
    .map((machine) => ({
      id: machine.name,
      name: machine.name,
      layout: machine.layout === "ready" || machine.layout === "unavailable" ? machine.layout : "loading",
    }));
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

export function dropMachine(rows, machine) {
  return machine ? rows.filter((row) => row.machine !== machine) : rows;
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

export function due(status, now, periodKey) {
  const at = Number(status?.at) || 0;
  if (!at) return true;
  const failed = status.reason === "unreachable" || status.reason === "no-kanso";
  if (failed) return now - at >= delayMs(status.failures);
  if (periodKey && status.period !== periodKey) return now - at >= RETRY_FLOOR_MS;
  return now - at >= EXCHANGE_MS;
}

export function planExchange({ config, peers, status, now, periodKey }) {
  return peersOf(peers).flatMap((peer) => {
    if (peer.layout !== "ready") return [];
    const kinds = KINDS.filter((kind) => kindOn(config, peer.id, kind.id)).map((kind) => kind.id);
    if (!kinds.length || !due(status?.[peer.id], now, periodKey)) return [];
    return [{ id: peer.id, on: peer.id, name: peer.name, kinds }];
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

export function costsOf(body) {
  return body?.costs?.hero ? body.costs : body;
}

export function applyExchange(rows, status, peer, outcome, now, periodKey) {
  const prev = status?.[peer.id] ?? {};
  const fail = (reason) => ({
    rows,
    status: { ...status, [peer.id]: { ...prev, at: now, failures: (prev.failures ?? 0) + 1, reason, synced_at: prev.synced_at ?? null, machine: prev.machine ?? null, period: prev.period ?? null } },
  });
  if (!outcome || outcome.reason === "unreachable" || outcome.error) return fail("unreachable");
  if (outcome.reason === "no-kanso") return fail("no-kanso");
  const iso = new Date(now).toISOString();
  const priced = outcome.reason === "costs" ? rowFromCosts(costsOf(outcome.costs), `peer:${peer.id}`, iso, outcome.options) : null;
  const pulled = outcome.reason === "costs" ? rows : pull(rows, outcome.rows, outcome.self);
  const named = outcome.reason === "costs"
    ? (priced ? stampName(mergeRows(rows, [priced]), priced.machine, peer.name) : rows)
    : (outcome.machine ? stampName(dropMachine(pulled, `peer:${peer.id}`), outcome.machine, peer.name) : pulled);
  const machine = priced?.machine ?? outcome.machine ?? prev.machine ?? null;
  return {
    rows: named,
    status: { ...status, [peer.id]: { at: now, failures: 0, reason: null, synced_at: iso, machine, period: periodKey } },
  };
}

export async function exchangeAll(runner, input) {
  const now = input.now;
  const periodKey = input.periodKey;
  const rows = input.own ? mergeRows(input.rows ?? [], [input.own]) : (input.rows ?? []);
  const status = input.status ?? {};
  const steps = planExchange({ config: input.config, peers: input.peers, status, now, periodKey });
  if (!steps.length) return { rows, status, ran: false };
  const done = await reduceSeries(steps, async (state, step) => {
    const result = await runner.exec("node", loaderArgv({ push: push(state.rows), options: input.options, kinds: step.kinds }), { on: step.on, timeout: 25_000 }).catch(() => null);
    const outcome = result?.code === 0 ? parseOutcome(result.stdout) : null;
    return applyExchange(state.rows, state.status, step, { ...(outcome ?? { reason: "unreachable" }), self: input.self, options: input.options }, now, periodKey);
  }, { rows, status });
  return { ...done, ran: true };
}

export function clock(iso, now) {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const today = new Date(now ?? Date.now());
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const same = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return same ? hm : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function peerState(peer, status, now) {
  if (peer.layout === "loading") return { kind: "loading", text: "" };
  if (status?.reason === "no-kanso") return { kind: "no-kanso", text: "No kansō there" };
  const time = clock(status?.synced_at, now);
  if (peer.layout === "unavailable" || status?.reason === "unreachable") return { kind: "unreachable", text: time ? `${time} · Unreachable` : "Unreachable" };
  if (time) return { kind: "synced", text: time };
  return { kind: "idle", text: "" };
}

export function peerView(peer, config, status, now) {
  const stored = config?.peers?.[peer.id]?.kinds;
  return {
    id: peer.id,
    name: peer.name,
    enabled: Boolean(config?.peers?.[peer.id]?.enabled),
    kinds: KINDS.map((kind) => ({ id: kind.id, label: kind.label, on: Boolean(stored?.[kind.id]) })),
    state: peerState(peer, status, now),
  };
}

export function syncRoster(list, config, status, now) {
  const machines = Array.isArray(list) ? list : [];
  const peers = peersOf(machines);
  const settling = machines.length === 0 || machines.some((machine) => machine?.layout === "loading");
  if (!peers.length && settling) return { state: "loading", peers: [] };
  if (!peers.length) return { state: "empty", peers: [] };
  return { state: "peers", peers: peers.map((peer) => peerView(peer, config, status?.[peer.id], now)) };
}
