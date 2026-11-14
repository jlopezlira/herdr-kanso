// Agents by keyboard: the sidebar's agent row above or below, and back and forward through the agents you visited.
export const KEPT = 50;
export const NO_VISITS = Object.freeze({ list: [], at: -1, seen: null });

// A change of focus is a visit; landing where back or forward pointed adds nothing.
export function visited(visits, address) {
  if (!address || address === visits.seen) return visits;
  if (address === visits.list[visits.at]) return { ...visits, seen: address };
  const list = [...visits.list.slice(0, visits.at + 1), address].slice(-KEPT);
  return { list, at: list.length - 1, seen: address };
}

export function stepped(visits, by, can = () => true) {
  const ahead = visits.list.map((address, at) => ({ address, at }))
    .filter(({ at }) => (by < 0 ? at < visits.at : at > visits.at));
  const hit = (by < 0 ? ahead.toReversed() : ahead).find(({ address }) => address !== visits.seen && can(address));
  return hit ? { visits: { ...visits, at: hit.at }, to: hit.address } : null;
}

export function besideRow(nav, by) {
  const rows = nav.filter((n) => String(n.key).startsWith("agent:"));
  const here = rows.findIndex((n) => n.here);
  return rows[here < 0 ? (by > 0 ? 0 : rows.length - 1) : here + by] ?? null;
}
