// Kanso's own keys, in words, for the Keys page: only what exists in Kanso
// alone. Splitting, closing, going to and moving panes, tabs and spaces are
// Herdr's commands with Herdr's keys, set in Herdr's general settings; where
// the strip has to do one of them its own way it keeps Herdr's key for it
// (HERDRS, never listed here). An action is the value keys.json binds
// ("kanso-strip.pin"); a family is one row for nine actions that differ by a
// digit ("kanso-strip.col-1" to "-9"), shown and rebound as one chord with N
// in the digit's place.
//
// `section`: the keys.json section the action lives in. Kanso's layout keys
// are in "layout:kanso"; Spend's and Memory's own, while their panel has the
// keyboard, in "mod:kanso-spend" and "mod:kanso-guard".
export const GROUPS = [
  // Drawn as the tab bar itself (main.js `barKeys`): each panel's icon with
  // its key by place, then the gear.
  { name: "Panels", section: "layout:kanso", bar: true, actions: [
    { family: "kanso-tabs.panel-", label: "Open or close a panel" },
    { action: "kanso-tabs.settings", label: "Kanso settings" },
  ] },
  { name: "Sidebar", section: "layout:kanso", actions: [
    { action: "kanso-spaces.view-spaces", label: "Projects" },
    { action: "kanso-spaces.view-agents", label: "Status" },
    { action: "kanso-spaces.view-threads", label: "Threads" },
  ] },
  { name: "Panes", section: "layout:kanso", actions: [
    { action: "kanso-strip.new-left", label: "New pane to the left" },
    { action: "kanso-strip.next-needs-you", label: "Next agent that needs you" },
    { action: "kanso-strip.send", label: "Send the pane's work to an agent" },
    { action: "kanso-strip.pin", label: "Pin the pane to its side" },
    { action: "kanso-strip.arrange", label: "Arrangements" },
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
    { action: "kanso-guard.back", label: "Back" },
  ] },
];

// Herdr's commands the strip does its own way, on Herdr's own keys (a split,
// closing, going to or swapping a pane, zoom as the column's width, a space
// that is there). Not Kanso's keys: the Keys page leaves them out.
export const HERDRS = /^(kanso-strip\.(new-right|new-down|close|go-(left|right|up|down)|move-(left|right)|width)|kanso-spaces\.space-\d)$/;

// Whether a bound action belongs to a row: its own, or one of a family's nine.
export const ofRow = (row, action) => (row.family ? new RegExp(`^${row.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[1-9]$`).test(action) : action === row.action);

// A family's chords as one pattern: "cmd-1" for "...col-1" reads "cmd-N".
export const familyPattern = (chord) => chord.replace(/[1-9]$/, "N");

// The nine chords a family gets from one pressed with a digit: the digit's
// place takes 1 to 9. Null when the chord has no digit to vary.
export function familyChords(chord) {
  if (!/[1-9]$/.test(chord)) return null;
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => chord.replace(/[1-9]$/, String(n)));
}

// Every binding that already uses `chord` for something else, in any
// section: what a new binding would take over (the layout's own key wins
// over a global one, so a global clash is a note, a layout clash a change).
export function conflictsOf(all, chord, action) {
  return all.filter((k) => k.keys === chord && k.action !== action && k.action !== "terminal");
}

// keys.json after a change: `set` binds chords (a map chord -> action) in
// `section`, dropping the chords in `drop` there first and any other chord
// in that section that pointed at the same action when `replace` is on.
export function rebound(doc, section, { drop = [], set = {}, replaceAction = null }) {
  const out = JSON.parse(JSON.stringify(doc));
  const sec = out[section] ?? (out[section] = {});
  for (const k of drop) delete sec[k];
  if (replaceAction) for (const k of Object.keys(sec)) if (sec[k] === replaceAction) delete sec[k];
  for (const [k, v] of Object.entries(set)) { delete sec[k]; sec[k] = v; }
  return out;
}
