// Ports' history, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What the guard's ports.json says, made ready to draw: no host calls here,
// so the tests load it as is. The guard (kanso-guard/guard.mjs, every minute)
// writes the servers listening now, 24 hours by the minute and 90 days by the
// hour of how many ran (and how many with no pane), the last 30 days of
// servers with how each ended, and the totals of what Stop gave back.
import { parseOr } from "./pure.js";

/** ports.json older than this means the guard stopped. */
export const STALE_MS = 3 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pad = (n) => String(n).padStart(2, "0");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A size in MB as a person reads it: "640 MB", "1.4 GB", "12 GB". */
export function size(mb) {
  const n = num(mb);
  if (n === null) return "–";
  if (n < 1000) return `${Math.max(0, Math.round(n))} MB`;
  const gb = n / 1024;
  return `${gb < 10 ? gb.toFixed(1).replace(/\.0$/, "") : Math.round(gb)} GB`;
}

/** A duration in ms, short: "40 s", "12 min", "5 h", "3 d". */
export function lasted(ms) {
  const n = Math.max(0, num(ms) ?? 0);
  if (n < 60_000) return `${Math.max(1, Math.round(n / 1000))} s`;
  if (n < HOUR) return `${Math.round(n / 60_000)} min`;
  if (n < 2 * DAY) return `${Math.round(n / HOUR)} h`;
  return `${Math.round(n / DAY)} d`;
}

/** A moment: "14:05" today, "Nov 3 14:05" before. */
export function clock(ms, now = Date.now()) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

const day = (ms) => `${MONTHS[new Date(ms).getMonth()]} ${new Date(ms).getDate()}`;
const startOfDay = (now) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

const server = (s) => ({
  key: String(s.key ?? `${s.pid}@${s.startedAt}`), pid: num(s.pid),
  ports: Array.isArray(s.ports) ? s.ports.filter((p) => num(p)) : [],
  command: String(s.command ?? ""), args: String(s.args ?? ""), cwd: s.cwd ? String(s.cwd) : null, project: s.project ? String(s.project) : null,
  owner: s.owner ?? null, mb: num(s.mb), peakMB: num(s.peakMB) ?? num(s.mb),
  startedAt: num(s.startedAt) ?? num(s.firstSeen), firstSeen: num(s.firstSeen) ?? num(s.startedAt), lastSeen: num(s.lastSeen),
  everLoose: Boolean(s.everLoose),
  ended: s.ended && typeof s.ended === "object" && num(s.ended.at)
    ? { at: s.ended.at, how: s.ended.how === "stopped" ? "stopped" : "exited", freedMB: num(s.ended.freedMB) ?? 0 } : null,
});
const rows = (list) => (Array.isArray(list) ? list.filter((r) => Array.isArray(r) && num(r[0]) !== null) : []);

/**
 * ports.json as `{ state, data }`: "off" when there is none, "bad" when it
 * can't be read, "stale" when the guard stopped writing it, else "ok".
 */
export function parsePorts(text, now = Date.now()) {
  if (!text || !String(text).trim()) return { state: "off", data: null };
  const raw = parseOr(text);
  if (!raw || typeof raw !== "object" || raw.v !== 1 || !num(raw.at)) return { state: "bad", data: null };
  const keep = (list) => (Array.isArray(list) ? list.filter((s) => s && typeof s === "object" && num(s.pid) !== null).map(server) : []);
  const t = raw.totals && typeof raw.totals === "object" ? raw.totals : {};
  const data = {
    at: raw.at,
    now: keep(raw.now),
    minutes: rows(raw.minutes),
    hours: rows(raw.hours),
    servers: keep(raw.servers).toSorted((a, b) => (b.lastSeen ?? b.startedAt ?? 0) - (a.lastSeen ?? a.startedAt ?? 0)),
    totals: { opened: num(t.opened) ?? 0, stopped: num(t.stopped) ?? 0, exited: num(t.exited) ?? 0, freedMB: num(t.freedMB) ?? 0, since: num(t.since) },
  };
  return { state: now - data.at > STALE_MS ? "stale" : "ok", data };
}

/**
 * A live row's history: the guard's entry for the same process (its pid,
 * started within two minutes of what ps says), or null.
 */
export function historyOf(live, data, now = Date.now()) {
  if (!data || !live) return null;
  const started = num(live.secs) !== null ? now - live.secs * 1000 : null;
  return data.now.find((n) => n.pid === live.pid && (started === null || n.startedAt === null || Math.abs(n.startedAt - started) < 2 * 60_000)) ?? null;
}

export const RANGES = [
  { key: "day", label: "24 h", ms: DAY, buckets: 96 },
  { key: "week", label: "7 days", ms: 7 * DAY, buckets: 84 },
  { key: "month", label: "30 days", ms: 30 * DAY, buckets: 90 },
];

/**
 * Servers running over a range, as bars: each bucket holds the most that ran
 * at once in it, and the most with no pane. The 24 h view reads the
 * per-minute samples, the others the hourly ones. The peak is `mark`ed; a
 * bucket with no sample is `empty`. Ratios are on the range's own peak.
 */
