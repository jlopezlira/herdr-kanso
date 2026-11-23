import { parseOr } from "./pure.js";
import { pagesOf, PICKER_PAGES } from "./issues-model.js";

export const JIRA = "kanso-jira";
const FIELDS = ["summary", "status", "priority", "created", "updated", "assignee", "reporter", "labels", "description"];

export const siteOf = (text) => {
  const host = String(text ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.atlassian\.net$/.test(host) ? host : null;
};

export const jiraRef = (site, key) => `${site}/${key}`;
export const refParts = (ref) => {
  const cut = String(ref ?? "").lastIndexOf("/");
  return { site: String(ref).slice(0, cut), key: String(ref).slice(cut + 1) };
};

const filterJql = (filter) => (filter === "assigned" ? " AND assignee = currentUser()" : filter === "created" ? " AND reporter = currentUser()" : "");
export const jqlOf = (key, filter) => `project = "${String(key).replace(/"/g, "")}" AND statusCategory != Done${filterJql(filter)} ORDER BY updated DESC`;

const textOf = (node) => {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(textOf).join(node.type === "doc" || node.type === "bulletList" || node.type === "orderedList" ? "\n" : "");
  return node.type === "paragraph" || node.type === "heading" ? `${inner}\n` : node.type === "listItem" ? `- ${inner}` : inner;
};
export const adfText = (doc) => textOf(doc).replace(/\n{3,}/g, "\n\n").trim();

const failureOf = (r) => {
  if (r.signedOut) return { kind: "signed out", text: "Sign in to Jira in Settings to see these tickets" };
  if (r.status === 401 || r.status === 403) return { kind: "signed out", text: "Jira did not accept your credentials", fix: "Reconnect" };
  if (r.status === 429) return { kind: "rate", text: "Jira is limiting requests", retryAt: Date.now() + 60_000 };
  if (!r.status) return { kind: "offline", text: "Jira can't be reached", source: r.error };
  return { kind: "error", text: "Jira could not be read", source: `HTTP ${r.status}` };
};

export function jiraClient(secrets, { site, email }) {
  const ask = async (path, { method = "GET", body = null } = {}) => {
    const r = await secrets.request({ service: JIRA, account: site, auth: "basic", email, method, body: body ? JSON.stringify(body) : "", url: `https://${site}${path}` });
    return r.status >= 200 && r.status < 300 ? { data: parseOr(r.text, null), failure: null } : { data: null, failure: failureOf(r) };
  };
  return {
    site,
    me: async () => {
      const { data, failure } = await ask("/rest/api/3/myself");
      return failure ? { failure } : { name: data?.displayName ?? data?.emailAddress ?? email, accountId: data?.accountId ?? null };
    },
    projects: async (start = null) => {
      const read = await pagesOf(async (at) => {
        const { data, failure } = await ask(`/rest/api/3/project/search?maxResults=100&startAt=${at ?? 0}`);
        if (failure) return { failure };
        const values = data?.values ?? [];
        return { items: values, next: data?.isLast || !values.length ? null : (at ?? 0) + values.length };
      }, PICKER_PAGES, start);
      return { failure: read.failure, complete: read.complete, next: read.next, list: read.items.map((p) => ({ ref: jiraRef(site, p.key), name: `${p.key} · ${p.name}` })) };
    },
    board: async (key) => {
      const boards = await ask(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}`);
      const id = boards.data?.values?.[0]?.id;
      if (!id) return { columns: [], statusColumn: {} };
      const config = await ask(`/rest/agile/1.0/board/${id}/configuration`);
      const columns = config.data?.columnConfig?.columns ?? [];
      return { columns: columns.map((c) => c.name), statusColumn: Object.fromEntries(columns.flatMap((c) => (c.statuses ?? []).map((s) => [String(s.id), c.name]))) };
    },
    issues: (key, filter) => pagesOf(async (token) => {
      const { data, failure } = await ask("/rest/api/3/search/jql", { method: "POST", body: { jql: jqlOf(key, filter), fields: FIELDS, maxResults: 100, ...(token ? { nextPageToken: token } : {}) } });
      if (failure) return { failure };
      return { items: data?.issues ?? [], next: data?.isLast === false && data?.nextPageToken ? data.nextPageToken : null };
    }),
    detail: async (ticket) => ask(`/rest/api/3/issue/${encodeURIComponent(ticket)}?fields=description,comment`),
  };
}

export function rowsOf(issues, { site, key, project, statusColumn, now }) {
  const ref = jiraRef(site, key);
  return issues.map((i) => ({
    url: `https://${site}/browse/${i.key}`,
    source: `jira:${ref}`,
    project,
    ticket: i.key,
    number: null,
    repo: key,
    title: i.fields?.summary ?? "",
    status: statusColumn[String(i.fields?.status?.id)] ?? i.fields?.status?.name ?? null,
    priority: i.fields?.priority?.name ?? null,
    labels: JSON.stringify(i.fields?.labels ?? []),
    assignees: JSON.stringify(i.fields?.assignee?.accountId ? [i.fields.assignee.accountId] : []),
    author: i.fields?.reporter?.accountId ?? null,
    created_at: i.fields?.created ?? null,
    updated_at: i.fields?.updated ?? null,
    body: adfText(i.fields?.description),
    read_at: now,
  }));
}

export async function readJiraBoard(client, { ref, project, filter, now = Date.now() }) {
  const { site, key } = refParts(ref);
  const read = await client.issues(key, filter);
  const { columns, statusColumn } = read.failure && !read.items.length ? { columns: [], statusColumn: {} } : await client.board(key);
  return { rows: rowsOf(read.items, { site, key, project, statusColumn, now }), columns, failure: read.failure, complete: read.complete };
}

export async function readJiraDetail(client, ticket) {
  const { data } = await client.detail(ticket);
  if (!data) return null;
  const comments = (data.fields?.comment?.comments ?? []).map((c) => ({ author: c.author?.displayName ?? "", body: adfText(c.body), at: c.created ?? null }));
  return { body: adfText(data.fields?.description), comments: JSON.stringify(comments), prs: "[]" };
}

