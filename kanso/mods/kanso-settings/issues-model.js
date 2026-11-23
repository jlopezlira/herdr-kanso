export const FILTERS = ["assigned", "created", "all"];
export const sourceKey = (l) => (l.source === "github" ? "github" : `${l.source}:${l.ref}`);
export const FILTER_WORDS = { assigned: "Assigned to me", created: "Created by me", all: "All open" };
export const OPEN = "Open";
export const DONE = "Done";
export const FRESH_MS = 60_000;
export const ACCOUNTS = "kanso.issues.accounts";
export const kindOf = (source) => String(source ?? "github").split(":")[0];
export const SOURCE_WORDS = { github: "GitHub", jira: "Jira", linear: "Linear" };
export const EVERY_MS = 5 * 60_000;
export const stampsOf = (node) => ({ created_at: node.createdAt ?? null, updated_at: node.updatedAt ?? null });

import { same } from "./pure.js";

export const listOf = (text) => {
  try {
    const value = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const matches = (row, filter, login) => {
  if (filter === "all") return true;
  if (filter === "created") return same(row.author, login);
  return listOf(row.assignees).some((who) => same(who, login));
};

export function sectionsOf(rows, columns = []) {
  const named = [...new Set([...columns, ...rows.map((row) => row.status || OPEN)])];
  const order = named.includes(OPEN) ? named : [...named, OPEN];
  return order
    .map((status) => ({ status, rows: rows.filter((row) => (row.status || OPEN) === status).toSorted((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) }))
    .filter((section) => section.rows.length > 0 || columns.includes(section.status));
}

export const foldedByDefault = (status) => same(status, DONE);

export const isFolded = (folds, project, status) => {
  const key = `${project}\u0000${status}`;
  return key in folds ? Boolean(folds[key]) : foldedByDefault(status);
};

export const foldKey = (project, status) => `${project}\u0000${status}`;

export function projectsInOrder(projects, front) {
  return projects.toSorted((a, b) => Number(b.id === front) - Number(a.id === front) || String(a.name).localeCompare(String(b.name)));
}

export const stale = (readAt, now, fresh = FRESH_MS) => !readAt || now - readAt >= fresh;

export function ageOf(at, now) {
  const then = Date.parse(at ?? "");
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
}

export const linkWords = (source) => (kindOf(source) === "github" ? "Open on GitHub" : `Open in ${SOURCE_WORDS[kindOf(source)]}`);

export const PICKER_PAGES = 50;

export const placeOf = (machine, folder) => `${machine ?? ""}:${String(folder ?? "").replace(/\/+$/, "")}`;

export function withSpaces(projects, spaces, homeDir) {
  const known = new Set(projects.map((p) => placeOf(p.machine, p.folder)));
  const opened = spaces.filter((s) => s.folder && placeOf(s.machine, s.folder) !== placeOf(null, homeDir))
    .map((s) => ({ id: placeOf(s.machine, s.folder), name: s.name, folder: s.folder, machine: s.machine ?? null, auto: true }));
  return [...projects, ...opened.filter((p, i) => !known.has(p.id) && opened.findIndex((x) => x.id === p.id) === i)];
}

export async function pagesOf(read, pages = 10, start = null) {
  const walk = async (cursor, items, page) => {
    const got = await read(cursor);
    if (got.failure) return { items, failure: got.failure, complete: false, next: cursor };
    const all = [...items, ...(got.items ?? [])];
    if (got.next === null || got.next === undefined) return { items: all, failure: null, complete: true, next: null };
    return page + 1 < pages ? walk(got.next, all, page + 1) : { items: all, failure: null, complete: false, next: got.next };
  };
  return walk(start, [], 0);
}

export function sendText(row) {
  return [`${row.ticket} ${row.title}`, row.url, String(row.body ?? "").trim()].filter(Boolean).join("\n\n");
}
