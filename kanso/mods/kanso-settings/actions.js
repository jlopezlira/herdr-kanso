// What each of Kanso's keys does, in words, for the Keys page. An action is
// the value keys.json binds ("kanso-strip.new-right"); a family is one row
// for nine actions that differ by a digit ("kanso-strip.col-1" to "-9"),
// shown and rebound as one chord with N in the digit's place.
//
// `section`: the keys.json section the action lives in. Kanso's layout keys
// are in "layout:kanso"; Spend's own, while its panel has the keyboard, in
// "mod:kanso-spend".
export const GROUPS = [
  { name: "Panes", section: "layout:kanso", actions: [
    { action: "kanso-strip.new-right", label: "New pane to the right" },
    { action: "kanso-strip.new-left", label: "New pane to the left" },
    { action: "kanso-strip.new-down", label: "New pane below" },
    { action: "kanso-strip.close", label: "Close the pane" },
    { action: "kanso-strip.go-left", label: "Go to the pane on the left" },
    { action: "kanso-strip.go-right", label: "Go to the pane on the right" },
    { action: "kanso-strip.go-up", label: "Go to the pane above" },
    { action: "kanso-strip.go-down", label: "Go to the pane below" },
    { action: "kanso-strip.move-left", label: "Move the pane left" },
    { action: "kanso-strip.move-right", label: "Move the pane right" },
    { family: "kanso-strip.col-", label: "Go to column N" },
    { action: "kanso-strip.first", label: "First column" },
    { action: "kanso-strip.last", label: "Last column" },
    { action: "kanso-strip.center", label: "Bring the pane into view" },
    { action: "kanso-strip.scroll-left", label: "Slide the view left" },
    { action: "kanso-strip.scroll-right", label: "Slide the view right" },
    { action: "kanso-strip.width", label: "Cycle the pane's width" },
    { action: "kanso-strip.fewer", label: "Fewer panes per view" },
    { action: "kanso-strip.more", label: "More panes per view" },
    { action: "kanso-strip.fit", label: "Even the columns out" },
    { action: "kanso-strip.pin", label: "Pin the pane to its side" },
    { action: "kanso-strip.next-needs-you", label: "Next agent that needs you" },
    { action: "kanso-strip.send", label: "Send the pane's work to an agent" },
    { action: "kanso-strip.arrange", label: "Arrangements" },
  ] },
  { name: "Sidebar", section: "layout:kanso", actions: [
    { family: "kanso-spaces.space-", label: "Go to space N" },
    { action: "kanso-spaces.view-spaces", label: "Projects view" },
    { action: "kanso-spaces.view-agents", label: "Status view" },
    { action: "kanso-spaces.view-threads", label: "Threads view" },
    { action: "kanso-chrome.settings", label: "Kanso settings" },
  ] },
  { name: "Tabs and panels", section: "layout:kanso", actions: [
    { family: "kanso-tabs.tab-", label: "Go to tab N" },
    { family: "kanso-tabs.panel-", label: "Open or close panel N" },
  ] },
  { name: "Spend, while its panel has the keyboard", section: "mod:kanso-spend", actions: [
    { action: "kanso-spend.refresh", label: "Read again" },
    { action: "kanso-spend.settings", label: "Spend's settings" },
    { action: "kanso-spend.back", label: "Back" },
  ] },
];

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
