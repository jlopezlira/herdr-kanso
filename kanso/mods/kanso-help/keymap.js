// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.

// A Mac keyboard, US layout, in rows; `w` is a key's width in units.
export const ROWS = [
  [["`"], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["0"], ["-"], ["="], ["backspace", 1.6]],
  [["tab", 1.6], ["q"], ["w"], ["e"], ["r"], ["t"], ["y"], ["u"], ["i"], ["o"], ["p"], ["["], ["]"], ["\\"]],
  [["capslock", 1.9], ["a"], ["s"], ["d"], ["f"], ["g"], ["h"], ["j"], ["k"], ["l"], [";"], ["'"], ["enter", 1.7]],
  [["shift", 2.4], ["z"], ["x"], ["c"], ["v"], ["b"], ["n"], ["m"], [","], ["."], ["/"], ["shift", 2.2]],
  [["ctrl", 1.3], ["alt", 1.3], ["cmd", 1.6], ["space", 5.3], ["cmd", 1.6], ["alt", 1.3], ["left"], ["up"], ["down"], ["right"]],
];
export const MODIFIERS = ["ctrl", "alt", "shift", "cmd"];
export const CAP = { backspace: "⌫", tab: "⇥", capslock: "⇪", enter: "↩", shift: "⇧", ctrl: "⌃", alt: "⌥", cmd: "⌘", space: "", left: "←", right: "→", up: "↑", down: "↓", escape: "esc" };

// keys.json may say "cmd-}" for "cmd-shift-]": a typed char goes back to its key plus shift.
const SHIFTED = { "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/" };

export function parseChord(chord) {
  const parts = String(chord ?? "").toLowerCase().split("-");
  const last = parts.at(-1);
  // "cmd--" ends in two empty parts: the key is the dash, both are taken.
  const dash = last === "" && parts.length > 1 && parts.at(-2) === "";
  const typed = last === "" ? "-" : last;
  const held = parts.slice(0, dash ? -2 : -1).filter((p) => p && ["ctrl", "alt", "shift", "cmd", "fn"].includes(p));
  const shifted = SHIFTED[typed];
  const mods = shifted && !held.includes("shift") ? [...held, "shift"] : held;
  const base = shifted ? shifted : typed;
  const key = base === "return" ? "enter" : base === "esc" ? "escape" : base;
  return { mods: MODIFIERS.filter((m) => mods.includes(m)), key };
}
export const sameMods = (a, b) => a.length === b.length && a.every((m) => b.includes(m));

// Precedence mirrors Herdr's own: the kansō layout's keys win over the global ones.
export function layer(bindings, mods) {
  const rank = (s) => (s === "layout:kanso" ? 2 : s === "global" ? 1 : 0);
  const hits = (bindings ?? []).flatMap((b) => {
    if (!rank(b.section) || !b.action || b.action === "terminal" || String(b.action).startsWith("send:")) return [];
    const c = parseChord(b.keys);
    return sameMods(c.mods, mods) ? [{ key: c.key, does: { action: b.action, section: b.section, chord: b.keys } }] : [];
  });
  const winner = (key) => hits.filter((h) => h.key === key).reduce((had, h) => (rank(h.does.section) > rank(had.does.section) ? h : had)).does;
  return new Map([...new Set(hits.map((h) => h.key))].map((key) => [key, winner(key)]));
}

// The keys of every kansō list and menu (listkeys.js), as a layer of its own.
export const LIST_LAYER = new Map([
  ["j", { action: "list:down", chord: "j" }],
  ["k", { action: "list:up", chord: "k" }],
  ["g", { action: "list:first", chord: "g g" }],
  ["l", { action: "list:open", chord: "l" }],
  ["enter", { action: "list:open", chord: "enter" }],
  ["/", { action: "list:search", chord: "/" }],
  ["down", { action: "list:down", chord: "down" }],
  ["up", { action: "list:up", chord: "up" }],
]);
export const LIST_SHIFT = new Map([["g", { action: "list:last", chord: "shift-g" }]]);

