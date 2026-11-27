import { sizedPage, barChart, chartBar, chartRoom } from "./ui-page.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, notify, exec } from "herdr";
import { Store, cohortOf, mergeHours, monthsIn } from "./shipped-store.js";
import { github, gql } from "./shipped-github.js";
import { shippedSpec, shareText } from "./shipped-card.js";
import { Share, shareRows } from "./share.js";
import { R, G, T, CHART, HEATMAP_GAP, TINT, alpha, tokens } from "./ui.js";
import { quietLink, iconButton } from "./ui-button.js";
import { section } from "./ui-section.js";
import { metric, skeletonOf, failureBlock, tooltip } from "./kit.js";
import { factList } from "./ui-facts.js";
import { segmented } from "./ui-tab.js";
import { MONTHS, mapSeries, clock } from "./pure.js";
import { shippedMemory } from "./panel-state.js";
import { spawnAndNotify, said } from "./lib.js";
import { dot } from "./ui-dot.js";

const DAY = 86400000;
const RECORDS = "kanso.shipped.records";
const REFRESH_MS = 12 * 60 * 60 * 1000;
const REPO_ROWS = 8;
const TREND = 6;
const RATE_FLOOR = 10;
const SETTLE_MS = 30 * 86400000;
export const PERIODS = ["day", "week", "month", "year"];
const PERIOD_NAMES = { day: "Day", week: "Week", month: "Month", year: "Year" };
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PROVIDERS = [github];

export const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const pct = (rate) => `${Math.round(rate * 100)}%`;
export const span = (ms) => (ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : ms < 2 * DAY ? `${Math.round(ms / 3600000)}h` : `${Math.round(ms / DAY)}d`);
const dayName = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const monthName = (ms) => { const d = new Date(ms); return `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIsoDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// A period in local time; weeks run from Monday.
export function periodRange(kind, offset, now = Date.now()) {
  const t = new Date(now), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  const monday = d - ((t.getDay() + 6) % 7) + 7 * offset;
  const [start, end] = kind === "day" ? [new Date(y, m, d + offset), new Date(y, m, d + offset + 1)]
    : kind === "week" ? [new Date(y, m, monday), new Date(y, m, monday + 7)]
      : kind === "month" ? [new Date(y, m + offset, 1), new Date(y, m + offset + 1, 1)]
        : [new Date(y + offset, 0, 1), new Date(y + offset + 1, 0, 1)];
  return { start: start.getTime(), end: end.getTime() };
}

// The period before, cut at the same point when the current one is still running.
export function comparedRange(kind, offset, now = Date.now()) {
  const prev = periodRange(kind, offset - 1, now);
  if (offset !== 0) return prev;
  const { start } = periodRange(kind, 0, now);
  return { start: prev.start, end: Math.min(prev.end, prev.start + (now - start)) };
}

export function periodLabel(kind, offset, now = Date.now()) {
  const { start, end } = periodRange(kind, offset, now);
  const s = new Date(start), e = new Date(end - DAY);
  if (kind === "day") return offset === 0 ? "Today" : offset === -1 ? "Yesterday" : `${WEEKDAYS[s.getDay()]} ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (kind === "week") return offset === 0 ? "This week" : offset === -1 ? "Last week" : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
  if (kind === "month") return offset === 0 ? "This month" : `${FULL_MONTHS[s.getMonth()]} ${s.getFullYear()}`;
  return offset === 0 ? "This year" : String(s.getFullYear());
}

const comparedLabel = (kind, offset) => offset === 0
  ? { day: "vs yesterday", week: "vs last week", month: "vs last month", year: "vs last year" }[kind]
  : { day: "vs the day before", week: "vs the week before", month: "vs the month before", year: "vs the year before" }[kind];

// Today without a contribution yet does not break the current run.
export function streaks(days, today) {
  const list = days ?? [];
  const { longest } = list.reduce((acc, d) => {
    if (!(d.contributionCount > 0)) return { run: 0, longest: acc.longest };
    const run = acc.run + 1;
    return { run, longest: run > acc.longest.n ? { n: run, end: d.date } : acc.longest };
  }, { run: 0, longest: { n: 0, end: null } });
  const last = list.length - 1;
  const upTo = last >= 0 && today != null && list[last].date >= today && list[last].contributionCount === 0 ? last : last + 1;
  const counted = list.slice(0, upTo);
  const current = counted.length - 1 - counted.findLastIndex((d) => !(d.contributionCount > 0));
  return { current, longest };
}

