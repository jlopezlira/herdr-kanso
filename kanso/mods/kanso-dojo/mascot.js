// Hachi, the dōjō's shiba, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { hachiPixels } from "./mascot-pixels.js";

// Each mark's color, from the theme: the same on screen and on a share card.
export function hachiInk(t) {
  return { O: t.chrome ?? "#161615", F: "#e8963a", C: "#f6ece0", D: "#f6ece0", N: t.chrome ?? "#161615", K: t.chrome ?? "#161615", T: t.accent, B: t.ansi4 ?? "#8e9fb2" };
}

export function hachi(t, { mood = "calm", px = 6 } = {}) {
  const ink = hachiInk(t);
  return v_flex().flex_none().children(hachiPixels(mood).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
