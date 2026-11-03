import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, context, exec, temporary, clone } from "./helpers.mjs";

const names = ["Shipped", "periodRange", "comparedRange", "periodLabel", "parseLog", "sumLines", "streaks", "computeRecords", "mergeRecords", "githubQuery", "fmt", "duration"];
const shipped = (host = {}) => load("kanso-panel/shipped.js", names, host);
const DAY = 86400000;

test("Shipped's periods are local calendar spans, compared at the same point", async () => {
  const { periodRange, comparedRange, periodLabel } = await shipped();
  const now = new Date(2026, 10, 4, 15, 0).getTime(); // Wednesday 4 Nov, 15:00
  const week = periodRange("week", 0, now);
  assert.equal(new Date(week.start).getDay(), 1, "weeks start on Monday");
  assert.equal(new Date(week.start).getDate(), 2);
  assert.equal(week.end - week.start, 7 * DAY);
  const before = comparedRange("week", 0, now);
  assert.equal(before.start, week.start - 7 * DAY);
  assert.equal(before.end - before.start, now - week.start, "this point last week, not the whole week");
  assert.equal(comparedRange("week", -1, now).end, week.start - 7 * DAY, "a past period compares whole");
  assert.equal(new Date(periodRange("month", -1, now).start).getMonth(), 9);
  assert.equal(new Date(periodRange("year", 0, now).start).getMonth(), 0);
  assert.equal(periodLabel("week", 0, now), "This week");
  assert.equal(periodLabel("week", -2, now), "19 Oct – 25 Oct");
  assert.equal(periodLabel("day", -1, now), "Yesterday");
  assert.equal(periodLabel("month", -1, now), "October 2026");
});

test("Shipped's streaks and records", async () => {
  const { streaks, computeRecords, mergeRecords, duration, fmt } = await shipped();
  const days = [3, 0, 1, 2, 5, 0, 4, 6, 1, 0].map((n, i) => ({ date: `2026-10-${String(20 + i).padStart(2, "0")}`, contributionCount: n }));
  assert.deepEqual(clone(streaks(days, "2026-10-29")), { current: 3, longest: { n: 3, end: "2026-10-24" } }, "today without one yet keeps the run");
  assert.equal(streaks(days, "2026-10-30").current, 0);
  const recent = [
    { number: 1, title: "Small", createdAt: "2026-10-01T00:00:00Z", mergedAt: "2026-10-01T00:04:00Z", additions: 10, deletions: 2, repository: { nameWithOwner: "o/a" } },
    { number: 2, title: "Big", createdAt: "2026-10-01T00:00:00Z", mergedAt: "2026-10-02T00:00:00Z", additions: 900, deletions: 100, repository: { nameWithOwner: "o/b" } },
  ];
  const repos = [{ name: "a", commits: [{ at: new Date(2026, 9, 5).getTime(), add: 50, del: 1 }, { at: new Date(2026, 9, 6).getTime(), add: 70, del: 1 }, { at: new Date(2026, 9, 20).getTime(), add: 30, del: 0 }] }];
  const found = clone(computeRecords({ days, repos, recent }));
  assert.equal(found.bestDay.n, 6);
  assert.equal(found.longestStreak.n, 3);
  assert.equal(found.bestWeek.add, 120);
  assert.equal(found.biggestPr.number, 2);
  assert.equal(found.fastestMerge.number, 1);
  assert.equal(found.fastestMerge.ms, 4 * 60 * 1000);

  const first = clone(mergeRecords(null, found));
  assert.deepEqual(first.beaten, [], "a first reading beats nothing");
  const now = new Date(2026, 9, 21).getTime();
  const later = clone(mergeRecords(first.kept, { ...found, bestWeek: { add: 500, start: new Date(2026, 9, 19).getTime() }, bestDay: { n: 2, date: "2026-10-01" } }, now));
  assert.deepEqual(later.beaten, ["bestWeek"]);
  assert.equal(later.kept.bestDay.n, 6, "a lower reading never lowers a record");
  const old = clone(mergeRecords(later.kept, { ...found, bestWeek: { add: 900, start: new Date(2026, 5, 1).getTime() } }, now));
  assert.deepEqual(old.beaten, [], "an older best found later updates quietly");
  assert.equal(old.kept.bestWeek.add, 900);
  assert.equal(duration(4 * 60 * 1000), "4 min");
  assert.equal(fmt(12480), "12,480");
});

test("Shipped's GitHub query asks for the period, the one compared, the calendar and recent merges", async () => {
  const { githubQuery } = await shipped();
  const now = Date.UTC(2026, 10, 4, 12);
  const q = githubQuery({ start: now - DAY, end: now + DAY }, { start: now - 3 * DAY, end: now - 2 * DAY }, now);
  assert.match(q, /cur:contributionsCollection\(from:"2026-11-03T12:00:00Z",to:"2026-11-04T11:59:59Z"\)/, "never past now");
  assert.match(q, /merged:2026-11-03T12:00:00Z\.\.2026-11-04T11:59:59Z/);
  assert.match(q, /totalPullRequestReviewContributions/);
  assert.match(q, /contributionCalendar/);
  assert.match(q, /first:100/);
});

