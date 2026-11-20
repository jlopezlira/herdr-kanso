import { groupInbox } from "./pr-inbox.js";
import { parseRemote, repoId } from "./pr-remote.js";
import { plural } from "./pure.js";

const idOf = (repo) => repoId(repo.provider ?? "github", repo.host, repo.owner, repo.name);

export const scopeRepos = (children) => children.flatMap(({ folder, remote }) => {
  const parsed = parseRemote(remote);
  return parsed?.owner && parsed?.name ? [{ provider: "github", host: parsed.host, owner: parsed.owner, name: parsed.name, folder }] : [];
}).filter((repo, i, all) => all.findIndex((other) => idOf(other) === idOf(repo)) === i);
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
  const groups = groupInbox([...needs, ...yours.filter((item) => !urls.has(item.url))], { repos: inbox?.repos ?? [], projects: inbox?.projects ?? [] });
  const blocks = groups.map((group) => {
    const own = new Set(group.rows.map((item) => item.url));
    const blockNeeds = needs.filter((item) => own.has(item.url));
    return {
      key: group.key, title: group.title, here: group.rows.some(here), ids: new Set(group.rows.map(idOf)),
      needs: blockNeeds, yours: yours.filter((item) => own.has(item.url)), failing: failing(group.rows), oldest: oldestOf(blockNeeds),
    };
  });
  const quiet = scope?.kind === "folder" ? scope.repos.filter((repo) => !blocks.some((block) => block.ids.has(idOf(repo))))
    .map((repo) => ({ key: idOf(repo), title: repo.name, here: true, ids: new Set([idOf(repo)]), needs: [], yours: [], failing: 0, oldest: null })) : [];
  return [...blocks, ...quiet].map(({ ids, ...block }) => block).toSorted((a, b) => Number(b.here) - Number(a.here) || b.needs.length - a.needs.length || a.title.localeCompare(b.title));
}

export const blockFacts = ({ needs, yours }, waited) => (needs.length || yours.length ? [
  needs.length ? `Needs you ${needs.length}` : null,
  yours.length ? `Yours ${yours.length}` : null,
  needs.length && waited ? { text: `oldest ${waited}`, tone: "dim" } : null,
].filter(Boolean) : [{ text: "Nothing open", tone: "dim" }]);

export const failingMeta = (block) => (block.failing ? { text: `${block.failing} failing`, tone: "blocked" } : null);

export const scopeLine = (scope) => {
  if (scope?.kind === "folder") return plural(scope.repos.length, "repository here", "repositories here");
  if (scope?.kind === "all") return "Not in a repository";
  return null;
};

const shownOpen = (open, blocks, scope) => open ?? (scope?.kind === "repo" ? blocks.filter((block) => block.here).map((block) => block.key) : []);
export const isOpen = (open, key, blocks, scope) => blocks.length === 1 || shownOpen(open, blocks, scope).includes(key);
export const toggled = (open, key, blocks, scope) => {
  const now = shownOpen(open, blocks, scope);
  return now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
};
