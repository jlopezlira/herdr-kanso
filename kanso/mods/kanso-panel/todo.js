import { q } from "./kdb.js";
import { num } from "./pr-inbox.js";
import { kindOf } from "./issues-model.js";

export const TODO = "todo";
export const TODO_BOARD = { ref: "list", name: "To-do" };
export const isTodo = (source) => kindOf(source) === TODO;
export const todoText = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export const addTodoSql = ({ id, project, text, created }) => `INSERT OR IGNORE INTO todos(id,project,text,created) VALUES(${q(id)},${q(project)},${q(text)},${num(created)});`;
export const doneSql = (id, at) => `UPDATE todos SET done_at=${at == null ? "NULL" : num(at)} WHERE id=${q(id)};`;
export const dropTodoSql = (id) => `DELETE FROM todos WHERE id=${q(id)};`;

export function todosOf(todos, project) {
  const mine = todos.filter((t) => t.project === project);
  return {
    open: mine.filter((t) => t.done_at == null).toSorted((a, b) => b.created - a.created),
    done: mine.filter((t) => t.done_at != null).toSorted((a, b) => b.done_at - a.done_at),
  };
}
