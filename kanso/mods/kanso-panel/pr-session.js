import { spawnAndNotify, commandOk, said } from "./lib.js";
import { exec, notify, setShared, shared } from "herdr";
import { tryOr, tryOrAsync, bounded } from "./pure.js";
import { isNew, mergeInbox, refreshInbox, seenSql } from "./pr-inbox.js";
import { prMemory } from "./panel-state.js";
import { awayShown } from "./since-left-model.js";
import { pieces } from "./pieces.js";
import { fetchDue, parseRemote } from "./pr-remote.js";
import { q } from "./kdb.js";
import { CALL_MS, heldView, logDue, needsPermission, needsThreads, stayOnBranch, threadKey, waitLine } from "./pr-poll.js";

export const keepsFacts = () => awayShown(pieces(shared));

const FIELDS = "number,title,body,state,isDraft,url,author,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,latestReviews,reviewRequests,assignees,labels,additions,deletions,changedFiles,commits,files,updatedAt,mergedAt,closedAt";
const THREADS = "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:1){totalCount nodes{author{login} body url}}}}}}}";
const PEOPLE = "query($o:String!,$r:String!){viewer{login} repository(owner:$o,name:$r){assignableUsers(first:100){pageInfo{hasNextPage} nodes{login name}}}}";
const LABELS = "query($o:String!,$r:String!){repository(owner:$o,name:$r){labels(first:100,orderBy:{field:NAME,direction:ASC}){pageInfo{hasNextPage} nodes{name color description}}}}";
const OPEN = "number,title,url,isDraft,updatedAt,author,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,additions,deletions";
const openListArgs = () => ["pr", "list", "--state", "open", "--limit", "100", "--json", OPEN];
const DONE = "number,title,url,state,updatedAt,mergedAt,closedAt,author,headRefName,baseRefName,additions,deletions";
export const DONE_LIMIT = 30;
const FINISHED = { Push: "Pushed", Pull: "Pulled", Update: "Branch updated", Ready: "Marked ready for review", Draft: "Returned to draft", Close: "Closed", Reopen: "Reopened" };
const NO_PR = /no (open )?pull requests? found|could not determine current branch/i;

export function ghMissing(r) {
  if (!r || r.code === 0) return null;
  const why = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
  if (/no git remotes found/i.test(why)) return { title: "No remote", detail: null };
  if (/known GitHub host/i.test(why)) return { title: "No GitHub remote", detail: null };
  if (/gh auth login|not logged in|HTTP 401|bad credentials/i.test(why)) return { title: "Not signed in to GitHub", detail: null };
  return null;
}

export const repoOf = (url) => {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(url ?? "");
  return m ? { o: m[1], r: m[2] } : null;
};

const FILE_HEAD = /^diff -{2}git a\/.* b\/(.*)$/;
function splitDiff(text) {
  const lines = text.split("\n");
  const heads = lines.flatMap((line, i) => {
    const head = FILE_HEAD.exec(line);
    return head ? [{ at: i, name: head[1] }] : [];
  });
  return Object.fromEntries(heads.map(({ at, name }, k) => {
    const body = lines.slice(at + 1, k + 1 < heads.length ? heads[k + 1].at : lines.length);
    const hunk = body.findIndex((line) => line.startsWith("@@"));
    return [name, hunk < 0 ? [] : body.slice(hunk)];
  }));
}

const blank = () => ({
  context: undefined, cwd: null, on: null, root: null, branch: null, home: null, host: null,
  pr: null, threads: [], diffs: null, openFile: null, expanded: { checks: false, files: false, body: false },
  error: null, note: null, inboxNote: null, none: false, missing: null, outside: false,
  picker: null, candidates: null, pickerError: null, truncated: false,
  openPrs: [], listed: false, selected: null, remembered: false, branchUrl: null,
  pushed: false, behind: false, base: undefined, aheadCount: 0, behindCount: 0, subjects: [], subjectsFor: null,
  baseBehind: null, baseBehindFor: null, permission: null, permissionRepo: null, threadsFor: null,
  listing: false, openedList: false, tab: "open", closedPrs: null,
  inboxOn: false, inbox: null, inboxOpen: null, inboxTab: "needs", inboxForce: false,
  stale: null, wait: null, freshAt: null, loadedAt: undefined,
  logFor: null, failedLog: null, logParsed: null, logParsedFor: null, sendShown: false, sendFor: null,
  queued: false, asking: false, loading: false, busy: null, pending: null, flights: [], bound: null,
});

