# PR (`kanso-panel`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the PR
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

## What you see

The panel shows the focused pane's branch. A merged or closed pull request
on that branch counts as none. It does not stand in some other open one.
One centered column (max 1080, 16 px sides under 560 wide, else 32).

The page opens on the verdict: what stops this pull request. Scope (12, dim)
and `#n`, then the title (17, medium, two lines), then an 8 dot and the
verdict (13.5, medium) in that state's tone. One card under it. One primary
action, and one quiet link. Description, people, labels, files and checks
sit behind Details, closed until opened, and that choice is kept per project.

The verdict, in order, and its one action:

- Merged at the local time (violet). Closed without merging (dim), with Reopen.
- Draft (dim), even when checks fail. Ready for review.
- Conflicts with the base (blocked). Send, or open it on GitHub.
- A failed check (blocked): the job and the step, then the last lines of that
  step. Send, or open the log. `+N more` opens the checks.
- Changes requested (blocked): the first unresolved comment, author and
  path:line. Send, or reply on GitHub.
- Behind the base (working). Update branch, for someone who can push.
- Checks running (working): the running rows. No action.
- Review required (working). No action.
- Blocked by branch rules, or still computing. No action.
- No permission to merge (muted). No action.
- Ready to merge (done). Squash and merge. The method still follows the repo.

Send goes to the agent of the pane in front. The first press shows the log
or the comment. The second sends it. A blocked agent is named on the verdict
and Send is absent. When the pane is not an agent, the GitHub link is the
primary. Merge, Push, Pull, Update branch, Ready, Close, Reopen and Back to
draft ask for a second press. Send, Create and Sign in do not.

With no pull request the same page says where the branch is: not signed in
(Sign in), commits not on GitHub (Push), commits behind GitHub (Pull), no
pull request for the branch (Create on GitHub, only where `gh` can), or the
default branch. No remote and no GitHub remote stay one line with no action.

Details holds what the page used to lead with: the description (Markdown,
folded when long), people and labels, every check, unresolved threads, files
and their diffs, other open pull requests, and Close or Back to draft.
Other pull requests in that fold are not rows you open; Open the list does.

The list and the Closed tab stay. A row uses the same verdict words. The
header keeps "N open" and "N to review". The inbox is not this page.

A missed answer keeps the last pull request, dimmed, with "as of <age>" and
Retry. Writes wait until a read succeeds. When GitHub asks to wait, the line
is "GitHub asks to wait until <time>". The panel rereads while it is shown
and stays quiet when the window is behind or the panel is hidden. The log of
a failed run is one read when that state is first shown, never on the timer.

Loading is the silhouette. Another computer uses the same lines, and every
`gh` and `git` command names that computer.
