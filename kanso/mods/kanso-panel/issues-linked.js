import { storeSql, detailSql } from "./issues-store.js";
import { jiraClient, readJiraBoard, readJiraDetail, refParts } from "./issues-jira.js";
import { linearClient, readLinearBoard, readLinearDetail } from "./issues-linear.js";

const storeBoard = async (db, board, { project, source, filter, who, repo, kept, now }) => {
  await db.run(storeSql({ project, source, filter, who, repo, ...board, kept, now }));
  return board;
};

const storeDetail = async (db, issue, detail) => {
  if (detail) await db.run(detailSql(issue.project, issue.url, detail));
  return detail;
};

export const LINKED = {
  jira: {
    things: "projects",
    account: (kept) => (kept?.jira?.site ? kept.jira : null),
    client: (secrets, account) => jiraClient(secrets, account),
    who: (account) => account.accountId ?? null,
    owns: (ref, account) => refParts(ref).site === account.site,
    other: (ref) => `Signed in to another Jira site. Sign in to ${refParts(ref).site} to see these tickets`,
    readBoard: readJiraBoard,
    readDetail: (client, issue) => readJiraDetail(client, issue.ticket),
  },
  linear: {
    things: "teams",
    account: (kept) => (kept?.linear?.name ? kept.linear : null),
    client: (secrets) => linearClient(secrets),
    who: (account) => account.id ?? null,
    owns: () => true,
    other: () => "",
    readBoard: readLinearBoard,
    readDetail: (client, issue) => readLinearDetail(client, issue.repo),
  },
};

export const linkedOf = (kind) => (Object.hasOwn(LINKED, kind) ? LINKED[kind] : null);

export const syncLinkedBoard = async (db, provider, client, { kind, ref, project, filter, who, kept, now = Date.now() }) =>
  storeBoard(db, await provider.readBoard(client, { ref, project, filter, now }), { project, source: `${kind}:${ref}`, filter, who, repo: ref, kept, now });

export const syncLinkedDetail = async (db, provider, client, issue) => storeDetail(db, issue, await provider.readDetail(client, issue));
