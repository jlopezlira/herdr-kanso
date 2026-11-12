// Sleeping projects and unavailable machines do not start background reads.
// `dozing`: the terminals asleep, and every terminal of a tab that sleeps (roster.js sleepingNow).
export function pollable(address, dozing, layouts) {
  const machine = String(address).includes("/") ? String(address).split("/")[0] : null;
  if (layouts.some((m) => (m.name ?? null) === machine && m.layout !== "ready")) return false;
  return !dozing.has(address);
}

export function activePlaces(spaces, panes, dozing, layouts) {
  return new Set(spaces.filter((s) => {
    if (layouts.some((m) => (m.name ?? null) === (s.machine ?? null) && m.layout !== "ready")) return false;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const mine = panes.filter((p) => tabs.has(p.tab) && p.terminal);
    return !mine.length || mine.some((p) => !dozing.has(p.terminal));
  }).map((s) => s.id));
}
