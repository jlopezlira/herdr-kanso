// Agents by keyboard: the sidebar's agent above or below, and back and forward through the agents you visited.
export const KEPT = 50;
export const NO_VISITS = Object.freeze({ list: [], at: -1, seen: null });

// Held by the module, not the view, so a sidebar mounted again keeps its history.
export class Visits {
  static now = NO_VISITS;
  static keep(visits) { this.now = visits; return visits; }
}

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

export function beside(order, here, by) {
  const at = order.indexOf(here);
  return order[at < 0 ? (by > 0 ? 0 : order.length - 1) : at + by] ?? null;
}
