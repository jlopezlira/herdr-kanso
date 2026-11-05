// How an agent is drawn, the same everywhere: its state mark, its program's
// icon and its name. Kanso's tabs, pane headers, status bar, sidebar and
// Send dialog share this file (kanso-spaces/marks.js is the one you edit;
// `npm run sync:share` copies it, and a test fails when a copy differs).
//
// The state mark is an ensō, the brush circle, in the state's color:
// working spins the open ring, blocked is a disc with a mark (needs you),
// done the closed ring, idle (where asked for) a faint ring.
//
// Motion runs only while the window is in front. Every native loop, spin
// and shimmer keeps the window drawing about 30 frames a second for as long
// as it is on screen; behind other windows nobody watches, so the marks
// stand still and Herdr draws nothing until something changes. kanso-spaces
// redraws every mod when the window comes forward or goes behind.
import { div, svg, image } from "gpui-kit";
import { terminals, window } from "herdr";

const ICONS = "mods/kanso-chrome/icons/";
const TURN = 900;

export const moving = () => window()?.active !== false;

export function stateMark(t, status, size = 13, { idle = false } = {}) {
  const enso = (name, color) => svg(`${ICONS}${name}.svg`).size(size).flex_none().text_color(color);
  if (status === "working") { const ring = enso("working", t.working); return moving() ? ring.spin(TURN) : ring; }
  if (status === "blocked") return div().size(size).flex_none().rounded_full().bg(t.blocked)
    .text_size(Math.round(size * 0.68)).font_bold().text_color(t.chrome).flex().items_center().justify_center().child("!");
  if (status === "done") return enso("enso", t.done);
  if (status === "idle" && idle) return enso("enso-idle", t.idle ?? t.dim).opacity(0.7);
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
  const out = new Map();
  for (const term of terminals()) { const n = term?.labels?.[NAME_LABEL]; if (n) out.set(term.address, n); }
  return out;
}

// A pane's name as its header shows it: yours, else an agent's or a shell's
// program, else the terminal's title, else the program's name.
export function nameOf(info, given) {
  const prog = info?.program;
  return given?.get(info?.terminal) || (prog?.agent || prog?.shell) && prog.name || info?.title || prog?.name || "Pane";
}
