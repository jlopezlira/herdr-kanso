// Kanso's Shipped panel, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What you delivered, drawn the way Spend draws what you spent: one centered
// column, a big light number, periods with arrows, then the breakdowns.
//
// Where it comes from:
// - Lines and commits: `git log` in the repositories your panes and spaces are
//   in (remembered once seen), counting only
//   what landed on origin's main, master or develop (as of your last fetch),
//   authored by you, without merge commits or lockfiles. A squashed branch
//   counts once, as its squash.
// - Pull requests merged, reviews, the contribution calendar (streak, best
//   day) and your last 100 merged pull requests (biggest, fastest): one GitHub
//   GraphQL query through `gh`.
// Records are kept in shared("kanso.shipped.records"); beating one toasts once.
//
// One of the kanso-panel mod's panels: it exists only while shown.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, spaces, panes, theme, shared, setShared, notify } from "herdr";

const ICON = "mods/kanso-chrome/icons/";
const G = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const DAY = 86400000;
const RECORDS = "kanso.shipped.records";
const REFRESH_MS = 5 * 60 * 1000;
const HEAT_WEEKS = 12;
const REPO_ROWS = 6;
export const PERIODS = ["day", "week", "month", "year"];
const PERIOD_NAMES = { day: "Day", week: "Week", month: "Month", year: "Year" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Lockfiles are written by tools, not by you.
const NOT_YOURS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Cargo.lock", "Gemfile.lock", "poetry.lock", "composer.lock", "go.sum", "uv.lock"];

function tokens(t) {
  return {
    canvas: t.canvas ?? t.background, text: t.foreground, muted: t.muted ?? t.dim, dim: t.dim,
    border: t.border, subtle: t.hover ?? t.raised, selected: t.selected ?? t.hover ?? t.raised,
    accent: t.accent ?? t.foreground, red: t.ansi1, green: t.ansi2,
  };
}

export const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 360) / 10} h`;
  return `${Math.round(s / 8640) / 10} d`;
}
const dayName = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIsoDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };

// A period in local time: kind "day" | "week" (from Monday) | "month" | "year",
// offset 0 for the current one, -1 for the one before.
export function periodRange(kind, offset, now = Date.now()) {
  const t = new Date(now), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  let start, end;
  if (kind === "day") { start = new Date(y, m, d + offset); end = new Date(y, m, d + offset + 1); }
  else if (kind === "week") { const monday = d - ((t.getDay() + 6) % 7) + 7 * offset; start = new Date(y, m, monday); end = new Date(y, m, monday + 7); }
  else if (kind === "month") { start = new Date(y, m + offset, 1); end = new Date(y, m + offset + 1, 1); }
  else { start = new Date(y + offset, 0, 1); end = new Date(y + offset + 1, 0, 1); }
  return { start: start.getTime(), end: end.getTime() };
}

// The span to compare with: the period before, cut at the same point when the
// current one is still running ("vs this point last week").
export function comparedRange(kind, offset, now = Date.now()) {
  const prev = periodRange(kind, offset - 1, now);
  if (offset !== 0) return prev;
  const { start } = periodRange(kind, 0, now);
  return { start: prev.start, end: Math.min(prev.end, prev.start + (now - start)) };
}

export function periodLabel(kind, offset, now = Date.now()) {
  const { start, end } = periodRange(kind, offset, now);
  const s = new Date(start), e = new Date(end - DAY);
  if (kind === "day") return offset === 0 ? "Today" : offset === -1 ? "Yesterday" : `${WEEKDAYS[s.getDay()]} ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  if (kind === "week") return offset === 0 ? "This week" : offset === -1 ? "Last week" : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
  if (kind === "month") return offset === 0 ? "This month" : `${FULL_MONTHS[s.getMonth()]} ${s.getFullYear()}`;
  return offset === 0 ? "This year" : String(s.getFullYear());
}

