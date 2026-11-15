// Kanso's panel kit: the chip, a count or a short fact on a wash, or quiet as plain dim text. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-chip.js.
import { div } from "gpui-kit";
import { G, H, R, T, toneColor } from "./ui.js";

const filled = (el, c) => el.h(H.compact).px(G.sm).rounded(R.control).bg(c.w7);
const inkOf = (c, quiet, tone) => {
  if (tone) return toneColor(c, tone);
  return quiet ? c.dim : c.text;
};

/** `label`: a count or a few words; `quiet`: no wash, dim text; `tone`: a tone name that colours the text. */
export const chip = (c, { label, quiet = false, tone = null } = {}) => div().flex().flex_none().items_center().whitespace_nowrap()
  .text_size(T.body).text_color(inkOf(c, quiet, tone))
  .when(!quiet, (el) => filled(el, c))
  .child(String(label));
