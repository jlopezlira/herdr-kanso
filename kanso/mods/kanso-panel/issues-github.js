import { parseOr } from "./pure.js";
import { parseRemote, rateFrom } from "./pr-remote.js";
import { probe, firstLine, ask } from "./pr-github.js";

const STATUS = `projectItems(first:5){nodes{project{number title field(name:"Status"){... on ProjectV2SingleSelectField{options{name}}}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}`;
const ISSUE = (withStatus) => `number title url body createdAt updatedAt author{login} assignees(first:10){nodes{login}} labels(first:10){nodes{name}} ${withStatus ? STATUS : ""}`;
export const listQuery = (withStatus) => `query($owner:String!,$name:String!,$assignee:String,$author:String){repository(owner:$owner,name:$name){issues(first:100,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC},filterBy:{assignee:$assignee,createdBy:$author}){nodes{${ISSUE(withStatus)}}}}}`;
export const DETAIL = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){body comments(last:20){nodes{author{login} body createdAt}} closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number title url state}}}}}";

const OFFLINE = /could not resolve host|network is unreachable|connection refused|no such host|timeout|dial tcp|i\/o timeout/i;
const NO_SCOPE = /INSUFFICIENT_SCOPES|read:project|required scopes/i;

export async function repoOf(run, folder) {
  const r = await run("git", ["-C", folder, "remote", "get-url", "origin"]);
  return r?.code === 0 ? parseRemote(r.stdout.trim()) : null;
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

export async function readBoard(run, { repo, project, filter, login, now = Date.now() }) {
  const read = (withStatus) => graphql(run, repo, listQuery(withStatus), filterVars(filter, login));
  const full = await read(true);
  const scoped = full?.code !== 0 && NO_SCOPE.test(`${full?.stderr ?? ""}${full?.stdout ?? ""}`);
  const r = scoped ? await read(false) : full;
  if (r?.code !== 0) return { rows: [], columns: [], failure: failure(r, now) };
  const data = parseOr(r.stdout, null)?.data;
  const nodes = data?.repository?.issues?.nodes;
  if (!Array.isArray(nodes)) return { rows: [], columns: [], failure: { kind: "error", text: "GitHub could not be read", source: firstLine(r) } };
  return { rows: rowsOf(nodes, repo, project, now), columns: boardOf(nodes), failure: null, noProjects: scoped };
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

export const issuesGithub = { id: "github", probe, repoOf, readBoard, readDetail };
