// This is the source copy; `npm run sync:share` copies it into every mod, and a test fails when a copy differs.
// Motion is native and keeps going behind other windows: a ring that stops when the window loses the keyboard reads as a stalled agent.
export { onBattery } from "./ui.js";
import { KEY } from "./ui.js";
// A chord as this computer writes it lives with the tooltip that shows it.
import { MAC, OTHER, LINUX, modifierGlyphs, chordParts, glyphs } from "./ui-tooltip.js";
export { MAC, OTHER, LINUX, modifierGlyphs, glyphs };
import { div, svg, image } from "gpui-kit";
import { terminals, shared } from "herdr";

export function keycap(t, text, faint = false) {
  return div().flex_none().h(16).px(KEY.x).rounded(4).bg(t.foreground + (faint ? "0c" : "14")).flex().items_center().justify_center()
    .text_size(KEY.text).font_medium().text_color(faint ? t.dim : t.foreground).whitespace_nowrap().child(text);
}

export const familyPattern = (chord) => chord.replace(/[1-9]$/, "N");
export const shownChord = (chord, platform) => glyphs(chord, platform).replace(/N$/, "1–9");

export function chordRun(chords, platform) {
  const runs = [...new Set(chords)].map((chord) => {
    const { mods, key } = chordParts(chord);
    return { chord, key, held: mods.join("-") };
  });
  return runs.map(({ chord, key, held }, i) => {
    const continued = i > 0 && held === runs[i - 1].held;
    return `${continued ? " " : i ? ", " : ""}${shownChord(continued ? key : chord, platform)}`;
  }).join("");
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
