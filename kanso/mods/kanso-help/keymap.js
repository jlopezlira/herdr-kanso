// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The keyboard as data: its rows of keys, what each chord in keys.json
// does in words, and which keys do something with a set of modifiers held.

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

// What macOS types with shift on a US keyboard, back to the key and shift:
// keys.json may say "cmd-}" for "cmd-shift-]".
const SHIFTED = { "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/" };

// "cmd-shift--" as { mods: ["cmd", "shift"], key: "-" }.
export function parseChord(chord) {
  const parts = String(chord ?? "").toLowerCase().split("-");
  let key = parts.pop();
  if (key === "" && parts.length && parts[parts.length - 1] === "") { parts.pop(); key = "-"; }
  else if (key === "") key = "-";
  const mods = parts.filter((p) => p && ["ctrl", "alt", "shift", "cmd", "fn"].includes(p));
  if (SHIFTED[key]) { key = SHIFTED[key]; if (!mods.includes("shift")) mods.push("shift"); }
  if (key === "return") key = "enter";
  if (key === "esc") key = "escape";
  return { mods: MODIFIERS.filter((m) => mods.includes(m)), key };
}
export const sameMods = (a, b) => a.length === b.length && a.every((m) => b.includes(m));

// What a key does with `mods` held, from keys() (Herdr's bindings with the
// person's own): key -> { action, section, chord }. The kansō layout's keys
// win over the global ones, as they do in Herdr; keys handed to the
// terminal and the panels' own sections are left out.
export function layer(bindings, mods) {
  const out = new Map();
  const rank = (s) => (s === "layout:kanso" ? 2 : s === "global" ? 1 : 0);
  for (const b of bindings ?? []) {
    if (!rank(b.section) || !b.action || b.action === "terminal" || String(b.action).startsWith("send:")) continue;
    const c = parseChord(b.keys);
    if (!sameMods(c.mods, mods)) continue;
    const had = out.get(c.key);
    if (!had || rank(b.section) > rank(had.section)) out.set(c.key, { action: b.action, section: b.section, chord: b.keys });
  }
  return out;
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

// An action in words.
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

// The vim practice game: a board of `w` x `h` cells, a block (the cursor)
// to bring onto a ring (the target), level by level.
// `keys`: the moves it takes; `edges`: 0 $ gg G count; `counts`: a number
// before h j k l ("5l") is one move; `aim`: where its targets go.
export const LEVELS = [
  { n: 1, name: "h and l", keys: ["h", "l"], aim: "row", tip: "h left, l right. Rest your right index finger on j: h is one key to its left." },
  { n: 2, name: "j and k", keys: ["j", "k"], aim: "column", tip: "j down (it hangs below the line), k up. Index finger on j, middle on k." },
  { n: 3, name: "h j k l", keys: ["h", "j", "k", "l"], aim: "any", tip: "All four, without looking: index on j, middle on k, ring on l, and h one to the left." },
  { n: 4, name: "0 $ gg G", keys: ["h", "j", "k", "l", "0", "$", "gg", "G"], edges: true, aim: "edges", tip: "0 and $ jump to the ends of the row, gg and G to the first and the last row." },
  { n: 5, name: "Counts", keys: ["h", "j", "k", "l"], counts: true, aim: "far", tip: "A number first moves that many: 5l is five to the right, 3j three down. Type the number, then the key." },
];

// The block after a move: h j k l one cell (or `n`), 0 and $ the ends of
// the row, gg and G the first and last row; always inside the board.
export function step(at, move, w, h, n = 1) {
  const x = at.x, y = at.y;
  const to = { h: [x - n, y], l: [x + n, y], k: [x, y - n], j: [x, y + n], 0: [0, y], $: [w - 1, y], gg: [x, 0], G: [x, h - 1] }[move];
  if (!to) return at;
  return { x: Math.min(w - 1, Math.max(0, to[0])), y: Math.min(h - 1, Math.max(0, to[1])) };
}

// The fewest moves from `a` to `b` at a level: along each axis, the
// distance in single steps, or one jump to an edge and steps from there
// (`edges`), or one counted move (`counts`).
export function fewest(a, b, w, h, level = LEVELS[2]) {
  const along = (from, to, last) => {
    if (from === to) return 0;
    if (level.counts) return 1;
    const d = Math.abs(to - from);
    return level.edges ? Math.min(d, 1 + to, 1 + last - to) : d;
  };
  return along(a.x, b.x, w - 1) + along(a.y, b.y, h - 1);
}

// The move that brings the block closest (the hint): "l", "$", "5j"...
export function bestMove(at, target, w, h, level) {
  const tries = [];
  for (const k of level.keys) tries.push([k, step(at, k, w, h)]);
  if (level.counts) {
    const dx = target.x - at.x, dy = target.y - at.y;
    if (Math.abs(dx) > 1) tries.push([`${Math.abs(dx)}${dx > 0 ? "l" : "h"}`, { x: target.x, y: at.y }]);
    if (Math.abs(dy) > 1) tries.push([`${Math.abs(dy)}${dy > 0 ? "j" : "k"}`, { x: at.x, y: target.y }]);
  }
  let best = null;
  for (const [move, after] of tries) {
    if (after.x === at.x && after.y === at.y) continue;
    const left = fewest(after, target, w, h, level);
    if (!best || left < best.left || (left === best.left && move.length > best.move.length)) best = { move, left };
  }
  return best?.move ?? null;
}

// A new ring for a level, never on the block: on its row, its column,
// anywhere, mostly on an edge, or far enough to count.
export function newTarget(at, w, h, level, rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n);
  for (let i = 0; i < 200; i++) {
    let t = { x: pick(w), y: pick(h) };
    if (level.aim === "row") t.y = at.y;
    if (level.aim === "column") t.x = at.x;
    if (level.aim === "edges" && rand() < 0.75) { if (rand() < 0.5) t.x = rand() < 0.5 ? 0 : w - 1; else t.y = rand() < 0.5 ? 0 : h - 1; }
    if (level.aim === "far" && Math.abs(t.x - at.x) < 3 && Math.abs(t.y - at.y) < 3) continue;
    if (t.x !== at.x || t.y !== at.y) return t;
  }
  return { x: at.x === 0 ? w - 1 : 0, y: at.y };
}

// Points for reaching a ring in `moves` when `best` would do: 10, 5 more
// in the fewest, and 2 for each ring of the streak (fewest in a row) before it.
export const points = (moves, best, streak) => 10 + (moves <= best ? 5 + 2 * streak : 0);
