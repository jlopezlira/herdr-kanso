// Design guidelines per page: principle, rule, detail; extra sections: title, text.

export const guidelines = {
  "Tokens/Colour": [
    ["Seijaku", "Use a token, never a value.", "Every colour in a board or a mod is one of the tokens in the table. A new colour is added to the table, with its use and its rule, before anything uses it."],
    ["Fukinsei", "Three text levels:", "fg, muted and dim, told apart by size and place first and tone second."],
    ["Kokō", "One colour, one meaning.", "A state colour appears only on the thing in that state. Colour on anything that asks nothing is a defect."],
    ["Shizen", "Washes come from the foreground:", "track 4%, hover 7%, selected 12%, active project 14%; light 5, 9.5, 18 and 21%, so the steps read the same. Neither reaches pure white or black."],
  ],
  "Tokens/Contrast, light and dark": [
    ["Shizen", "Text passes 4.5:1", "on every surface it can sit on, including hover and selected. Marks, focus rings and control edges pass 3:1. Never lower contrast with opacity on text."],
    ["Seijaku", "Light and dark are one design.", "They share the same geometry and the same token names; only the values differ."],
    ["Seijaku", "Checking a change.", "Any change to a token is measured against every surface in the table, hover and selected included, before it is published."],
  ],
  "Tokens/Type": [
    ["Fukinsei", "Hierarchy.", "Six roles, each with one size, weight and tone. Display 48 regular, the one number. Title 20 strong. Section 15 strong. Group 13.5 strong. Name 13.5 medium. Body 12.5 regular, with controls at 12.5 medium. Meta 11.5 regular in muted or dim. Badge counts and table headings go one step down, micro 11. Size and weight tell the level; colour comes last."],
    ["Fukinsei", "Dim is the floor:", "foreground, muted, dim; dim passes 3:1 on its ground."],
    ["Seijaku", "One line never wraps.", "A one-line text ends in an ellipsis when it does not fit. Never a cut, never a second line."],
  ],
  "Tokens/Spacing": [
    ["Seijaku", "Space.", "Use the 4-based scale only: 2, 4, 8, 12, 16, 24, 32. The same relation always gets the same gap. Icon to label is 8. Control to control is 8. Rows touch. Groups and fields are 12 apart. Panel padding is 16. Nothing is glued and nothing floats."],
  ],
  "Tokens/Radius": [
    ["Seijaku", "Radius.", "Use the scale only: 2, 4, 6, 8, 12 and full. Chart bars, minimap tiles, heatmap cells and progress ticks 2. Key hints and skeletons 4. Buttons, rows and fields 6. Cards, menus, panels and dialogs 8. Windows and frames 12. Pills and switches full. The same piece always gets the same radius."],
    ["Shizen", "Content keeps its own corner.", "A device's frame follows the device, so its radius is not from the scale."],
  ],
  "Tokens/Motion": [
    ["Shizen", "Motion.", "Only three things move. The ensō spins at 900 ms. A working name shimmers with three glints over 2200 ms, with no dots. A blocked pane's bar breathes. Nothing changes size or place. Reduced motion holds everything still."],
    ["Shizen", "Live states.", "Hover moves only tone, entering in 120 ms and leaving in 80 ms. Hover never reaches a disabled control and never replaces a state."],
    ["Kansō", "Armed.", "Only an action that cannot be undone asks twice. It fills with accent and reads \"Press again to <verb>\" for 4 s. Both labels share one cell, so nothing moves."],
  ],
  "Tokens/Components": [
    ["Seijaku", "One component, one group.", "A size that only one component uses lives in that component's group, never in the global scale. A size two components share is a global token."],
  ],
  "Tokens/Icons": [
    ["Kokō", "Icons.", "Use exact Lucide icons, one name per meaning, at 12, 14, 15 or 17. Show an icon only where it tells something apart. The ensō marks and program marks are marks, not icons."],
    ["Seijaku", "Lucide, unchanged.", "Every icon is Lucide 1.72.0, the icon's own markup: 24 grid, stroke 2, round caps and joins. Ids are lu- and the Lucide name."],
    ["Seijaku", "One name per meaning", "across every board: one close (lu-x), one more (lu-ellipsis), one pin, one sync, one share, one layers, one terminal. A plain shell is lu-terminal."],
    ["Kokō", "Marks are not icons:", "the ensō marks and spinner, the blocked mark, the Claude Code and Codex marks, Hachi's pixel art, the Dawn artwork, the kansō wordmark, the macOS window lights."],
    ["Kokō", "No icon, a word.", "Android has no Lucide icon, so its button says \"Android\". iOS uses lu-apple, as the app does."],
  ],
  "Primitives/Button": [
    ["Kansō", "One solid action.", "Solid for the one main action, tonal for supporting ones, quiet or icon on a row. In a dialog, Cancel is quiet and the solid action comes last; in a panel, the solid action comes first. The first fix of a failure is solid, the rest tonal."],
    ["Seijaku", "Two sizes.", "md: 30 high, radius 6, body size, weight 500, padding 12. sm: 24 high, meta size, padding 8, on a row, a toast or a header. A program button carries its mark at 14."],
    ["Seijaku", "Icon sizes.", "An icon button is sm 20 with icon 12 on a row, md 26 with 15 in the tab bar and pane tools, lg 32 with 17 in the sidebar tools."],
    ["Shizen", "Live states.", "Hover w7, selected and pressed w12, never on a disabled control. Off is w4 with dim text. One focus ring: 2 px accent outside."],
    ["Kansō", "Armed.", "Only an irreversible action asks twice: same box, filled with accent, \"Press again to …\" for 4 s."],
  ],
  "Primitives/Chip": [
    ["Kansō", "Only a fact not said elsewhere.", "A count or a short fact the row does not already say."],
    ["Seijaku", "One look.", "24 high, radius 6, on w7, meta size."],
  ],
  "Primitives/Code": [
    ["Seijaku", "Exact characters.", "Monospaced, line numbers in dim. Keywords violet, strings done, numbers working."],
    ["Kokō", "A diff marks only change.", "Added lines on done at 13%, deleted on blocked at 13%, hunks dim on w4."],
    ["Kansō", "A snippet quotes three lines.", "The line a comment talks about sits on w7."],
    ["Kokō", "A log keeps the tool's words.", "Output stays in order and unchanged; only failure lines turn blocked."],
  ],
  "Primitives/Dialog": [
    ["Seijaku", "One shell for every dialog.", "Popover, radius 8, padding 24 on all four sides, 480 wide (popups 340). No fixed height: it ends 24 under its last line."],
    ["Seijaku", "The title names the thing.", "15 semibold: Rename checkout, not \"Rename terminal\". An optional scope line, 11.5 dim, that is a fact. No paragraph, no label over a lone field."],
    ["Yūgen", "Footer right-aligned.", "At most one solid primary and quiet links. Esc and a click outside close."],
    ["Kansō", "Colour only on focus.", "A focused field wears the kit's focus ring, the only colour a dialog adds. An emptied field shows what it falls back to as its placeholder."],
    ["Shizen", "Content loading is a skeleton in place.", "Each piece is drawn as its own skeleton, in the same place and size; nothing moves when the content arrives. When the content is too dynamic to draw piece by piece, the whole component is one skeleton."],
    ["Shizen", "A request is the button's state.", "Pressing the action shows its own loading; failure is the source's words in blocked under the field."],
  ],
  "Primitives/Drag handle": [
    ["Kansō", "Only where a pane can move.", "lu-grip-vertical at 14 in an 18 wide zone, on a strip pane that is not pinned."],
    ["Shizen", "Tone only.", "Dim at rest; foreground under the pointer and while held. The tooltip says what holding does."],
  ],
  "Primitives/Field": [
    ["Seijaku", "One field.", "Input edge, canvas ground, radius 6, 30 minimum height. Multiline is two rows tall and grows with its text."],
    ["Kansō", "One ring.", "Focus is the kit's ring, 2 px accent outside. Hover moves the edge to muted. Disabled is off."],
    ["Kokō", "Failure is the edge.", "An invalid value turns the edge blocked; the reason is one line under the field, in the tool's words."],
    ["Kansō", "One action inside.", "At most one icon button at the end, such as send. An empty field shows its placeholder in dim. Enter submits a single line; multiline takes new lines. Every field caps its text: 80 characters unless its use needs another limit."],
    ["Kansō", "Rename in place.", "Inline is 20 high, radius 4, no action, inside the line it renames: a tab, a pane header. One selection everywhere: accent at 30%."],
  ],
  "Primitives/Window controls": [
    ["Seijaku", "The system's lights.", "Three 12 circles, 8 apart, in the input colour. The system draws them; kansō keeps their place free."],
  ],
  "Primitives/Dawn": [
    ["Shizen", "One sky.", "The same colours in dark and light. The sun rises once on load; reduced motion shows the last frame."],
  ],
  "Compositions/Toolbar": [
    ["Kansō", "Icon buttons only.", "Large icon buttons, 4 apart: + alone on the left, then Sort, Search and Hide sidebar on the right. + says what it adds: Add project on Projects, New conversation on Status and Threads."],
    ["Seijaku", "Sort says when it is not the default.", "At its default order Sort is dim; any other order draws it like the other tools. A click opens its menu under it: the view's orders with the current one ticked, then what the sidebar shows."],
    ["Kansō", "Collapsed, the bar contracts.", "It is not the row turned on its side: + and Show sidebar stay, 8 apart, and Sort and Search fold under a caret. Open, they stack below it on a quiet wash; the caret turns up."],
  ],
  "Compositions/Header": [
    ["Seijaku", "Lights, then tools.", "Window controls in 48, the toolbar in 40. Collapsed, the header is the rail's width and the toolbar stacks."],
    ["Shizen", "Dawn sits behind.", "In Dawn Mode the sky fills the top behind the lights and the tools stay on top."],
  ],
  "Compositions/Sidebar/Session row": [
    ["Kansō","A Row at depth one, or two under its parent.","Program icon, the name glinting while it works, the activity as the second line, its age as meta, the mark last."],
    ["Kokō","The mark closes the row.","The pin and the command count sit before the mark; under the pointer, pin and ⋯ take the age’s place."],
  ],
  "Compositions/Sidebar/Project row": [
    ["Kansō","A heading Row; git only here.","Folder, branch and ↑↓ follow the name in dim; folded, how many and the most urgent mark close the row."],
  ],
  "Compositions/Sidebar/Computer row": [
    ["Kansō","A heading Row with one button for what is wrong.","Off shows power, unreachable shows Refresh; connected, its tools show under the pointer only."],
  ],
  "Compositions/Sidebar/Asleep": [
    ["Kansō", "A heading Row with the moon.", "Folded, how many sleep; open, each one dimmed at depth one with Wake."],
  ],
  "Compositions/Sidebar/Section": [
    ["Kokō", "A heading Row over its rows.", "Its mark when it has one, how many when folded."],
  ],
  "Compositions/Sidebar/View switch": [
    ["Kansō", "Tab open, one button collapsed.", "Open, the three views on a track; collapsed, the current view’s icon opens a Menu of all three."],
  ],
  "Compositions/Sidebar/Tile": [
    ["Kansō", "A group in the rail.", "An Avatar with the project’s initial, or the state’s Mark, and a quiet Chip with how many."],
  ],
  "Compositions/Sidebar/Footer": [
    ["Kokō", "Rows with an icon.", "An update when there is one, then Settings. Add computer lives in + on Status and Threads and in a computer's menu: the footer configures, it does not create."],
  ],
  "Compositions/Sidebar": [
    ["Kansō","Built from the pieces above.","Header, View switch, the rows of the chosen view and Footer. Collapsed, the rail keeps every tool, one view button with its menu and each group as a Tile."],
  ],
  "Compositions/Status bar/Item": [
    ["Kansō", "A Mark or an icon with its words.", "Icons and marks 14, 8 to their words, text 11.5 muted; the colour of a state only on an item in that state."],
    ["Kokō", "Shown only while it says something.", "Memory while low; servers, containers and reviews with how many need a look, while their panel is closed. Never a colour alone."],
    ["Kansō", "A notice you can act on.", "Servers, containers and reviews each open the bar's Menu: what they hold, their actions, the act that ends it, then Open and Hide this."],
  ],
  "Compositions/Status bar/Computer item": [
    ["Kansō", "Only while its sidebar row is out of sight.", "Its name with its icon; folded, the icon alone. No branch on the status bar."],
    ["Kokō", "Unreachable says so, with Refresh.", "Also only while its row is out of sight: the row already says it. A click reconnects; pending draws at 80% with a breathing dot."],
  ],
  "Compositions/Status bar/Needs you item": [
    ["Kokō", "A stand-in for the waiting row.", "Only while that row is out of view: mark, name, question and +1 for the others out of view, in the same words and cut as the row. A click is ⌘J; hover lights its pane on the edge."],
    ["Kansō", "The name and +1 never fold.", "The question gives way first when the bar narrows."],
  ],
  "Compositions/Status bar": [
    ["Seijaku", "Two halves around panes per view.", "26 tall, 12 inside, 16 between items. Panes per view keeps the fixed 180 slot; each half folds within its own width. Layout paused takes the slot while the strip is stopped."],
    ["Kansō", "A stand-in, never a second copy.", "No working count: the rows and tiles say it. The palette is an icon Button, its key in the tooltip: keys live in tooltips and menus."],
    ["Kansō", "At rest, panes per view and the palette.", "The number of panes per view, its − and + on hover; the palette door. Each other fact shows only while its own home is out of view. No minimap: the edges say what is past each side."],
    ["Shizen", "Nothing jumps.", "An item fades in over the hover timing; its neighbours keep their places in their own half."],
    ["Kokō", "Panes per view without the buttons.", "The wheel over the number changes it, a click evens out; the tooltip says both."],
    ["Fukinsei", "Fold order, right half.", "Memory to \"8% free\", then servers, containers and reviews give way, then the question. Left: the computer becomes its icon."],
  ],
  "Compositions/Dawn Mode": [
    ["Kokō", "Two modes, named everywhere.", "Stable Mode and Dawn Mode. Dawn Mode gets builds first; Stable Mode shows nothing."],
    ["Kokō", "The pill always says it.", "In the open header, a Chip saying Dawn Mode at the right of the title row, always the night of the sky with light words, in dark and light; it cannot be hidden. The Dawn sky behind the lights is on by default and can be turned off. Collapsed, the rail is too narrow for the pill; the sky stays."],
    ["Shizen", "The sun rises once.", "When the window opens in Dawn Mode or on switching to it, 2.6 s, then still. Reduced motion shows the last frame. Every copy plays together."],
    ["Kokō", "One press switches.", "Settings · Updates: Stable Mode or Dawn Mode as Tabs on a track. Dawn Mode says it can break, with Star on GitHub; the Dawn sky switch follows."],
  ],
  "Compositions/Notifications": [
    ["Kansō", "A fact, its state, its home.", "A notice is built from three things only: the state (waits, done, failed, fact), the home a click goes to, and one sentence that names who or what it is about. No notice is drawn case by case."],
    ["Kansō", "Where you are decides.", "Home in view: nothing is sent, the home says it. A kansō window on screen: a Toast. No kansō window: the computer's own notification, which kansō does not draw; it gets the sentence as its title and the detail as its text."],
    ["Seijaku", "The lead says where and how.", "The home's icon in the state's colour; an agent, which has no icon, leads with its mark; a failure always leads with the blocked mark, as everywhere."],
    ["Kokō", "One word, only for a different act.", "A click goes to the home. A word shows only when the act differs (Undo, Update, Refresh); a failure always has its fix. The detail, the tool's words or the context, is the toast's tooltip."],
    ["Shizen", "Up to three.", "The newest at the bottom; a fourth makes the oldest leave."],
  ],
  "Compositions/Pane header": [
    ["Kansō", "One look per state.", "Focus is the selected ground. Waiting is the blocked wash and the blocked mark. Working and done are their marks. Pinned is a pin after the name. A computer out of reach is the header at 55%, with no mark."],
    ["Seijaku", "What it is, then what changed.", "The program, the name, the folder and branch only when they differ from the tab's project, the files with their lines, the commits not on GitHub, the pull request with its verdict word in its colour. Each opens its home."],
    ["Kokō", "Four tools under the pointer.", "Split right, wider or narrower, close and ⋯. Close asks twice when an agent is in the pane. A focused agent that finished or idles keeps Sleep and Send out. The rest is in ⋯, with the piece lines."],
    ["Shizen", "The header is the handle.", "Drag it to move the pane; a click focuses it; double-click renames it in place. GitHub not answering is the failure line in place of the pull request."],
    ["Kansō", "A terminal is a pane too.", "A pane with no agent shows the terminal icon and its command, or Terminal when it has no project, with no digest. Focus moved by the keyboard adds the accent ring around the header."],
    ["Kansō", "Narrow, it folds in order.", "Folder, branch, the tools into ⋯ (close stays), commits, files, the verdict word, the pull request, then close; the name truncates last. The program and the mark never fold; a folded fact stays in the pull request's tooltip."],
  ],
  "Compositions/Panel": [
    ["Kansō", "Only the container.", "A width, the stale state, the header it is given and the body. It adds nothing of its own: each panel brings its header and its tools."],
    ["Fukinsei", "The period, then the number.", "The segmented control with a two-button stepper at its right; a past period adds Now. Under 340 the stepper moves to the number's line."],
    ["Kansō", "A section says one fact.", "Its title, then at its right one dim fact or one quiet link, such as Clean up 1. Never a count of the rows below. More rows wait behind a quiet Show 4 more."],
    ["Shizen", "One row for every list.", "The name truncates, the value sits at the right, the second line is dim, a mark goes first. Selected shows its actions: at most one primary, the rest quiet, a removal arms."],
    ["Yūgen", "Every read has a state.", "First read: the skeleton shaped like the rows. Empty: one line. Failed: the tool's words with Refresh. Stale: when it was read takes the second line's place, everything but the header steps down to 55% and takes no clicks."],
  ],
  "Compositions/Panel/Header": [
    ["Kansō", "Only the title is required.", "Before it, ‹ when the panel opened it from a row, or the mark of what it looks at. Under it, the second line only when it says something. After it, only the tools this panel has."],
    ["Seijaku", "Two forms, two jobs.", "Page heads a dashboard: title 20, 15 under 340, no rule. Bar heads a file or a tool: the name at 13.5 over a rule, flush with the panel's edges."],
    ["Kokō", "Tools by need.", "Refresh where the panel reads, last but Close, its tooltip says when it was read, turning while it reads. Share where there is something to share. Close only where the panel closes itself."],
  ],
  "Compositions/Keyboard": [
    ["Kansō", "One layer at a time.", "The map shows the keys of the held modifiers. Holding or clicking a modifier picks the layer; pressing a key picks it. Lists, in the picked key, opens the layer of every list and menu."],
    ["Seijaku", "Built from the kit.", "Rows of Keys on the canvas ground, the Picked key beside them. A key is a row tall; a wider key spans its units and the gaps between them."],
    ["Shizen", "Built for the computer in use.", "The composition draws the keyboard of the computer it is given: its rows, its key names and how it writes a chord. The meanings are the app's own words."],
    ["Seijaku", "Each computer its own keyboard.", "Mac: glyphs, ⌥⌘H, the ⌥⌘ layer first. Windows: a PC keyboard, Ctrl Win Alt, chords as Alt+L, the Alt layer first, from its own keys file. Linux: the PC keyboard and Super."],
  ],
  "Compositions/Keyboard/Key": [
    ["Kansō", "Shown by what it does here.", "Free: faint. Herdr's key: quieter. kansō's key: ink. A held modifier: outlined. The picked key: solid."],
    ["Shizen", "Hover outlines it in the accent.", "Click picks it; on a modifier, click holds or lets go."],
  ],
  "Compositions/Keyboard/Shortcut row": [
    ["Kansō", "What it does, then its keys.", "A Row with the action's words and a Key hint per chord; a family is one row (⌃⇧1–9), a pair shares one. A row with no key shows No key, faint."],
    ["Kokō", "Change on the row.", "A click captures: the hint breathes in the accent and the row says Esc keeps · ⌫ removes. Nothing else moves."],
    ["Kokō", "A taken chord asks twice.", "The second line says which action has it; Take it is Armed for 4 s, Esc keeps yours."],
    ["Shizen", "Reset only when changed.", "A changed row shows Reset beside its keys. A refused write shows the failure pattern under the row: Change, then Explain."],
  ],
  "Compositions/Keyboard/Picked key": [
    ["Kansō", "The chord, then what it does.", "20 for the chord, 12.5 for its meaning; a free key says Nothing, muted. The layer line under it: the modifiers and their count, Herdr's key, or the list keys."],
    ["Kokō", "One act.", "kansō's key: Change. Herdr's key: Herdr settings. A free key: Give it an action. The list keys are fixed and have none."],
  ],
  "Compositions/Activity": [
    ["Kansō", "Only what nothing in view says.", "A merge, an approval, a red check out of view, an agent that slept or could not, an agent whose pane is gone with its last words as the second line. Nothing new takes no space."],
    ["Seijaku", "Docked at the foot of the list.", "A raised card 12 above the footer; no row moves when it comes or goes."],
    ["Kansō", "Built from the kit.", "The title is a heading Row with × to dismiss all; each event is a Row: its icon in the state colour, the subject, the fact muted, a detail as the second line, the age. Four rows, then +N more."],
    ["Kokō", "A click opens the thing and drops the row.", "× dismisses all. Right-click: Dismiss these, then the piece lines; Hide this is the sidebar's While you were away switch."],
  ],
  "Compositions/State patterns": [
    ["Kansō", "One drawing per state, in the same words at every size.", "Failure, empty, pending and loading are each one composition of the kit, used by every surface; a surface never draws its own."],
    ["Kokō", "Failure says what, then the fix.", "Bars (status bar, pane header): mark, our words, the fix as a small quiet Button. Panel: the block where the list would start, the source's words in mono under ours, the fix solid, then Explain to the agent, named. Sidebar: the fix on the row; the source's words, the other fixes and Explain in its right-click Menu. Toast: mark, our words, the fix at the end; no Explain."],
    ["Seijaku", "Blocked colour only on the edge and the mark.", "Our words stay foreground, the source's words muted."],
    ["Kansō", "Empty is one sentence.", "Centred: the view's icon dim, one sentence muted, at most one tonal Button."],
    ["Shizen", "Pending draws the new state at once.", "At 80% with one breathing dot. Confirmed, both go; refused, the old state returns with the failure."],
    ["Shizen", "Loading keeps the shape.", "The skeleton of the rows that will come, breathing; it never takes the place of a failure."],
  ],
  "Compositions/Tab bar": [
    ["Kansō", "Built from the kit.", "The tabs are the Tab primitive; new tab, Arrange, +N and the panel doors are icon Buttons; +N opens a Menu. Nothing is drawn twice."],
    ["Kokō", "A mark only for Needs you.", "A tab out of view whose session waits carries the blocked mark; it leaves when the tab is chosen. No mark for working or finished: the rows and the pane headers say it."],
    ["Seijaku", "48 tall, nothing filled at rest.", "Tabs 2 apart, 8 to new tab and Arrange; doors 2 apart, the last 12 from the edge. The open door and the chosen tab take the quiet fill."],
    ["Shizen", "Nothing disappears.", "Tabs that do not fit fold behind +N; new tab, Arrange and the doors never fold. A door whose tool is missing on the computer is not drawn."],
  ],
  "Compositions/Edges": [
    ["Kansō", "A stand-in for the panes out of view.", "One icon Button per pane past each side, at the side where it is; the panes of one column grouped. A click goes there; the name is the tooltip."],
    ["Kokō", "No state dots.", "A waiting pane is said by the status bar's Needs you; the edge only says where: hovering Needs you gives its pane the active fill, or +N when it is folded."],
    ["Shizen", "At most four columns.", "The farthest fold behind +N, a Menu with their icons and names; a click goes there."],
    ["Kokō", "The wheel slides the view.", "Turned over either edge, it moves the strip a column at a time, as the minimap did."],
    ["Shizen", "A drop target while dragging.", "A pane dragged over an edge washes it in accent 25%."],
  ],
  "Primitives/Key hint": [
    ["Seijaku", "One key look.", "24 high, radius 4, mono 11.5, border edge. Symbols, not words: ⌘ ⌃ ⌥ ⇧ ↵; Esc stays a word. At most 6 characters."],
    ["Kansō", "Beside its action only.", "A key hint sits next to the action it triggers or in its tooltip, never alone."],
    ["Shizen", "Recording breathes.", "While a new shortcut is being pressed, the edge and the text turn accent and breathe."],
  ],
  "Primitives/Mark": [
    ["Kokō", "One mark per state.", "Working spins in working, blocked in blocked, done in done, idle in idle at 70%, asleep is the moon in muted. One mark per item, beside it."],
    ["Seijaku", "One size per place.", "The icon scale: sm 12 inside a line or a count, md 14 on a row, lg 15 in an activity line."],
    ["Shizen", "Only working moves.", "The working ensō spins at 900 ms; reduced motion holds it still."],
  ],
  "Primitives/Markdown": [
    ["Seijaku", "Reads like the window.", "Headings 20 and 15, body 13.5, code 11.5 on w7, tables 12.5 with border rows."],
    ["Yūgen", "One click edits in place.", "The block under the pointer takes the hover wash; a click gives it the raised slab and the kit's focus ring. A click on a link still follows it."],
    ["Shizen", "Save follows code.", "⌘S or the button, never on its own. Esc closes any block."],
  ],
  "Primitives/Menu": [
    ["Seijaku", "One menu.", "252 wide, radius 8, popover ground. Items 30 with icon 14, the key hint dim at the right, the heading dim, a rule between groups."],
    ["Kansō", "Only actions for the item in focus.", "Every right-click, + and panel menu is this menu with its own items; none draws its own."],
    ["Kansō", "Armed for what cannot be undone.", "The item fills with accent and reads \"Press again to …\" for 4 s."],
  ],
  "Primitives/Metric": [
    ["Fukinsei", "The one number.", "One per panel, display 48 regular, its unit in meta dim beside it on the baseline."],
    ["Kansō", "Facts follow, quiet.", "Supporting facts sit on one dim line under it; none repeats the number."],
  ],
  "Primitives/Switch": [
    ["Seijaku", "One switch.", "Off is raised with the input edge, on is solid; only the knob moves."],
    ["Kansō", "Disabled is quiet.", "The 4% wash and a dim knob. The label is spoken, not shown inside."],
  ],
  "Primitives/Row": [
    ["Seijaku", "One row.", "32 high, icon 14, name, an optional dim tail, the meta and the state mark at the right. Rows touch."],
    ["Kansō", "Two lines only while there is something to say.", "The second line is meta and ends in an ellipsis."],
    ["Shizen", "State is tone.", "Hover w7, current the selected fill, selected the shared accent ring, dimmed muted; a pending row is at 80% with the breathing dot until it is written."],
    ["Kokō", "Depth and headings, not new rows.", "A heading is the name in strong; depth one and two indent by an icon, two with a w12 guide. Tools show on hover or focus and take the meta’s place; one button for what is wrong stays."],
    ["Kokō", "Every list uses this row.", "Files, ports, sessions, projects, computers and pick lists are this row with their own lead and meta."],
  ],
  "Primitives/Skeleton": [
    ["Shizen", "The shape of what comes.", "Bars in border with one soft light, in the place and size of the content: a row with its icon, a list row with its meta, a line, the panel header."],
    ["Seijaku", "Fixed widths.", "Lines cycle 120, 96, 140, 84, 110, 72 and are 9 high; an icon is 14 with radius 4."],
    ["Kansō", "In place or whole.", "A piece with a fixed shape becomes its own skeleton where it stands; content too dynamic to draw is one skeleton for the whole component."],
  ],
  "Primitives/Tab": [
    ["Kokō", "One tab for every choice among a few.", "Window tabs, periods, views and settings are this tab. A setting with two or three values is tabs, not a switch."],
    ["Seijaku", "Three sizes.", "sm 24 inside a row or a card, md 26 in a bar, lg 30 in a panel or a dialog. Body size, icon 14, radius 6."],
    ["Shizen", "Selection is a tone, never a weight,", "so nothing moves: the chosen tab is a quiet fill, w7, raised on a track; no ring, no border. Hover w4 with foreground text. On a track (w4 behind the group) the tabs share its width."],
    ["Kokō", "A mark only when it asks.", "Working, blocked or done after the label; a dot marks an unchosen tab that needs you."],
    ["Kansō", "Close only where it acts.", "The × shows on the chosen tab when it can close; a tab holding an agent arms for 4 s."],
    ["Kansō", "Icon, label or both.", "Without a label each tab is a square the size of its height, the label its tooltip, and marks give way to the one dot. Compositions build on this: the rail's column of views is icon tabs."],
  ],
  "Primitives/Thumbnail": [
    ["Seijaku", "One thumbnail.", "40 square, radius 4, border edge on raised; the picture is cropped to fill it. One per shot in a strip, 4 apart."],
    ["Shizen", "Selected is the shared state.", "The chosen thumbnail takes kanso-control--selected: the 2 px accent ring outside, the same as a focused field, a row or a menu item; nothing moves."],
    ["Kansō", "Nothing to show, nothing drawn.", "A picture that cannot load leaves the raised square; the name is its tooltip."],
  ],
  "Primitives/Toast": [
    ["Kansō", "Only what has no home on screen.", "A toast says a result whose row is not visible; when the row is on screen, the row says it instead."],
    ["Seijaku", "One toast.", "Popover ground, 40 high, radius 8: the mark, one line of text, then at most one small tonal fix. A body adds a second line in muted."],
    ["Kokō", "The level is the mark.", "Error is the blocked mark, success the check, warning a working dot, information an accent dot. Any icon can stand in for the mark; it takes the level's colour: blocked, done, working or accent."],
    ["Shizen", "It leaves on its own.", "5 s, or 8 s for an error or a warning; at most 3 on screen, and the same toast is never shown twice."],
    ["Kokō", "An error can be explained.", "Explain to <session> sends the source's words to that session."],
  ],
  "Primitives/Tooltip": [
    ["Kansō", "Only for what has no name.", "An icon without a label gets a tooltip that names it; a labelled control does not."],
    ["Seijaku", "One tooltip.", "Popover ground, radius 6, meta size, 8 from what it names with a caret pointing at it; the key and any detail follow in dim. It opens on the side with the most room, or the side the composition sets: top, bottom, left or right."],
    ["Shizen", "Hover and keyboard focus.", "It appears on hover or focus and leaves with them; it never holds the only copy of a fact."],
  ],
  "Primitives/Card": [
    ["Seijaku", "One identity.", "Avatar, author in medium, age in dim, then the body. Canvas background, radius 8, padding 12."],
    ["Shizen", "Loading is one skeleton.", "Its content changes too much to draw piece by piece, so the whole card is one skeleton in its place and size."],
  ],
  "Primitives/Avatar": [
    ["Kokō", "The initial is the avatar.", "A picture from a URL, local or external, is cropped to the circle. When it cannot load, the initial stays."],
    ["Seijaku", "Three sizes.", "sm inside a line of text, md by default, lg on a card or a header."],
  ],
};
const build = "Then run `npm run build:site-tokens`, `npm run build:ui-tokens` and `npm run build:stories`, and `npm run check:tokens` must pass.";
const adding = (what, rule) => [`Adding ${what}`, `The table is the only set. ${rule} Add it to \`kanso/tokens.json\` with its name, value and use before anything uses it. ${build}`];

export const sections = {
  "Tokens/Colour": [adding("a colour", "A new colour gets a value in both dark and light, passes 4.5:1 for text or 3:1 for edges and marks on every surface, and carries one meaning.")],
  "Tokens/Type": [adding("a type size", "A new size or weight takes one of the six roles; size and weight tell the level.")],
  "Tokens/Spacing": [adding("a space", "A new space or height stays on the 4-based scale, and the same relation always gets the same gap.")],
  "Tokens/Radius": [adding("a radius", "A new radius belongs to one kind of piece, and the same piece always gets the same radius.")],
  "Tokens/Motion": [adding("a motion", "Only three things move; a new motion replaces one of them or is not added. It changes tone, never size or place, and holds still with reduced motion.")],
  "Tokens/Icons": [
    ["Adding an icon", "This list is the only set. If you need another icon, take it from Lucide ([lucide.dev/icons](https://lucide.dev/icons), version 1.72.0, ISC license). Copy its markup unchanged, add it here with an **lu-** id and the meaning it carries, and only then use it. One name per meaning, never a custom icon."],
  ],
};
