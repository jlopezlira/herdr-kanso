import { q } from "./kdb.js";
import { matches } from "./issues-model.js";
import { num } from "./pr-inbox.js";

const COLS = ["url", "source", "project", "ticket", "number", "repo", "title", "status", "priority", "labels", "assignees", "author", "created_at", "updated_at", "body", "read_at"];
const value = (col, row) => (col === "number" || col === "read_at" ? num(row[col]) : q(row[col] ?? null));
const KEPT = COLS.filter((col) => col !== "url" && col !== "project").map((col) => `${col}=excluded.${col}`).join(",");

const upsert = (row) => `INSERT INTO issues(${COLS.join(",")}) VALUES(${COLS.map((col) => value(col, row)).join(",")}) ON CONFLICT(project,url) DO UPDATE SET ${KEPT};`;

export async function readIssues(db, projects) {
  if (!projects.length) return { rows: [], boards: [] };
  const ids = projects.map((p) => q(p)).join(",");
  const [rows, boards] = await Promise.all([
    db.read(`SELECT * FROM issues WHERE project IN (${ids});`),
    db.read(`SELECT * FROM issue_boards WHERE project IN (${ids});`),
  ]);
  return { rows, boards };
}

export function boardSql({ project, source, filter, who, repo, columns, total = null, failure, now }) {
  const failed = failure ? q(JSON.stringify(failure)) : "NULL";
  const readAt = failure ? "NULL" : num(now);
  const retry = failure?.retryAt ? num(failure.retryAt) : "NULL";
  return `INSERT INTO issue_boards(project,source,filter,who,repo,columns,total,read_at,retry_at,failure) VALUES(${q(project)},${q(source)},${q(filter)},${q(who ?? null)},${q(repo ?? null)},${q(JSON.stringify(columns ?? []))},${num(total)},${readAt},${retry},${failed}) `
    + `ON CONFLICT(project,source) DO UPDATE SET filter=excluded.filter,${failure ? "" : "who=excluded.who,repo=excluded.repo,columns=excluded.columns,total=excluded.total,read_at=excluded.read_at,"}retry_at=excluded.retry_at,failure=excluded.failure;`;
}

export function storeSql({ project, source, filter, who, repo, rows, columns, total = null, failure, complete = true, kept = [], now }) {
  if (failure) return `BEGIN;${rows.map(upsert).join("")}${boardSql({ project, source, filter, who, repo, columns, failure, now })}COMMIT;`;
  const urls = new Set(rows.map((row) => row.url));
  const gone = complete ? kept.filter((row) => row.project === project && row.source === source && !urls.has(row.url) && matches(row, filter, who)).map((row) => q(row.url)) : [];
  const drop = gone.length ? `DELETE FROM issues WHERE project=${q(project)} AND url IN (${gone.join(",")});` : "";
  return `BEGIN;${rows.map(upsert).join("")}${drop}${boardSql({ project, source, filter, who, repo, columns, total, failure: null, now })}COMMIT;`;
}

export const detailSql = (project, url, { body, comments, prs }) => `UPDATE issues SET body=${q(body)},comments=${q(comments)},prs=${q(prs)} WHERE project=${q(project)} AND url=${q(url)};`;
