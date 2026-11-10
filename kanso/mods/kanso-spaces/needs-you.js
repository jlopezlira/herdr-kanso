export const NEEDS_YOU = "kanso.needs-you";

const rank = (row) => row.status === "blocked" ? 0 : 1;
const order = (a, b) => rank(a) - rank(b) || a.at - b.at || a.seq - b.seq || a.address.localeCompare(b.address);

export function waitingQueue(list, terms, excluded = new Set(), previous = [], now = Date.now()) {
  const byAddress = new Map(terms.map((term) => [term.address, term]));
  const before = new Map(previous.map((row) => [row.address, row]));
  return list.filter((a) => a.pane && !a.asleep && !a.dozing && !excluded.has(a.address)
    && (a.status === "blocked" || a.status === "done") && (!byAddress.has(a.address) || byAddress.get(a.address).state === "live"))
    .map((a) => {
      const was = before.get(a.address), term = byAddress.get(a.address);
      const at = was?.status === a.status ? was.at : term?.status_ms ?? now;
      return { address: a.address, pane: a.pane, space: a.space, tab: a.tab, project: a.space_name,
        name: a.name || a.title || a.program?.name || a.address, status: a.status, at, seq: a.seq ?? 0 };
    }).toSorted(order);
}

export function nextWaiting(rows, cursor = null) {
  if (!rows.length) return null;
  if (!cursor) return rows[0];
  const at = rows.findIndex((row) => row.address === cursor.address);
  return at < 0 ? rows.find((row) => order(row, cursor) > 0) ?? rows[0] : rows[(at + 1) % rows.length];
}

export function queueState(rows, machines) {
  return { rows, state: machines.some((m) => m.layout === "loading") ? "loading"
    : machines.some((m) => m.layout === "unavailable") ? "unavailable" : "ready" };
}

export const waitingReason = (row) => row.status === "blocked" ? "Waiting for you" : "Finished";
export const queueMessage = (state) => state === "unavailable" ? "Queue unavailable" : "Nobody is waiting";
