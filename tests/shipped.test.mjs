import assert from "node:assert/strict";
import test from "node:test";
import {
  arg, context, databaseTimer, exec, failure, find, gpuiHost, KIT_NIGHT, load, nodes, popoverHost, same, storeShared, success, texts, tipsOf,
} from "./helpers.mjs";
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
const withGitHub = (read, signedIn = () => null) => async (command, args, options) => {
  if (command !== "gh") return exec(command, args, options);
  if (args[0] === "config") {
    assert.deepEqual(Array.from(args), ["config", "get", "user", "-h", "github.com"]);
    const login = signedIn();
    return login ? success(`${login}\n`) : failure("No stored login");
  }
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

const searchWindow = (field) => (start, end) => {
  const seconds = (ms) => iso(Math.floor(ms / 1000) * 1000);
  return `is:pr author:@me ${field}:${seconds(start)}..${seconds(end - 1000)}`;
};
const createdQuery = searchWindow("created"), mergedQuery = searchWindow("merged"), updatedQuery = searchWindow("updated");
const monthQueries = (start, end) => [createdQuery(start, end), mergedQuery(start, end)];
const clockAt = (now) => class extends Date {
  constructor(...args) { super(...(args.length ? args : [new.target.now()])); }
  static now() { return typeof now === "function" ? now() : now; }
};
const ghShippedHost = (t, now, read, login) => shippedHost(t, { Date: clockAt(now), exec: withGitHub(read, login) });
const viewerQuery = (query) => query.startsWith("query{viewer");
const viewerOf = (login, cur = {}, days = []) => ({
  viewer: { login, cal: { contributionCalendar: { weeks: days.length ? [{ contributionDays: days }] : [] } }, cur },
});
const reviewed = (login, reviews, days) => viewerOf(login, { totalPullRequestReviewContributions: reviews }, days);
const reviewsShown = (panel) => panel.summary().stats.find(({ unit }) => unit === "reviews").value;
const calendarFrom = (query) => /cal:contributionsCollection\(from:"([^"]+)"/.exec(query)[1];
const recordsKey = "kanso.shipped.records";
const HALF_DAY = 12 * HOUR;

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

test("Shipped keeps the streak when GitHub is already on tomorrow in UTC.", async () => {
  const { streaks } = await shipped(["streaks"]);
  const days = [3, 1, 0].map((contributionCount, i) => ({ date: `2026-11-0${2 + i}`, contributionCount }));
  same(streaks(days, "2026-11-03"), { current: 2, longest: { n: 2, end: "2026-11-03" } });
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
  const since = Date.UTC(2026, 10, 1), until = since + 2 * DAY;
  const pending = ["fast", "busy"].map((name) => ({
    repo: `org/${name}`, main: "trunk", since, until,
    oids: new Map([["found", `${name}/1`], ["later", `${name}/2`]]),
  }));
  const calls = { fast: [], busy: [] };
  const read = async (query, { owner, name, ref, since: from, until: to, after }) => {
    assert.equal(query, HISTORY);
    assert.match(query, /history\([^)]*since:\$since,until:\$until/);
    assert.deepEqual([owner, ref, from, to], ["org", "refs/heads/trunk", iso(since), iso(until)]);
    calls[name].push(after);
    const page = Number(after ?? 0) + 1;
    const oids = page === 1 ? ["found", "unrelated"] : page === (name === "fast" ? 2 : 21) ? ["later"] : [];
    return history(oids, String(page));
  };
  same(await inMain(pending, read), { urls: ["fast/1", "fast/2", "busy/1"], unchecked: 1 });
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
    if (vars.q.includes("updated:")) return search([merged]);
    if (vars.q.startsWith(`is:pr author:@me created:${iso(monthAt(9))}`)) return search([old]);
    if (vars.q.startsWith(`is:pr author:@me created:${iso(monthAt(10))}`)) return search([pending]);
    return search([]);
  });
  await github.sync(store, { from, now: first, login: "me" });
  assert.deepEqual(searches.splice(0), [...monthQueries(monthAt(9), monthAt(10)), ...monthQueries(monthAt(10), first + 1000)]);
  assert.deepEqual(refs, ["refs/heads/main"]);
  const rows = async () => (await store.prs()).toSorted((a, b) => a.number - b.number).map((p) => [p.number, p.prod]);
  same(await rows(), [[1, 0], [2, 1]]);

  await github.sync(store, { from, now: second, login: "me" });
  assert.deepEqual(searches.splice(0), [updatedQuery(first - HOUR, second + 1000)]);
  same(await rows(), [[1, 1], [2, 1]]);

  await github.sync(store, { from, now: stale, login: "me" });
  assert.deepEqual(searches, [
    ...monthQueries(monthAt(10), monthAt(11)), ...monthQueries(monthAt(11), stale + 1000),
    updatedQuery(second - HOUR, stale + 1000),
  ]);
  assert.deepEqual([...(await store.readMonths("github"))].toSorted(), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(await store.meta("github.updated"), String(stale));
  assert.equal(refs.length, 1, "a confirmed merge is not searched again");
});

