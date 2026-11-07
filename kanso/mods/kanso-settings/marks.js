// This is the source copy; `npm run sync:share` copies it into every mod, and a test fails when a copy differs.
// Motion is native and keeps going behind other windows: a ring that stops when the window loses the keyboard reads as a stalled agent.
// A native loop redraws the whole window about 30 times a second, so on battery motion steps instead of gliding.
export const onBattery = () => shared("kanso.battery") === true;
import { div, svg, image } from "gpui-kit";
import { terminals, window, shared } from "herdr";

const ICONS = "mods/kanso-chrome/icons/";
const TURN = 900;

export function keycap(t, text, faint = false) {
  return div().flex_none().h(16).px(5).rounded(4).bg(t.foreground + (faint ? "0c" : "14")).flex().items_center().justify_center()
    .text_size(10.5).font_medium().text_color(faint ? t.dim : t.foreground).whitespace_nowrap().child(text);
}

const MAC = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" };
const OTHER = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Win", fn: "Fn" };
const NAMES = { space: "Space", left: "←", right: "→", up: "↑", down: "↓", enter: "↩", escape: "Esc", tab: "⇥", backspace: "⌫", delete: "⌦", home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn" };
const ORDER = ["ctrl", "alt", "shift", "cmd", "fn"];
export function glyphs(chord, mac = window()?.platform !== "linux" && window()?.platform !== "windows") {
  const all = String(chord).split("-");
  const parts = all.slice(0, -1);
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
  if (status === "asleep") return enso("moon", t.muted);
  return null;
}

export function programIcon(prog, size, color) {
  if (!prog?.icon) return null;
  return prog.tint ? svg(prog.icon).size(size).flex_none().text_color(color) : image(prog.icon).w(size).h(size).flex_none();
}

// Stored as a herdr-core label on the terminal itself: survives a restart, every window agrees.
export const NAME_LABEL = "kanso.name";

export function givenNames() {
  return new Map(terminals().flatMap((term) => {
    const n = term?.labels?.[NAME_LABEL];
    return n ? [[term.address, n]] : [];
  }));
}

export function nameOf(info, given) {
  const prog = info?.program;
  return given?.get(info?.terminal) || (prog?.agent || prog?.shell) && prog.name || info?.title || prog?.name || "Pane";
}
