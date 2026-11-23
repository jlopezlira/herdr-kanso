import { parseOr } from "./pure.js";
import { parseRemote, rateFrom } from "./pr-remote.js";
import { probe, firstLine, ask } from "./pr-github.js";
import { storeSql, detailSql } from "./issues-store.js";

const STATUS = `projectItems(first:5){nodes{project{number title field(name:"Status"){... on ProjectV2SingleSelectField{options{name}}}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}`;
const ISSUE = (withStatus) => `number title url body createdAt updatedAt author{login} assignees(first:10){nodes{login}} labels(first:10){nodes{name}} ${withStatus ? STATUS : ""}`;
export const PAGES = 10;
export const listQuery = (withStatus) => `query($owner:String!,$name:String!,$assignee:String,$author:String,$after:String){repository(owner:$owner,name:$name){issues(first:100,after:$after,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC},filterBy:{assignee:$assignee,createdBy:$author}){totalCount pageInfo{hasNextPage endCursor} nodes{${ISSUE(withStatus)}}}}}`;
export const DETAIL = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){body comments(last:20){nodes{author{login} body createdAt}} closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number title url state}}}}}";

const OFFLINE = /could not resolve host|network is unreachable|connection refused|no such host|timeout|dial tcp|i\/o timeout/i;
const NO_SCOPE = /INSUFFICIENT_SCOPES|read:project|required scopes/i;

export function remoteOf(text, hosts) {
  const known = new Set((hosts ?? []).map((h) => String(h?.host ?? h).toLowerCase()));
  const remotes = String(text ?? "").split("\n").map((line) => line.trim().split(/\s+/)).filter(([name, url]) => name && url)
    .map(([name, url]) => ({ name, repo: parseRemote(url) })).filter(({ repo }) => repo && known.has(repo.host));
  return (remotes.find((r) => r.name === "origin") ?? remotes[0])?.repo ?? null;
}

export async function repoOf(run, folder, hosts = ["github.com"]) {
  const r = await run("git", ["-C", folder, "remote", "-v"]);
  return r?.code === 0 ? remoteOf(r.stdout, hosts) : null;
}

const vars = (pairs) => Object.entries(pairs).flatMap(([k, v]) => (v === null || v === undefined ? [] : [typeof v === "number" ? "-F" : "-f", `${k}=${v}`]));
const graphql = (run, repo, query, extra) => ask(run, repo.host, ["api", "graphql", "-f", `query=${query}`, ...vars({ owner: repo.owner, name: repo.name, ...extra })]);

const filterVars = (filter, login) => ({ assignee: filter === "assigned" ? login : null, author: filter === "created" ? login : null });

export function boardOf(nodes) {
  const items = nodes.flatMap((n) => n.projectItems?.nodes ?? []).filter((item) => item?.project);
  const first = items[0]?.project;
  return first ? (first.field?.options ?? []).map((option) => option.name) : [];
}

export function rowsOf(nodes, repo, project, now) {
  return nodes.map((n) => ({
    url: n.url,
    source: "github",
    project,
    ticket: `#${n.number}`,
    number: n.number,
    repo: `${repo.owner}/${repo.name}`,
    title: n.title ?? "",
    status: n.projectItems?.nodes?.find((item) => item?.fieldValueByName?.name)?.fieldValueByName.name ?? null,
    labels: JSON.stringify((n.labels?.nodes ?? []).map((l) => l.name)),
    assignees: JSON.stringify((n.assignees?.nodes ?? []).map((a) => a.login)),
    author: n.author?.login ?? null,
    created_at: n.createdAt ?? null,
    updated_at: n.updatedAt ?? null,
    body: n.body ?? "",
    read_at: now,
  }));
}

const failure = (r, now) => {
  const rate = rateFrom(r, now);
  if (rate) return { kind: "rate", text: rate.error, retryAt: rate.retryAt };
  const said = firstLine(r);
  if (OFFLINE.test(`${r?.stderr ?? ""}${r?.stdout ?? ""}`)) return { kind: "offline", text: "GitHub can't be reached", source: said };
  return { kind: "error", text: "GitHub could not be read", source: said };
};

async function readPages(run, repo, withStatus, extra) {
  const walk = async (after, nodes, page) => {
    const r = await graphql(run, repo, listQuery(withStatus), { ...extra, after });
    if (r?.code !== 0) return { r, nodes, complete: false };
    const issues = parseOr(r.stdout, null)?.data?.repository?.issues;
    if (!Array.isArray(issues?.nodes)) return { r: { ...r, code: 1 }, nodes, complete: false };
    const all = [...nodes, ...issues.nodes], total = issues.totalCount ?? all.length;
    if (!issues.pageInfo?.hasNextPage) return { r, nodes: all, complete: true, total };
    return page + 1 < PAGES ? walk(issues.pageInfo.endCursor, all, page + 1) : { r, nodes: all, complete: false, total };
  };
  return walk(null, [], 0);
}

export async function readBoard(run, { repo, project, filter, login, now = Date.now() }) {
  const full = await readPages(run, repo, true, filterVars(filter, login));
  const scoped = full.r?.code !== 0 && NO_SCOPE.test(`${full.r?.stderr ?? ""}${full.r?.stdout ?? ""}`);
  const read = scoped ? await readPages(run, repo, false, filterVars(filter, login)) : full;
  const failed = read.r?.code !== 0 ? failure(read.r, now) : null;
  return { rows: rowsOf(read.nodes, repo, project, now), columns: boardOf(read.nodes), failure: failed, complete: read.complete, total: read.total ?? read.nodes.length, noProjects: scoped };
}

export async function syncBoard(db, run, { repo, project, filter, login, kept, now = Date.now() }) {
  const board = await readBoard(run, { repo, project, filter, login, now });
  await db.run(storeSql({ project, source: "github", filter, who: login, repo: `${repo.host}/${repo.owner}/${repo.name}`, ...board, kept, now }));
  return board;
}

export async function readDetail(run, { repo, number }) {
  const r = await graphql(run, repo, DETAIL, { number });
  const issue = r?.code === 0 ? parseOr(r.stdout, null)?.data?.repository?.issue : null;
  if (!issue) return null;
  return {
    body: issue.body ?? "",
    comments: JSON.stringify((issue.comments?.nodes ?? []).map((c) => ({ author: c.author?.login ?? "", body: c.body ?? "", at: c.createdAt ?? null }))),
    prs: JSON.stringify((issue.closedByPullRequestsReferences?.nodes ?? []).map((p) => ({ number: p.number, title: p.title, url: p.url, state: p.state }))),
  };
}

export async function syncDetail(db, run, { repo, project, url, number }) {
  const detail = await readDetail(run, { repo, number });
  if (detail) await db.run(detailSql(project, url, detail));
  return detail;
}

export const repoText = (text) => {
  const [host, owner, ...name] = String(text ?? "").split("/");
  return host && owner && name.length ? { host, owner, name: name.join("/") } : null;
};

export const issuesGithub = { id: "github", probe, repoOf, readBoard, readDetail, syncBoard, syncDetail };