export class FolderSession {
  constructor(panel, given = {}) {
    this.panel = panel;
    Object.entries({ ...blank(), ...given }).forEach(([name, value]) => { this[name] = value; });
  }

  live() { return this.panel.session === this; }

  repo() { return repoOf(this.pr?.url); }

  tracked(work) {
    return (cx, ...rest) => { this.bound = cx; return work(cx, ...rest); };
  }

  start(cx, work) { spawnAndNotify(cx, this.tracked(work)); }

  launch(command, args, options = {}) {
    return bounded(exec(command, args, { ...options, timeout: options.timeout ?? CALL_MS }), this.bound?.timer, CALL_MS);
  }

  runner() { return (command, args, options) => this.launch(command, args, options ?? {}); }

  gh(args) { return this.launch("gh", args, { cwd: this.root ?? this.cwd, on: this.on }); }

  git(args, cwd, on = this.on) { return this.launch("git", args, { cwd: cwd ?? this.root ?? this.cwd, on }); }

  claim(name) {
    if (this.flying(name)) return false;
    this.flights = [...this.flights, name];
    return true;
  }

  settle(name) { this.flights = this.flights.filter((held) => held !== name); }

  flying(name) { return this.flights.includes(name); }

  flight(cx, name, work) {
    if (!this.claim(name)) return;
    cx.spawn(this.tracked(async (cx) => {
      try { await work(cx); }
      finally { this.settle(name); cx.notify(); }
    }));
  }

  keepLast(detail) {
    const held = heldView(Boolean(this.pr), this.freshAt, Date.now());
    if (held.keep) { this.stale = { at: this.freshAt ?? Date.now() }; this.error = null; return; }
    const line = String(detail ?? "It took too long to answer.").split("\n")[0] || "It took too long to answer.";
    this.error = { title: "Can't read GitHub", detail: line };
  }

