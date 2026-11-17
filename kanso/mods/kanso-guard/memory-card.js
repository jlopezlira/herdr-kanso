// Memory's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Only counts and sizes are shared: never an agent's name, folder or session.
import { postText } from "./share.js";
import { size, span } from "./model.js";
import { num, dayWord } from "./pure.js";

const longSpan = (min) => {
  const n = num(min) ?? 0;
  if (n >= 2 * 1440) { const d = Math.floor(n / 1440); return { big: String(d), small: "days" }; }
  if (n >= 120) return { big: String(Math.floor(n / 60)), small: "hours" };
  return { big: String(Math.max(1, Math.round(n))), small: "min" };
};

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

// The card's two reads of the same numbers: the windows, and the longest one in a person's words.
const winsLong = (data, digest) => {
  const w = memoryWins(data, digest);
  return { w, long: longSpan(w.longestMin) };
};

export function memorySpec(data, digest) {
  const { w, long } = winsLong(data, digest);
  const on = w.totalMB ? ` on ${size(w.totalMB)}` : "";
  const stats = [
    { value: String(w.agents), unit: w.agents === 1 ? "agent open" : "agents open" },
    w.recycles ? { value: String(w.recycles), unit: w.recycles === 1 ? "recycle" : "recycles" } : null,
    w.closed ? { value: String(w.closed), unit: w.closed === 1 ? "closed" : "closed" } : null,
    w.freedMB ? { value: size(w.freedMB), unit: "given back" } : null,
    w.windowMB !== null ? { value: size(w.windowMB), unit: data?.metric === "working set" ? "window working set" : "Herdr window" } : null,
    { value: String(w.restarts), unit: w.restarts === 1 ? "window restart" : "window restarts" },
  ].filter(Boolean).slice(0, 6);
  const week = digest?.series?.week;
  const sinceWord = w.since ? `since ${dayWord(new Date(w.since))}` : "";
  return {
    title: "Memory",
    right: sinceWord,
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

export function memoryText(data, digest) {
  const { w, long } = winsLong(data, digest);
  const parts = [
    `${w.agents} coding ${w.agents === 1 ? "agent" : "agents"} open${w.totalMB ? ` on a ${size(w.totalMB)} computer` : ""}, the oldest for ${long.big} ${long.small}`,
    ...(w.recycles ? [`${w.recycles} ${w.recycles === 1 ? "recycle" : "recycles"} gave back ${size(w.recycledMB)} without losing a conversation`] : []),
  ];
  return postText(parts, "Weeks-long agent sessions, memory in check.");
}