test("Shipped fills missing months but waits twelve hours to check changes and production unless refreshed.", async (t) => {
  const first = monthAt(11, 4), october = monthAt(10), november = monthAt(11);
  const pending = pullRequest(1, november, { base: "develop", merged: monthAt(11, 2) });
  let checks = 0;
  const { store, github, searches } = await syncedGitHub(t, ({ q, ref }) => {
    if (ref) { checks += 1; return history([], "more"); }
    return search(q === createdQuery(november, first + 1000) ? [pending] : []);
  });
  const sync = (from, now, force = false) => github.sync(store, { from, now, login: "me", every: HALF_DAY, force });
  same(await sync(november, first), { unchecked: 1 });
  const initialChecks = checks;
  assert.ok(initialChecks > 0);
  searches.length = 0;

  const forced = first + HOUR;
  same(await sync(october, forced), { unchecked: 1 });
  assert.deepEqual(searches.splice(0), monthQueries(october, november));
  assert.equal(checks, initialChecks);
  assert.equal(await store.meta("github.updated"), String(first));

  await sync(october, forced, true);
  assert.deepEqual(searches.splice(0), [updatedQuery(first - HOUR, forced + 1000)]);
  assert.ok(checks > initialChecks);
  const forcedChecks = checks;

  const due = forced + HALF_DAY;
  await sync(october, due - 1);
  assert.deepEqual(searches, []);
  assert.equal(checks, forcedChecks);
  await sync(october, due);
  assert.deepEqual(searches, [updatedQuery(forced - HOUR, due + 1000)]);
  assert.ok(checks > forcedChecks);
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
    if (q === updatedQuery(first - HOUR, returning + 1000)) return search([shippedPr]);
    return search([]);
  });
  await github.sync(store, { from: september, now: first, login: "me" });
  assert.equal((await store.prs())[0].merged, null);
  const before = searches.length;
  await github.sync(store, { from: october, now: returning, login: "me" });
  const [pr] = await store.prs();
  assert.deepEqual([pr.merged, pr.prod], [merged, 1]);
  assert.deepEqual(searches.slice(before), [
    ...monthQueries(september, october), ...monthQueries(october, november), ...monthQueries(november, returning + 1000),
    updatedQuery(first - HOUR, returning + 1000),
  ]);
});

test("Shipped replaces the previous GitHub account's pull requests and re-reads months for the new account.", async (t) => {
  const september = monthAt(9), october = monthAt(10);
  const first = monthAt(10, 3), second = monthAt(10, 4);
  const old = pullRequest(1, monthAt(9, 3), { repo: "first/tool" });
  const current = pullRequest(2, monthAt(10, 2), { repo: "second/tool" });
  const { store, github, searches } = await syncedGitHub(t, ({ q }) => {
    if (q === createdQuery(september, october)) return search([old]);
    if (q === createdQuery(october, second + 1000) || q.includes("updated:")) return search([current]);
    return search([]);
  });
  await github.sync(store, { from: september, now: first, login: "first" });
  same((await store.prs()).map((p) => p.url), [old.url]);

  const before = searches.length;
  await github.sync(store, { from: october, now: second, login: "second" });
  same((await store.prs()).map((p) => p.url), [current.url]);
  assert.deepEqual(searches.slice(before), monthQueries(october, second + 1000));
  assert.deepEqual([...(await store.readMonths("github"))], ["2026-10"]);
});

const checkCappedUpdates = async (t, openedMonth) => {
  const october = monthAt(10), november = monthAt(11);
  const cursor = monthAt(10, 30), now = monthAt(11, 4);
  const initialEnd = openedMonth === october ? cursor + 1000 : october;
  const closed = pullRequest(1, openedMonth, { closed: openedMonth + HOUR });
  const merged = pullRequest(1, openedMonth, { merged: cursor + HOUR });
  const recent = Array.from({ length: 1000 }, (_, i) => pullRequest(i + 2, november));
  const start = cursor - HOUR, end = now + 1000, mid = start + Math.floor((end - start) / 2);
  const increment = updatedQuery(start, end), earlier = updatedQuery(start, mid), later = updatedQuery(mid, end);
  const { store, github, searches } = await syncedGitHub(t, ({ q, after }) => {
    if (q === createdQuery(openedMonth, initialEnd)) return search([closed]);
    if (q === createdQuery(openedMonth, november) && openedMonth === october) return search([merged]);
    if (q === earlier) return search([merged]);
    if (![increment, later, `is:pr author:@me updated:>=${iso(start)}`].includes(q)) return search([]);
    const page = Number(after ?? 0);
    const cursor = page < 9 ? String(page + 1) : null;
    const issueCount = q === later ? 1000 : 1001;
    return search(recent.slice(page * 100, (page + 1) * 100), { issueCount, cursor });
  });
  await github.sync(store, { from: openedMonth, now: cursor, login: "me" });
  const before = searches.length;
  await github.sync(store, { from: openedMonth, now, login: "me" });
  const pr = (await store.prs()).find((row) => row.url === closed.url);
  assert.equal(pr.prod, 1, "the merge missing from the change search reaches the local totals");
  assert.deepEqual(searches.slice(before), [
    ...monthQueries(november, end), ...Array(10).fill(increment), earlier, ...Array(10).fill(later),
  ]);
  assert.equal(await store.meta("github.updated"), String(now));
};

