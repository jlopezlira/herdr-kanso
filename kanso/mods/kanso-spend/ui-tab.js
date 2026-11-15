// Kanso's panel kit: the tab group. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-tab.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { G, H, R, T, ICON_ROW, ICONS, CLEAR } from "./ui.js";

/** One tab group: the chosen tab is a quiet fill (raised on a track), never a weight, so nothing moves. Items: { key, label, icon, dot, tip };
 * `dot` marks one while unselected. `size`: sm 24, md 26, lg 30, the track's thickness, or each tab's without one. Collapsed: a column of icons, each label its tip. */
const TAB = { sm: H.compact, md: H.icon, lg: H.control };
export function tab(id, items, value, onChange, c, { disabled = false, spoken = null, collapsed = false, track = true, size = "lg" } = {}) {
  const side = TAB[size] ?? TAB.lg, inner = track ? side - 2 * G.hair : side;
  const seg = (item, index) => {
    const on = value === item.key;
    const ink = disabled ? c.dim : on ? c.text : c.muted;
    const dot = div().size(G.sm).flex_none().rounded_full().bg(c.blocked);
    return Button.new(`${id}-${item.key}`).items_center().justify_center().gap(G.xs).rounded(R.control)
      .border_2().border_color(CLEAR).focus((s) => s.border_color(c.accent))
      .text_color(ink)
      .when(collapsed, (el) => el.relative().size(inner).flex_none().tooltip(item.label))
      .when(!collapsed, (el) => el.h(inner).px(G.sm - G.hair).when(track, (b) => b.flex_1()).when(Boolean(item.tip), (b) => b.tooltip(item.tip)))
      .selected(on)
      .disabled(disabled)
      .set_position(index + 1, items.length)
      .accessibility_label(item.label)
      .when(on, (el) => el.bg(track ? c.raised : c.w7))
      .when(!disabled, (el) => el.cursor_pointer().when(!on, (el) => el.hover((s) => s.bg(c.w4).text_color(c.text)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { if (!on) onChange(item.key, cx); }))
      .when(Boolean(item.icon), (el) => el.child(svg(`${ICONS}${item.icon}.svg`).size(ICON_ROW).flex_none().text_color(ink)))
      .when(!collapsed, (el) => el.child(div().whitespace_nowrap().text_size(T.value).child(item.label)))
      .when(Boolean(item.dot) && !on, (el) => el.child(collapsed ? dot.absolute().top(G.hair).right(G.hair) : dot));
  };
  return (collapsed ? v_flex() : h_flex()).id(id).gap(G.hair).flex_none()
    .when(track, (el) => el.p(G.hair).rounded(R.card).bg(c.w4))
    .when(track && !collapsed, (el) => el.h(side))
    .when(Boolean(spoken), (el) => el.accessibility_label(spoken))
    .children(items.map(seg));
}

/** Today's name for `tab`. */
export const segmented = tab;
