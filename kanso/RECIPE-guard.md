# Memory (`kanso-guard`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the Memory
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

Memory opens from the tab bar like the other panels: the `memory` panel id,
mounted with `{ mod: "kanso-guard" }`, with a memory-stick icon
(`kanso-chrome/icons/memory.svg`). Its `mod.json` has `"place": "none"` and
the title "Memory", so Herdr never docks a copy on its own.

A quiet panel for sessions that run for weeks: about a dozen coding agents that
are never closed. A daemon, the guard (`guard.mjs`, run by launchd every 60 s),
samples memory, recycles bloated idle Claude agents, restarts the Herdr window
when it bloats, ends hung helpers and keeps a history. The panel shows what the
guard sees and did, and lets you do the same by hand. It works only while you
can see it: hidden or closed, it runs nothing.

## What you see

One centered column, max 1080 px wide, 32 px side padding (16 px under 560 px).
No cards, no boxes, no uppercase labels, no explanatory captions: hierarchy
comes from type size and tone, rows are split by hairlines, and every action is
quiet text. Every color is a token from `theme()` through the panel kit
(`ui.js`): `text`, `muted`, `dim`, `border`, `accent` for the chart's lowest
point and a working agent's dot, `red` for alarms and armed actions, `yellow`
for an agent past the recycle size and low-memory events.

Top to bottom:

1. **Header.** "Memory" at 20 px (17 narrow); on the right, the refresh icon
   (26 px). It runs a check now and spins until the guard has written a newer
   sample; its tooltip says when the last one was taken.
2. **Hero.** Free memory at 72 px light (48 narrow), in `red` under the
   guard's low mark, with "free" beside it ("free · paused" when the guard is
   paused). Under it, 15 px dim: the machine's total and the swap in use of its
   total. Then a row of 28 px light numbers with 12 px dim units: the window,
   herdr-core, the agents together (with how many), and from the history:
   recycles, restarts and memory freed. The window's number turns `red` past
   its limit or when its mod runtime ran out of memory. Then quiet actions:
   "Restart window", and "Clean up N hung helpers" while there are any.
3. **Chart.** Text tabs "24 h", "7 days", "30 days", with "lowest N%" at the
   right. One 2 px line per bucket (96 of 15 minutes, 84 of 2 hours, 90 of 8
   hours), 96 px tall at most: the lowest free % in that bucket. Lines are
   `muted` at 55%, `red` under the low mark; the lowest bucket of all is 3 px
   in `accent` with its value above it; a bucket with no sample is a 1 px stub
   in `border`. The start, "Free" and "now" sit underneath at 10 px. Hovering a
   line shows its time and value.
4. **Agents.** "Agents" with their total. One row per agent, heaviest first,
   12 then "Show N more": a pulsing 5 px `accent` dot while it works, the name
   (13 px), then kind, terminal, "working" or "idle N min", and "up N d" (11 px
   dim); at the right a 14-day sparkline (one 2 px bar a day, its largest
   footprint that day, every agent on one scale), the footprint at 15 px light
   (`yellow` past the recycle size), and "Recycle" when the guard says the
   agent is recyclable. Otherwise there is no action, and the guard's reason
   (`why`) shows on hover over the name.
5. **Heaviest.** The processes holding the most memory, agents or not (a
   Docker VM, a browser): name, "up N d", size. Information only.
6. **Events.** The last 15, newest first: time (11 px dim) and the guard's own
   words, in `red` for errors, `text` for recycles and restarts, `yellow` for
   low memory, `muted` or `dim` for the rest.
7. **Footnote.** One 10.5 px dim line with the limits: when the window
   restarts, when idle agents recycle (or that they never do), and when the
   low-memory notice fires.

**Off and stalled.** With no `now.json`, the body is "Off" (28 px light,
`muted`) and "Turn on". An unreadable file says "Unreadable", with "Turn on"
and "Read again". A `now.json` older than 3 minutes keeps the view, dimmed to
55%, under "Stopped at HH:MM" in `red` with "Turn on".

**Loading** is the view's silhouette in `border` tone (hero, numbers, chart
lines, rows), breathing between 35% and 80% opacity over 1.8 s with one native
`.loop`. Motion never waits on window focus: the loader and the working dots
keep moving behind other windows.

## How it behaves

- **Reading.** Every 15 s while shown, `readTextFile` of
  `data/kanso-guard/now.json`; `history.json` once a minute. No process runs to
  read. History is reduced right after reading to the three chart series, the
  sparklines and the totals (`digestHistory`); the raw file is not kept.
