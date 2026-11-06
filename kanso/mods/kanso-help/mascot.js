// Neko, the dōjō's cat, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A pixel cat in the theme's accent that keeps you company while you
// practice. Its face follows the game: eyes open, happy arches on a streak
// or a new best, a drop of sweat when the moves pile up, asleep when left
// alone.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// 14 x 12. R fur, I inside the ears, N nose, K eyes and mouth, B a drop
// of sweat, . nothing.
const BODY = [
  "..R........R..",
  ".RIR......RIR.",
  ".RIIR....RIIR.",
  ".RRRRRRRRRRRR.",
  "RRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRR",
  "RRRRRRRRRRRRRR",
  "RRRRRRNNRRRRRR",
  "RRRRRKRRKRRRRR",
  ".RRRRRKKRRRRR.",
  "..RRRRRRRRRR..",
  "....RRRRRR....",
];
const EYES = [3, 9]; // where each eye starts

//   mood: "calm" | "glad" | "sweat" | "sleep".
export function nekoPixels(mood = "calm") {
  const g = BODY.map((r) => r.split(""));
  const set = (x, y, v) => { if (g[y]?.[x] !== undefined) g[y][x] = v; };
  for (const x of EYES) {
    if (mood === "glad") { set(x, 6, "K"); set(x + 1, 5, "K"); set(x + 2, 6, "K"); }
    else if (mood === "sleep") { set(x, 6, "K"); set(x + 1, 6, "K"); set(x + 2, 6, "K"); }
    else for (const [dx, y] of [[1, 5], [2, 5], [1, 6], [2, 6]]) set(x + dx, y, "K");
  }
  if (mood === "sweat") { set(13, 2, "B"); set(13, 3, "B"); }
  return g;
}

// Neko at `px` pixels a cell, in the theme's colors.
export function neko(t, { mood = "calm", px = 6 } = {}) {
  const ink = { R: t.accent, I: "#f2b8c6", N: "#f4efe6", K: t.chrome ?? "#161615", B: t.ansi4 ?? "#8e9fb2" };
  return v_flex().flex_none().children(nekoPixels(mood).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
