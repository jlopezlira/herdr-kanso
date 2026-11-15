// Kanso's panel kit: the avatar, a round initial on a wash with a picture over it when there is one. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-avatar.js.
import { div, image } from "gpui-kit";
import { G, H, T, toneColor } from "./ui.js";

export const AVATAR_SIZES = Object.freeze({
  sm: Object.freeze({ side: G.lg, text: T.body }),
  md: Object.freeze({ side: H.badge, text: T.body }),
  lg: Object.freeze({ side: H.line, text: T.card }),
});

/** `initial`: its first letter is drawn; `image`: a picture over it; `size`: sm, md or lg; `tone`: a host's hue for the letter. */
export const avatar = (c, { initial, image: src = null, size = "md", tone = null } = {}) => {
  const { side, text } = AVATAR_SIZES[size] ?? AVATAR_SIZES.md;
  return div().relative().size(side).flex_none().overflow_hidden().rounded_full().bg(c.w12)
    .flex().items_center().justify_center().text_size(text).text_color(tone ? toneColor(c, tone) : c.muted)
    .child(String(initial ?? "").charAt(0))
    .when(Boolean(src), (el) => el.child(image(src).absolute().inset_0().size_full().rounded_full()));
};
