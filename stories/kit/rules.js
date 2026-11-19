// What a builder cannot read from a page's drawings or controls, one line each.
export const rules = {
  "Compositions/Activity": [
    "Events come from what kansō already reads; no read of its own.",
  ],
  "Compositions/Dawn Mode": [
    "The channel switch says It can break; one press switches.",
    "A release that breaks something says so first in What's new.",
  ],
  "Compositions/Keyboard": [
    "⇧⌘/ opens Keys in kansō settings.",
    "Change starts capture on its row; keys.json is written locally and Herdr applies it as it lands.",
  ],
  "Compositions/Notifications": [
    "A toast echoes a fact only while its home is out of sight.",
    "A failure toast uses the block's words; the tool's words go in its tooltip; no Explain.",
    "A computer that drops is said once, by its toast.",
    "Already a project and already has a worktree are said in the dialogs, never in toasts.",
    "One update checker, in kanso-tabs; the footer row only reads its state.",
  ],
  "Compositions/Pane header": [
    "On another computer the folder is shortened with that computer's home.",
    "The verdict word carries the colour; no dot beside it.",
    "The shimmer stays on battery too.",
  ],
  "Compositions/Panel": [
    "A panel whose tool is missing does not exist.",
    "Keys: j k gg G Enter Esc r; Enter runs the selected row's first action.",
    "Second lines and row actions appear on pointer, keyboard focus or selection.",
  ],
  "Compositions/Sidebar": [
    "Keys in the tooltip: ⌃⌥P, ⌃⌥S, ⌃⌥T; hidden, the views' keys still work.",
    "Sort orders: latest change, longest in its state, project.",
    "An ended snooze says Woke after the title.",
    "On hover a finished row shows Settle and ⋯; Pin, Snooze and Mark unread live in the menu.",
  ],
  "Compositions/Sidebar/Asleep": [
    "Sleep and Wake are one press; the row moves and breathes until it lands. Wake is the undo.",
    "A tab asleep in an awake project is one row named by the tab.",
  ],
  "Compositions/Sidebar/Computer row": [
    "Needs login offers Sign in, which opens a terminal running hc machine login.",
    "Turn on is one press; its projects breathe until hc answers; a refusal turns it back with a toast.",
    "Double-click renames; the alias is kept by kansō and carried by Sync.",
  ],
  "Compositions/Sidebar/Footer": [
    "Update is one press: Updating kansō until it lands; refused, the failure block with Update and Explain.",
    "Add computer lives in the + menu.",
  ],
  "Compositions/Sidebar/Project row": [
    "↑ shows only while no pane of that place is in view; ↓ always shows.",
    "↓ pulls on one press with git pull --ff-only; a refusal brings it back with a toast.",
    "A missing folder says Folder not found with Locate; the path and Explain in right-click.",
    "Git is read when a folder changes or a turn ends; hidden git runs nothing.",
    "Double-click renames; Enter keeps, Esc leaves.",
  ],
  "Compositions/Sidebar/Section": [
    "Needs you is hidden by default; the rows, the status bar, Status and ⌘J keep its job.",
    "Nobody waiting draws nothing.",
  ],
  "Compositions/Sidebar/Session row": [
    "Its right-click sets each second-line fact to Show, Only when needed or Hide.",
    "Blocked shows on the ensō, never in red.",
    "Folded, the parent shows a sub-session that needs you.",
  ],
  "Compositions/State patterns": [
    "Tools are probed at window start and when Settings opens, so a new tool brings its panel back.",
    "For a remote project Containers follows that computer; Simulator and Memory stay local.",
  ],
  "Compositions/Status bar": [
    "The working count shows only while a session works; a click opens Status.",
  ],
  "Compositions/Tab bar": [
    "A hidden panel comes back from Panels; hiding unmounts the panel and stops its reads.",
    "Default order: Files, Spend, PR, Shipped, Worktrees, Ports, Containers, Memory, Images, Simulator.",
    "Settings opens from the footer; ⇧⌘/ still opens Keys.",
  ],
  "Layouts/Context menus": [
    "Every piece answers a right-click; a hidden piece comes back from there or Settings · Pieces.",
    "Order: the thing's actions, the act that ends it, then the piece lines.",
    "Separators come from groups; rows that cannot act are not drawn.",
    "Keys: j k gg G Enter Esc; nothing is chosen until you move.",
  ],
  "Layouts/Practice": [
    "The best path appears only after a miss, with the hint the game computes after 2 s.",
    "Over the best, the live move count turns working.",
    "Esc once arms leaving for 3 s in Hachi's bubble; a round ended early is not counted.",
    "After 20 s with no round, Hachi sleeps.",
    "In light, Hachi's outline, eyes and nose take the art's own dark ink.",
  ],
  "Layouts/Sidebar": [
    "A row keeps its height and a name its width on hover, focus and state change.",
    "Find matches name, step, branch or folder, includes other computers, and Enter goes to the first match.",
    "Projects move within their computer only; the first session drop switches to Your order.",
    "A pane dropped over the sidebar returns where it was.",
    "Keys: j k or ↓ ↑, gg G, Enter or l, Esc back to the pane, / opens find.",
    "The keyboard walks computers, projects, sessions, sub-sessions and asleep rows in screen order.",
  ],
  "Layouts/Sidebar header": [
    "Sort away from its default stays foreground and its tooltip names the order.",
  ],
  "Layouts/Window": [
    "Selection is one wash shared by the active project, tab and focused pane header.",
  ],
  "Panels/Arrangements": [
    "A used name turns the primary into Overwrite, which takes a second press.",
    "Opening is pending on its row; remotely each pane starts on that computer.",
  ],
  "Panels/Containers": [
    "Down, Remove, Quit and bulk removals arm in accent; Quit says what it stops.",
    "A remote computer reads its own docker; without Docker there is no panel.",
  ],
  "Panels/Dojo": [
    "[ and ] move along the levels; p opens the pet chooser outside a round; no level is locked.",
    "A move starts a round, Enter plays again, n goes to the next level, Esc twice leaves.",
  ],
  "Panels/Files": [
    "Files the focused session named come first, newest first; a named file is not listed again.",
    "Hiding named files stops the transcript read.",
  ],
  "Panels/Find": [
    "One read on open, then one when the session stops or on Enter.",
  ],
  "Panels/Images": [
    "Send works with ⌘↩ while focused; a session that needs you gets no Send.",
    "A picture is read only when it changed and moves only on Load.",
  ],
  "Panels/Markdown": [
    "If telling md-review fails, the failure block shows with Done and Explain.",
  ],
  "Panels/Memory": [
    "When the only idle session is yours, there is no bulk link; its row keeps Recycle.",
    "Guard writes the guard's settings.json; a failed install prints the installer's words.",
    "No guard on the platform: no panel.",
  ],
  "Panels/Pins": [
    "A click drops a pin, a drag draws a region; Enter keeps the note, Backspace on an empty note removes it.",
    "To a session on another computer the frame is copied first.",
  ],
  "Panels/Ports": [
    "Stop arms in accent for 4 s; a stop that did not take says so in blocked and offers Force stop.",
    "The status bar's port with no pane opens here with that row selected and Stop focused.",
    "The focused project's computer decides what is read; unreachable keeps the last read dimmed with Stop disabled.",
    "Under 340 wide the command hides and Open in the browser becomes Open.",
    "Open and in front: one lsof and ps every 30 s; behind or closed, none; another computer, one remote read every 60 s.",
    "History stays closed at rest and is read once when it opens.",
  ],
  "Panels/PR": [
    "Lists open pull requests that concern you; a merge is an event in While you were away.",
    "Groups follow the sidebar's project order, the front pane's project first.",
    "Explain hands over a reason the app found; with no session it is absent, never disabled.",
    "Waits have no Explain: draft, checks running, checking whether it can merge.",
    "State comes from one gh pr view on open or Refresh; failed logs are read once and cached.",
    "GitHub is read and written locally; only Push and Pull run on the remote computer.",
    "Writes are optimistic; a refusal brings the text back with gh's words.",
    "At rest nothing polls; a write makes one re-read.",
  ],
  "Panels/Preview": [
    "Never Press again: ⌘S saves, ⌘Z undoes; what could lose text offers Undo after.",
    "With no edit open the file follows the disk.",
    "Changed on disk while edited: Overwrite or Reload, each with Undo until the next edit.",
    "A gone computer keeps the edit and saves it when the computer answers.",
  ],
  "Panels/Settings": [
    "Two settings, named by owner: kansō settings and Herdr settings; the footer menu is the one door.",
    "A switch acts at once, pending until the shared state is written.",
    "Switching channel arms.",
    "One read of the changelog and the tags on open or Refresh.",
  ],
  "Panels/Share": [
    "One menu from the header's share icon in Ports, Memory, Spend and the dōjō; its header is the privacy fact.",
    "The icon shows only when there is something to share.",
    "While the image is made its row says so and the others dim; the result is a toast.",
    "Nothing runs until chosen; then a local render, and the post opens in the browser.",
  ],
  "Panels/Shipped": [
    "One GitHub read per period on open or Refresh; line sums from git, then incremental; no poll.",
    "The share card is drawn as SVG to PNG.",
  ],
  "Panels/Simulator": [
    "iOS takes screenshots with xcrun simctl and has no touch; Android streams with touch and typing.",
    "Behind other windows the picture stops and resumes on return.",
    "The device frame radius follows the device, not the kit scale.",
  ],
  "Panels/Spend": [
    "Plans are detected from one field each, never a token; a plan that cannot be detected is added by hand.",
    "Each computer prices its own sessions; one account on two computers counts once.",
    "The multiple lives only here; the status bar shows the day's number.",
  ],
  "Panels/Worktrees": [
    "What Clean up takes is said once, when armed.",
    "Explain goes to the worktree's tab session, otherwise the front pane's.",
    "Every command runs on the focused project's computer; one scan per open or Refresh.",
  ],
  "Primitives/Dialog": [
    "Create stays disabled until there is a folder; the name follows the folder until typed.",
    "Pressed, the dialog closes and the row appears at once, pending.",
    "A refused write keeps the dialog with the failure block under the fields.",
    "Add computer runs hc machine add; the word is computer, never machine.",
    "A session that needs you is not offered as a target; unreachable rows are not targets.",
    "Sending is pending on the row; the dialog closes when hc confirms; refused, the draft stays.",
    "Editors are found locally once and cached; remotely the editor opens over its own SSH.",
  ],
};
