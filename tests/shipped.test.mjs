import assert from "node:assert/strict";
import test from "node:test";
import { context, databaseTimer, exec, gpuiHost, load, same, success, texts } from "./helpers.mjs";
import { DAY, HOUR, iso, openedShippedStore, pullRequest, shippedHost, shippedStore } from "./shipped-fixture.mjs";

const monthAt = (month, day = 1) => new Date(2026, month - 1, day).getTime();
const shipped = (names, host) => load("kanso-panel/shipped.js", names, host);
const provider = (names, host) => load("kanso-panel/shipped-github.js", names, host);
const pageInfo = (endCursor = null) => ({ hasNextPage: endCursor !== null, endCursor });
const search = (nodes, { issueCount = nodes.length, cursor = null } = {}) =>
  ({ search: { issueCount, nodes, pageInfo: pageInfo(cursor) } });
const history = (oids, cursor = null) => ({
  repository: { ref: { target: { history: { nodes: oids.map((oid) => ({ oid })), pageInfo: pageInfo(cursor) } } } },
});
const withGitHub = (read) => async (command, args, options) => {
  if (command !== "gh") return exec(command, args, options);
  assert.deepEqual([args[0], args[1]], ["api", "graphql"]);
  const fields = Object.fromEntries(args.slice(2).filter((_, i) => i % 2 === 1).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
  const { query, ...vars } = fields;
  return success(JSON.stringify({ data: await read(query, vars) }));
};
const syncedGitHub = async (t, read) => {
  const searches = [];
  const host = await shippedHost(t, { exec: withGitHub((_query, vars) => {
    if (vars.q) searches.push(vars.q);
    return read(vars, searches);
  }) });
  const store = await openedShippedStore(host);
  const { github } = await provider(["github"], host);
  return { store, github, searches };
};

const createdQuery = (start, end) => `is:pr author:@me created:${iso(start)}..${iso(end - 1000)}`;

test("Shipped's weeks start on Monday and older periods show their calendar dates.", async () => {
  const { periodRange, periodLabel } = await shipped(["periodRange", "periodLabel"]);
  const now = monthAt(11, 4);
  same(periodRange("week", 0, now), { start: monthAt(11, 2), end: monthAt(11, 9) });
  assert.equal(periodLabel("week", -2, now), "19 Oct – 25 Oct");
  assert.equal(periodLabel("month", -1, now), "October 2026");
});

test("Shipped keeps today's streak and counts contributions, including private ones.", async () => {
  const { streaks, contributionsIn, periodQuery } = await shipped(["streaks", "contributionsIn", "periodQuery"]);
  const days = [2, 5, 0].map((contributionCount, i) => ({ date: `2026-11-0${2 + i}`, contributionCount }));
  same(streaks(days, "2026-11-04"), { current: 2, longest: { n: 2, end: "2026-11-03" } });
  assert.equal(contributionsIn(days, monthAt(11, 2), monthAt(11, 4), null), 7);
  const totals = { totalCommitContributions: 10, totalPullRequestContributions: 2, totalPullRequestReviewContributions: 1, totalIssueContributions: 0, restrictedContributionsCount: 30 };
  assert.equal(contributionsIn(days, monthAt(10), monthAt(11), totals), 43);
  const now = Date.UTC(2026, 10, 4, 12);
  const q = periodQuery({ start: now - DAY, end: now + DAY }, { start: now - 3 * DAY, end: now - 2 * DAY }, now);
  assert.match(q, /cur:contributionsCollection\(from:"2026-11-03T12:00:00Z",to:"2026-11-04T11:59:59Z"\)/);
  assert.match(q, /restrictedContributionsCount/);
  assert.match(q, /ever:search\(query:"is:pr author:@me is:merged"/);
});

test("Shipped's heat map fits the panel and shows up to a year.", async () => {
  const { heatLayout } = await shipped(["heatLayout"]);
  for (const width of [300, 336, 520, 760, 1080]) {
    const { weeks, cell } = heatLayout(width);
    assert.ok(weeks * cell + (weeks - 1) * 3 <= width, `${width}: fits`);
    assert.ok(cell >= 9 && cell <= 16);
  }
  assert.equal(heatLayout(1080).weeks, 53);
});

test("Shipped splits a GitHub search over 1,000 pull requests and collects the pages from both halves.", async () => {
  const { prsCreated, SEARCH } = await provider(["prsCreated", "SEARCH"]);
  const start = Date.UTC(2026, 10, 4), mid = start + 12 * HOUR, end = start + DAY;
  const full = createdQuery(start, end), left = createdQuery(start, mid), right = createdQuery(mid, end);
  const calls = [];
  const read = async (query, { q, after }) => {
    assert.equal(query, SEARCH);
    calls.push([q, after]);
    if (q === full) return search([pullRequest(999, start)], { issueCount: 1001 });
    if (q === left && after === null) return search([pullRequest(1, start)], { issueCount: 1000, cursor: "page-2" });
    if (q === left && after === "page-2") return search([pullRequest(2, mid - 1000), null], { issueCount: 1000 });
    assert.equal(q, right);
    return search([pullRequest(3, mid)]);
  };
  const prs = await prsCreated(start, end, read);
  same(prs.map((p) => p.number), [1, 2, 3]);
  assert.deepEqual(calls, [[full, null], [left, null], [left, "page-2"], [right, null]]);
});

test("Shipped stops searching the default branch when all merges are found or after 20 pages.", async () => {
  const { inMain, HISTORY } = await provider(["inMain", "HISTORY"]);
  const since = Date.UTC(2026, 10, 1);
  const pending = ["fast", "busy"].map((name) => ({
    repo: `org/${name}`, main: "trunk", since,
    oids: new Map([["found", `${name}/1`], ["later", `${name}/2`]]),
  }));
  const calls = { fast: [], busy: [] };
  const read = async (query, { owner, name, ref, since: from, after }) => {
    assert.equal(query, HISTORY);
    assert.deepEqual([owner, ref, from], ["org", "refs/heads/trunk", iso(since)]);
    calls[name].push(after);
    const page = Number(after ?? 0) + 1;
    const oids = page === 1 ? ["found", "unrelated"] : page === (name === "fast" ? 2 : 21) ? ["later"] : [];
    return history(oids, String(page));
  };
  same(await inMain(pending, read), ["fast/1", "fast/2", "busy/1"]);
  assert.deepEqual(calls.fast, [null, "1"]);
  assert.deepEqual(calls.busy, [null, ...Array.from({ length: 19 }, (_, i) => String(i + 1))]);
});

test("GitHub reads each month once, follows changes, and reads the missed months after seven days away.", async (t) => {
  const from = monthAt(9, 20), first = monthAt(10, 30), second = monthAt(10, 31), stale = second + 7 * DAY;
  const old = pullRequest(1, monthAt(9, 21));
  const pending = pullRequest(2, monthAt(10, 2), { base: "develop", merged: monthAt(10, 3) });
  const merged = pullRequest(old.number, Date.parse(old.createdAt), { merged: second });
  const refs = [];
  const { store, github, searches } = await syncedGitHub(t, (vars) => {
    if (vars.ref) {
      refs.push(vars.ref);
      return history([pending.mergeCommit.oid]);
    }
    if (vars.q.includes("updated:>=")) return search([merged]);
    if (vars.q.startsWith(`is:pr author:@me created:${iso(monthAt(9))}`)) return search([old]);
    if (vars.q.startsWith(`is:pr author:@me created:${iso(monthAt(10))}`)) return search([pending]);
    return search([]);
  });
  await github.sync(store, { from, now: first, login: "me" });
  assert.deepEqual(searches.splice(0), [createdQuery(monthAt(9), monthAt(10)), createdQuery(monthAt(10), first + 1000)]);
  assert.deepEqual(refs, ["refs/heads/main"]);
  const rows = async () => (await store.prs()).toSorted((a, b) => a.number - b.number).map((p) => [p.number, p.prod]);
  same(await rows(), [[1, 0], [2, 1]]);

  await github.sync(store, { from, now: second, login: "me" });
  assert.deepEqual(searches.splice(0), [`is:pr author:@me updated:>=${iso(first - HOUR)}`]);
  same(await rows(), [[1, 1], [2, 1]]);

  await github.sync(store, { from, now: stale, login: "me" });
  assert.deepEqual(searches, [
    createdQuery(monthAt(10), monthAt(11)), createdQuery(monthAt(11), stale + 1000),
    `is:pr author:@me updated:>=${iso(second - HOUR)}`,
  ]);
  assert.deepEqual([...(await store.readMonths("github"))].toSorted(), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(await store.meta("github.updated"), String(stale));
  assert.equal(refs.length, 1, "a confirmed merge is not searched again");
});

test("Shipped finds a merge after a week away even if the pull request opened outside the current trend.", async (t) => {
  const september = monthAt(9), october = monthAt(10), november = monthAt(11);
  const first = monthAt(10, 30), returning = first + 8 * DAY;
  const created = monthAt(9, 2), merged = monthAt(11, 1);
  const open = pullRequest(1, created), shippedPr = pullRequest(1, created, { merged });
  const { store, github, searches } = await syncedGitHub(t, ({ q }, seen) => {
    if (q === createdQuery(september, october)) {
      const returning = seen.filter((previous) => previous === q).length > 1;
      return search([returning ? shippedPr : open]);
    }
    if (q === `is:pr author:@me updated:>=${iso(first - HOUR)}`) return search([shippedPr]);
    return search([]);
  });
  await github.sync(store, { from: september, now: first, login: "me" });
  assert.equal((await store.prs())[0].merged, null);
  await github.sync(store, { from: october, now: returning, login: "me" });
  const [pr] = await store.prs();
  assert.deepEqual([pr.merged, pr.prod], [merged, 1]);
  assert.deepEqual(searches.slice(2), [
    createdQuery(september, october), createdQuery(october, november), createdQuery(november, returning + 1000),
    `is:pr author:@me updated:>=${iso(first - HOUR)}`,
  ]);
});

test("Shipped replaces the previous GitHub account's pull requests and re-reads months for the new account.", async (t) => {
  const september = monthAt(9), october = monthAt(10);
  const first = monthAt(10, 3), second = monthAt(10, 4);
  const old = pullRequest(1, monthAt(9, 3), { repo: "first/tool" });
  const current = pullRequest(2, monthAt(10, 2), { repo: "second/tool" });
  const { store, github, searches } = await syncedGitHub(t, ({ q }) => {
    if (q === createdQuery(september, october)) return search([old]);
    if (q === createdQuery(october, second + 1000) || q.startsWith("is:pr author:@me updated:>=")) return search([current]);
    return search([]);
  });
  await github.sync(store, { from: september, now: first, login: "first" });
  same((await store.prs()).map((p) => p.url), [old.url]);

  await github.sync(store, { from: october, now: second, login: "second" });
  same((await store.prs()).map((p) => p.url), [current.url]);
  assert.deepEqual(searches.slice(2), [createdQuery(october, second + 1000)]);
  assert.deepEqual([...(await store.readMonths("github"))], ["2026-10"]);
});

const mountShipped = async (host) => {
  const { Shipped } = await shipped(["Shipped"], host);
  const { cx, drain } = context();
  cx.timer = { ...databaseTimer, every() {} };
  const panel = new Shipped();
  panel.restoreState({ kind: "month", offset: 0 });
  panel.init(cx);
  return { panel, settled: drain() };
};

const holdSearch = () => {
  const held = Promise.withResolvers(), reading = Promise.withResolvers();
  return {
    pause() { reading.resolve(); return held.promise; },
    async inspect({ panel, settled }, check, reply) {
      try {
        await Promise.race([
          reading.promise,
          settled.then(() => assert.fail(panel.syncError ?? "The panel did not reach the held search")),
        ]);
        check();
      } finally {
        held.resolve(reply);
        await settled;
      }
    },
  };
};

test("Shipped shows an ellipsis on the first read, then the production count, share and change in points.", async (t) => {
  const now = monthAt(11, 4);
  const october = [
    pullRequest(1, monthAt(10, 2), { merged: monthAt(10, 3) }),
    pullRequest(2, monthAt(10, 30)),
  ];
  const november = Array.from({ length: 4 }, (_, i) => pullRequest(i + 3, monthAt(11, 2), i < 3 ? { merged: monthAt(11, 3) } : {}));
  const held = holdSearch();
  const state = {}, colors = { text: "#fff", green: "#0f0" };
  const host = await shippedHost(t, {
    ...gpuiHost(), Date: class extends Date { static now() { return now; } },
    shared: (key) => state[key], setShared: (key, value) => { state[key] = value; },
    exec: withGitHub((query, { q }) => {
      if (query.startsWith("query{viewer")) {
        const totals = { totalPullRequestReviewContributions: 2, totalCommitContributions: 0, totalPullRequestContributions: 4, totalIssueContributions: 0, restrictedContributionsCount: 0 };
        return { viewer: { login: "me", cal: { contributionCalendar: { weeks: [] } }, cur: totals } };
      }
      if (q === createdQuery(monthAt(10), monthAt(11))) return search(october);
      return q === createdQuery(monthAt(11), now + 1000) ? held.pause() : search([]);
    }),
  });
  const mounted = await mountShipped(host);
  const { panel } = mounted;
  await held.inspect(mounted, () => {
    const summary = panel.summary();
    assert.equal(summary.settled, false);
    assert.equal(summary.big, null);
    const pending = texts(panel.hero(colors));
    assert.ok(pending.includes("…"));
    assert.ok(pending.includes("pull requests in production, this month, still reading"));
  }, search(november));
  const { big, small, delta, deltaText, settled: ready, stats } = panel.summary();
  assert.equal(panel.syncError, null);
  assert.deepEqual([ready, big, small, delta, deltaText], [true, "3", "75%", 25, "+25 points vs last month"]);
  assert.equal(stats.find((s) => s.unit === "opened").value, "4");
  const shown = texts(panel.hero(colors));
  assert.ok(shown.includes("pull requests in production, this month · 75% of those you opened"));
  assert.ok(shown.includes(deltaText));
  same(state["kanso.shipped.records"].prodWeek, { n: 3, start: monthAt(11, 2) });
});

test("Shipped does not preview the previous account's PR count while GitHub reads the new account.", async (t) => {
  const now = monthAt(11, 4);
  const created = monthAt(11, 2), merged = monthAt(11, 3);
  const held = holdSearch();
  const host = await shippedHost(t, {
    Date: class extends Date { static now() { return now; } },
    exec: withGitHub((query, { q }) => {
      if (query.startsWith("query{viewer")) return { viewer: { login: "new", cal: { contributionCalendar: { weeks: [] } }, cur: {} } };
      return q === createdQuery(monthAt(11), now + 1000) ? held.pause() : search([]);
    }),
  });
  const store = await openedShippedStore(host);
  const { prRow } = await shippedStore();
  await store.forAccount("github", "old");
  await store.save([prRow(pullRequest(1, created, { merged, repo: "old/tool" }))]);

  const mounted = await mountShipped(host);
  const current = [2, 3].map((number) => pullRequest(number, created, { merged, repo: "new/tool" }));
  await held.inspect(mounted, () => {
    const { login, big } = mounted.panel.summary();
    assert.equal(login, "new");
    assert.equal(big, null, "new account must not show the cached count of 1");
  }, search(current));
  assert.equal(mounted.panel.syncError, null);
  assert.equal(mounted.panel.summary().big, "2");
});

test("Shipped's trend shows the six cohorts in order through the selected period.", async () => {
  const { trendOf } = await shipped(["trendOf"]);
  const { prRow } = await shippedStore();
  const prs = [
    pullRequest(1, monthAt(5, 7), { merged: monthAt(6) }),
    pullRequest(2, monthAt(7, 10)),
    pullRequest(3, monthAt(7, 13), { merged: monthAt(8) }),
    pullRequest(4, monthAt(10, 3), { merged: monthAt(11) }),
    pullRequest(5, monthAt(11, 2), { merged: monthAt(11, 3) }),
  ].map((pr) => prRow(pr));
  same(trendOf(prs, "month", -1, "me", monthAt(11, 4)).map(({ label, opened, rate }) => [label, opened, rate]), [
    ["May 2026", 1, 1], ["June 2026", 0, null], ["July 2026", 2, 0.5],
    ["August 2026", 0, null], ["September 2026", 0, null], ["October 2026", 1, 1],
  ]);
});

test("Shipped records the week with the most production pull requests and the best share with at least ten opened.", async () => {
  const { computeRecords } = await shipped(["computeRecords"]);
  const { prRow } = await shippedStore();
  const batch = (id, count, reached, created, merged) => Array.from({ length: count }, (_, i) =>
    prRow(pullRequest(id + i, created, i < reached ? { merged } : {})));
  const days = [{ date: "2026-11-02", contributionCount: 1 }, { date: "2026-11-03", contributionCount: 7 }];
  const prs = [
    ...batch(1, 9, 9, monthAt(9, 7), monthAt(9, 9)),
    ...batch(11, 10, 8, monthAt(10, 5), monthAt(10, 6)),
    ...batch(21, 10, 5, monthAt(11, 2), monthAt(11, 3)),
  ];
  same(computeRecords({ days, prs, login: "me" }), {
    bestDay: { n: 7, date: "2026-11-03" }, longestStreak: { n: 2, end: "2026-11-03" },
    prodWeek: { n: 9, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 10, start: monthAt(10) },
  });
  same(computeRecords({ days: [], prs: [] }), {});
});

test("Shipped only announces better recent records and keeps older improvements quietly.", async () => {
  const { mergeRecords } = await shipped(["mergeRecords"]);
  const now = monthAt(11, 4);
  const first = { prodWeek: { n: 8, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 10, start: monthAt(10) } };
  same(mergeRecords(null, first, now), { kept: first, beaten: [] });
  const recent = { prodWeek: { n: 9, start: monthAt(11, 2) }, rateMonth: { rate: 0.9, n: 10, start: monthAt(11) } };
  same(mergeRecords(first, recent, now), { kept: recent, beaten: ["prodWeek", "rateMonth"] });
  const old = { prodWeek: { n: 10, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 20, start: monthAt(10) } };
  same(mergeRecords(recent, old, now), { kept: { ...recent, prodWeek: old.prodWeek }, beaten: [] });
});