test("Shipped recovers a merge omitted by GitHub's capped change search.", (t) => checkCappedUpdates(t, monthAt(10)));

test("Shipped recovers a reopened pull request from before the cursor month when the change search is capped.", (t) =>
  checkCappedUpdates(t, monthAt(9)));

const mountShipped = async (host, kind = "month") => {
  const { Shipped } = await shipped(["Shipped"], host);
  const { cx, drain } = context();
  cx.timer = { ...databaseTimer, every() {} };
  const panel = new Shipped();
  panel.restoreState({ kind, offset: 0 });
  panel.init(cx);
  return { panel, cx, drain, settled: drain() };
};

const settledShipped = async (host, kind) => {
  const mounted = await mountShipped(host, kind);
  await mounted.settled;
  return mounted;
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
        await check();
      } finally {
        held.resolve(reply);
        await settled;
      }
    },
  };
};

const sqlitePeriods = async (t, now, { viewer, login = () => "me", onSearch = () => {}, calendars }) => {
  const read = (query, { q }) => {
    if (viewerQuery(query)) {
      calendars?.push(calendarFrom(query));
      return viewer();
    }
    onSearch(q);
    return search([]);
  };
  const host = await shippedHost(t, {
    ...gpuiHost(), Date: clockAt(now),
    exec: withGitHub(read, login),
  });
  return () => settledShipped(host);
};

test("Shipped checks the local login but makes no GitHub API call while the saved period is fresh.", async (t) => {
  const first = monthAt(11, 4);
  let now = first, reviews = 5;
  const requested = [];
  const reopen = await sqlitePeriods(t, () => now, {
    viewer: () => { requested.push("viewer"); return reviewed("me", reviews); },
    login: () => { requested.push("local login"); return "me"; },
    onSearch: (query) => requested.push(query),
  });
  await reopen();
  assert.ok(requested.includes("viewer"));
  requested.length = 0;

  now += HALF_DAY - 1000;
  reviews += 1;
  const { panel, cx, drain } = await reopen();
  assert.deepEqual(requested.splice(0), ["local login"]);
  assert.equal(reviewsShown(panel), "5");

  panel.refresh(cx, true);
  await drain();
  assert.deepEqual(requested, ["local login", "viewer", updatedQuery(first - HOUR, now + 1000)]);
  assert.equal(reviewsShown(panel), "6");
});

test("Shipped reads pull requests under the API account when the saved Day is fresh but its pull requests are missing.", async (t) => {
  const day = monthAt(11, 10), now = day + 12 * HOUR;
  const accounts = [];
  const host = await ghShippedHost(t, now, async (query) => {
    if (viewerQuery(query)) return viewerOf("bob");
    accounts.push(await store.meta("github.login"));
    return search([]);
  }, () => "alice");
  const store = await openedShippedStore(host);
  await store.forAccount("github", "alice");
  await store.setPeriod(`day:${day}`, viewerOf("alice"), now - HOUR);

  const { panel } = await settledShipped(host, "day");
  assert.equal(panel.summary().login, "bob");
  assert.deepEqual(accounts, ["bob", "bob"]);
});

test("Shipped does not write pull requests or advance the cursor when Refresh cannot confirm the switched account.", async (t) => {
  const first = monthAt(11, 10) + 12 * HOUR;
  let now = first, login = "alice";
  const incoming = pullRequest(1, first, { repo: "bob/tool" });
  const host = await ghShippedHost(t, () => now, (query) => {
    if (!viewerQuery(query)) return search(login === "alice" ? [] : [incoming]);
    if (login === "alice") return viewerOf(login);
    throw new Error("GitHub viewer unavailable");
  }, () => login);
  const { panel, cx, drain } = await settledShipped(host, "day");

  login = "bob";
  now += HOUR;
  panel.refresh(cx, true);
  await drain();
  same(await panel.store.prs(), []);
  assert.equal(await panel.store.meta("github.updated"), String(first));
});

test("Shipped shows the new account and reads its full calendar when you reopen after switching accounts.", async (t) => {
  const now = new Date(2026, 10, 10, 12).getTime();
  const calendars = [];
  let login = "old";
  const reopen = await sqlitePeriods(t, () => now, {
    viewer: () => login === "old" ? reviewed(login, 17, [{ date: "2026-11-09", contributionCount: 9, weekday: 1 }]) : reviewed(login, 2),
    login: () => login,
    calendars,
  });
  await reopen();
  login = "new";
  const reopened = await reopen();
  assert.deepEqual([reopened.panel.summary().login, reviewsShown(reopened.panel)], ["new", "2"]);
  assert.deepEqual(calendars, Array(2).fill(iso(now - 364 * DAY)));
  assert.equal(reopened.panel.days.length, 0, "no previous-account calendar days remain");
});

