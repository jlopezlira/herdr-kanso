const said = (words) => (typeof words === "function" ? words : () => words);
const action = (icon, words, key = null) => ({ icon, label: said(words), key });

export const ACTIONS = Object.freeze({
  open: action("chevron-right", "Open"),
  copy: action("copy", "Copy", "terminal.copy"),
  cut: action("scissors", "Cut"),
  paste: action("clipboard-paste", "Paste", "terminal.paste"),
  rename: action(null, "Rename…"),
  "new-tab": action("plus", "New tab", "tab.new"),
  "split-right": action("columns-2", "Split right", "kanso-strip.new-right"),
  "split-down": action("rows-2", "Split down", "kanso-strip.new-down"),
  "split-left": action("columns-2", "Split left", "kanso-strip.new-left"),
  width: action("move-horizontal", "Wider or narrower", "kanso-strip.width"),
  pin: action("pin", "Pin", "kanso-strip.pin"),
  unpin: action("pin", "Unpin", "kanso-strip.pin"),
  zoom: action("maximize-2", "Zoom", "pane.zoom"),
  unzoom: action("minimize-2", "Unzoom", "pane.zoom"),
  send: action("send", "Send to an agent…", "kanso-strip.send"),
  find: action("search", "Find in conversation", "kanso-strip.find"),
  "open-with": action("external-link", "Open with…", "mod.open:open-with"),
  "copy-path": action("copy", "Copy path"),
  "copy-branch": action("copy", "Copy branch name"),
  "copy-link": action("copy", "Copy link"),
  "open-pr": action("git-pull-request", "Open the pull request"),
  "open-github": action("external-link", "Open on GitHub"),
  "open-diff": action("file", "Open the diff"),
  push: action("git-pull-request", (n) => `Push ${n}…`),
  "pin-top": action("pin", "Pin to the top"),
  "unpin-top": action("pin", "Unpin"),
  "bring-back": action("undo", "Bring back"),
  settle: action("check", "Settle"),
  "mark-read": action(null, "Mark read"),
  "mark-unread": action(null, "Mark unread"),
  unsnooze: action("clock", "Wake"),
  snooze: action("clock", "Snooze"),
  "snooze-until": action(null, (preset) => preset),
  move: action(null, "Move to project"),
  "move-to": action(null, (project) => project),
  "move-back": action("undo", (place) => `Back to ${place}`),
  "copy-menu": action("copy", "Copy"),
  "copy-folder": action("folder", "Folder"),
  "copy-branch-row": action("git-branch", "Branch"),
  "copy-conversation": action("copy", "Conversation id"),
  wake: action("sun", "Wake"),
  "wake-tab": action("sun", (tab) => `Wake ${tab}`),
  "wake-all": action("undo", (n) => `Wake all ${n}`),
  "wake-all-in": action("sun", (n, tab) => `Wake all ${n} in ${tab}`),
  "copy-conversation-id": action("copy", "Copy conversation id"),
  "new-conversation": action(null, "New conversation…"),
  "new-worktree": action("git-branch", "New in a worktree…"),
  worktree: action("git-branch", (branch) => branch),
  "sleep-agent": action("moon", "Sleep this agent…"),
  "sleep-tab": action("moon", "Sleep this tab…"),
  "sleep-project": action("moon", "Sleep the project…"),
  "send-back": action("chevron-right", (parent) => `Send back to ${parent}`),
  "project-options": action(null, "Project options…"),
  "keep-project": action("pin", "Keep as a project"),
  locate: action("file", "Locate folder…"),
  "go-project": action("chevron-right", "Go to project"),
  connect: action("power", "Connect"),
  disconnect: action("power", "Disconnect"),
  sync: action("arrow-right-left", "Sync"),
  refresh: action("refresh-cw", "Refresh"),
  "sign-in": action("key", "Sign in…"),
  "new-project": action("plus", "New project"),
  "remove-computer": action("x", "Remove"),
  "add-computer": action("server", "Add computer…"),
  "away-dismiss": action(null, "Dismiss"),
  "away-off": action(null, "Switch off"),
  "right-clicks": action(null, "Right-clicks go to the program"),
  panels: action("panels-top-left", "Panels…"),
  forget: action("x", "Forget"),
  "everything-asleep": action("moon", "Everything asleep…"),
  "remove-project": action("x", "Remove project"),
  "close-agent": action("x", "Close agent"),
  "close-terminal": action("x", "Close terminal"),
  "close-tab": action("x", "Close tab", "tab.close"),
  "close-pane": action("x", "Close pane", "kanso-strip.close"),
});

export const ORDER = Object.freeze(Object.keys(ACTIONS));

export const inOrder = (keys) => [...keys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

export const wordsOf = (act, of = []) => ACTIONS[act].label(...of);

const plain = (label, does, look) => ({ ...look, label, onClick: does });

const itemOf = (line, make, hint) => {
  const { act, does, of = [], ...look } = line;
  const { icon, key } = ACTIONS[act];
  return make(wordsOf(act, of), does, { icon, hint: hint(key), ...look });
};

export const contextItems = (lines, { hint, make = plain }) => lines.filter(Boolean).map((line) => {
  if (line.act) return itemOf(line, make, hint);
  if (line.scroll) return { ...line, scroll: contextItems(line.scroll, { hint, make }) };
  return line;
});