  takeOpen(open) {
    if (open?.code !== 0) return false;
    const sorted = tryOr(() => JSON.parse(open.stdout).toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
    if (sorted === null) return false;
    this.openPrs = sorted;
    this.listed = true;
    return true;
  }

  async heldByGitHub(now) {
    const db = this.panel.db;
    if (!this.host || typeof db?.read !== "function") return null;
    try {
      if (typeof db.open === "function") await db.open();
      const rows = await db.read(`SELECT retry_at FROM pr_fetches WHERE key=${q(`inbox:github:${this.host}`)}`);
      const row = rows?.[0] ?? null;
      return fetchDue(row, now, { force: true }) ? null : waitLine(Number(row.retry_at));
    } catch { return null; }
  }

  forgetLog(next = null) {
    this.logFor = next; this.failedLog = null; this.logParsed = null; this.logParsedFor = null;
  }

  dropRemembered() {
    this.remembered = false;
    this.selected = null; this.pr = null; this.error = null; this.none = false; this.missing = null;
  }

  read(cx, { cwd, on }) {
    this.queued = false;
    this.asking = false;
    if (!cwd) return false;
    this.cwd = cwd; this.on = on;
    this.loading = true;
    const want = this.selected;
    cx.spawn(this.tracked(async (cx) => {
      const inbox = this.syncInbox().catch((e) => this.inboxFailure(e));
      const failed = (e) => this.keepLast(e?.message ?? e);
      const follow = await (async () => {
        const open = await this.readFolder(cx, want, failed).catch((e) => { failed(e); return null; });
        if (open) await open;
        await inbox;
        return (this.selected !== want || this.openedList) && !this.wait;
      })().finally(() => {
        this.openedList = false;
        this.loading = false;
        this.loadedAt = Date.now();
        cx.notify();
      });
      if (!this.live()) return;
      if (follow) this.panel.refresh(cx);
      else if (!this.wait) this.readLog(cx);
    }));
    return true;
  }

  async readFolder(cx, want, failed) {
    const top = await this.git(["rev-parse", "--show-toplevel"], this.cwd, this.on);
    if (top?.late) { this.keepLast(); return null; }
    if (top.code !== 0) {
      this.outside = true; this.missing = null; this.error = null; this.none = false; this.openPrs = [];
      this.stale = null; this.wait = null;
      if (!this.selected) { this.pr = null; this.freshAt = null; return null; }
      try { await this.readShown(this.selected, null); }
      catch (e) { failed(e); }
      return null;
    }
    this.outside = false;
    this.root = top.stdout.trim();
    const [branch, remote, pushed] = await Promise.all([
      this.git(["branch", "--show-current"], this.root).catch(() => null),
      this.git(["remote", "get-url", "origin"], this.root).catch(() => null),
      this.readPushed(this.root, this.on),
    ]);
    if (!branch || branch.late || remote?.late || pushed?.state === "late") { this.keepLast(); return null; }
    this.branch = branch.stdout.trim() || null;
    this.pushed = pushed?.state === "pushed"; this.behind = pushed?.state === "behind";
    this.aheadCount = Number.isInteger(pushed?.ahead) ? pushed.ahead : 0;
    this.behindCount = Number.isInteger(pushed?.behind) ? pushed.behind : 0;
    const remoteUrl = String(remote?.stdout ?? "");
    this.home = /github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(remoteUrl)?.[1] ?? null;
    this.host = parseRemote(remoteUrl.trim())?.host ?? null;
    const waited = await this.heldByGitHub(Date.now());
    if (waited) {
      this.wait = waited;
      if (this.pr) this.error = null;
      return null;
    }
    this.wait = null;
    if (this.listing && this.tab === "closed") this.loadClosed(cx);
    const open = this.listing ? this.gh(openListArgs()).catch(() => null) : null;
    try { await this.readShown(want, open); }
    catch (e) { if (this.remembered) this.dropRemembered(); else failed(e); }
    if (!this.pr && pushed?.state === "unpushed") {
      const stamp = `${this.branch ?? ""}\0${pushed.ahead ?? 0}`;
      if (this.subjectsFor !== stamp) {
        this.subjectsFor = stamp;
        const log = await this.git(["log", "-5", "--format=%s"], this.root).catch(() => null);
        if (this.subjectsFor === stamp && log?.code === 0) this.subjects = String(log.stdout ?? "").split("\n").filter(Boolean);
      }
    } else { this.subjects = []; this.subjectsFor = null; }
    return open;
  }

  readLog(cx) {
    if (!this.live() || !this.pr || this.flying("checks")) return;
    const stamp = this.panel.view().logKey;
    if (!logDue({ facing: this.panel.facing(), key: stamp, have: this.logFor ?? null })) return;
    this.forgetLog(stamp);
    this.flight(cx, "checks", async () => {
      const r = await this.gh(["run", "view", stamp, "--log-failed"]).catch(() => null);
      if (this.logFor === stamp && r?.code === 0) this.failedLog = r.stdout ?? "";
    });
  }

  async syncInbox() {
    if (!this.claim("inbox")) return;
    try { await this.readInbox(); }
    finally { this.settle("inbox"); }
  }

  async readInbox() {
    const ready = await this.panel.account(Date.now(), this.runner());
    if (ready == null) return;
    if (!ready.length) { this.inboxOn = false; this.inbox = null; this.inboxOpen = null; return; }
    const db = await this.panel.inboxStore().catch((e) => { this.inboxFailure(e); return null; });
    if (!db) { this.inboxOn = false; this.inboxOpen = null; return; }
    const force = Boolean(this.inboxForce);
    this.inboxForce = false;
    const model = await ready.reduce(async (prev, { provider, session }) => {
      const soFar = await prev;
      return [...soFar, await refreshInbox({
        db, run: this.runner(), provider, session, force, shown: true, facts: keepsFacts(),
        onCache: (cached, pending) => this.paintInbox(cached, !pending || cached.needs.length > 0 || cached.yours.length > 0),
      })];
    }, Promise.resolve([])).then(mergeInbox).catch((e) => e);
    if (model instanceof Error) { this.inboxFailure(model); return; }
    this.paintInbox(model, true);
    if (!model.writeError) this.retireInboxNote();
    if (this.inboxOpen === false) await this.noteSeen(this.pr?.url);
  }

  paintInbox(model, decide) {
    this.inbox = model;
    this.inboxOn = true;
    if (decide) this.inboxOpen = stayOnBranch(this.inboxOpen);
    if (model.writeError) this.inboxFailure(model.writeError);
  }

  inboxFailure(error) { this.inboxNote = this.note = said("Could not keep pull requests", String(error?.message ?? error).split("\n")[0]); }

  retireInboxNote() {
    if (this.note === this.inboxNote) this.note = null;
    this.inboxNote = null;
  }

  async noteSeen(url) {
    if (!this.live()) return;
    if (url && this.inboxOpen !== true) setShared("kanso.pr.seen", { url, at: Date.now() });
    const db = this.panel.inboxDb;
    if (!url || this.inboxOpen !== false || !db) return;
    const now = Date.now();
    try { await db.run(seenSql(url, now)); }
    catch (e) { this.inboxFailure(e); return; }
    const stamp = (item) => item.url === url ? { ...item, seenAt: now } : item;
    const needs = (this.inbox?.needs ?? []).map(stamp);
    if (this.inbox) this.inbox = { ...this.inbox, needs, yours: (this.inbox.yours ?? []).map(stamp), unseen: needs.filter(isNew).length };
  }

  async readPushed(cwd, on) {
    const [up, counts] = await Promise.all([
      this.git(["rev-parse", "--symbolic-full-name", "@{u}"], cwd, on).catch(() => null),
      this.git(["rev-list", "--left-right", "--count", "@{u}...HEAD"], cwd, on).catch(() => null),
    ]);
    if (up?.late || counts?.late) return { state: "late", ahead: 0, behind: 0 };
    const upstream = up?.code === 0 && String(up.stdout ?? "").trim().startsWith("refs/remotes/");
    if (!upstream) return { state: "unpushed", ahead: 0, behind: 0 };
    if (counts?.code !== 0) return { state: "unpushed", ahead: 0, behind: 0 };
    const [behind, ahead] = String(counts.stdout ?? "").trim().split(/\s+/).map(Number);
    const back = Number.isInteger(behind) ? behind : 0;
    const fore = Number.isInteger(ahead) ? ahead : 0;
    if (fore !== 0) return { state: "unpushed", ahead: fore, behind: back };
    if (back !== 0) return { state: "behind", ahead: 0, behind: back };
    return { state: "pushed", ahead: 0, behind: 0 };
  }


  async readShown(want, list) {
    const asked = await tryOrAsync(async () => ({ view: await this.gh(["pr", "view", ...(want ? [want] : []), "--json", FIELDS]) }));
    if (!asked) {
      if (this.remembered) { this.dropRemembered(); return; }
      if (this.pr) { this.keepLast("The GitHub CLI is not installed."); return; }
      this.missing = null; this.error = { title: "GitHub CLI not installed", detail: null, cli: true }; this.pr = null; return;
    }
    if (this.selected !== want) return;
    const missing = ghMissing(asked.view);
    if (missing) {
      if (this.remembered) { this.dropRemembered(); return; }
      this.missing = missing; this.pr = null; this.none = false; this.error = null; this.openPrs = []; this.branchUrl = null;
      this.stale = null; this.freshAt = null; return;
    }
    this.missing = null;
    if (list) this.takeOpen(await list);
    await this.panel.keepPrFacts([
      ...(asked.view.code === 0 ? [JSON.parse(asked.view.stdout)] : []),
      ...(this.openPrs ?? []).map((pr) => ({ ...pr, state: "OPEN" })),
    ]);
    const done = (v) => tryOr(() => ["MERGED", "CLOSED"].includes(JSON.parse(v.stdout).state), false);
    const branchHasNone = !want && (asked.view.code !== 0 ? NO_PR.test(asked.view.stderr || asked.view.stdout) : done(asked.view));
    if (branchHasNone && this.branch && this.base === undefined) {
      const b = await this.gh(["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]).catch(() => null);
      if (b?.code === 0) this.base = b.stdout.trim() || null;
    }
    if (branchHasNone) {
      if (this.selected !== want) return;
      this.none = true; this.pr = null; this.error = null; this.stale = null; this.freshAt = null;
      this.branchUrl = null; this.threads = []; return;
    }
    const view = asked.view;
    if (view.code !== 0) {
      if (this.remembered) { this.dropRemembered(); return; }
      const why = (view.stderr || view.stdout).trim();
      if (NO_PR.test(why)) { this.none = true; this.pr = null; this.error = null; this.stale = null; this.freshAt = null; }
      else this.keepLast(view.late ? undefined : why);
      return;
    }
    const pr = JSON.parse(view.stdout);
    if (this.remembered && !prMemory({ url: pr.url }, () => (pr.state === "OPEN" ? "open" : "closed"))) { this.dropRemembered(); return; }
    this.remembered = false;
    if (this.pr?.url !== pr.url) {
      this.diffs = null; this.openFile = null; this.expanded = { ...this.expanded, body: false };
      this.forgetLog();
      this.sendShown = false; this.sendFor = null; this.baseBehind = null; this.baseBehindFor = null;
    }
    this.pr = pr; this.none = false; this.error = null;
    this.freshAt = Date.now(); this.stale = null; this.wait = null;
    if (!want) this.branchUrl = pr.url;
    if (!this.home && !want) this.home = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(pr.url)?.[1] ?? null;
    await this.noteSeen(pr.url);
    const repo = this.repo();
    if (this.threadsFor && !String(this.threadsFor).startsWith(`${pr.url}\0`)) { this.threads = []; this.threadsFor = null; }
    if (repo && needsThreads(this.threadsFor, pr.url, pr.updatedAt)) {
      const gql = await this.gh(["api", "graphql", "-f", `query=${THREADS}`, "-F", `o=${repo.o}`, "-F", `r=${repo.r}`, "-F", `n=${pr.number}`]).catch(() => null);
      const nodes = gql?.code === 0 && this.pr?.url === pr.url
        ? tryOr(() => JSON.parse(gql.stdout)?.data?.repository?.pullRequest?.reviewThreads?.nodes, null) : null;
      if (nodes) {
        this.threads = nodes.filter((n) => !n.isResolved).map((n) => {
          const first = n.comments?.nodes?.[0];
          return { path: n.path, line: n.line, outdated: n.isOutdated, author: first?.author?.login ?? "", body: (first?.body ?? "").replace(/\r\n?/g, "\n").trim(), url: first?.url, replies: Math.max(0, (n.comments?.totalCount ?? 1) - 1) };
        });
        this.threadsFor = threadKey(pr.url, pr.updatedAt);
      }
    }
    if (!this.panel.viewer) {
      const me = await this.gh(["api", "user", "--jq", ".login"]).catch(() => null);
      if (me?.code === 0) this.panel.learnViewer(me.stdout.trim(), this);
    }
    const place = this.repo();
    const repoKey = place ? `${place.o}/${place.r}` : null;
    if (needsPermission(this.permission, this.permissionRepo, repoKey)) {
      this.permission = null; this.permissionRepo = repoKey;
      if (place && pr.state === "OPEN") {
        const perm = await this.gh(["repo", "view", repoKey, "--json", "viewerPermission", "--jq", ".viewerPermission"]).catch(() => null);
        const value = perm?.code === 0 ? perm.stdout.trim() : "";
        if (value && this.pr?.url === pr.url) this.permission = value;
      }
    }
    const behindStamp = `${pr.url}\0${pr.updatedAt ?? ""}`;
    if (String(pr.mergeStateStatus ?? "").toUpperCase() === "BEHIND" && this.root) {
      if (this.baseBehindFor !== behindStamp) {
        this.baseBehindFor = behindStamp;
        const base = pr.baseRefName || "main";
        const counted = await this.git(["rev-list", "--count", `HEAD..origin/${base}`], this.root).catch(() => null);
        const n = Number(String(counted?.stdout ?? "").trim());
        if (this.pr?.url === pr.url && this.baseBehindFor === behindStamp) this.baseBehind = counted?.code === 0 && Number.isInteger(n) && n > 0 ? n : null;
      }
    } else if (this.pr?.url === pr.url) { this.baseBehind = null; this.baseBehindFor = null; }
  }

  loadClosed(cx) {
    if (!this.root || this.wait) return;
    this.flight(cx, "closed", async () => {
      const r = await this.gh(["pr", "list", "--state", "closed", "--limit", String(DONE_LIMIT), "--json", DONE]).catch(() => null);
      const rows = r?.code === 0 ? tryOr(() => JSON.parse(r.stdout)) : null;
      if (!rows) return;
      const when = (p) => Date.parse(p.mergedAt || p.closedAt || p.updatedAt) || 0;
      await this.panel.keepPrFacts(rows);
      this.closedPrs = rows.toSorted((a, b) => when(b) - when(a));
    });
  }

  loadOthers(cx) {
    if (!this.live() || this.listed || this.wait || !this.root) return;
    this.flight(cx, "details", async () => { this.takeOpen(await this.gh(openListArgs()).catch(() => null)); });
  }

  readDiff(cx) {
    const url = this.pr?.url;
    if (!url) return;
    this.flight(cx, "diff", async () => {
      try {
        const r = await this.gh(["pr", "diff", url, "--color", "never"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        if (this.pr?.url === url) this.diffs = splitDiff(r.stdout);
      } catch (e) { this.note = said("Could not read the diff", String(e?.message ?? e).split("\n")[0]); }
    });
  }

  readPicker(kind, cx) {
    const repo = this.repo();
    cx.spawn(this.tracked(async (cx) => {
      try {
        const query = kind === "labels" ? LABELS : PEOPLE;
        const r = await this.gh(["api", "graphql", "-f", `query=${query}`, "-F", `o=${repo.o}`, "-F", `r=${repo.r}`]);
        commandOk(r);
        if (this.picker !== kind) return;
        const data = JSON.parse(r.stdout).data;
        this.panel.learnViewer(data?.viewer?.login, this);
        const list = kind === "labels" ? data.repository.labels : data.repository.assignableUsers;
        this.truncated = Boolean(list.pageInfo?.hasNextPage);
        this.candidates = list.nodes;
      } catch (e) { this.pickerError = String(e?.message ?? e); }
      cx.notify();
    }));
  }

  place(pr) {
    const folder = String(this.root ?? this.cwd ?? "").split("/").filter(Boolean).at(-1) ?? "this folder";
    return pr ? `#${pr.number} in ${folder}` : `${this.branch ?? "The branch"} in ${folder}`;
  }

  tell(message, pr = this.pr) {
    if (this.live()) { notify(message); return; }
    notify({ ...message, body: [this.place(pr), message.body].filter(Boolean).join(". ") });
  }

  reread(cx) {
    this.loadedAt = 0;
    cx.notify();
    if (this.live()) this.panel.refresh(cx);
  }

  perform(label, cx, words, work, after) {
    if (this.busy) return false;
    const pr = this.pr;
    this.busy = label; this.note = null;
    this.start(cx, async (cx) => {
      try {
        await work();
        if (words.loud || !this.live()) this.tell({ title: words.done, body: words.body, level: "success" }, pr);
      } catch (e) {
        this.note = said(words.failure, e?.message ?? e);
        if (!this.live()) this.tell({ title: words.failure, body: String(e?.message ?? e), level: "error" }, pr);
      } finally { this.busy = null; after(cx); }
    });
    return true;
  }

  act(label, args, cx, run = (a) => this.gh(a)) {
    const words = { failure: `${label} failed`, done: FINISHED[label] };
    if (this.perform(label, cx, words, async () => commandOk(await run(args)), (next) => this.reread(next))) this.panel.armed.clear();
  }

  mergeNow(cx) {
    const pr = this.pr;
    if (!pr) return;
    this.perform("Merge", cx, { failure: "Merge failed", done: `Merged #${pr.number}`, body: pr.title, loud: true }, async () => {
      const { o, r: name } = repoOf(pr.url);
      const repo = await this.gh(["repo", "view", `${o}/${name}`, "--json", "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed"]);
      const allowed = repo.code === 0 ? JSON.parse(repo.stdout) : {};
      const method = allowed.squashMergeAllowed !== false ? "--squash" : allowed.mergeCommitAllowed ? "--merge" : "--rebase";
      commandOk(await this.gh(["pr", "merge", pr.url, method]));
    }, (next) => this.reread(next));
  }

  createPr(cx) {
    this.perform("Create", cx, { failure: "Could not create it", done: "Opened GitHub to create the pull request" }, async () => {
      const now = await this.readPushed(this.root, this.on);
      if (!now || now.state === "late") throw new Error("It took too long to answer.");
      if (now.state !== "pushed") throw new Error(`${now.state === "behind" ? "pull" : "push"} ${this.branch ?? "the branch"} first`);
      commandOk(await this.gh(["pr", "create", "--web"]));
    }, (next) => next.notify());
  }

  deliverTo(cx, send) {
    return this.perform("Send", cx, { failure: "Not sent", done: "Sent to the agent" }, async () => {
      const sent = await send();
      if (sent?.code !== 0) throw new Error(String(sent?.stderr || sent?.stdout || "could not send").split("\n")[0]);
    }, (next) => next.notify());
  }

  toggle(kind, name, on, cx) {
    if (!this.pr || this.pending) return;
    const { o, r } = this.repo(), n = this.pr.number;
    const call = {
      labels: on ? ["-X", "DELETE", `repos/${o}/${r}/issues/${n}/labels/${encodeURIComponent(name)}`] : ["-X", "POST", `repos/${o}/${r}/issues/${n}/labels`, "-f", `labels[]=${name}`],
      assignees: ["-X", on ? "DELETE" : "POST", `repos/${o}/${r}/issues/${n}/assignees`, "-f", `assignees[]=${name}`],
      reviewers: ["-X", on ? "DELETE" : "POST", `repos/${o}/${r}/pulls/${n}/requested_reviewers`, "-f", `reviewers[]=${name}`],
    }[kind];
    const done = { labels: on ? `Took ${name} off` : `Put ${name} on`, assignees: on ? `Unassigned ${name}` : `Assigned ${name}`, reviewers: on ? `Review request to ${name} taken back` : `Review requested from ${name}` }[kind];
    const asked = this.pr;
    const failed = { labels: on ? `Could not take ${name} off` : `Could not put ${name} on`, assignees: on ? `Could not unassign ${name}` : `Could not assign ${name}`, reviewers: on ? `Could not take back the request to ${name}` : `Could not ask ${name} for a review` }[kind];
    const why = { labels: "Changing labels needs triage access on this repository.", assignees: "Assigning needs triage access on this repository.", reviewers: "Asking for a review needs write access on this repository." }[kind];
    this.pending = name;
    this.start(cx, async (cx) => {
      try {
        commandOk(await this.gh(["api", ...call, "--silent"]));
        if (!this.pr) return;
        const pr = this.pr;
        if (kind === "labels") this.pr = { ...pr, labels: on ? pr.labels.filter((l) => l.name !== name) : [...pr.labels, (this.candidates ?? []).find((l) => l.name === name) ?? { name }] };
        if (kind === "assignees") this.pr = { ...pr, assignees: on ? pr.assignees.filter((a) => a.login !== name) : [...pr.assignees, { login: name }] };
        if (kind === "reviewers") this.pr = { ...pr, reviewRequests: on ? pr.reviewRequests.filter((x) => x.login !== name) : [...pr.reviewRequests, { login: name }] };
        if (kind !== "labels" || !this.live()) this.tell({ title: done, level: "success" }, asked);
      } catch (e) { this.tell({ title: failed, body: `${String(e?.message ?? e)} ${why}`, level: "error" }, asked); }
      finally { this.pending = null; this.reread(cx); }
    });
  }
}