test("Shipped replaces a mounted month's totals when you switch GitHub accounts without pressing Refresh.", async (t) => {
  let login = "old";
  const mount = await sqlitePeriods(t, () => monthAt(11, 10), {
    viewer: () => reviewed(login, login === "old" ? 17 : 3), login: () => login,
  });
  const { panel, cx, drain } = await mount();
  assert.equal(reviewsShown(panel), "17");

  login = "new";
  panel.pick("month", 0, cx);
  await drain();
  assert.deepEqual([panel.summary().login, reviewsShown(panel)], ["new", "3"]);
});

test("Shipped backfills the API account's older calendar days when Refresh reveals a switch.", async (t) => {
  const now = monthAt(11, 10) + 12 * HOUR;
  const old = { date: "2026-11-10", weekday: 2, contributionCount: 9 };
  const earlier = { date: "2026-01-01", weekday: 4, contributionCount: 3 };
  const recent = { ...old, contributionCount: 1 };
  const starts = [];
  let viewer = "alice";
  const host = await ghShippedHost(t, now, (query) => {
    if (!viewerQuery(query)) return search([]);
    const start = calendarFrom(query);
    starts.push(start);
    const days = viewer === "alice" ? [old] : [earlier, recent].filter(({ date }) => date >= start.slice(0, 10));
    return viewerOf(viewer, {}, days);
  }, () => "alice");
  const { panel, cx, drain } = await settledShipped(host);
  starts.length = 0;

  viewer = "bob";
  panel.refresh(cx, true);
  await drain();
  assert.equal(panel.summary().login, viewer);
  same((await panel.store.calendar()).days, [earlier, recent]);
  assert.deepEqual(starts, [iso(monthAt(11, 9)), iso(now - 364 * DAY)]);
});

test("Shipped keeps the saved calendar across remounts and Refresh asks only for its recent end.", async (t) => {
  const first = new Date(2026, 10, 10, 12).getTime();
  const dates = ["2026-11-09", "2026-11-10", "2026-11-11"];
  let now = first, fresh = false;
  const calendars = [];
  const day = (i, contributionCount) => ({ date: dates[i], weekday: i + 1, contributionCount });
  const reopen = await sqlitePeriods(t, () => now, {
    viewer: () => viewerOf("me", {}, fresh ? [day(1, 4), day(2, 5)] : [day(0, 2), day(1, 1)]),
    calendars,
  });
  await reopen();
  now = first + HOUR;
  const reopened = await reopen();
  now += DAY;
  fresh = true;
  reopened.panel.refresh(reopened.cx, true);
  await reopened.drain();
  const overlap = iso(new Date(2026, 10, 10).getTime() - DAY);
  assert.deepEqual(calendars, [iso(first - 364 * DAY), overlap]);
  same(reopened.panel.days.map((d) => [d.date, d.contributionCount]), dates.map((d, i) => [d, [2, 4, 5][i]]));
});

test("Shipped reads this month's totals after midnight even when last month's totals are still fresh.", async (t) => {
  const december = monthAt(12);
  let now = december - HOUR;
  const reopen = await sqlitePeriods(t, () => now, { viewer: () => reviewed("me", now < december ? 17 : 3) });
  const november = await reopen();
  assert.equal(reviewsShown(november.panel), "17");
  now = december + HOUR;
  const reopened = await reopen();
  assert.deepEqual([reopened.panel.summary().period, reviewsShown(reopened.panel)], ["This month", "3"]);
});

test("Shipped shows the last totals and their time when a dated snapshot cannot be updated.", async (t) => {
  const first = new Date(2026, 10, 10, 6, 30).getTime();
  let now = first, online = true;
  const reopen = await sqlitePeriods(t, () => now, {
    viewer: () => {
      if (!online) throw new Error("GitHub is offline");
      return reviewed("me", 17);
    },
  });
  await reopen();
  now += HALF_DAY + HOUR;
  online = false;
  const reopened = await reopen();
  assert.deepEqual([reopened.panel.summary().login, reviewsShown(reopened.panel)], ["me", "17"]);
  assert.deepEqual(texts(reopened.panel.status({})), ["Couldn't update · showing 06:30"]);
});

test("Shipped offers Retry instead of a skeleton when its database cannot open.", async (t) => {
  let blocked = true;
  const github = withGitHub((query) => viewerQuery(query) ? reviewed("me", 2) : search([]), () => "me");
  const { panel, cx, drain, settled } = await mountShipped(await shippedHost(t, {
    ...popoverHost(), Date: clockAt(monthAt(11, 4)), theme: () => KIT_NIGHT,
    exec: (cmd, args, opts) => blocked && cmd === "sqlite3" ? Promise.resolve(failure("database unavailable")) : github(cmd, args, opts),
  }));
  await settled;
  const drawn = panel.render(cx), words = texts(drawn);
  assert.ok(words.includes("Shipped can't keep its data"), words.join(" · "));
  assert.ok(words.includes("Retry"));
  assert.equal(find(drawn, (el) => arg(el, "id") === "kanso-skeleton"), null);
  blocked = false;
  arg(find(drawn, (el) => el.tag === "sh-store-fix"), "on_click")({}, cx);
  await drain();
  assert.equal(reviewsShown(panel), "2");
});

