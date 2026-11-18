# Handoff: tab bar (#331, #233), PR #395

Branch `feat/tab-bar`, worktree `.worktrees/kit-c7-tabs`, two commits on origin/develop effe7142. Ready for review, not merged.

## Done in the PR

- `stories/kit/tab-bar.js`: the Tab bar composition, copied to `kanso/mods/kanso-tabs/tab-bar.js` (sync-share COMMON). `panelDoors` stays in compositions.js (the lint lets a composition import only kit.js); the story passes it.
- `stories/kit/tab-bar-tree.js`: the compiler's markup for Tab and Tab bar, listed in `PIECES` (css-to-gpui.mjs); ui-css.js regenerated.
- `kanso-panel/ui-tab.js`: the Tab piece painted from the compiled CSS, with each look cached per state combination (`Answers` in ui-match.js).
- `ui-stack.js`: stacks `tab bar`, `tab bar more`, `tab bar menu` and `tab bar doors`, plus `tabBarRoom` for folding.
- `kit.js`: `tabs` takes `onClose` and `wires` by key, `tabSkeleton`, a `wires` map for any named Button, and the stack events `onSize` and `onOver`.
- `ui-match.js`: `stylesFor` keeps its answer per node shape. Without it, kanso-settings hit the runtime's step limit ("interrupted") in `herdr-app check`.
- `ui-button.js`: an active Button takes wash-12, as the Storybook's does.
- Proposed in both kits: `help`, `arrange`, `tips` and `drop: "after"`.
- Tests: tab-bar.test (19), tab-bar-tree.test (4), segmented.test and window-tokens.test rewritten to the Tab story's values, and check-gpui-styles gets Tab and Tab bar cases.

## Open, for the lead

1. The Storybook contradicts itself. rules.js says "Selection is one wash shared by the active project, tab and focused pane header" (wash-12), but the Tab CSS draws the chosen tab with wash-7. The PR follows the Tab story (wash-7).
2. #233 criterion 5, "the + menu with keyboard and key hints". The Storybook draws no + menu: + is the New tab door, and the +N folded Menu has no hints. Only what the Storybook shows is built.
3. Captures beside each story are local, not in the PR: `/private/tmp/claude-501/-Users-jj-Apps-herdr-herdr-kanso--worktrees-kit-c7-tabs/ba20bb53-e254-4f73-b82b-3b767dee2888/scratchpad/pairs/` (index.html plus a PNG pair per state) and the contact sheet `.../scratchpad/shots/sheet.png`. The Storybook side is 6006, which serves develop, so it lacks the Proposed help door and draws two connecting skeletons. The renamed-waiting story capture shows "checkout", because its URL argument has a comma.
4. Hand calls: kanso-tabs/main.js went from 9 to 0, but ui-tab.js stays at 7 and ui-stack.js rose from 26 to 30 (each painted from the CSS). The plan says each touched file must go down.
5. #331 lists "Depends on #330" (the pane header), which is still open.
6. The Storybook MCP preview and test-run were not run: 6006 serves sb-dev (develop), not this branch.
7. Behaviour that follows the Storybook and changed: a door no longer widens to show its name (the name is in the tooltip); the chosen tab no longer glides; the doors hide when the computer is unreachable.
8. Playwright's headless shell 1254 was installed in ~/Library/Caches/ms-playwright for the shot and check scripts, after `npm ci`.
