// Design guidelines per page: principle, rule, detail; extra sections: title, text; and Start page prompts.
import { ledgerPrompt } from "./ledger.js";

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
    ["Fukinsei", "Hierarchy.", "Six roles, each with one size, weight and tone. Display 48 regular, the one number. Title 20 strong. Section 15 strong. Group 13.5 strong. Name 13.5 medium. Body 12.5 regular, with controls at 12.5 medium. Meta 11.5 regular in muted or dim. Size and weight tell the level; colour comes last."],
    ["Fukinsei", "Dim is the floor:", "foreground, muted, dim; dim passes 3:1 on its ground."],
    ["Seijaku", "One line never wraps.", "A one-line text ends in an ellipsis when it does not fit. Never a cut, never a second line."],
  ],
  "Tokens/Spacing": [
    ["Seijaku", "Space.", "Use the 4-based scale only: 2, 4, 8, 12, 16, 24, 32. The same relation always gets the same gap. Icon to label is 8. Control to control is 8. Rows touch. Groups and fields are 12 apart. Panel padding is 16. Nothing is glued and nothing floats."],
  ],
  "Tokens/Radius": [
    ["Seijaku", "Radius.", "Use the scale only: 4, 6, 8, 12 and full. Key hints and skeletons 4. Buttons, rows and fields 6. Cards, menus, panels and dialogs 8. Windows and frames 12. Pills and switches full. The same piece always gets the same radius."],
    ["Shizen", "Content keeps its own corner.", "A device's frame follows the device, so its radius is not from the scale."],
  ],
  "Tokens/Motion": [
    ["Shizen", "Motion.", "Only three things move. The ensō spins at 900 ms. A working name shimmers with three glints over 2200 ms, with no dots. A blocked pane's bar breathes. Nothing changes size or place. Reduced motion holds everything still."],
    ["Shizen", "Live states.", "Hover moves only tone, entering in 120 ms and leaving in 80 ms. Hover never reaches a disabled control and never replaces a state."],
    ["Kansō", "Armed.", "Only an action that cannot be undone asks twice. It fills with accent and reads \"Press again to <verb>\" for 4 s. Both labels share one cell, so nothing moves."],
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
    ["Kansō", "Icon buttons only.", "Large icon buttons, 8 apart. In a row the first may stand alone on the left; in the rail they stack, 12 apart."],
    ["Kansō", "Nothing disappears.", "In the rail, the tools that do not fit fold under a caret. Open, they stack below it on a quiet wash; the caret turns up."],
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
    ["Kokō", "Rows with an icon.", "An update when there is one, then Settings and Add computer."],
  ],
  "Compositions/Sidebar": [
    ["Kansō","Built from the pieces above.","Header, View switch, the rows of the chosen view and Footer. Collapsed, the rail keeps every tool, one view button with its menu and each group as a Tile."],
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
export const prompts = { "Start/One fact, one home": ledgerPrompt };
