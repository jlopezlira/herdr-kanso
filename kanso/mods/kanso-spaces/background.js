// Sleeping projects and unavailable machines do not start background reads.
import { keyOfSpace } from "./projects.js";
import { conversationOf } from "./kdb.js";

export function pollable(address, sleeps, layouts, thread = null) {
  const machine = String(address).includes("/") ? String(address).split("/")[0] : null;
  if (layouts.some((m) => (m.name ?? null) === machine && m.layout !== "ready")) return false;
  const conversation = conversationOf(thread?.file);
  return !sleeps.some((s) => s.state !== "undoing" && (s.agents ?? []).some((a) => a.terminal === address || conversation && a.resume === conversation));
}

export function activePlaces(spaces, panes, sleeps, layouts, here) {
  return new Set(spaces.filter((s) => {
    if (layouts.some((m) => (m.name ?? null) === (s.machine ?? null) && m.layout !== "ready")) return false;
    const asleep = sleeps.filter((row) => row.from === keyOfSpace(s, here) && row.state !== "undoing");
    if (!asleep.length) return true;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    return panes.some((p) => tabs.has(p.tab) && p.terminal && pollable(p.terminal, asleep, layouts));
  }).map((s) => s.id));
}
