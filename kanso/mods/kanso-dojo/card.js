// hjkl dōjō's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What training in the dōjō is worth showing: the best round, the rings reached,
// how many in the fewest moves, the days practiced in a row and on a
// calendar, the best of each level. Only your own numbers.
import { postText } from "./share.js";
import { LEVELS } from "./dojo.js";
import { range } from "./pure.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Days practiced in a row, up to today (or yesterday: today may still come).
export function dayStreak(days, now = Date.now()) {
  const set = new Set(days);
  const from = set.has(ymd(new Date(now))) ? now : now - DAY;
  // One day back at a time. A day longer than 24 h (the clocks going back)
  // can be met twice, so the run is never longer than twice the days kept.
  return range(2 * set.size + 1).findIndex((k) => !set.has(ymd(new Date(from - k * DAY))));
}

// The days practiced as GitHub's calendar: weeks (Sunday first) up to this
// one, a played day lit.
export function calendar(days, now = Date.now(), weeks = 53) {
  const set = new Set(days);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weeks - 1) * 7);
  // A week stops at today; the days after it are not drawn.
  return range(weeks).map((w) => ({
    contributionDays: range(7).map((k) => [k, new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + k)])
      .filter(([, d]) => !(d > today))
      .map(([k, d]) => ({ weekday: k, contributionLevel: set.has(ymd(d)) ? "FOURTH_QUARTILE" : "NONE" })),
  }));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The card and the post from the store's totals: { spec, text }. */
export function dojoShare(totals, now = Date.now()) {
  const best = Object.entries(totals.bests ?? {}).reduce((m, [lv, s]) => (s > m.score ? { level: Number(lv), score: s } : m), { level: null, score: 0 });
  const lv = LEVELS.find((L) => L.n === best.level);
  const streak = dayStreak(totals.days ?? [], now);
  const pct = totals.rings ? Math.round((100 * totals.fewest) / totals.rings) : 0;
  const since = totals.first ? new Date(totals.first) : null;
  const spec = {
    title: "hjkl dōjō",
    right: since ? `since ${MONTHS[since.getMonth()]} ${since.getDate()}` : "",
    hero: {
      big: String(best.score), small: "points",
      label: lv ? `my best round of vim, ten targets, level ${lv.n}: ${lv.name}` : "my best round of vim, ten targets",
      delta: totals.longest ? { up: true, text: `${totals.longest} targets in a row in the fewest moves` } : null,
    },
    stats: [
      { value: String(totals.rings ?? 0), unit: "targets reached" },
      { value: `${pct}%`, unit: "in the fewest moves" },
      { value: String(totals.rounds ?? 0), unit: totals.rounds === 1 ? "round" : "rounds" },
      { value: String((totals.days ?? []).length), unit: (totals.days ?? []).length === 1 ? "day practiced" : "days practiced" },
    ],
    note: "",
    blocks: [
      { kind: "streak", title: "Practice", right: "h j k l, every day", n: String(streak), unit: streak === 1 ? "day in a row" : "days in a row", weeks: calendar(totals.days ?? [], now) },
      { kind: "list", title: "Levels", rows: LEVELS.filter((L) => totals.bests?.[L.n] != null).map((L) => ({ name: `${L.n}. ${L.name}`, detail: "best round", value: String(totals.bests[L.n]), unit: "points" })) },
    ],
  };
  const parts = [
    `${best.score} points in my best round of vim, in the hjkl dōjō`,
    totals.rings ? `${plural(totals.rings, "target", "targets")}, ${pct}% in the fewest moves` : null,
    streak > 1 ? `${streak} days in a row` : null,
  ].filter(Boolean);
  return { spec, text: postText(parts, "training vim in the hjkl dōjō") };
}
