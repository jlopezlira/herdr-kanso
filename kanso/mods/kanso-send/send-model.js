export function targetsOf(all, from, last) {
  const list = all.filter((p) => p.pane !== from && p.terminal && roleOf(p).deliverable);
  const i = list.findIndex((p) => p.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
}

const machineOf = (address) => /^([^/]+)\//.exec(String(address))?.[1] ?? null;
export const unreachable = (address, computers = []) => {
  const at = machineOf(address);
  const layout = at ? computers.find((m) => m?.name === at)?.layout : "ready";
  return !layout || layout === "unavailable";
};

const saysAgent = (record) => Boolean(record?.status || record?.program?.agent);
const saysShell = (record) => Boolean(record?.program && !record.program.agent && !record.status);
export const roleOf = (...records) => {
  const present = records.filter(Boolean), shell = present.find(saysShell);
  return { listed: present.some(saysAgent), deliverable: present.some(saysAgent) && !shell, program: shell?.program ?? present.find((r) => r.program)?.program ?? null };
};

export const labelled = (list) => list.map((x) => {
  const twins = list.filter((y) => y !== x && y.name === x.name);
  if (!twins.length) return { ...x, label: x.name };
  const branch = x.pane?.branch;
  return { ...x, label: `${x.name} (${branch && twins.every((y) => y.pane?.branch !== branch) ? branch : x.terminal})` };
});

const firstOf = (list, last) => {
  const i = list.findIndex((x) => x.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
};

export function sendState({ terms = [], ps = [], spaces = [], computers = [], from = null, to = null, toProject = null, query = "", last = null, nameOf = () => null } = {}) {
  const known = terms.length > 0 || ps.length > 0;
  const complete = known && computers.filter((m) => m?.name).every((m) => m.layout === "ready");
  const paneOf = new Map(ps.filter((p) => p?.terminal).map((p) => [p.terminal, p]));
  const projectOf = (pane) => (pane ? spaces.find((s) => (s?.tabs ?? []).some((t) => t?.id === pane.tab))?.name ?? null : null);
  const termOf = new Map(terms.filter((k) => k?.address).map((k) => [k.address, k]));
  const rowOf = (k) => {
    const pane = paneOf.get(k.address) ?? null;
    const role = roleOf(k, pane);
    return {
      terminal: k.address, pane, program: role.program, status: role.deliverable ? k.status ?? pane?.status ?? null : null,
      name: k.labels?.["kanso.shown"] || (pane ? nameOf(pane) : null) || k.address,
      project: k.labels?.["kanso.project"] || projectOf(pane) || "Other",
      state: !role.deliverable ? "shell" : unreachable(k.address, computers) ? "unreachable" : "ready",
    };
  };
  const live = [...termOf.values(), ...[...paneOf.keys()].filter((address) => !termOf.has(address)).map((address) => ({ address }))]
    .filter((k) => k.address !== from && (!k.state || k.state === "live"));
  const agents = live.filter((k) => roleOf(k, paneOf.get(k.address)).listed).map(rowOf);
  const missing = (address) => ({ terminal: address, pane: null, program: null, status: null, name: address, project: "Other",
    state: unreachable(address, computers) ? "unreachable" : complete ? "gone" : "unknown" });
  const found = toProject || !to ? null : agents.find((x) => x.terminal === to) ?? (live.some((k) => k.address === to) ? rowOf(live.find((k) => k.address === to)) : missing(to));
  const all = labelled([...agents, ...(found && !agents.includes(found) ? [found] : [])]);
  const chosen = found ? all.find((x) => x.terminal === found.terminal) : null;
  const q = query.trim().toLowerCase();
  const rows = all.filter((x) => !q || x.label.toLowerCase().includes(q) || x.project.toLowerCase().includes(q));
  const mine = from ? termOf.get(from)?.labels?.["kanso.project"] ?? projectOf(paneOf.get(from)) : null;
  const order = [...new Set([mine, ...rows.map((x) => x.project).toSorted((a, b) => a.localeCompare(b))])].filter((p) => p && rows.some((x) => x.project === p));
  const sendable = (x) => x.state === "ready" || x.state === "unreachable";
  const groups = order.map((project) => {
    const members = firstOf(rows.filter((x) => x.project === project), last);
    return { project, agents: members, recipients: members.filter((x) => sendable(x) && x.status !== "blocked"), waiting: members.filter((x) => sendable(x) && x.status === "blocked") };
  });
  const picked = toProject ? groups.find((g) => g.project === toProject) ?? null : null;
  const shown = chosen && rows.includes(chosen) ? chosen : null;
  const recipients = toProject ? picked?.recipients ?? [] : shown && sendable(shown) && shown.status !== "blocked" ? [shown] : [];
  const waiting = toProject ? picked?.waiting ?? [] : shown && sendable(shown) && shown.status === "blocked" ? [shown] : [];
  const empty = rows.length ? null : !complete ? "unknown" : q ? "no match" : "none";
  return { known, complete, groups, chosen, recipients, waiting, empty, label: toProject ? `Send to ${toProject}  ⌘↩` : "Send  ⌘↩" };
}

export const everyone = (terms, ps, options = {}) => sendState({ terms, ps, ...options }).groups;
