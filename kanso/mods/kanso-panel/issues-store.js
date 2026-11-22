import { q } from "./kdb.js";
import { matches } from "./issues-model.js";

const COLS = ["url", "source", "project", "ticket", "number", "repo", "title", "status", "priority", "labels", "assignees", "author", "created_at", "updated_at", "body", "read_at"];
const num = (x) => (x != null && Number.isFinite(Number(x)) ? String(Math.round(Number(x))) : "NULL");
const value = (col, row) => (col === "number" || col === "read_at" ? num(row[col]) : q(row[col] ?? null));
const KEPT = COLS.filter((col) => col !== "url").map((col) => `${col}=excluded.${col}`).join(",");

const upsert = (row) => `INSERT INTO issues(${COLS.join(",")}) VALUES(${COLS.map((col) => value(col, row)).join(",")}) ON CONFLICT(url) DO UPDATE SET ${KEPT};`;

export async function readIssues(db, projects) {
  if (!projects.length) return { rows: [], boards: [] };
  const ids = projects.map((p) => q(p)).join(",");
  const [rows, boards] = await Promise.all([
    db.read(`SELECT * FROM issues WHERE project IN (${ids});`),
    db.read(`SELECT * FROM issue_boards WHERE project IN (${ids});`),
  ]);
  return { rows, boards };
}

export function boardSql({ project, source, filter, columns, failure, now }) {
  const failed = failure ? q(JSON.stringify(failure)) : "NULL";
  const readAt = failure ? "NULL" : num(now);
  const retry = failure?.retryAt ? num(failure.retryAt) : "NULL";
  return `INSERT INTO issue_boards(project,source,filter,columns,read_at,retry_at,failure) VALUES(${q(project)},${q(source)},${q(filter)},${q(JSON.stringify(columns ?? []))},${readAt},${retry},${failed}) `
    + `ON CONFLICT(project,source) DO UPDATE SET filter=excluded.filter,${failure ? "" : "columns=excluded.columns,read_at=excluded.read_at,"}retry_at=excluded.retry_at,failure=excluded.failure;`;
}

export function storeSql({ project, source, filter, login, rows, columns, failure, kept = [], now }) {
  if (failure) return `BEGIN;${boardSql({ project, source, filter, columns, failure, now })}COMMIT;`;
  const urls = new Set(rows.map((row) => row.url));
  const gone = kept.filter((row) => row.project === project && row.source === source && !urls.has(row.url) && matches(row, filter, login)).map((row) => q(row.url));
  const drop = gone.length ? `DELETE FROM issues WHERE url IN (${gone.join(",")});` : "";
  return `BEGIN;${rows.map(upsert).join("")}${drop}${boardSql({ project, source, filter, columns, failure: null, now })}COMMIT;`;
}

export const detailSql = (url, { body, comments, prs }) => `UPDATE issues SET body=${q(body)},comments=${q(comments)},prs=${q(prs)} WHERE url=${q(url)};`;
