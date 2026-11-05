// Memory's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What the guard lets you brag about: how long your agents have been open,
// how many at once, on how much memory, and what recycling gave back, with
// free memory over the last week. Never an agent's name, folder or session:
// only counts and sizes are shared.
import { postText } from "./share.js";
import { size, span } from "./model.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longSpan = (min) => {
  const n = num(min) ?? 0;
  if (n >= 2 * 1440) { const d = Math.floor(n / 1440); return { big: String(d), small: "days" }; }
  if (n >= 120) return { big: String(Math.floor(n / 60)), small: "hours" };
  return { big: String(Math.max(1, Math.round(n))), small: "min" };
};

/** The numbers the card and the post share, from now.json's data and the history digest. */
export function memoryWins(data, digest) {
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  const longest = agents.reduce((m, a) => Math.max(m, num(a.ageMin) ?? 0), 0);
  const t = digest?.totals ?? {};
  return {
    agents: agents.length,
    longestMin: longest,
    totalMB: num(data?.machine?.totalMB),
    freePct: num(data?.machine?.freePct),
    windowMB: num(data?.window?.mb),
    recycles: num(t.recycles) ?? 0,
    restarts: num(t.restarts) ?? 0,
    freedMB: num(t.freedMB) ?? 0,
    recycledMB: num(t.recycledMB) ?? 0,
    closed: num(t.closed) ?? 0,
    since: num(t.since),
  };
}

/** The card spec for share.js. */
export function memorySpec(data, digest) {
  const w = memoryWins(data, digest);
  const long = longSpan(w.longestMin);
  const on = w.totalMB ? ` on ${size(w.totalMB)}` : "";
  const stats = [
    { value: String(w.agents), unit: w.agents === 1 ? "agent open" : "agents open" },
    w.recycles ? { value: String(w.recycles), unit: w.recycles === 1 ? "recycle" : "recycles" } : null,
    w.closed ? { value: String(w.closed), unit: w.closed === 1 ? "closed" : "closed" } : null,
    w.freedMB ? { value: size(w.freedMB), unit: "given back" } : null,
    w.windowMB !== null ? { value: size(w.windowMB), unit: "Herdr window" } : null,
    { value: String(w.restarts), unit: w.restarts === 1 ? "window restart" : "window restarts" },
  ].filter(Boolean).slice(0, 6);
  const week = digest?.series?.week;
  const since = w.since ? new Date(w.since) : null;
  return {
    title: "Memory",
    right: since ? `since ${MONTHS[since.getMonth()]} ${since.getDate()}` : "",
    hero: {
      big: long.big, small: long.small,
      label: `my longest agent session, still open, with ${w.agents} ${w.agents === 1 ? "agent" : "agents"}${on}`,
      delta: w.recycledMB ? { up: true, text: `${size(w.recycledMB)} given back by recycling, same conversations` } : null,
    },
    stats,
    note: "",
    // The week's chart once it holds two days or more; less reads as a blank.
    blocks: week && !week.empty && week.bars.filter((b) => !b.empty).length >= 24 ? [{
      kind: "bars", title: "Memory free, last 7 days", right: week.lowest ? `lowest ${week.lowest}` : "",
      values: week.bars.map((b) => (b.empty ? 0 : b.ratio)), ticks: [week.first, week.last].filter(Boolean),
    }] : [],
  };
}

/** The post's words. */
export function memoryText(data, digest) {
  const w = memoryWins(data, digest);
  const long = longSpan(w.longestMin);
  const parts = [`${w.agents} coding ${w.agents === 1 ? "agent" : "agents"} open${w.totalMB ? ` on a ${size(w.totalMB)} machine` : ""}, the oldest for ${long.big} ${long.small}`];
  if (w.recycles) parts.push(`${w.recycles} ${w.recycles === 1 ? "recycle" : "recycles"} gave back ${size(w.recycledMB)} without losing a conversation`);
  return postText(parts, "Weeks-long agent sessions, memory in check.");
}