- **Actions.** Each starts the guard detached, so exec's 30 s limit never
  applies: `exec("sh", ["-c", 'nohup "$0" "$@" >/dev/null 2>&1 &', node,
  "<appHome>/mods/kanso-guard/guard.mjs", ...args])`, with `node` from the
  mod's `runtime.json` (`{ "node": "node" }`). The view reads again 3, 8 and 20
  s later. The action's label reads "…ing" until the guard's files show it
  done (the agent gone from the list, a new window pid, no helpers left, a
  newer sample, a fresh file), or 90 s pass.
  - `recycle <pid>`: per agent row. A second press within 4 s confirms
    ("Press again", `red`).
  - `restart-window`: confirmed the same way ("Press again to restart the
    window").
  - `reap`: ends hung helpers; confirmed the same way.
  - `check`: the refresh icon and ⌘R.
  - `install`: "Turn on".
- **Keys** (from `keys.json`, `mod:kanso-guard`, only while the panel has
  focus): ⌘R check now, Esc back (disarms a pending confirmation and folds
  the agent list). Both are on the Keys page.
- **When it runs.** Herdr starts a copy when the panel is opened. Hidden (a
  closed panel, another child of its stack, a hidden ancestor), the next tick
  stops the timer and drops the data. Shown again, it wakes on the next render
  or on `kanso-guard.open`.

## Data

Written by the guard to `${appHome()}/data/kanso-guard/` (read up to 1 MiB):

- `now.json`: `{"v":1,"at":ms,"machine":{"totalMB","freePct","swapMB","swapTotalMB"},
  "window":{"pid","mb","oom","limitMB"},"core":{"mb"},"agents":[{"pid","kind","name","cwd",
  "terminal","mb","status","idleMin","session","ageMin","recyclable","why"}],
  "heaviest":[{"pid","name","mb","ageMin"}],"helpers":n,"limits":{"windowMB","agentMB",
  "agentIdleMin","lowFreePct","recycle"},"paused":bool,"events":[{"at","kind","text"}]}`.
  `kind` of an event is `recycle`, `restart`, `reap`, `low`, `error` or `skip`.
- `history.json`: `{"v":1,"minutes":[[at,freePct,swapMB,windowMB,agentsMB]]` (24 h),
  `"hours":[[at,freeMin,freeAvg,swapMax,windowMax,agentsMax]]` (90 days),
  `"agents":{"<key>":{"name","kind","points":[[hourAt,mbMax]]}}` (14 days),
  `"totals":{"recycles","restarts","reaped","freedMB","since"}}`. An agent's
  sparkline is found by its session, then `kind:name`, then name.

## Built from

- **`mods/kanso-guard/main.js`** (the view, QuickJS): one `View`; state is the
  parsed `now`, the history digest, the chart range, the armed confirmation and
  the actions under way.
  - herdr functions: `exec`, `appHome`, `theme`, `layout`, `nextCommand`,
    `readTextFile`.
  - Commands: `kanso-guard.refresh`, `.open`, `.back`.
- **`model.js`**: no host calls, tested on its own (`tests/guard.test.mjs`):
  `parseNow` (off, bad, stale or ok; agents heaviest first, events newest
  first), `size`, `span`, `clock`, `agentMeta`, `limitsNote`, `freeSeries`,
  `agentSparks`, `sparkFor`, `digestHistory`.
- **`ui.js`**: the panel kit, a byte-for-byte copy of `kanso-panel/ui.js`
  (`npm run sync:share`).
- **`guard.mjs`**: the daemon (Node). Commands: `check`, `install`,
  `recycle <pid>`, `restart-window`, `reap`. It writes only under
  `data/kanso-guard/`.

## Watch out

- QuickJS runs each step under a time limit: never keep the raw history or
  build rows from it in render. Under 100 rows on screen.
- `exec` is killed at 30 s, and a window restart ends this very view: always
  start the guard detached.
- Hidden copies keep their timers: check the layout before reading.

## Done when

- `herdr-app check kanso/mods/kanso-guard` passes.
- With a sample `now.json` and `history.json`, the panel shows free memory, the
  chart with one marked lowest bucket, the agents heaviest first with their
  sparklines, the heaviest processes, the events and the limits.
- Without `now.json` it says "Off" with "Turn on"; with one older than 3
  minutes, "Stopped at HH:MM".
- "Recycle" needs a second press, starts `guard.mjs recycle <pid>` detached,
  and the row's label returns once the agent is recycled.
- With the panel hidden, it reads nothing.
