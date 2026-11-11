// A computer's name, kept as one row on that computer. The hc name is only how this one opens the file.
import { aliasText } from "./pure.js";

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