// The calendar's days (private ones included) when it reaches back that far, else the period's totals.
export function contributionsIn(days, start, end, totals) {
  if (days?.length && fromIsoDay(days[0].date) <= start) {
    return days.reduce((n, d) => { const at = fromIsoDay(d.date); return at >= start && at < end ? n + d.contributionCount : n; }, 0);
  }
  if (!totals) return null;
  return totals.totalCommitContributions + totals.totalPullRequestContributions + totals.totalPullRequestReviewContributions
    + totals.totalIssueContributions + totals.restrictedContributionsCount;
}

const STEPS = { day: { hours: 1 }, week: { hours: 4 }, month: { days: 1 }, year: { days: 7 } };

export function bucketsOf(kind, offset, now = Date.now()) {
  const { start, end } = periodRange(kind, offset, now), step = STEPS[kind];
  const next = (t) => { const d = new Date(t); return step.hours ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + step.hours).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate() + step.days).getTime(); };
  const walk = (t, out) => (t >= end ? out : walk(next(t), [...out, { start: t, end: Math.min(next(t), end) }]));
  return walk(start, []);
}

export function mergedBars(prs, kind, offset, now = Date.now()) {
  const buckets = bucketsOf(kind, offset, now);
  const merged = prs.filter((p) => p.merged && p.merged >= buckets[0].start && p.merged < buckets.at(-1).end).map((p) => p.merged);
  const counts = buckets.map((b) => merged.filter((m) => m >= b.start && m < b.end).length);
  const top = Math.max(1, ...counts);
  const current = offset === 0 ? buckets.findIndex((b) => now >= b.start && now < b.end) : counts.indexOf(Math.max(...counts));
  const hour = (t) => `${String(new Date(t).getHours()).padStart(2, "0")}:00`;
  const name = (b) => (kind === "day" ? hour(b.start) : kind === "week" ? `${WEEKDAYS[new Date(b.start).getDay()]} ${hour(b.start)}` : kind === "year" ? `week of ${dayName(b.start)}` : dayName(b.start));
  return {
    bars: buckets.map((b, i) => ({ ratio: counts[i] / top, mark: i === current, value: fmt(counts[i]), tip: `${fmt(counts[i])} merged · ${name(b)}`, future: b.start > now })),
    first: name(buckets[0]), last: name(buckets.at(-1)),
  };
}

export function trendOf(prs, kind, offset, login, now = Date.now(), n = TREND) {
  return Array.from({ length: n }, (_, i) => {
    const at = offset - (n - 1 - i), r = periodRange(kind, at, now);
    return { label: periodLabel(kind, at, now), ...cohortOf(prs, r.start, r.end, login) };
  });
}

export function computeRecords({ days, prs, login }, now = Date.now()) {
  const best = (list, score, make) => list.reduce((top, x) => (score(x) > 0 && (!top || score(x) > top.score) ? { score: score(x), value: make(x) } : top), null)?.value ?? null;
  const bestDay = best(days ?? [], (d) => d.contributionCount, (d) => ({ n: d.contributionCount, date: d.date }));
  const { longest } = streaks(days, null);
  const opened = prs ?? [];
  const by = (kind) => [...Map.groupBy(opened, (p) => periodRange(kind, 0, p.created).start)].map(([start, list]) => ({ start, ...cohortOf(list, start, periodRange(kind, 0, start).end, login) }));
  const weeks = by("week");
  const months = by("month");
  const prodWeek = best(weeks, (w) => w.prod, (w) => ({ n: w.prod, start: w.start }));
  const rateMonth = best(months.filter((m) => m.opened >= RATE_FLOOR && periodRange("month", 0, m.start).end <= now - SETTLE_MS), (m) => m.rate, (m) => ({ rate: m.rate, n: m.opened, start: m.start }));
  return {
    ...(bestDay ? { bestDay } : {}),
    ...(longest.n ? { longestStreak: longest } : {}),
    ...(prodWeek ? { prodWeek } : {}),
    ...(rateMonth ? { rateMonth } : {}),
  };
}

const BETTER = {
  bestDay: (a, b) => a.n > b.n, longestStreak: (a, b) => a.n > b.n, prodWeek: (a, b) => a.n > b.n, rateMonth: (a, b) => a.rate > b.rate,
};
export const RECORD_NAMES = { bestDay: "Best day", longestStreak: "Longest streak", prodWeek: "Most pull requests in production in a week", rateMonth: "Best month to production" };
const recordAt = (k, r) => (k === "bestDay" ? fromIsoDay(r.date) : k === "longestStreak" ? (r.end ? fromIsoDay(r.end) : 0) : r.start);

