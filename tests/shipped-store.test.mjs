import assert from "node:assert/strict";
import test from "node:test";
import { same } from "./helpers.mjs";
import { DAY, HOUR, openedShippedStore, pullRequest, shippedHost, shippedStore } from "./shipped-fixture.mjs";

const start = new Date(2026, 10, 2).getTime();

test("A pull request merged into the repository's default branch is already in production.", async () => {
  const { prRow } = await shippedStore();
  const direct = pullRequest(1, start, { base: "trunk", main: "trunk", merged: start + HOUR });
  same(prRow(direct), {
    url: direct.url, provider: "github", repo: "me/tool", owner: "me", number: 1, created: start,
    merged: start + HOUR, closed: start + HOUR, base: "trunk", main: "trunk", merge_oid: "merge-1", prod: 1,
  });
  assert.equal(prRow(pullRequest(2, start)).prod, 0, "still open");
  assert.equal(prRow(pullRequest(3, start, { main: null, merged: start + HOUR })).prod, 0, "no default branch");
  assert.equal(prRow(pullRequest(4, start, { base: "develop", merged: start + HOUR })).prod, 0, "not on the default branch yet");
});

test("Shipped keeps confirmed production status in SQLite when GitHub returns the pull request again.", async (t) => {
  const store = await openedShippedStore(await shippedHost(t));
  const { prRow } = await shippedStore();
  const waiting = prRow(pullRequest(1, start, { repo: "you/team's-tool", base: "develop", merged: start + HOUR }));
  const unrelated = prRow(pullRequest(2, start));
  await store.save([waiting, unrelated]);
  await store.markProd([waiting.url]);
  const reread = { ...waiting, main: "trunk" };
  await store.save([reread]);
  same((await store.prs()).toSorted((a, b) => a.number - b.number), [{ ...reread, prod: 1 }, { ...unrelated }]);
});

test("Shipped looks in the default branch only for waiting merges with a known commit.", async () => {
  const { pendingByRepo, prRow } = await shippedStore(undefined, ["pendingByRepo", "prRow"]);
  const opts = { base: "develop", merged: start + 2 * HOUR };
  const newer = prRow(pullRequest(1, start, opts));
  const older = prRow(pullRequest(2, start, { ...opts, merged: start + HOUR }));
  const other = prRow(pullRequest(3, start, { ...opts, repo: "org/app", main: "trunk" }));
  const waiting = pendingByRepo([
    newer, other, older, { ...newer, prod: 1 }, { ...newer, merge_oid: null }, { ...newer, main: null },
    { ...newer, base: newer.main }, prRow(pullRequest(4, start, { base: "develop" })),
  ]);
  same(waiting.map(({ oids, ...repo }) => ({ ...repo, oids: [...oids] })), [
    {
      repo: "me/tool", main: "main", since: older.merged - DAY, until: newer.merged + DAY,
      oids: [[newer.merge_oid, newer.url], [older.merge_oid, older.url]],
    },
    {
      repo: "org/app", main: "trunk", since: other.merged - DAY, until: other.merged + DAY,
      oids: [[other.merge_oid, other.url]],
    },
  ]);
});

test("Shipped reads complete calendar months across the new year without including the exclusive end.", async () => {
  const { monthsIn } = await shippedStore(undefined, ["monthsIn"]);
  const at = (year, month, day = 1) => new Date(year, month - 1, day).getTime();
  const jan = at(2027, 1), feb = at(2027, 2);
  same(monthsIn(at(2026, 12, 27), feb), [
    { month: "2026-12", start: at(2026, 12), end: jan },
    { month: "2027-01", start: jan, end: feb },
  ]);
});

test("Shipped counts outcomes for pull requests opened in the period and groups the results by repository.", async () => {
  const { cohortOf, prRow } = await shippedStore(undefined, ["cohortOf", "prRow"]);
  const end = start + DAY;
  const prs = [
    pullRequest(1, start, { repo: "Me/tool", merged: end + HOUR }),
    pullRequest(2, start, { repo: "org/b", merged: start + 2 * HOUR }),
    pullRequest(3, start, { repo: "org/b" }),
    pullRequest(4, start, { repo: "org/a", merged: start + 4 * HOUR }),
    pullRequest(5, start, { repo: "org/a", closed: start + HOUR }),
    pullRequest(6, start, { repo: "org/c", base: "develop", merged: start + HOUR }),
    pullRequest(7, end, { merged: end + HOUR }),
    pullRequest(8, start - HOUR, { merged: start + HOUR }),
  ].map((pr) => prRow(pr));
  same(cohortOf(prs, start, end, "mE"), {
    opened: 6, merged: 4, prod: 3, dropped: 1, open: 1, rate: 0.5, toMerge: 3 * HOUR, elsewhere: 3,
    repos: [
      { repo: "org/a", opened: 2, prod: 1 },
      { repo: "org/b", opened: 2, prod: 1 },
      { repo: "Me/tool", opened: 1, prod: 1 },
      { repo: "org/c", opened: 1, prod: 0 },
    ],
  });
  same(cohortOf(prs, end + DAY, end + 2 * DAY), {
    opened: 0, merged: 0, prod: 0, dropped: 0, open: 0, rate: null, toMerge: null, elsewhere: 0, repos: [],
  });
});

test("The merge rhythm uses the local hour of each merge, regardless of when the pull request opened.", async () => {
  const { mergeHours, prRow } = await shippedStore(undefined, ["mergeHours", "prRow"]);
  const end = new Date(2026, 10, 3).getTime();
  const afternoon = new Date(2026, 10, 2, 15, 42).getTime();
  const prs = [start, afternoon, afternoon, end, start - 1, null].map((merged, i) =>
    prRow(pullRequest(i + 1, start - DAY, { merged })));
  const hours = mergeHours(prs, start, end);
  same(hours, Array.from({ length: 24 }, (_, h) => h === 0 ? 1 : h === 15 ? 2 : 0));
});
