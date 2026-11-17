// Kanso's panel kit: the dot, a state's colour where a word alone would not carry it. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-dot.js.
import { div } from "gpui-kit";
import { G, toneColor } from "./ui.js";

/** `tone`: a kit tone (blocked, working, done...) or a #rrggbb colour. */
export const dot = (c, tone) => div().size(G.sm).flex_none().rounded_full().bg(tone.startsWith("#") ? tone : toneColor(c, tone));