const WORDS = {
  "kanso-strip.go-left": "Pane to the left", "kanso-strip.go-right": "Pane to the right", "kanso-strip.go-up": "Pane above", "kanso-strip.go-down": "Pane below",
  "kanso-strip.vim-left": "Pane to the left, or the sidebar's list", "kanso-strip.vim-right": "Pane to the right", "kanso-strip.vim-up": "Pane above", "kanso-strip.vim-down": "Pane below",
  "kanso-strip.move-left": "Move the pane left", "kanso-strip.move-right": "Move the pane right", "kanso-strip.move-up": "Move the pane up", "kanso-strip.move-down": "Move the pane down",
  "kanso-strip.vim-move-left": "Move the pane left", "kanso-strip.vim-move-right": "Move the pane right", "kanso-strip.vim-move-up": "Move the pane up", "kanso-strip.vim-move-down": "Move the pane down",
  "kanso-strip.new-right": "New pane to the right", "kanso-strip.new-left": "New pane to the left", "kanso-strip.new-down": "New pane below",
  "kanso-strip.close": "Close the pane", "kanso-strip.width": "Wider or narrower", "kanso-strip.pin": "Pin the pane",
  "kanso-strip.scroll-left": "Slide the view left", "kanso-strip.scroll-right": "Slide the view right", "kanso-strip.first": "First column", "kanso-strip.last": "Last column",
  "kanso-strip.center": "Bring the pane into view", "kanso-strip.fewer": "Fewer panes in view", "kanso-strip.more": "More panes in view", "kanso-strip.fit": "Even the columns out",
  "kanso-strip.next-needs-you": "Next agent that needs you", "kanso-strip.send": "Send the pane's work to an agent", "kanso-strip.arrange": "Arrangements",
  "kanso-spaces.view-spaces": "Sidebar: Projects", "kanso-spaces.view-agents": "Sidebar: Status", "kanso-spaces.view-threads": "Sidebar: Threads",
  "kanso-tabs.settings": "kansō settings", "mod.open:kanso-help": "This help",
  "tab.new": "New tab", "tab.close": "Close the tab", "tab.next": "Next tab", "tab.prev": "Previous tab",
  "space.new": "New space", "space.next": "Next space", "space.prev": "Previous space",
  "agent.next": "Next agent", "agent.prev": "Previous agent", "app.palette": "Command palette", "app.settings": "Herdr settings",
  "app.quit": "Quit", "app.hide": "Hide Herdr", "app.hide_others": "Hide the other apps", "app.help": "Herdr's help",
  "mod.open:picker": "Search spaces, tabs and agents", "mod.open:open-with": "Open the folder in an editor", "layout.switch": "Switch layout",
  "pane.zoom": "Zoom the pane", "pane.close": "Close the pane", "pane.split": "Split the pane",
  "list:down": "Down the list", "list:up": "Up the list", "list:first": "First row (press g twice)", "list:last": "Last row", "list:open": "Open the row", "list:search": "Search",
};
const FAMILY = [
  [/^kanso-strip\.col-(\d)$/, (n) => `Column ${n}`],
  [/^kanso-spaces\.space-(\d)$/, (n) => `Space ${n}`],
  [/^kanso-tabs\.panel-(\d)$/, (n) => `Panel ${n}`],
  [/^space\.select:(\d)$/, (n) => `Space ${n}`],
  [/^tab\.select:(\d)$/, (n) => `Tab ${n}`],
  [/^kanso-strip\.per-(\d)$/, (n) => `${n} panes in view`],
];
export function describe(action) {
  const a = String(action ?? "");
  if (WORDS[a]) return WORDS[a];
  for (const [re, f] of FAMILY) { const m = re.exec(a); if (m) return f(m[1]); }
  const [cmd, arg] = a.split(":");
  const words = cmd.replace(/^kanso-[a-z]+\./, "").replace(/[._-]+/g, " ");
  return (words.charAt(0).toUpperCase() + words.slice(1) + (arg ? ` ${arg}` : "")).trim();
}
