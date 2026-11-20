// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { agentLabel, THREAD_LABEL } from "./agents.js";
import { NAME_LABEL } from "./marks.js";
import { conversationOf } from "./kdb.js";
import { RESUME_LABEL, asleepTerminal } from "./resume.js";
import { parseOr } from "./pure.js";

export const conversationOfThread = (th) => conversationOf(th?.file);

// Herdr need not say what runs in front of a terminal; while it doesn't, a pid is that process's alone, so a program started since in the same terminal is never taken for it.
export const readNow = (th, k, alive = null) => Boolean(th) && th.pid != null && Boolean(k)
  && (k.foreground?.pid != null ? th.pid === k.foreground.pid : Boolean(alive?.has(th.pid)));
export const shownThread = (th, k, alive = null) => (readNow(th, k, alive) ? th : null);

// Written once onto the terminal, so a terminal that later gets the same address is still another one.
export const ID_LABEL = "kanso.id";
export const agentKey = (th, k, alive = null) => (readNow(th, k, alive) ? conversationOfThread(th) : null)
  ?? (k?.labels?.[ID_LABEL] ? `term:${k.labels[ID_LABEL]}` : null);

export function nameOf(a, thread, kept) {
  if (a.asleep || a.sub) return a.name || agentLabel(a);
  return a.name || a.labels?.[THREAD_LABEL] || kept?.name || thread?.title || kept?.title || agentLabel(a);
}

export function seenNow(sp, ctx, threads, kept, nameFor, since = {}) {
  const term = new Map(ctx.terms.map((k) => [k.address, k]));
  return new Map(sp.flatMap((w) => (ctx.rowsBy.get(w.id) ?? []).flatMap((a, i) => {
    const k = term.get(a.address);
    if (a.asleep || a.sub || a.dozing || a.address.includes("/") || (k && k.state !== "live")) return [];
    const th = threads?.[a.address];
    const conversation = agentKey(th, k, ctx.alive), was = conversation ? kept.get(conversation) : null;
    return [[a.address, { conversation, given: a.name || null, name: nameFor(a), title: th?.title ?? was?.title ?? null, said: th?.said ?? th?.at ?? was?.said ?? null,
      space: w.id, tab: a.tab ?? null, pos: i, program: a.program ? JSON.stringify(a.program) : null, status: a.status || "unknown",
      terminal: a.address, cwd: a.cwd ?? null, since: since[a.address]?.at ?? null, pid: readNow(th, k, ctx.alive) ? th.pid : null }]];
  })));
}

// Asleep is Herdr's own state: a terminal with its conversation label at its shell prompt. A settled tab sleeps as one;
// a terminal in a tab still shown (an agent alone, or another screen's settle) sleeps on its own.
export function sleepingNow(sp, ps, terms, kept = new Map()) {
  const term = new Map(terms.map((k) => [k.address, k]));
  const tabOf = new Map(sp.flatMap((w) => (w.tabs ?? []).map((tb) => [tb.id, { w, tb }])));
  const asleep = ps.filter((p) => tabOf.has(p.tab) && asleepTerminal(term.get(p.terminal)));
  const rows = asleep.map((p) => {
    const k = term.get(p.terminal), { w, tb } = tabOf.get(p.tab), resume = k.labels[RESUME_LABEL], was = kept.get(resume);
    const name = k.labels[NAME_LABEL] || was?.name || was?.title || "Claude";
    return { address: `zz:${p.terminal}`, pane: null, tab: null, space: w.id, status: "asleep", labels: {}, pin: null, seq: 0, turn: 0,
      name, title: was?.title ?? null, program: was?.program ? parseOr(was.program) : null,
      asleep: { id: tb.settled ? tb.id : p.terminal, spaceName: w.name, tab: tb.settled ? tb.name || `Tab ${(tb.index ?? 0) + 1}` : name,
        n: tb.settled ? asleep.filter((x) => x.tab === p.tab).length : 1, saved: (tb.settled && tb.settled_at) || k.status_ms || null,
        said: was?.said ?? null, resume, terminal: p.terminal, tabId: tb.id, settled: Boolean(tb.settled), space: w.id } };
  });
  const tabs = new Set(asleep.filter((p) => tabOf.get(p.tab).tb.settled).map((p) => p.tab));
  return { rows, dozing: new Set([...asleep, ...ps.filter((p) => tabs.has(p.tab))].map((p) => p.terminal)) };
}

// One project with nothing awake is one group; a sleeping tab beside live agents is its own.
export function asleepGroups(rows, { asleepOf = (row) => row.asleep ?? null, key = null } = {}) {
  const tagged = rows.map((row) => ({ row, z: asleepOf(row) }));
  const asleep = tagged.filter((x) => x.z);
  if (!asleep.length) return { live: rows, groups: [] };
  const live = tagged.filter((x) => !x.z).map((x) => x.row);
  const pack = (id, name, whole, list) => ({ id, name, whole, rows: list.map((x) => x.row) });
  if (!live.length) {
    return { live: [], groups: [pack(`project:${key ?? asleep[0].row.space ?? "asleep"}`, null, true, asleep)] };
  }
  return { live, groups: [...Map.groupBy(asleep, (x) => x.z.id)].map(([id, list]) => pack(`sleep:${id}`, list[0].z.tab, false, list)) };
}

// The shown name goes onto the terminal as a label, so `hc ls --label kanso.shown=<name>` gives its address: the one way any agent finds another.
export const SHOWN_LABEL = "kanso.shown";
export const PROJECT_LABEL = "kanso.project";
// A title without the spinner or mark a program puts in front, nor padding.
const cleanTitle = (t) => String(t ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
export function terminalNames(terms, seen = new Map(), spaceName = () => null) {
  const local = terms.filter((k) => !String(k.address).includes("/") && (!k.state || k.state === "live"))
    .toSorted((a, b) => String(a.address).localeCompare(String(b.address), undefined, { numeric: true }));
  const base = local.map((k) => ({ k, name: seen.get(k.address)?.name || k.labels?.[NAME_LABEL] || cleanTitle(k.title)
    || k.program?.name || k.app || k.agent || k.address }));
  // `own`: a name a later terminal has as its own is taken too.
  const own = new Set(base.map((x) => x.name));
  const free = (name, taken, n = 2) => (!taken.has(name) ? name : taken.has(`${name} ${n}`) || own.has(`${name} ${n}`) ? free(name, taken, n + 1) : `${name} ${n}`);
  const named = base.reduce((acc, { k, name }) => {
    const unique = free(name, acc.taken);
    return { list: [...acc.list, [k.address, { name: unique, project: seen.get(k.address)?.project ?? spaceName(k) }]], taken: new Set([...acc.taken, unique]) };
  }, { list: [], taken: new Set() }).list;
  return new Map(named);
}

