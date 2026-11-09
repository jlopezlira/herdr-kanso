<p align="center">
  <a href="https://jlopezlira.github.io/herdr-kanso/"><img src="docs/logo.svg" width="96" height="96" alt="kansō"></a>
</p>

<h1 align="center">kansō</h1>

<p align="center"><b>More agents. Less babysitting.</b></p>

<p align="center">Every agent in a readable pane, the one waiting on you first, and a machine that lasts weeks. A layout for <a href="https://herdr.dev">Herdr</a>.</p>

<p align="center">
  <a href="https://jlopezlira.github.io/herdr-kanso/">Website</a> ·
  <a href="#install">Install</a> ·
  <a href="#keys">Keys</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://jlopezlira.github.io/herdr-kanso/">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="site/shots/hero-light.png">
      <img alt="kansō in the Herdr app: a sidebar of projects and their agents, and agents side by side on the strip, one asking for a decision." src="site/shots/hero.png">
    </picture>
  </a>
</p>

## Install

Tell your agent: **`add herdr.dev/layouts/jlopezlira/herdr-kanso--kanso`**

Or, from a clone: `sh ./scripts/local-install.sh`. You need the Herdr app;
`gh` for the PR and Shipped panels; Node 22.15 or newer for Spend. kansō
updates itself: a release shows as a row above Settings, and a click installs
it. `ctrl-shift-l` goes back to your previous layout.

## What it does

- **A strip, not a grid.** Terminals keep their width; a new pane opens beside
  you and the view glides to it. Pin a column, stack a server under an agent,
  1 to 8 columns per view.
- **Needs you first.** Cmd+J goes to the agent waiting on you, in any space.
  The sidebar shows every project, every agent's state and what it is on, and
  your conversations as threads.
- **Sleep and wake.** An agent, a tab or a project goes to sleep: it exits with
  its conversation kept, and wakes on it where it was.
- **Preview.** The newest picture the agent in focus made, big beside it,
  its other recent ones in a strip below. Click a spot to pin it and say what
  about it; ⌘↩ sends every note to the agent.
- **Review without leaving.** Pull requests with diff, checks and threads, and
  one click to hand the feedback to an agent. Markdown files open to read and
  edit in place; `md-review plan.md` from an agent asks for your comments.
- **Take over in one key.** Cmd+Shift+O opens the agent's folder, worktree
  included, in your editor. Cmd+Alt+S hands a pane's work to another agent.
- **What your agents leave running.** Ports: dev servers and the panes that
  run them. Containers: Docker, with Up, Rebuild and Down per project.
  Worktrees: every one agents made, what removing it would lose, the disk back.
- **Weeks without a restart.** The memory guard recycles bloated idle Claude
  agents on the same conversation; the Memory panel shows what it sees.
- **Spend and Shipped.** What your AI work is worth at list price, and what you
  delivered on GitHub, with share images that carry totals only.
- **Keys you can see.** Cmd+? draws your keys on a keyboard, layer by modifier,
  and opens the hjkl dōjō, a game for vim's moves with a pixel pet.
- Two themes, `kanso` and `kanso-day`.

## Keys

| Keys | What they do |
|---|---|
| Cmd+1 … Cmd+9 | Go to pane 1 to 9 |
| Cmd+[ and Cmd+] | Previous and next pane |
| Cmd+D, Cmd+Alt+D, Cmd+Shift+D | New pane right, left, below |
| Cmd+W | Close the pane |
| Cmd+Shift+[ and Cmd+Shift+] | Move the pane left and right |
| Cmd+Shift+- and Cmd+Shift+= | Fewer or more panes per view |
| Cmd+Shift+Enter | Wider or narrower pane |
| Cmd+Alt+P | Pin the pane |
| Cmd+Shift+O | Open the pane's folder in an editor |
| Cmd+Alt+S | Send the pane's work to another agent |
| Cmd+Alt+T | Arrangements: save this tab, or open a saved one |
| Cmd+J | Next agent that needs you |
| Cmd+Alt+H/J/K/L | Between panes, as vim; Shift moves the pane |
| Cmd+? | kansō help, and the dōjō |

Every list answers j, k, gg, G, Enter, / and Esc. The gear at the end of the
tab bar rebinds kansō's own keys and hides the panels you don't use.

## Privacy

Everything runs on your machine, and reads only the folders you work in:
`git`, `gh`, `find`, `du`, `lsof`, `ps`, `sqlite3`, `node`, `docker` and
Herdr's `hc`. Two things reach the network, only while their panel is shown:
PR and Shipped through `gh` (Shipped keeps a private gist of your own
statistics), and Spend's daily fetch of OpenRouter's price list. Threads and
Preview read the agents' conversation files for titles and the pictures
they printed; Spend reads the session files your AI tools write, for tokens and
prices. State lives under `~/.config/herdr-app/data/`. Nothing is sent to an
agent unless you press Send, and share images carry totals only.
[kanso/RECIPE.md](kanso/RECIPE.md) says what every part runs.

## Development

`npm test` (Node 22.15+, Git, Bash, sqlite3). A pull request that changes
what kansō installs bumps `kanso/mods/kanso-chrome/version.json` and adds the
version's section to [CHANGELOG.md](CHANGELOG.md); `npm run check:version`
checks it, and merging to main releases it. How every part is built:
[kanso/RECIPE.md](kanso/RECIPE.md).

## Credits and license

Grown out of the mods shipped with Herdr; [NOTICE](NOTICE) says who changed
what. Contributors: Iván Campaña ([icampana](https://github.com/icampana)) and
Johannes Hund ([h0ru5](https://github.com/h0ru5), markdown reviews). Apache
License 2.0: [LICENSE](LICENSE).
