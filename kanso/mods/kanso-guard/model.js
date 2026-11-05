// Memory, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What the guard's files say, made ready to draw: no host calls here, so the
// tests load it as is. The daemon (guard.mjs) writes now.json every minute
// and history.json alongside; the view reads both and keeps only what this
// file derives from them (a few hundred short strings and ratios).

/** now.json older than this means the guard stopped. */
export const STALE_MS = 3 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pad = (n) => String(n).padStart(2, "0");

/** A size in MB as a person reads it: "640 MB", "1.4 GB", "12 GB". */
export function size(mb) {
  const n = num(mb);
  if (n === null) return "–";
  if (n < 1000) return `${Math.max(0, Math.round(n))} MB`;
  const gb = n / 1024;
  return `${gb < 10 ? gb.toFixed(1).replace(/\.0$/, "") : Math.round(gb)} GB`;
}

/** Minutes as a short span: "now", "12 min", "5 h", "3 d". */
export function span(min) {
  const n = num(min);
  if (n === null) return "";
  if (n < 1) return "now";
  if (n < 60) return `${Math.round(n)} min`;
  if (n < 48 * 60) return `${Math.round(n / 60)} h`;
  return `${Math.round(n / 1440)} d`;
}

/** A moment: "14:05" today, "Nov 3 14:05" before. */
export function clock(ms, now = Date.now()) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

/**
 * now.json as `{ state, data }`: "off" when there is none, "bad" when it
 * can't be read, "stale" when the guard stopped writing it, else "ok".
 */
export function parseNow(text, now = Date.now()) {
  if (!text || !String(text).trim()) return { state: "off", data: null };
  let data;
  try { data = JSON.parse(text); } catch { return { state: "bad", data: null }; }
  if (!data || typeof data !== "object" || data.v !== 1 || !num(data.at)) return { state: "bad", data: null };
  data.agents = Array.isArray(data.agents) ? data.agents.filter((a) => a && typeof a === "object") : [];
  data.agents.sort((a, b) => (num(b.mb) ?? 0) - (num(a.mb) ?? 0));
  data.heaviest = Array.isArray(data.heaviest) ? data.heaviest.filter((p) => p && typeof p === "object") : [];
  data.events = Array.isArray(data.events) ? data.events.filter((e) => e && num(e.at)).sort((a, b) => b.at - a.at) : [];
  data.machine = data.machine ?? {};
  data.window = data.window ?? {};
  data.core = data.core ?? {};
  data.limits = data.limits ?? {};
  return { state: now - data.at > STALE_MS ? "stale" : "ok", data };
}

/** The agents' footprint together, in MB. */
export const agentsMB = (data) => (data?.agents ?? []).reduce((sum, a) => sum + (num(a.mb) ?? 0), 0);

/** One agent's line under its name: kind, terminal, state, age. */
export function agentMeta(a) {
  const state = a.status === "working" ? "working" : num(a.idleMin) !== null ? `idle ${span(a.idleMin)}` : "idle";
  return [a.kind, a.terminal, state, num(a.ageMin) !== null ? `up ${span(a.ageMin)}` : null].filter(Boolean).map(String);
}

/** The limits the guard works to, as one footnote line. */
export function limitsNote(l = {}) {
  const parts = [];
  if (num(l.windowMB)) parts.push(`Window restarts past ${size(l.windowMB)}`);
  if (l.recycle === false) parts.push("agents are never recycled");
  else if (num(l.agentMB)) parts.push(`idle agents recycle past ${size(l.agentMB)}${num(l.agentIdleMin) ? ` after ${span(l.agentIdleMin)}` : ""}`);
  if (num(l.lowFreePct)) parts.push(`notice under ${l.lowFreePct}% free`);
  return parts.join(" · ");
}

export const RANGES = [
  { key: "day", label: "24 h", ms: DAY, buckets: 96 },
  { key: "week", label: "7 days", ms: 7 * DAY, buckets: 84 },
  { key: "month", label: "30 days", ms: 30 * DAY, buckets: 90 },
];

/**
 * Free memory over a range, as bars: each bucket is the lowest free % seen
 * in it. The 24 h view reads the per-minute samples, the others the hourly
 * ones (their minimum column). The lowest bucket is `mark`ed; a bucket under
 * `low` is `low`; a bucket with no sample has ratio 0 and `empty`.
 */
export function freeSeries(history, key, now = Date.now(), low = null) {
  const range = RANGES.find((r) => r.key === key) ?? RANGES[0];
  const minutes = Array.isArray(history?.minutes) ? history.minutes : [];
  const hours = Array.isArray(history?.hours) ? history.hours : [];
  const rows = key === "day" && minutes.length ? minutes : hours;
  const start = now - range.ms, step = range.ms / range.buckets;
  const lows = new Array(range.buckets).fill(null);
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = num(row[0]), free = num(row[1]);
    if (at === null || free === null || at < start || at > now) continue;
    const i = Math.min(range.buckets - 1, Math.floor((at - start) / step));
    if (lows[i] === null || free < lows[i]) lows[i] = free;
  }
  let lowest = -1;
  lows.forEach((v, i) => { if (v !== null && (lowest < 0 || v <= lows[lowest])) lowest = i; });
  const bars = lows.map((v, i) => {
    const from = start + i * step;
    const when = key === "day" ? clock(from, now) : `${MONTHS[new Date(from).getMonth()]} ${new Date(from).getDate()} ${pad(new Date(from).getHours())}:00`;
    return v === null
      ? { ratio: 0, empty: true, tip: `${when} · no sample` }
      : { ratio: Math.max(0, Math.min(1, v / 100)), value: `${Math.round(v)}%`, low: low !== null && v < low, mark: i === lowest, tip: `${when} · ${Math.round(v)}% free at the lowest` };
  });
  const first = key === "day" ? `${pad(new Date(start).getHours())}:${pad(new Date(start).getMinutes())}` : `${MONTHS[new Date(start).getMonth()]} ${new Date(start).getDate()}`;
  return { bars, first, last: "now", lowest: lowest < 0 ? null : bars[lowest].value, empty: lowest < 0 };
}

