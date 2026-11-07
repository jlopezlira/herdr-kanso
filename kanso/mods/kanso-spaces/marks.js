// How an agent is drawn, the same everywhere: its state mark, its program's
// icon and its name. Kanso's tabs, pane headers, status bar, sidebar and
// Send dialog share this file (kanso-spaces/marks.js is the one you edit;
// `npm run sync:share` copies it, and a test fails when a copy differs).
//
// The state mark is an ensō, the brush circle, in the state's color:
// working spins the open ring, blocked is a disc with a mark (needs you),
// done the closed ring, idle (where asked for) a faint ring, asleep the moon.
//
// Motion is native (spin, loop) and keeps going behind other windows: a
// ring that stops the moment the window loses the keyboard reads as an
// agent that stalled, on the screen the person glances at while they work
// elsewhere. What Kanso saves behind other windows is work, not motion.
//
// On battery (shared "kanso.battery", set by kanso-chrome) motion steps
// instead of gliding where it can do without: a native loop redraws the
// whole window about 30 times a second. The working ring keeps its spin.
export const onBattery = () => shared("kanso.battery") === true;
import { div, svg, image } from "gpui-kit";
import { terminals, window, shared } from "herdr";

const ICONS = "mods/kanso-chrome/icons/";
const TURN = 900;

// A key as a small cap beside a name (Kanso settings lists the keys; the
// rest of the window draws none).
export function keycap(t, text, faint = false) {
  return div().flex_none().h(16).px(5).rounded(4).bg(t.foreground + (faint ? "0c" : "14")).flex().items_center().justify_center()
    .text_size(10.5).font_medium().text_color(faint ? t.dim : t.foreground).whitespace_nowrap().child(text);
}

// A chord as keys.json spells it ("cmd-shift-s"), as a person reads it: on
// macOS the glyphs in their order (⌃⌥⇧⌘S), elsewhere "Ctrl+Alt+Shift+S".
const MAC = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" };
const OTHER = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Win", fn: "Fn" };
const NAMES = { space: "Space", left: "←", right: "→", up: "↑", down: "↓", enter: "↩", escape: "Esc", tab: "⇥", backspace: "⌫", delete: "⌦", home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn" };
const ORDER = ["ctrl", "alt", "shift", "cmd", "fn"];
export function glyphs(chord, mac = window()?.platform !== "linux" && window()?.platform !== "windows") {
  const all = String(chord).split("-");
  const parts = all.slice(0, -1); // the modifiers: all but the last
  const key = all.at(-1) === "" ? "-" : parts.length && chord.endsWith("--") ? "-" : chord.split("-").at(-1);
  const mods = ORDER.filter((m) => parts.includes(m));
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return mac ? `${mods.map((m) => MAC[m]).join("")}${name}` : [...mods.map((m) => OTHER[m]), name].join("+");
}

export function stateMark(t, status, size = 13, { idle = false } = {}) {
  const enso = (name, color) => svg(`${ICONS}${name}.svg`).size(size).flex_none().text_color(color);
  if (status === "working") return enso("working", t.working).spin(TURN);
  if (status === "blocked") return div().size(size).flex_none().rounded_full().bg(t.blocked)
    .text_size(Math.round(size * 0.68)).font_bold().text_color(t.chrome).flex().items_center().justify_center().child("!");
  if (status === "done") return enso("enso", t.done);
  if (status === "idle" && idle) return enso("enso-idle", t.idle ?? t.dim).opacity(0.7);
  // Asleep: a status like the others, the moon instead of an ensō.
  if (status === "asleep") return enso("moon", t.muted);
  return null;
}

// A program's icon from the app's program table, tinted when it is a glyph,
// as it is when it is a picture; null when it has none.
export function programIcon(prog, size, color) {
  if (!prog?.icon) return null;
  return prog.tint ? svg(prog.icon).size(size).flex_none().text_color(color) : image(prog.icon).w(size).h(size).flex_none();
}

// What you named a terminal lives as the `kanso.name` label on the terminal
// itself, in herdr-core, so it survives a restart and every window agrees.
export const NAME_LABEL = "kanso.name";

// The names you gave, by terminal address.
export function givenNames() {
  return new Map(terminals().flatMap((term) => {
    const n = term?.labels?.[NAME_LABEL];
    return n ? [[term.address, n]] : [];
  }));
}

// A pane's name as its header shows it: yours, else an agent's or a shell's
// program, else the terminal's title, else the program's name.
export function nameOf(info, given) {
  const prog = info?.program;
  return given?.get(info?.terminal) || (prog?.agent || prog?.shell) && prog.name || info?.title || prog?.name || "Pane";
}
