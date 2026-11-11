export const AWAY_MS = 5 * 60_000;
export const KEEP_MS = 7 * 86400_000;
export const EVENT_CAP = 500;
export const LINE_CAP = 3;
export const MAINTENANCE_MS = 120_000;
export const LOG_LIMITS = { cap: EVENT_CAP, keepMs: KEEP_MS };
export const targetOf = (kind, id) => `${kind}:${id}`;
export function parseTarget(target) {
  const [kind, ...parts] = String(target ?? "").split(":");
  return { kind, id: parts.join(":") };
}
export function sleepEvent(id, state) {
  const facts = { stuck: ["sleep_failed", "could not sleep"], asleep: ["sleep_finished", "slept"] }[state];
  return facts ? { ...LOG_LIMITS, target: targetOf("sleep", id), kind: facts[0], word: facts[1] } : null;
}
const PRIORITY = { blocked: 0, error: 1, sleep_failed: 1, pr: 2, finished: 3, sleep_finished: 3 };

export function changes(before, after) {
  if (!before) return [];
  if (after.type === "agent") {
    const newTurn = after.turn != null && before.turn != null && after.turn !== before.turn;
    if (before.status === after.status && !(after.status === "done" && newTurn)) return [];
    if (after.status === "blocked") return [{ kind: "blocked", text: `${after.name} needs you` }];
    if (after.status === "error") return [{ kind: "error", text: `${after.name} errored` }];
    if ((after.status === "done" && before.status !== "idle") || (after.status === "idle" && before.status === "working")) return [{ kind: "finished", text: `${after.name} finished` }];
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

export function focusedTarget(events, before, after) {
  return after != null && after !== before && events.some((event) => event.target === after);
}

export function agentTargets(agent, seen, term) {
  return [seen?.conversation, term?.labels?.["kanso.id"], `${agent.address}:${term?.created_ms ?? ""}`].filter(Boolean).map((id) => targetOf("agent", id));
}

export function agentSnapshot(agent, seen, term, project) {
  const target = agentTargets(agent, seen, term)[0];
  return { source: target, project, value: {
    type: "agent", target, turn: term?.turn ?? null, name: seen?.name || agent.title || "Agent", status: term?.status === "error" ? "error" : agent.status,
  } };
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
      (t) => t.program?.agent, (t) => t.title, (t) => t.name, (t) => t.labels?.["kanso.id"],
      (t) => seen?.get(t.address)?.conversation, (t) => seen?.get(t.address)?.name,
      (t) => assigned?.get(identity(t) || t.labels?.["kanso.id"] || `${t.address}:${t.created_ms ?? ""}`)?.project]),
    fields(spaces, [(s) => s.id, (s) => s.machine, (s) => s.folder, (s) => (s.tabs ?? []).map((t) => t.id).join("\t")]),
    fields(panes, [(p) => p.terminal, (p) => p.tab]),
  ].join("\n\n");
}
