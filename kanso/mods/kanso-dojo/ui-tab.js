// Kanso's panel kit: the tab group, laid out and coloured by the Storybook's CSS. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-tab.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { FOCUS, CLEAR, glyphOf } from "./ui.js";
import { field } from "./ui-field.js";
import { mark } from "./ui-mark.js";
import { pendingDot } from "./ui-state.js";
import { RULES } from "./ui-css.js";
import { lookOf, painted, lastOp } from "./ui-draw.js";
import { Answers } from "./ui-match.js";

/** The most characters a tab's name holds. */
export const TAB_NAME_LIMIT = 64;

const node = (classes, parent = null, tag = "span") => ({ tag, attrs: {}, classes: classes.filter(Boolean), parent, children: [] });
const BAR = node(["kanso-tab-bar"], null, "div");
const listNode = ({ size, track, disabled, bar }) => node(["kanso-tabs", size !== "md" && `kanso-tabs--${size}`, track && "kanso-tabs--track", disabled && "kanso-control--off"],
  bar ? BAR : null, "div");
const tabNode = (list, { on, square, armed, pending, held }) => node(["kanso-tabs__tab", on && "kanso-tabs__tab--on", square && "kanso-tabs__tab--icon",
  armed && "kanso-action--armed", pending && "kanso-state-line--pending", held && "kanso-control--held"], list);

// A group and each of its tabs look the same every time their states are the same: each look is worked out once.
const known = new Answers();
const listLook = (group) => known.of(JSON.stringify(group), () => lookOf(listNode(group), RULES, null, false));
const tabLooks = (group, states) => known.of(JSON.stringify([group, states]), () => {
  const tab = tabNode(listNode(group), states);
  const own = lookOf(tab, RULES, null, states.live);
  return {
    tab: own, inset: lastOp(own.own, "px")?.[1] ?? 0,
    label: lookOf(node(["kanso-tabs__label"], tab), RULES, null, false),
    glyph: lookOf(node(["kanso-icon"], tab, "svg"), RULES, null, false),
    dot: lookOf(node(["kanso-tabs__dot"], tab, "i"), RULES, null, false),
    close: lookOf(node(["kanso-icon", "kanso-tabs__close"], tab, "svg"), RULES, null, !group.disabled),
    insertion: lookOf(node(["kanso-tabs__insertion"], listNode(group), "i"), RULES, null, false),
  };
});

const glyph = (icon, looks, c) => painted(svg(glyphOf(icon)), looks.glyph, c);

// The press stays on the ×: the tab under it is not chosen. A tab that is off draws its × and does nothing.
const closeGlyph = (id, c, looks, onClose, disabled) => painted(div().id(`${id}-close`), looks.close, c)
  .when(!disabled, (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); onClose(cx); }))
  .child(glyph("x", looks, c));

const nameOf = (id, item, c, looks) => (item.editing
  ? div().id(`${id}-rename`).min_w(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
    .child(field(`${id}-name`, item.editing, c, { inline: true, spoken: item.label }))
  : painted(div(), looks.label, c).child(item.label));

/** One tab. `item`: { key, label, icon, dot, tip, mark, pending, held, armed, editing, closable }; `dot` marks it while unselected, `mark` is a status drawn after the name,
 * `editing` the TextField renaming it in place. `group`: its group's size, track, disabled and bar. `onClose`: the chosen tab ends with ×.
 * `onPress`: a left press, before the tab keeps it from the window. */
export function tabItem(id, item, c, { group, on = false, square = false, index = 0, count = 1, onChange = null, onClose = null, onPress = null } = {}) {
  const { disabled } = group;
  const armed = Boolean(item.armed) && !disabled;
  const states = { on, square, armed, pending: Boolean(item.pending), held: Boolean(item.held), live: !disabled && !on && !armed && !item.held };
  const looks = tabLooks(group, states);
  const dot = (item.dot || (square && item.mark === "blocked")) && !on;
  // The ring is a border kept clear at rest, inside the Storybook's padding, so focusing never resizes the box.
  return painted(Button.new(id), looks.tab, c)
    .when(looks.inset > 0, (el) => el.px(looks.inset - FOCUS))
    .border(FOCUS).border_color(CLEAR).focus((s) => s.border_color(c.accent))
    .selected(on)
    .disabled(disabled)
    .set_position(index + 1, count)
    .accessibility_label(item.label)
    .when(square, (el) => el.tooltip(item.label))
    .when(!square && Boolean(item.tip), (el) => el.tooltip(item.tip))
    .when(!disabled, (el) => el.cursor_pointer()
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onPress?.(e, cx); })
      .on_click((_e, cx) => { if (!on) onChange?.(item.key, cx); }))
    .when(Boolean(item.icon), (el) => el.child(glyph(item.icon, looks, c)))
    .when(!square || !item.icon, (el) => el.child(nameOf(id, item, c, looks)))
    .when(Boolean(item.pending), (el) => el.child(pendingDot(`${id}-pending`, c)))
    .when(Boolean(item.mark) && !square, (el) => el.child(mark(c, { status: item.mark })))
    .when(dot, (el) => el.child(painted(div(), looks.dot, c)))
    .when(on && Boolean(item.closable && onClose) && !square && !item.editing, (el) => el.child(closeGlyph(id, c, looks, onClose, disabled)));
}

/** One tab group: the chosen tab is a quiet fill (raised on a track), never a weight, so nothing moves. Items: { key, label, icon, dot, tip, drop } and tabItem's states;
 * `drop` draws where a dragged tab lands, before it, or after it when "after". `size`: sm 24, md 28, lg 32, each tab's height. Collapsed: a column of icons, each label its tip.
 * `bar`: the group sits in the tab bar. `on`: each tab's own handlers by its key, `onClose`, `onPress`, and `wire(el)`, the pointer's handlers on it. */
export function tab(id, items, value, onChange, c, { disabled = false, spoken = null, collapsed = false, track = true, size = "lg", bar = false, on = {} } = {}) {
  const group = { size, track, disabled, bar };
  const seg = (item, index) => {
    const own = on[item.key] ?? {};
    const drawn = tabItem(`${id}-${item.key}`, item, c, { group, on: value === item.key, square: collapsed, index, count: items.length, onChange, onClose: own.onClose, onPress: own.onPress });
    const wired = own.wire ? own.wire(drawn) : drawn;
    const landing = item.drop ? painted(div(), tabLooks(group, {}).insertion, c) : null;
    return item.drop === "after" ? [wired, landing] : [landing, wired];
  };
  return painted((collapsed ? v_flex() : h_flex()).id(id), listLook(group), c)
    .when(Boolean(spoken), (el) => el.accessibility_label(spoken))
    .children(items.flatMap(seg).filter(Boolean));
}

/** Today's name for `tab`. */
export const segmented = tab;
