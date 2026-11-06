// kansō help's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What learning vim is worth showing: the best round, the rings reached,
// how many in the fewest moves, the days practiced in a row and on a
// calendar, the best of each level. Only your own numbers.
import { postText } from "./share.js";
import { LEVELS } from "./keymap.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Days practiced in a row, up to today (or yesterday: today may still come).
export function dayStreak(days, now = Date.now()) {
  const set = new Set(days);
  let d = new Date(now);
  if (!set.has(ymd(d))) d = new Date(now - DAY);
  let n = 0;
  while (set.has(ymd(d))) { n += 1; d = new Date(d.getTime() - DAY); }
  return n;
}

// The days practiced as GitHub's calendar: weeks (Sunday first) up to this
// one, a played day lit.
export function calendar(days, now = Date.now(), weeks = 53) {
  const set = new Set(days);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weeks - 1) * 7);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const contributionDays = [];
    for (let k = 0; k < 7; k++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + k);
      if (d > today) break;
      contributionDays.push({ weekday: k, contributionLevel: set.has(ymd(d)) ? "FOURTH_QUARTILE" : "NONE" });
    }
    out.push({ contributionDays });
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The card and the post from the store's totals: { spec, text }. */
export function vimShare(totals, now = Date.now()) {
  const best = Object.entries(totals.bests ?? {}).reduce((m, [lv, s]) => (s > m.score ? { level: Number(lv), score: s } : m), { level: null, score: 0 });
  const lv = LEVELS.find((L) => L.n === best.level);
  const streak = dayStreak(totals.days ?? [], now);
  const pct = totals.rings ? Math.round((100 * totals.fewest) / totals.rings) : 0;
  const since = totals.first ? new Date(totals.first) : null;
  const spec = {
    title: "Learning vim",
    right: since ? `since ${MONTHS[since.getMonth()]} ${since.getDate()}` : "",
    hero: {
      big: String(best.score), small: "points",
      label: lv ? `my best 60-second round, level ${lv.n}: ${lv.name}` : "my best 60-second round",
      delta: totals.longest ? { up: true, text: `${totals.longest} rings in a row in the fewest moves` } : null,
    },
    stats: [
      { value: String(totals.rings ?? 0), unit: "rings reached" },
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
    `learning vim: ${best.score} points in my best 60-second round`,
    totals.rings ? `${plural(totals.rings, "ring", "rings")}, ${pct}% in the fewest moves` : null,
    streak > 1 ? `${streak} days in a row` : null,
  ].filter(Boolean);
  return { spec, text: postText(parts, "learning vim with h j k l") };
}
