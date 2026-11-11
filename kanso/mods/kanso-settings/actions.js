// A family is one Keys-page row for nine actions that differ by a digit, shown and rebound as one chord with N in its place.
export const GROUPS = [
  // bar: drawn as the tab bar itself (main.js `barKeys`).
  { name: "Panels", section: "layout:kanso", bar: true, actions: [
    { family: "kanso-tabs.panel-", label: "Open or close a panel" },
    { action: "kanso-tabs.sim", label: "Simulator" },
    { action: "kanso-tabs.settings", label: "kansō settings" },
  ] },
  { name: "Sidebar", section: "layout:kanso", actions: [
    { action: "kanso-spaces.view-spaces", label: "Projects" },
    { action: "kanso-spaces.view-agents", label: "Status" },
    { action: "kanso-spaces.view-threads", label: "Threads" },
  ] },
  { name: "Panes", section: "layout:kanso", actions: [
    { action: "kanso-strip.new-left", label: "New pane to the left" },
    { action: "kanso-spaces.needs-you.next", label: "Next agent that needs you" },
    { action: "kanso-strip.send", label: "Send the pane's work to an agent" },
    { action: "kanso-strip.pin", label: "Pin the pane to its side" },
    { action: "kanso-strip.arrange", label: "Arrangements" },
  ] },
  { name: "Vim keys", section: "layout:kanso", actions: [
    { action: "kanso-strip.vim-left", label: "Pane to the left, or the sidebar's list" },
    { action: "kanso-strip.vim-down", label: "Pane below" },
    { action: "kanso-strip.vim-up", label: "Pane above" },
    { action: "kanso-strip.vim-right", label: "Pane to the right" },
    { action: "kanso-strip.vim-move-left", label: "Move the pane left" },
    { action: "kanso-strip.vim-move-down", label: "Move the pane down" },
    { action: "kanso-strip.vim-move-up", label: "Move the pane up" },
    { action: "kanso-strip.vim-move-right", label: "Move the pane right" },
  ] },
  { name: "Moving along the strip", section: "layout:kanso", actions: [
    { family: "kanso-strip.col-", label: "Go to a column" },
    { action: "kanso-strip.first", label: "First column" },
    { action: "kanso-strip.last", label: "Last column" },
    { action: "kanso-strip.center", label: "Bring the pane into view" },
    { action: "kanso-strip.scroll-left", label: "Slide left" },
    { action: "kanso-strip.scroll-right", label: "Slide right" },
    { action: "kanso-strip.fewer", label: "Fewer panes in view" },
    { action: "kanso-strip.more", label: "More panes in view" },
    { action: "kanso-strip.fit", label: "Even the columns out" },
  ] },
  { name: "Spend, while its panel has the keyboard", section: "mod:kanso-spend", actions: [
    { action: "kanso-spend.refresh", label: "Read again" },
    { action: "kanso-spend.settings", label: "Spend's settings" },
    { action: "kanso-spend.back", label: "Back" },
  ] },
  { name: "Memory, while its panel has the keyboard", section: "mod:kanso-guard", actions: [
    { action: "kanso-guard.refresh", label: "Check now" },
    { action: "kanso-guard.back", label: "Show fewer" },
  ] },
];

// Herdr's own commands, on Herdr's keys; the Keys page leaves them out.
export const HERDRS = /^(kanso-strip\.(new-right|new-down|close|go-(left|right|up|down)|move-(left|right|up|down)|width|find)|kanso-spaces\.(space-\d|sidebar)|mod\.open:kanso-help|terminal\.search)$/;

export const ofRow = (row, action) => (row.family ? new RegExp(`^${row.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[1-9]$`).test(action) : action === row.action);

export function familyChords(chord) {
  if (!/[1-9]$/.test(chord)) return null;
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => chord.replace(/[1-9]$/, String(n)));
}

// The layout's own key wins over a global one, so a global clash is a note and a layout clash a change.
export function conflictsOf(all, chord, action) {
  return all.filter((k) => k.keys === chord && k.action !== action && k.action !== "terminal");
}

export function rebound(doc, section, { drop = [], set = {}, replaceAction = null }) {
  const out = JSON.parse(JSON.stringify(doc));
  const gone = new Set([...drop, ...Object.keys(set)]);
  const kept = Object.entries(out[section] ?? {}).filter(([k, v]) => !gone.has(k) && !(replaceAction && v === replaceAction));
  return { ...out, [section]: Object.fromEntries([...kept, ...Object.entries(set)]) };
}
