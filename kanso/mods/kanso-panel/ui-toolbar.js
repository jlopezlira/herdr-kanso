// Kanso's panel kit: the Toolbar, large icon buttons in a row; collapsed, a column whose caret holds Sort and Search. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-toolbar.js.
import { div } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { G, R } from "./ui.js";
import { button } from "./kit.js";

/** What + adds in each view. */
export const addLabels = Object.freeze({ spaces: "Add project", agents: "New conversation", threads: "New conversation" });

const tool = (id, icon, label, onClick, c, o = {}) => button({ ...o, label, kind: "icon", size: "lg", icon: `lu-${icon}` })(id, c, { onClick });

// Sort is dim at its default order; open, its menu hangs under it, or beside it in a column.
const sortTool = (id, c, { column, sorted, sortOpen, sortTip, sortMenu, on }) => {
  const trigger = tool(`${id}-sort`, "arrow-up-down", sortTip, null, c, { active: sortOpen, color: sorted || sortOpen ? null : c.dim });
  const pop = Popover.new(`${id}-sort-menu`).trigger(trigger).anchor(column ? "left_center" : "top_left")
    .open(sortOpen).on_open_change((next, cx) => on.sort?.(next, cx));
  const room = column ? div().pl(G.xs) : div().pt(G.xs);
  return sortOpen && sortMenu ? pop.content(room.child(sortMenu())) : pop;
};

// Collapsed, Sort and Search fold under a caret; open, they stack below it on a quiet wash.
const more = (id, c, props) => {
  const { open, on } = props;
  const caret = tool(`${id}-more`, open ? "chevron-up" : "chevron-down", open ? "Fewer tools" : "More tools", on.more, c);
  return v_flex().id(`${id}-group`).flex_none().items_center().gap(G.xs).rounded(R.card).child(caret)
    .when(open, (el) => el.bg(c.w4).child(sortTool(id, c, props)).child(tool(`${id}-search`, "search", "Search", on.search, c)));
};

/** `view` names what + adds. `on`: { add, search, sidebar, more, sort(open, cx) }; `sortMenu()` draws the open Sort menu, `sortTip` its tooltip.
 * `sorted`: the order is not the default. `column`: collapsed, + and Show sidebar stay and the caret, `open`, holds Sort and Search.
 * Not the Storybook's `toolbar` as is: `sortMenu` is a function here, and the app gives the tips and handlers. */
export function toolbar(id, c, { view = "spaces", column = false, open = false, sorted = false, sortOpen = false, sortTip = "Sort", sortMenu = null, on = {} } = {}) {
  const props = { column, open, sorted, sortOpen, sortTip, sortMenu, on };
  const add = tool(`${id}-add`, "plus", addLabels[view] ?? addLabels.spaces, on.add, c);
  const sidebar = tool(`${id}-sidebar`, "panel-left", column ? "Show sidebar" : "Hide sidebar", on.sidebar, c);
  const frame = (column ? v_flex().gap(G.sm) : h_flex().gap(G.xs)).id(id).flex_none().items_center()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  return column
    ? frame.child(add).child(sidebar).child(more(id, c, props))
    : frame.child(add).child(div().flex_1()).child(sortTool(id, c, props)).child(tool(`${id}-search`, "search", "Search", on.search, c)).child(sidebar);
}