const comparedLabel = (kind, offset) => offset === 0
  ? { day: "vs this time yesterday", week: "vs this point last week", month: "vs this point last month", year: "vs this point last year" }[kind]
  : { day: "vs the day before", week: "vs the week before", month: "vs the month before", year: "vs the year before" }[kind];

// `git log --format='%x1e%H %at' --shortstat` as [{ hash, at (ms), add, del }].
export function parseLog(stdout) {
  const out = [];
  for (const chunk of String(stdout).split("\x1e").slice(1)) {
    const [head, ...rest] = chunk.trim().split("\n");
    const [hash, at] = head.trim().split(/\s+/);
    const stat = rest.join(" ");
    out.push({
      hash, at: Number(at) * 1000,
      add: Number(/(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? 0),
      del: Number(/(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? 0),
    });
  }
  return out;
}

// Lines and commits in [start, end), in total and per repository (most first).
export function sumLines(repos, start, end) {
  const byRepo = [];
  let add = 0, del = 0, commits = 0;
  for (const r of repos) {
    let a = 0, d = 0, n = 0;
    for (const c of r.commits) if (c.at >= start && c.at < end) { a += c.add; d += c.del; n++; }
    if (n) byRepo.push({ name: r.name, add: a, del: d, commits: n });
    add += a; del += d; commits += n;
  }
  byRepo.sort((x, y) => (y.add + y.del) - (x.add + x.del));
  return { add, del, commits, byRepo };
}

// The current and longest run of days with at least one contribution. Today
// without one yet does not break the current run.
export function streaks(days, today) {
  let longest = { n: 0, end: null }, run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; if (run > longest.n) longest = { n: run, end: d.date }; }
    else run = 0;
  }
  let current = 0, i = days.length - 1;
  if (i >= 0 && days[i].date === today && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

// The week (from Monday) with the most lines added, over every commit read.
function bestWeek(repos) {
  const weeks = new Map();
  for (const r of repos) for (const c of r.commits) {
    const start = periodRange("week", 0, c.at).start;
    weeks.set(start, (weeks.get(start) ?? 0) + c.add);
  }
  let best = null;
  for (const [start, add] of weeks) if (add > 0 && (!best || add > best.add)) best = { add, start };
  return best;
}

// Personal bests from what was read: { bestDay, longestStreak, bestWeek, biggestPr, fastestMerge }.
export function computeRecords({ days, repos, recent }) {
  const r = {};
  for (const d of days) if (d.contributionCount > 0 && (!r.bestDay || d.contributionCount > r.bestDay.n)) r.bestDay = { n: d.contributionCount, date: d.date };
  const { longest } = streaks(days, null);
  if (longest.n) r.longestStreak = longest;
  const week = bestWeek(repos);
  if (week) r.bestWeek = week;
  for (const p of recent ?? []) {
    if (!p?.mergedAt) continue;
    const lines = (p.additions ?? 0) + (p.deletions ?? 0), ms = Date.parse(p.mergedAt) - Date.parse(p.createdAt);
    const pr = { number: p.number, title: p.title, repo: p.repository?.nameWithOwner, url: p.url, at: Date.parse(p.mergedAt) };
    if (!r.biggestPr || lines > r.biggestPr.lines) r.biggestPr = { ...pr, lines, add: p.additions, del: p.deletions };
    if (ms > 0 && (!r.fastestMerge || ms < r.fastestMerge.ms)) r.fastestMerge = { ...pr, ms };
  }
  return r;
}

const BETTER = {
  bestDay: (a, b) => a.n > b.n, longestStreak: (a, b) => a.n > b.n, bestWeek: (a, b) => a.add > b.add,
  biggestPr: (a, b) => a.lines > b.lines, fastestMerge: (a, b) => a.ms < b.ms,
};
export const RECORD_NAMES = { bestDay: "Best day", bestWeek: "Best week", longestStreak: "Longest streak", biggestPr: "Biggest pull request", fastestMerge: "Fastest merge" };

// When a record was set (ms).
const recordAt = (k, r) => k === "bestDay" ? fromIsoDay(r.date) : k === "longestStreak" ? (r.end ? fromIsoDay(r.end) : 0) : k === "bestWeek" ? r.start : r.at ?? 0;

// Keeps the best of what was stored and what was just read. `beaten`: the
// records you just set, improving on a stored one within the last week. A
// first reading beats nothing, and an older best found later (a repository
// read for the first time) updates the record quietly.
export function mergeRecords(stored, found, now = Date.now()) {
  const kept = { ...(stored ?? {}) }, beaten = [];
  for (const [k, better] of Object.entries(BETTER)) {
    const r = found[k];
    if (!r) continue;
    if (!kept[k]) kept[k] = r;
    else if (better(r, kept[k])) {
      kept[k] = r;
      if (stored?.[k] && now - recordAt(k, r) <= 7 * DAY) beaten.push(k);
    }
  }
  return { kept, beaten };
}

export function recordText(k, r) {
  if (k === "bestDay") return { value: fmt(r.n), unit: r.n === 1 ? "contribution" : "contributions", when: dayName(fromIsoDay(r.date)) };
  if (k === "longestStreak") return { value: fmt(r.n), unit: r.n === 1 ? "day" : "days", when: r.end ? `to ${dayName(fromIsoDay(r.end))}` : "" };
  if (k === "bestWeek") return { value: `+${fmt(r.add)}`, unit: "lines", when: `week of ${dayName(r.start)}` };
  if (k === "biggestPr") return { value: `+${fmt(r.add ?? r.lines)}`, unit: `#${r.number}`, when: r.repo ?? "" };
  return { value: duration(r.ms), unit: `#${r.number}`, when: r.repo ?? "" };
}

// The GitHub half: one query for the period, the one compared with, the
// last year's calendar and the last 100 merged pull requests.
export function githubQuery(cur, prev, now) {
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const span = (r) => `from:"${iso(r.start)}",to:"${iso(Math.max(r.start, Math.min(r.end, now) - 1000))}"`;
  const merged = (r) => `is:pr author:@me is:merged merged:${iso(r.start)}..${iso(Math.max(r.start, Math.min(r.end, now) - 1000))}`;
  const totals = "totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions";
  const yearAgo = now - 364 * DAY;
  return `query{viewer{login name
cal:contributionsCollection(from:"${iso(yearAgo)}",to:"${iso(now)}"){contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel weekday}}}}
cur:contributionsCollection(${span(cur)}){${totals}}
prev:contributionsCollection(${span(prev)}){${totals}}}
curMerged:search(query:"${merged(cur)}",type:ISSUE,first:0){issueCount}
prevMerged:search(query:"${merged(prev)}",type:ISSUE,first:0){issueCount}
recent:search(query:"is:pr author:@me is:merged sort:updated-desc",type:ISSUE,first:100){nodes{...on PullRequest{number title url createdAt mergedAt additions deletions repository{nameWithOwner}}}}}`;
}

const SEEN = "kanso.shipped.folders";

// The repositories you work in on this computer, once each (worktrees share
// one): where your panes are now, your spaces' folders, and the repositories
// seen before (kept, so one still counts after its panes close).
async function findRepos() {
  const seen = new Map();
  const here = [
    ...panes().filter((p) => p.cwd && !String(p.pane).includes("/")).map((p) => p.cwd),
    ...spaces().filter((s) => !s.machine && s.folder).map((s) => s.folder),
  ];
  const before = Array.isArray(shared(SEEN)) ? shared(SEEN) : [];
  const folders = [...new Set([...here, ...before])];
  await Promise.all(folders.map(async (folder) => {
    try {
      const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], { cwd: folder });
      if (r.code !== 0) return;
      const [common, top] = r.stdout.trim().split("\n");
      if (!common || seen.has(common)) return;
      const name = (common.endsWith("/.git") ? common.slice(0, -5) : top).replace(/\/+$/, "").split("/").pop();
      seen.set(common, { name, cwd: folder });
    } catch {}
  }));
  const repos = [...seen.values()];
  const keep = repos.map((r) => r.cwd);
  if (JSON.stringify(keep) !== JSON.stringify(before)) setShared(SEEN, keep);
  return repos;
}

