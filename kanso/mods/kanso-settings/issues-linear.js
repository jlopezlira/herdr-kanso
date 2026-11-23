import { parseOr } from "./pure.js";
import { stampsOf, pagesOf, PICKER_PAGES } from "./issues-model.js";

export const LINEAR = "kanso-linear";
export const LINEAR_ACCOUNT = "api.linear.app";
const LINEAR_URL = "https://api.linear.app/graphql";

const PAGE = "pageInfo{hasNextPage endCursor}";
const ME = "query{viewer{id name email}}";
const TEAMS = `query($after:String){teams(first:100,after:$after){${PAGE} nodes{id key name}}}`;
const STATES = "query($team:String!){team(id:$team){states(first:100){nodes{name position type}}}}";
const ISSUES = `query($filter:IssueFilter,$after:String){issues(first:100,after:$after,filter:$filter,orderBy:updatedAt){${PAGE} nodes{id identifier title url priorityLabel createdAt updatedAt description state{name} labels{nodes{name}} assignee{id} creator{id}}}}`;
const DETAIL = "query($id:String!){issue(id:$id){description comments(first:20){nodes{body createdAt user{name}}}}}";

export const issueFilter = (team, filter) => ({
  team: { id: { eq: team } },
  state: { type: { nin: ["completed", "canceled"] } },
  ...(filter === "assigned" ? { assignee: { isMe: { eq: true } } } : filter === "created" ? { creator: { isMe: { eq: true } } } : {}),
});

const failureOf = (r, data) => {
  if (r.signedOut) return { kind: "signed out", text: "Sign in to Linear in Settings to see these tickets" };
  if (r.status === 401 || r.status === 403 || /authentication/i.test(data?.errors?.[0]?.message ?? "")) return { kind: "signed out", text: "Linear did not accept your key", fix: "Reconnect" };
  if (r.status === 429 || /ratelimit/i.test(data?.errors?.[0]?.extensions?.code ?? "")) return { kind: "rate", text: "Linear is limiting requests", retryAt: Date.now() + 60_000 };
  if (!r.status) return { kind: "offline", text: "Linear can't be reached", source: r.error };
  return { kind: "error", text: "Linear could not be read", source: data?.errors?.[0]?.message ?? `HTTP ${r.status}` };
};

export function linearClient(secrets) {
  const ask = async (query, variables = {}) => {
    const r = await secrets.request({ service: LINEAR, account: LINEAR_ACCOUNT, auth: "raw", method: "POST", body: JSON.stringify({ query, variables }), url: LINEAR_URL });
    const out = parseOr(r.text, null);
    return r.status === 200 && out?.data && !out.errors?.length ? { data: out.data, failure: null } : { data: null, failure: failureOf(r, out) };
  };
  const paged = (query, variables, pick, pages) => pagesOf(async (after) => {
    const { data, failure } = await ask(query, { ...variables, after });
    if (failure) return { failure };
    const page = pick(data);
    return { items: page?.nodes ?? [], next: page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null };
  }, pages);
  return {
    me: async () => {
      const { data, failure } = await ask(ME);
      return failure ? { failure } : { name: data.viewer?.name ?? data.viewer?.email ?? "", email: data.viewer?.email ?? null, id: data.viewer?.id ?? null };
    },
    projects: async () => {
      const read = await paged(TEAMS, {}, (data) => data.teams, PICKER_PAGES);
      return { failure: read.failure, complete: read.complete, list: read.items.map((t) => ({ ref: t.id, name: `${t.key} · ${t.name}` })) };
    },
    states: async (team) => (await ask(STATES, { team })).data?.team?.states?.nodes ?? [],
    issues: (team, filter) => paged(ISSUES, { filter: issueFilter(team, filter) }, (data) => data.issues),
    detail: async (id) => ask(DETAIL, { id }),
  };
}

export function rowsOf(nodes, { team, project, now }) {
  return nodes.map((n) => ({
    url: n.url,
    source: `linear:${team}`,
    project,
    ticket: n.identifier,
    number: null,
    repo: n.id,
    title: n.title ?? "",
    status: n.state?.name ?? null,
    priority: n.priorityLabel ?? null,
    labels: JSON.stringify((n.labels?.nodes ?? []).map((l) => l.name)),
    assignees: JSON.stringify(n.assignee?.id ? [n.assignee.id] : []),
    author: n.creator?.id ?? null,
    ...stampsOf(n),
    body: n.description ?? "",
    read_at: now,
  }));
}

export async function readLinearBoard(client, { ref, project, filter, now = Date.now() }) {
  const read = await client.issues(ref, filter);
  const states = read.failure && !read.items.length ? [] : await client.states(ref);
  const columns = states.toSorted((a, b) => a.position - b.position).map((s) => s.name);
  return { rows: rowsOf(read.items, { team: ref, project, now }), columns, failure: read.failure, complete: read.complete };
}

export async function readLinearDetail(client, id) {
  const { data } = await client.detail(id);
  const issue = data?.issue;
  if (!issue) return null;
  const comments = (issue.comments?.nodes ?? []).map((c) => ({ author: c.user?.name ?? "", body: c.body ?? "", at: c.createdAt ?? null }));
  return { body: issue.description ?? "", comments: JSON.stringify(comments), prs: "[]" };
}

