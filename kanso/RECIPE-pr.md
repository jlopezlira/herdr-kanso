# PR (`kanso-panel`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the PR
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

## What you see

The PR panel (`kanso-panel` with `pr`) shows one pull request at a time: the focused
pane's branch while open (a merged or closed one counts as none), else the newest
open one ("the newest open; <branch> has none"), drawn like Spend: one
centered column (max 1080, 16 px sides under 560 wide, else 32), no
cards or uppercase labels, `canvas` behind, hierarchy from size, weight
and tone, hairlines between list rows. Top to bottom:
- Header: "Pull request" (17, 20 when wide), then at the right a
  hairline pill "Open" until that list has been read, then "N open",
  with a chevron, refresh (spins while reading),
  copy link (the PR's URL to the clipboard; a check for 1.5 s) and open
  on GitHub. Signed in, "N to review" is how you open Needs you and Yours
  by project. The panel stays on this branch; the pill does not open by
  itself. Absent when `gh` is not signed in. Reviews reread every 120 s
  while that page is shown.
- The page of open ones: the pill turns the panel to it (the title
  reads "Open pull requests", the pill "Back to #n"); it scrolls with
  the panel, as a popover's layer did not. `gh pr list --state open`
  runs when that page is opened and again while it stays open, not on
  the timer that rereads the one in front. The repository's open pull
  requests (by anyone) under section titles
  with a count: This branch, Yours, Others. A row reads as the hero in
  small: the whole title (14, wraps; medium and on `selected` with
  "Shown" at the right when shown), then `#n · author ("you") · updated
  <age>` (11.5, dim), then a 6 dot and its state (the same words as
  the verdict, ready only when GitHub would merge) and `+a −d`. A click shows it and leaves
  the page; the branch's own goes back to following the branch. When
  the branch has none, the page ends with "Create one for <branch>"
  under the same rule as "Create it on GitHub".
  The page is titled "Pull requests" and starts with two tabs (26 tall,
  12, `selected` wash on the active one): "Open N", the page above, and
  "Closed", the repository's 30 most recently finished ones (`gh pr list
  --state closed`, read when that tab opens and again while it stays
  open), grouped the same way,
  each row with `merged <age>` or `closed <age>` and "Merged" (violet)
  or "Closed without merging" (red). A finished one is shown only when
  picked here; the pill is there whenever the pane is in a repository.
  Every `gh pr` action names the pull request by URL.
- Hero: `#n · head → base` (15, muted); the title (22, 28 wide, light,
  line height 1.25); a 6 dot and the verdict (15). Ready to merge
  (green) only when GitHub would and you can push. Otherwise a few
  words: review required, changes requested, checks failing, behind
  the base, draft, blocked by branch rules, conflicts, or still
  computing. Failing checks, including GitHub's unstable state, show
  those words and no Merge. Merge (30 tall, second press within 4 s,
  red while armed) is shown only for "Ready to merge". The pane header
  uses these same words for checks and reviews, says nothing about
  permission, and does not call a pull request ready. Quiet links: Ready for review or Back to draft,
  and Close. A closed one offers Reopen. Author and age (12, dim),
  then light numbers (22/28): files, added, removed, threads, checks.
- Description: the PR's body as Markdown (`TextView.markdown`,
  selectable, 13, links open in the browser), template comments
  stripped. Past 6 lines or 480 characters it folds to 150 tall with
  "Show all" / "Show less". An empty body reads "No description." (dim).
- People and labels, as T3 Code's meta rows: a 76-wide dim label,
  the values, and at the right a 22 icon button that opens T3 Code's
  candidate picker (a popover 288 wide: a search field, then the
  candidates with a check on those applied; a click applies or takes
  one back through GitHub's REST API and the picker stays open; a
  breathing silhouette while it reads; a note when the repository has
  more than 100). Assignees (with "Assign to me" when you aren't),
  Reviewers (who reviewed with the outcome, then who is still asked;
  the author is never offered) and Labels (chips in the label's own
  color at 15% with a dot of it). Candidates come from GraphQL
  `assignableUsers` (GitHub's own picker list, readable without push
  access) and the repository's labels, as in T3 Code.
- Checks (when there are any): failing first, 5 shown, "Show N more";
  a row opens the check's page.
- Unresolved threads (when there are any): the first comment, then
  path:line, author, replies, outdated; a row opens it on GitHub.
- Ask your agent: Explain it, Address feedback (open PRs), Resolve
  conflicts (only when conflicting), as quiet links. Each opens a tab
  named `#<n> <task>` in the repository, running the first installed
  agent (`knownAgents`) with T3 Code's task prompt as its first message.
- Files: name (13) over folder and add/delete mark (11, dim), +/- at the
  right; 8 shown, "Show N more"; a row shows its diff inline (first 400
  lines, monospace, in a hairline box).
- A footnote (10.5, dim): read from GitHub with gh, and when. While
  this one is shown it rereads about once a minute, and every 20 s
  while a check runs. While the window is behind others, or this panel
  is hidden, that wait does nothing, and the next look in front reads
  at once. A missed or timed-out reread keeps the last pull
  request, with "as of <age>" and Retry. When GitHub asks to wait, the
  line is "GitHub asks to wait until <time>" and refresh does not call.
- Loading is the view's silhouette in `border` tone, breathing between
  35% and 80%. Without a PR: "No pull request for <branch>." and
  "Create it on GitHub" (the web form), only for a pushed branch that
  is not the default one. A first read that fails says so, with "Try again".
  What gh lacks is one `muted` line with no action ("No remote").
