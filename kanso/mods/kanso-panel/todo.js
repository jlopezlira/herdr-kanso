import { q } from "./kdb.js";
import { num } from "./pr-inbox.js";

export const TODO_MS = 4000;
export const FOLLOW_MS = 300;
export const DONE = "Done";
export const PROJECTS = "SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;";
export const TODOS = "SELECT todos.* FROM todos JOIN projects ON projects.id=todos.project WHERE projects.removed IS NULL;";
export const HELD_TODOS = "SELECT todos.*, projects.folder AS folder FROM todos JOIN projects ON projects.id=todos.project WHERE projects.removed IS NULL AND projects.machine='';";
export const todoText = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export const addTodoSql = ({ id, project, text, created, by = null }) => `INSERT OR IGNORE INTO todos(id,project,text,created,by) VALUES(${q(id)},${q(project)},${q(text)},${num(created)},${q(by)});`;
export const doneSql = (id, at) => `UPDATE todos SET done_at=${at == null ? "NULL" : num(at)} WHERE id=${q(id)};`;
export const dropTodoSql = (id) => `DELETE FROM todos WHERE id=${q(id)};`;

export function todosOf(todos, project) {
  const mine = todos.filter((t) => t.project === project);
  return {
    open: mine.filter((t) => t.done_at == null).toSorted((a, b) => b.created - a.created),
    done: mine.filter((t) => t.done_at != null).toSorted((a, b) => b.done_at - a.done_at),
  };
}

export const stepState = (step) => (step.done_at != null ? "done" : step.started_at != null ? "doing" : "next");

export function plansOf(todos, project) {
  const plans = new Map();
  for (const step of todos.filter((t) => t.project === project).toSorted((a, b) => a.created - b.created)) {
    const key = `${step.on ?? ""}:${step.by ?? ""}`;
    if (!plans.has(key)) plans.set(key, { by: step.by ?? null, on: step.on ?? "", steps: [] });
    plans.get(key).steps.push(step);
  }
  const last = (plan) => Math.max(...plan.steps.map((s) => s.done_at ?? s.started_at ?? s.created));
  const doing = (plan) => plan.steps.some((s) => stepState(s) === "doing");
  return [...plans.values()].toSorted((a, b) => Number(doing(b)) - Number(doing(a)) || last(b) - last(a));
}

export const placeOf = (machine, folder) => `${machine ?? ""}:${String(folder ?? "").replace(/\/+$/, "")}`;

export function withSpaces(projects, spaces, homeDir) {
  const known = new Set(projects.map((p) => placeOf(p.machine, p.folder)));
  const opened = spaces.filter((s) => s.folder && placeOf(s.machine, s.folder) !== placeOf(null, homeDir))
    .map((s) => ({ id: placeOf(s.machine, s.folder), name: s.name, folder: s.folder, machine: s.machine ?? null, auto: true }));
  return [...projects, ...opened.filter((p, i) => !known.has(p.id) && opened.findIndex((x) => x.id === p.id) === i)];
}

export function ageOf(at, now) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
}
