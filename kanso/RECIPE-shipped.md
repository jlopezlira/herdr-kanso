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
- the hero: the lines added (56 and light; 40 under 560 wide), with
  the lines removed beside it (22, `muted`) and "lines shipped, this
  week". A green or red 6 dot gives the change against the period
  before, cut at the same point (a running week compares with the
  whole last one). It reads as a percentage, or as a multiple past
  double ("65x"). A day leads with its contributions instead, since
  GitHub's sums are weekly.
- under the hero, light 28 numbers with 11 `dim` units: contributions,
  pull requests merged, commits, reviews and repositories. Then a
  `muted` line with your totals since you joined GitHub: pull requests
  merged, lines, commits and repositories.
- "Streak": the current run of days with a contribution (40; today
  without one yet does not break it), and "longest N days" at the
  right. Then the calendar as GitHub draws it: as many whole weeks as
  fit the width, up to 53, with squares of 9 to 16 sized to fill it,
  3 apart. Each square is `accent` at alpha 40/70/b0/ff by GitHub's
  quartile, `hover` when empty, with a tooltip.
- "Records": best day (contributions), best week and best month
  (lines), longest streak, and most commits in a week. Each is a
  hairline row with its detail in `dim` and its value (20, light) at
  the right. A record you just set (within the last week, or the last
  month for the best month, beating the stored one) shows a "New
  record" chip in `accent` and toasts once. Records keep the best ever
  seen in `shared("kanso.shipped.bests")`.
- "When you ship": 24 bars (56 tall, radius 2) of the period's commits
  by local hour, the peak at full `accent` and the rest at alpha 90.
  Above them, "most at HH:00 · N% after 9 pm"; under them, the hours
  00 06 12 18 23 in `dim`. Then one hairline row per machine:
  `commits · +a −d`.
- "By repository": the name, `commits · +a −d`, and a 4 tall `accent`
  bar by share; 8 rows, then "Show N more". A day shows its week.

Where the numbers come from:
- **GitHub, through `gh`.** One GraphQL query of counts per period:
  the period's and the compared period's contribution totals
  (`restrictedContributionsCount` included), merged pull request
  counts by search, the last year's calendar, and every pull request
  you ever merged. Your repositories: `repositoriesContributedTo`,
  plus those you reach as owner, collaborator or organization member.
  For each, `stats/contributors` gives your additions, deletions and
  commits per week on its default branch. A GitHub week counts from
  Sunday, UTC, so each is placed at its Monday noon. GitHub answers
  `{}` while it computes; that repository is asked again 5 s later,
  up to 6 times, then on the next refresh.
- **This machine's git** (`shipped-store.js`). It reads the
  repositories of your panes and spaces, the ones read before, and
  any `.git` up to 4 levels under `~/Apps`, `~/Projects`, `~/Developer`,
  `~/code`, `~/src`, `~/dev`, `~/work`, `~/repos`, `~/git` and
  `~/github`. Each is named by its remote (`owner/name` on GitHub). It
  runs `git log --all --no-merges -F --author=…` for every identity of
  yours: GitHub login, name and noreply addresses, the global
  `user.email` and `user.name`, and those your other machines
  published. A repository is read again only when its refs change, and
  all of them when the identities change.
- **Your other machines.** Each publishes its commits to a private
  gist, "Kanso Shipped stats", one `shipped-<host>.json` per machine
  (repositories, then `[repo, 12-character hash, time, adds, dels]`
  and its identities), and reads the others'. A commit counts once by
  repository and hash.

Everything is kept in SQLite (`data/kanso-panel/shipped.db`, through
the `sqlite3` command), statistics only: commits, GitHub's weeks,
GitHub repositories with when each was pushed and read, scans, and
meta. A repository's week counts the larger of the commits' sum and
GitHub's. Each refresh reads only what changed. The panel rereads
every 5 minutes while shown; a dim line names the step it is on.
