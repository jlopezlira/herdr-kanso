import { runs } from "./pieces.js";
import { DID_CAP, oneLine } from "./pure.js";

export { DID_CAP, oneLine };

export const AWAY_MS = 5 * 60_000;
export const KEEP_MS = 7 * 86400_000;
export const EVENT_CAP = 500;
export const LINE_CAP = 3;
export const MAINTENANCE_MS = 120_000;
export const LOG_LIMITS = { cap: EVENT_CAP, keepMs: KEEP_MS };
export const AWAY_PIECE = "sidebar.away";
export const awayShown = (map) => runs(AWAY_PIECE, map);
export const targetOf = (kind, id) => `${kind}:${id}`;
export function parseTarget(target) {
  const [kind, ...parts] = String(target ?? "").split(":");
  return { kind, id: parts.join(":") };
}
const PRIORITY = { blocked: 0, error: 1, pr: 2, finished: 3 };

export function changes(before, after) {
  if (!before) return [];
  if (after.type === "agent") {
    const newTurn = after.turn != null && before.turn != null && after.turn !== before.turn;
    if (before.status === after.status && !(after.status === "done" && newTurn)) return [];
    const fact = (kind) => [{ kind, text: after.name || "Agent", did: after.did ?? null }];
    if (after.status === "blocked") return fact("blocked");
    if (after.status === "error") return fact("error");
    if ((after.status === "done" && before.status !== "idle") || (after.status === "idle" && before.status === "working")) return fact("finished");
    return [];
  }
  const words = [
    ["state", "MERGED", "merged"], ["review", "APPROVED", "approved"],
    ["review", "CHANGES_REQUESTED", "changes requested"], ["checks", "fail", "checks failed"],
  ];
  return words.filter(([key, value]) => after[key] === value && before[key] !== value)
    .map(([, , word]) => ({ kind: "pr", text: `PR #${after.number} ${word}` }));
}

export function ordered(events) {
  return events.toSorted((a, b) => (PRIORITY[a.kind] ?? 4) - (PRIORITY[b.kind] ?? 4) || b.at - a.at || b.id - a.id);
}

export function digest(events, focus, now) {
  if (!focus) return [];
  const pending = new Set(JSON.parse(focus.pending_json || "[]"));
  const away = now - focus.focused_at >= AWAY_MS;
  return ordered(events.filter((event) => event.at <= now && event.id > (focus.dismissed_to ?? 0)
    && (pending.has(event.id) || away && event.at > focus.focused_at)));
}

export function lines(events, expanded = false) {
  if (expanded || events.length <= LINE_CAP) return events;
  return [...events.slice(0, LINE_CAP - 1), { more: events.length - LINE_CAP + 1 }];
}

