# Changelog

Every change to what kansō installs, newest first. Versions follow
[Semantic Versioning](https://semver.org): a release that lists Breaking or
Removed changes is a major version, one that lists Added or Deprecated is a
minor version, anything else is a patch. The format follows
[Keep a Changelog](https://keepachangelog.com). `npm run check:version`
checks all of this, and merging to main releases the version in
`kanso/mods/kanso-chrome/version.json`, which is what the updater offers.
Technical debt (a change that keeps what you see and do) merges without a
version of its own, listed under `## [Unreleased]`, and goes out with the next
release.

## [3.17.6] - 2026-11-09

### Changed

- Project names head their groups on their own, without the colored square with the initial: in Projects, in Threads grouped by project, and on Status rows, which now lead with the agent's icon (the project's name keeps its color on the second line). In Threads, a project's conversations sit indented under its name, without the project repeated on each row, and the next project starts after a wider gap.
- The collapsed sidebar shows one mark per group instead of a tile per agent: a project's initial in its color, a status, or Pinned, Snoozed and Settled as small icons, each with its most urgent state (the spinner while one works, red when one needs you) and how many. A click lists that group's agents in a menu, with their states, that you can walk with the keyboard; a click on one goes to it, an asleep one opens its wake menu. Right click on a project still opens the project's menu.
- The sidebar's edge drags narrower than before: under 240 px the rows keep one line, and under 160 px it folds to the rail, as Hide sidebar does, opening again at the width you had.

## [3.17.5] - 2026-11-09

### Changed

- The collapsed sidebar keeps the view you chose instead of always showing projects: a small switch under its buttons picks Projects, Status or Threads, and Status and Threads show their agents as tiles (the program's icon with its status dot; hover for the name and project, click to go, right click for the menu), grouped under the same sections as the open view, each with its mark and count, folding as there.

## [3.17.4] - 2026-11-09

### Changed

- Look is now Gallery, and shows pictures only: the newest big and the newest twelve as tiles under it, a click on a tile to look at that one. PDFs, documents, code, audio and video are no longer listed; the apps that open them do that. The panel's id and `herdr-app do 'kanso-tabs.look <path>'` are unchanged, and `kanso-tabs.gallery` works too.
- A pin asks for its note in a dialog as you drop it, and the notes line up under the picture, each with its number (a click edits one, × drops it); Send sends them all at once, one line per pin with where it sits and what you said. The note box under the picture is gone.

## [3.17.3] - 2026-11-09

### Fixed

- Sleep answers Claude Code's question before it leaves ("Background work is running… 1. Exit and stop tasks"): sleeping an agent is stopping everything of it, so the agent exits and the tab sleeps instead of stopping half way with the question on screen.
- A sleep that stopped half way lets go of its agents after 3 minutes instead of 10 (a sleep renews its hold before each agent leaves), and sleeping the tab again after that frees them on the spot, so "that agent is already asleep" no longer stands in the way.

## [3.17.2] - 2026-11-08

### Fixed

- Look found nothing from a Claude agent: it read the agent's screen, where Claude Code abbreviates long paths ("…/shot.png") and soon redraws over them. For a Claude agent Look now also reads the end of its conversation on disk, where every path is whole and stays, so the pictures it made show even when its screen has moved on.

## [3.17.1] - 2026-11-08

### Fixed

- A sleep that stopped half way (its window closed, Herdr restarted) left its agents marked asleep while they kept running, so the tab could never sleep again ("that agent is already asleep"). Once nothing holds such a sleep for 10 minutes, seeing its agents still running frees them and ends the sleep; trying before then says so, and when.

## [3.17.0] - 2026-11-08

### Added

- Look, a new panel (the eye in the tab bar): the screenshots, pictures and PDFs the agent in focus made, shown beside it instead of in Preview, with its documents and code a click away in the preview panel and its audio and video in their own app. The newest picture shows by itself unless you picked another, and again when the agent writes it again. Click on it to drop numbered pins, write a note under it and send it with ⌘↩: the agent gets "About <file>: <note>" and where each pin sits. Links and HTML pages keep opening in the browser. An agent can open a file there itself with `herdr-app do 'kanso-tabs.look <path>'`.

### Fixed

- One kansō update at a time: an Update clicked in the footer and one from the tab bar or Settings, or in two windows, no longer run together on the same files; the second is told, however long the first takes. An install runs on its own, past Herdr's 30 s limit for a command and through the reload it causes, and a failure partway through the swap puts back every mod you had, not only the one that failed. One stopped outright, even while it was putting things back or clearing up, is finished or undone the next time kansō starts: mods are replaced one at a time, the tab bar and kanso-chrome last, so one of them is always there to do it. An Update after one stopped like that puts things back before it decides your keys, so it never installs the new version with the old ones, and a window that finds another still putting things back waits for it, and does it itself if that one stops short, before it tells you how the update ended. Only the tab bar looks for new releases on its own, so a start asks GitHub once.

## [3.16.0] - 2026-11-08

### Added

- Notifications no longer pile up: one already on screen is not shown again, so clicking something many times shows its message once, and at most three stay up, the oldest making room for the newest. Kansō draws its own notifications for this, Herdr's agent notices included.

## [3.15.2] - 2026-11-08

### Changed

- The sidebar asks whether each conversation's agent still runs every 10 s instead of twice a second (every minute behind other windows or collapsed), at once when one starts, and through the `ps` it already takes for what runs under each agent when it can. That table is read once for every agent, the same way the ports panel reads it, and a `ps` that hangs is given up on after 10 s instead of stopping both checks; its late answer is ignored.

### Fixed

- Memory recycles a Claude Code agent started with `--add-dir`, `--mcp-config` or allowed and disallowed tools, as Sleep already resumed it: both now rebuild the command the same way, and an arrangement drops the same session options when it starts an agent fresh.
- The dōjō's share image is made again with your pet in it: the pet's sheet goes beside the card instead of inside it, where it passed the 1 MiB a mod may write ("The image could not be made").
- A pane header's digest and the pull request panel read checks the same way: a stale check no longer shows green in the header, and a result GitHub has not told kansō about reads as unknown in both, never as passed.

## [3.15.1] - 2026-11-08

### Changed

- Automatic update checks can be turned off in kansō settings.
- Check for updates there whenever you like.
- Add scripts to do local install instead.

## [3.15.0] - 2026-11-08

### Added

- The dōjō's share card carries your pet beside your best round, and says what the dōjō is: the vim game inside kansō, a layout for the Herdr terminal.

### Changed

- Every + asks which agent to start: the top one in Status and Threads after the project, each project's own, New project with a conversation, and a new worktree. Only the agents installed are offered (with Terminal), and the one used last in the project says so; none is started for you.
- A menu opens with no row lit, the terminal's right-click menu too: j or the down arrow lights the first, k the last.

## [3.14.1] - 2026-11-08

### Fixed

- New conversation opens again: the + in Status and Threads showed "This view could not be rendered" instead of the list of projects since 3.11.0. A project in it starts the conversation on a click or Enter, and a right click chooses the agent.

## [3.14.0] - 2026-11-08

### Added

- MooMew, a tuxedo cat who codes, among the dōjō's pets.

### Changed

- A pet is still until the game gives it something, with a breath now and then: a jump for a target in the fewest moves, a wave for a streak of three or a round won, a bigger jump for a new best, a slump for a key that is no move or the long way round. It no longer runs with every key, and on kansō help's page it waves once, then rests.
- Clawd is a better-drawn one, with all its moves. If you had chosen the old one, the new one takes its place.

## [3.13.0] - 2026-11-08

### Added

- kansō help's dōjō page shows your pet, waving, and every pet to choose from: a click there and it is the dōjō's too. The first visit brings the agents' pets you lack, as the dōjō does.

## [3.12.0] - 2026-11-08

### Added

- Pets in the dōjō. Click Hachi to choose another: Codex's eight pets, Claude Code's Clawd, Mistral's cat, July (a shiba, like Hachi), and any pet you have in `~/.codex/pets`. The first time you open the chooser, Kanso brings the ones you lack from OpenAI and codex-pets.net into its own folder, for you; it ships none and leaves Codex's folder alone. Each pet reacts with its own moves: it runs as you move, jumps when you reach a target, slumps on a key that is no move, waves when you win a round, looks the result over, and waits when you stop.
- Codex's own pet is the dōjō's when you have it, until you choose another; Hachi stays for everyone else.

## [3.11.0] - 2026-11-08

### Added

- The + at the top of the sidebar does what the view you are in needs. In Projects it asks a new project's name and folder (the name starts as the folder's; change it if you like). In Status and Threads it asks which project the new conversation is in, or makes a new project and starts the conversation there; a folder can also be opened without making it a project.
- Threads go by project, each with a + to start a new conversation in it. Grouping can still be turned off from the sort menu.
- Remove project for every project you see: one you added goes for good, and if it is open its space closes too (the second click says how many tabs).

### Changed

- The Add project row at the top of Projects is gone: the + does it.

### Fixed

- Remove from projects, Keep as a project, Locate folder and the agent a project remembers now always take: a menu waits for its change to be written before it closes. The sidebar redraws as soon as the projects change.

## [3.10.0] - 2026-11-08

### Added

- Projects you keep. A project is now a folder you added, and it stays in the sidebar when its last agent closes: closing a failed agent no longer takes its project with it. Every space you have open (and every project asleep whole) becomes one of your projects the first time this version starts; your home folder does not.
- Add project, at the top of Projects: pick a folder and it is one of your projects. A folder added twice is one project (you are taken to it).
- A + on every project: a click starts the agent you used there last (the first one installed otherwise), a right click lets you choose Claude Code, Codex, any other agent or a plain terminal. A project with no space open starts one at its folder.
- New agent in a worktree, from a project's + or its menu: name a branch (new, or one you have) and Kanso makes the worktree in its own folder, beside its database (`~/.config/herdr-app/data/kanso/worktrees`, or `~/.kanso/worktrees` on another machine), and starts the agent there. Nothing is written to any agent's settings or instructions. A branch that already has a worktree opens that one instead.
- A project's menu lists its worktrees, wherever they are, and opens one with a click (where something runs there already, it is shown).
- Keep as a project, for a space you opened at a folder; Remove from projects (files are never touched, and agents running there keep running); Locate folder, for a project whose folder moved or is gone.
## [3.9.3] - 2026-11-08

### Fixed

- Lists that scroll keep their place: the sidebar, kansō settings, kansō help, Open with and Spend's menus no longer jump back to the top a few seconds after you scroll. Each scroll area now has a name of its own, so a redraw finds it where you left it.

## [3.9.2] - 2026-11-08

### Fixed

- A mod that did not load because Herdr's mod runtime ran out of memory ("kanso-menu did not load: Null "null"", seen after a day of updates) now brings the same notice as any out-of-memory error, with a click to restart the window; your terminals and agents stay.

### Changed

- kansō help has its own icon at the top right, beside kansō settings' gear and drawn the same, instead of rows in the sidebar's footer; the footer is as it was before 3.9.1.
- kansō help and kansō settings open as the same window (one size, one header with its icon and Esc), and each has a link to the other, so you can always go back. Help's Configure page is gone: its notes are in the Guide, and Settings does the rest.

## [3.9.1] - 2026-11-08

### Fixed

- The hjkl dōjō no longer fails to draw at the end of a round ("element div was already added to a parent"): its result's Leave button is its own, beside the header's.

### Changed

- Help and keys and the hjkl dōjō are in the sidebar's footer, beside Settings, instead of the dōjō only inside Help. Each can be hidden in Kanso's settings.

## [3.9.0] - 2026-11-08

### Added

- Containers does what you would open Docker Desktop for: a project's compose files show with Up, Rebuild and Down, even before anything runs; Pull an image by name and Run one with a name and a port; Shell into a running container; Open a web port in the browser; Details with its ports, mounts, networks, restart policy and environment names (never their values); volumes with who uses them and Remove unused volumes; Clear the build cache. Pulls, compose, shells and logs run in a tab of their own, so you see their progress.

### Changed

- Containers: the memory line reads "Docker uses of this Mac's memory … can grow to …", and the panel has its own icon, a container, instead of one that looked like a dashboard.

## [3.8.0] - 2026-11-08

### Added

- Containers, a new panel on the right: Docker made simple. First, how much memory Docker and its VM hold on this computer, with Quit Docker to get it back. Then every container grouped by the Kanso project it is for (its compose folder, else its name), each with its state, memory, ports to copy and how long it has run, and Start, Stop, Restart, Logs and Remove. Start all and Stop all per project, and the images with what uses each and Remove unused images. When Docker isn't running it says so and opens it.

## [3.7.0] - 2026-11-07

### Added

- Markdown reviews with your agents: an agent runs `md-review plan.md`, the file opens in the Markdown panel with a Done button, you write your comments into it, and Done hands your changes back to the agent as a diff. By Johannes Hund ([h0ru5](https://github.com/h0ru5)), from his remix [herdr-md-review](https://github.com/h0ru5/herdr-md-review).
- The Markdown panel lists first the Markdown files the focused terminal mentioned (a copied path, paths on its screen, its Claude Code scratchpad), by Johannes Hund.
- Escape in the Markdown panel leaves the block you are editing, or closes the panel, by Johannes Hund.

## [3.6.2] - 2026-11-07

### Fixed

- The minimap under the panes always fits its place: with many columns, or one pane per view, its marks shrink instead of being cut off, so the first one no longer shows as a dot and the + to show more panes per view is always there.

## [3.6.1] - 2026-11-07

### Fixed

- An agent asleep that runs again, resumed by hand or woken before 3.6.0, is awake: it no longer shows twice in the sidebar, and its tab no longer offers a wake that says it already runs. A tab with none of its agents left asleep is no longer listed.
- Move to project: its list scrolls instead of squeezing the projects.
- Send: a search that hides the project you chose clears it, so Send never does nothing.

## [3.6.0] - 2026-11-07

### Added

- Every terminal has a name in Herdr, whatever its program (Claude Code, Codex, Qwen Code, a shell): the sidebar writes the name it shows onto each terminal as the label `kanso.shown`, unique ("Claude Code 2" for a second one), and its project as `kanso.project`, so any agent finds any other with Herdr alone (`hc ls --label kanso.shown=Lead`, `hc ls --label kanso.project=herdr-kanso`) and talks to it with `hc send`. Each terminal also gets its own id once (`kanso.id`), so an agent with no conversation Kanso can read is still known.
- An agent belongs to a project, whatever space its terminal was opened in: Move to project on its menu in the sidebar (and Back to where it runs). The sidebar shows it under that project in every view, and it stays there across restarts, sleep and wake.
- Send to an agent lists every agent of any model, with or without a pane, by its name, grouped by project with yours first, and finds one by name or project as you type. A project's heading sends to all of its agents at once; one waiting on its own question is skipped and named.
- An agent you sent a message to shows "Message from" whoever sent it in the sidebar, until you open it.

### Changed

- The left nav keeps everything in one SQLite database, data/kanso/kanso.db: each agent by its conversation (or its terminal's id) with its name, project, place and status, what sleeps, the spaces and the sidebar's choices. What panel.db and Sleep's sleep.db held is taken in once.
- Asleep is a status like working, idle or done: Status lists it in its own section, with the moon.
- Every mod is written without mutation (no let or var, nothing changed in place but a view's own state), checked by a test.

### Fixed

- An agent woken wakes in the space it slept in, never in another space that shares its folder (several spaces on one folder no longer mix their agents).
- A wake never starts a conversation that already runs, never types into or ends a program you started in that terminal meanwhile, and never closes a space or tab it did not make.
- An agent keeps the name you gave it, by its conversation, not by the terminal it happens to be in.
- Every scrolling list and panel scrolls: the sidebar, Send to an agent, Sleep, Arrangements, Open with, kansō settings and help, the panels (pull request, ports, worktrees, Shipped, Spend, Memory), the Markdown preview and its tables, and Spend's menus. Their rows no longer shrink to fit, so what does not fit scrolls instead of being squeezed or cut.
- An agent's menu keeps its own items in view however many projects there are: four show under Move to project, the rest scroll.
## [3.5.1] - 2026-11-07

### Fixed

- The Markdown panel (Cmd+Shift+M) in a pane on an SSH machine lists that machine's Markdown files and shows them, read only, read again every few seconds; before, it looked on this computer and found nothing (#53).

## [3.5.0] - 2026-11-06

### Added

- An agent asleep keeps its row in the sidebar, in every view: in Projects at the place it had in its project, in Threads in its order, in Status under Asleep, by the same name, with the moon. It has no pane, so a click opens its menu instead of a pane; the sun on hover (or Wake on its menu) wakes it. A project asleep whole stays in Projects with its agents under it.
- The sidebar keeps its own state in its own SQLite database, data/kanso-spaces/panel.db: the view, each view's order and what is folded (moved there from where they were kept before), and each agent's name and place, so one that sleeps keeps both.

### Changed

- Sleep asks nothing: an agent or a tab goes to sleep at once under the name it already has, and the dialog only shows it going, then closes. Putting a whole project to sleep still asks once.
- An agent has one name in every view: the one you gave it, else its conversation's title, else its program's. Rename, from any view, changes it everywhere.

## [3.4.1] - 2026-11-06

### Fixed

- A round in the hjkl dōjō has an end: ten targets, then the round's result (points, targets, the fewest moves, the best streak, the time) with Play again, Next level and Leave as buttons; Enter plays again and n goes to the next level. End round stops a round without counting it, and Leave the dōjō is a button in the title bar that asks once before it closes.

## [3.4.0] - 2026-11-06

### Added

- Vim keys: Cmd+Alt+H/J/K/L go left, down, up and right between panes, and with Shift move the pane, up and down within its stack too. Left of the first pane is the sidebar's list: a ring marks the row you are on, J and K move, GG and Shift+G go to the first and the last, Enter or L opens the row, / searches, and Esc or Cmd+Alt+L goes back to the pane you came from.
- kansō help (⌘?, or Help and keys in kansō settings): the keys on a keyboard you can see, from your own keys.json. Pick ⌘ ⌥ ⇧ ⌃, or press a chord, and the keys that do something light up with what they do; a Lists layer shows j k gg G. A guide to the strip, the sidebar, panels, Sleep and Arrangements, and where to set each thing up.
- hjkl dōjō, a game to learn vim's moves, with Hachi, a pixel shiba that cheers a streak and a new best. Nine levels, from h and l alone on a board to w b e, f t, 0 ^ $ and gg G on real lines of code; 60-second rounds, points for the fewest moves, a streak, and the key that gets there lit after two seconds still. It opens as a window that asks before it closes. Rounds are kept in data/kanso-dojo/dojo.db, and Share makes a card of your best round, targets, days in a row and levels.
- Sleep one agent on its own: the moon in its pane's header, or Sleep this agent on its menu in the sidebar. It exits on its conversation, its pane closes and the rest of the tab stays; Wake opens it again in that tab, beside the others.
- Every kansō menu and list answers the same keys: the pane menu, Open with, the sidebar's right-click menus, Sleep and Arrangements move with J and K (or the arrows), GG and Shift+G, Enter and Esc.

### Changed

- kansō's accent is a coral pink, in both themes and on the site, instead of the sage green.
- The name is written kansō, in lowercase, in the app and in the README.
- The site shows the current star count from GitHub on every visit.
- The moon in a pane's header sleeps that agent, not the whole tab; a tab or a project still sleeps from the project's menu.
- Cmd+Alt+H moves left while the kansō layout shows, instead of hiding other apps, and ⌘? opens kansō's help instead of Herdr's.

## [3.3.0] - 2026-11-06

### Added

- Sleep, a mod of its own (kanso-sleep): put a tab, or every tab of a project, to sleep. Each Claude agent's conversation is kept in data/kanso-sleep/sleep.db, the agents exit with /exit and the tabs close, so nothing of them runs or holds memory. Wake opens them again in their project with their columns and widths, each agent back on its own conversation (`claude --resume`); a project that slept whole gets its space back. Other programs in a tab stop, and start fresh on wake.
- Sleep is careful with your agents: it reads the tabs again when you press it and stops if anything changed or an agent is working or waiting on you; each agent's prompt is cleared (and seen empty) before /exit and its process must be gone before the tab closes; if one won't leave, the ones that left come back on their conversations and the tab stays. A wake drops the prompt an agent was started with and never forks its conversation, is held by one window at a time, and checks every agent is back on its conversation before the tab stops being asleep; what did not come back stays asleep. Agents on another machine can't sleep yet.
- Sleep is a state in the sidebar: a project with tabs asleep shows a moon and their count, a project asleep whole stays in Projects with its moon, and Status has an Asleep section, a row per sleeping tab that wakes it on a click.
- Sleep and Wake where you work: a right-click on a project (Wake each sleeping tab, Wake all, Sleep this tab, Sleep the whole project, then Herdr's project options), Sleep its tab and Sleep its project on an agent's menu in Projects, Status and Threads, and a moon next to the pin in each pane's header.
- Rows in the sidebar have a vertical dots button on hover that opens the same menu as a right-click.

### Changed

- A right-click on a project opens Kanso's project menu; Herdr's own is its last item, Project options.

### Fixed

- A recycle or a close from Memory clears a draft left in the agent's prompt, of any length, before sending /exit, and sends it only once the prompt shows empty, so the draft is never sent with it.

## [3.2.3] - 2026-11-06

### Fixed

- The working ring is the turning ensō again on battery too; 3.2.2 drew it as stepping quarter arcs. A working title still holds still and the strip's dots still stop pulsing on battery.

## [3.2.2] - 2026-11-06

### Changed

- On battery, Kanso's motion steps instead of gliding: the working ring turns in quarter turns, a working title holds still while its dots count, and the strip's dots and the needs-you bar stop pulsing. A native spin or pulse redraws the whole window about 30 times a second; with an agent at work Herdr used about 31% CPU in a test, 10% with this. On the charger nothing changes.

## [3.2.1] - 2026-11-06

### Fixed

- Arrangements opened blank with "This view could not be re-rendered" when it listed an arrangement; the list shows again.

## [3.2.0] - 2026-11-06

### Added

- Arrangements can be opened in any project. The dialog lists every arrangement you saved, this project's first and then the other projects' with the folder each came from. One from another project opens with the same programs, flags, columns and widths, every pane in the folder of the project you are in, so a new project gets your usual tab in one click.
- An arrangement can be overwritten: Overwrite on its row saves the tab as it is now in its place, and saving under a name the project already has says it replaces it.

### Changed

- Arrangements are kept in a SQLite database (data/kanso-arrange/arrange.db) instead of a JSON file. The arrangements you had are read in the first time the dialog opens; the old file is left as it was.

## [3.1.0] - 2026-11-05

### Added

- Ports keeps a history, from the memory guard (which now also records, every minute, the dev servers listening on this computer). Each row shows how long its server has run and the memory it holds; the panel adds how many ran at once over 24 hours, 7 or 30 days with the ones no pane ran marked, how many opened today, how many you stopped and the memory that gave back, and the servers opened today or recently ended (how long each ran, how it ended, its largest size). Stop goes through the guard, which measures what each server gives back; without the guard Stop sends the signal itself and the panel offers to turn the guard on.
- Ports has a share button, as Spend, Shipped and Memory do. The card brags about the dev servers your agents left running after their panes closed that you found and stopped, and the memory that gave back, or else how many your agents opened this week, with what runs now, the most at once and a week's chart. No ports, folders, projects or commands leave with it.

## [3.0.0] - 2026-11-05

### Removed

- The Changes panel (changed files, diffs and a commit message). Agents commit on their own and the PR panel shows the diff, so it went unused while it took a place in the tab bar. A Changes panel left open closes by itself; Files and PR stay.

### Added

- **Memory**, a panel and a guard for sessions that last weeks. The guard (`kanso-guard/guard.mjs`, run by launchd every minute once you turn it on from the panel) samples the machine, the Herdr window, herdr-core and every agent, and keeps 24 hours by the minute, 90 days by the hour and 14 days per agent. It recycles a Claude Code agent that grew past 900 MB, or the heaviest ones when the machine runs low (under 20% free or over 5 GB swapped): only one idle for 20 minutes, not the one you are on, never while you type, at most once in 6 hours. It is ended with /exit and started again in the same terminal on the same conversation (`--resume`), with its model and permissions and without its first prompt; an agent that does not leave on its own is left alone. It restarts the Herdr window past 1.2 GB or when its mod runtime runs out of memory (terminals and agents stay in herdr-core), only after a minute without input, at most 3 times an hour. It ends the helpers Kanso starts when they hang and tells you when memory runs low, naming what holds it. The panel shows all of it, with the history and every agent's size, its agents grouped into ready to recycle, working and can't be recycled (with why). It recycles one agent, all the idle ones or only the heavy ones (agent by agent, as it goes, never the one you are on), closes an agent you no longer use or every one idle for 2 days (its conversation stays on disk, with the command to reopen it in Events), restarts the window and cleans up hung helpers. A share button turns the session into a card for X, LinkedIn or Bluesky: how long your agents have been open, how many on how much memory, and what recycling gave back; no names, folders or sessions.

### Fixed

- A command that hangs no longer piles up copies of itself: the window's health check, the machines list and the update check each wait for the last one to answer, and the update check never asks for credentials and gives up on a stalled connection.
- The Threads view no longer reads transcript lines over 16 KB (a pasted image, in base64) into the mod runtime's memory.

## [2.8.1] - 2026-11-05

### Fixed

- The gear and the footer no longer offer the Kanso release you already have. The updater read the installed version once, when its copy started; a copy that started while new files were landing and version.json was not yet read the old version and kept offering the new one. It now reads it on every check, so the dot and the row go away by themselves within five minutes.

## [2.8.0] - 2026-11-05

### Added

- **Credits** in Kanso settings: Herdr (herdr.dev) with its mark, Kanso's repository, and the people who make it with their GitHub avatars (shipped with Kanso, no network needed), each opened in the browser.
- When a Kanso release waits, the gear at the end of the tab bar carries a dot and opens on What's new, which has an Update button.

### Fixed

- Kanso's keys no longer take Herdr's or macOS's keys for something else. ⌘1-9 select a tab again (columns moved to ⌃⌥1-9), ⌘[ and ⌘] go to the previous and next agent, ⇧⌘[ and ⇧⌘] to the previous and next tab, ⌘W closes the tab; panes still go and move with ⌥⌘ and the arrows and close with ⇧⌘W. A new pane to the left is ⌥⇧⌘D (⌥⌘D shows and hides the Dock, so it never arrived), and ⌥⌘H/J/K/L are gone (⌥⌘H hides the other apps). Where Kanso keeps one of Herdr's keys it is the same command done the strip's way: ⌘D, ⇧⌘D, ⇧⌘W, ⌥⌘ arrows, ⇧⌘↩, ⌃1-9. In Spend's panel, Esc goes back (⌘[ is Herdr's again). ⌘⌥1-9 no longer select a tab: Herdr's ⌘1-9 do. A key you rebound in Kanso settings stays yours.
- Kanso's update notice works with the sidebar hidden. The check and its toast lived in the sidebar's footer, which does not run while the sidebar is hidden; the tab bar, always on screen, now checks too, and the toast's click installs from it. The toast stays 30 seconds instead of 5. ⌃⇧, (Kanso settings) goes to the tab bar as well, for the same reason.

### Changed

- Kanso settings lists Kanso's own keys only, and says so. The tab bar comes first, drawn as you see it: each panel's icon and name in your order with its key under it (⌃⇧1 for the first, and so on), then the gear with ⌃⇧,. The rest is in short lists by what you do (Sidebar, Panes, Moving along the strip, Spend); click a row and press the new key. A family reads ⌃⌥1–9. Splitting, closing, going to and moving panes, tabs and spaces are Herdr's commands on Herdr's keys, set in Herdr's general settings; where the strip does one of them its own way it keeps Herdr's key for it.

## [2.7.1] - 2026-11-05

### Changed

- Motion keeps going behind other windows. A working agent's ring, the shimmer on its name, the breathing silhouettes and the pulsing dots no longer stop when Herdr loses the keyboard: on a screen you glance at while working elsewhere, a mark that stands still reads as an agent that stalled. What Kanso still saves behind other windows is work (Git every 5 s, machines and processes less often), not motion.
- Work follows the shown view: Git status runs only while Spaces shows, and the process listing under each agent skips the Threads view. Panels were already idle unless shown.

## [2.7.0] - 2026-11-05

### Added

- New keys: ⌘⌥1-9 shows a tab by position (those keys doubled ⌘1-9 before), ⌃⇧1-9 opens or closes a panel by its place in the bar, ⌃⌥P, ⌃⌥S and ⌃⌥T switch the sidebar's view. One modifier per kind of thing: ⌘ the pane columns, ⌃ the spaces, ⌘⌥ the tabs, ⌃⇧ the panels, ⌃⌥ the views; none of them lands on Herdr's own keys on any platform.
- Threads: beside Pinned, Snoozed or Settled, the active conversations get their own header, "Active", with a count, folding like the others; alone, the list stays the bare inbox.
- Kanso settings, a dialog from the gear at the end of the tab bar, after the panel buttons (fixed there: not a panel, so it is neither dragged nor turned off), or ⌃⇧,. Keys: every key Kanso binds, by what it does, the one place the keys show; click one and press another in its place, add one, Backspace drops it, Reset puts back what Kanso ships; a key something else already uses says so and takes a second press. What you press goes to Herdr's keys.json, applies at once and stays yours through updates. Mods: each side panel in the bar's order, moved with arrows, with its switch, and switches for the pieces you can do without (the view switch, the activity line, Arrangements, Add machine, the agents count, the palette key, the minimap). What's new: this changelog, newest first, with the version you have marked.
- A watch on the mod runtime. After a long day of hot reloads Herdr's runtime can run out of memory, and from then on panels and bars fail to load until the window restarts; the footer asks Herdr every minute and, when that happens, a toast restarts the window with one click (terminals and agents live in herdr-core and stay).

### Changed

- The strip's minimap has no tooltip any more; the keys are listed in Kanso settings instead.
- What the sidebar keeps between looks (git by place, each space's first sight and measured height, labels in flight, tab widths) is trimmed to what still exists, every 30 seconds, so nothing grows over a long day.

### Fixed

- A command no longer runs twice after Kanso updates itself (or any hot reload of a mod): the replaced build's command loop kept waiting for keys beside the new one, so a key or a toast's click could act in both; every loop now checks it is the live build before acting.
- ⌃1-9 past the last space does nothing instead of showing "space.select failed: no such space": the key goes through Kanso, which looks first.

## [2.6.0] - 2026-11-05

### Added

- Motion, native and only where something changed: the Projects, Status and Threads switch slides its thumb to the view you chose; the wash under the space, the agent and the tab you are on is one pill that glides to the row or tab you click, changing height with it; a project's agents, a Status section and a Threads shelf fold and unfold by height, and a new agent's row grows into place instead of pushing the list; a pane header's tools slide out beside its state mark while the pointer rests on it; a side panel fades in. GPUI animates all of it; no script runs per frame.

### Changed

- Nothing moves while Herdr is behind other windows. A working agent's ring, the shimmer on its name, the breathing silhouettes and pulsing dots run only with the window in front; behind it they stand still, so an idle window draws no frames (a native loop keeps a window drawing about 30 frames a second for as long as it is on screen, and the default layout's spinner does). Motion resumes the moment the window comes forward.

## [2.5.0] - 2026-11-04

### Added

- What each agent says it is on. Under its name, the step it reports while it works ("Wait for PR #1025 checks to finish", "Running the tests") and, when it finishes, its last words; at rest, what it said last in a fainter tone. Read from the state report the agent already sends Herdr, nothing is asked of it or configured in it: Claude Code sends it; an agent that doesn't shows its title or what it left in git, as before. Every agent's row keeps its second line, so the list never jumps.
- A step that takes long shows its time after the line, from three minutes on the same one (a CI run, a deploy, a tool that doesn't answer); past fifteen it is in the needs-you color.
- What still runs under an agent that stopped: a count before its mark, the commands and their times on hover (a monitor loop, a server it started), from one `ps` every 5 s while the window is in front; its MCP servers and keep-awake don't count.

## [2.4.0] - 2026-11-04

### Added

- Markdown, edited where it reads. A Markdown file opened from Files (or from Open with) shows formatted in the side panel; a double-click on a paragraph, a list, a heading or a table opens just that block to edit, a heading without its #, a table as a grid of cells, and the rest stays formatted. What you type is saved as you go, and only when the file on disk is still what was read: a change an agent made meanwhile is never overwritten, you choose which stays. "Source" edits the whole file as Markdown; a link to another Markdown file opens it in place, to any other file offers Open with; Back returns to Files with the folders you had open. Front matter reads as a code block.
- Kanso Markdown (macOS): `sh mods/kanso-tabs/markdown-handler.sh install` makes `.md` files open in Herdr from a Cmd-click on a path in a terminal or a double click in Finder, formatted and editable; `uninstall` gives them back to the app they had. Nothing changes until you run it.
- The markdown-panel mod, listed on its own in the gallery: the same editor in a window over any layout, Cmd+Shift+M, with the Markdown files of the focused pane's folder.

## [2.3.1] - 2026-11-04

### Changed

- Less work per frame. The sidebar reads each space's place once per look instead of once per space, lists sub-agents from one map instead of a search per row, and reads the strip's columns once per draw; Threads reads four conversations at a time instead of one after another; the strip leaves the layout tree alone while the window is behind others; Shipped adds up a period's weeks once per reading instead of three times per draw; the PR panel reads its checks once per reading; Files rebuilds its rows only when they changed; Send reads the names you gave once per draw.
- One copy of what the mods share, kept in step by `npm run sync:share` and a test: the layout writers' helpers (`layout.js`, in kanso-tabs, kanso-strip, kanso-spaces, kanso-panel and open-with), the panels' kit (`ui.js`: colors, spacing, quiet links, icon buttons, section heads, loading silhouettes and the second press that confirms, in kanso-panel and kanso-spend) and, in `marks.js`, a program's icon and a pane's name along with the state mark (now in kanso-send too). Spend's unused drawing helpers are gone.

## [2.3.0] - 2026-11-04

### Added

- The sidebar shows what your agents are doing. Each agent's row has, at the right, how long it has been working, waiting on you or since it finished, and under its name a quiet line: while it works or waits, its own title when you gave it a name of yours; when it finishes, what it left in its folder (+12 −3 · 1 commit · PR #41). Read from the state the agent reports, its title and git, never from its conversation.
- Sub-agents (started by an agent with `hc run`) are listed under their parent with tree lines; a click opens one in a peek.
- Projects, Status and Threads, a switch at the top of the sidebar. Projects is the list you had. Status lists every agent in every project by what it needs from you (Needs you, Working, Done, Idle, then the other terminals), each with its project and time; a parent goes where its most urgent sub-agent would, and a finished agent you are looking at stays in Done until you leave it. Each section folds. Status carries a dot while an agent needs you and you are on another view.
- Threads lists each conversation of the agents on this computer, named on its own: the title Claude Code gives it, or Codex's name for it, kept up to date as it goes; else the first thing you wrote. Under it, its project and the last thing you wrote. Read from the files the agents already keep, only while Threads shows; nothing is stored or sent.
- Threads works as T3 Code's sidebar: Pinned up top, then the rest by your last message or when it started (or grouped by project), then Snoozed and Settled, folded. Settle puts a finished thread away until it has new work; Snooze hides it for an hour, three, until this evening, tomorrow or Monday, and it comes back marked Woke; Mark unread, Rename thread (empty brings its own title back), Copy folder, branch or conversation id, and Close agent (after a second click). Hover a thread for Settle and Pin; right-click any row, in any view, for the rest. Kept as labels on the terminal, so every window and a restart agree.
- The sort button sorts in the view's terms: in Status within each section (latest change, longest in its state, project), in Threads by your last message or when it started, grouped by project or not.
- Status and Threads rows lead with their project's square and name in its color. An agent's state is one mark everywhere, the tabs, the pane headers, the status bar and the sidebar: one circle: an arc running on a faint ring while it works, the circle closed as a brush ensō when it is done, a solid disc when it needs you, a faint ring at rest. It replaces the breathing dot. A working agent's title shimmers, a glint passing over its letters with three dots counting after it, as Claude Code's own status does; names keep one weight, so nothing jumps when an agent starts or stops.
- Threads get more room than the other views: taller rows with space between them, read as conversations. While Threads first reads the conversations it shows the view's silhouette, as Spend does.
- Under Show in the sort button, turn off the activity line or the switch (then the sidebar stays on Projects).

### Changed

- The sidebar calls its rows agents, not sessions.
- A title that is only a path (`~/Apps/x`) no longer names a row: a shell is named after its folder, as intended.

## [2.2.0] - 2026-11-04

### Added

- Cmd+J goes to the next agent waiting on you, in any space: one blocked on a question first, then one that finished while you weren't looking. Press it again for the one after. A click on "N agents need you" in the status bar does the same.
- Pane headers say what an agent left in its folder when it stops working: changed files with lines added and removed, commits not yet upstream, and its open pull request with a dot for the checks. Read from git and gh once per turn, never from the conversation.
- Send to an agent (the pane header's send button, the pane menu, or Cmd+Alt+S): pick another agent, edit the message, and Send pastes it into that agent's terminal and presses Enter, then takes you there. An agent waiting on its own question is never typed into.
- Arrangements (the layers button beside +, or Cmd+Alt+T): save a tab as it is, with each pane's program and the flags you started it with, its folder, the columns, stacks and widths, and open it again in a new tab with one click. Kept per project; a resumed session's id is left out, so each agent starts fresh.
- Ports: a panel of the dev servers listening on this computer, with the pane that runs each. The ones no pane runs any more are marked, and Stop ends them after a second press.

## [2.1.1] - 2026-11-03

### Fixed

- Spaces: a new space from This computer's + or New space is made on this computer, and the top + makes it on the active space's machine. Before, both could land on the last remote machine you focused (#36).

## [2.1.0] - 2026-11-03

### Added

- Worktrees: a panel that finds every git worktree on your computer, in your repositories' folders and wherever agents left them (temp folders and scratchpads included), with how much disk they take and what each one holds: merged (squash merges included), commits kept on its branch, uncommitted changes, commits only there, or in use. Clean up removes, after a second press, every one that loses nothing and has been idle a day, and deletes the merged branches; one at a time or a whole repository, it says first what would be lost. Folders whose repository moved or was deleted are listed too. A worktree whose repository moved (its `.git` names the old place) is never removed: Repair the link reconnects it. Each one is checked again right before it goes, and one that changed since the scan stays instead of failing.
- Worktrees keeps a history in SQLite (`data/kanso-panel/worktrees.db`): each worktree once, rewritten only when it changes, and the gone ones with the size they freed, whether removed here or elsewhere. Freed shows the total, the worktrees, merged branches and leftovers cleared, and 30 days of what was freed and of what the worktrees took. The panel opens on the last scan while it checks again.
- Worktrees: Share posts an image to X, LinkedIn or Bluesky with the totals only, never a repository, branch or folder name: what was freed, or before that, what the worktrees take.
- Worktrees: Explain it on a worktree, or Review the ones that need a look, asks your agent in a new tab what that work is and whether it already lives somewhere else. The agent changes nothing.

## [2.0.1] - 2026-11-03

### Changed

- The button of the open panel shows its name beside its icon, so you can tell which panel is open without hovering it.

## [2.0.0] - 2026-11-03

### Added

- The panel buttons at the top right are icons; the one under the pointer shows its name beside it. Press one and let go on another to move it there. Right-click one to open Panels, where you drag them into order and turn each one on or off. The order and the switches are kept for every space.

### Removed

- Specs (the separate `sdd-focused` mod) is no longer offered in the tab bar, and a Specs panel left open closes. Kanso never included it; remove `mods/sdd-focused` if it is installed.

## [1.5.0] - 2026-11-03

### Added

- Spend is part of Kanso. It shows what your AI coding sessions cost at API list price, per model, project and task, and it ships with the layout: its button is always in the tab bar. It was the separate token-spend mod; its first start carries that mod's data over, and its keys are now under `mod:kanso-spend` (#32).
- Spend: Share to X, LinkedIn or Bluesky, or save the image, the same way as Shipped. The image has only the totals of the unfiltered view: what the period is worth, tasks, tokens, how many projects and models, and the days. Never a project, task or session name; the button hides while a filter or a detail is open (#32).

### Changed

- Spend keeps its index in SQLite, `data/kanso-spend/spend.db`, instead of one JSON file: a scan writes only what changed, and opening the panel skips what only scans need. The first scan moves `store.json` in and keeps it as `store.json.migrated` (#32).
- Sharing pastes the image into the post for you: the composer opens with the text, and once the page is up the image goes in. On macOS this needs Herdr in Accessibility; without it, the toast says to paste it. Shipped and Spend share through one module (#32).

### Fixed

- Spend no longer docks a second panel at the window's right edge when it is installed (`"place": "none"`) (#32).

## [1.4.0] - 2026-11-03

### Added

- Shipped: Share to X, LinkedIn or Bluesky, or save the image. It makes a PNG of the global numbers only: the totals, the streak with a year of contributions, the records and when you ship. No repository or machine names. It copies the image to paste into the post, and opens the composer with the words filled in, because these networks take only text from a link (#31).

## [1.3.1] - 2026-11-03

### Changed

- Kanso looks for its own releases when Herdr starts and every 5 minutes, instead of every 6 hours, so a release shows within minutes. `kanso-chrome.check` looks right away and says whether you are up to date (#30).

## [1.3.0] - 2026-11-03

### Added

- Shipped (#29): a side panel of vanity metrics for what you delivered, drawn like Spend. It covers every repository and organization, by day, week, month or year, and shows:
  - the lines you added and removed, compared with the period before;
  - contributions (private ones included), pull requests merged, commits, reviews and repositories;
  - your totals since you joined GitHub;
  - your streak, with a heat map that fills the panel, up to a year;
  - your records (best day, best week, best month, longest streak, most commits in a week), with a toast when you set one;
  - when in the day you ship, and from which machine;
  - a breakdown by repository.

  Each machine reads its own git (every branch, every identity you commit with) into a local SQLite store of statistics only (repository, hash, time, lines, machine), and your machines share it through a private gist. GitHub's weekly contributor sums cover what no machine has cloned. A repository's week counts the larger of the two, and each refresh reads only what changed.

## [1.2.0] - 2026-11-03

### Added

- PR panel: the list's new Closed tab shows the repository's 30 most recently merged or closed pull requests. Like the open ones, they are grouped as this branch, yours, and your colleagues'. A finished pull request shows only when you pick it (#28).

### Fixed

- PR panel: a branch's merged or closed pull request no longer opens as the branch's own. The newest open one stands in, or the panel offers to create one (#28).

## [1.1.0] - 2026-11-03

### Added

- Kanso updates itself, apart from Herdr. When there is a newer release, an "Update Kanso to X" row appears above Settings, with one toast per version. Installing it checks every mod first, keeps the keys you changed, and keeps your previous layout as `layouts/kanso.json.old-<time>` (#26).
- `kanso.panels` in `shared.json`: other mods can add their own side panels to the tab bar (#25, by Iván Campaña).

### Fixed

- Specs and Insights show in the tab bar only when their mods are really installed (#24, by Iván Campaña).

## [1.0.0] - 2026-11-03

The first release. It holds everything from the first commit (31 October 2026) to the v1.0.0 tag.

### Added

- Kanso: a quiet Herdr layout with side panels that open on demand (Files, Changes), light and dark themes (`kanso-day`, `kanso`), and a recipe to rebuild it (5db1c86).
- An endless horizontal strip of panes with a minimap, keyboard navigation, and a view that glides to the focused pane (b245258, 77215ff, c4b12fd, 437c17a).
- Choose how many panes fit in the view, from 1 to 8, and resize them on the dividers (6c9fe03).
- A grip that moves a pane before or after another (736918f).
- A terminal menu that knows about the strip (2eccd5f).
- Open with: open a pane's folder in a code editor (#1).
- PR panel: the branch's pull request, managed from Kanso (#2).
- Focus memory, pinned panes, and a sidebar that lists and reorders every session (#3).
- Drop a pane to stack it. Stacked panes are linked in the sidebar, and a preview shows where a held pane will land (#6).
- Preview a file in the side panel from Open with, without an editor (#9).
- Order the sidebar's sessions: pinned first, then by last update, attention, kind, screen order, or your own order (#10).
- PR panel: lists every open pull request in the repository, with a quiet state outside a repository (#12).
- PR panel: one pull request at a time, with the open ones in a dropdown (#16).
- Strip: a swipe over an edge tab slides the view too (#17).
- PR panel: the description and a copy-link button (#21).
- Strip: the selected pane has a fine accent border (#22).

### Changed

- Side panels share the work area's background, and a panel that closes itself unmounts (0ee86f2).
- A quieter minimap and simpler canvas keys (1aa9a72, 9516587).
- Split down stacks the new pane in its column. There are no vertical moves (aecfaa6).
- Whole panes only: tabs at the edges replace the peeks of the continuous canvas (8d837d5, #4).
- An edge rail, resizing on Herdr's own dividers, and gutters instead of lines (#5).
- Kanso leans on the SDK: one panel mod, the header inside the strip, and fewer redraws (#7).
- A README about what Kanso does for you, tests grouped by feature, and a reusable benchmark (#14).
- New screenshots and previews that lead with the strip, the PR handoff, and Open with (cb6540c, 4e16fba, #15, #23).
- README: install optional mods while another layout is shown (#20).

### Fixed

- Drags survive peeks and fillers, and the resize grip is visible (5585ee2).
- The edge rail and dragging in the sidebar (#8).
- Layout writes no longer drop each other, and work that still ran hot was cut (#11).
- Layout writers never save another layout's tree into `kanso.json` (#18, by Iván Campaña).
- The side panel resizes again (#21).
