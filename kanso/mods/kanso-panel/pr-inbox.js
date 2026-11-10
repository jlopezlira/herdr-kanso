// The inbox cache in kanso.db. Network stays in the provider; this file only reads and writes rows.
import { targetOf } from "./since-left-model.js";
import { SinceStore } from "./since-left-store.js";
import { checkState, onePerJob, checkSummary } from "./ghchecks.js";
import { q } from "./kdb.js";
import { matchRemote } from "./pr-providers.js";
import { fetchDue, isNew, limitLine, parsePullRequest, parseRemotes, projectSignature, publicUrl, repoId, SCAN_MS } from "./pr-remote.js";

const num = (x) => (x != null && Number.isFinite(Number(x)) ? String(Math.round(Number(x))) : "NULL");
const SCAN = "repos:scan";
const COLS = ["provider", "host", "owner", "name", "number", "title", "state", "draft", "author", "role", "head", "base", "review_decision", "additions", "deletions", "updated_at"];

export { fetchDue, isNew, limitLine };

// A row's words from reviewDecision. It cannot say ready: this cache does not know whether GitHub would merge.
export function inboxLabel(item) {
  if (item?.draft) return "Draft";
  if (item?.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
  if (item?.reviewDecision === "REVIEW_REQUIRED") return "Review required";
  if (item?.reviewDecision === "APPROVED") return "Approved";
  return "Open";
}

function valuesOf(item) {
  return {
    provider: q(item.provider), host: q(item.host), owner: q(item.owner), name: q(item.name), number: num(item.number),
    title: q(item.title), state: q(item.state ?? "OPEN"), draft: item.draft ? "1" : "0", author: q(item.author), role: q(item.role),
    head: q(item.head), base: q(item.base), review_decision: q(item.reviewDecision), additions: num(item.additions),
    deletions: num(item.deletions), updated_at: q(item.updatedAt),
  };
}

// A fetch leaves seen_at, so a newer updated_at still counts as new.
function itemSql(item, now) {
  const vals = valuesOf(item);
  const diff = COLS.map((c) => `pr_items.${c} IS NOT excluded.${c}`).join(" OR ");
  return `INSERT INTO pr_items(url,${COLS.join(",")},fetched_at,seen_at) VALUES(${q(item.url)},${COLS.map((c) => vals[c]).join(",")},${num(now)},NULL)
    ON CONFLICT(url) DO UPDATE SET ${COLS.map((c) => `${c}=excluded.${c}`).join(",")},fetched_at=excluded.fetched_at WHERE ${diff};`;
}

export function seenSql(url, now) {
  return `UPDATE pr_items SET seen_at=${num(now)} WHERE url=${q(url)};`;
}

function itemOf(row) {
  return {
    url: row.url, provider: row.provider, host: row.host, owner: row.owner, name: row.name, number: row.number, title: row.title,
    state: row.state, draft: Boolean(row.draft), author: row.author, role: row.role, head: row.head, base: row.base,
    reviewDecision: row.review_decision, additions: row.additions, deletions: row.deletions, updatedAt: row.updated_at,
    seenAt: row.seen_at, fetchedAt: row.fetched_at,
  };
}

function titles(projects) {
  const count = projects.reduce((acc, project) => ({ ...acc, [project.name]: (acc[project.name] ?? 0) + 1 }), {});
  return new Map(projects.map((project) => {
    const parent = String(project.folder ?? "").replace(/\/+$/, "").split("/").at(-2);
    return [project.id, count[project.name] > 1 && parent ? `${parent}/${project.name}` : project.name];
  }));
}

export function groupInbox(items, { repos = [], projects = [] } = {}) {
  const names = titles(projects);
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  const groups = items.reduce((acc, item) => {
    const id = repoId(item.provider, item.host, item.owner, item.name);
    const repo = byId.get(id);
    const key = repo?.project_id ?? id;
    const title = repo?.project_id ? (names.get(repo.project_id) ?? `${item.owner}/${item.name}`) : `${item.owner}/${item.name}`;
    const group = acc.find((row) => row.key === key) ?? { key, title, provider: item.provider, projectId: repo?.project_id ?? null, rows: [] };
    return [...acc.filter((row) => row.key !== key), { ...group, rows: [...group.rows, item] }];
  }, []);
  return groups.map((group) => ({
    ...group,
    rows: group.rows.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  })).toSorted((a, b) => a.title.localeCompare(b.title));
}

export async function readInbox(db, { provider, host, login }) {
  const items = (await db.read(`SELECT * FROM pr_items WHERE provider=${q(provider)} AND host=${q(host)};`)).map(itemOf);
  const repos = await db.read(`SELECT * FROM pr_repos WHERE provider=${q(provider)} AND host=${q(host)};`);
  const projects = await db.read("SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;");
  const fetch = (await db.read(`SELECT * FROM pr_fetches WHERE key=${q(`inbox:${provider}:${host}`)};`))[0] ?? null;
  const needs = items.filter((item) => item.role === "reviewer" || item.role === "both");
  const yours = items.filter((item) => item.role === "author");
  const now = Date.now();
  return {
    needs, yours, items, repos, projects, fetch, login,
    unseen: needs.filter(isNew).length,
    limitedUntil: fetch?.retry_at != null && Number(fetch.retry_at) > now ? Number(fetch.retry_at) : null,
  };
}

async function saveSession(db, provider, session, now) {
  const rows = session.hosts.map((host) => `INSERT INTO pr_providers(provider,host,login,status,detail,checked_at) VALUES(${q(provider)},${q(host.host)},${q(host.login)},'ok','signed in',${num(now)})
    ON CONFLICT(provider,host) DO UPDATE SET login=excluded.login,status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at
    WHERE pr_providers.login IS NOT excluded.login OR pr_providers.status IS NOT excluded.status OR pr_providers.detail IS NOT excluded.detail;`);
  if (rows.length) await db.run(`BEGIN;${rows.join("")}COMMIT;`);
}

// The error column holds the project list, so a new project rescans before the ten minutes.
async function scanRepos(db, run, { sessions, now }) {
  const projects = await db.read("SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;");
  const local = projects.filter((project) => project.folder && !project.machine);
  const sig = projectSignature(local);
  const prev = (await db.read(`SELECT fetched_at, error FROM pr_fetches WHERE key=${q(SCAN)};`))[0];
  if (prev?.error === sig && now - Number(prev.fetched_at) < SCAN_MS) return;
  const scanned = await local.reduce(async (prev, project) => {
    const soFar = await prev;
    const result = await run("git", ["-C", project.folder, "remote", "-v"]).catch(() => null);
    if (!result || result.code !== 0) return { seen: soFar.seen, failed: [...soFar.failed, project.folder] };
    const hits = parseRemotes(result.stdout).flatMap((remote) => {
      const hit = matchRemote(remote, sessions);
      return hit ? [{ ...hit, project, remote: publicUrl(remote) }] : [];
    });
    return { seen: [...soFar.seen, ...hits], failed: soFar.failed };
  }, Promise.resolve({ seen: [], failed: [] }));
  const seen = scanned.seen;
  const failed = scanned.failed;
  const rows = seen.map((hit) => {
    const id = repoId(hit.provider, hit.host, hit.owner, hit.name);
    return `INSERT INTO pr_repos(id,provider,host,owner,name,project_id,folder,machine,remote,seen_at) VALUES(${q(id)},${q(hit.provider)},${q(hit.host)},${q(hit.owner)},${q(hit.name)},${q(hit.project.id)},${q(hit.project.folder)},${q(hit.project.machine ?? "")},${q(hit.remote)},${num(now)})
      ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,folder=excluded.folder,machine=excluded.machine,remote=excluded.remote,owner=excluded.owner,name=excluded.name,seen_at=excluded.seen_at
      WHERE pr_repos.project_id IS NOT excluded.project_id OR pr_repos.folder IS NOT excluded.folder OR pr_repos.remote IS NOT excluded.remote OR pr_repos.owner IS NOT excluded.owner OR pr_repos.name IS NOT excluded.name OR pr_repos.seen_at IS NOT excluded.seen_at;`;
  });
  const keep = seen.map((hit) => repoId(hit.provider, hit.host, hit.owner, hit.name));
  const folders = local.filter((project) => !failed.includes(project.folder)).map((project) => project.folder);
  const drop = folders.length
    ? `DELETE FROM pr_repos WHERE IFNULL(machine,'')='' AND folder IN (${folders.map(q).join(",")}) AND id NOT IN (${keep.length ? keep.map(q).join(",") : "''"});`
    : "";
  const alive = projects.map((project) => q(project.id)).join(",") || "''";
  const dropGone = `DELETE FROM pr_repos WHERE IFNULL(machine,'')='' AND IFNULL(project_id,'') NOT IN (${alive});`;
  const mark = `INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES(${q(SCAN)},${num(now)},NULL,${q(sig)}) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at,error=excluded.error;`;
  await db.run(`BEGIN;${rows.join("")}${drop}${dropGone}${mark}COMMIT;`);
}

async function withPrFacts(db, items, write) {
  const parsed = items.flatMap((item) => {
    const repo = parsePullRequest(item.url);
    return repo ? [repo] : [];
  });
  if (!parsed.length) return;
  const hosts = [...new Set(parsed.map((repo) => repo.host))];
  const repos = await db.read(`SELECT r.*, p.folder AS project_folder, p.machine AS project_machine FROM pr_repos r JOIN projects p ON p.id=r.project_id WHERE p.removed IS NULL AND lower(r.host) IN (${hosts.map(q).join(",")});`);
  const snapshots = (rows) => rows.flatMap((item) => {
    const remote = parsePullRequest(item.url);
    if (!remote) return [];
    const repo = repos.find((row) => repoId(row.provider, row.host, row.owner, row.name) === repoId(row.provider, remote.host, remote.owner, remote.name));
    if (!repo) return [];
    const target = targetOf("pr", remote.url);
    return [{ source: target, project: `${repo.project_machine ?? ""}:${repo.project_folder}`, value: {
      type: "pr", target, number: remote.number,
      ...(item.state != null ? { state: item.state } : {}),
      ...(item.reviewDecision != null ? { review: item.reviewDecision } : {}),
      ...(Array.isArray(item.statusCheckRollup) ? { checks: checkSummary(onePerJob(item.statusCheckRollup).map(checkState)).state } : {}),
    } }];
  });
  await write(new SinceStore(db), snapshots);
}

export function seedPrFacts(db, items, now = Date.now()) {
  return withPrFacts(db, items, (store, snapshots) => store.seed(snapshots(items), now));
}

export function recordPrFacts(db, items, now = Date.now()) {
  return withPrFacts(db, items, async (store, snapshots) => {
    const urls = items.map((item) => q(publicUrl(item.url)));
    const cached = await db.read(`SELECT * FROM pr_items WHERE url IN (${urls.join(",")});`);
    await store.seed(snapshots(cached.map(itemOf)), now);
    await store.observe(snapshots(items), now);
  });
}

async function storeInbox(db, { provider, host, items, before, skipped = [], rate, error, searchOk = false, now }) {
  await seedPrFacts(db, before.filter((cached) => items.some((item) => item.url === cached.url)), now);
  const key = `inbox:${provider}:${host}`;
  const upserts = items.map((item) => itemSql(item, now)).join("");
  const urls = items.map((item) => item.url);
  const skip = skipped.filter((repo) => repo.owner && repo.name).map((repo) => `(lower(owner)=lower(${q(repo.owner)}) AND lower(name)=lower(${q(repo.name)}))`).join(" OR ");
  const drop = !rate && searchOk
    ? `DELETE FROM pr_items WHERE provider=${q(provider)} AND host=${q(host)}${skip ? ` AND NOT (${skip})` : ""} AND ${urls.length ? `url NOT IN (${urls.map(q).join(",")})` : "1"};`
    : "";
  const fetch = rate
    ? `INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES(${q(key)},NULL,${num(rate.retryAt)},${q(rate.error)}) ON CONFLICT(key) DO UPDATE SET retry_at=excluded.retry_at,error=excluded.error;`
    : searchOk || items.length
      ? `INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES(${q(key)},${num(now)},NULL,${q(error)}) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at,retry_at=NULL,error=excluded.error;`
      : `INSERT INTO pr_fetches(key,fetched_at,retry_at,error) VALUES(${q(key)},NULL,NULL,${q(error)}) ON CONFLICT(key) DO UPDATE SET error=excluded.error;`;
  await db.run(`BEGIN;${upserts}${drop}${fetch}COMMIT;`);
  await recordPrFacts(db, items, now);
}

export async function refreshInbox({ db, run, provider, session, force = false, shown = true, now = Date.now(), onCache } = {}) {
  const readHost = (hostRow) => readInbox(db, { provider: provider.id, host: hostRow.host, login: hostRow.login });
  if (!shown) {
    const parts = await session.hosts.reduce(async (prev, hostRow) => [...await prev, await readHost(hostRow)], Promise.resolve([]));
    return mergeInbox(parts);
  }
  await saveSession(db, provider.id, session, now);
  await scanRepos(db, run, { sessions: { [provider.id]: session.hosts.map((row) => row.host) }, now });
  const cachedParts = await session.hosts.reduce(async (prev, hostRow) => {
    const soFar = await prev;
    const before = await readHost(hostRow);
    return [...soFar, { hostRow, before, due: fetchDue(before.fetch, now, { force, shown }) }];
  }, Promise.resolve([]));
  const cached = mergeInbox(cachedParts.map((part) => part.before));
  if (onCache) onCache(cached, cachedParts.some((part) => part.due));
  const parts = await cachedParts.reduce(async (prev, part) => {
    const soFar = await prev;
    if (!part.due) return [...soFar, part.before];
    const repos = part.before.repos.filter((repo) => repo.project_id).toSorted((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
    const result = await provider.inbox(run, { repos, login: part.hostRow.login, host: part.hostRow.host, now }).catch((e) => ({ failed: true, error: String(e?.message ?? e).split("\n")[0] }));
    if (result.failed) return [...soFar, { ...part.before, writeError: result.error }];
    const queried = new Set((result.queried ?? []).map((repo) => `${repo.owner}\n${repo.name}`.toLowerCase()));
    const skipped = repos.filter((repo) => !queried.has(`${repo.owner}\n${repo.name}`.toLowerCase()));
    try {
      await storeInbox(db, { provider: provider.id, host: part.hostRow.host, items: result.items ?? [], before: part.before.items, skipped, rate: result.rate, error: result.error, searchOk: Boolean(result.searchOk), now });
    } catch (e) {
      return [...soFar, { ...part.before, writeError: String(e?.message ?? e).split("\n")[0] }];
    }
    return [...soFar, await readHost(part.hostRow)];
  }, Promise.resolve([]));
  return mergeInbox(parts);
}

export function mergeInbox(parts) {
  const all = parts.filter(Boolean);
  const needs = all.flatMap((part) => part.needs);
  const yours = all.flatMap((part) => part.yours);
  const limited = all.map((part) => part.limitedUntil).filter((at) => at != null).toSorted((a, b) => a - b);
  return {
    needs, yours,
    repos: all.flatMap((part) => part.repos),
    projects: all[0]?.projects ?? [],
    unseen: needs.filter(isNew).length,
    limitedUntil: limited[0] ?? null,
    login: all.find((part) => part.login)?.login ?? null,
    logins: [...new Set(all.flatMap((part) => part.logins ?? [part.login]).filter(Boolean))],
    writeError: all.map((part) => part.writeError).find(Boolean) ?? null,
  };
}
