# Kanso

More agents. Less babysitting. Terminals open side by side at their own width.
Repos, worktrees, diffs, PR checks and threads stay close; Cmd+Shift+O opens
the folder in your editor, over SSH too. Warm greys, color for agent state.

![Kanso](preview.png)

## What you see

Left to right, then top to bottom. Sizes are px at zoom 1.

- **Sidebar**, theme `chrome` (`#161615` dark, `#e3dfd6` light).
  - **Top strip**, 48 tall: the macOS traffic lights (at `[12, 16]`) and,
    at its right end (14 in), Herdr's mark: its icon
    (`frame/welcome/herdr.png`, 20, radius 6) and "Herdr" (13, semibold,
    `foreground`), so you know what you're in. It drags the window.
    Collapsed, the strip is empty and the mark sits lower, over the rail's
    buttons.
  - **Spaces** (`kanso-spaces`), filling the middle.
    - Open (256 wide): a 40-tall row with a + (New space) at the left, and
      Search and Hide sidebar at the right. Each is a 32 square with a 17 icon
      in `muted` that turns `foreground` on hover over a `foreground`+`12`
      wash.
    - Space rows are 32 tall with radius 6, no avatar: the name, then,
      right-aligned, the repo, branch and ahead/behind counts in 11.5.
    - The active space has a `foreground`+`14` wash; hover shows
      `foreground`+`0c`.
    - Worktree spaces nest under their repo on 1px `input` guide lines.
    - A space's agents are listed under it in 28-tall rows: program icon 15,
      title 12.5, status mark at the right. The focused agent is in full ink
      over a `foreground`+`0c` wash; the others are `muted`, and idle ones
      `dim`.
    - Collapsed (76 wide): the + and Hide buttons, stacked, then one mark
      per group (project, status, shelf): a project's initial in its color,
      no square (else an icon), under it the most urgent state and count.
      A click lists the group in a popup (click goes; asleep: wake menu).
  - **Footer** (`kanso-chrome`, `footer: true`), 156 tall, bottom-aligned:
    - Settings (gear) and Add machine (server icon), 34 tall, icon 17.
    - An 8 space.
    - An account chip: a 32 avatar (28 when collapsed) with the home folder
      name's first letter, then the name and "N agents".
    - Collapsed, each item is a centred square with its label as a tooltip.
      When an app update is ready, a 6 `accent` dot shows on Settings.
    - Kanso's own release, apart from Herdr's (`update.js`): when a newer
      `vX.Y.Z` tag than `version.json` exists, an "Update Kanso to X" row
      (refresh icon, 6 `accent` dot) sits above Settings and the footer
      grows to 192 while it shows (back to 156 after; a size you set is kept).
      The tab bar reads tags (`git ls-remote`) on start, every 5 min (if
      on in settings) and on `kanso-tabs.check`; one 30 s toast per version
      runs `kanso-tabs.update`; a dot on the gear. Keys merge three-way (yours
      stay); the layout is replaced only if the release changed it (old kept
      as `kanso.json.old-<time>`). A detached shell holding a kernel lock
      downloads into `.kanso-updates/<id>/`, checks `version.json` and
      `herdr-app check`, swaps each file and mod in turn, `kanso-chrome`
      last (all put back if it fails or dies), writes `<id>.status`; the tab
      bar toasts "Kanso updated to X".
- **Corners**: two radii and nothing else. Surfaces (panes, cards, popovers,
  menus) are 8; controls and rows (buttons, tabs, list rows, tiles, chips,
  fields) are 6; dots are circles.
