// Kanso's panel kit: the tab group. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-tab.js.
import { svg } from "gpui-kit";
import { Button } from "gpui-base";
import { FOCUS, CLEAR, glyphOf } from "./ui.js";
import { field } from "./ui-field.js";
import { mark } from "./ui-mark.js";
import { pendingDot } from "./ui-state.js";
import { RULES } from "./ui-css.js";
import { lookOf, painted, lastOp, box } from "./ui-draw.js";
import { Answers } from "./ui-match.js";

/** The most characters a tab's name holds. */
export const TAB_NAME_LIMIT = 64;

const node = (classes, parent = null, tag = "span") => ({ tag, attrs: {}, classes: classes.filter(Boolean), parent, children: [] });
const BAR = node(["kanso-tab-bar"], null, "div");
const listNode = ({ size, track, disabled, bar }) => node(["kanso-tabs", size !== "md" && `kanso-tabs--${size}`, track && "kanso-tabs--track", disabled && "kanso-control--off"],
  bar ? BAR : null, "div");
const tabNode = (list, { on, square, armed, pending, held }) => node(["kanso-tabs__tab", on && "kanso-tabs__tab--on", square && "kanso-tabs__tab--icon",
  armed && "kanso-action--armed", pending && "kanso-state-line--pending", held && "kanso-control--held"], list);

const known = new Answers();
const tabLooks = (group, states) => known.of(JSON.stringify([group, states]), () => {
  const tab = tabNode(listNode(group), states);
  const own = lookOf(tab, RULES, null, states.live);
  return {
    tab: own, inset: lastOp(own.own, "px")?.[1] ?? 0,
    glyph: lookOf(node(["kanso-icon"], tab, "svg"), RULES, null, false),
    nodes: { list: listNode(group), close: node(["kanso-icon", "kanso-tabs__close"], tab, "svg"), label: node(["kanso-tabs__label"], tab), dot: node(["kanso-tabs__dot"], tab, "i"), insertion: node(["kanso-tabs__insertion"], listNode(group), "i") },
  };
});

const glyph = (icon, looks, c) => painted(svg(glyphOf(icon)), looks.glyph, c);

// The press stays on the ×: the tab under it is not chosen. A tab that is off draws its × and does nothing.
const closeGlyph = (id, c, looks, label, onClose, disabled) => painted(Button.new(`${id}-close`), lookOf(looks.nodes.close, RULES, null, !disabled), c)
  .m(-FOCUS).border(FOCUS).border_color(CLEAR).focus((s) => s.border_color(c.accent))
  .disabled(disabled)
  .accessibility_label(`Close ${label}`)
  .when(!disabled, (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); onClose(cx); }))
  .child(glyph("x", looks, c));

const nameOf = (id, item, c, looks) => (item.editing
  ? field(`${id}-name`, item.editing, c, { inline: true, spoken: item.label }).min_w(0)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
  : box(looks.nodes.label, c, RULES).child(item.label));

export function tabItem(id, item, c, { group, on = false, square = false, index = 0, count = 1, onChange = null, onClose = null, onPress = null } = {}) {
  const { disabled } = group;
  const armed = Boolean(item.armed) && !disabled;
  const states = { on, square, armed, pending: Boolean(item.pending), held: Boolean(item.held), live: !disabled && !on && !armed && !item.held };
  const looks = tabLooks(group, states);
  const dot = (item.dot || (square && item.mark === "blocked")) && !on;
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
    .when(dot, (el) => el.child(box(looks.nodes.dot, c, RULES)))
    .when(on && Boolean(item.closable && onClose) && !square && !item.editing, (el) => el.child(closeGlyph(id, c, looks, item.label, onClose, disabled)));
}

export function tab(id, items, value, onChange, c, { disabled = false, spoken = null, collapsed = false, track = true, size = "lg", bar = false, on = {} } = {}) {
  const group = { size, track, disabled, bar };
  const seg = (item, index) => {
    const own = on[item.key] ?? {};
    const drawn = tabItem(`${id}-${item.key}`, item, c, { group, on: value === item.key, square: collapsed, index, count: items.length, onChange, onClose: own.onClose, onPress: own.onPress });
    const wired = own.wire ? own.wire(drawn) : drawn;
    const landing = item.drop ? box(tabLooks(group, {}).nodes.insertion, c, RULES) : null;
    return item.drop === "after" ? [wired, landing] : [landing, wired];
  };
  return box(tabLooks(group, {}).nodes.list, c, RULES, id).when(collapsed, (el) => el.flex_col())
    .when(Boolean(spoken), (el) => el.accessibility_label(spoken))
    .children(items.flatMap(seg).filter(Boolean));
}

/** Today's name for `tab`. */
export const segmented = tab;
