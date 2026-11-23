import { listKey, moveTo } from "./listkeys.js";

const UNREAD = "Spend could not read your sessions.";
const STALE = "Last update failed";

export function readPlan({ nodeBinary = null, runtimeError = null, error = null, running = null }, loaded) {
  const refresh = { enabled: Boolean(nodeBinary || runtimeError) && !running, busy: Boolean(running) };
  if (!nodeBinary && runtimeError) return { failure: { text: UNREAD, source: runtimeError, fix: "Retry" }, refresh };
  if (!error || running) return { failure: null, refresh };
  return { failure: { text: loaded ? STALE : UNREAD, source: error, fix: "Refresh" }, refresh };
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
