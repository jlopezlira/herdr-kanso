import { listKey, moveTo } from "./listkeys.js";

const UNREAD = "Spend could not read your sessions.";
const STALE = "Last update failed";

export function readFailure({ runtimeError = null, error = null, running = null }, loaded) {
  if (!loaded && runtimeError) return { text: UNREAD, source: runtimeError, retry: false };
  if (!error || running) return null;
  return { text: loaded ? STALE : UNREAD, source: error, retry: true };
}

export const allChoice = (field) => (field === "project" ? "All projects" : "All models");

export const chooserOptions = (field, facet) => [
  { value: "all", label: allChoice(field), detail: "", meta: "" },
  ...facet.map((entry) => ({ value: entry.value, label: entry.label, detail: entry.detail ?? (field === "project" ? entry.value : ""), meta: entry.meta })),
];

export function chooserKey(e, { at, gAt, count }, now) {
  const { move, gAt: pending } = listKey(e, gAt, now);
  const does = move === "escape" ? "close" : move === "enter" ? "choose" : move && move !== "pending" ? "move" : null;
  return { handled: Boolean(move), does, gAt: pending, at: does === "move" ? moveTo(move, at, count) : at };
}
