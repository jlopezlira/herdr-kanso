// Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-glint.js.
import { div } from "gpui-kit";
import { GLINT, GLINT_MS, GLINT_STAGGER, GLINT_PACES, GLINT_EASE, OPACITY, EASE } from "./ui.js";

const WINDOWS = [[GLINT.wide, OPACITY.glintFaint], [GLINT.mid, OPACITY.glintMid], [GLINT.narrow, 1]];
const paceOf = (seed) => GLINT_MS + ([...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % GLINT_PACES) * GLINT_STAGGER;

const lit = (text, c, period) => ([width, strength]) => div().absolute().top_0().bottom_0().w(width).overflow_hidden().opacity(strength)
  .loop("left", { from: -width, to: GLINT.run, period, easing: GLINT_EASE })
  .child(div().absolute().top_0().whitespace_nowrap().text_color(c.text).child(text)
    .loop("left", { from: width, to: -GLINT.run, period, easing: GLINT_EASE }));

export const glint = (text, c, id, ink = c.text, state = "working") => div().relative().min_w(0).flex_shrink_1().overflow_hidden()
  .child(div().truncate().text_color(ink).child(text))
  .child(div().id(`${id}-glow`).absolute().inset_0().overflow_hidden().opacity(Number(state === "working")).transition("opacity", EASE)
    .when(state !== "rest", (el) => el.child(div().truncate().text_color(c.muted).child(text))
      .children(WINDOWS.map(lit(text, c, paceOf(id))))));