/**
 * Each agent's last 14 days, one bar a day (its largest footprint that day),
 * all on one scale so rows compare. Keyed as history.json keys them.
 */
export function agentSparks(history, now = Date.now(), days = 14) {
  const agents = history?.agents && typeof history.agents === "object" ? history.agents : {};
  const start = now - days * DAY;
  const out = {};
  let top = 0;
  for (const [key, entry] of Object.entries(agents)) {
    const daily = new Array(days).fill(0);
    for (const p of Array.isArray(entry?.points) ? entry.points : []) {
      const at = num(p?.[0]), mb = num(p?.[1]);
      if (at === null || mb === null || at < start || at > now) continue;
      const i = Math.min(days - 1, Math.floor((at - start) / DAY));
      daily[i] = Math.max(daily[i], mb);
    }
    top = Math.max(top, ...daily);
    out[key] = { name: entry?.name, kind: entry?.kind, daily };
  }
  for (const spark of Object.values(out)) spark.ratios = spark.daily.map((mb) => (top > 0 ? mb / top : 0));
  return out;
}

/** An agent's sparkline: by session, then by kind and name. */
export function sparkFor(sparks, agent) {
  if (!sparks || !agent) return null;
  for (const key of [agent.session, `${agent.kind}:${agent.name}`, agent.name, agent.pid != null ? String(agent.pid) : null]) {
    if (key && sparks[key]) return sparks[key];
  }
  return Object.values(sparks).find((s) => s.name === agent.name && (!s.kind || s.kind === agent.kind)) ?? null;
}

/** history.json, once a minute, down to what the view draws. */
export function digestHistory(text, now = Date.now(), low = null) {
  let history = null;
  try { history = text ? JSON.parse(text) : null; } catch { history = null; }
  if (!history || history.v !== 1) return null;
  const series = {};
  for (const r of RANGES) series[r.key] = freeSeries(history, r.key, now, low);
  const t = history.totals ?? {};
  return {
    series,
    sparks: agentSparks(history, now),
    totals: { recycles: num(t.recycles) ?? 0, restarts: num(t.restarts) ?? 0, reaped: num(t.reaped) ?? 0, freedMB: num(t.freedMB) ?? 0, since: num(t.since) },
  };
}

/** About what a recycled Claude agent weighs once it is back, in MB. */
export const FRESH_MB = 230;

/**
 * The agents in three groups: ready (idle, can be recycled, heaviest first),
 * working, and the rest (each with why it can't be recycled).
 */
export function groupAgents(agents = [], focused = null) {
  const bySize = (a, b) => (num(b.mb) ?? 0) - (num(a.mb) ?? 0);
  const ready = agents.filter((a) => a.recyclable).sort(bySize);
  // What "Recycle all" takes: everyone ready but the agent you are on.
  ready.batchable = ready.filter((a) => !focused || a.terminal !== focused);
  const working = agents.filter((a) => !a.recyclable && a.status === "working").sort(bySize);
  const other = agents.filter((a) => !a.recyclable && a.status !== "working").sort(bySize);
  return { ready, working, other };
}

/** Roughly what recycling these gives back, in MB. */
export const freedEstimate = (list) => list.reduce((sum, a) => sum + Math.max(0, (num(a.mb) ?? 0) - FRESH_MB), 0);

/**
 * batch.json as what the panel shows, or null when there is nothing to say:
 * a batch running (started in the last 15 minutes) or one finished in the
 * last 10.
 */
export function parseBatch(text, now = Date.now()) {
  let b;
  try { b = JSON.parse(text ?? ""); } catch { return null; }
  if (!b || typeof b !== "object" || !num(b.at) || num(b.total) === null) return null;
  const done = Array.isArray(b.done) ? b.done : [];
  // A running batch saves at least once per agent; one silent for 5 minutes
  // was cut short (the guard stopped or the machine slept).
  const beat = num(b.beat) ?? b.at;
  const interrupted = !b.finished && now - beat > 5 * 60_000;
  const ended = b.finished ? (num(b.finishedAt) ?? beat) : beat;
  if ((b.finished || interrupted) && now - ended > 10 * 60_000) return null;
  const freed = done.reduce((sum, d) => sum + (d.ok ? Math.max(0, (num(d.beforeMB) ?? 0) - (num(d.afterMB) ?? num(d.beforeMB) ?? 0)) : 0), 0);
  return { at: b.at, total: b.total, done, current: b.current ?? null, finished: Boolean(b.finished) || interrupted, interrupted, error: b.error ?? null, ok: done.filter((d) => d.ok).length, freed, skippedFocused: b.skippedFocused ?? null, overMB: num(b.overMB) ?? 0 };
}
