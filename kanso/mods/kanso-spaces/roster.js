// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { agentLabel, THREAD_LABEL } from "./agents.js";
import { NAME_LABEL } from "./marks.js";
import { spaceFor, conversationOf } from "./kdb.js";
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

// `dozing`: terminals still open on their way to sleep, only while the sleep is under way; an address given to another agent later is that agent's.
export function sleepingNow(sp, terms, asleep, home = () => "") {
  const live = new Set(terms.map((k) => k.address)), ids = new Set(sp.map((w) => w.id));
  const tabSpace = new Map(sp.flatMap((w) => (w.tabs ?? []).map((tb) => [tb.id, w.id])));
  const each = asleep.flatMap((s) => (s.agents ?? []).map((p, i) => ({ s, p, i })));
  const onItsWay = ({ s, p }) => s.pending && p.terminal && live.has(p.terminal);
  const dozing = new Set(each.filter(onItsWay).map(({ p }) => p.terminal));
  const rows = each.filter((x) => !onItsWay(x)).map(({ s, p, i }) => {
    const space = (p.spaceId && ids.has(p.spaceId) ? p.spaceId : null) || (s.into?.tabId && tabSpace.get(s.into.tabId))
      || spaceFor({ spaceId: s.spaceId, spaceName: s.space, project: s.from }, sp, home())?.id || null;
    const program = p.program ? parseOr(p.program) : null; // not JSON: no icon
    return { address: `zz:${p.resume ?? `${s.id}:${i}`}`, pane: null, tab: null, space, status: "asleep", labels: {}, pin: null, seq: 0, turn: 0,
      name: p.name, title: p.title ?? null, program,
      asleep: { id: s.id, from: s.from, tab: s.name, n: (s.agents ?? []).length, saved: s.saved, busy: Boolean(s.busy), spaceName: s.space ?? null,
        at: p.at ?? null, said: p.said ?? null, resume: p.resume ?? null } };
  });
  return { rows, dozing };
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