// Your commits that landed in one repository since `since` (ms).
async function readRepo(repo, since, people) {
  const refs = await exec("git", ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/remotes/origin/develop", "refs/heads/main", "refs/heads/master"], { cwd: repo.cwd });
  const all = refs.code === 0 ? refs.stdout.split("\n").filter(Boolean) : [];
  const remote = all.filter((r) => r.startsWith("refs/remotes/"));
  const use = remote.length ? remote : all;
  if (!use.length) return [];
  const conf = await Promise.all(["user.email", "user.name"].map((k) => exec("git", ["config", k], { cwd: repo.cwd }).catch(() => null)));
  const who = [...new Set([...people, ...conf.map((r) => r?.code === 0 ? r.stdout.trim() : "")].filter(Boolean))];
  if (!who.length) return [];
  const r = await exec("git", ["log", ...use, "--no-merges", "-F", ...who.map((w) => `--author=${w}`), `--since=@${Math.floor(since / 1000)}`,
    "--format=%x1e%H %at", "--shortstat", "--", ".", ...NOT_YOURS.map((f) => `:(exclude,glob)**/${f}`)], { cwd: repo.cwd });
  return r.code === 0 ? parseLog(r.stdout) : [];
}

export class Shipped {
  init(cx) {
    this.kind = "week"; this.offset = 0;
    this.github = {}; // by period key: the query's data, or { error }
    this.repos = null; this.since = null; this.loading = false; this.pending = false;
    this.people = []; this.records = shared(RECORDS) ?? {}; this.fresh = new Set();
    this.reposOpen = false;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx, true));
  }

  key() { return `${this.kind}:${this.offset}`; }

  pick(kind, offset, cx) {
    this.kind = kind; this.offset = Math.min(0, offset);
    this.refresh(cx);
    cx.notify();
  }

  // GitHub first (it names you), then git in every repository. One read at a
  // time; a request during one runs after it, reading only what is missing.
  refresh(cx, again = false) {
    if (this.loading) { this.pending = this.pending || again || "missing"; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const key = this.key(), now = Date.now();
        const cur = periodRange(this.kind, this.offset, now), prev = comparedRange(this.kind, this.offset, now);
        if (again || !this.github[key]) { this.github[key] = await this.readGithub(cur, prev, now); cx.notify(); }
        const since = Math.min(prev.start, now - 365 * DAY);
        if (again || this.repos === null || since < this.since) { this.repos = await this.readGit(since); this.since = since; }
        this.checkRecords();
      } catch {}
      finally {
        this.loading = false;
        cx.notify();
        const next = this.pending; this.pending = false;
        if (next) this.refresh(cx, next === true);
      }
    });
  }

  async readGithub(cur, prev, now) {
    let r;
    try { r = await exec("gh", ["api", "graphql", "-f", `query=${githubQuery(cur, prev, now)}`]); }
    catch { return { error: "Install the GitHub CLI (gh) for pull requests, reviews and the streak." }; }
    if (r.code !== 0) return { error: (r.stderr || r.stdout).trim().split("\n")[0] || "GitHub could not be read." };
    try {
      const data = JSON.parse(r.stdout).data, v = data.viewer;
      this.people = [v.login, v.name, `${v.login}@users.noreply.github.com`].filter(Boolean);
      this.weeks = v.cal.contributionCalendar.weeks;
      this.days = this.weeks.flatMap((w) => w.contributionDays);
      this.recent = data.recent.nodes;
      return data;
    } catch { return { error: "GitHub's answer could not be read." }; }
  }

  async readGit(since) {
    const repos = await findRepos();
    return Promise.all(repos.map(async (repo) => ({ name: repo.name, commits: await readRepo(repo, since, this.people).catch(() => []) })));
  }

  // Once both halves are in: keep the bests, and toast the ones just beaten.
  checkRecords() {
    if (!this.days || this.repos === null) return;
    const { kept, beaten } = mergeRecords(shared(RECORDS), computeRecords({ days: this.days, repos: this.repos, recent: this.recent }));
    this.records = kept;
    setShared(RECORDS, kept);
    for (const k of beaten) {
      this.fresh.add(k);
      const t = recordText(k, kept[k]);
      notify({ title: `New record: ${RECORD_NAMES[k].toLowerCase()}`, body: `${t.value} ${t.unit}${t.when ? ` · ${t.when}` : ""}`, level: "success" });
    }
  }

  // ---- drawing, as Spend draws ----

  iconButton(id, icon, tip, onClick, c, options = {}) {
    const glyph = svg(`${ICON}${icon}.svg`).size(15).text_color(options.disabled ? c.border : c.muted);
    return Button.new(id).size(26).flex_none().items_center().justify_center().rounded(6)
      .when(!options.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(c.subtle)).on_click((_e, cx) => onClick(cx)))
      .accessibility_label(tip).tooltip(tip)
      .child(options.spin ? glyph.spin(900) : glyph);
  }

  section(c, title, note) {
    return h_flex().w_full().items_end().justify_between().pb(G.sm)
      .child(div().text_size(15).text_color(c.text).child(title))
      .child(div().text_size(12).text_color(c.dim).child(note ?? ""));
  }

  periods(c) {
    const tab = (kind) => {
      const on = this.kind === kind;
      return Button.new(`shipped-${kind}`).h(26).px(10).flex_none().items_center().rounded(6).cursor_pointer()
        .selected(on).when(on, (el) => el.bg(c.selected)).when(!on, (el) => el.hover((s) => s.bg(c.subtle)))
        .accessibility_label(PERIOD_NAMES[kind])
        .on_click((_e, cx) => this.pick(kind, 0, cx))
        .child(div().text_size(12).text_color(on ? c.text : c.muted).child(PERIOD_NAMES[kind]));
    };
    return h_flex().w_full().flex_wrap().gap(G.sm).items_center().justify_between()
      .child(h_flex().gap(G.xs).items_center().children(PERIODS.map(tab)))
      .child(h_flex().gap(G.xs).items_center()
        .child(this.iconButton("shipped-prev", "chevron-left", "Previous period", (cx) => this.pick(this.kind, this.offset - 1, cx), c))
        .child(div().min_w(96).text_center().text_size(12).text_color(c.text).child(periodLabel(this.kind, this.offset)))
        .child(this.iconButton("shipped-next", "chevron-right", "Next period", (cx) => this.pick(this.kind, this.offset + 1, cx), c, { disabled: this.offset >= 0 })));
  }

  hero(c, narrow) {
    const now = Date.now();
    const cur = periodRange(this.kind, this.offset, now), prev = comparedRange(this.kind, this.offset, now);
    const lines = this.repos ? sumLines(this.repos, cur.start, cur.end) : null;
    const before = this.repos ? sumLines(this.repos, prev.start, prev.end) : null;
    const gh = this.github[this.key()];
    const delta = lines && before && before.add > 0 ? Math.round(((lines.add - before.add) / before.add) * 100) : null;
    // Past double, a multiple reads better than a four-digit percentage.
    const deltaText = delta === null ? "" : delta >= 200 ? `${fmt(lines.add / before.add)}x` : `${delta >= 0 ? "+" : ""}${delta}%`;
    const big = narrow ? 40 : 56;
    const stats = [
      { value: gh?.curMerged ? fmt(gh.curMerged.issueCount) : "—", unit: "pull requests merged" },
      { value: lines ? fmt(lines.commits) : "—", unit: lines?.commits === 1 ? "commit landed" : "commits landed" },
      { value: gh?.viewer ? fmt(gh.viewer.cur.totalPullRequestReviewContributions) : "—", unit: "reviews" },
      { value: lines ? fmt(lines.byRepo.length) : "—", unit: lines?.byRepo.length === 1 ? "repository" : "repositories" },
    ];
    return v_flex().w_full().gap(G.lg)
      .child(v_flex().w_full().gap(G.xs)
        .child(h_flex().w_full().flex_wrap().items_end().gap(G.md)
          .child(div().text_size(big).line_height(1).font_light().text_color(c.text).child(lines ? `+${fmt(lines.add)}` : "…"))
          .child(div().pb(6).text_size(narrow ? 18 : 22).line_height(1).font_light().text_color(c.muted).child(lines ? `−${fmt(lines.del)}` : "")))
        .child(h_flex().w_full().flex_wrap().gap(G.sm).items_center()
          .child(div().text_size(13).text_color(c.muted).child(`lines shipped, ${periodLabel(this.kind, this.offset).toLowerCase()}`))
          .when(delta !== null, (el) => el.child(h_flex().gap(6).items_center()
            .child(div().size(6).rounded_full().bg(delta >= 0 ? c.green : c.red))
            .child(div().text_size(13).text_color(delta >= 0 ? c.green : c.red).child(`${deltaText} ${comparedLabel(this.kind, this.offset)}`))))))
      .child(h_flex().w_full().flex_wrap().gap(narrow ? G.lg : 32)
        .children(stats.map((s) => v_flex().gap(4)
          .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(c.text).child(s.value))
          .child(div().text_size(11).text_color(c.dim).child(s.unit)))))
      .when(Boolean(gh?.error), (el) => el.child(div().text_size(12).text_color(c.dim).child(gh.error)));
  }

  // The current streak, then the last 12 weeks as GitHub draws them, in the accent.
  streak(c) {
    if (!this.days) return null;
    const today = isoDay(new Date());
    const { current, longest } = streaks(this.days, today);
    const level = { NONE: null, FIRST_QUARTILE: "40", SECOND_QUARTILE: "70", THIRD_QUARTILE: "b0", FOURTH_QUARTILE: "ff" };
    const weeks = (this.weeks ?? []).slice(-HEAT_WEEKS);
    const cell = (d) => {
      const a = d ? level[d.contributionLevel] : null;
      return div().size(11).rounded(2).bg(a ? c.accent + a : c.subtle)
        .when(Boolean(d), (el) => el.tooltip(`${fmt(d.contributionCount)} on ${dayName(fromIsoDay(d.date))}`));
    };
    return v_flex().w_full().gap(G.md)
      .child(this.section(c, "Streak", `longest ${fmt(longest.n)} ${longest.n === 1 ? "day" : "days"}`))
      .child(h_flex().w_full().flex_wrap().items_end().gap(G.xl)
        .child(v_flex().gap(4)
          .child(h_flex().items_end().gap(G.sm)
            .child(div().text_size(40).line_height(1).font_light().text_color(c.text).child(fmt(current)))
            .when(current > 0, (el) => el.child(div().mb(8).size(8).rounded_full().bg(c.accent))))
          .child(div().text_size(11).text_color(c.dim).child(current === 1 ? "day in a row" : "days in a row")))
        .child(h_flex().gap(3).children(weeks.map((w) => {
          const byDay = new Map(w.contributionDays.map((d) => [d.weekday, d]));
          return v_flex().gap(3).children([0, 1, 2, 3, 4, 5, 6].map((i) => cell(byDay.get(i))));
        }))));
  }

  recordsList(c) {
    const keys = Object.keys(RECORD_NAMES).filter((k) => this.records[k]);
    if (!keys.length) return null;
    return v_flex().w_full()
      .child(this.section(c, "Records", this.fresh.size ? `${this.fresh.size} new` : "your bests"))
      .children(keys.map((k, i) => {
        const r = this.records[k], t = recordText(k, r), fresh = this.fresh.has(k);
        return h_flex().id(`record-${k}`).w_full().py(10).gap(G.md).items_center()
          .when(i > 0, (el) => el.border_t_1().border_color(c.border))
          .when(Boolean(r.url), (el) => el.cursor_pointer().hover((s) => s.bg(c.subtle)).on_click(() => exec("open", [r.url]).catch(() => exec("xdg-open", [r.url])).catch(() => {})))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(h_flex().gap(G.sm).items_center()
              .child(div().text_size(13).text_color(c.text).child(RECORD_NAMES[k]))
              .when(fresh, (el) => el.child(div().px(6).py(1).rounded(6).bg(c.accent + "26").text_size(11).text_color(c.accent).child("New record"))))
            .child(div().truncate().text_size(11.5).text_color(c.dim).child([r.title, t.when].filter(Boolean).join(" · "))))
          .child(h_flex().flex_none().items_end().gap(6)
            .child(div().text_size(20).line_height(1).font_light().text_color(fresh ? c.accent : c.text).child(t.value))
            .child(div().text_size(11).text_color(c.dim).child(t.unit)));
      }));
  }

  byRepo(c) {
    if (!this.repos) return null;
    const now = Date.now(), cur = periodRange(this.kind, this.offset, now);
    const { byRepo } = sumLines(this.repos, cur.start, cur.end);
    if (!byRepo.length) return v_flex().w_full().child(this.section(c, "By repository", "")).child(div().text_size(12).text_color(c.dim).child("Nothing landed in this period yet."));
    const top = Math.max(...byRepo.map((r) => r.add + r.del)), rows = this.reposOpen ? byRepo : byRepo.slice(0, REPO_ROWS);
    return v_flex().w_full()
      .child(this.section(c, "By repository", `${byRepo.length}`))
      .children(rows.map((r, i) => v_flex().w_full().py(G.sm).gap(6)
        .when(i > 0, (el) => el.border_t_1().border_color(c.border))
        .child(h_flex().w_full().gap(G.md).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).child(r.name))
          .child(div().flex_none().text_size(12).text_color(c.dim).child(`${fmt(r.commits)} · +${fmt(r.add)} −${fmt(r.del)}`)))
        .child(h_flex().w_full().h(4).rounded(2).bg(c.subtle)
          .child(div().h_full().rounded(2).bg(c.accent).w(`${(Math.max(0.02, (r.add + r.del) / top) * 100).toFixed(1)}%`)))))
      .when(byRepo.length > REPO_ROWS, (el) => el.child(h_flex().pt(G.sm).child(Button.new("shipped-repos-more").cursor_pointer()
        .on_click((_e, cx) => { this.reposOpen = !this.reposOpen; cx.notify(); })
        .child(div().text_size(12).text_color(c.muted).child(this.reposOpen ? "Show fewer" : `Show ${byRepo.length - REPO_ROWS} more`)))));
  }

  render(cx) {
    const c = tokens(theme());
    const narrow = (this.width || 368) < 560;
    const loading = this.loading;
    const body = this.repos === null && !this.github[this.key()]
      ? v_flex().w_full().gap(G.sm).child(div().text_size(15).text_color(c.muted).child("Adding up what you shipped")).child(div().text_size(12).text_color(c.dim).child("This takes a second."))
      : v_flex().w_full().gap(narrow ? 36 : 48)
        .child(this.hero(c, narrow))
        .when(Boolean(this.days), (el) => el.child(this.streak(c)))
        .when(Object.keys(this.records).length > 0, (el) => el.child(this.recordsList(c)))
        .child(this.byRepo(c))
        .child(div().text_size(10.5).text_color(c.dim).child("Lines and commits: git in the repositories you work in here, what landed on origin's main, master or develop as of your last fetch, without merges or lockfiles. Pull requests, reviews and the streak: GitHub, through gh."));
    return v_flex().id("kanso-shipped").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => { if (Math.abs((this.width || 0) - size.width) >= 1) { this.width = size.width; sizeCx.notify(); } })
      .child(h_flex().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(h_flex().w_full().items_center().justify_between().gap(G.md)
            .child(div().truncate().text_size(narrow ? 17 : 20).text_color(c.text).child("Shipped"))
            .child(this.iconButton("shipped-refresh", "refresh", "Refresh", (cx) => this.refresh(cx, true), c, { spin: loading })))
          .child(this.periods(c))
          .child(body)));
  }
}
