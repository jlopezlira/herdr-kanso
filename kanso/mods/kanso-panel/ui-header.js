// Kanso's panel kit: a header segment, one fact with its parts each in their own tone; `act` opens the fact's home. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-header.js.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { G, R, W, ICON_INLINE, glyphOf, toneColor } from "./ui.js";

const inked = (el, c, tone) => (tone ? el.text_color(toneColor(c, tone)) : el);

/** `parts`: [{ text, tone }]; `icon` leads it; `title` is its tooltip; `act(cx)` makes it a button. */
export const headerSegment = (id, { parts = [], icon = null, tone = null, title = null, act = null }, c) => inked(h_flex().id(id), c, tone)
  .flex_none().items_center().gap(G.sm).px(G.xs).py(G.hair).rounded(R.sm).whitespace_nowrap()
  .when(Boolean(title), (el) => el.tooltip(title))
  .when(Boolean(act), (el) => el.cursor_pointer().hover((s) => s.bg(c.w12))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); act(cx); }))
  .when(Boolean(icon), (el) => el.child(svg(glyphOf(icon)).size(ICON_INLINE).flex_none()))
  .children(parts.filter(Boolean).map(({ text, tone: ink }) => inked(div(), c, ink).min_w(0).max_w(W.paneSegment).truncate().child(text)));
