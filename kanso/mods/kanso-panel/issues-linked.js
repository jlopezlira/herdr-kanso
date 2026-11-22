import { storeSql, detailSql } from "./issues-store.js";
import { readJiraBoard, readJiraDetail } from "./issues-jira.js";
import { readLinearBoard, readLinearDetail } from "./issues-linear.js";

export async function syncJiraBoard(db, client, { site, key, project, filter, who, kept, now = Date.now() }) {
  const board = await readJiraBoard(client, { site, key, project, filter, now });
  await db.run(storeSql({ project, source: `jira:${key}`, filter, who, repo: site, ...board, kept, now }));
  return board;
}

export async function syncJiraDetail(db, client, issue) {
  const detail = await readJiraDetail(client, issue.ticket);
  if (detail) await db.run(detailSql(issue.project, issue.url, detail));
  return detail;
}

export async function syncLinearBoard(db, client, { team, project, filter, who, kept, now = Date.now() }) {
  const board = await readLinearBoard(client, { team, project, filter, now });
  await db.run(storeSql({ project, source: `linear:${team}`, filter, who, repo: team, ...board, kept, now }));
  return board;
}

export async function syncLinearDetail(db, client, issue) {
  const detail = await readLinearDetail(client, issue.repo);
  if (detail) await db.run(detailSql(issue.project, issue.url, detail));
  return detail;
}
