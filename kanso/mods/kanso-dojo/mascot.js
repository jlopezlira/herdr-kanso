// Hachi, the dōjō's shiba, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
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
  // [x, y, ink] marks over the body; in the Map a later mark wins where two meet.
  const eyes = EYES.flatMap((x) => (mood === "glad" ? [[x - 1, 7, "K"], [x, 6, "K"], [x + 1, 7, "K"]]
    : mood === "sleep" ? [[x - 1, 7, "K"], [x, 7, "K"], [x + 1, 7, "K"]]
    : [[x, 6, "K"], [x, 7, "K"]]));
  const mouth = mood === "glad" ? [[6, 11, "K"], [9, 11, "K"], [7, 11, "T"], [8, 11, "T"], [7, 12, "T"], [8, 12, "T"]]
    : mood === "sweat" ? [[7, 11, "K"], [8, 11, "K"], [15, 3, "B"], [15, 4, "B"]]
    : [[6, 11, "K"], [9, 11, "K"], [7, 12, "K"], [8, 12, "K"]];
  const face = new Map([...eyes, ...mouth].map(([x, y, v]) => [y * 100 + x, v]));
  return BODY.map((r, y) => r.split("").map((c, x) => face.get(y * 100 + x) ?? c));
}

export function hachi(t, { mood = "calm", px = 6 } = {}) {
  const ink = { O: t.chrome ?? "#161615", F: "#e8963a", C: "#f6ece0", D: "#f6ece0", N: t.chrome ?? "#161615", K: t.chrome ?? "#161615", T: t.accent, B: t.ansi4 ?? "#8e9fb2" };
  return v_flex().flex_none().children(hachiPixels(mood).map((row) => h_flex().children(row.map((v) =>
    div().size(px).when(v !== ".", (el) => el.bg(ink[v] ?? t.accent))))));
}