export function mergeRecords(stored, found, now = Date.now()) {
  return Object.entries(BETTER).reduce(({ kept, beaten }, [k, better]) => {
    const r = found[k];
    if (!r) return { kept, beaten };
    if (!kept[k]) return { kept: { ...kept, [k]: r }, beaten };
    if (k === "rateMonth" && (r.start === kept[k].start || !better(r, kept[k]))) return { kept: { ...kept, [k]: r }, beaten };
    if (!better(r, kept[k])) return { kept, beaten };
    const recent = stored?.[k] && now - recordAt(k, r) <= (k === "rateMonth" ? 31 : 7) * DAY;
    return { kept: { ...kept, [k]: r }, beaten: recent ? [...beaten, k] : beaten };
  }, { kept: { ...(stored ?? {}) }, beaten: [] });
}

export function recordText(k, r) {
  if (k === "bestDay") return { value: fmt(r.n), unit: r.n === 1 ? "contribution" : "contributions", detail: dayName(fromIsoDay(r.date)) };
  if (k === "longestStreak") return { value: fmt(r.n), unit: r.n === 1 ? "day" : "days", detail: r.end ? `to ${dayName(fromIsoDay(r.end))}` : "" };
  if (k === "prodWeek") return { value: fmt(r.n), unit: "pull requests", detail: `week of ${dayName(r.start)}` };
  return { value: pct(r.rate), unit: "in production", detail: `${monthName(r.start)}, ${fmt(r.n)} opened` };
}

export function heatLayout(width) {
  const w = Math.max(120, Math.floor(width));
  const weeks = Math.max(4, Math.min(53, Math.floor((w + HEATMAP_GAP) / (9 + HEATMAP_GAP))));
  const cell = Math.max(9, Math.min(16, Math.floor((w - (weeks - 1) * HEATMAP_GAP) / weeks)));
  return { weeks, cell };
}

export async function signedIn() {
  const r = await exec("gh", ["config", "get", "user", "-h", "github.com"]).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() || null : null;
}

class AccountChanged extends Error {
  constructor(login) { super("GitHub account changed."); this.login = login; }
}

export async function apiLogin() {
  const data = await gql("query{viewer{login}}").catch(() => null);
  return data?.viewer?.login ?? null;
}

export function mergeDays(kept, fresh, now = Date.now()) {
  const byDate = new Map([...kept, ...fresh].map((d) => [d.date, d]));
  const from = isoDay(new Date(now - 370 * DAY));
  return [...byDate.values()].filter((d) => d.date >= from).toSorted((a, b) => a.date.localeCompare(b.date));
}

export function weeksOf(days) {
  return days.reduce((weeks, d, i) => (i === 0 || d.weekday === 0
    ? [...weeks, { contributionDays: [d] }]
    : [...weeks.slice(0, -1), { contributionDays: [...weeks.at(-1).contributionDays, d] }]), []);
}

export function periodQuery(cur, prev, now, since = null) {
  const end = (r) => Math.max(r.start, Math.min(r.end, now) - 1000);
  const range = (r) => `from:"${iso(r.start)}",to:"${iso(end(r))}"`;
  const totals = "totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions restrictedContributionsCount";
  return `query{viewer{login name createdAt
cal:contributionsCollection(from:"${iso(since ? Math.max(now - 364 * DAY, fromIsoDay(since) - DAY) : now - 364 * DAY)}",to:"${iso(now)}"){contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel weekday}}}}
cur:contributionsCollection(${range(cur)}){${totals}}
prev:contributionsCollection(${range(prev)}){${totals}}}
ever:search(query:"is:pr author:@me is:merged",type:ISSUE,first:0){issueCount}}`;
}

export function rhythmNote(hours) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return "";
  const peak = hours.indexOf(Math.max(...hours));
  const late = hours.slice(21).reduce((a, b) => a + b, 0) + hours.slice(0, 5).reduce((a, b) => a + b, 0);
  return [`most at ${String(peak).padStart(2, "0")}:00`, late ? `${Math.round((late / total) * 100)}% after 9 pm` : ""].filter(Boolean).join(" · ");
}

