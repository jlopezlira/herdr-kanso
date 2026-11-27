import { exec } from "herdr";
import { prRow, pendingByRepo, monthsIn } from "./shipped-store.js";
import { mapSeries } from "./pure.js";

const PAGES = 10;
const HISTORY_PAGES = 20;
const SEARCH_CAP = 1000;
const STALE_MS = 7 * 86400000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

const PR_FIELDS = "... on PullRequest{url number createdAt mergedAt closedAt baseRefName mergeCommit{oid} repository{nameWithOwner owner{login} defaultBranchRef{name}}}";
export const SEARCH = `query($q:String!,$after:String){search(query:$q,type:ISSUE,first:100,after:$after){issueCount pageInfo{hasNextPage endCursor} nodes{${PR_FIELDS}}}}`;
export const HISTORY = "query($owner:String!,$name:String!,$ref:String!,$since:GitTimestamp!,$until:GitTimestamp!,$after:String){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{history(first:100,since:$since,until:$until,after:$after){pageInfo{hasNextPage endCursor} nodes{oid}}}}}}}";
const authored = (field) => (login) => (start, end) => `is:pr author:${login} ${field}:${iso(start)}..${iso(end - 1000)}`;
export const createdIn = authored("created");
export const mergedIn = authored("merged");
export const updatedIn = authored("updated");

export async function gh(args) {
  const r = await exec("gh", args);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || "GitHub could not be read.");
  return r.stdout;
}

export async function gql(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => (v !== null && v !== undefined ? ["-f", `${k}=${v}`] : []))];
  const out = JSON.parse(await gh(args));
  if (!out.data) throw new Error(out.errors?.[0]?.message ?? "GitHub could not be read.");
  return out.data;
}

export async function searchPrs(q, read = gql, after = null, got = [], page = 0) {
  const s = (await read(SEARCH, { q, after })).search;
  const all = [...got, ...(s.nodes ?? []).filter((n) => n?.url).map((n) => prRow(n))];
  return s.pageInfo.hasNextPage && page + 1 < PAGES ? searchPrs(q, read, s.pageInfo.endCursor, all, page + 1) : { rows: all, count: s.issueCount };
}

export async function prsIn(query, start, end, read = gql) {
  const found = await searchPrs(query(start, end), read);
  if (found.count <= SEARCH_CAP || end - start < 2 * 3600000) return found.rows;
  const mid = start + Math.floor((end - start) / 2);
  return [...await prsIn(query, start, mid, read), ...await prsIn(query, mid, end, read)];
}

export const prsCreated = (login, start, end, read = gql) => prsIn(createdIn(login), start, end, read);

export async function inMain(pending, read = gql) {
  const found = await mapSeries(pending, async ({ repo, main, since, until, oids }) => {
    const [owner, name] = repo.split("/");
    const walk = async (after, hits, page) => {
      const h = (await read(HISTORY, { owner, name, ref: `refs/heads/${main}`, since: iso(since), until: iso(until), after })).repository?.ref?.target?.history;
      if (!h) return { hits, unchecked: oids.size - hits.length };
      const more = [...hits, ...h.nodes.filter((n) => oids.has(n.oid)).map((n) => oids.get(n.oid))];
      if (more.length === oids.size || !h.pageInfo.hasNextPage) return { hits: more, unchecked: 0 };
      return page + 1 < HISTORY_PAGES ? walk(h.pageInfo.endCursor, more, page + 1) : { hits: more, unchecked: oids.size - more.length };
    };
    return walk(null, [], 0).catch(() => ({ hits: [], unchecked: oids.size }));
  });
  return { urls: found.flatMap((f) => f.hits), unchecked: found.reduce((n, f) => n + f.unchecked, 0) };
}

export const github = {
  provider: "github",
  name: "GitHub",
  async sync(store, { from, now, login, verify = async () => {}, force = false, every = 0, progress = () => {} }) {
    await store.forAccount("github", login);
    const done = await store.readMonths("github");
    const since = Number(await store.meta("github.updated")) || 0;
    const fresh = since && now - since < STALE_MS;
    const waiting = (await store.prs()).filter((p) => p.provider === "github" && !p.merged && !p.closed).map((p) => p.created);
    const back = since ? Math.min(since, ...waiting) : from;
    const due = monthsIn(Math.min(from, fresh ? from : back), now + 1).filter((m) => !done.has(m.month) || (!fresh && m.end > back));
    const keep = async (rows) => { await verify(); await store.save(rows, login); };
    const read = (months) => mapSeries(months, async (m, i) => {
      progress(`pull requests, ${months.length - i} ${months.length - i === 1 ? "month" : "months"} to go`);
      const end = Math.min(m.end, now + 1000);
      await keep([...await prsCreated(login, m.start, end), ...await prsIn(mergedIn(login), m.start, end)]);
      await store.monthRead("github", m.month, now, login);
    });
    const merged = await store.meta("github.merged");
    const startOf = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).getTime();
    const backfill = merged || !done.size ? [] : monthsIn(Math.min(...[...done].map(startOf)), now + 1).filter((m) => done.has(m.month) && !due.some((d) => d.month === m.month));
    await read(due);
    if (backfill.length) progress("merged pull requests");
    await mapSeries(backfill, async (m) => keep(await prsIn(mergedIn(login), m.start, Math.min(m.end, now + 1000))));
    if (!merged) await store.setOwnMeta("github.merged", "1", login);
    if (since && !force && now - since < every) return { unchecked: Number(await store.meta("github.unchecked")) || 0 };
    if (since) await keep(await prsIn(updatedIn(login), since - 3600000, now + 1000));
    else await verify();
    await store.setOwnMeta("github.updated", String(now), login);
    progress("what reached production");
    const prod = await inMain(pendingByRepo(await store.prs()));
    await store.markProd(prod.urls, login);
    await store.setOwnMeta("github.unchecked", String(prod.unchecked), login);
    return { unchecked: prod.unchecked };
  },
};
