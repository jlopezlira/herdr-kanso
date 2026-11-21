import { isNew, parseRemote, repoId } from "./pr-remote.js";
import { plural } from "./pure.js";
import { paths } from "./platform-paths.js";

const idOf = (repo) => repoId(repo.provider ?? "github", repo.host, repo.owner, repo.name);

const remoteOf = ({ folder, remote }) => {
  const parsed = parseRemote(remote);
  return parsed?.owner && parsed?.name ? { provider: "github", host: parsed.host, owner: parsed.owner, name: parsed.name, folder } : null;
};

export const scopeRepos = (children) => children.map(remoteOf).filter(Boolean)
  .filter((repo, i, all) => all.findIndex((other) => idOf(other) === idOf(repo)) === i);

export const folderScope = (children) => {
  const repos = scopeRepos(children);
  const local = children.filter((child) => !remoteOf(child)).map((child) => child.folder);
  return repos.length || local.length ? { kind: "folder", repos, local } : { kind: "all", repos: [], local: [] };
};

const titles = (inbox) => {
  const repos = inbox?.repos ?? [];
  const projects = inbox?.projects ?? [];
  const perProject = Map.groupBy(repos, (repo) => repo.project_id);
  const names = Map.groupBy(projects, (project) => project.name);
  const named = new Map(projects.filter((project) => names.get(project.name).length === 1).map((project) => [project.id, project.name]));
  const byId = new Map(repos.map((repo) => [repo.id, repo]));
  return (item) => {
    const repo = byId.get(idOf(item));
    const alone = repo?.project_id && perProject.get(repo.project_id)?.length === 1;
    return (alone ? named.get(repo.project_id) : null) ?? `${item.owner}/${item.name}`;
  };
};
const byUpdate = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const failing = (items) => items.filter((item) => item.checks === "fail").length;
const oldestOf = (items) => items.map((item) => Date.parse(item.createdAt ?? item.updatedAt)).filter(Number.isFinite).toSorted((a, b) => a - b)[0] ?? null;

const inScope = (scope) => {
  const ids = new Set((scope?.repos ?? []).map(idOf));
  return (item) => ids.has(idOf(item));
};

export function boardOf(inbox, scope = null) {
  const here = inScope(scope);
  const needs = inbox?.needs ?? [];
  const yours = inbox?.yours ?? [];
  const urls = new Set(needs.map((item) => item.url));
  const titleOf = titles(inbox);
  const grouped = Map.groupBy([...needs, ...yours.filter((item) => !urls.has(item.url))], idOf);
  const blocks = [...grouped].map(([key, rows]) => {
    const own = new Set(rows.map((item) => item.url));
    const blockNeeds = needs.filter((item) => own.has(item.url)).toSorted(byUpdate);
    return {
      key, title: titleOf(rows[0]), here: rows.some(here), remote: true,
      needs: blockNeeds, yours: yours.filter((item) => own.has(item.url)).toSorted(byUpdate), failing: failing(rows), oldest: oldestOf(blockNeeds),
    };
  });
  const empty = { needs: [], yours: [], failing: 0, oldest: null, here: true };
  const quiet = scope?.kind === "folder" ? scope.repos.filter((repo) => !grouped.has(idOf(repo)))
    .map((repo) => ({ ...empty, key: idOf(repo), title: repo.name, remote: true })) : [];
  const local = (scope?.local ?? []).map((folder) => ({ ...empty, key: folder, title: paths.basename(folder), remote: false }));
  return [...blocks, ...quiet, ...local].toSorted((a, b) => Number(b.here) - Number(a.here) || b.needs.length - a.needs.length || a.title.localeCompare(b.title));
}

export const blockFacts = ({ needs, yours, remote }, waited) => (!remote ? [{ text: "No GitHub remote", tone: "dim" }] : needs.length || yours.length ? [
  needs.length ? `Needs you ${needs.length}` : null,
  yours.length ? `Yours ${yours.length}` : null,
  needs.length && waited ? { text: `oldest ${waited}`, tone: "dim" } : null,
].filter(Boolean) : [{ text: "Nothing open", tone: "dim" }]);

export const failingMeta = (block) => (block.failing ? { text: `${block.failing} failing`, tone: "blocked" } : null);

export const scopeLine = (scope) => {
  if (scope?.kind === "folder") return plural(scope.repos.length + scope.local.length, "repository here", "repositories here");
  if (scope?.kind === "all") return "Not in a repository";
  return null;
};

const shownOpen = (open, blocks, scope) => open ?? (scope?.kind === "repo" ? blocks.filter((block) => block.here).map((block) => block.key) : []);
export const isOpen = (open, key, blocks, scope) => blocks.length === 1 || shownOpen(open, blocks, scope).includes(key);
export const toggled = (open, key, blocks, scope) => {
  const now = shownOpen(open, blocks, scope);
  return now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
};

const DAY = 86_400_000;
const AGE_DAYS = [1, 3, 7, 14, 21, Infinity];

export function statsOf(blocks, now) {
  const needs = blocks.flatMap((block) => block.needs.map((item) => ({ ...item, repo: block.title })));
  const all = blocks.flatMap((block) => [...block.needs, ...block.yours]);
  if (!all.length) return null;
  const since = (item) => now - Date.parse(item.createdAt ?? item.updatedAt);
  const waited = needs.filter((item) => Number.isFinite(since(item))).toSorted((a, b) => since(b) - since(a));
  const counts = AGE_DAYS.map((days, i) => waited.filter((item) => since(item) >= (AGE_DAYS[i - 1] ?? 0) * DAY && since(item) < days * DAY).length);
  const peak = Math.max(1, ...counts);
  return {
    oldest: waited[0] ?? null,
    fresh: all.filter(isNew).length,
    review: { add: needs.reduce((n, item) => n + (item.additions ?? 0), 0), del: needs.reduce((n, item) => n + (item.deletions ?? 0), 0), count: needs.length },
    ages: counts.map((n) => n / peak),
  };
}