- **Work area**, padding 6, gap 4, on `chrome`. No card and no lines: the
  panes are `background` slabs with radius 8 on the frame, 6 apart, and
  that 6 gutter is where Herdr's own dividers are dragged.
    - **Tab bar** (`kanso-tabs`), 48 tall, no line under it. It drags the
      window.
      - Tabs are 26 tall with radius 6: program icon 15, name 12.5, then the
        tab's status. The active tab has a `foreground`+`12` wash and the
        rest are `muted`, with no borders and no tray behind them. A close x
        (13) shows on the active tab only when there is more than one tab.
      - After the tabs, a + (16 icon, 28 square) opens the shipped
        `new-menu`.
      - At the right are the panel buttons: Files, Spend, PR,
        Shipped, Worktrees, Ports, Containers, Memory, Look, as icons only (15, in a 26 square ghost
        button), and a wash when their panel is open. While the pointer is
        on one (`on_hover`), its name (12) opens beside the icon: the name's
        box eases from 0 to its width and fades in over 180 ms
        (`transition("width")` and `transition("opacity")`, ease-out, run
        natively), and closes the same way. The open panel's button keeps
        its name showing. No tooltip. Pressing one and letting go on another moves it there.
        Right-click opens the Panels popup (`kanso-tabs` again, as an
        overlay with `props().arrange`): one 30 tall row per panel with a
        grip, its icon, its name and a switch, dragged the same way into
        order. The order is in shared `kanso.panels.order` and the panels
        turned off in `kanso.panels.off`; a panel turned off while open
        closes. Custom panels from `kanso.panels` join the list.
    - **Panes**: an endless canvas (`kanso-strip`). Panes sit side by side
      in columns. You choose how many fit in the view at once, 1 to 8
      (default 2): a new column takes 1/n of it, so on a wide screen you can
      hold 3, 4 or more side by side. A lone pane fills the view. Every header ends in a
      six-dot grip (14 icon, `dim`, `foreground` on hover or while held,
      grab cursor), 6 from the edge. The header's top corners round with
      the slab's (8). Resizing is Herdr's own: drag the 6
      gutter between two columns sideways, or between two stacked panes up
      and down (a column never goes under 140 px, a stacked pane under 90).
      Once the drag has rested 250 ms, the strip reads the sizes back from
      the layout and its ruler blocks (one under each terminal, 8 tall,
      for its width, which also draws the slab's rounded bottom since a
      terminal paints square corners; one 1px wide at the start of work-body
      for the height) and keeps them as
      shares, so later trees keep what you dragged. The view always starts at a
      column's edge and shows only whole, live panes: as many as fit, which
      then share the width by their weights. It never slides past the first
      start from which the rest of the row fits. When columns lie beyond an
      edge, a 28-wide edge rail stands there (the right one after the side
      panel while one is open) in `chrome` (`hover` on hover),
      so it reads as frame, not pane. At its middle, a ‹ or › (14, `muted`)
      over a stack of 20 tiles (`input`, rounded 6, 5 apart, up to 8 then
      "+N"), one per pane beyond in row order, each with its program icon
      (12, `muted` when tinted) and, at its top-right corner, its state (a 7
      dot: breathing `working`, breathing `blocked`, `done`; none when the
      program reports nothing). Resting the pointer on the stack (350 ms)
      opens a card beside it (220 wide, `chrome`, a soft shadow, rounded
      9): "N panes beyond the left edge" (11, `dim`) and a 26-tall row per
      pane with its icon, its name (12.5) and its state dot. A click on a
      tile or a row brings that pane in; a click on the bare rail brings in
      the nearest one.
      Off-screen columns aren't drawn. A split down stacks a pane
      under the focused one in the same column; stacked panes share the
      column's height equally until you drag the gutter between them
      (evening out resets that). Panes never move vertically: dragging one out
      of a stack makes it its own column. A tab holding a mod pane falls back to
      Herdr's own split view.
      A column can be pinned (the header's pin button on hover, "Pin pane"
      in the right-click menu, Cmd+Alt+P). It stays on the side of the view
      it was on, always whole and at its width, and never changes place:
      dragging it, moving it, dropping a pane on it and new panes leave it
      where it is. The rest slides in what the pinned columns leave (never
      under 20% of the view; a pin that would leave less is refused). A
      pinned header has the `accent` at 14% (25% when selected) and a 12 px
      pin by the title; it has no grip.
      Each pane has a 34-tall header (a `{pane}` copy of `kanso-strip`,
      always shown). The
      selected pane's header has the `selected` background (in the strip, the
      pane the strip remembers, so it stays marked while a side panel has the
      keyboard). With more than one pane in the tab, that pane also wears a
      1px border in `accent` at 55%, following its rounded corners; the
      others carry the same border in clear, so a new selection shifts no
      terminal, and none shows while a pane is held. A pane whose agent needs you has `blocked` at 40% instead,
      a 2px `blocked` bar along the header's bottom breathing between 45% and
      full (1.6 s), its title in full ink, and "Needs you" in `foreground`
      after a breathing dot.
      - Program icon 15 (75% opacity when unfocused) and the title, 12.5 in
        `foreground` and medium weight when focused, `muted` otherwise.
      - The folder (`~/...`) and branch (with a branch glyph) as plain 11.5
        text.
      - At the right, the pane's status. On hover the status gives way to
        open with (a terminal pane only), split right, split down, zoom and
        close (15 icons).
      - Terminal padding is `[14, 10]`.
    - **Side panel**, at the right of the panes: 368 wide (280 to 900),
      hidden by default. It holds whichever panel is open: `kanso-panel`
      told `files`, `pr`, `shipped` or `worktrees` (`props.panel`), `kanso-spend`
      (Spend), `kanso-guard` (Memory).
      The Worktrees brief, in this one's order: [RECIPE-worktrees.md](RECIPE-worktrees.md).
      The Shipped brief, in this one's order: [RECIPE-shipped.md](RECIPE-shipped.md).
      The PR brief, in this one's order: [RECIPE-pr.md](RECIPE-pr.md).
  - **Status bar**, 26 tall: `kanso-status` with `{side: "left"}`, a
    180-wide minimap (`kanso-strip`) exactly in the middle, and
    `kanso-status` with `{side: "right"}`. The minimap is a centred row of
    soft pills, one per column (6 + 18 x its share wide, 4 tall, gap 3, no
    frame): `muted` in view, `input` off-screen,
    `foreground` focused; a stacked column shows one 2px bar per pane. Click a pill to go there. After the pills, a tiny
    "− n +" control: fewer or more panes per view, and the number itself
    evens the columns out to 1/n.
    `kanso-status`, text 11.5 `muted`:
    - At the left, the machine (monitor or server icon, "This computer") and
      the branch.
    - At the right, "N agent(s) need you" in `blocked` with a dot (blocked or unseen done), then "X of N working" (or "N agents
      idle" / "No agents"), then the palette shortcut "⌘⇧P" with the tooltip
      "Command palette".
- **Themes**: `kanso` (dark) and `kanso-day` (light), in `themes/`.
  - Dark: background `#1b1b19`, foreground `#d8d4cb`, chrome and canvas
    `#161615`, border `#272725`, input `#353430`, muted `#949086`, dim
    `#6b6862`, accent `#da627d`, working `#c4b07e`, blocked `#c99189`, done
    `#98ad8f`.
  - Light: background `#f4f1eb`, foreground `#3c3934`, chrome `#e3dfd6`,
    working `#8f7d52`, blocked `#9a6e68`, done `#6d7d62`.
- **Icons**: one Lucide-style set in `mods/kanso-chrome/icons/`, every one
  with the same stroke (2 on a 24 grid, 1.4 on a 16 grid), so they read as
  one family.

## How it behaves

- **Since you left**: after 5 minutes away, a "While you were away" head under
  the project lists up to three rows: a mark, the Kanso name, and the age.
  The agent in front is left out; one row per agent. +N expands inline;
  Enter or a click jumps and dismisses. Dismissal persists in kanso.db.
  Events expire after 7 days, capped at 500. Nothing, loading or a failed
  read: nothing. No extra fetches.
- **Needs you**: Cmd+J (`kanso-spaces.needs-you.next`) cycles
  blocked then unseen done, oldest first. Native status owns seen; no sleepers.
  The count, from 1, opens project/name/reason/age; click/Enter focuses. With none waiting it stays hidden; Cmd+J still says "Nobody is waiting" briefly;
  loading: kit; unavailable: error. Status shares this queue.
  Strip checks panes each 1.5 s; leaving
  `working` gets `git status --porcelain`, `git diff --shortstat HEAD`,
  commits ahead of `@{upstream}` (else `origin/HEAD`) and `gh pr view`
  (open only; checks and merge state) in shared `kanso.digest`
  by pane, cleared when it works again or closes. The header shows it
  after the branch: files, +/-, commits, #number. A blocked one is not
  green and the tooltip names why. Send opens `kanso-send`.

- **Agent status**, one mark everywhere: the tabs, the pane headers, the
  status bar, the sidebar and Send draw it from one file, kanso-spaces/marks.js
  `stateMark` (with `programIcon` and `nameOf`; copied by `npm run
  sync:share`). An ensō, the brush circle
  (`kanso-chrome/icons/enso*.svg`, tinted), 13px (12 in the status bar, 15
  in the sidebar):
  - Working: the idle ring as a faint track (r 5.6 in 16, 1.5 stroke at
    22%) with a 100° arc running on it (1.7 stroke, round caps;
    `icons/working.svg`), in `working`, turning once every 0.9 s
    (`.spin(900)`). No other spinner for an agent's state.
  - Blocked: a solid `blocked` disc with a bold `chrome` "!". The pane
    header adds the text "Needs you", the status bar says "N agent(s) need
    you", and a project in the collapsed rail shows it.
  - Done: the circle closed, in `done`.
  - Idle: a thin even ring in `idle` at 70%, on sidebar rows (and in the
    status bar when nothing works); nothing on the tab or header.
  - The 7px corner dots on the strip's edge tabs stay dots: a badge, too
    small for a mark.
- **Motion**, native, and never stopped behind other windows (a still ring
  there reads as a stalled agent; what the window saves behind others is
  work: Git, machines, processes less often). The view switch's
  thumb slides (`left`, 200 ms); one pill per list glides (`top`/`height`;
  tabs `left`/`width`; 220 ms) to the chosen space, agent or tab; rows fold
  by `height` (220 ms, measured) and a new row grows in; a header's tools
  slide out by `width`; a panel fades in.
- **Keys** (keys.json `layout:kanso`): ⌃1-9 a space (guarded), ⌃⇧1-9 a
  panel by its place, ⌃⌥P/S/T a view, ⌃⌥1-9 a pane column, ⌃⇧, Kanso
  settings; ⌘⌥hjkl (⇧ moves) vim; left of column 1: sidebar list
  (`kanso-spaces.list`, `kanso.list`); lists: listkeys.js. ⌘F on an agent lists matching turns, newest first.
- **Kanso settings** (kanso-settings, the fixed gear after the panels): Keys
  rebinds Kanso-only keys (never Herdr's), Mods orders (arrows,
  `kanso.panels.order`) and hides panels (`.off`) and pieces (`kanso.hidden`), What's new the log, Credits who.
- **Spaces**:
  - Click a space to select it. Clicking the space you are in folds or
    unfolds its agents; the folded state is kept.
  - Drag a space to reorder it (a 2px `accent` line shows where it lands).
    Double-click a space to rename it (Herdr's `space.rename` prompt).
  - Double-click an agent row to rename the terminal: the same dialog
    Herdr opens for a space or a tab (`kanso-prompt`, 420 wide, with the
    name it shows now selected; Enter saves, Esc leaves it). The name is
    the terminal's own `kanso.name` label in herdr-core (`hc label`; empty:
    the automatic name), so it survives a restart and the pane header, the
    edge tabs and the drop cards show the same name.
    Right-click opens the shipped space menu.
  - With another machine, each is one project-height row: monitor or server
    icon, medium name (`foreground` connected, `muted` off, unreachable,
    or needs login; this computer's host name). Small `dim`: Off, Unreachable,
    Needs login; a breathing line while loading. Turn on, Retry, and copy stay
    visible; hover or keyboard shows turn off and + only when connected; a
    chevron folds it. Copy is `hc machine login <name>`. Off stores
    target, name, via, session and temporary, then `hc machine rm`
    (terminals keep running); nothing under it is listed or read. `false`
    and `null` are none, so add never sends an empty `--via`. On is
    `hc machine add` with those, never `--install`; dropped once
    `hc machine ls` shows it connected. If the save fails after the remove,
    or add keeps failing, it stays with Retry; the hint is the state's
    tooltip. This computer has no power. Alone, no header.
    `hc machine ls`: 30 s in front, 2 min behind.
  - Click an agent row to focus its pane. Pinned agents come first (the
    `kanso.pin` label; drag them, or click the pin). The rest follow the
    order button (kanso.db `spaces.order`): last update, needs you, kind,
    on screen, or your own drag order (`spaces.custom`). A drag stays in
    its section and shows a 2px `accent` line.
  - Each agent row carries its activity (kanso-spaces/agents.js `track`,
    `elapsed`, `activityOf`). At the right, before the state mark, the time
    in its state (11px `dim`, 28 wide, right-aligned): how long it has been
    working, waiting on you, or since it finished ("<1m", "4m", "2h", "3d";
    seen/idle: none). Done and idle are one phase, so looking at a finished
    agent keeps its time. Stamps are kept in kanso.db `spaces.since`
    (address -> state and ms), taken every 2 s outside render; an agent
    first seen after a start takes its tab's `working_since` or
    `changed_at`, else shows no time. On hover the pin takes the time's
    place. Under the name, a second line (12px `muted`; every agent's row
    is 50 tall instead of 32, with or without words, so the list never
    jumps): what the agent says it is on, the first line of the `msg` in
    its report (`terminals()[].report.msg`, OSC 7501: Claude Code sends
    the step it is on while it works and its last words when it finishes;
    at rest, those last words in `dim`). Without one: while working or
    blocked, the agent's own title when the row shows a name you gave it
    (else the title is the name already); when done, the pane's digest from
    shared `kanso.digest` ("+12 −3 · 1 commit · PR #41 failing", or "PR #575, review required" when the merge is blocked). After the
    line, a working agent three minutes on the same step shows its time
    (`dim`; past fifteen, `blocked`), counted from when the `msg` changed
    or was first seen (`trackSteps`, `stepOf`; `status_ms` is not it). Before the mark
    of an agent that isn't working, a count in a pill (18 tall, `foreground`
    at 12%) when something still runs under it: the direct children of its
    process (`foreground.pid`, else its shell's one child) from one `ps
    -axo pid=,ppid=,etime=,command=` every 10 s in front, 30 s behind, less
    MCP servers and caffeinate; the commands (Claude Code's `eval '…'`
    wrapper unwrapped) and times in its tooltip (`tasksOf`).
  - Sub-agents (`terminals()` with a `parent`) are listed under their
    parent, depth first, with tree lines: one 23-wide column per level, a
    1px `input` line under the parent's icon centre and an elbow into the
    row; a 26-tall row, 13px icon, `dim` name, its state (error counts as
    blocked, done as idle). One with a pane moves under its parent; one
    without comes from terminals() while live, and a click peeks at it
    (`terminal.peek`).
  - Rows: Projects and Status alike, 32 tall (50 with a second line, 2px
    between its lines), 1px between rows; Threads, read as conversations,
    64 tall with 5px between the lines and 6px between rows. Radius 8, 12px
    gaps inside; the name
    13.5px medium always (a weight that changed with the state would
    reflow the name), `foreground` while the agent waits on you, is
    focused or is unread, else `muted`. A working agent's title shimmers
    as Claude Code's own status line does: drawn in `muted`, with the same
    text in `foreground` showing through three windows (44, 26 and 12 px
    wide at 35%, 60% and full) that slide across it and back while their
    copy of the text slides the other way (`.loop` on `left`, linear, 2.2
    to 3.2 s, its own pace per agent), so a glint passes over the letters
    in place; after it three dots count (`.frames`, "", ".", "..", "...",
    380 ms). Nothing in the row is laid out again. A row waiting on you sits on
    `blocked` at 8%; the focused one on `foreground` at 7%. Projects:
    space rows 36 tall, the name 13.5px semibold, 10px between projects.
  - Projects | Status | Threads: a switch under the top row (three
    segments, 28 tall, in a 3px-padded `foreground` 4% track, radius 10,
    14px of space under it;
    the chosen one on `raised` with a 1px `border`, semibold; a 6px
    `blocked` dot on Status while a space needs you and another view
    shows; kanso.db `spaces.view`: `spaces`, `agents`, `threads`). No
    caption: each view says how it is arranged by its shape.
  - Status and Threads mix projects, so a row's second line opens with
    its project's name in that color, medium.
  - Status lists every agent in every space in sections: Needs you,
    Working, Done, Idle, Terminals (no status). A section's header (13px
    semibold; 44 tall with 12px above it, the first 32): the ensō of its
    state, its name (Needs you in `blocked`), its count in `dim`, a
    chevron; it folds the section (kanso.db `spaces.sections`). A
    parent and its sub-agents go together where the most urgent of them
    would; the done agent you are looking at stays in Done until you leave
    it. Within a section, by the sort button: latest change first (the
    default), longest in its state first, or by project (localStorage
    `spaces.statusOrder`). Empty: "No agents yet". Collapsed: a mark per
    section.
  - Threads (kanso-spaces/threads.js) lists the conversation of each agent
    on this computer, two lines a row: its title, the time since your last
    message and its state; under it, its space and your last message in
    quotes. The title is the agent's own name for the conversation, read
    again as it changes: Claude Code's last `ai-title` record in the
    conversation file, Codex's `thread_name` in
    `~/.codex/session_index.jsonl`; else the first thing you typed; else
    the row's name; a title you gave it (Rename thread, label
    `kanso.thread`) goes over all of them. Which conversation:
    `terminals()` gives the foreground pid; Claude Code's
    `~/.claude/sessions/<pid>.json` gives `sessionId` and `cwd`, and the
    file is `~/.claude/projects/<cwd, each non-alphanumeric as ->/<id>.jsonl`;
    for Codex, `lsof` on the pid (or its children) finds the open
    `rollout-*.jsonl`. What you typed leaves out tool results, sidechains,
    meta records, text starting with `<` or `/`, "[Request interrupted",
    "This session is being continued" and "# AGENTS.md"; only the first
    and last 4 MB of a file are searched. Laid out as T3 Code's sidebar
    (agents.js `threadSections`): Pinned (a pin glyph; by pin number),
    then the rest with no header, woken ones first, then by the sort
    button: your last message (else the last record; the default) or when
    the conversation started (kanso.db `spaces.threadOrder`); "Grouped
    by project" (`spaces.threadGroup`) makes one section per project
    instead, headed by its name alone, its rows nested. Then Snoozed (a clock; by when
    they wake, showing that time) and Settled (a check; latest first),
    both folded until opened (`spaces.shelvesOpen`). Looking at one or its
    agent finishing moves nothing. The thread's state lives as labels on
    its terminal in herdr-core: `kanso.pin` (shared with Projects),
    `kanso.settled` "<ms>:<turn>", `kanso.snooze` "<ms>", `kanso.unread`
    "1", `kanso.thread`. A settled one comes back by itself when it works,
    waits on you, or a turn ran since; a snoozed one waiting on you wakes
    at once, and one whose time came shows "Woke" (an `accent` pill) in
    full ink until you look at it; looking also reads an unread one (the
    labels are removed then, outside render). Hovered, a row offers
    Settle (or Bring back) and Pin in the time's place. Right-click on a
    row in any view opens its menu (this mod as a 252px popup at the
    pointer): Open, Pin to the top / Unpin, Settle / Bring back, Wake now
    or Snooze (In 1 hour, In 3 hours, This evening at 18:00 while ahead,
    Tomorrow 9:00, Monday 9:00, each with its time), Mark unread / read,
    Rename thread… (Threads) or Rename…, Copy folder, Copy branch, Copy
    conversation id, and Close agent, which asks a second click ("Click
    again to close it") and runs `terminal.kill`; no conversation file is
    touched. Read only while Threads shows: on showing it, every 15 s with
    the window in front, every minute behind it, and when an agent's state
    changes; a file whose size hasn't changed is not read again. While
    reading the first time, as Spend loads: the view's own silhouette, five
    rows of the square, title, time and second line as `border` blocks,
    the whole shape breathing between 35% and 80% every 1.8 s.
  - The sort button's popover follows the view: Projects, "Agents, pinned
    first, then by" and its orders; Status, "In each section, by"; Threads,
    "Threads, pinned first, then by" and "Grouped by project". Then a rule
    and "Show" with two checks, "What
    each agent is on" (kanso.db `spaces.activity`) and "Projects,
    Status and Threads" (`spaces.switch`; off, the view goes back to
    Projects).
  - Every terminal in the space is listed, not only the agents that report
    a status to Herdr: after those come the rest (Codex and other models'
    CLIs, shells, servers) with their program's icon, their title (a shell's
    folder when the title says nothing) and no status mark.
- **Sidebar**:
  - Hide sidebar collapses it to a fixed 76 rail whose edge cannot be
    dragged. `kanso-spaces.sidebar` (⌘B, Herdr's sidebar key) does the same,
    and a sidebar hidden any other way comes back as the rail (`kanso-tabs`).
  - Open, the edge drags to 480; under 240 rows keep one line, under 160
    it folds to the rail. The width you leave opens it next time.
- **Tabs**:
  - Click selects a tab, drag reorders, double-click renames, and
    right-click opens the shipped tab menu.
  - Scrolling over the bar moves one tab per mouse-wheel notch, or per
    trackpad swipe (about 40px of travel).
- **The strip** (keys in `keys.json`, section `layout:kanso`; in Kanso they
  replace Herdr's tab keys, since the canvas is where you move):
  - Cmd+1 to Cmd+9 go to that pane; Cmd+[ and Cmd+] go to the previous and
    next one. The view glides to it (eases over about 0.3 s).
  - Cmd+D opens a pane to the right, Cmd+Alt+D to the left, Cmd+Shift+D
    below (stacked in the same column). The new pane is focused. The header's
    split buttons and the right-click menu do the same.
  - Cmd+W closes the focused pane. Cmd+Shift+[ and Cmd+Shift+] move it left
    and right. Cmd+Shift+Enter (or the header's zoom button) cycles its width
    1/4, 1/3, 1/2, 2/3, 1.
  - Cmd+Shift+- and Cmd+Shift+= show fewer or more panes per view (every
    column 1/n); Cmd+Shift+0 evens them out. `kanso-strip.per-N` sets N.
  - Cmd+Alt+Up/Down (or K/J) move the focus within a stacked column.
  - Kept as alternatives: Cmd+Alt+Left/Right or H/L (focus), with Shift
    (move), Cmd+Alt+1-9, Cmd+Alt+Home/End, Cmd+Alt+C (centre). There is no
    vertical move; those keys go to the program.
  - The wheel or a swipe over any pane header, an edge tab or the minimap slides the view
    one column per quarter view of travel (600px per view width) without
    moving the focus; if the focused pane leaves the view, the keyboard
    moves to the nearest pane still in view. Cmd+Alt+, and Cmd+Alt+. slide
    one column. Clicking an edge tab or a minimap mark slides to that pane.
  - Hold a header's six-dot grip (or Ctrl+drag the header) and drag onto
    another pane to move the pane. While a pane is held the strip is
    sorting: every pane's terminal gives its place to a drop card (a
    `kanso-strip` copy with `{drop: pane}`; the terminal lives on, the tree
    just stops showing it), so the whole pane takes the drop, not only its
    34px header. The card shows the pane's icon and name in `muted`,
    centered; the held pane's own card and header are at 40%. Over a card
    the pointer names a side: the left and right quarters mean a column of
    its own before or after that pane, the middle stacks it above (upper
    half) or below (lower half); the header counts as the pane's top (its
    middle means above) and the foot as its bottom (below). That side is
    shared `strip.drop` `{to, side}`, and header, card and foot draw from
    it: the half the held pane will take fills with `accent` at 25% and
    carries the held pane's icon and name in full ink, the resident's name
    steps to the other half, and the header's matching half (or all of it,
    for above) is washed the same. Any number of panes can stack; the 90px
    minimum height is the only limit. The edge tabs light in the accent too
    (brighter under the pointer): dropping there puts the pane just beyond
    that edge. Letting go on the held pane itself, the sidebar, the tab bar
    or the minimap moves nothing; a pane let go on a gutter stays held
    until the next press, or 12 s, then goes back. When the hold ends the
    terminals return and the keyboard goes back to the strip's focused pane.
- **Side panels, on demand**:
  - Clicking a panel button rewrites the panel stack to hold only that
    panel's block and shows it. Clicking it again, or closing the panel any
    other way, empties the stack. Herdr then ends that mod, and its timers,
    file watches and processes stop.
  - Each project keeps its open panel and what it shows (file, folder,
    pull request, picture), on return and after a restart. Nothing open
    stays shut. A missing file or a closed pull request leaves it empty.
  - Files and PR are idle whenever they aren't the shown panel.
    PR rereads every minute while shown, every 20 s while a check runs.
- **Background**:
  - Git runs only while Spaces shows (0.5 s in front, 5 s behind); the
    `ps` under agents skips Threads. A machine that is off is not read.

## Built from

- **Layout tree** (`layouts/kanso.json`), root `row`, `titlebar: "none"`,
  `traffic_lights: [12, 16]`, `resizable: true`, `terminal_menu: "kanso-menu"`:
  - `sidebar` (column, `chrome`, 256 px, min 200, max 480):
    - `brand`: block `kanso-chrome` (Herdr's mark), 48 px, `window_drag`.
    - `spaces`: block `kanso-spaces`.
    - `sidebar-footer`: block `kanso-chrome` with `{footer: true}`, 156 px.
  - `work` (column, padding 6, gap 4):
    - `inset` (column, no fill, no border):
      - `tabs`: block `kanso-tabs`, 48 px, `window_drag`.
      - `work-body` (row, `chrome` background, gap 6):
        - `main`: `{tab: "active"}` with the `kanso-strip` header (height 34),
          radius 8, gap 6 and no pane borders. `kanso-strip` mounts canvas columns (`strip-*`, `background`, radius 8), restoring it for other tabs.
        - `panel-body`: stack, 368 px (280 to 900), hidden, no children.
          `kanso-tabs` mounts panels here.
    - `status-row` (row, 26 px): `status` (`kanso-status` `{side: "left"}`,
      weight 1), `strip-map` (`kanso-strip`, 180 px), `status-right`
      (`kanso-status` `{side: "right"}`, weight 1).
- **Platform**: shared `platform-*.js` services take injected runners.
  Large SQLite queries use temporary files, cleaned even on error; failures
  roll back unfinished transactions. Windows access errors propagate.
- **Mods**:
  - `kanso-spaces`: tracks/2 s; sleeping/off skip reads. Live PIDs skip `ps`.
    Threads: status/turn or 5 min; misses: 1-10 min/PID.
  - `kanso-tabs`: tabs, panel buttons and the on-demand panel mount via
    `layout.set`.
  - `kanso-strip`: canvas; the status row's controller/minimap samples native
    sizes every 1 s at rest, 150 ms during `strip.drag`. Edge copies draw a rail. State per
    tab lives in shared `strip.state` (`{cols: [{panes, w, pin, hs}], vx,
    n}`; `hs` is each stacked pane's share of the height); the last chosen
    `n` is in shared `strip.n` for new tabs. Copies with `{ruler}` are the
    1px rulers; what they measure is in shared `strip.px`.
    Headers talk to it through shared `strip.req` (scroll, move, width, pin),
    `strip.intent` (where the next new pane goes), `strip.drag` (the held
    pane) and `strip.drop` (where it would land). Copies with `{drop}` are
    the cards that stand in for terminals while a pane is held.
    A `{pane, terminal}` copy (the app passes those to a header; the strip
    adds `strip: true`) is the pane header: icon, name, folder, branch,
    status, hover buttons, the grip and the wheel. Double-click it to
    rename the terminal (the same dialog and `kanso.name` label as the
    sidebar). The header lives in the strip so that one mod owns the
    drag, the drop zones, the names and the icons; Herdr doesn't let a mod
    import another's files.
  - `kanso-prompt`: Herdr's prompt dialog, copied, for what Herdr has no
    command for. Props `{title, value, hint}` and either `command: {name,
    args}` (runs it with `name`, as Herdr's prompt) or `label: {terminal,
    key}` (`hc label <terminal> <key>=<text>`; empty removes the label) or
    `shared: key` (sets `{text, at}`, text null on Cancel); `field`, `button`.
    Opened as a dialog 420 wide.
  - `kanso-help` (⌘?): keys() as a keyboard. `kanso-dojo`: vim game window.
  - `kanso-menu`: the terminal right-click menu (root `terminal_menu`):
    split right, left and down through the strip, width, right-clicks
    to the program, send back, "Open with…" (when the pane has a folder),
    "Send to an agent…", close.
  - `kanso-toast`: notifications (root `toast`): one already up isn't shown
    again; the newest 3 stay (shared `kanso.toasts`).
  - `kanso-send`: a dialog (520 wide), `{pane}`: every other agent pane
    (the one sent to last first, shared `kanso.send.last`), a textarea
    drafted as "Review the changes on branch <b> in <folder>." (plus its
    open pull request), and Send (Cmd+Enter): `hc send <terminal> <text>`
    (pasted, then Enter), refused for a blocked agent, then `agent.focus`.
  - `kanso-arrange`: a dialog (480 wide) of all arrangements (SQLite
    `data/kanso-arrange/arrange.db`, by project and name; another
    project's opens in this space's folder). Save reads each pane's `hc
    get --json` foreground argv (session flags dropped) and cwd and the
    strip's columns; opening (tabkit.js, shared with kanso-sleep) runs
    `tab.new`, then `terminal.open` per pane after a `strip.intent`, then
    `strip.req` widths.
  - `kanso-sleep`: a dialog (520 wide); asleep is a status in `kanso.db`.
    Ordering hides it at once; the sidebar then runs saving, clearing,
    exiting, left, or stuck (retry, undo). One owner (20 s). One row until
    clicked, breathing while it goes; stuck keeps Retry and Undo. A wake
    still going cancels it. Wake: `claude --resume`.
  - `open-with`: a popup (380 wide, at the top; 340 at the pointer from the
    menu and the header) that opens a folder in a code editor. Props
    `{folder, machine}`; without them, the focused pane's folder. With
    `{file}` (a full path, from the Files panel) the editors open that file,
    and a text file is offered first to "Preview in the panel":
    `kanso-panel` with `{panel: "preview", path, on}` mounted in
    `panel-body` the way kanso-tabs mounts its panels. It lists the editors
    found here (app folders, `command -v`, Flatpak), the last one used first
    (shared `open-with.recent`), with each app's own icon on macOS. Terminal
    editors open with `terminal.open {place: "right"}`. A folder on another
    machine opens over SSH in the VS Code family (`--remote ssh-remote+<machine>`)
    and Zed (`ssh://<machine>/<path>`); the rest show "local only".
    Cmd+Shift+O (`mod.open:open-with`, in `keys.json`) opens it.
  - `kanso-chrome`: the top strip's mark and the sidebar footer, plus the icon set.
  - `kanso-status`: status bar; "N agents need you" runs `kanso-spaces.needs-you.next`.
  - `kanso-panel`: the side panels in one mod, chosen by `props.panel`;
    each is a plain class in its own file (`files.js`: lazy file tree via
    `sh`, git status marks, a file shown in place as read-only code, a
    Markdown file sent to `preview.js` with `back: "files"`; `changes.js`:
    git diff and commit; `pr.js`: the pull request, and reviews across this
    machine's projects when `gh` is signed in; `preview.js`: one file by full path, `{path, on, back}`, read
    again whenever its folder changes, with Open with, read-again and close
    buttons: code read-only, Markdown as `doc.js` `MarkdownDoc`, formatted
    and edited in place (a double-click opens one block, a table as cells;
    saved after 700 ms, only when the file on disk is still what was read,
    else a conflict you resolve; "Source" edits the whole file; links to
    other Markdown files open here). `blocks.js` splits and joins the
    blocks. kanso-tabs watches `data/kanso-open` and shows the newest path
    left there (`markdown-handler.sh install`, macOS: makes a small app
    the `.md` handler). The markdown-panel mod is its copy in a window, by
    sync:share); `lib.js` holds what they share (where the focused pane is,
    diff rows, folders from home, the two file renderers: `codeState` is a read-only `EditorState` in the
    terminal's font with the theme's ANSI hues, `markdownView` is the
    SDK's `TextView.markdown`, selectable, in a scrolling column with 16 px
    sides; and `showPanel`, which mounts a block in `panel-body`). A panel
    exists only while `kanso-tabs` shows it, so it never polls the layout
    to learn whether it is visible.
    `ports.js` lists TCP listeners (`lsof -F pcn`) with their folder
    (`lsof -d cwd`), age and parent chain (`ps`); a listener under a
    terminal's shell pid (`hc get`) is in that pane, one in a folder of
    home (not `~/Library`) with none is "No pane runs it". Read every 10 s
    while shown; Stop: SIGTERM on a second press, then SIGKILL.
    `look.js` (Images, panel id `look`, `eye.svg`): no mod hears a click on
    a terminal's link, so it reads the terminal in focus (`hc read --lines
    400`, every 4 s while shown; pinnable) and a session's transcript
    (`transcript.js`). Pictures already found are rows in `kanso.db`
    (path, first-seen order, color, there) with the offset of the last whole
    line; the next read greps only new whole lines, and a rewritten file is
    read once and replaces its rows. A missing file, or one that will not
    open, is dropped; none yet is one line.
    Copies in `data/kanso-panel/look` draw the newest big (`image()` reads
    the app folder; HEIC/TIFF via `sips`/`magick`); each picture is a circle,
    the active one filled with its color. A click drops a numbered pin, kept for that agent and picture until Send, and
    opens `kanso-prompt` with `shared: "kanso.look.note"` (`{[token]: {text,
    at}}`, read on render; Cancel drops a new pin). ⌘↩ sends "About <path>:"
    and a line per noted pin (`deliver.js`).
    `herdr-app do 'kanso-tabs.look <path>'` (or `.gallery`) opens one.
  - `kanso-containers` (own mod): `docker ps -a`, `images`, `stats` while shown.
  - Mods: Herdr (Apache-2.0) via 0OZ/minimalistic; `"place": "none"`.
  - Own-folder imports only: `scripts/sync-share.mjs` copies shared files;
    `npm run sync:share -- --check` detects drift. Kdb batches same-tick calls;
    prefs/panel-state reads cache until a write or 30 s. Return touch/prune
    share a call.
- **Herdr functions**: `spaces`, `panes`, `agents`, `terminals`, `machines`,
  `layout`, `theme`, `shared`/`setShared`, `window`, `exec`, `hc`,
  `watchFolder`, `readTextFile`, `openOverlay`, `run`, `home`, `appHome`,
  `updates`.
- **Commands**: `layout.set`, `layout.resize`, `space.*`, `tab.*`, `pane.*`,
  `app.settings`, `app.palette`, `mod.open` (`picker`, `machine-add`,
  `open-with`), `terminal.open`.
- **Shipped overlays used**: `menu`, `new-menu`, `picker`, `machine-add`.
- **Programs run**: `git` (spaces, Files), `sh` (Files listing),
  `hc` (machines) and, for Open with, `sh`, `open`, `plutil` and `sips`
  (macOS) and the chosen editor. The PR panel runs `gh` and `git` only while
  shown. Nothing else reaches the network.

## Watch out

- A layout may nest at most 16 levels (`layout.set` refuses deeper ones).
  Put the strip's columns directly in `work-body` (column > cell column >
  block), never inside another row.
- Herdr folds the layout on its own: empty containers go, containers with a
  single child are replaced by that child, and terminal blocks whose
  terminal ended go. Never rely on an empty column for space (use a filler
  block) or on a single-child wrapper's id. The side panel's toggle lives on
  `panel-body` itself for that reason.
- Herdr won't let a mod handle the mouse over terminal text, so a hold on a
  grip takes the terminals out of the tree for its duration and puts drop
  cards in their place: that is how the whole pane, not only its header,
  can show where the held pane lands and take the drop. Nothing tells a mod
  about a release over a gutter (no `on_mouse_up_out`), hence the
  next-press and 12 s ends. Resizing isn't a mod's drag at all: it is
  Herdr's divider, read back afterwards.
- A host argument nests at most 16 levels, and the layout tree counts each
  node and its `children` array: there is no room for a wrapper around the
  strip's columns in `work-body`, which is why the rulers sit inside the
  columns and at the row's start instead.
- Herdr's divider moves only the two nodes beside it and never a fixed one
  (`min` = `max`). The side panel's border must have a strip column on its
  left: the 1px height ruler stands at the row's start, and while a panel
  shows, every layout writer puts the strip's right edge rail
  (`strip-edge-right`) after the panel (`edgeBesidePanel`), so the panel
  can be dragged between 280 and 900 wide.
- A terminal block takes the keyboard on click, so `focused().pane` is null
  and implicit pane commands fail. Pass `pane` or `terminal` explicitly
  (`pane.split {pane}`, `pane.focus {terminal}`), and focus a new pane only
  once its block is in the layout.
- Herdr's own focus stays on a tab's model pane, and lands there whenever you
  come to a tab (another space or tab, a layout switch, a restart). That pane
  isn't on screen, so the keyboard would go nowhere until a click. The strip
  remembers the selected pane per tab (`focus` in "strip.state") and, when a
  model pane holds the focus, hands it to a block: the remembered pane on
  coming back, or the model pane itself when Herdr's focus moved to a new one
  (an agent notification, a closed pane). Otherwise it leaves the keyboard
  alone, so a side panel you click keeps it.
- Herdr's own terminal menu passes a terminal block's id (`term-<pane>`) as
  its target pane, so its Split and Close fail with "no pane". Kanso ships
  its own menu, which finds the real pane from the clicked terminal.
- Cap layout writes: the strip writes only when its tree changes, at most
  once every 100 ms (checked before it reads the tree, so a skipped write
  costs nothing; a burst writes its first step at once and then its latest
  state), and pauses itself for 10 s if more than 30 writes in 3 s ever get
  past that, so a mistake can't keep the window busy.
- `layout.set` replaces the whole tree, and a set that has not landed still
  reads as the old one. The strip, the tabs, the panel and the sidebar keep
  their piece in shared state and put all three back on every write, so one
  writer cannot drop another's: the strip's columns in `kanso.layout.strip`
  (`nodes`, `sizesBefore`), written by the strip alone so it never reads the
  rest back, and the panel and rail in `kanso.layout` (`panel`, `rail`).
  The strip also records `sizesBefore`: other writers preserve new native
  divider sizes while its adopt timer catches up, but replay pending strip
  width commands over the old sizes they were based on.
- On Unix, Files lists a folder with one `find -print0` and no shell: a
  directory is printed twice in a row (no name repeats in a folder), so its
  type costs no extra call, and NUL separators keep names with newlines
  whole. It keeps 501 entries and displays 500, the extra one only to detect
  truncation. If `find` can't run or its output passes exec's 8 MiB, it falls
  back to Bash reading the same `find` with a bounded loop.

- Never use `.spin()` for a busy state. It redraws the whole window about
  30 times a second while any agent works, and every redraw repaints every
  visible terminal. Use `.frames` with a slow period.
- A block stays alive while it is in the layout, even hidden. On-demand
  panels must be removed from the tree (`layout.set`), not only hidden.
  `kanso-tabs` reconciles: hidden with a child unmounts it, shown with none
  mounts the remembered panel. It waits up to 1 s for its own `layout.set`
  to land before reading the state as a choice.
- `layout.set` only works on a personal layout. Kanso is one once copied in,
  but the shipped `main` is not.
- The collapsed rail must be at least 76 wide on macOS, or the traffic
  lights overlap the tab bar. Its non-resizable state lives on the root row
  (`resizable`) together with the sidebar's `min`; `kanso-spaces` sets both
  with `layout.set` when you fold or open the sidebar, and once at start.
- Read `panes()`, `spaces()` and `layout()` once per render. Each read copies
  the whole list.
- Keep one-time fixes (`kanso.row`) in `init`, never in `render`.
- The macOS window layout (traffic lights, the empty top strip) assumes
  `titlebar: "none"`.

## Done when

- Right-click a terminal, "Open with…": the popup names that pane's folder
  and lists the installed editors; picking one opens that folder in it.
- In a repository whose branch has an open PR, the PR panel shows its title,
  checks, review, mergeability, unresolved threads and files; clicking a file
  shows its diff, and Explain opens an agent tab with the task.
- `herdr-app check` passes for all eight `kanso-*` mods and `open-with`, and
  `herdr-app status` shows no errors after `layout.switch {name: "kanso"}`.
- With no panel open, `panel-body` in the layout file has no children. After
  clicking Files it holds exactly one `files` block, and closing it empties
  it again.
- With the panel closed, no process started by Files or Insights is
  running.
- A working agent shows the same turning arc on its tab, header,
  agent row and the status bar. A blocked one shows "Needs you" in its header and in the
  status bar.
- Collapsed, the sidebar is 76 wide, its edge does not drag, and the traffic
  lights sit inside it. Opened, it drags between 200 and 480 and reopens at
  the width you left.
- One trackpad swipe over the tab bar moves exactly one tab.
- At 3 per view, Cmd+D three times from one pane gives four columns at a
  third each; the view slides to the new one and the minimap shows four
  pills. Cmd+Shift+= makes it 4 per view and all four fit; Cmd+Shift+- twice
  goes back to 2 per view with the focused pane still in view.
- Dragging the gutter between two columns 200px right on a 1200px view
  makes the left one a sixth of the view wider and the right one that much
  narrower; a quarter second later the minimap pills show the new shares,
  and sliding the view or opening a pane keeps them.
- Dragging the gutter between two stacked panes gives one the height the
  other loses; Cmd+Shift+0 evens them out again.
- Cmd+Alt+Left past the first column in view slides the view.
- Pin the left pane of three and scroll: it stays at the left, whole, while
  the others slide beside it. Ctrl+dragging it, Cmd+Shift+] and dropping a
  pane on it change nothing. Pinning panes that would leave under a fifth of
  the view does nothing.
- Select the second of three panes, go to another space and back: that pane
  takes typing at once, with no click, and its header is the lighter one.
  An agent asking for input tints its pane's header in `blocked`.
  Cmd+Shift+Enter makes the focused column 2/3 wide without changing any
  other column.
- Dragging a grip onto the right half of another header moves that pane
  after it; onto the left half, before it. Ctrl+drag does the same.

## Spend and Memory

Briefs: [RECIPE-spend.md](RECIPE-spend.md), [RECIPE-guard.md](RECIPE-guard.md).