// A repository with your commits on origin/main, someone else's, a lockfile
// and a branch that has not landed.
async function repo(t) {
  const cwd = await temporary(t);
  const git = async (...args) => {
    const r = await exec("git", args, { cwd });
    assert.equal(r.code, 0, r.stderr);
    return r.stdout;
  };
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Me Myself");
  await git("config", "user.email", "me@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", cwd);
  const commit = async (file, lines, who) => {
    await mkdir(join(cwd, file, ".."), { recursive: true });
    await writeFile(join(cwd, file), Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") + "\n");
    await git("add", "-A");
    await git(...(who ? ["-c", `user.name=${who}`, "-c", `user.email=${who}@example.invalid`] : []), "commit", "-q", "-m", file);
  };
  await commit("src/a.js", 40);
  await commit("pnpm-lock.yaml", 500);
  await commit("web/package-lock.json", 300);
  await commit("src/b.js", 7, "colleague");
  await commit("src/c.js", 12);
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("checkout", "-q", "-b", "wip");
  await commit("src/wip.js", 99);
  return cwd;
}

test("Shipped counts your lines that landed, not lockfiles, colleagues or open branches", async (t) => {
  const cwd = await repo(t);
  const store = {}, toasts = [], calls = [];
  const day = (date, n) => ({ date, contributionCount: n, contributionLevel: n ? "FIRST_QUARTILE" : "NONE", weekday: new Date(date).getUTCDay() });
  const github = {
    viewer: {
      login: "me", name: "Me Myself",
      cal: { contributionCalendar: { weeks: [{ contributionDays: [day("2026-10-01", 2), day("2026-10-02", 3)] }] } },
      cur: { totalCommitContributions: 2, totalPullRequestContributions: 1, totalPullRequestReviewContributions: 4 },
      prev: { totalCommitContributions: 1, totalPullRequestContributions: 1, totalPullRequestReviewContributions: 1 },
    },
    curMerged: { issueCount: 5 }, prevMerged: { issueCount: 2 },
    recent: { nodes: [] },
  };
  const host = {
    // A space's folder is where new terminals start, not where its panes are.
    spaces: () => [{ folder: "/nowhere/at/all", machine: null }, { folder: "/remote/thing", machine: "box" }],
    panes: () => [
      { pane: "p1", cwd }, { pane: "p2", cwd: join(cwd, "src") }, // the same repository twice
      { pane: "box/p3", cwd: "/remote/repo" },
    ],
    theme: () => ({}),
    shared: (k) => store[k], setShared: (k, v) => { store[k] = v; },
    notify: (n) => { toasts.push(n); return "1"; },
    exec: async (command, args, options) => {
      calls.push([command, ...args].join(" "));
      if (command === "gh") return { code: 0, stdout: JSON.stringify({ data: github }), stderr: "" };
      return exec(command, args, options);
    },
  };
  const { Shipped, sumLines } = await shipped(host);
  const panel = new Shipped();
  const { cx, drain } = context();
  cx.timer = { every() {} };
  panel.init(cx); await drain();

  assert.equal(panel.repos.length, 1, "one repository, read once");
  const lines = clone(sumLines(panel.repos, 0, Date.now() + DAY));
  assert.equal(lines.commits, 2, "your two commits on origin/main");
  assert.equal(lines.add, 52, "40 + 12: no lockfiles, no colleague, no unlanded branch");
  assert.ok(!calls.some((c) => c.includes("/remote/")), "other machines are not read here");
  assert.deepEqual(clone(store["kanso.shipped.folders"]), [cwd], "remembered for when its panes close");
  assert.equal(panel.github[panel.key()].curMerged.issueCount, 5);
  assert.deepEqual(clone(store["kanso.shipped.records"]).bestDay, { n: 3, date: "2026-10-02" });
  assert.equal(toasts.length, 0, "the first reading sets records quietly");

  // A better day today, which also makes the run three days long: one toast each.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const t0 = new Date();
  github.viewer.cal.contributionCalendar.weeks[0].contributionDays = [-2, -1, 0].map((i) => day(iso(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i)), i === 0 ? 9 : 1));
  panel.refresh(cx, true); await drain();
  assert.deepEqual(toasts.map((n) => n.title), ["New record: best day", "New record: longest streak"]);
  assert.ok(panel.fresh.has("bestDay"));
  panel.refresh(cx, true); await drain();
  assert.equal(toasts.length, 2, "a record toasts once");
});
