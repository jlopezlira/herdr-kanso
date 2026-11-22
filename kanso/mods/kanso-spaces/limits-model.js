export const LIMIT_LABEL = "kanso.limit";
export const AT_RESET_LABEL = "kanso.limit.resume";
export const COMMAND_LABEL = "kanso.limit.cmd";
export const SNOOZE_LABEL = "kanso.snooze";
export const READ_TRIES = 3;
export const RETRY_MS = 3000;
export const UNKNOWN_RESET = "?";
export const LIMIT_APPS = Object.freeze(["claude-code", "codex"]);
export const RESUME_GRACE_MS = 60_000;
export const SCREEN_TAIL = 15;

const PROVIDER_OF = Object.freeze({ "claude-code": "claude", codex: "codex" });
const LIMIT_PHRASE = /usage limit|hit your (?:[\w-]+ ){0,3}limit|(?:session|weekly|daily|5-hour|opus|sonnet|plan) limit reached|limit will reset/gi;
const NOT_PLAN = /fast mode|fast limit|context limit|budget limit|subagent|concurrent|export limit|nesting|recursion|device limit|spend limit/i;
const BOX = /[\u{2500}-\u{259f}]/gu;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const UNIT_MS = Object.freeze({ d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 });
const DAY_MS = UNIT_MS.d;

export const providerOf = (app) => PROVIDER_OF[app] ?? null;
const waits = (status) => status === "done" || status === "idle" || status === "blocked";

export function limitOf(labels) {
  const raw = String(labels?.[LIMIT_LABEL] ?? "").trim();
  if (!raw) return null;
  const until = Number(raw);
  return { until: raw !== UNKNOWN_RESET && Number.isFinite(until) && until > 0 ? until : null };
}

export const resumeToken = (limit) => (limit?.until ? String(limit.until) : null);
export const resumeArmed = (labels) => {
  const token = resumeToken(limitOf(labels));
  return Boolean(token) && String(labels?.[AT_RESET_LABEL] ?? "") === token;
};

const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function resetWords(until, now) {
  if (!until) return null;
  if (sameDay(until, now)) return clock(until);
  const date = new Date(until).toDateString();
  return until - now < 6 * DAY_MS ? `${date.slice(0, 3)} ${clock(until)}` : `${date.slice(4, 10)} ${clock(until)}`;
}

export function limitWords(limit, now) {
  const when = resetWords(limit?.until, now);
  return when ? `Limited until ${when}` : "Limited";
}

const durationMs = (text) => {
  const parts = [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*(days?|d\b|hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/gi)];
  if (!parts.length) return null;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT_MS[unit[0].toLowerCase()], 0);
};

function timeOfDay(text) {
  const t = [...String(text).matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?=[\s.,)]|$)/gi)].find((m) => m[2] || m[3]);
  if (!t) return null;
  const hour = t[3] ? Number(t[1]) % 12 + (/p/i.test(t[3]) ? 12 : 0) : Number(t[1]);
  const minute = Number(t[2] ?? 0);
  return hour < 24 && minute < 60 ? { hour, minute, rest: String(text).slice(0, t.index) } : null;
}

function dateOf(rest, now) {
  const base = new Date(now);
  const md = rest.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if (md) return { year: Number(md[3] ?? base.getFullYear()), month: MONTHS.indexOf(md[1].toLowerCase()), day: Number(md[2]), fixed: Boolean(md[3]) };
  const wd = rest.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
  if (wd) {
    const ahead = (DAYS.indexOf(wd[1].toLowerCase()) - base.getDay() + 7) % 7;
    return { year: base.getFullYear(), month: base.getMonth(), day: base.getDate() + ahead, weekday: true };
  }
  if (/\btomorrow\b/i.test(rest)) return { year: base.getFullYear(), month: base.getMonth(), day: base.getDate() + 1, fixed: true };
  return null;
}

