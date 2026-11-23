import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { databaseTimer, load, context, temporary, clone, exec as run, nativeWindow, success, failure, textFiles } from "./helpers.mjs";

const names = ["Shipped", "periodRange", "comparedRange", "periodLabel", "streaks", "computeRecords", "mergeRecords", "periodQuery",
  "REPOS", "fmt", "yourWeeks", "weekAt", "sumWeeks", "heatLayout", "contributionsIn"];
const shipped = (host = {}) => load("kanso-panel/shipped.js", names, { Share: class { constructor() { this.open = false; } }, ...host });
const DAY = 86400000;
// GitHub's week keys: Sunday 00:00 UTC, in seconds.
const sunday = (y, m, d) => Date.UTC(y, m, d) / 1000;

test("Shipped's periods are local calendar spans, compared at the same point", async () => {
  const { periodRange, comparedRange, periodLabel } = await shipped();
  const now = new Date(2026, 10, 4, 15, 0).getTime(); // Wednesday 4 Nov, 15:00
  const week = periodRange("week", 0, now);
  assert.equal(new Date(week.start).getDay(), 1, "weeks start on Monday");
  assert.equal(week.end - week.start, 7 * DAY);
  const before = comparedRange("month", 0, now), month = periodRange("month", 0, now);
  assert.equal(before.end - before.start, now - month.start, "this point last month, not the whole month");
  assert.equal(comparedRange("week", -1, now).end, week.start - 7 * DAY, "a past period compares whole");
  assert.equal(periodLabel("week", -2, now), "19 Oct – 25 Oct");
  assert.equal(periodLabel("month", -1, now), "October 2026");
});

test("Shipped adds up GitHub's weekly sums, yours only, by repository", async () => {
  const { yourWeeks, sumWeeks, weekAt, periodRange } = await shipped();
  const body = [
    { author: { login: "someone" }, weeks: [{ w: sunday(2026, 9, 25), a: 999, d: 9, c: 9 }] },
    { author: { login: "Me" }, weeks: [{ w: sunday(2026, 9, 18), a: 0, d: 0, c: 0 }, { w: sunday(2026, 9, 25), a: 120, d: 20, c: 3 }, { w: sunday(2026, 10, 1), a: 50, d: 5, c: 2 }] },
  ];
  const mine = clone(yourWeeks(body, "me"));
  assert.equal(mine.length, 2, "empty weeks are not kept");
  assert.deepEqual(mine[0], [sunday(2026, 9, 25) * 1000, 120, 20, 3]);
  assert.equal(yourWeeks({}, "me"), null, "{}: GitHub is still computing");
  assert.deepEqual(clone(yourWeeks([{ author: { login: "x" }, weeks: [] }], "me")), [], "not a contributor there");

  // A GitHub week (from Sunday, UTC) lands in the local week from the Monday after.
  const monday = periodRange("week", 0, new Date(2026, 10, 3).getTime());
  assert.ok(weekAt(sunday(2026, 10, 1) * 1000) >= monday.start && weekAt(sunday(2026, 10, 1) * 1000) < monday.end);

  const stats = { repos: { "org/app": { weeks: mine }, "me/tool": { weeks: [[sunday(2026, 10, 1) * 1000, 400, 0, 9]] }, "org/old": { weeks: [] } } };
  const week = clone(sumWeeks(stats, monday.start, monday.end));
  assert.deepEqual([week.add, week.del, week.commits], [450, 5, 11]);
  assert.deepEqual(week.byRepo.map((r) => r.name), ["me/tool", "org/app"], "most lines first, any organization");
  assert.equal(clone(sumWeeks(stats, 0, Infinity)).add, 570, "all time");
});

