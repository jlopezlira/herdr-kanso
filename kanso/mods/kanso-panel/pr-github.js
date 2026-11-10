// GitHub, through the gh that is already signed in on this machine, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { exec } from "herdr";
import { parseOr } from "./pure.js";
import { parseRemote, parseAuth, rateFrom, urlHost, LIST_CAP } from "./pr-remote.js";

export const SEARCH_FIELDS = "number,title,url,author,repository,updatedAt,isDraft";
export const LIST_FIELDS = "number,title,url,author,headRefName,updatedAt,isDraft,reviewDecision,additions,deletions,reviewRequests";

export function searchArgs(kind) {
  const who = kind === "reviews" ? "--review-requested=@me" : "--author=@me";
  return ["search", "prs", who, "--state=open", "--limit", "50", "--json", SEARCH_FIELDS];
}

export function listArgs(repo) {
  const name = repo.host && repo.host !== "github.com" ? `${repo.host}/${repo.owner}/${repo.name}` : `${repo.owner}/${repo.name}`;
  return ["pr", "list", "-R", name, "--state", "open", "--limit", "30", "--json", LIST_FIELDS];
}

const firstLine = (r) => String(r?.stderr || r?.stdout || "").trim().split("\n")[0] || "GitHub could not be read.";

export async function probe(run = exec) {
  const result = await run("gh", ["auth", "status"]).catch(() => null);
  if (!result || result.code === 127 || result.code === "ENOENT") return { status: "no_cli", login: null, hosts: [] };
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.code !== 0 && /not found|No such file|ENOENT/i.test(text)) return { status: "no_cli", login: null, hosts: [] };
  const hosts = parseAuth(text);
  if (result.code === 0 && hosts.length) {
    const active = hosts.find((h) => h.active) ?? hosts[0];
    return { status: "ok", login: active.login, hosts };
  }
  if (/not logged|auth login/i.test(text)) return { status: "logged_out", login: null, hosts: [] };
  if (result.code !== 0) return { status: "error", login: null, hosts: [], detail: firstLine(result) };
  return { status: "logged_out", login: null, hosts: [] };
}

function hostOf(url) {
  return urlHost(url) ?? "github.com";
}

function fromRepository(row) {
  const parts = String(row.repository?.nameWithOwner ?? "").split("/").filter(Boolean);
  if (parts.length < 2) return { host: hostOf(row.url), owner: null, name: null };
  return { host: hostOf(row.url), owner: parts.slice(0, -1).join("/"), name: parts.at(-1) };
}

const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

// Search names the account. The per-repository list fills in what search has not indexed yet, and only where it asks this login.
const itemOf = (row, role, prev, where) => ({
  url: row.url,
  provider: "github",
  host: (where.host || prev?.host || "github.com").toLowerCase(),
  owner: where.owner ?? prev?.owner ?? null,
  name: where.name ?? prev?.name ?? null,
  number: row.number ?? prev?.number,
  title: row.title ?? prev?.title ?? "",
  state: "OPEN",
  draft: Boolean(row.isDraft ?? prev?.draft),
  author: row.author?.login ?? prev?.author ?? null,
  role: !prev || prev.role === role ? role : "both",
  head: row.headRefName ?? prev?.head ?? null,
  base: row.baseRefName ?? prev?.base ?? null,
  reviewDecision: row.reviewDecision ?? prev?.reviewDecision ?? null,
  additions: row.additions ?? prev?.additions ?? null,
  deletions: row.deletions ?? prev?.deletions ?? null,
  updatedAt: row.updatedAt ?? prev?.updatedAt ?? null,
});

const put = (acc, row, role, place) => {
  if (!row?.url) return acc;
  return { ...acc, [row.url]: itemOf(row, role, acc[row.url], place ?? fromRepository(row)) };
};

export function combineInbox({ reviews = [], authored = [], listed = [], login }) {
  const fromReviews = reviews.reduce((acc, row) => put(acc, row, "reviewer"), {});
  const fromAuthored = authored.reduce((acc, row) => put(acc, row, "author"), fromReviews);
  const fromListed = listed.reduce((acc, row) => {
    const asked = (row.reviewRequests ?? []).some((r) => r.login && same(r.login, login));
    const mine = same(row.author?.login, login);
    const withReview = asked ? put(acc, row, "reviewer", row) : acc;
    return mine ? put(withReview, row, "author", row) : withReview;
  }, fromAuthored);
  return Object.values(fromListed).filter((item) => item.owner && item.name);
}

const json = (result) => result?.code === 0 ? parseOr(result.stdout, null) : null;

export async function inbox(run, { repos = [], login, now = Date.now() } = {}) {
  const reviews = await run("gh", searchArgs("reviews"));
  const limited = rateFrom(reviews, now);
  if (limited) return { items: [], rate: limited, complete: false, error: null };
  if (reviews?.code !== 0) return { items: [], rate: null, complete: false, error: firstLine(reviews) };
  const authored = await run("gh", searchArgs("authored"));
  const limitedAuthor = rateFrom(authored, now);
  const reviewRows = json(reviews) ?? [];
  if (limitedAuthor) return { items: combineInbox({ reviews: reviewRows, login }), rate: limitedAuthor, complete: false, error: null };
  if (authored?.code !== 0) return { items: combineInbox({ reviews: reviewRows, login }), rate: null, complete: false, error: firstLine(authored) };
  const authoredRows = json(authored) ?? [];
  const capped = repos.slice(0, LIST_CAP);
  const walked = await capped.reduce(async (prev, repo) => {
    const soFar = await prev;
    if (soFar.rate) return soFar;
    const result = await run("gh", listArgs(repo));
    const hit = rateFrom(result, now);
    if (hit) return { rows: soFar.rows, failed: soFar.failed, rate: hit };
    const rows = json(result);
    if (!rows) return { rows: soFar.rows, failed: true, rate: null };
    const extra = rows.map((row) => ({ ...row, owner: repo.owner, name: repo.name, host: repo.host }));
    return { rows: [...soFar.rows, ...extra], failed: soFar.failed, rate: null };
  }, Promise.resolve({ rows: [], failed: false, rate: null }));
  return {
    items: combineInbox({ reviews: reviewRows, authored: authoredRows, listed: walked.rows, login }),
    rate: walked.rate,
    complete: !walked.failed && !walked.rate && repos.length <= LIST_CAP,
    error: null,
  };
}

export function match(url, hosts = []) {
  const parsed = parseRemote(url);
  if (!parsed) return null;
  const known = new Set(hosts.map((h) => String(h).toLowerCase()));
  return known.has(parsed.host) ? parsed : null;
}

export const github = {
  id: "github",
  // Read, diff, threads, comment and review come with the pull request itself. The inbox does not draw them.
  capabilities: { read: false, diff: false, threads: false, comment: false, review: false },
  match,
  probe,
  inbox,
};