export const RETURN_LABEL = "While you were away";
const MARK = { blocked: "blocked", error: "error", finished: "done", pr: "pr" };
const OUTCOME = { blocked: "Needs you", error: "Failed", finished: "Finished" };
const PR_TEXT = /^(PR #\d+)\s+(.+)$/;
const SPOKEN = /\s+(?:finished|needs you|errored)$/;

export function shownName(agent, seen, term) {
  const given = String(term?.labels?.["kanso.name"] ?? seen?.given ?? "").trim();
  if (given) return given;
  const conversation = String(seen?.title ?? "").trim();
  if (conversation) return conversation;
  const named = String(seen?.name ?? "").trim();
  if (named && !named.includes(" | ")) return named;
  // Herdr's terminal title is "conversation | folder"; the folder is not the name.
  const raw = String(agent?.title || term?.title || named || "").trim();
  return raw.split(" | ")[0].trim() || "Agent";
}

export function eventLabel(event) {
  const text = String(event?.text ?? "").trim();
  const pr = event?.kind === "pr" ? text.match(PR_TEXT) : null;
  if (pr) return { name: pr[1], outcome: pr[2].charAt(0).toUpperCase() + pr[2].slice(1) };
  return { name: text.replace(SPOKEN, "").split(" | ")[0].trim() || "Agent", outcome: OUTCOME[event?.kind] ?? null };
}

export function collapsed(events) {
  const kept = events.reduce((acc, event) => {
    const key = String(event.target ?? "");
    const prev = acc[key];
    const newer = !prev || event.at > prev.at || (event.at === prev.at && (event.id ?? 0) > (prev.id ?? 0));
    return newer ? { ...acc, [key]: event } : acc;
  }, {});
  return Object.values(kept);
}

export function rowOf(event, now, format) {
  const at = Number(event.at);
  return {
    id: event.id, target: event.target, kind: event.kind, mark: MARK[event.kind] ?? null,
    ...eventLabel(event), did: event.did || null, age: Number.isFinite(at) ? format(Math.max(0, now - at)) : "",
  };
}

export function present(events, { now = 0, focus = null, expanded = false, format } = {}) {
  const mine = ordered(collapsed((events ?? []).filter((event) => !focus || event.target !== focus)));
  return { count: mine.length, rows: lines(mine, expanded).map((row) => (row.more ? { more: row.more } : rowOf(row, now, format))) };
}

export function focusedTarget(events, before, after) {
  return after != null && after !== before && events.some((event) => event.target === after);
}

export function agentTargets(agent, seen, term) {
  return [seen?.conversation, term?.labels?.["kanso.id"], `${agent.address}:${term?.created_ms ?? ""}`].filter(Boolean).map((id) => targetOf("agent", id));
}

export function agentSnapshot(agent, seen, term, project) {
  const target = agentTargets(agent, seen, term)[0];
  return { source: target, project, value: {
    type: "agent", target, turn: term?.turn ?? null, name: shownName(agent, seen, term), status: term?.status === "error" ? "error" : agent.status,
    did: oneLine(term?.report?.msg),
  } };
}

// Where a row takes you: the agent's pane, the menu that wakes it, or the PR; null when it is gone.
export function destinationOf(target, live, asleep) {
  const { kind, id } = parseTarget(target);
  if (kind === "pr") return { kind, url: id };
  if (kind === "agent" && live.has(target)) return { kind, address: live.get(target) };
  const row = kind === "agent" ? asleep.find((a) => a.asleep?.resume === id) : null;
  return row ? { kind: "asleep", row } : null;
}

export function livePlaces(agents, targetsOf) {
  return new Map(agents.flatMap((agent) => targetsOf(agent).map((target) => [target, agent.address])));
}

export function observedAgents(list, panes, spaces, terms) {
  const byAddress = new Map(list.map((agent) => [agent.address, agent]));
  const byTerm = new Map(terms.map((term) => [term.address, term]));
  const byTab = new Map(spaces.flatMap((space) => (space.tabs ?? []).map((tab) => [tab.id, space.id])));
  const place = (address, visited = new Set()) => {
    if (!address || visited.has(address)) return null;
    return byAddress.get(address)?.space ?? byTab.get(panes.find((pane) => pane.terminal === address)?.tab)
      ?? place(byTerm.get(address)?.parent, new Set([...visited, address]));
  };
  const extra = terms.filter((term) => !byAddress.has(term.address) && term.program?.agent && term.status)
    .flatMap((term) => {
      const space = place(term.address);
      return space ? [{ address: term.address, space, title: term.title || term.name, status: term.status }] : [];
    });
  return [...list, ...extra];
}

export function returnSignature(list, terms, spaces, panes, seen, assigned) {
  const identity = (a) => seen?.get(a.address)?.conversation;
  const fields = (rows, keys) => rows.map((row) => keys.map((key) => String(key(row) ?? "")).join("\t")).join("\n");
  return [
    fields(list, [(a) => a.address, (a) => a.space, (a) => a.status, (a) => a.title, identity,
      (a) => seen?.get(a.address)?.name, (a) => assigned?.get(identity(a))?.project]),
    fields(terms, [(t) => t.address, (t) => t.status, (t) => t.turn, (t) => t.created_ms, (t) => t.parent,
      (t) => t.program?.agent, (t) => t.title, (t) => t.name, (t) => t.labels?.["kanso.name"], (t) => t.labels?.["kanso.id"],
      (t) => seen?.get(t.address)?.conversation, (t) => seen?.get(t.address)?.name,
      (t) => assigned?.get(identity(t) || t.labels?.["kanso.id"] || `${t.address}:${t.created_ms ?? ""}`)?.project]),
    fields(spaces, [(s) => s.id, (s) => s.machine, (s) => s.folder, (s) => (s.tabs ?? []).map((t) => t.id).join("\t")]),
    fields(panes, [(p) => p.terminal, (p) => p.tab]),
  ].join("\n\n");
}
