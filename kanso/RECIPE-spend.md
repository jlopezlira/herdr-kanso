# Spend (`kanso-spend`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the Spend
panel, kept in its own file so RECIPE.md stays under the 64 KB the
herdr.dev gallery reads.

Spend opens from the tab bar like the other panels: the `insights` panel id,
mounted with `{ mod: "kanso-spend" }`. It was the separate herdr-token-spend
mod. On its first start it copies `data/token-spend` to `data/kanso-spend`
when the new folder has no store yet. Its `mod.json` has `"place": "none"`, so
Herdr never docks a copy on its own.

A quiet panel that shows what your AI coding sessions would cost at API list price: per period, per model, per project and per task. It reads the session files Claude Code, Codex, Pi and OpenCode already write on this machine, prices every token, and shows one large figure, a thin daily chart and short lists you can open for detail. It works only while you can see it: hidden or closed, it runs nothing.

## What you see

Everything sits in one centered column, max 1080 px wide, with 32 px side padding (16 px under 560 px wide). There are no cards, boxes or uppercase labels. Hierarchy comes from type size, weight and tone. Every color is a token mapped from `theme()` in `ui.js`: `canvas` behind everything, `foreground` for primary text, `muted` and `dim` for secondary text, `border` for hairlines, `accent` used only for the chart peak and the live dot.

Top to bottom:

1. **Header.** On the left, "Spend" at 20 px (17 px when narrow). Inside a detail view, a back arrow, a small dim crumb ("Project", "Model", "Task") and the item name instead. On the right, two 26 px icon buttons: refresh (it spins while an update runs) and a gear for Settings. During the first scan, "Reading sessions, N of M" appears in 11 px dim text beside them.
2. **Controls.** Text tabs "Month", "30 days", "Year", "All time" at 13 px: the selected one in full tone and medium weight, the others dim. On the right, two text menus, "All projects ⌄" and "All models ⌄", which open popovers listing every option with its cost. When a filter is set, "Showing <name>" appears with a "Show everything" link.
3. **Hero.** The period name (for example "October 2026") at 15 px, with ‹ and › to step back and forward, plus "Back to now" once you are in the past. Below it, the total at 72 px light weight (48 px under 560 px), with "API value" at 13 px dim beside it. Then a dim line comparing it with the previous period ("14% more than September"). Then a row of 28 px light numbers, each with a 12 px dim unit: tasks, per task, "a month" (Year and All time only), and tokens.
4. **Chart.** One vertical line per day (Month, 30 days) or per month (Year, All time), 132 px tall at most. Lines are 2 px in `muted` at 55% opacity. The peak is 3 px in `accent`, with its value written above it. Empty days are a 1 px stub in `border`. The first and last dates and "Per day"/"Per month" sit underneath at 10 px. Hovering a line shows the day, cost and tokens.
5. **Active now.** Sessions whose transcript changed in the last 30 minutes, newest first, up to 5. The heading has a 6 px accent dot that breathes slowly. Each row shows the ticket (if any), the title, then tool, model, project and "active now" or "N min ago", with the cost on the right in 17 px light weight. The cost covers the whole session, regardless of the period and filters.
6. **Projects and Models.** Two lists side by side from 860 px wide, stacked below that. Each row shows the name, then the tokens dim, then the cost at 15 px light weight, right-aligned. 6 rows are visible, with "Show N more" below. Hovering a model shows its price per million tokens and where that price came from.
7. **Tasks.** Rows separated by hairlines: the ticket key in medium dim text, then the title (the start of the first prompt), then a meta line (project, main model, date range, "N sessions"), and the cost and tokens on the right. 8 rows are visible, with "Show N more" below.
8. **Footnote.** Two lines at 10.5 px dim: where the prices come from, and how tasks are grouped.

**Loading** is never a spinner. It is the view's own silhouette, drawn in `border` tone: blocks where the figure, stats, rows and chart lines will be. The whole shape fades between 35% and 80% opacity over 1.8 s, using one native `.loop`. While a filter or period change is priced, the current view drops to 55% opacity instead.

**Detail views:**

- **Project:** the same page filtered to that project, without the project list and without Active now.
- **Model:** the same page filtered to that model, without the model list and without Active now.
- **Task:** the ticket, the full first line of the prompt at 15 px, then project, tools and dates. Below that, the cost at 60 px with an Input / Output / Cache read / Cache write row, a Models list and a Sessions list (each row with its cost), and an "Open <project>" link.

**Settings:**

- **Sources:** a toggle per source (Pi, Codex, OpenCode, Claude Code), with the folders it reads.
- **Plans:** rows with a name and a dollar amount per month. There are "Add plan" and "Save plans" links, and a remove icon on each row.
- **Prices** and **Updates:** a short paragraph each, explaining where prices come from and when the panel updates.

## How it behaves