export class Shipped {
  saveState() { return shippedMemory({ kind: this.kind, offset: this.offset }); }

  restoreState(state) {
    const next = shippedMemory(state);
    if (!next) return false;
    this.keptKind = next.kind; this.keptOffset = next.offset;
    return true;
  }

  init(cx) {
    this.kind = this.keptKind ?? "week"; this.offset = this.keptOffset ?? 0;
    this.github = {}; this.verified = null;
    this.prs = null; this.syncing = false; this.syncError = null; this.phase = null;
    this.store = new Store(cx.timer);
    this.records = {}; this.fresh = new Set();
    this.loading = false; this.pending = false; this.reposOpen = false; this.width = 368;
    this.share = new Share("kanso-panel");
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx, true));
  }

  key() { return `${this.kind}:${periodRange(this.kind, this.offset).start}`; }

  pick(kind, offset, cx) {
    this.kind = kind; this.offset = Math.min(0, offset);
    this.refresh(cx);
    this.startSync(cx);
  }

  refresh(cx, again = false) {
    if (this.loading) { this.pending = this.pending || again || "missing"; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const key = this.key(), now = Date.now();
        const { cur, prev } = this.ranges(now);
        this.storeError = null;
        await this.opened().catch((e) => { this.storeError = String(e?.message ?? e); throw e; });
        const signed = await signedIn();
        if (signed && this.login && signed !== this.login) { this.github = {}; this.prs = null; this.covered = null; this.login = null; this.verified = null; }
        const kept = this.github[key] && !again ? null : await this.store.period(key).catch(() => null);
        const ours = kept && (!signed || kept.data.viewer.login === signed) && (!this.verified || kept.data.viewer.login === this.verified);
        if (ours && !again && now - kept.at < REFRESH_MS) {
          this.take(key, kept.data, kept.at);
          if (!this.verified) {
            cx.notify();
            this.verified = await apiLogin();
            if (this.verified && this.verified !== this.login) { this.github = {}; this.prs = null; this.covered = null; this.login = null; this.pending = true; }
          }
        } else if (again || !this.github[key]) {
          try {
            const stored = await this.store.meta("github.login").catch(() => null);
            const calendar = signed && stored && signed !== stored ? null : await this.store.calendar().catch(() => null);
            const since = calendar?.days?.at(-1)?.date ?? null;
            const first = await gql(periodQuery(cur, prev, now, since));
            const data = since && first.viewer.login !== stored ? await gql(periodQuery(cur, prev, now)) : first;
            this.verified = data.viewer.login;
            await this.store.forAccount("github", data.viewer.login).catch(() => {});
            const days = mergeDays(stored === data.viewer.login ? calendar?.days ?? [] : [], data.viewer.cal.contributionCalendar.weeks.flatMap((w) => w.contributionDays), now);
            await this.store.setCalendar(days, now).catch(() => {});
            const whole = { ...data, viewer: { ...data.viewer, cal: { contributionCalendar: { weeks: weeksOf(days) } } } };
            await this.store.setPeriod(key, whole, now).catch(() => {});
            this.take(key, whole, now);
          } catch (e) {
            const why = String(e?.message ?? e);
            if (ours) this.take(key, kept.data, kept.at, why);
            else this.github = { ...this.github, [key]: { error: why.includes("ENOENT") ? said("Install the GitHub CLI (gh) and run `gh auth login`.") : said("Can't read GitHub", why) } };
          }
        }
        this.checkRecords();
      } catch {}
      finally {
        this.loading = false;
        cx.notify();
        if (again || !this.prs) this.startSync(cx, again === true);
        const next = this.pending; this.pending = false;
        if (next) this.refresh(cx, next === true);
      }
    });
  }

  opened() { return (this.opening ??= this.store.open().catch((e) => { this.opening = null; throw e; })); }

  take(key, data, at = Date.now(), failed = null) {
    this.readAt = at; this.updateFailed = failed;
    if (data.viewer.login !== this.login) { this.github = {}; this.prs = null; this.covered = null; this.fresh = new Set(); this.records = shared(`${RECORDS}:${data.viewer.login}`) ?? {}; }
    this.github = { ...this.github, [key]: data };
    this.login = data.viewer.login; this.name = data.viewer.name;
    this.weeks = data.viewer.cal.contributionCalendar.weeks;
    this.days = this.weeks.flatMap((w) => w.contributionDays);
  }

  startSync(cx, force = false) {
    if (!this.login) return;
    if (this.syncing) { this.resync = true; this.forced = this.forced || force; return; }
    const forced = force || this.forced;
    this.forced = false;
    this.syncing = true; this.resync = false; this.syncError = null;
    const login = this.login;
    this.syncConfirmed = null;
    const verify = async () => {
      if (this.syncConfirmed === login) return;
      const who = await apiLogin();
      if (!who) throw new Error("GitHub could not be read.");
      this.verified = who;
      if (who !== login) throw new AccountChanged(who);
      this.syncConfirmed = who;
    };
    spawnAndNotify(cx, async (cx) => {
      try {
        await this.opened();
        await mapSeries(PROVIDERS, (provider) => this.store.forAccount(provider.provider, this.login));
        if (login !== this.login) return;
        this.prs = await this.store.prs();
        this.covered = await this.coverage();
        this.firstRead = !this.prs.length;
        cx.notify();
        const now = Date.now(), from = periodRange(this.kind, this.offset - TREND + 1, now).start;
        const read = await mapSeries(PROVIDERS, (provider) => provider.sync(this.store, { from, now, login, verify, force: forced, every: REFRESH_MS, progress: (phase) => { this.phase = `${provider.name}, ${phase}`; cx.notify(); } }));
        this.unchecked = read.reduce((n, r) => n + (r?.unchecked ?? 0), 0);
      } catch (e) {
        if (e instanceof AccountChanged && login === this.login) { this.github = {}; this.prs = null; this.covered = null; this.login = null; this.switched = true; }
        else this.syncError = String(e?.message ?? e);
      }
      finally {
        this.syncing = false; this.phase = null; this.firstRead = false;
        if (login === this.login) {
          try { this.prs = await this.store.prs(); this.covered = await this.coverage(); } catch {}
          this.checkRecords();
        } else { this.prs = null; this.covered = null; this.resync = true; }
        cx.notify();
        if (this.switched) { this.switched = false; this.refresh(cx, true); }
        else if (this.resync) this.startSync(cx);
      }
    });
  }

  async coverage() { return Object.fromEntries(await mapSeries(PROVIDERS, async (p) => [p.provider, await this.store.readMonths(p.provider)])); }

  covers(now = Date.now()) {
    const from = periodRange(this.kind, this.offset - TREND + 1, now).start, end = Math.min(periodRange(this.kind, this.offset, now).end, now + 1);
    return PROVIDERS.every((p) => monthsIn(from, end).every((m) => this.covered?.[p.provider]?.has(m.month)));
  }

  derived() {
    const at = new Date();
    const key = `${this.key()}:${this.login}:${isoDay(at)}T${at.getHours()}`;
    if (this.cached?.prs === this.prs && this.cached.key === key) return this.cached.value;
    const now = Date.now(), cur = periodRange(this.kind, this.offset, now), prev = periodRange(this.kind, this.offset - 1, now);
    const value = {
      mine: cohortOf(this.prs, cur.start, cur.end, this.login),
      before: cohortOf(this.prs, prev.start, prev.end, this.login),
      trend: trendOf(this.prs, this.kind, this.offset, this.login, now),
      hours: mergeHours(this.prs, cur.start, cur.end),
      bars: mergedBars(this.prs, this.kind, this.offset, now),
    };
    this.cached = { prs: this.prs, key, value };
    return value;
  }

  recordsKey() { return `${RECORDS}:${this.login ?? ""}`; }

  checkRecords() {
    if (!this.days) return;
    const whole = this.prs && !this.syncing ? this.prs : null;
    const { kept, beaten } = mergeRecords(shared(this.recordsKey()), computeRecords({ days: this.days, prs: whole, login: this.login }));
    this.records = kept;
    setShared(this.recordsKey(), kept);
    this.fresh = new Set([...this.fresh, ...beaten]);
    for (const k of beaten) {
      const t = recordText(k, kept[k]);
      notify({ title: `New record: ${RECORD_NAMES[k].toLowerCase()}`, body: `${t.value} ${t.unit} · ${t.detail}`, level: "success" });
    }
  }

  cardData() {
    const { current, longest } = streaks(this.days, isoDay(new Date()));
    const records = Object.keys(RECORD_NAMES).filter((k) => this.records[k]).map((k) => ({ name: RECORD_NAMES[k], ...recordText(k, this.records[k]) }));
    const hours = this.hours();
    return { streak: current, longest: longest.n, weeks: this.weeks ?? [], records, rhythm: hours ? { hours, note: rhythmNote(hours) } : null };
  }

  shareCard() {
    const s = this.summary(), extra = this.cardData();
    return { spec: shippedSpec(s, extra), text: shareText(s, extra), name: `shipped-${s.period}`, title: "Shipped" };
  }

  periods(c) {
    const items = PERIODS.map((kind) => ({ key: kind, label: PERIOD_NAMES[kind] }));
    return h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
      .child(segmented("shipped", items, this.kind, (kind, cx) => this.pick(kind, 0, cx), c))
      .child(h_flex().gap(G.xs).items_center()
        .child(iconButton("shipped-prev", "chevron-left", "Previous period", (cx) => this.pick(this.kind, this.offset - 1, cx), c))
        .child(div().min_w(96).text_center().text_size(T.value).text_color(c.text).child(periodLabel(this.kind, this.offset)))
        .child(iconButton("shipped-next", "chevron-right", "Next period", (cx) => this.pick(this.kind, this.offset + 1, cx), c, { disabled: this.offset >= 0 })));
  }

  ranges(now) { return { cur: periodRange(this.kind, this.offset, now), prev: periodRange(this.kind, this.offset - 1, now) }; }

  summary() {
    const now = Date.now();
    const { cur, prev } = this.ranges(now);
    const gh = this.github[this.key()], v = gh?.viewer;
    const settled = this.covers(now);
    const mine = this.prs && settled ? this.derived().mine : null;
    const before = this.prs && settled ? this.derived().before : null;
    const contributions = v ? contributionsIn(this.days, cur.start, cur.end, v.cur) : null;
    const delta = settled && mine?.rate !== null && mine?.rate !== undefined && before?.rate !== null && before?.rate !== undefined ? Math.round((mine.rate - before.rate) * 100) : null;
    const deltaText = delta === null ? "" : `${delta >= 0 ? "+" : ""}${delta} pts ${comparedLabel(this.kind, this.offset)}`;
    const stats = [
      { value: mine ? fmt(mine.opened) : "—", unit: "opened" },
      { value: mine ? fmt(mine.merged) : "—", unit: "merged" },
      { value: mine?.toMerge !== null && mine?.toMerge !== undefined ? span(mine.toMerge) : "—", unit: "to merge" },
      { value: mine ? fmt(mine.dropped) : "—", unit: "closed" },
      { value: v ? fmt(v.cur.totalPullRequestReviewContributions) : "—", unit: "reviews" },
      { value: mine ? fmt(mine.elsewhere) : "—", unit: "in others' repos" },
      { value: contributions === null ? "—" : fmt(contributions), unit: "contributions" },
    ];
    const everText = gh?.ever ? `${fmt(gh.ever.issueCount)} merged${v?.createdAt ? ` since ${new Date(v.createdAt).getFullYear()}` : ""}` : "";
    return {
      login: v?.login ?? this.login ?? null, period: periodLabel(this.kind, this.offset), settled,
      big: mine ? (mine.rate === null ? "—" : pct(mine.rate)) : null,
      small: "",
      label: mine ? `in production · ${fmt(mine.prod)} of ${fmt(mine.opened)}` : "in production",
      prod: mine?.prod ?? null, opened: mine?.opened ?? null,
      delta, deltaText, stats, everText, error: gh?.error ?? null,
    };
  }

  hero(c) {
    const s = this.summary();
    return v_flex().w_full().gap(G.lg)
      .child(v_flex().w_full().gap(G.xs)
        .child(metric({ value: s.big ?? "…", unit: s.label, facts: factList(s.stats) })("sh-metric", c))
        .when(s.delta !== null, (el) => el.child(h_flex().gap(6).items_center()
          .child(dot(c, s.delta >= 0 ? c.green : c.red))
          .child(div().text_size(T.value).text_color(s.delta >= 0 ? c.green : c.red).child(s.deltaText)))))
      .when(Boolean(s.everText), (el) => el.child(div().text_size(T.body).text_color(c.muted).child(s.everText)))
      .when(Boolean(s.error), (el) => el.child(failureBlock(s.error)("sh-error", c)));
  }

  rateRow(id, name, detail, rate, c, first) {
    return v_flex().w_full().py(G.sm).gap(G.xs)
      .when(!first, (el) => el.border_t_1().border_color(c.border))
      .child(h_flex().w_full().flex_wrap().gap_x(G.md).gap_y(G.hair).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.text).child(name))
        .child(div().flex_none().text_size(T.body).text_color(c.dim).child(detail)))
      .child(h_flex().id(id).w_full().h(G.xs).rounded(G.hair).bg(c.subtle)
        .child(div().h_full().rounded(G.hair).bg(c.accent).w(`${(rate ? Math.max(0.02, rate) * 100 : 0).toFixed(1)}%`)));
  }

  trend(c) {
    if (!this.prs) return null;
    const list = this.derived().trend;
    if (!list.some((p) => p.opened)) return null;
    return v_flex().w_full()
      .child(section(c, "Trend", ""))
      .children(list.toReversed().map((p, i) => this.rateRow(`trend-${i}`, p.label, p.opened ? `${pct(p.rate)} · ${fmt(p.prod)}/${fmt(p.opened)}` : "—", p.rate, c, i === 0)));
  }

  recordsList(c) {
    const keys = Object.keys(RECORD_NAMES).filter((k) => this.records[k]);
    if (!keys.length) return null;
    return v_flex().w_full()
      .child(section(c, "Records", this.fresh.size ? `${this.fresh.size} new` : "your bests"))
      .children(keys.map((k, i) => {
        const r = this.records[k], t = recordText(k, r), fresh = this.fresh.has(k);
        return h_flex().id(`record-${k}`).w_full().py(10).gap(G.md).items_center()
          .when(i > 0, (el) => el.border_t_1().border_color(c.border))
          .child(v_flex().flex_1().min_w(0).gap(G.hair)
            .child(h_flex().gap(G.sm).items_center()
              .child(div().truncate().text_size(T.card).text_color(c.text).child(RECORD_NAMES[k]))
              .when(fresh, (el) => el.child(div().flex_none().px(6).py(1).rounded(R.control).bg(alpha(c.accent, TINT.soft)).text_size(T.micro).text_color(c.accent).child("New record"))))
            .child(div().truncate().text_size(T.body).text_color(c.dim).child(t.detail)))
          .child(h_flex().flex_none().items_end().gap(6)
            .child(div().text_size(T.page).line_height(1).font_light().text_color(fresh ? c.accent : c.text).child(t.value))
            .child(div().text_size(T.micro).text_color(c.dim).child(t.unit)));
      }));
  }

  byRepo(c) {
    const repos = this.prs ? this.derived().mine.repos : [];
    if (!repos.length) return v_flex().w_full().child(section(c, "By repository", "")).child(div().text_size(T.body).text_color(c.dim).child(this.syncing ? "Reading…" : "No pull requests opened in this period."));
    const rows = this.reposOpen ? repos : repos.slice(0, REPO_ROWS);
    return v_flex().w_full()
      .child(section(c, "By repository", fmt(repos.length)))
      .children(rows.map((x, i) => this.rateRow(`repo-${i}`, x.repo, `${fmt(x.prod)} of ${fmt(x.opened)} in production`, x.opened ? x.prod / x.opened : 0, c, i === 0)))
      .when(repos.length > REPO_ROWS, (el) => el.child(h_flex().pt(G.sm).child(quietLink("shipped-repos-more", this.reposOpen ? "Show fewer" : `Show ${repos.length - REPO_ROWS} more`,
        (cx) => { this.reposOpen = !this.reposOpen; cx.notify(); }, c))));
  }

  status(c) {
    if (this.storeError) return failureBlock({ text: "Shipped can't keep its data", source: this.storeError, fix: "Retry" })("sh-store", c, { onClick: (cx) => this.refresh(cx, true) });
    if (this.updateFailed) return div().text_size(T.body).text_color(c.dim).child(`Couldn't update · showing ${clock(this.readAt)}`);
    if (this.syncError) return failureBlock({ text: "Reading stopped", source: this.syncError })("sh-sync", c);
    if (!this.syncing && this.unchecked) return div().text_size(T.body).text_color(c.dim).child(`${fmt(this.unchecked)} not checked for production yet`);
    if (!this.syncing || !this.firstRead) return null;
    return div().text_size(T.body).text_color(c.dim).child("Reading GitHub…");
  }

  hours() {
    if (!this.prs) return null;
    const hours = this.derived().hours;
    return hours.some(Boolean) ? hours : null;
  }

  chart(c) {
    if (!this.prs || !this.covers()) return null;
    const { bars, first, last } = this.derived().bars;
    return barChart(c, { columns: bars.map((bar) => chartBar(c, bar)), room: chartRoom(CHART.h), axis: [first, "Merged", last] });
  }

  rhythmView(c) {
    const hours = this.hours();
    if (!hours) return null;
    const top = Math.max(...hours), peak = hours.indexOf(top);
    const hour = (h) => `${String(h).padStart(2, "0")}:00`;
    const bars = hours.map((n, h) => ({ ratio: n / top, mark: h === peak, value: fmt(n), tip: `${fmt(n)} merged at ${hour(h)}` }));
    return v_flex().w_full().gap(G.md)
      .child(section(c, "When you merge", rhythmNote(hours)))
      .child(barChart(c, { columns: bars.map((bar) => chartBar(c, bar, CHART.small)), room: chartRoom(CHART.small), axis: ["00:00", "12:00", "23:00"] }));
  }

  skeleton(c) { return skeletonOf({ shape: "metric" })("kanso-skeleton", c); }

  render(cx) {
    const c = tokens(theme());
    const width = this.width || 368, narrow = width < 560;
    const pad = narrow ? G.lg : 32;
    const inner = Math.min(1080, width - 2 * pad);
    const gh = this.github[this.key()], status = this.status(c), chart = this.chart(c), trend = this.trend(c), rhythm = this.rhythmView(c);
    const body = this.storeError ? status : !gh && !this.prs
      ? this.skeleton(c)
      : v_flex().w_full().gap(narrow ? 36 : 48)
        .child(this.hero(c))
        .when(Boolean(status), (el) => el.child(status))
        .when(Boolean(chart), (el) => el.child(chart))
        .when(Boolean(trend), (el) => el.child(trend))
        .when(Boolean(this.days), (el) => el.child(this.streak(c, inner)))
        .when(Object.keys(this.records).length > 0, (el) => el.child(this.recordsList(c)))
        .when(Boolean(rhythm), (el) => el.child(rhythm))
        .child(this.byRepo(c));
    return sizedPage.call(this, v_flex().id("kanso-shipped").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar(), narrow, (column) => column
          .child(h_flex().w_full().items_center().justify_between().gap(G.md)
            .child(div().truncate().text_size(narrow ? 17 : 20).text_color(c.text).child("Shipped"))
            .child(h_flex().gap(G.xs).items_center()
              .child(iconButton("shipped-share", "share", "Share", (cx) => this.share.toggle(cx), c, { disabled: !this.days }))
              .child(iconButton("shipped-refresh", "refresh-cw", "Refresh", (cx) => this.refresh(cx, true), c, { spin: this.loading || this.syncing }))))
          .children(shareRows(this, c, "Only the totals, streak, records and hours: no repository names. The post opens with the image in it."))
          .child(this.periods(c))
          .child(body));
  }

  streak(c, width) {
    const { current, longest } = streaks(this.days, isoDay(new Date()));
    const level = { NONE: null, FIRST_QUARTILE: "40", SECOND_QUARTILE: "70", THIRD_QUARTILE: "b0", FOURTH_QUARTILE: "ff" };
    const { weeks: n, cell } = heatLayout(width);
    const weeks = (this.weeks ?? []).slice(-n);
    const radius = Math.max(2, Math.round(cell / 5));
    const square = (d, key) => {
      if (!d) return div().id(key).size(cell).flex_none(); // before the calendar, or still to come
      const a = level[d.contributionLevel];
      return div().id(key).size(cell).flex_none().rounded(radius).bg(a ? c.accent + a : c.subtle)
        .tooltip(tooltip({ label: `${fmt(d.contributionCount)} ${d.contributionCount === 1 ? "contribution" : "contributions"} on ${dayName(fromIsoDay(d.date))}` }));
    };
    return v_flex().w_full().gap(G.md)
      .child(section(c, "Streak", `longest ${fmt(longest.n)} ${longest.n === 1 ? "day" : "days"}`))
      .child(metric({ value: fmt(current), unit: current === 1 ? "day in a row" : "days in a row" })("sh-streak", c))
      .child(h_flex().w_full().gap(HEATMAP_GAP).children(weeks.map((w, wi) => {
        const byDay = new Map(w.contributionDays.map((d) => [d.weekday, d]));
        return v_flex().flex_none().gap(HEATMAP_GAP).children([0, 1, 2, 3, 4, 5, 6].map((i) => square(byDay.get(i), `heat-${wi}-${i}`)));
      })));
  }

}
