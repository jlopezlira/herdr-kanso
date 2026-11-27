// Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-glint.js.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { GLINT, GLINT_MS, GLINT_STAGGER, GLINT_EASE, OPACITY } from "./ui.js";

export const SWEEP_MS = GLINT_MS / 2;
export const SWEEP_LEAD_MS = GLINT_STAGGER;
const WINDOWS = [[GLINT.wide, OPACITY.glintFaint], [GLINT.mid, OPACITY.glintMid], [GLINT.narrow, 1]];
const SLIDE = { duration: SWEEP_MS, easing: GLINT_EASE };

const lit = (text, c, id, run) => ([width, strength], k) => div().id(`${id}-sweep-${k}`).absolute().top_0().bottom_0().w(width).overflow_hidden().opacity(strength)
  .left(run ? GLINT.run : -width).transition("left", SLIDE)
  .child(div().id(`${id}-sweep-${k}-text`).absolute().top_0().whitespace_nowrap().text_color(c.text).child(text)
    .left(run ? -GLINT.run : width).transition("left", SLIDE));

const moving = (text, c, id, run) => div().relative().min_w(0).flex_shrink_1().overflow_hidden()
  .child(div().truncate().text_color(c.muted).child(text))
  .children(WINDOWS.map(lit(text, c, id, run)));

export const glint = (text, c, id = "", stage = null) => h_flex().min_w(0).items_center()
  .child(moving(text, c, id, stage !== "start"));
