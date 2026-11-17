// Hachi, the dōjō's shiba, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { hachiPixels } from "./mascot-pixels.js";
import { INK } from "./ui.js";

// Each mark's color, from the theme: the same on screen and on a share card.
export function hachiInk(t) {
  const outline = t.chrome ?? INK.dojoInk;
  return { O: outline, F: INK.dojoFur, C: INK.dojoCream, D: INK.dojoCream, N: outline, K: outline, T: t.accent, B: t.ansi4 };
}

export function hachi(t, { mood = "calm", px = 6 } = {}) {
  const ink = hachiInk(t);
  return v_flex().flex_none().children(hachiPixels(mood).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
