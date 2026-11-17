// The sidebar footer: kansō's update row, Settings and its one menu, both at chrome size; in the rail, squares.
import { svg } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { R, T, ICON_CHROME, CHROME_SQUARE, glyphOf } from "./ui.js";
import { row } from "./ui-row.js";
import { menu } from "./ui-menu.js";
import { mark } from "./ui-mark.js";
import { stateBlock } from "./ui-state.js";
import { ROW, PAD, REFUSAL, refusalBlock } from "./footer-model.js";

const inkOf = (c, quiet) => (quiet ? c.muted : c.text);
const chromeGlyph = (icon, ink) => svg(glyphOf(icon)).size(ICON_CHROME).flex_none().text_color(ink);

const line = (c, { key, icon, name, quiet, onClick }) => row(`footer-${key}`, c, {
  start: [chromeGlyph(icon, inkOf(c, quiet))], name, dimmed: quiet, onClick,
}).text_size(T.card); // the kit row has no size: the Storybook's row has none either

const square = (c, { key, icon, name, quiet, onClick }) => h_flex().id(`footer-${key}`).size(CHROME_SQUARE).flex_none()
  .items_center().justify_center().rounded(R.control).cursor_pointer().tooltip(name)
  .hover((s) => s.bg(c.subtle)).active((s) => s.bg(c.selected))
  .when(Boolean(onClick), (el) => el.on_click((_e, cx) => onClick(cx)))
  .child(chromeGlyph(icon, inkOf(c, quiet)));

const refusal = (c, { why, retry, font }) => stateBlock("footer-refused", { mark: mark(c, { status: "blocked" }), ...refusalBlock(why, retry), font }, c).mt(REFUSAL.above).mb(REFUSAL.below);

const withMenu = (trigger, c, { open, onOpenChange, items }) => {
  const pop = Popover.new("footer-settings-menu").trigger(trigger).anchor("bottom_left").open(open)
    .on_open_change((value, cx) => onOpenChange(value, cx));
  return open ? pop.content(menu("footer-settings-list", { title: "Settings", items }, c)) : pop;
};

/** `rows`: footerRows, each with its onClick; `settings`: { open, onOpenChange, items } for its menu; `refused`: { why, retry, font } or null. */
export function sidebarFooter(c, { collapsed, rows, settings, refused = null }) {
  const draw = collapsed ? square : line;
  const drawn = rows.flatMap((entry) => {
    const el = draw(c, entry);
    if (entry.key === ROW.settings) return [withMenu(el, c, settings)];
    return entry.key === ROW.update && refused && !collapsed ? [el, refusal(c, refused)] : [el];
  });
  return v_flex().size_full().bg(c.chrome).pt(PAD.top).justify_end()
    .when(collapsed, (el) => el.items_center().pb(PAD.railBottom).gap(PAD.railGap))
    .when(!collapsed, (el) => el.px(PAD.side).pb(PAD.bottom))
    .children(drawn);
}
