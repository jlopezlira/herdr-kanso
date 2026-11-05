// Ports' share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What the Ports panel lets you brag about: the dev servers agents left
// running after their panes closed, found and stopped, and the memory that
// gave back; and what runs now, every one accounted for. Never a port,
// folder or command: only counts and sizes.
import { postText } from "./share.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const size = (mb) => (mb < 1000 ? `${Math.max(0, Math.round(mb))} MB` : `${(mb / 1024).toFixed(1).replace(/\.0$/, "")} GB`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The tally kept across sessions: { stopped, freedMB, since }. */
export function readTally(raw) {
  try {
    const t = JSON.parse(raw ?? "null");
    if (t && typeof t === "object") return { stopped: Number(t.stopped) || 0, freedMB: Number(t.freedMB) || 0, since: Number(t.since) || null };
  } catch { /* none yet */ }
  return { stopped: 0, freedMB: 0, since: null };
}

/** The tally after `n` servers holding `mb` were stopped. */
export const addToTally = (t, n, mb, now = Date.now()) => ({ stopped: t.stopped + n, freedMB: t.freedMB + Math.max(0, mb), since: t.since ?? now });

/** The card spec: `list` is what listens now (with `owner`), `tally` what was stopped. */
export function portsSpec(list, tally) {
  const loose = list.filter((s) => !s.owner).length;
  const since = tally.since ? new Date(tally.since) : null;
  const brag = tally.stopped > 0;
  return {
    title: "Ports",
    right: since ? `since ${MONTHS[since.getMonth()]} ${since.getDate()}` : "",
    hero: brag
      ? { big: String(tally.stopped), small: tally.stopped === 1 ? "server" : "servers", label: "left running by agents after their panes closed, found and stopped",
          delta: tally.freedMB ? { up: true, text: `${size(tally.freedMB)} of memory given back` } : null }
      : { big: String(list.length), small: list.length === 1 ? "server" : "servers", label: !list.length ? "listening now" : loose ? "listening now" : "listening now, every one in a pane", delta: null },
    stats: [
      { value: String(list.length), unit: list.length === 1 ? "dev server now" : "dev servers now" },
      { value: String(list.length - loose), unit: "in a pane" },
      { value: String(loose), unit: "left behind" },
    ],
    note: "",
    blocks: [],
  };
}

/** The post's words. */
export function portsText(list, tally) {
  const parts = [];
  if (tally.stopped) parts.push(`${plural(tally.stopped, "dev server", "dev servers")} my agents left running, found and stopped${tally.freedMB ? `: ${size(tally.freedMB)} back` : ""}`);
  const loose = list.filter((s) => !s.owner).length;
  parts.push(!list.length ? "no dev server running now" : `${plural(list.length, "server", "servers")} running now${loose ? `, ${loose} with no pane` : ", every one in a pane"}`);
  return postText(parts, "Every dev server accounted for.");
}