test("Shipped's streaks, contributions and records", async () => {
  const { streaks, computeRecords, mergeRecords, contributionsIn, fmt } = await shipped();
  const days = [3, 0, 1, 2, 5, 0, 4, 6, 1, 0].map((n, i) => ({ date: `2026-10-${String(20 + i).padStart(2, "0")}`, contributionCount: n }));
  assert.deepEqual(clone(streaks(days, "2026-10-29")), { current: 3, longest: { n: 3, end: "2026-10-24" } }, "today without one yet keeps the run");
  assert.equal(contributionsIn(days, new Date(2026, 9, 26).getTime(), new Date(2026, 9, 28).getTime(), null), 10, "the calendar's days, private ones included");
  const totals = { totalCommitContributions: 10, totalPullRequestContributions: 2, totalPullRequestReviewContributions: 1, totalIssueContributions: 0, restrictedContributionsCount: 30 };
  assert.equal(contributionsIn(days, new Date(2026, 0, 1).getTime(), new Date(2026, 1, 1).getTime(), totals), 43, "before the calendar: the totals");

  const stats = { repos: {
    a: { weeks: [[sunday(2026, 9, 4) * 1000, 100, 0, 2], [sunday(2026, 9, 11) * 1000, 700, 0, 30], [sunday(2026, 8, 6) * 1000, 50, 0, 1]] },
    b: { weeks: [[sunday(2026, 9, 11) * 1000, 300, 0, 5]] },
  } };
  const found = clone(computeRecords({ days, stats }));
  assert.equal(found.bestDay.n, 6);
  assert.equal(found.longestStreak.n, 3);
  assert.equal(found.bestWeek.add, 1000, "every repository's week together");
  assert.equal(found.busiestWeek.n, 35);
  assert.equal(found.bestMonth.add, 1100);
  assert.equal(new Date(found.bestMonth.start).getMonth(), 9);

  const first = clone(mergeRecords(null, found));
  assert.deepEqual(first.beaten, [], "a first reading beats nothing");
  const now = new Date(2026, 9, 21).getTime();
  const later = clone(mergeRecords(first.kept, { ...found, bestWeek: { add: 5000, start: new Date(2026, 9, 19).getTime() }, bestDay: { n: 2, date: "2026-10-01" } }, now));
  assert.deepEqual(later.beaten, ["bestWeek"]);
  assert.equal(later.kept.bestDay.n, 6, "a lower reading never lowers a record");
  const old = clone(mergeRecords(later.kept, { ...found, bestWeek: { add: 9000, start: new Date(2026, 5, 1).getTime() } }, now));
  assert.deepEqual(old.beaten, [], "an older best found later updates quietly");
  assert.equal(fmt(6466284), "6,466,284");
});

test("Shipped's heat map fills the width, up to a year", async () => {
  const { heatLayout } = await shipped();
  for (const width of [300, 336, 520, 760, 1080]) {
    const { weeks, cell } = clone(heatLayout(width));
    assert.ok(weeks * cell + (weeks - 1) * 3 <= width, `${width}: fits`);
    assert.ok(cell >= 9 && cell <= 16);
    assert.ok(weeks === 53 || width - (weeks * cell + (weeks - 1) * 3) < cell + 3, `${width}: no room left for another week`);
  }
  assert.equal(heatLayout(1080).weeks, 53, "a wide panel shows the whole year");
});