- **Price.** A row's cost is input × input rate + output × output rate + cache read × cache rate + cache write × cache write rate, from these sources in order:
  1. A per-model override in `data/kanso-spend/prices.json` (`"models": {"<model>": {"input": 4, "output": 20, "cacheRead": 0.2}}`, in USD per 1M tokens).
  2. Anthropic's first-party list prices for `claude-opus-5-5` ($4 / $20, cache read $0.20), `claude-fable-5-1` ($10 / $50, $0.25) and `claude-sonnet-5-5` ($2 / $10, $0.20). A cache write costs 1.25× input, or 2× input for Claude Code rows, because Claude Code writes its cache with the 1-hour TTL.
  3. The OpenRouter model catalog (`https://openrouter.ai/api/v1/models`), fetched at most once a day and cached. The model name is matched after the last `/`; a dated or suffixed id matches its base, and the provider's first word is tried as a vendor prefix (`kimi-coding/k3` matches `moonshotai/kimi-k3`).
  4. Free models and local runtimes are $0. Anything else is counted as unpriced: it is never guessed.
- **Tasks.** A task is a ticket when one of the session's first four prompts names one: a link to Jira, Linear, ClickUp, a GitHub issue or PR, a Google Doc or Notion, or a bare key like `WEB-142`. Otherwise the task is the session. Its title is the session's `/name` (Pi), else the ticket, else the first line of the first real prompt, cut to 120 characters. Harness boilerplate (`<environment_context>`, `# AGENTS.md`, `<system-reminder>`, `[Image #1]`) is skipped. Only that line and the ticket refs are stored, never the transcript.
- **Previous period.** The comparison note is against the period of the same length just before: the previous month, the previous 30 days, or the previous year. "All time" shows the monthly average instead.
- **Clicks.**
  - A project, model, task or live session row opens its detail. Back (the arrow, Esc or ⌘[) returns one level and restores the filters you had. Details nest: project → task → back → back.
  - Period tabs and ‹ › re-price without a new scan.
  - A Sources toggle re-indexes; turning a source off removes it from every number.
  - "Save plans" writes `plans` into `prices.json`, keeping its other keys. The hero then shows what your plans cost in the period and how much they saved you.
- **Keys** (from `keys.json`, only while the panel has focus): ⌘R refresh, ⌘, Settings, Esc and ⌘[ back.
- **When it runs.** A copy starts the first time it shows. While visible, it refreshes every 60 s, or every 30 s while any session is active. Hidden (a closed panel column, another child of its stack, a hidden ancestor), its timer stops, its data is dropped and no process runs. When shown again, it reloads within a second, woken by the `kanso-spend.open` command or by its next render. A side-panel toggle should run `run("kanso-spend.open")` after showing it.
- **Other computers.** Sync is off until Settings turns a computer on; nothing is asked of it until then. Both computers need this version of kansō. Spend then reads that computer's stored totals (`prepare`, no new scan) and lists each computer under the total. Settings and Spend say Update kanso there until the other one is on this version. A computer turned off from the sidebar is not asked, and Settings shows it as off. One computer is unchanged. A computer out of reach keeps the last figures and their time. The share card hides while other computers are in the total. `sync.js` is shared with Settings; `sync-probe.mjs` is what the other computer runs.
- **First run.** Herdr stops an `exec` after 30 s, so each scan stops at 18 s, saves what it read and continues a second later. A history of about 1400 sessions takes two passes. Afterwards a refresh reads only files that changed (about 0.6 s).
- **Sample data.** Create `data/kanso-spend/demo` (any content) to show sample data instead of your sessions, for screenshots. Delete it to go back.

## Built from

- **`mods/kanso-spend/main.js`** (the view, QuickJS). One `View` class. Its state is the cost options `{period, offset, project, model}`, a navigation stack, `page` (home or settings), the last payload, and a single-flight runner: one presenter call at a time; a request made meanwhile is queued, and a scan wins over a re-price. Every call is `exec(node, [presenter, command, --store, --home, --options JSON])`, where `node` comes from `runtime.json`. A 35 s watchdog per call shows "took too long" instead of hanging.
  - herdr functions: `exec`, `appHome`, `home`, `theme`, `layout`, `machines`, `nextCommand`, `readTextFile`, `writeTextFile`.
  - gpui-base controls: `Button`, `Popover`, `Input`, `InputState`, and `Toggle` (through `ui.js`).
  - Native animation: `svg().spin(900)` for the refresh icon, `.loop("opacity", …)` for the skeleton and the live dot.
  - Commands: `kanso-spend.refresh`, `.open`, `.settings`, `.back`.
- **`mods/kanso-spend/presenter.mjs`** (Node 22.15+).
  - `snapshot` runs the collector, updates task labels (time-boxed to 25 s since start), refreshes the price catalog if it is stale and fewer than 16 s have passed, then derives costs.
  - `prepare` derives costs from the stored index without scanning.
  - `configure --sources '{"codex": false}'` changes which sources are enabled, then scans.
  - Output is one JSON line, `{kind: "kanso-spend-costs", version: 1, scan, costs, settings}`, about 35–60 KB, with every number and label already formatted as text.
- **`collector.mjs` and `core/`:**
  - `config.mjs`: the sources and their roots: `~/.pi/agent/sessions`, `~/.codex/sessions` and `~/.codex/archived_sessions`, `~/.local/share/opencode` (SQLite through `node:sqlite`), and `~/.claude/projects`.
  - `adapters.mjs`: parses each harness's records into token usage. Claude Code repeats a message's usage on several lines; dedupe it by message id and request id.
  - `scan.mjs`: incremental by file size and mtime. `.jsonl.zst` archives are checked with one decompress pass before any change, and an 18 s budget applies per scan.
  - `store.mjs`: the index in `data/kanso-spend/spend.db` (`node:sqlite`, WAL): tables `meta`, `files`, `dedup` and `tasks`, one JSON row per entry, keys stored as JSON strings (file keys hold a NUL, which SQLite text cuts). A save writes only the entries that changed, in one transaction; a read for display skips `dedup`, which only scans use. A `store.json` from before is moved in by the first writer and kept as `store.json.migrated`. Rows are day × session × harness × provider × model × project.
  - `labels.mjs`: task titles and tickets, in `labels.json`. Pi sessions reuse pi-usage's cache (`~/.prjct/pi-usage/scan.json`) when it exists.
  - `costs.mjs`: rates, periods, grouping, and all display text.
  - `demo.mjs`: the sample data.
- **`ui.js`:** the theme token mapping and a few helpers (`toggleSwitch`, `controlInput`).
- **`share.js` and `spend-card.js`:** Share, the same as Shipped's (see `kanso-panel/share.js`, of which this is a byte-for-byte copy; `npm run sync:share`). A share icon in the header, shown only on the home view with no project or model filter; it opens the "Share to" row. `spend-card.js` turns the costs into the card: "Spend" and the period, the total "of AI work at API list price", the rise against the period before (only a rise), tasks, per task, tokens, the project and model counts, the plan note, and the chart's bars by ratio with its first and last labels. No names reach it.
- **`icons/`:** `refresh`, `settings`, `back`, `close` and `share`, as 24 px stroke-2 line SVGs drawn with `svg()` and tinted by text color.
- **Network:** one HTTPS GET a day to the OpenRouter catalog. **Programs:** `node` (on another computer too, when Sync is on; no new port). **Files read outside the mod:** the four session folders above and, if present, `~/.prjct/pi-usage/`. **Files written:** under `data/kanso-spend/`, and under `data/kanso-sync/` when Sync is on.

## Watch out

- **QuickJS runs every script step under a time limit.** A step that parses a large `exec` result can be cut off silently: the view is left with no data and no error. Keep the payload small (well under 100 KB) and send strings already formatted. Never send raw rows to the view.
- **Render has about 50 ms.** Build menu options in event handlers, not in `render`. Create `InputState` only in `init` or event handlers. Keep fewer than about 100 rows on screen.
- **`exec` is killed at 30 s.** A first scan of a long history will not fit, so it must save progress and continue. Don't `structuredClone` the whole store per archive as a rollback point: at 14 MB that is about 0.3 s per file, and it was the original cause of timeouts.
- **Hidden copies keep their timers.** Check the layout before doing work, and drop data when hidden. `<mod>.<command>` only reaches shown copies.
- **Codex `input_tokens` already includes cached tokens.** Subtract `cached_input_tokens` to get uncached input. Output already includes reasoning tokens; don't add them twice.
- **Catalog matching.** Sort the catalog longest id first, so `gpt-6-sol-pro` doesn't swallow `gpt-6-sol`.
- **OpenRouter prices.** Some catalog cache rates differ from Anthropic's own, which is why the first-party table wins for Claude models.
- **Runtime.** `runtime.json` must point at Node 22.15 or newer: zstd archives need `zlib.createZstdDecompress`, and OpenCode needs `node:sqlite`. `"node"` works when it is on the login PATH.
- **The folder name is a constant (`MOD`) at the top of `main.js`.** Asset paths, the data folder and command names all derive from it.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/kanso-spend` passes.
- With `data/kanso-spend/demo` present, the panel shows a period total, a chart with one marked peak, five projects, five models and ticketed tasks such as "WEB-142 Add rate limiting to the public API".
- Without it, the figures match a hand count from one transcript, for example a Claude Code session's deduplicated usage priced at the rates above.
- Clicking a project shows its detail, back restores the previous filters, and a task opens its breakdown.
- Settings toggles a source, the totals change, and "Save plans" writes `prices.json`.
- With the panel hidden for two minutes, no `presenter.mjs` process appears and the store's modification time does not change.
- A fresh install with a long history finishes its first index over several refreshes, without a timeout error.
