// Kanso's panel kit: the tooltip's words, and a chord as this computer writes it. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-tooltip.js.
// Herdr's `.tooltip()` takes a string and draws the shell's own label, so the piece is that string.
import { window, keys } from "herdr";

export const MAC = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" };
export const OTHER = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Win", fn: "Fn" };
export const LINUX = { ...OTHER, cmd: "Super" };
export const modifierGlyphs = (platform) => platform === "macos" ? MAC : platform === "linux" ? LINUX : OTHER;
const NAMES = { space: "Space", left: "←", right: "→", up: "↑", down: "↓", enter: "↩", escape: "Esc", tab: "⇥", backspace: "⌫", delete: "⌦", home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn" };
const ORDER = ["ctrl", "alt", "shift", "cmd", "fn"];
export const chordParts = (chord) => {
  const all = String(chord).split("-");
  return { mods: ORDER.filter((m) => all.slice(0, -1).includes(m)), key: all.at(-1) || "-" };
};
export function glyphs(chord, platform = window()?.platform ?? "macos") {
  const { mods, key } = chordParts(chord), labels = modifierGlyphs(platform);
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return labels === MAC ? `${mods.map((m) => labels[m]).join("")}${name}` : [...mods.map((m) => labels[m]), name].join("+");
}

/** The chord the key table binds to `action` ("cmd-shift-p"), or "" when none does. */
export const boundChord = (action, bindings = keys()) => bindings.find((binding) => binding.action === action)?.keys ?? "";

/** The Storybook's tooltip as words: the label, the chord as this computer writes it, then the detail after a dot. */
export const tipText = ({ label, detail = "", chord = "" }, platform) => [String(label ?? ""), chord ? glyphs(chord, platform) : "", detail ? `· ${detail}` : ""]
  .filter(Boolean).join(" ");
