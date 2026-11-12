# Worktrees (`kanso-panel`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the Worktrees
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

## What you see

The Worktrees panel (`kanso-panel` with `worktrees`, `worktree.svg`) is
drawn like PR and Spend. It searches the top folders of your spaces
under your home and the temp folders (or exactly shared
`kanso.worktrees.roots`) for `.git/worktrees/*/gitdir` and `.git`
files, pruning dependency and build folders; each repository's
`git worktree list --porcelain -z` then gives its worktrees wherever
they are, and a `.git` file naming a worktree record that is gone is
listed under "Left behind". Each worktree is probed (8 at a time, git
with `--no-optional-locks`; a folder with a `.git` directory is a
repository of its own, whose old record alone can go; one git can't
read is broken and nothing else is believed): uncommitted entries, commits no branch,
tag or remote has, commits not in the default branch or `develop`
(origin's and local), merged when an ancestor of one or when
`git merge-tree` into it changes nothing (squash merges), and in use
when a file or its HEAD changed within `kanso.worktrees.idleHours`
(24). Then `du -sk`, 4 at a time. It has:
- a header: "Worktrees" (20), the step it is on (11, `dim`) and a
  refresh icon that spins while it scans; a breathing silhouette
  until the first repositories are read;
- a hero: "On this computer" (15, `muted`), the size of them all
  (72 light, 48 under 560 wide) with "in worktrees", what Clean up
  frees, and worktrees, repositories, need a look and folders gone
  (28 light); then "Clean up N" (primary, 30 tall), which a second
  press within 4 s confirms (accent, "Press again to remove N"). It takes
  what loses nothing: merged, not merged (the branch keeps its
  commits), detached with every commit on a branch, and folders gone;
  never one git can't read (its `.git` names a moved repository:
  "Repair the link" runs `git worktree repair`), one with uncommitted
  changes or commits only there, in use,
  open in a pane or space, or locked. Merged branches are deleted;
- a section per repository, largest first (8, then "Show N more
  repositories"): its name (15), its folder (11.5, `dim`), count and
  size; 4 rows (then "Show N more"), each a ghost button like PR's
  list rows: the folder's name (14), branch and last commit (11.5),
  a 6 px dot and the state in its color (green: Clean up takes it;
  red: uncommitted changes or commits only here; yellow, breathing:
  in use today; yellow: open in Herdr) and the size (15 light). A
  click selects it and shows what removing it loses, its path, "Open
  in a new tab" (`tab.new` with `folder`) and "Remove" (two presses;
  `git worktree remove`, `--force` only with uncommitted changes, the
  branch when merged, then `git worktree prune`). Under the rows:
  "Prune N folders already gone" and "Remove all N" (two presses; the
  losses in red while armed), which takes all but the ones in use,
  open or locked. Every removal probes it again first and skips one
  that no longer qualifies, with a dim note instead of an error;
- **Where the space is**, after the hero: one 10 px bar split by
  state (green can go, red needs a look, yellow in use or open, `muted`
  left behind, `border` still checking), a legend row each (dot,
  label, count, size, share), and the 6 repositories that take the
  most as 4 px bars against the largest;
- **Freed**, from `worktrees-store.js`: SQLite
  (`data/kanso-panel/worktrees.db`, through the `sqlite3` command).
  Every `sqlite3` waits up to 10 s for a lock (`.timeout`), as two copies of the panel can write at once.
  `worktrees` has a row per worktree while it lives (a partial unique
  index on the path): a finished scan inserts the new ones and rewrites
  a row only when its repository, branch, what it holds or its size
  changed. A row whose folder is gone (or a record its repository no
  longer lists) gets `gone_at`, `gone_by` (`kanso`, or `outside` when
  a scan finds it gone) and `freed` (its last size); the same path made
  again is a new row. `scans` keeps each scan's totals. The panel opens
  on the live rows, marked as not checked (no removal until the scan
  sees them again). It shows the total freed (48 light), here and
  outside, the three counts (24 light), and two charts of 30 days drawn
  like Spend's, drawn empty too until there is data: freed each day (96
  tall) and in worktrees each day (the day's last scan, 56 tall). A removal posts a toast with what it freed
  and the total;
- **Ask your agent**, when some would lose work: "Review the N that need
  a look" opens your first installed agent (`knownAgents`) in a new tab
  with them listed, to say what each holds, where else it lives (git,
  `gh`) and what to remove, changing nothing. A row's "Explain it" does
  the same for one, in its folder;
- the header's share icon opens share.js's row: the card
  (`freedSpec`) has the size freed, the three counts and the days; before
  anything was freed, the size they take, how many, what can go and
  what needs a look, with the disk by day; and where the space is now,
  by state. Never a repository, branch or path.
