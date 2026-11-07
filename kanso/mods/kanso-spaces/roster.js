// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Who is in the left nav and where: each agent's one name, what the sidebar
// sees of every agent now (by its conversation, for the left nav's
// database), and the agents asleep, each back in its own space. Pure: what
// they read comes in as arguments, so every view agrees and a test can run them.
import { agentLabel, THREAD_LABEL } from "./agents.js";
import { NAME_LABEL } from "./marks.js";
import { spaceFor, conversationOf } from "./kdb.js";
import { parseOr } from "./pure.js";

// An agent's conversation, from what Threads read of its terminal.
export const conversationOfThread = (th) => conversationOf(th?.file);

// Is what Threads read of a terminal (`th`, read from the process in front
// there, `th.pid`) about the process running in it now (`k`: the
// terminal)? When the terminal says what runs in front of it: only that
// one. When it does not (Herdr's terminal list need not say): only while
// that process still lives (`alive`: the pids alive at the last look; a
// pid is that process's alone while it lives, so a program started since
// in the same terminal is never taken for it). Not known: no.
export const readNow = (th, k, alive = null) => Boolean(th) && th.pid != null && Boolean(k)
  && (k.foreground?.pid != null ? th.pid === k.foreground.pid : Boolean(alive?.has(th.pid)));
// What Threads read, to show (a title, a last message): only a reading of
// the process running there now, the same rule as for keeping it.
export const shownThread = (th, k, alive = null) => (readNow(th, k, alive) ? th : null);

// Every terminal's own id in Herdr: written once onto it as a label by the
// sidebar (main.js nameTerminals), so it stays with that terminal, and a
// terminal that later gets the same address is another one.
export const ID_LABEL = "kanso.id";
// An agent's key in the left nav's database, whatever its program: its
// conversation when one is known for the process running there now, else
// its terminal's own id (`term:<id>`), else null (not named yet).
export const agentKey = (th, k, alive = null) => (readNow(th, k, alive) ? conversationOfThread(th) : null)
  ?? (k?.labels?.[ID_LABEL] ? `term:${k.labels[ID_LABEL]}` : null);

// An agent's one name, the same in every view: the one you gave it (Rename,
// anywhere: the terminal's label, else kept with its conversation in the
// database, `kept`), else its conversation's title, else what the program
// calls itself.
export function nameOf(a, thread, kept) {
  if (a.asleep || a.sub) return a.name || agentLabel(a);
  return a.name || a.labels?.[THREAD_LABEL] || kept?.name || thread?.title || kept?.title || agentLabel(a);
}

// What the sidebar sees of each live agent now, by address: { conversation,
// given (the name you gave it, if any), name (as shown), title, said, space,
// tab, pos, program, status, terminal, cwd, since }; conversation null while
// it is not known for the process running there now. `ctx.rowsBy`: each
// space's rows; `ctx.terms`: terminals. One on its way to sleep, a sub-agent,
// another machine's, or one whose program has ended is not seen.
export function seenNow(sp, ctx, threads, kept, nameFor, since = {}) {
  const term = new Map(ctx.terms.map((k) => [k.address, k]));
  return new Map(sp.flatMap((w) => (ctx.rowsBy.get(w.id) ?? []).flatMap((a, i) => {
    const k = term.get(a.address);
    if (a.asleep || a.sub || a.dozing || a.address.includes("/") || (k && k.state !== "live")) return [];
    const th = threads?.[a.address];
    const conversation = agentKey(th, k, ctx.alive), was = conversation ? kept.get(conversation) : null;
    return [[a.address, { conversation, given: a.name || null, name: nameFor(a), title: th?.title ?? was?.title ?? null, said: th?.said ?? th?.at ?? was?.said ?? null,
      space: w.id, tab: a.tab ?? null, pos: i, program: a.program ? JSON.stringify(a.program) : null, status: a.status || "unknown",
      terminal: a.address, cwd: a.cwd ?? null, since: since[a.address]?.at ?? null }]];
  })));
}

// Every agent asleep, one row each, where it was: what the left nav keeps
// of it (`asleep`: shared "kanso.asleep", a copy of the database). Its
// space is its own (by id), else the tab it slept from, else the space its
// sleep was in by the one-fit rule; never another that only shares its
// folder. `rows`: the sleeping agents (space null: no space now). `dozing`:
// terminals still open on their way to sleep (only while the sleep is under
// way: an address given to another agent later is that agent's).
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

// Every terminal's name in Herdr, the one way any agent of any model finds
// another: Kanso names each live terminal on this computer itself, whether
// or not its program gave it one, and writes the name onto the terminal as
// a Herdr label (SHOWN_LABEL), so `hc ls --label kanso.shown=<name>` gives
// its address. The name is the one the sidebar shows (`seen`: address ->
// { name, space }); else the one a person gave it (kanso.name), else the
// title its program set, else the program, else its address. Names are
// unique: a second "Claude Code" is "Claude Code 2", in address order.
// `spaceName(k)`: the project it shows under, for PROJECT_LABEL.
export const SHOWN_LABEL = "kanso.shown";
export const PROJECT_LABEL = "kanso.project";
// A title without the spinner or mark a program puts in front, nor padding.
const cleanTitle = (t) => String(t ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
export function terminalNames(terms, seen = new Map(), spaceName = () => null) {
  const local = terms.filter((k) => !String(k.address).includes("/") && (!k.state || k.state === "live"))
    .toSorted((a, b) => String(a.address).localeCompare(String(b.address), undefined, { numeric: true }));
  const base = local.map((k) => ({ k, name: seen.get(k.address)?.name || k.labels?.[NAME_LABEL] || cleanTitle(k.title)
    || k.program?.name || k.app || k.agent || k.address }));
  // A name already taken (by one before, or one a later terminal has as
  // its own) gets the first free " n".
  const own = new Set(base.map((x) => x.name));
  const free = (name, taken, n = 2) => (!taken.has(name) ? name : taken.has(`${name} ${n}`) || own.has(`${name} ${n}`) ? free(name, taken, n + 1) : `${name} ${n}`);
  const named = base.reduce((acc, { k, name }) => {
    const unique = free(name, acc.taken);
    return { list: [...acc.list, [k.address, { name: unique, project: seen.get(k.address)?.project ?? spaceName(k) }]], taken: new Set([...acc.taken, unique]) };
  }, { list: [], taken: new Set() }).list;
  return new Map(named);
}

