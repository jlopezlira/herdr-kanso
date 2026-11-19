// Memory, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// No host calls here, so the tests load it as is.
import { parseOr, clock, num, pad2, sizeMB, dayWord, RANGES } from "./pure.js";
export { clock, RANGES };
export const size = sizeMB;

export const STALE_MS = 3 * 60_000;
export const leaveShowAll = (showAll) => (showAll ? false : null);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function span(min) {
  const n = num(min);
  if (n === null) return "";
  if (n < 1) return "now";
  if (n < 60) return `${Math.round(n)} min`;
  if (n < 48 * 60) return `${Math.round(n / 60)} h`;
  return `${Math.round(n / 1440)} d`;
}

// The guard's own envelope: one version, one moment, and the lists it promises.
const versioned = (raw) => Boolean(raw) && typeof raw === "object" && raw.v === 1 && num(raw.at) !== null;

export function parseNow(text, now = Date.now()) {
  if (!text || !String(text).trim()) return { state: "off", data: null };
  const raw = parseOr(text, null);
  if (!versioned(raw)) return { state: "bad", data: null };
  const data = {
    ...raw,
    agents: (Array.isArray(raw.agents) ? raw.agents.filter((a) => a && typeof a === "object") : []).toSorted((a, b) => (num(b.mb) ?? 0) - (num(a.mb) ?? 0)),
    heaviest: Array.isArray(raw.heaviest) ? raw.heaviest.filter((p) => p && typeof p === "object") : [],
    events: Array.isArray(raw.events) ? raw.events.filter((e) => e && num(e.at)).toSorted((a, b) => b.at - a.at) : [],
    machine: raw.machine ?? {},
    window: raw.window ?? {},
    core: raw.core ?? {},
    limits: raw.limits ?? {},
  };
  return { state: now - data.at > STALE_MS ? "stale" : "ok", data };
}

export const unreadable = (error) => ({ state: "bad", data: null, why: String(error?.message ?? error ?? "").trim() });

// What the page's reading state allows: the failure to draw (an absent file is Off, not a failure), the Refresh in an unreadable page's line,
// and the header Refresh, which starts a check only while no action runs.
export function refreshPlan({ now, busy = {} }) {
  const bad = now?.state === "bad";
  const words = bad ? now.why ?? "" : "";
  return {
    failure: words ? { text: "Memory could not be read", source: words, fix: "Refresh" } : null,
    inline: bad && !words,
    header: { enabled: Object.keys(busy).length === 0, busy: Boolean(busy.check) },
  };
}

export const agentsMB = (data) => (data?.agents ?? []).reduce((sum, a) => sum + (num(a.mb) ?? 0), 0);

export function agentMeta(a) {
  const state = a.status === "working" ? "working" : num(a.idleMin) !== null ? `idle ${span(a.idleMin)}` : "idle";
  return [a.kind, a.terminal, state, num(a.ageMin) !== null ? `up ${span(a.ageMin)}` : null].filter(Boolean).map(String);
}

export function limitsNote(l = {}) {
  return [
    num(l.windowMB) ? `Window restarts past ${sizeMB(l.windowMB)}` : null,
    l.recycle === false ? "agents are never recycled"
      : num(l.agentMB) ? `idle agents recycle past ${sizeMB(l.agentMB)}${num(l.agentIdleMin) ? ` after ${span(l.agentIdleMin)}` : ""}` : null,
    num(l.lowFreePct) ? `notice under ${l.lowFreePct}% free` : null,
  ].filter(Boolean).join(" · ");
}

// Each bucket is the lowest free % seen in it; the 24 h view reads minute samples, the others hourly.
export function freeSeries(history, key, now = Date.now(), low = null) {
  const range = RANGES.find((r) => r.key === key) ?? RANGES[0];
  const minutes = Array.isArray(history?.minutes) ? history.minutes : [];
  const hours = Array.isArray(history?.hours) ? history.hours : [];
  const rows = key === "day" && minutes.length ? minutes : hours;
  const start = now - range.ms, step = range.ms / range.buckets;
  const samples = rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const at = num(row[0]), free = num(row[1]);
    if (at === null || free === null || at < start || at > now) return [];
    return [[Math.min(range.buckets - 1, Math.floor((at - start) / step)), free]];
  });
  const byBucket = Map.groupBy(samples, ([i]) => i);
  const lows = Array.from({ length: range.buckets }, (_, i) => {
    const seen = byBucket.get(i);
    return seen ? seen.reduce((m, [, free]) => (free < m ? free : m), seen[0][1]) : null;
  });
  const lowest = lows.reduce((best, v, i) => (v !== null && (best < 0 || v <= lows[best]) ? i : best), -1);
  const bars = lows.map((v, i) => {
    const from = start + i * step;
    const when = key === "day" ? clock(from, now) : `${dayWord(new Date(from))} ${pad2(new Date(from).getHours())}:00`;
    return v === null
      ? { ratio: 0, empty: true, tip: `${when} · no sample` }
      : { ratio: Math.max(0, Math.min(1, v / 100)), value: `${Math.round(v)}%`, low: low !== null && v < low, mark: i === lowest, tip: `${when} · ${Math.round(v)}% free at the lowest` };
  });
  const first = key === "day" ? `${pad2(new Date(start).getHours())}:${pad2(new Date(start).getMinutes())}` : dayWord(new Date(start));
  return { bars, first, last: "now", lowest: lowest < 0 ? null : bars[lowest].value, empty: lowest < 0 };
}

