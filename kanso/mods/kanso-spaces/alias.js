// A computer's name, kept as one row on that computer. The hc name is only how this one opens the file.
import { openOverlay, props, shared, setShared } from "herdr";
import { restDue } from "./kdb.js";
import { machineState } from "./machines.js";
import { aliasText, machineTitle } from "./pure.js";

export const ALIAS_ASK = "kanso.alias.ask";
const LOCAL = "local";

const stamp = (at) => Math.round(Number(at) || 0);
const clean = (name) => String(name ?? "").trim();

export function aliasOf(book, route) {
  return aliasText(Object.fromEntries(Object.entries(book ?? {}).map(([key, row]) => [key, row?.name ?? ""])), route);
}

export function renameTo(text, fallback, at) {
  if (text == null) return null;
  const name = clean(text);
  const bare = clean(fallback);
  return { name: !name || name === bare ? "" : name, at: stamp(at) };
}

// A row ahead of this clock is the other computer. A write made now still takes the name, and that later time stays.
export function placeAlias(kept, write, now) {
  if (!write) return kept ?? null;
  const next = { name: clean(write.name), at: stamp(write.at) };
  if (!kept) return next;
  const row = { name: clean(kept.name), at: stamp(kept.at) };
  if (next.at >= row.at) return next;
  if (row.at > now && next.at >= now) return { name: next.name, at: row.at };
  return row;
}

export function bookOf(rows) {
  return Object.fromEntries((rows ?? []).filter((row) => row && row.route != null).map((row) => [String(row.route), {
    name: clean(row.name), at: stamp(row.at), pending: row.pending ? 1 : 0,
  }]));
}

export function selfOf(rows) {
  const row = (rows ?? []).find((item) => String(item?.route ?? "") === "");
  return row ? { name: clean(row.name), at: stamp(row.at) } : null;
}

export function publishNames(book) {
  return Object.fromEntries(Object.entries(book ?? {}).filter(([, row]) => row?.name).map(([route, row]) => [route, row.name]));
}

export function deliversNow(route, phaseWord) {
  return Boolean(route) && !phaseWord;
}

export function catchUp(local, remote, now) {
  if (local?.pending) {
    const want = placeAlias(remote, { name: local.name, at: local.at }, now);
    const there = remote && clean(remote.name) === want.name && stamp(remote.at) === want.at;
    return { show: want, write: there ? null : { name: want.name, at: want.at }, row: { name: want.name, at: want.at, pending: there ? 0 : 1 } };
  }
  const placed = remote ? placeAlias(local, remote, now) : (local ? { name: clean(local.name), at: stamp(local.at) } : null);
  return { show: placed, write: null, row: placed ? { name: placed.name, at: placed.at, pending: 0 } : null };
}

export function mergeBooks(memory, stored, now) {
  const routes = [...new Set([...Object.keys(memory ?? {}), ...Object.keys(stored ?? {})])];
  return Object.fromEntries(routes.flatMap((route) => {
    const here = memory?.[route] ?? null;
    const saved = stored?.[route] ?? null;
    if (!here && !saved) return [];
    if (!here) return [[route, { name: saved.name, at: saved.at, pending: saved.pending ? 1 : 0 }]];
    if (!saved) return [[route, here]];
    const placed = placeAlias(saved, here, now);
    const pending = placed.name === here.name && here.pending ? 1 : (placed.name === saved.name && saved.pending ? 1 : 0);
    return [[route, { name: placed.name, at: placed.at, pending }]];
  }));
}

export function takeAsks(box, seen) {
  const entries = box && typeof box === "object" && !Array.isArray(box) ? Object.entries(box) : [];
  return entries.flatMap(([token, ask]) => {
    if (!ask || !(ask.at > (seen ?? 0))) return [];
    return [{ route: token === LOCAL ? "" : token, text: ask.text, at: ask.at }];
  }).toSorted((a, b) => a.at - b.at);
}

export function askedAlias(book, ask, { hostName = "", phaseWord = "" } = {}) {
  if (ask.text == null) return null;
  const route = ask.route || "";
  const next = renameTo(ask.text, route ? route : (hostName || "This computer"), ask.at);
  if (!next) return null;
  const had = book?.[route] ?? null;
  if (!next.name && !had?.name) return null;
  const placed = placeAlias(had, next, ask.at);
  const row = { name: placed.name, at: placed.at, pending: route ? 1 : 0 };
  return {
    book: { ...(book ?? {}), [route]: row },
    save: { route, ...row },
    remote: deliversNow(route, phaseWord) ? { name: placed.name, at: placed.at } : null,
  };
}

// The sidebar holds one of these. A save that fails stays pending and rides the next read.
export class Names {
  constructor(view) {
    this.view = view;
    this.book = {};
    this.waiting = {};
    this.asked = 0;
    this.dirty = false;
  }

  title(machine) {
    return machineTitle(machine, this.view.hostName, aliasOf(this.book, machine ?? ""));
  }

  publish() {
    const next = publishNames(this.book);
    if (JSON.stringify(next) === JSON.stringify(shared("kanso.alias") ?? {})) return;
    setShared("kanso.alias", next);
  }

  paint(cx) {
    if (!this.dirty) return;
    this.dirty = false;
    cx.notify();
  }

  take(cx) {
    const asks = takeAsks(shared(ALIAS_ASK), this.asked);
    if (!asks.length) return;
    this.asked = asks.reduce((max, ask) => (ask.at > max ? ask.at : max), this.asked);
    for (const ask of asks) this.apply(ask);
    this.publish();
    this.dirty = false;
    cx.notify();
  }

