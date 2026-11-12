import { RESUME_LABEL } from "./resume.js";

export const NEEDS_YOU = "kanso.needs-you";
export const EMPTY_NOTICE_MS = 1800;

const order = (a, b) => a.at - b.at || a.seq - b.seq || a.address.localeCompare(b.address);

const field = (value) => { const text = String(value ?? ""); return `${text.length}:${text}`; };

// What asleep is read from: each tab's settled state, each terminal's labels and shell, and the names kept for conversations.
export function sleepingSignature(spaces, panes, terms, kept) {
  const tabs = spaces.map((s) => [s.id, s.name, (s.tabs ?? []).map((t) => [t.id, t.name, t.index, t.settled, t.settled_at].map(field).join(""))].map(field).join(""));
  const where = panes.map((p) => [p.terminal, p.tab].map(field).join(""));
  const asleep = terms.map((t) => {
    const g = kept.get(t.labels?.[RESUME_LABEL]);
    return [t.address, JSON.stringify(t.labels ?? {}), t.program?.shell, t.state, t.status_ms, g?.name, g?.title, g?.said, g?.program].map(field).join("");
  });
  return [tabs.join(""), where.join(""), asleep.join("")].map(field).join("");
}

export function waitingSignature(list, terms, excluded, nameLabel) {
  const byAddress = new Map(terms.map((term) => [term.address, term]));
  return list.map((a) => {
    const term = byAddress.get(a.address);
    return [a.address, a.status, term?.status_ms, term?.state, excluded.has(a.address), Boolean(a.asleep), a.dozing,
      a.pane, a.space, a.tab, a.space_name, a.title, a.name, a.program?.name, a.seq, term?.labels?.[nameLabel]].map(field).join("");
  }).join("");
}

export function sameQueue(a, b) {
  if (!b || a.state !== b.state || a.rows.length !== b.rows.length) return false;
  return a.rows.every((row, i) => Object.keys(row).every((key) => row[key] === b.rows[i][key]));
}

export function waitingQueue(list, terms, excluded = new Set(), previous = [], now = Date.now()) {
  const byAddress = new Map(terms.map((term) => [term.address, term]));
  const before = new Map(previous.map((row) => [row.address, row]));
  return list.filter((a) => a.pane && !a.asleep && !a.dozing && !excluded.has(a.address)
    && a.status === "blocked" && (!byAddress.has(a.address) || byAddress.get(a.address).state === "live"))
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
  if (machines.some((m) => m.layout === "loading")) return { rows, state: "loading" };
  if (machines.some((m) => m.layout === "unavailable")) return { rows, state: "unavailable" };
  return { rows, state: "ready" };
}

export const waitingReason = () => "Waiting for you";
export const queueMessage = (state) => state === "unavailable" ? "Queue unavailable" : "Nobody is waiting";