test("Shipped's queries ask GitHub for sums, never lists of pull requests", async () => {
  const { periodQuery, REPOS } = await shipped();
  const now = Date.UTC(2026, 10, 4, 12);
  const q = periodQuery({ start: now - DAY, end: now + DAY }, { start: now - 3 * DAY, end: now - 2 * DAY }, now);
  assert.match(q, /cur:contributionsCollection\(from:"2026-11-03T12:00:00Z",to:"2026-11-04T11:59:59Z"\)/, "never past now");
  assert.match(q, /restrictedContributionsCount/, "private contributions count too");
  assert.match(q, /merged:2026-11-03T12:00:00Z\.\.2026-11-04T11:59:59Z/);
  assert.match(q, /ever:search\(query:"is:pr author:@me is:merged"/);
  assert.doesNotMatch(q, /first:[1-9]/, "counts only");
  assert.match(REPOS, /repositoriesContributedTo/);
  assert.match(REPOS, /ORGANIZATION_MEMBER/);
});

// GitHub as the panel sees it; sqlite3, git and the rest run for real.
function github({ computing = new Set(), weeks = {}, gistFiles = {} } = {}) {
  const calls = [];
  const repos = Object.keys(weeks);
  const exec = async (command, args, options) => {
    if (command === "sleep" || command === "pwsh" && args.at(-1).includes("Start-Sleep")) return success("");
    if (command === "git" && args[0] === "config" && args[1] === "--global") return failure("unset in fixture");
    if (command !== "gh") return run(command, args, options);
    if (args[1].startsWith("gists?")) {
      calls.push("gist list");
      return success(Object.keys(gistFiles).length ? "g1\n" : "");
    }
    if (args[2] === "POST" || args[2] === "PATCH") {
      calls.push(`gist ${args[2]}`);
      return success(JSON.stringify({ id: "g1", files: gistFiles }));
    }
    if (args[1] !== "graphql") {
      const name = args[1].replace(/^repos\//, "").replace(/\/stats\/contributors$/, "");
      calls.push(`stats ${name}`);
      if (computing.has(name)) { computing.delete(name); return success("{}"); }
      return success(JSON.stringify([{ author: { login: "me" }, weeks: weeks[name] }]));
    }
    const query = args[3].slice("query=".length);
    if (query.startsWith("query{viewer")) {
      calls.push("period");
      const today = new Date();
      const day = (i, n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, contributionCount: n, contributionLevel: n ? "FOURTH_QUARTILE" : "NONE", weekday: d.getDay() }; };
      const totals = { totalCommitContributions: 40, totalPullRequestContributions: 9, totalPullRequestReviewContributions: 3, totalIssueContributions: 0, restrictedContributionsCount: 100 };
      return success(JSON.stringify({ data: {
        viewer: { login: "me", name: "Me", createdAt: "2011-01-01T00:00:00Z",
          cal: { contributionCalendar: { weeks: [{ contributionDays: [day(2, 5), day(1, 7), day(0, 2)] }] } }, cur: totals, prev: totals },
        curMerged: { issueCount: 3 }, prevMerged: { issueCount: 1 }, ever: { issueCount: 4321 },
      } }));
    }
    calls.push("repos");
    const half = Math.ceil(repos.length / 2), node = (n) => ({ nameWithOwner: n, pushedAt: "2026-11-01T00:00:00Z" });
    return success(JSON.stringify({ data: { viewer: { databaseId: 1,
      contributed: { pageInfo: { hasNextPage: false }, nodes: repos.slice(0, half).map(node) },
      access: { pageInfo: { hasNextPage: false }, nodes: repos.slice(half).map(node) },
    } } }));
  };
  return { exec, calls };
}

// The Shipped panel opened on `gh`, settled.
const shownPanel = async (t, gh, pieces = {}) => {
  const p = await panelWith(t, gh, pieces);
  const panel = new p.Shipped();
  panel.init(p.cx); await p.settle();
  return { p, panel };
};

async function panelWith(t, gh, pieces) {
  const root = await temporary(t);
  const home = join(root, "app");
  const store = { "kanso.pieces": pieces }, toasts = [];
  const host = {
    window: nativeWindow, exec: gh.exec, appHome: () => home, home: () => join(root, "home"), spaces: () => [], panes: () => [], theme: () => ({}),
    shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify: (n) => { toasts.push(n); return "1"; },
    ...textFiles,
  };
  const { Store } = await load("kanso-panel/shipped-store.js", ["Store"], host);
  const mod = await shipped({ ...host, Store });
  const { cx, drain } = context();
  cx.timer = { after: databaseTimer.after, every() {} };
  const settle = async () => { for (let i = 0; i < 40; i++) await drain(); };
  return { ...mod, home, store, toasts, cx, settle };
}

const gistCalls = ({ calls }) => calls.filter((call) => call.startsWith("gist "));

test("Shipped refreshes this computer's stats without asking for a gist by default", async (t) => {
  const gh = github({ weeks: { "org/app": [{ w: 1793491200, a: 3, d: 0, c: 1 }] } });
  const { panel } = await shownPanel(t, gh);
  assert.ok(panel.stats.repos["org/app"]);
  assert.deepEqual(gistCalls(gh), []);
});

test("Shipped asks each repository for its sums once, and again only after a push", async (t) => {
  const thisWeek = Math.floor((Date.now() - new Date().getUTCDay() * DAY) / DAY) * DAY / 1000;
  const weeks = {
    "org/app": [{ w: thisWeek, a: 1200, d: 300, c: 12 }, { w: thisWeek - 7 * 86400, a: 80, d: 8, c: 2 }],
    "me/tool": [{ w: thisWeek, a: 15, d: 1, c: 1 }],
    "other-org/thing": [{ w: thisWeek - 200 * 86400, a: 5000, d: 0, c: 40 }],
  };
  const gh = github({ weeks, computing: new Set(["me/tool"]) });
  const { p, panel } = await shownPanel(t, gh, { "shipped.sync": "show" });

  assert.equal(Object.keys(panel.stats.repos).length, 3, "contributed to and reachable, every organization");
  assert.equal(gh.calls.filter((c) => c === "stats me/tool").length, 2, "asked again while GitHub computed it");
  const all = clone(p.sumWeeks(panel.stats, 0, Infinity));
  assert.deepEqual([all.add, all.commits], [6295, 55]);
  assert.deepEqual(gistCalls(gh), ["gist list", "gist POST", "gist PATCH"], "this computer created the gist and published to it when enabled");
  assert.equal(p.toasts.length, 0, "the first reading sets records quietly");
  assert.equal(p.store["kanso.shipped.bests"].bestWeek.add, 5000);

  // Later: nothing pushed since, so no repository is asked again; the store has it.
  gh.calls.length = 0;
  const again = new p.Shipped();
  again.init(p.cx); await p.settle();
  assert.deepEqual(gh.calls.filter((c) => c.startsWith("stats")), [], "read from the store");
  assert.equal(Object.keys(again.stats.repos).length, 3);
  assert.equal(again.github[again.key()].ever.issueCount, 4321);
});

test("Shipped preserves existing scans until it learns identity seals for the next refresh", async (t) => {
  const key = "g1";
  const identitySeal = createHash("sha256").update(`${key}\nmequexample.invalid`).digest("hex");
  const other = { v: 2, machine: "other", identities: [identitySeal], repos: [], commits: [] };
  const gh = github({ gistFiles: { "shipped-other.json": { content: JSON.stringify(other) } } });
  const { p, panel } = await shownPanel(t, gh);
  const identities = ["me", "Me", "me@users.noreply.github.com", "1+me@users.noreply.github.com"];
  const legacyKey = JSON.stringify(identities.toSorted());
  assert.equal(await panel.store.meta("scanned-identities"), legacyKey);
  await panel.store.sql("INSERT INTO scans(path,repo,refs,scanned) VALUES('cached','org/tool','unchanged',1);");
  const scan = panel.store.scanLocal.bind(panel.store);
  const passed = [];
  panel.store.scanLocal = (...args) => { passed.push(clone(args)); return scan(...args); };

  p.store["kanso.pieces"] = { "shipped.sync": "show" };
  panel.refresh(p.cx, true);
  await p.settle();
  assert.equal(await panel.store.meta("scanned-identities"), legacyKey);
  assert.equal((await panel.store.sql("SELECT path FROM scans;", true))[0]?.path, "cached");
  const sealed = { key, seals: [identitySeal] };
  assert.deepEqual(JSON.parse(await panel.store.meta("identity-seals")), sealed);

  panel.refresh(p.cx, true);
  await p.settle();
  assert.equal(panel.syncError, null);
  assert.equal(passed.length, 2);
  assert.equal(passed[0][2], null);
  assert.deepEqual(passed[1][0], identities);
  assert.deepEqual(passed[1][2], sealed);
  assert.equal(await panel.store.meta("scanned-identities"), JSON.stringify([...identities, identitySeal].toSorted()));
  assert.equal((await panel.store.sql("SELECT path FROM scans;", true)).length, 0);
});

test("Shipped keeps going when GitHub keeps computing a repository", async (t) => {
  const gh = github({ weeks: { "org/slow": [], "org/fine": [{ w: 1793491200, a: 3, d: 0, c: 1 }] } });
  const always = gh.exec;
  gh.exec = async (command, args, options) => (command === "gh" && args[1] === "repos/org/slow/stats/contributors" ? success("{}") : always(command, args, options));
  const { p, panel } = await shownPanel(t, gh);
  assert.equal(panel.syncing, false, "it stops waiting, and asks again next time");
  assert.equal(panel.syncError, null);
  assert.ok(panel.stats.repos["org/fine"]);
  assert.ok(p.store["kanso.shipped.bests"].bestDay, "records still come from what is in");
});
