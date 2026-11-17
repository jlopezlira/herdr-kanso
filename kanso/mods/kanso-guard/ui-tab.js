// Kanso's panel kit: the tab group. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-tab.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { G, H, R, T, ICON_ROW, ICONS, CLEAR } from "./ui.js";
import { armedLook } from "./ui-button.js";
import { field } from "./ui-field.js";
import { mark } from "./ui-mark.js";
import { PENDING, pendingDot } from "./ui-state.js";

const TAB = { sm: H.compact, md: H.icon, lg: H.control };
/** The most characters a tab's name holds. */
export const TAB_NAME_LIMIT = 64;

const groundOf = (c, { on, track, armed, held, fill }) => {
  if (armed) return armedLook(c).fill;
  if (held) return c.selected;
  if (!on || !fill) return null;
  return track ? c.raised : c.w7;
};

const inkOf = (c, { on, disabled, armed }) => {
  if (disabled) return c.dim;
  if (armed) return c.accentText;
  return on ? c.text : c.muted;
};

// The press stays on the ×: the tab under it is not chosen. A tab that is off draws its × and does nothing.
const closeGlyph = (id, ink, c, onClose, disabled) => div().id(`${id}-close`).flex_none().text_color(ink)
  .when(!disabled, (el) => el.hover((s) => s.text_color(c.text))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onClose(cx); }))
  .child(svg(`${ICONS}close.svg`).size(ICON_ROW));

const nameOf = (id, item, c, nameWidth) => (item.editing
  ? div().id(`${id}-rename`).min_w(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
    .child(field(`${id}-name`, item.editing, c, { inline: true, spoken: item.label }))
  : div().whitespace_nowrap().text_size(T.value).when(Boolean(nameWidth), (el) => el.min_w(0).max_w(nameWidth).truncate()).child(item.label));

/** One tab. `item`: { key, label, icon, dot, tip, mark, pending, held, armed, editing }; `dot` marks it while unselected, `mark` is a status drawn after the name,
 * `editing` the TextField renaming it in place. `onClose`: the chosen tab ends with ×. `onPress`: a left press, before the tab keeps it from the window.
 * `fill`: false when the group's pill draws the chosen fill. `nameWidth`: the name trims past it. */
export function tabItem(id, item, c, { on = false, disabled = false, collapsed = false, track = true, size = "lg", index = 0, count = 1, onChange = null, onClose = null, onPress = null, fill = true, nameWidth = null } = {}) {
  const side = TAB[size] ?? TAB.lg, inner = track ? side - 2 * G.hair : side;
  const armed = Boolean(item.armed) && !disabled;
  const ink = inkOf(c, { on, disabled, armed });
  const ground = groundOf(c, { on, track, armed, held: Boolean(item.held), fill });
  const dot = div().size(G.sm).flex_none().rounded_full().bg(c.blocked);
  return Button.new(id).items_center().justify_center().gap(G.xs).rounded(R.control)
    .border_2().border_color(CLEAR).focus((s) => s.border_color(c.accent))
    .text_color(ink)
    .when(collapsed, (el) => el.relative().size(inner).flex_none().tooltip(item.label))
    .when(!collapsed, (el) => el.h(inner).px(G.sm - G.hair).when(track, (b) => b.flex_1()).when(Boolean(item.tip), (b) => b.tooltip(item.tip)))
    .selected(on)
    .disabled(disabled)
    .set_position(index + 1, count)
    .accessibility_label(item.label)
    .when(Boolean(ground), (el) => el.bg(ground))
    .when(Boolean(item.pending), (el) => el.opacity(PENDING))
    .when(!disabled, (el) => el.cursor_pointer().when(!on && !armed && !item.held, (b) => b.hover((s) => s.bg(c.w4).text_color(c.text)))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onPress?.(e, cx); })
      .on_click((_e, cx) => { if (!on) onChange?.(item.key, cx); }))
    .when(Boolean(item.icon), (el) => el.child(svg(`${ICONS}${item.icon}.svg`).size(ICON_ROW).flex_none().text_color(ink)))
    .when(!collapsed, (el) => el.child(nameOf(id, item, c, nameWidth)))
    .when(Boolean(item.pending), (el) => el.child(pendingDot(`${id}-pending`, c)))
    .when(Boolean(item.mark) && !collapsed, (el) => el.child(mark(c, { status: item.mark })))
    .when(Boolean(item.dot) && !on, (el) => el.child(collapsed ? dot.absolute().top(G.hair).right(G.hair) : dot))
    .when(on && Boolean(onClose) && !item.editing && !collapsed, (el) => el.child(closeGlyph(id, armed ? ink : c.dim, c, onClose, disabled)));
}

/** Where a dragged tab lands: the accent bar between two tabs. */
export const tabInsertion = (c) => div().w(G.hair).h(H.badge).flex_none().rounded(R.sm).bg(c.accent);

/** The chosen fill on its own, for a group that slides it under the chosen tab. */
export const tabPill = (c, size = "md") => div().h(TAB[size] ?? TAB.lg).rounded(R.control).bg(c.w7);

/** One tab group: the chosen tab is a quiet fill (raised on a track), never a weight, so nothing moves. Items: { key, label, icon, dot, tip, drop } and tabItem's states;
 * `drop` draws where a dragged tab lands, before it. `size`: sm 24, md 26, lg 30, the track's thickness, or each tab's without one. Collapsed: a column of icons, each label its tip. */
export function tab(id, items, value, onChange, c, { disabled = false, spoken = null, collapsed = false, track = true, size = "lg" } = {}) {
  const side = TAB[size] ?? TAB.lg;
  const seg = (item, index) => [
    item.drop ? tabInsertion(c) : null,
    tabItem(`${id}-${item.key}`, item, c, { on: value === item.key, disabled, collapsed, track, size, index, count: items.length, onChange }),
  ];
  return (collapsed ? v_flex() : h_flex()).id(id).gap(G.hair).flex_none()
    .when(track, (el) => el.p(G.hair).rounded(R.card).bg(c.w4))
    .when(track && !collapsed, (el) => el.h(side))
    .when(Boolean(spoken), (el) => el.accessibility_label(spoken))
    .children(items.flatMap(seg).filter(Boolean));
}

/** Today's name for `tab`. */
export const segmented = tab;
