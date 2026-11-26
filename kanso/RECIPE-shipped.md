# Shipped (`kanso-panel`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the Shipped
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

## What you see

The Shipped panel (`kanso-panel` with `shipped`) is vanity metrics on
purpose, drawn like Spend. It has:
- a header: "Shipped" (20), a share icon and a refresh icon. Share
  opens a row: "Share to" X, LinkedIn, Bluesky, and "Save image"
  (outlined buttons, 26 tall), with a `dim` note under it.
  Sharing is one module for every panel, `share.js` (copied by
  `npm run sync:share`). A panel hands it a card spec: a title and the
  period, a hero, numbers three to a row, a note, and blocks
  (`streak` with 53 columns of the calendar, `list`, `bars`).
  `shipped-card.js` makes Shipped's, with no repository or machine
  names. `share.js`
  draws a 1200-wide SVG, which becomes a PNG at 2x through the first
  renderer found: a Chromium browser headless (`--screenshot`),
  `rsvg-convert`, `magick`, or QuickLook on macOS. The PNG is saved
  to `~/Downloads`. For a network, the image is copied (`osascript`
  on macOS; `wl-copy` or `xclip` on Linux), the composer opens with
  the text filled in, and once the browser is in front and the page
  had a few seconds to load (3 to 5, by network) the image is pasted
  into it: System Events Cmd-V on macOS (needs Accessibility), `wtype`
  or `xdotool` on Linux, never into an app you moved to; else the
  toast says to paste. The text: the big numbers, the streak and the
  repository link, 280 characters at most.
- Day, Week, Month and Year tabs (26 tall, a `selected` wash on the
  active one), with previous and next arrows around the period's name
  ("This week", "Last week", "19 Oct – 25 Oct"). Next stops at now.
- the hero: the pull requests you opened in the period that reached
  production (56 and light; 40 under 560 wide), then "pull requests in
  production, this week · N% of those you opened". A green or red 6
  dot gives the change of that share, in points, against the whole
  period before ("+4 points vs last week"). While the first read runs
  it shows "…".
- under the hero, light 28 numbers with 11 `dim` units: opened,
  merged, the median time to merge, closed unmerged, reviews, merged
  in others' repositories and contributions. Then a `muted` line with
  the pull requests you merged since you joined GitHub.
- "Your trend": the last 6 periods, one hairline row each: "N of M ·
  P%" and a 4 tall `accent` bar by that share.
- "Streak": the current run of days with a contribution (40; today
  without one yet does not break it), and "longest N days" at the
  right. Then the calendar as GitHub draws it: as many whole weeks as
  fit the width, up to 53, with squares of 9 to 16 sized to fill it,
  3 apart. Each square is `accent` at alpha 40/70/b0/ff by GitHub's
  quartile, `hover` when empty, with a tooltip.
- "Records": best day (contributions), longest streak, most pull
  requests in production in a week, and the best month's share in
  production (10 opened at least). Each is a hairline row with its
  detail in `dim` and its value (20, light) at the right. A record you
  just set (within the last week, or the last month for the best
  month, beating the stored one) shows a "New record" chip in
  `accent` and toasts once. Records keep the best ever seen in
  `shared("kanso.shipped.records")`.
- "When you merge": 24 bars (56 tall, radius 2) of the period's merged
  pull requests by local hour, the peak at full `accent` and the rest
  at alpha 90. Above them, "most at HH:00 · N% after 9 pm"; under
  them, the hours 00 06 12 18 23 in `dim`.
- "By repository": the name, "N of M in production", and a 4 tall
  `accent` bar by that share; 8 rows, then "Show N more".

Where the numbers come from, all through `gh` (`shipped-github.js`):
- One GraphQL query per period: its and the period before's
  contribution totals (`restrictedContributionsCount` included), the
  last year's calendar, and how many pull requests you ever merged.
- Your pull requests, searched by the month they were opened
  (`is:pr author:@me created:…`, a range split in two while it holds
  over 1,000), from the first period the trend shows. A month is read
  once; after that `updated:>=` the last read brings what changed, and
  after a week away the months since are read again.
- A pull request is in production when it is merged into the
  repository's default branch, or its merge commit is in that branch's
  history (a release from `develop` into `main`): the default
  branch's commits since the oldest waiting merge are read, 20 pages
  at most per repository and refresh.

The cohort is what you opened in the period: opened, merged, in
production, closed unmerged, still open, and the median from opening
to merge. Everything is kept in SQLite (`data/kanso-panel/shipped.db`,
through the `sqlite3` command): each pull request's link, repository,
owner, number, times, base and default branch, merge commit and
whether it reached production, the months read, and meta. No title,
body or code. The tables of the line counts before are dropped. The
panel rereads every 5 minutes while shown; a dim line names the step
it is on.
