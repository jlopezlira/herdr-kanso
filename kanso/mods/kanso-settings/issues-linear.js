import { parseOr } from "./pure.js";
import { stampsOf } from "./issues-model.js";

export const LINEAR = "kanso-linear";
export const LINEAR_ACCOUNT = "api.linear.app";
const LINEAR_URL = "https://api.linear.app/graphql";

const ME = "query{viewer{id name email}}";
const TEAMS = "query{teams(first:100){nodes{id key name}}}";
const STATES = "query($team:String!){team(id:$team){states{nodes{name position type}}}}";
const ISSUES = "query($filter:IssueFilter){issues(first:100,filter:$filter,orderBy:updatedAt){nodes{id identifier title url priorityLabel createdAt updatedAt description state{name} labels{nodes{name}} assignee{email name} creator{email name}}}}";
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
  return {
    me: async () => {
      const { data, failure } = await ask(ME);
      return failure ? { failure } : { name: data.viewer?.name ?? data.viewer?.email ?? "", email: data.viewer?.email ?? null };
    },
    projects: async () => {
      const { data, failure } = await ask(TEAMS);
      return failure ? { failure, list: [] } : { list: (data.teams?.nodes ?? []).map((t) => ({ ref: t.id, name: `${t.key} · ${t.name}` })) };
    },
    states: async (team) => (await ask(STATES, { team })).data?.team?.states?.nodes ?? [],
    issues: async (team, filter) => ask(ISSUES, { filter: issueFilter(team, filter) }),
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
    assignees: JSON.stringify(n.assignee ? [n.assignee.email ?? n.assignee.name] : []),
    author: n.creator?.email ?? n.creator?.name ?? null,
    ...stampsOf(n),
    body: n.description ?? "",
    read_at: now,
  }));
}

export async function readLinearBoard(client, { team, project, filter, now = Date.now() }) {
  const { data, failure } = await client.issues(team, filter);
  if (failure) return { rows: [], columns: [], failure };
  const states = await client.states(team);
  const columns = states.toSorted((a, b) => a.position - b.position).map((s) => s.name);
  return { rows: rowsOf(data.issues?.nodes ?? [], { team, project, now }), columns, failure: null };
}

export async function readLinearDetail(client, id) {
  const { data } = await client.detail(id);
  const issue = data?.issue;
  if (!issue) return null;
  const comments = (issue.comments?.nodes ?? []).map((c) => ({ author: c.user?.name ?? "", body: c.body ?? "", at: c.createdAt ?? null }));
  return { body: issue.description ?? "", comments: JSON.stringify(comments), prs: "[]" };
}

