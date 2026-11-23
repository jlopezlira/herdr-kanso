import { storeSql, detailSql } from "./issues-store.js";
import { readJiraBoard, readJiraDetail } from "./issues-jira.js";
import { readLinearBoard, readLinearDetail } from "./issues-linear.js";

const storeBoard = async (db, board, { project, source, filter, who, repo, kept, now }) => {
  await db.run(storeSql({ project, source, filter, who, repo, ...board, kept, now }));
  return board;
};

const storeDetail = async (db, issue, detail) => {
  if (detail) await db.run(detailSql(issue.project, issue.url, detail));
  return detail;
};

export const syncJiraBoard = async (db, client, { site, key, project, filter, who, kept, now = Date.now() }) =>
  storeBoard(db, await readJiraBoard(client, { site, key, project, filter, now }), { project, source: `jira:${key}`, filter, who, repo: site, kept, now });

export const syncLinearBoard = async (db, client, { team, project, filter, who, kept, now = Date.now() }) =>
  storeBoard(db, await readLinearBoard(client, { team, project, filter, now }), { project, source: `linear:${team}`, filter, who, repo: team, kept, now });

export const syncJiraDetail = async (db, client, issue) => storeDetail(db, issue, await readJiraDetail(client, issue.ticket));

export const syncLinearDetail = async (db, client, issue) => storeDetail(db, issue, await readLinearDetail(client, issue.repo));
