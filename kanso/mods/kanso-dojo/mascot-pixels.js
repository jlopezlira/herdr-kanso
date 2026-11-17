// Hachi, the dōjō's pixel map, pure so the app and the Storybook draw the same one. By jlopezlira. Apache-2.0.
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