export function activeSeries(data, key, now = Date.now()) {
  const range = RANGES.find((r) => r.key === key) ?? RANGES[0];
  const source = key === "day" && data?.minutes?.length ? data.minutes : data?.hours ?? [];
  const start = now - range.ms, step = range.ms / range.buckets;
  // The samples in the range, by bucket.
  const inRange = source.filter((row) => {
    const at = num(row[0]), n = num(row[1]);
    return !(at === null || n === null || at < start || at > now);
  });
  const byBucket = Map.groupBy(inRange, (row) => Math.min(range.buckets - 1, Math.floor((num(row[0]) - start) / step)));
  const active = Array.from({ length: range.buckets }, (_, i) => (byBucket.has(i) ? byBucket.get(i).reduce((m, row) => Math.max(m, num(row[1])), 0) : null));
  const loose = Array.from({ length: range.buckets }, (_, i) => (byBucket.get(i) ?? []).reduce((m, row) => Math.max(m, Math.min(num(row[1]), num(row[2]) ?? 0)), 0));
  // The peak: the fullest bucket, the latest of equals.
  const peak = active.reduce((p, v, i) => (v !== null && (p < 0 || v >= active[p]) ? i : p), -1);
  const top = peak < 0 ? 0 : active[peak];
  const bars = active.map((v, i) => {
    const from = start + i * step;
    const when = key === "day" ? clock(from, now) : `${day(from)} ${pad(new Date(from).getHours())}:00`;
    if (v === null) return { ratio: 0, looseRatio: 0, empty: true, active: 0, loose: 0, tip: `${when} · no sample` };
    return {
      active: v, loose: loose[i], ratio: top > 0 ? v / top : 0, looseRatio: top > 0 ? loose[i] / top : 0,
      mark: i === peak && top > 0, value: String(v),
      tip: `${when} · ${plural(v, "server", "servers")}${loose[i] ? `, ${loose[i]} with no pane` : ""}`,
    };
  });
  const first = key === "day" ? `${pad(new Date(start).getHours())}:${pad(new Date(start).getMinutes())}` : day(start);
  return { bars, first, last: "now", peak: top, empty: peak < 0, filled: bars.filter((b) => !b.empty).length };
}

/** The numbers the stats row and the card share. */
export function portStats(data, now = Date.now()) {
  const today = startOfDay(now), week = now - 7 * DAY;
  const servers = data?.servers ?? [];
  const opened = (from) => servers.filter((s) => (s.startedAt ?? 0) >= from).length;
  const weekPeak = Math.max(0, ...rows([...(data?.minutes ?? []), ...(data?.hours ?? [])]).filter((r) => r[0] >= week && r[0] <= now).map((r) => num(r[1]) ?? 0));
  const left = servers.filter((s) => s.everLoose);
  const stoppedLoose = left.filter((s) => s.ended?.how === "stopped");
  return {
    running: data?.now?.length ?? 0,
    loose: (data?.now ?? []).filter((s) => !s.owner).length,
    heldMB: (data?.now ?? []).reduce((t, s) => t + (s.mb ?? 0), 0),
    openedToday: opened(today),
    openedWeek: opened(week),
    weekPeak,
    leftBehind: left.length,
    leftWeek: left.filter((s) => (s.lastSeen ?? s.startedAt ?? 0) >= week).length,
    stoppedLoose: stoppedLoose.length,
    stoppedLooseMB: stoppedLoose.reduce((t, s) => t + (s.ended.freedMB ?? 0), 0),
    stopped: data?.totals?.stopped ?? 0,
    freedMB: data?.totals?.freedMB ?? 0,
    since: data?.totals?.since ?? null,
  };
}

/**
 * The history lists: servers opened today (newest first) and servers that
 * ended (latest end first), each row as the panel words it.
 */
export function historyLists(data, now = Date.now()) {
  const today = startOfDay(now);
  const servers = data?.servers ?? [];
  const row = (s) => {
    const end = s.ended?.at ?? null;
    return {
      key: s.key,
      name: s.project || s.command || String(s.pid),
      ports: s.ports.map((p) => `:${p}`).join(" "),
      opened: s.startedAt ? `opened ${clock(s.startedAt, now)}` : "",
      ran: end ? `ran ${lasted(end - (s.startedAt ?? end))}` : "running",
      how: !s.ended ? (s.owner ? "" : "no pane") : s.ended.how === "stopped" ? (s.ended.freedMB ? `stopped by you · ${size(s.ended.freedMB)} back` : "stopped by you") : "exited",
      loose: !s.ended && !s.owner,
      peak: s.peakMB !== null ? size(s.peakMB) : "",
    };
  };
  return {
    opened: servers.filter((s) => (s.startedAt ?? 0) >= today).toSorted((a, b) => b.startedAt - a.startedAt).map(row),
    ended: servers.filter((s) => s.ended).toSorted((a, b) => b.ended.at - a.ended.at).map(row),
  };
}