// All sparks share one scale, so rows compare.
export function agentSparks(history, now = Date.now(), days = 14) {
  const agents = history?.agents && typeof history.agents === "object" ? history.agents : {};
  const start = now - days * DAY;
  const rows = Object.entries(agents).map(([key, entry]) => {
    const points = (Array.isArray(entry?.points) ? entry.points : []).flatMap((p) => {
      const at = num(p?.[0]), mb = num(p?.[1]);
      if (at === null || mb === null || at < start || at > now) return [];
      return [[Math.min(days - 1, Math.floor((at - start) / DAY)), mb]];
    });
    const byDay = Map.groupBy(points, ([i]) => i);
    const daily = Array.from({ length: days }, (_, i) => (byDay.get(i) ?? []).reduce((m, [, mb]) => Math.max(m, mb), 0));
    return [key, { name: entry?.name, kind: entry?.kind, daily }];
  });
  const top = rows.reduce((t, [, spark]) => Math.max(t, ...spark.daily), 0);
  return Object.fromEntries(rows.map(([key, spark]) => [key, { ...spark, ratios: spark.daily.map((mb) => (top > 0 ? mb / top : 0)) }]));
}

export function sparkFor(sparks, agent) {
  if (!sparks || !agent) return null;
  for (const key of [agent.session, `${agent.kind}:${agent.name}`, agent.name, agent.pid != null ? String(agent.pid) : null]) {
    if (key && sparks[key]) return sparks[key];
  }
  return Object.values(sparks).find((s) => s.name === agent.name && (!s.kind || s.kind === agent.kind)) ?? null;
}

export function digestHistory(text, now = Date.now(), low = null) {
  const history = text ? parseOr(text, null) : null;
  if (!history || history.v !== 1) return null;
  const series = Object.fromEntries(RANGES.map((r) => [r.key, freeSeries(history, r.key, now, low)]));
  const t = history.totals ?? {};
  return {
    series,
    sparks: agentSparks(history, now),
    totals: { recycles: num(t.recycles) ?? 0, closed: num(t.closed) ?? 0, recycledMB: num(t.recycledMB) ?? num(t.freedMB) ?? 0, closedMB: num(t.closedMB) ?? 0, restarts: num(t.restarts) ?? 0, reaped: num(t.reaped) ?? 0, freedMB: num(t.freedMB) ?? 0, since: num(t.since) },
  };
}

// About what a recycled Claude agent weighs once it is back, in MB.
export const FRESH_MB = 230;

export function groupAgents(agents = [], focused = null) {
  const bySize = (a, b) => (num(b.mb) ?? 0) - (num(a.mb) ?? 0);
  const sorted = agents.filter((a) => a.recyclable).toSorted(bySize);
  // What "Recycle all" takes: everyone ready but the agent you are on.
  const ready = sorted, batchable = sorted.filter((a) => !focused || a.terminal !== focused);
  const working = agents.filter((a) => !a.recyclable && a.status === "working").toSorted(bySize);
  const other = agents.filter((a) => !a.recyclable && a.status !== "working").toSorted(bySize);
  return { ready, batchable, working, other };
}

export const freedEstimate = (list) => list.reduce((sum, a) => sum + Math.max(0, (num(a.mb) ?? 0) - FRESH_MB), 0);

export function parseBatch(text, now = Date.now()) {
  const b = parseOr(text ?? "", null);
  if (!b || typeof b !== "object" || !num(b.at) || num(b.total) === null) return null;
  const done = Array.isArray(b.done) ? b.done : [];
  // A running batch saves at least once per agent, so 5 minutes silent means it was cut short.
  const beat = num(b.beat) ?? b.at;
  const interrupted = !b.finished && now - beat > 5 * 60_000;
  const ended = b.finished ? (num(b.finishedAt) ?? beat) : beat;
  if ((b.finished || interrupted) && now - ended > 10 * 60_000) return null;
  const freed = done.reduce((sum, d) => sum + (d.ok ? Math.max(0, (num(d.beforeMB) ?? 0) - (num(d.afterMB) ?? num(d.beforeMB) ?? 0)) : 0), 0);
  return { kind: b.kind === "close" ? "close" : "recycle", at: b.at, total: b.total, done, current: b.current ?? null, finished: Boolean(b.finished) || interrupted, interrupted, error: b.error ?? null, ok: done.filter((d) => d.ok).length, freed, skippedFocused: b.skippedFocused ?? null, overMB: num(b.overMB) ?? 0 };
}

export function staleAgents(agents = [], minIdle = 2880, focused = null) {
  return agents.filter((a) => a.closeable !== false && a.kind === "claude" && a.status === "idle" && (num(a.idleMin) ?? 0) >= minIdle && (!focused || a.terminal !== focused))
    .toSorted((a, b) => (num(b.idleMin) ?? 0) - (num(a.idleMin) ?? 0));
}

export function idleWords(min) {
  const n = num(min) ?? 0;
  if (n >= 1440 && n % 1440 === 0) return `${n / 1440} ${n === 1440 ? "day" : "days"}`;
  if (n >= 60) return `${Math.round(n / 60)} hours`;
  return `${Math.round(n)} min`;
}

export function installError(text, since) {
  const raw = parseOr(text, null);
  return raw && typeof raw.at === "number" && raw.at >= since && raw.ok === false ? String(raw.reason || "Memory could not turn on") : null;
}
