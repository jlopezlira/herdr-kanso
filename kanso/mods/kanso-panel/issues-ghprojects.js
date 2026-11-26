import { parseOr } from "./pure.js";
import { ask, firstLine } from "./pr-github.js";
import { storeSql } from "./issues-store.js";
import { stampsOf } from "./issues-model.js";
import { PAGES, NO_SCOPE, vars, failure } from "./issues-github.js";

export const GH_PROJECT = "ghproject";
export const NEEDS_SCOPE = { kind: "no scope", text: "GitHub Projects needs permission to read your projects" };
const LIST = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:50){nodes{id title closed}} owner{... on ProjectV2Owner{projectsV2(first:50){nodes{id title closed}}}}}}";
const CONTENT = "number title url body createdAt updatedAt author{login} assignees(first:10){nodes{login}} labels(first:10){nodes{name}} repository{nameWithOwner}";
export const ITEMS = `query($id:ID!,$after:String){node(id:$id){... on ProjectV2{url field(name:"Status"){... on ProjectV2SingleSelectField{options{name}}} items(first:100,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{id databaseId fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{__typename ... on Issue{${CONTENT}} ... on PullRequest{${CONTENT}} ... on DraftIssue{title body createdAt updatedAt creator{login} assignees(first:10){nodes{login}}}}}}}}}`;

const graphql = (run, host, query, pairs) => ask(run, host, ["api", "graphql", "-f", `query=${query}`, ...vars(pairs)]);
const scoped = (r) => NO_SCOPE.test(`${r?.stderr ?? ""}${r?.stdout ?? ""}`);

export async function listProjects(run, repo) {
  const r = await graphql(run, repo.host, LIST, { owner: repo.owner, name: repo.name });
  const found = r?.code === 0 ? parseOr(r.stdout, null)?.data?.repository : null;
  if (!found) return { failure: scoped(r) ? NEEDS_SCOPE : { text: "GitHub Projects could not be read", source: firstLine(r) } };
  const all = [...(found.projectsV2?.nodes ?? []), ...(found.owner?.projectsV2?.nodes ?? [])].filter((p) => p?.id && !p.closed);
  return { list: all.filter((p, i) => all.findIndex((q) => q.id === p.id) === i).map((p) => ({ ref: p.id, name: p.title ?? "" })), complete: true, next: null };
}

const TICKETS = { DraftIssue: () => "Draft", PullRequest: (c) => `PR #${c.number}`, Issue: (c) => `#${c.number}` };
export const isIssueItem = (row) => /^#\d+$/.test(String(row?.ticket ?? ""));

export function itemRows(nodes, project, source, now, board = "") {
  return nodes.filter((n) => n?.content?.title !== undefined && TICKETS[n.content.__typename]).map((n) => {
    const c = n.content, draft = c.__typename === "DraftIssue";
    return {
      url: `${board}?pane=issue&itemId=${n.databaseId ?? n.id}`, source, project,
      ticket: TICKETS[c.__typename](c), number: draft ? null : c.number, repo: draft ? null : c.repository?.nameWithOwner ?? null,
      title: c.title ?? "", status: n.fieldValueByName?.name ?? null, priority: null,
      labels: JSON.stringify((c.labels?.nodes ?? []).map((l) => l.name)),
      assignees: JSON.stringify((c.assignees?.nodes ?? []).map((a) => a.login)),
      author: (draft ? c.creator : c.author)?.login ?? null,
      ...stampsOf(c), body: c.body ?? "", read_at: now,
    };
  });
}

async function readItems(run, host, ref) {
  const walk = async (after, nodes, page, kept) => {
    const r = await graphql(run, host, ITEMS, { id: ref, after });
    const found = r?.code === 0 ? parseOr(r.stdout, null)?.data?.node : null;
    if (!Array.isArray(found?.items?.nodes)) return { ...kept, r: { ...r, code: r?.code || 1 }, nodes, complete: false };
    const all = [...nodes, ...found.items.nodes];
    const read = { columns: (found.field?.options ?? []).map((o) => o.name), board: found.url ?? kept.board, total: found.items.totalCount ?? all.length };
    if (!found.items.pageInfo?.hasNextPage) return { ...read, r, nodes: all, complete: true };
    return page + 1 < PAGES ? walk(found.items.pageInfo.endCursor, all, page + 1, read) : { ...read, r, nodes: all, complete: false };
  };
  return walk(null, [], 0, { columns: [], board: "" });
}

export async function readProjectBoard(run, { host, ref, project, now = Date.now() }) {
  const source = `${GH_PROJECT}:${ref}`;
  const read = await readItems(run, host, ref);
  const failed = read.r?.code !== 0 ? (scoped(read.r) ? NEEDS_SCOPE : failure(read.r, now)) : null;
  return { rows: itemRows(read.nodes, project, source, now, read.board), columns: read.columns ?? [], failure: failed, complete: read.complete, total: read.complete ? null : read.total ?? read.nodes.length };
}

export async function syncProjectBoard(db, run, { host, ref, project, filter, login, kept, now = Date.now() }) {
  const board = await readProjectBoard(run, { host, ref, project, now });
  await db.run(storeSql({ project, source: `${GH_PROJECT}:${ref}`, filter, who: login, repo: ref, ...board, kept, now }));
  return board;
}
