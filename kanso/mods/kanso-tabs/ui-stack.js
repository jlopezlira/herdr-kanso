// Kanso's panel kit: the stacks, the wrappers that only place other pieces, each laid out as its Storybook class lays it out. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-stack.js.
import { h_flex, Button, Popover } from "gpui-base";
import { div } from "gpui-kit";
import { G, H, R, SIDEBAR, TINT, CLEAR, alpha } from "./ui.js";

// Each child piece drawn with its own id; a piece that draws nothing leaves no gap.
const drawn = (id, c, kids, more = {}) => kids.map((kid, i) => (typeof kid === "function" ? kid(`${id}-${i}`, c, more) : kid)).filter(Boolean);

// One group on the rail, centred in its row: a button, so Tab reaches it and Enter or Space presses it; `wire` gives it the pointer's handlers.
// Its ring is a border kept clear at rest, so nothing moves.
const railTile = (id, c, { on, strong, label }, kids, { onClick = null }, wire) => h_flex().w_full().h(SIDEBAR.railRow).flex_none().justify_center().items_center().child(wire(Button.new(id).w(SIDEBAR.tile).h(H.row).flex_none()
  .flex().flex_col().items_center().justify_center().gap(G.hair).rounded(R.control).cursor_pointer()
  .border_1().border_color(strong ? alpha(c.accent, TINT.ring) : CLEAR).focus((s) => s.border_color(c.accent))
  .selected(on)
  .when(Boolean(label), (el) => el.accessibility_label(label).tooltip(label))
  .when(on, (el) => el.bg(c.w12))
  .when(!on, (el) => el.hover((s) => s.bg(c.w4)))
  .when(Boolean(onClick), (el) => el.on_click((_e, cx) => onClick(cx)))
  .children(drawn(id, c, kids))));

// Open, the track across the sidebar's gutter. Collapsed (`onOpen`), the current view's button; open, its menu beside it.
// A press on the button opens the menu; once it is open, Herdr's popover closes it on a press, outside it or on Escape.
const viewSwitch = (id, c, _flags, [first, menu = null], { onChange = null, onOpen = null }) => {
  if (!onOpen) return first(`${id}-tabs`, c, { onChange }).mx(G.sm).mt(G.xs).mb(G.sm);
  const trigger = first(`${id}-button`, c, { onClick: menu ? null : (cx) => onOpen(true, cx) });
  const pop = Popover.new(id).trigger(trigger).anchor("left_center").open(Boolean(menu)).on_open_change((open, cx) => onOpen(open, cx));
  return h_flex().flex_none().justify_center().mt(G.xs).mb(G.sm).child(menu ? pop.content(menu(`${id}-menu`, c, { onChange })) : pop);
};

const STACKS = {
  "rail tile": { states: ["strong"], draw: railTile, pressable: true },
  "rail count": { draw: (id, c, _flags, kids) => h_flex().flex_none().items_center().gap(G.hair).children(drawn(id, c, kids)) },
  "view switch": { draw: viewSwitch },
  "view menu": { draw: (id, c, _flags, kids, more) => div().pl(G.xs).children(drawn(id, c, kids, more)) },
};

/** A stack the app draws: `variant` names its layout, `flags` its states, `kids` its child pieces, `more` its handlers;
 * `wire` adds the pointer's handlers to what is pressed, the stack itself unless it says. An unknown variant or state throws, as the Storybook's does. */
export function stackOf(id, c, { variant, on = false, label = "", ...flags }, kids, more = {}, wire = (el) => el) {
  if (!Object.hasOwn(STACKS, variant)) throw new Error(`kit: the app has no stack "${variant}"`);
  const { states = [], draw, pressable = false } = STACKS[variant];
  const unknown = Object.keys(flags).filter((flag) => !states.includes(flag));
  if (unknown.length) throw new Error(`kit: stack "${variant}" has no state ${unknown.join(", ")}`);
  const el = draw(id, c, { on, label, ...flags }, kids, more, wire);
  return pressable ? el : wire(el);
}
