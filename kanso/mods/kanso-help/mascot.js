// Daru, the dōjō's daruma, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A daruma is painted with one eye when you set a goal and the other when
// you reach it. Daru keeps that: its left eye is always painted, the right
// one once you beat your best at the level you are on. A few pixels in the
// theme's accent and two eyes that follow the game: calm, glad on a streak,
// a drop of sweat when the moves pile up, asleep when left alone.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// 12 x 12: a round body and two eyes, nothing else. R body, K a painted
// eye, E an eye not painted yet, B a drop of sweat, . nothing.
const BODY = [
  "....RRRR....",
  "..RRRRRRRR..",
  ".RRRRRRRRRR.",
  ".RRRRRRRRRR.",
  "RRRRRRRRRRRR",
  "RRRRRRRRRRRR",
  "RRRRRRRRRRRR",
  "RRRRRRRRRRRR",
  ".RRRRRRRRRR.",
  ".RRRRRRRRRR.",
  "..RRRRRRRR..",
  "....RRRR....",
];
const EYES = [3, 8]; // the left eye's column, then the right one's

// The face is the eyes: open (a dot two tall), glad (an arch), asleep (a
// line), and the right one blank until it is painted.
//   mood: "calm" | "glad" | "sweat" | "sleep"; both: the second eye painted.
export function daruPixels(mood = "calm", both = false) {
  const g = BODY.map((r) => r.split(""));
  const set = (x, y, v) => { if (g[y]?.[x] !== undefined) g[y][x] = v; };
  EYES.forEach((x, i) => {
    const v = i === 0 || both ? "K" : "E";
    if (mood === "glad") { set(x - 1, 6, v); set(x, 5, v); set(x + 1, 6, v); }
    else if (mood === "sleep") { set(x - 1, 6, v); set(x, 6, v); set(x + 1, 6, v); }
    else { set(x, 5, v); set(x, 6, v); }
  });
  if (mood === "sweat") { set(11, 2, "B"); set(11, 3, "B"); }
  return g;
}

// Daru at `px` pixels a cell, in the theme's colors.
export function daru(t, { mood = "calm", both = false, px = 5 } = {}) {
  const ink = { R: t.accent, K: t.chrome ?? "#161615", E: "#f4efe6", B: t.ansi4 ?? "#8e9fb2" };
  return v_flex().flex_none().children(daruPixels(mood, both).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