test("Shipped shows an ellipsis on the first read, then the production share, count and change in points.", async (t) => {
  const now = monthAt(11, 4);
  const october = [
    pullRequest(1, monthAt(10, 2), { merged: monthAt(10, 3) }),
    pullRequest(2, monthAt(10, 30)),
  ];
  const november = Array.from({ length: 4 }, (_, i) => pullRequest(i + 3, monthAt(11, 2), i < 3 ? { merged: monthAt(11, 3) } : {}));
  const held = holdSearch();
  const state = {}, colors = { text: "#fff", green: "#0f0" };
  const host = await shippedHost(t, {
    ...gpuiHost(), Date: clockAt(now), ...storeShared(state),
    exec: withGitHub((query, { q }) => {
      if (viewerQuery(query)) {
        const totals = { totalPullRequestReviewContributions: 2, totalCommitContributions: 0, totalPullRequestContributions: 4, totalIssueContributions: 0, restrictedContributionsCount: 0 };
        return viewerOf("me", totals);
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
    assert.ok(pending.includes("in production"));
    assert.deepEqual(texts(panel.status(colors)), ["Reading GitHub…"]);
  }, search(november));
  const { big, prod, delta, deltaText, settled: ready, stats } = panel.summary();
  assert.equal(panel.syncError, null);
  assert.deepEqual([ready, big, prod, delta, deltaText], [true, "75%", 3, 25, "+25 pts vs last month"]);
  assert.equal(stats.find((s) => s.unit === "opened").value, "4");
  const shown = texts(panel.hero(colors));
  assert.ok(shown.includes("in production · 3 of 4"));
  assert.ok(shown.includes(deltaText));
  same(state[`${recordsKey}:me`].prodWeek, { n: 3, start: monthAt(11, 2) });
});

test("Shipped does not preview the previous account's PR count while GitHub reads the new account.", async (t) => {
  const now = monthAt(11, 4);
  const created = monthAt(11, 2), merged = monthAt(11, 3);
  const held = holdSearch();
  const host = await shippedHost(t, {
    Date: clockAt(now),
    exec: withGitHub((query, { q }) => {
      if (viewerQuery(query)) return viewerOf("new");
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
  assert.equal(mounted.panel.summary().prod, 2);
});

test("Shipped reads the whole Year trend when you switch from Week during a read.", async (t) => {
  const now = monthAt(11, 26), held = holdSearch();
  const weekPr = pullRequest(1, now - DAY, { merged: now });
  const yearPr = pullRequest(2, monthAt(1, 2), { merged: monthAt(1, 3) });
  const octoberQuery = createdQuery(monthAt(10), monthAt(11));
  const currentQuery = createdQuery(monthAt(11), now + 1000);
  const ranges = Array.from({ length: 71 }, (_, i) => {
    const start = new Date(2021, i, 1).getTime(), end = new Date(2021, i + 1, 1).getTime();
    return createdQuery(start, Math.min(end, now + 1000));
  });
  const seen = new Set(), duringYear = [];
  const mounted = await mountShipped(await shippedHost(t, {
    exec: withGitHub((query, { q }) => {
      if (viewerQuery(query)) return viewerOf("me");
      if (!q.includes("created:")) return search([]);
      seen.add(q);
      if (q === octoberQuery) return held.pause();
      if (q === currentQuery) return search([weekPr]);
      if (q === ranges[0]) duringYear.push(mounted.panel.summary());
      return search(q === createdQuery(monthAt(1), monthAt(2)) ? [yearPr] : []);
    }),
    Date: clockAt(now),
  }), "week");
  const { panel, cx } = mounted;
  await held.inspect(mounted, () => panel.pick("year", 0, cx), search([]));
  assert.equal(panel.syncError, null);
  assert.equal(ranges.filter((q) => !seen.has(q)).length, 0, "the queued read fills the missing months");
  assert.equal(duringYear.length, 1);
  const [reading] = duringYear;
  assert.deepEqual([reading.settled, reading.big, reading.prod], [false, null, null]);
  const cohortFacts = (summary) => summary.stats
    .filter(({ unit }) => !["reviews", "contributions"].includes(unit)).map(({ value }) => value);
  same(cohortFacts(reading), Array(5).fill("—"));
  const summary = panel.summary();
  assert.deepEqual([summary.settled, summary.big, summary.prod], [true, "100%", 2]);
  same(cohortFacts(summary).slice(0, 2), ["2", "2"]);
});

test("Shipped counts a pull request opened last month and merged today on the first Day read.", async (t) => {
  const merge = monthAt(11, 10) + 9 * HOUR, now = merge + HOUR;
  const earlier = pullRequest(1, monthAt(10, 20), { merged: merge });
  const host = await ghShippedHost(t, now, (query, { q }) => viewerQuery(query)
    ? viewerOf("me") : search(q === mergedQuery(monthAt(11), now + 1000) ? [earlier] : []));
  const { panel } = await settledShipped(host, "day");
  const { bars } = panel.derived().bars;
  assert.equal(Number(bars[9].value), 1);
});

test("Shipped tells you when a merged pull request could not be checked for production.", async (t) => {
  const now = monthAt(11, 4), created = monthAt(11, 2), merged = monthAt(11, 3);
  const checked = pullRequest(1, created, { merged });
  const unchecked = pullRequest(2, created, { merged, base: "develop", repo: "org/unavailable" });
  const { panel, settled } = await mountShipped(await shippedHost(t, {
    ...gpuiHost(), Date: clockAt(now),
    exec: withGitHub((query, { q, ref }) => {
      if (viewerQuery(query)) return viewerOf("me");
      if (ref) throw new Error("Repository history is unavailable");
      return search(q === createdQuery(monthAt(11), now + 1000) ? [checked, unchecked] : []);
    }),
  }));
  await settled;
  assert.equal(panel.syncError, null);
  assert.equal(panel.summary().big, "50%");
  const status = panel.status({});
  assert.match(status ? texts(status).join(" ") : "", /1 not checked for production yet/);
});

const mountAccountRecords = async (t, now, state, account, read) => mountShipped(await shippedHost(t, {
  Date: clockAt(now), ...storeShared(state),
  exec: withGitHub((query, { q }) => viewerQuery(query) ? viewerOf(account.login) : read(q)),
}));

test("Shipped drops the previous account's records from the share card when you switch accounts.", async (t) => {
  const now = monthAt(11, 4), held = holdSearch();
  const previous = { prodWeek: { n: 27, start: monthAt(11, 2) } };
  const state = { [recordsKey]: previous, [`${recordsKey}:old`]: previous };
  const currentQuery = createdQuery(monthAt(11), now + 1000);
  const account = { login: "old" };
  const { panel, cx, drain, settled } = await mountAccountRecords(t, now, state, account, (q) =>
    account.login === "new" && q === currentQuery ? held.pause() : search([]));
  await settled;
  assert.equal(panel.cardData().records[0]?.value, "27");
  account.login = "new";
  panel.refresh(cx, true);
  await held.inspect({ panel, settled: drain() }, () => {
    assert.equal(panel.summary().login, "new");
    assert.equal(panel.summary().settled, false);
    assert.equal(panel.cardData().records.length, 0);
  }, search([]));
  assert.equal(panel.cardData().records.length, 0);
  same(state[`${recordsKey}:old`], previous);
  same(state[`${recordsKey}:new`], {});
});

test("Shipped discards the previous account's results when you switch accounts during a read.", async (t) => {
  const now = monthAt(11, 4), held = holdSearch(), switched = Promise.withResolvers();
  const current = createdQuery(monthAt(11), now + 1000);
  const oldPr = pullRequest(1, monthAt(11, 2), { merged: monthAt(11, 3) });
  const state = {}, account = { login: "old" };
  const mounted = await mountAccountRecords(t, now, state, account, (q) =>
    q === current && account.login === "old" ? held.pause() : search([]));
  const { panel, cx, settled } = mounted;
  await held.inspect(mounted, async () => {
    cx.notify = () => { if (panel.login === "new") switched.resolve(); };
    account.login = "new";
    panel.refresh(cx, true);
    await Promise.race([switched.promise, settled]);
    assert.equal(panel.login, "new");
  }, search([oldPr]));
  assert.equal(panel.syncError, null);
  assert.equal(panel.summary().prod, 0);
  assert.equal(panel.cardData().records.length, 0);
  same(state[`${recordsKey}:new`], {});
});

const mountAccountTotals = async (t) => {
  const account = { login: "old" };
  const { panel, cx, drain, settled } = await mountShipped(await shippedHost(t, {
    Date: clockAt(monthAt(11, 4)),
    exec: withGitHub((query) => {
      if (!viewerQuery(query)) return search([]);
      const old = account.login === "old";
      return { ...viewerOf(account.login, { totalPullRequestReviewContributions: old ? 4 : 6 }),
        ever: { issueCount: old ? 27 : 2 } };
    }),
  }));
  await settled;
  const switchAccount = async () => {
    account.login = "new";
    panel.refresh(cx, true);
    await drain();
  };
  return { panel, cx, drain, switchAccount };
};

test("Shipped refreshes a previously visited period's GitHub totals after you switch accounts.", async (t) => {
  const { panel, cx, drain, switchAccount } = await mountAccountTotals(t);
  panel.pick("week", 0, cx);
  await drain();
  await switchAccount();
  panel.pick("month", 0, cx);
  await drain();
  const { login, everText } = panel.summary();
  assert.deepEqual([login, everText], ["new", "2 merged"]);
});

test("Shipped shows GitHub totals on the first read for each account.", async (t) => {
  const { panel, switchAccount } = await mountAccountTotals(t);
  const totals = () => {
    const { everText, stats } = panel.summary();
    return [everText, stats.find(({ unit }) => unit === "reviews").value];
  };
  assert.deepEqual(totals(), ["27 merged", "4"]);
  await switchAccount();
  assert.deepEqual(totals(), ["2 merged", "6"]);
});

test("Shipped draws no filled share bar when no pull requests reach production.", async () => {
  const { Shipped } = await shipped(["Shipped"], gpuiHost());
  const panel = new Shipped();
  const widths = [0, null].map((rate) => {
    const row = panel.rateRow("trend", "This week", rate === null ? "none opened" : "0 of 10", rate, {}, true);
    const track = nodes(row).find((node) => node.calls.some(([method, value]) => method === "id" && value === "trend"));
    return track.kids.map((bar) => parseFloat(bar.calls.find(([method]) => method === "w")?.[1]));
  });
  assert.deepEqual(widths.map((bars) => bars.reduce((total, width) => total + width, 0)), [0, 0]);
});

const drawnShipped = async (prs, now) => {
  const { Shipped } = await shipped(["Shipped"], { ...popoverHost(), Date: clockAt(now), theme: () => KIT_NIGHT });
  return Object.assign(new Shipped(), {
    prs, github: {}, login: "me", kind: "month", offset: 0, records: {}, share: { open: false },
    covered: { github: new Set(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) },
  });
};

test("Shipped shows separate merge hours for pull requests merged on the same date.", async () => {
  const { prRow } = await shippedStore();
  const at = (hour) => new Date(2026, 10, 3, hour).getTime();
  const panel = await drawnShipped([9, 17].map((hour, i) => prRow(pullRequest(i + 1, at(8), { merged: at(hour) }))), monthAt(11, 4));
  const drawn = panel.render({});
  assert.ok(texts(drawn).includes("When you merge"));
  const tooltips = tipsOf(drawn).filter((tip) => typeof tip === "string" && tip.includes("merged at"));
  assert.equal(tooltips.length, 24);
  assert.deepEqual([tooltips[9], tooltips[17]], ["1 merged at 09:00", "1 merged at 17:00"]);
});

test("Shipped shows a dash instead of the loading mark for a settled empty month.", async () => {
  const panel = await drawnShipped([], monthAt(11, 4));
  const words = texts(panel.hero({}));
  assert.deepEqual([panel.summary().settled, panel.summary().big], [true, "—"]);
  assert.ok(words.includes("in production · 0 of 0"));
  assert.ok(!words.includes("…"));
});

test("Shipped does not scan the same pull requests again on redraw, but reads a new snapshot.", async () => {
  const created = monthAt(11, 2), merged = monthAt(11, 3);
  const { prRow } = await shippedStore();
  let reads = 0;
  const row = prRow(pullRequest(1, created, { merged }));
  const observed = { ...row, get created() { reads += 1; return created; } };
  const panel = await drawnShipped([observed], monthAt(11, 4));
  const draw = () => panel.render({});
  draw();
  const once = reads;
  assert.ok(once > 0, "the first draw reads the snapshot");
  draw();
  assert.equal(reads, once);
  panel.prs = [...panel.prs, prRow(pullRequest(2, created))];
  assert.ok(texts(draw()).includes("in production · 1 of 2"));
  assert.ok(reads > once, "a new snapshot is read");
});

test("Shipped shows the current month first in the trend.", async () => {
  const { prRow } = await shippedStore();
  const panel = await drawnShipped([prRow(pullRequest(1, monthAt(11, 2)))], monthAt(11, 4));
  const labels = texts(panel.trend({})).filter((word) => word === "This month" || word.endsWith("2026"));
  assert.deepEqual(labels, ["This month", "October 2026", "September 2026", "August 2026", "July 2026", "June 2026"]);
});

test("Shipped moves today's bar at midnight and rolls the trend into the new month without remounting.", async () => {
  const { prRow } = await shippedStore();
  const november = prRow(pullRequest(1, monthAt(11, 2)));
  let now = monthAt(11, 29) + 12 * HOUR;
  const panel = await drawnShipped([november], () => now);
  const view = () => {
    const { bars, trend } = panel.derived();
    return [bars.bars.findIndex((bar) => bar.mark) + 1, trend.at(-2).label];
  };
  const initial = view();
  now = monthAt(11, 30) + 12 * HOUR;
  const nextDay = view();
  now = monthAt(12) + HOUR;
  assert.deepEqual([initial, nextDay, view()], [[29, "October 2026"], [30, "October 2026"], [1, "November 2026"]]);
});

test("Shipped moves the Day marker to the next hour without reading pull requests again.", async () => {
  let now = monthAt(11, 10) + 9 * HOUR;
  const panel = await drawnShipped([], () => now);
  panel.kind = "day";
  const marked = () => panel.derived().bars.bars.findIndex(({ mark }) => mark);
  const first = marked();
  now += HOUR;
  assert.deepEqual([first, marked()], [9, 10]);
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

test("Shipped groups the day by hours, the week by four hours, the month by days, and the year by weeks.", async () => {
  const { bucketsOf, periodRange } = await shipped(["bucketsOf", "periodRange"]);
  const now = new Date(2028, 1, 16, 12).getTime();
  for (const [kind, count] of [["day", 24], ["week", 42], ["month", 29], ["year", 53]]) {
    const buckets = bucketsOf(kind, 0, now), { start, end } = periodRange(kind, 0, now);
    assert.equal(buckets.length, count, kind);
    assert.deepEqual([buckets[0].start, buckets.at(-1).end], [start, end], kind);
    assert.ok(buckets.every((b, i) => b.end > b.start && (i === 0 || b.start === buckets[i - 1].end)), kind);
  }
});

test("Shipped counts merges in each bucket and marks the current bucket or a past period's peak.", async () => {
  const { mergedBars } = await shipped(["mergedBars"]);
  const today = monthAt(11, 4), yesterday = monthAt(11, 3), tomorrow = monthAt(11, 5);
  const merges = [today + HOUR, today + HOUR, today + 2 * HOUR, yesterday + 2 * HOUR, tomorrow, null];
  const prs = merges.map((merged) => ({ created: yesterday - DAY, merged }));
  const now = today + 3 * HOUR;
  const current = mergedBars(prs, "day", 0, now);
  const past = mergedBars(prs, "day", -1, now);
  const marked = ({ bars }) => Array.from(bars.keys()).filter((i) => bars[i].mark);
  assert.deepEqual([marked(current), marked(past)], [[3], [2]]);
  const counts = ({ bars }) => Array.from(bars, ({ value }) => Number(value));
  assert.deepEqual(counts(current).slice(0, 4), [0, 2, 1, 0]);
  assert.equal(counts(current).reduce((n, value) => n + value, 0), 3);
  assert.equal(past.bars[2].value, "1");
  const thursday = monthAt(11, 5) + 8 * HOUR;
  const week = mergedBars([{ merged: thursday }], "week", 0, thursday);
  assert.equal(week.bars.find(({ mark }) => mark).tip, "1 merged · Thu 08:00");
  assert.deepEqual([current.bars[1].ratio, current.bars[2].ratio, current.bars[4].future], [1, 0.5, true]);
});

const recordFixtures = async () => {
  const records = await shipped(["computeRecords", "mergeRecords"]);
  const { prRow } = await shippedStore();
  const batch = (id, count, reached, created, merged) => Array.from({ length: count }, (_, i) =>
    prRow(pullRequest(id + i, created, i < reached ? { merged } : {})));
  return { ...records, prRow, batch };
};

test("Shipped records the week with the most production pull requests and the best share with at least ten opened.", async () => {
  const { computeRecords, batch } = await recordFixtures();
  const days = [{ date: "2026-11-02", contributionCount: 1 }, { date: "2026-11-03", contributionCount: 7 }];
  const prs = [
    ...batch(1, 9, 9, monthAt(9, 7), monthAt(9, 9)),
    ...batch(11, 10, 8, monthAt(10, 5), monthAt(10, 6)),
    ...batch(21, 10, 5, monthAt(11, 2), monthAt(11, 3)),
  ];
  same(computeRecords({ days, prs, login: "me" }, monthAt(12, 2)), {
    bestDay: { n: 7, date: "2026-11-03" }, longestStreak: { n: 2, end: "2026-11-03" },
    prodWeek: { n: 9, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 10, start: monthAt(10) },
  });
  same(computeRecords({ days: [], prs: [] }), {});
});

test("Shipped waits 30 days after a month ends and corrects that month's production record.", async () => {
  const { computeRecords, mergeRecords, prRow, batch } = await recordFixtures();
  const start = monthAt(9), ready = monthAt(10) + 30 * DAY;
  const prs = batch(1, 10, 10, monthAt(9, 7), monthAt(9, 9));
  const data = { days: [], prs, login: "me" };
  assert.equal(computeRecords(data, ready - 1).rateMonth, undefined);
  const first = computeRecords(data, ready);
  same(first.rateMonth, { n: 10, rate: 1, start });
  const revised = computeRecords({ ...data, prs: [...prs, prRow(pullRequest(11, monthAt(9, 10)))] }, ready);
  same(mergeRecords(first, revised, ready).kept.rateMonth, { n: 11, rate: 10 / 11, start });
});

test("Shipped shows the new best month when the old winner's production share falls below it.", async () => {
  const { computeRecords, mergeRecords, batch } = await recordFixtures();
  const september = monthAt(9), october = monthAt(10), now = monthAt(12, 5);
  const prs = [...batch(1, 10, 10, september, september + DAY), ...batch(11, 10, 9, october, october + DAY)];
  const data = { days: [], prs, login: "me" };
  const original = computeRecords(data, now);
  same(original.rateMonth, { n: 10, rate: 1, start: september });
  const revised = computeRecords({ ...data, prs: [...prs, ...batch(21, 2, 0, september)] }, now);
  const { kept, beaten } = mergeRecords(original, revised, now);
  same(kept.rateMonth, { n: 10, rate: 0.9, start: october });
  same(beaten, []);
});

test("Shipped only announces better recent records and keeps older improvements quietly.", async () => {
  const { mergeRecords } = await shipped(["mergeRecords"]);
  const now = monthAt(11, 4);
  const first = { prodWeek: { n: 8, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 10, start: monthAt(10) } };
  same(mergeRecords(null, first, now), { kept: first, beaten: [] });
  const recent = { prodWeek: { n: 9, start: monthAt(11, 2) }, rateMonth: { rate: 0.9, n: 10, start: monthAt(11) } };
  same(mergeRecords(first, recent, now), { kept: recent, beaten: ["prodWeek", "rateMonth"] });
  const old = { prodWeek: { n: 10, start: monthAt(9, 7) }, rateMonth: { rate: 0.8, n: 20, start: monthAt(10) } };
  same(mergeRecords(recent, old, now), { kept: old, beaten: [] });
});
