import { Database } from "./platform-database.js";
import { paths } from "./platform-paths.js";
import { appHome } from "herdr";
import { q } from "./kdb.js";
import { num } from "./pr-inbox.js";

export const STORE_DIR = "data/kanso-panel";
const DAY = 86400000;

const SCHEMA = `
DROP TABLE IF EXISTS commits;
DROP TABLE IF EXISTS gh_weeks;
DROP TABLE IF EXISTS gh_repos;
DROP TABLE IF EXISTS scans;
CREATE TABLE IF NOT EXISTS prs(url TEXT PRIMARY KEY, provider TEXT NOT NULL, repo TEXT NOT NULL, owner TEXT NOT NULL, number INTEGER NOT NULL, created INTEGER NOT NULL, merged INTEGER, closed INTEGER, base TEXT, main TEXT, merge_oid TEXT, prod INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS prs_created ON prs(created);
CREATE TABLE IF NOT EXISTS months(provider TEXT NOT NULL, month TEXT NOT NULL, read INTEGER NOT NULL, PRIMARY KEY(provider, month));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`;

export const sqlText = q;
const int = num;
const at = (iso) => (iso ? Date.parse(iso) : null);

export function prRow(node, provider = "github") {
  const repo = node.repository ?? {};
  const main = repo.defaultBranchRef?.name ?? null;
  const merged = at(node.mergedAt);
  return {
    url: node.url, provider, repo: repo.nameWithOwner ?? "", owner: repo.owner?.login ?? "", number: node.number,
    created: at(node.createdAt), merged, closed: at(node.closedAt), base: node.baseRefName ?? null, main,
    merge_oid: node.mergeCommit?.oid ?? null, prod: merged && main && node.baseRefName === main ? 1 : 0,
  };
}

const COLS = ["url", "provider", "repo", "owner", "number", "created", "merged", "closed", "base", "main", "merge_oid", "prod"];
const NUMS = new Set(["number", "created", "merged", "closed", "prod"]);

const owned = (login) => (login == null ? "1" : `EXISTS(SELECT 1 FROM meta WHERE k=${sqlText(`${"github"}.login`)} AND v=${sqlText(login)})`);
export const upsertPrs = (rows, login = null) => rows.map((r) => `INSERT INTO prs(${COLS.join(",")}) SELECT ${COLS.map((k) => (NUMS.has(k) ? int(r[k]) : sqlText(r[k]))).join(",")} WHERE ${owned(login)} ON CONFLICT(url) DO UPDATE SET ${COLS.filter((k) => k !== "url" && k !== "prod").map((k) => `${k}=excluded.${k}`).join(",")},prod=MAX(prs.prod,excluded.prod);`).join("\n");

export const prodSql = (urls, login = null) => (urls.length ? `UPDATE prs SET prod=1 WHERE url IN (${urls.map(sqlText).join(",")}) AND ${owned(login)};` : "");

export function pendingByRepo(rows) {
  const waiting = rows.filter((r) => r.merged && !r.prod && r.main && r.base !== r.main && r.merge_oid);
  return [...Map.groupBy(waiting, (r) => r.repo)].map(([repo, list]) => ({
    repo, main: list[0].main, since: Math.min(...list.map((r) => r.merged)) - DAY, until: Math.max(...list.map((r) => r.merged)) + DAY, oids: new Map(list.map((r) => [r.merge_oid, r.url])),
  }));
}

export function monthsIn(start, end) {
  const first = new Date(start), last = new Date(end - 1);
  const count = (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth() + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
    return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, start: d.getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  });
}

const median = (list) => {
  if (!list.length) return null;
  const s = list.toSorted((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function cohortOf(prs, start, end, login = "") {
  const opened = prs.filter((p) => p.created >= start && p.created < end);
  const merged = opened.filter((p) => p.merged);
  const prod = merged.filter((p) => p.prod);
  const byRepo = [...Map.groupBy(opened, (p) => p.repo)].map(([repo, list]) => ({ repo, opened: list.length, prod: list.filter((p) => p.prod).length }))
    .toSorted((a, b) => b.prod - a.prod || b.opened - a.opened || a.repo.localeCompare(b.repo));
  const me = String(login).toLowerCase();
  return {
    opened: opened.length, merged: merged.length, prod: prod.length,
    dropped: opened.filter((p) => p.closed && !p.merged).length, open: opened.filter((p) => !p.closed && !p.merged).length,
    rate: opened.length ? prod.length / opened.length : null,
    toMerge: median(merged.map((p) => p.merged - p.created)),
    elsewhere: merged.filter((p) => me && p.owner.toLowerCase() !== me).length,
    repos: byRepo,
  };
}

export function mergeHours(prs, start, end) {
  const hours = prs.filter((p) => p.merged && p.merged >= start && p.merged < end).map((p) => new Date(p.merged).getHours());
  return Array.from({ length: 24 }, (_, h) => hours.filter((x) => x === h).length);
}

export class Store extends Database {
  constructor(timer) {
    super(timer);
    this.dir = paths.join(appHome(), STORE_DIR);
    this.file = paths.join(this.dir, "shipped.db");
  }

  async script(text) {
    if (text.trim()) await this.sql(["BEGIN;", text, "COMMIT;"]);
  }

  async open() {
    await this.prepare(this.dir, "Install sqlite3 to keep Shipped's statistics.");
    await this.sql(SCHEMA);
  }

  async meta(k) { return (await this.sql(`SELECT v FROM meta WHERE k=${sqlText(k)};`, true))[0]?.v ?? null; }
  async setMeta(k, v) { await this.sql(`INSERT OR REPLACE INTO meta(k,v) VALUES(${sqlText(k)},${sqlText(v)});`); }

  async prs() { return this.sql("SELECT * FROM prs;", true); }

  async period(key) {
    const kept = JSON.parse((await this.meta(`period:${key}`)) ?? "null");
    return kept && Number.isFinite(kept.at) && kept.data?.viewer ? kept : null;
  }

  setPeriod(key, data, at = Date.now()) { return this.setMeta(`period:${key}`, JSON.stringify({ at, data })); }

  async forAccount(provider, login) {
    const key = `${provider}.login`;
    if ((await this.meta(key)) === login) return;
    await this.script(`DELETE FROM prs WHERE provider=${sqlText(provider)};\nDELETE FROM months WHERE provider=${sqlText(provider)};\nDELETE FROM meta WHERE k=${sqlText(`${provider}.updated`)} OR k LIKE 'period:%';\nINSERT OR REPLACE INTO meta(k,v) VALUES(${sqlText(key)},${sqlText(login)});`);
  }
  async save(rows, login = null) { await this.script(upsertPrs(rows, login)); }
  async markProd(urls, login = null) { await this.script(prodSql(urls, login)); }

  async readMonths(provider) { return new Set((await this.sql(`SELECT month FROM months WHERE provider=${sqlText(provider)};`, true)).map((r) => r.month)); }
  async monthRead(provider, month, now = Date.now(), login = null) { await this.sql(`INSERT OR REPLACE INTO months(provider,month,read) SELECT ${sqlText(provider)},${sqlText(month)},${int(now)} WHERE ${owned(login)};`); }
  async setOwnMeta(k, v, login) { await this.sql(`INSERT OR REPLACE INTO meta(k,v) SELECT ${sqlText(k)},${sqlText(v)} WHERE ${owned(login)};`); }
}
