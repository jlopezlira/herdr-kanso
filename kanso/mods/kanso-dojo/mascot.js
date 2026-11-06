// Hachi, the dōjō's shiba, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A pixel shiba that keeps you company while you practice, named after
// Hachikō, the dog who waited every day. Its face follows the game: calm,
// tongue out on a streak or a new best, a drop of sweat when the moves pile
// up, asleep when left alone.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// 16 x 15. O outline, F fur, C cream, D the brow dots, N nose, K eyes and
// mouth, T tongue, B a drop of sweat, . nothing.
const BODY = [
  ".OO..........OO.",
  "OFFO........OFFO",
  "OFCFO......OFCFO",
  "OFCCFOOOOOOFCCFO",
  "OFFFFFFFFFFFFFFO",
  "OFFFDFFFFFFDFFFO",
  "OFFFFFFFFFFFFFFO",
  "OFFFFFFFFFFFFFFO",
  "OCCFFFFFFFFFFCCO",
  "OCCCCCCNNCCCCCCO",
  ".OCCCCCNNCCCCCO.",
  ".OCCCCCCCCCCCCO.",
  "..OCCCCCCCCCCO..",
  "...OOCCCCCCOO...",
  ".....OOOOOO.....",
];
const EYES = [4, 11];

//   mood: "calm" | "glad" | "sweat" | "sleep".
export function hachiPixels(mood = "calm") {
  const g = BODY.map((r) => r.split(""));
  const set = (x, y, v) => { if (g[y]?.[x] !== undefined) g[y][x] = v; };
  for (const x of EYES) {
    if (mood === "glad") { set(x - 1, 7, "K"); set(x, 6, "K"); set(x + 1, 7, "K"); }
    else if (mood === "sleep") { set(x - 1, 7, "K"); set(x, 7, "K"); set(x + 1, 7, "K"); }
    else { set(x, 6, "K"); set(x, 7, "K"); }
  }
  if (mood === "glad") { set(6, 11, "K"); set(9, 11, "K"); set(7, 11, "T"); set(8, 11, "T"); set(7, 12, "T"); set(8, 12, "T"); }
  else if (mood === "sweat") { set(7, 11, "K"); set(8, 11, "K"); set(15, 3, "B"); set(15, 4, "B"); }
  else { set(6, 11, "K"); set(9, 11, "K"); set(7, 12, "K"); set(8, 12, "K"); }
  return g;
}

// Hachi at `px` pixels a cell, in the theme's colors (the tongue in its accent).
export function hachi(t, { mood = "calm", px = 6 } = {}) {
  const ink = { O: t.chrome ?? "#161615", F: "#e8963a", C: "#f6ece0", D: "#f6ece0", N: t.chrome ?? "#161615", K: t.chrome ?? "#161615", T: t.accent, B: t.ansi4 ?? "#8e9fb2" };
  return v_flex().flex_none().children(hachiPixels(mood).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