  apply(ask) {
    const step = askedAlias(this.book, ask, {
      hostName: this.view.hostName ?? "",
      phaseWord: ask.route ? machineState(this.view.phaseOf(ask.route)) : "",
    });
    if (!step) return;
    this.book = step.book;
    this.waiting = { ...this.waiting, [step.save.route]: step.save };
    this.publish();
    this.commit(step.save.route);
    if (step.remote) this.deliver(ask.route, step.remote);
  }

  commit(route) {
    const row = this.book[route];
    if (!row) return;
    const save = { route, name: row.name, at: row.at, pending: route ? (row.pending ? 1 : 0) : 0 };
    Promise.resolve().then(() => this.view.db().saveAlias(save)).then((got) => {
      const landed = Array.isArray(got) ? got[0] : null;
      if (landed) this.settle(route, landed, false);
      else this.mark(route);
    }, () => this.mark(route));
  }

  mark(route) {
    const row = this.book[route];
    if (!row) return;
    const next = { name: row.name, at: row.at, pending: 1 };
    this.book = { ...this.book, [route]: next };
    this.waiting = { ...this.waiting, [route]: { route, ...next } };
    this.dirty = true;
  }

  settle(route, got, rewrite) {
    const row = { name: String(got.name ?? "").trim(), at: Math.round(Number(got.at) || 0), pending: rewrite || !route ? 0 : 1 };
    this.book = { ...this.book, [route]: row };
    this.waiting = rewrite
      ? { ...this.waiting, [route]: { route, ...row } }
      : Object.fromEntries(Object.entries(this.waiting).filter(([key]) => key !== route));
    this.dirty = true;
    this.publish();
  }

  owed(name) {
    const row = this.book[name];
    if (!row?.pending) return null;
    return { route: "", name: row.name, at: row.at, pending: 0 };
  }

  pending() {
    const rows = Object.entries(this.waiting).map(([route, row]) => ({
      route, name: row.name, at: row.at, pending: route ? (row.pending ? 1 : 0) : 0,
    }));
    return rows.length ? rows : null;
  }

  absorb(rows, now) {
    if (!Array.isArray(rows)) return;
    const stored = bookOf(rows);
    const merged = mergeBooks(this.book, stored, now);
    const next = Object.fromEntries(Object.entries(merged).map(([route, row]) => {
      const saved = stored[route];
      return [route, saved && saved.name === row.name && saved.at === row.at ? { name: row.name, at: row.at, pending: saved.pending ? 1 : 0 } : row];
    }));
    const waiting = Object.fromEntries(Object.entries(this.waiting).filter(([route, row]) => {
      const shown = next[route];
      return Boolean(shown && shown.pending && shown.name === row.name && shown.at === row.at);
    }));
    if (JSON.stringify(next) === JSON.stringify(this.book) && JSON.stringify(waiting) === JSON.stringify(this.waiting)) return;
    this.book = next;
    this.waiting = waiting;
    this.dirty = true;
    this.publish();
  }

  took(name, rows, now) {
    if (!Array.isArray(rows)) return;
    const had = this.book[name] ?? null;
    const step = catchUp(had, selfOf(rows), now);
    const row = step.row;
    const pending = row?.pending ? 1 : 0;
    if (row && had && row.name === had.name && row.at === had.at && pending === (had.pending ? 1 : 0)) return;
    if (!row && !had) return;
    const next = row ? { name: row.name, at: row.at, pending } : null;
    this.book = next ? { ...this.book, [name]: next } : Object.fromEntries(Object.entries(this.book).filter(([key]) => key !== name));
    this.waiting = next ? { ...this.waiting, [name]: { route: name, ...next } } : Object.fromEntries(Object.entries(this.waiting).filter(([key]) => key !== name));
    this.dirty = true;
    this.publish();
  }

  deliver(route, placed) {
    const now = Date.now();
    const due = restDue({ readAt: this.view.remoteAt?.get(route) ?? null, ordered: false, now, active: this.view.inFront(), showing: true });
    if (due) {
      Promise.resolve(this.view.loadNames()).then(() => {}, () => this.mark(route));
      return;
    }
    Promise.resolve(this.view.storeOn(route)).then((store) => store.kdb.saveAlias({ route: "", name: placed.name, at: placed.at, pending: 0 }, now)).then((got) => {
      const landed = Array.isArray(got) ? got[0] : null;
      if (landed) this.settle(route, landed, true);
      else this.mark(route);
    }, () => this.mark(route));
  }

  ask(route, shown) {
    openOverlay({ mod: "kanso-prompt", kind: "dialog", width: 420, props: {
      title: "Rename computer", value: shown ?? "",
      hint: "Empty: the name it already has",
      shared: ALIAS_ASK, token: route ? route : "local" } });
  }

  rename(machine) {
    this.ask(machine ?? "", this.title(machine));
  }

  open(machine) {
    openOverlay({ mod: "kanso-spaces", kind: "popup", width: 220, height: 72, at: "pointer", props: {
      machineMenu: { route: machine ?? "", shown: this.title(machine) } } });
  }

  menu(t) {
    const menu = props()?.machineMenu ?? {};
    const item = this.view.items(t);
    return this.view.menuFrame(t).child(item("rename", "Rename", () => this.ask(menu.route ?? "", menu.shown ?? "")));
  }
}
