// Kanso's panel kit: the stacks, the wrappers that only place other pieces, each laid out as its Storybook class lays it out. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-stack.js.
import { h_flex, v_flex, Button, Popover } from "gpui-base";
import { div } from "gpui-kit";
import { G, H, R, SIDEBAR, TINT, CLEAR, alpha } from "./ui.js";
import { dot } from "./ui-dot.js";

// Each child piece drawn with its own id and its stack's handlers; a piece that draws nothing leaves no gap. `context` says where it sits.
const drawn = (id, c, kids, more = {}, context = {}) => kids
  .map((kid, i) => (typeof kid === "function" ? kid(`${id}-${i}`, c, more, context) : kid)).filter(Boolean);
const placed = (el, id, c, kids, more, context) => el.children(drawn(id, c, kids, more, context));

// A Button whose menu, open, hangs beside it (`anchor`): a press on the Button opens it; once open, Herdr's popover shuts it
// on a press, outside it or on Escape. `onOpen(open, cx)` says which. Without `onOpen` the pieces are only placed.
const withMenu = (anchor, room) => (id, c, _flags, [first, menu = null], more, wire, context) => {
  const { onOpen = null } = more;
  if (!onOpen) return placed(h_flex().flex_none(), id, c, [first, menu], more, context);
  const trigger = first(`${id}-button`, c, { ...more, onClick: menu ? null : (cx) => onOpen(true, cx) }, { ...context, ink: menu ? null : context.ink });
  const pop = Popover.new(id).trigger(trigger).anchor(anchor(context)).open(Boolean(menu)).on_open_change((open, cx) => onOpen(open, cx));
  return menu ? pop.content(room(context).child(menu(`${id}-menu`, c, {}, context))) : pop;
};

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
  // The view button: its press opens the menu.
  const trigger = first(`${id}-button`, c, { onClick: menu ? null : (cx) => onOpen(true, cx) });
  const pop = Popover.new(id).trigger(trigger).anchor("left_center").open(Boolean(menu)).on_open_change((open, cx) => onOpen(open, cx));
  return h_flex().flex_none().justify_center().mt(G.xs).mb(G.sm).child(menu ? pop.content(menu(`${id}-menu`, c, { onChange })) : pop);
};

// The Toolbar: large icon Buttons in a row 4 apart, or a column 8 apart; a press in it stays in it.
// In the header, the row is 40 tall and the column a hair below the header's top.
const toolbar = (id, c, { column }, kids, more, _wire, { header = false }) => placed((column ? v_flex().gap(G.sm) : h_flex().gap(G.xs)).id(id).flex_none().items_center()
  .when(header && !column, (el) => el.h(H.row)).when(header && column, (el) => el.pt(G.hair))
  .on_mouse_down("left", (_e, cx) => cx.stop_propagation()), id, c, kids, more, { column });
// Sort is dim at its default order, and drawn like the other tools once sorted.
const sortMenu = withMenu(({ column }) => (column ? "left_center" : "top_left"), ({ column }) => (column ? div().pl(G.xs) : div().pt(G.xs)));
const sort = (id, c, { sorted }, kids, more, wire, context) => sortMenu(id, c, {}, kids, more, wire, { ...context, ink: sorted ? null : "dim" });
// The header: 8 at its sides; collapsed, the rail's column, centred. Dawn's sky lies behind the rest.
const header = (id, c, { collapsed }, kids, more) => placed(v_flex().id(id).w_full().flex_none().relative().overflow_hidden().bg(c.chrome).px(G.sm).pb(G.xs)
  .when(collapsed, (el) => el.items_center()), id, c, kids, more, { header: true });
// The lights' row, as tall as the tab bar, Dawn Mode's pill at its right. Herdr draws the lights in this block itself,
// so the app kit has no windowControls (kit-parity `missing`) and the row lays out only what it holds.
const headerTitle = (id, c, _flags, kids, more) => placed(h_flex().w_full().h(H.tabBar).flex_none().items_center().justify_end().pl(G.xs), id, c, kids, more);

const STACKS = {
  toolbar: { states: ["column"], draw: toolbar },
  "toolbar add": { draw: (id, c, _flags, kids, more, _wire, context) => placed(h_flex().flex_none(), id, c, kids, more, context) },
  "toolbar sort": { states: ["sorted"], draw: sort },
  "toolbar group": { states: ["open"], draw: (id, c, { open }, kids, more, _wire, context) => placed(v_flex().id(id).flex_none().items_center().gap(G.xs).rounded(R.card)
    .when(open, (el) => el.bg(c.w4)), id, c, kids, more, context) },
  "toolbar menu": { draw: (id, c, _flags, kids, more, _wire, context) => placed(div(), id, c, kids, more, context) },
  header: { states: ["collapsed"], draw: header },
  "header title": { draw: headerTitle },
  "rail tile": { states: ["strong"], draw: railTile, pressable: true },
  "rail count": { draw: (id, c, _flags, kids) => h_flex().flex_none().items_center().gap(G.hair).children(drawn(id, c, kids)) },
  "view switch": { draw: viewSwitch },
  "view menu": { draw: (id, c, _flags, kids, more) => div().pl(G.xs).children(drawn(id, c, kids, more)) },
  // Proposed: the collapsed view button carries the dot while someone needs you, at the corner as an icon tab's.
  "view button": { states: ["asks"], draw: (id, c, { asks }, [button], more) => button(id, c, more).when(asks, (el) => el.relative().child(dot(c, "blocked").absolute().top(G.hair).right(G.hair))) },
  // Open, the footer's rows touch, 8 above and 16 below; in the rail, its icon Buttons a hair apart above 12. Both sit at the block's foot.
  footer: { draw: (id, c, _flags, kids, more) => placed(v_flex().id(id).size_full().justify_end().bg(c.chrome).pt(G.sm).px(G.sm).pb(G.lg), id, c, kids, more) },
  "rail footer": { draw: (id, c, _flags, kids, more) => placed(v_flex().id(id).size_full().justify_end().items_center().bg(c.chrome).pt(G.sm).pb(G.md).gap(G.hair), id, c, kids, more) },
  // Proposed: Settings and its menu, which opens over it; a refused update's block, a hair under its row and 8 above the next.
  "footer settings": { draw: withMenu(() => "bottom_left", () => div()) },
  "footer menu": { draw: (id, c, _flags, kids, more, _wire, context) => placed(div(), id, c, kids, more, context) },
  "footer refusal": { draw: (id, c, _flags, kids, more) => placed(div().mt(G.hair).mb(G.sm), id, c, kids, more) },
};

/** A stack the app draws: `variant` names its layout, `flags` its states, `kids` its child pieces, `more` its handlers;
 * `wire` adds the pointer's handlers to what is pressed, the stack itself unless it says. An unknown variant or state throws, as the Storybook's does. */
export function stackOf(id, c, { variant, on = false, label = "", ...flags }, kids, more = {}, wire = (el) => el, context = {}) {
  if (!Object.hasOwn(STACKS, variant)) throw new Error(`kit: the app has no stack "${variant}"`);
  const { states = [], draw, pressable = false } = STACKS[variant];
  const unknown = Object.keys(flags).filter((flag) => !states.includes(flag));
  if (unknown.length) throw new Error(`kit: stack "${variant}" has no state ${unknown.join(", ")}`);
  const el = draw(id, c, { on, label, ...flags }, kids, more, wire, context);
  return pressable ? el : wire(el);
}