export function whenOf(text, now) {
  const inDuration = String(text).match(/^\s*in\s+(.+)/i);
  if (inDuration) {
    const ms = durationMs(inDuration[1]);
    return ms == null ? null : now + ms;
  }
  const time = timeOfDay(text);
  if (!time) return null;
  const date = dateOf(time.rest, now);
  const base = new Date(now);
  const at = (d) => new Date(d.year, d.month, d.day, time.hour, time.minute, 0, 0).getTime();
  if (!date) {
    const today = at({ year: base.getFullYear(), month: base.getMonth(), day: base.getDate() });
    return today > now ? today : today + DAY_MS;
  }
  const first = at(date);
  if (first > now || date.fixed) return first;
  if (date.weekday) return first + 7 * DAY_MS;
  return at({ ...date, year: date.year + 1 });
}

const wallOffset = (ms, zone) => {
  if (!zone) return -new Date(ms).getTimezoneOffset() * 60_000;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
  } catch {
    return -new Date(ms).getTimezoneOffset() * 60_000;
  }
};

export function whenIn(text, zone, now) {
  const shift = wallOffset(now, zone) - wallOffset(now, null);
  const at = whenOf(text, now + shift);
  return at == null ? null : at - shift;
}

const RESET_AT = /(?:resets?|reset at|will reset at|try again)\s+(?:at\s+|on\s+)?(in\s+[^.()]+|[^()]+?)(?:\s*\(([^)]*)\))?\s*(?:[.·\u{2219}|]|$)/iu;

export function parseLimit(screen, now) {
  const lines = String(screen ?? "").split(/\r?\n/).map((l) => l.replace(BOX, " ").trim()).filter(Boolean);
  const tail = lines.slice(-SCREEN_TAIL).join(" ").replace(/\s+/g, " ");
  const hit = [...tail.matchAll(LIMIT_PHRASE)].filter((m) => !NOT_PLAN.test(tail.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20))).at(-1);
  if (!hit) return null;
  const found = tail.slice(hit.index, hit.index + 320).match(RESET_AT);
  const until = found ? whenIn(found[1], found[2]?.trim() || null, now) : null;
  return { until: until && until > now - DAY_MS ? until : null };
}

export const limitLabel = (limit) => `${LIMIT_LABEL}=${limit?.until ? String(limit.until) : UNKNOWN_RESET}`;
export const clearLabels = (labels = {}) => {
  const until = limitOf(labels)?.until;
  const ours = until && Number(labels?.[SNOOZE_LABEL]) === until ? [`${SNOOZE_LABEL}=`] : [];
  return [`${LIMIT_LABEL}=`, `${AT_RESET_LABEL}=`, `${COMMAND_LABEL}=`, ...ours];
};

export const commandOf = (labels) => {
  try {
    const words = JSON.parse(String(labels?.[COMMAND_LABEL] ?? ""));
    return Array.isArray(words) && words.every((w) => typeof w === "string") ? words : [];
  } catch {
    return [];
  }
};

export function limitStep({ status, app, labels = {} }) {
  if (status === "working") return limitOf(labels) || labels?.[AT_RESET_LABEL] ? { act: "clear", labels: clearLabels(labels) } : { act: "none" };
  if (waits(status) && !limitOf(labels) && LIMIT_APPS.includes(app)) return { act: "read" };
  return { act: "none" };
}

export function foundLabels(limit, auto) {
  if (!limit) return [];
  const token = resumeToken(limit);
  return [limitLabel(limit), ...(auto && token ? [`${AT_RESET_LABEL}=${token}`] : [])];
}

export function withLimits(list, terms, now = Date.now()) {
  const byAddress = new Map((terms ?? []).flatMap((term) => (limitOf(term?.labels) ? [[term.address, limitOf(term.labels)]] : [])));
  if (!byAddress.size) return list;
  return list.map((a) => {
    const limit = byAddress.get(a.address);
    return limit && waits(a.status) ? { ...a, status: "limited", msg: limitWords(limit, now), limit } : a;
  });
}

export function limitedProviders(list, now = Date.now()) {
  return (list ?? []).reduce((acc, a) => {
    const provider = a.status === "limited" ? providerOf(a.app) ?? a.program?.key ?? null : null;
    const until = a.limit?.until ?? null;
    if (!provider || (until && until <= now)) return acc;
    const was = acc[provider];
    return { ...acc, [provider]: { until: was === undefined ? until : was.until && until ? Math.max(was.until, until) : null } };
  }, {});
}
