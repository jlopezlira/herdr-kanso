import { classify } from "./deliver.js";

export function targetsOf(all, from, last) {
  const list = all.filter((p) => p.pane !== from && p.terminal && classify([p]) === "ready");
  const i = list.findIndex((p) => p.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
}

const machineOf = (address) => /^([^/]+)\//.exec(String(address))?.[1] ?? null;
export const unreachable = (address, computers = []) => {
  const at = machineOf(address);
  const layout = at ? computers.find((m) => m?.name === at)?.layout : "ready";
  return !layout || layout === "unavailable";
};

const settled = (labels, list) => {
  const clash = labels.map((label) => labels.filter((other) => other === label).length > 1);
  return clash.some(Boolean) ? settled(labels.map((label, i) => (clash[i] ? `${label} (${list[i].terminal})` : label)), list) : labels;
};

export const labelled = (list) => {
  const first = list.map((x) => {
    const twins = list.filter((y) => y !== x && y.name === x.name);
    if (!twins.length) return x.name;
    const branch = x.pane?.branch;
    return `${x.name} (${branch && twins.every((y) => y.pane?.branch !== branch) ? branch : x.terminal})`;
  });
  const labels = settled(first, list);
  return list.map((x, i) => ({ ...x, label: labels[i], title: x.pane?.branch && labels[i] === `${x.name} (${x.pane.branch})` ? x.name : labels[i] }));
};

const firstOf = (list, last) => {
  const i = list.findIndex((x) => x.terminal === last);
  return i > 0 ? [list[i], ...list.toSpliced(i, 1)] : list;
};

export function sendState({ terms = [], ps = [], spaces = [], computers = [], from = null, to = null, toProject = null, query = "", last = null, nameOf = () => null } = {}) {
  const known = terms.length > 0 || ps.length > 0;
  const complete = known && computers.every((m) => m?.layout === "ready");
  const paneOf = new Map(ps.filter((p) => p?.terminal).map((p) => [p.terminal, p]));
  const projectOf = (pane) => (pane ? spaces.find((s) => (s?.tabs ?? []).some((t) => t?.id === pane.tab))?.name ?? null : null);
  const termOf = new Map(terms.filter((k) => k?.address).map((k) => [k.address, k]));
  const rowOf = (address) => {
    const k = termOf.get(address) ?? null, pane = paneOf.get(address) ?? null;
    const state = classify([k, pane], { reachable: !unreachable(address, computers), complete });
    return {
      terminal: address, pane, state,
      program: [k, pane].find((r) => r?.program && !r.program.agent)?.program ?? k?.program ?? pane?.program ?? null,
      status: state === "waiting" ? "blocked" : state === "ready" ? k?.status ?? pane?.status ?? null : null,
      name: k?.labels?.["kanso.shown"] || (pane ? nameOf(pane) : null) || address,
      project: k?.labels?.["kanso.project"] || projectOf(pane) || "Other",
    };
  };
  const listed = (x) => x.state === "ready" || x.state === "waiting" || x.state === "unreachable";
  const agents = [...new Set([...termOf.keys(), ...paneOf.keys()])].filter((address) => address !== from).map(rowOf).filter(listed);
  const found = toProject || !to ? null : agents.find((x) => x.terminal === to) ?? rowOf(to);
  const all = labelled([...agents, ...(found && !agents.includes(found) ? [found] : [])]);
  const chosen = found ? all.find((x) => x.terminal === found.terminal) : null;
  const q = query.trim().toLowerCase();
  const rows = all.filter((x) => !q || x.label.toLowerCase().includes(q) || x.project.toLowerCase().includes(q));
  const mine = from ? termOf.get(from)?.labels?.["kanso.project"] ?? projectOf(paneOf.get(from)) : null;
  const order = [...new Set([mine, ...rows.map((x) => x.project).toSorted((a, b) => a.localeCompare(b))])].filter((p) => p && rows.some((x) => x.project === p));
  const groups = order.map((project) => {
    const members = firstOf(rows.filter((x) => x.project === project), last);
    return { project, agents: members, recipients: members.filter((x) => x.state === "ready"), waiting: members.filter((x) => x.state === "waiting") };
  });
  const picked = toProject ? groups.find((g) => g.project === toProject) ?? null : null;
  const shown = chosen && rows.includes(chosen) ? chosen : null;
  const recipients = toProject ? picked?.recipients ?? [] : shown?.state === "ready" ? [shown] : [];
  const waiting = toProject ? picked?.waiting ?? [] : shown?.state === "waiting" ? [shown] : [];
  const empty = rows.length ? null : !complete ? "unknown" : q ? "no match" : "none";
  return { known, complete, groups, chosen, recipients, waiting, empty, label: toProject ? `Send to ${toProject}  ⌘↩` : "Send  ⌘↩" };
}

export const everyone = (terms, ps, options = {}) => sendState({ terms, ps, ...options }).groups;
