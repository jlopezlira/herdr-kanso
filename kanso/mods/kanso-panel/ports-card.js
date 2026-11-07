// Ports' share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { postText } from "./share.js";
import { size, portStats, activeSeries } from "./ports-model.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function portsSpec(data, now = Date.now()) {
  const s = portStats(data, now);
  const brag = s.stoppedLoose > 0;
  const week = activeSeries(data, "week", now);
  const stats = [
    { value: String(s.running), unit: "running now" },
    { value: String(s.weekPeak), unit: "at once at the peak" },
    brag ? { value: String(s.openedWeek), unit: "opened this week" } : null,
    { value: String(brag ? s.leftBehind : s.leftWeek), unit: "left with no pane" },
    !brag && s.freedMB ? { value: size(s.freedMB), unit: "given back" } : null,
  ].filter(Boolean);
  return {
    title: "Ports",
    right: brag ? "last 30 days" : "last 7 days",
    hero: brag
      ? { big: String(s.stoppedLoose), small: s.stoppedLoose === 1 ? "server" : "servers", label: "left running by agents after their panes closed, found and stopped",
          delta: s.stoppedLooseMB ? { up: true, text: `${size(s.stoppedLooseMB)} of memory given back` } : null }
      : { big: String(s.openedWeek), small: s.openedWeek === 1 ? "dev server" : "dev servers", label: "opened in the last 7 days", delta: null },
    stats,
    note: "",
    // The week's chart once it holds two days or more (24 two-hour buckets).
    blocks: !week.empty && week.filled >= 24 ? [{
      kind: "bars", title: "Dev servers running, last 7 days", right: `peak ${week.peak}`,
      values: week.bars.map((b) => b.active), ticks: [week.first, week.last],
    }] : [],
  };
}

export function portsText(data, now = Date.now()) {
  const s = portStats(data, now);
  const parts = [
    ...(s.stoppedLoose ? [`${plural(s.stoppedLoose, "dev server", "dev servers")} my agents left running, found and stopped${s.stoppedLooseMB ? `: ${size(s.stoppedLooseMB)} back` : ""}`] : []),
    ...(s.openedWeek ? [`${plural(s.openedWeek, "dev server", "dev servers")} opened this week, ${s.weekPeak} at once at the peak`] : []),
    !s.running ? "none running now" : `${s.running} running now${s.loose ? `, ${s.loose} with no pane` : ", every one in a pane"}`,
  ];
  return postText(parts, "Every dev server accounted for.");
}
