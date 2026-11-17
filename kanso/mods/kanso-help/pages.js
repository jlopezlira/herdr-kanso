// The one window kansō help and kansō settings share: keys, head, page tabs, and the page's own scroll.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { G } from "./ui.js";
import { segmented } from "./ui-tab.js";

export function pagedDialog({ name, handle, onKey, head, tabs, tab, page, onTab, t, c }) {
  return v_flex().id(`kanso-${name}`).track_focus(handle).size_full().min_h(0).p(20).bg(t.popover).text_color(t.foreground)
    .on_key_down(onKey)
    .child(head)
    .child(div().pt(G.md).child(segmented(`${name}-pages`, tabs, tab, onTab, c)))
    .child(v_flex().id(`${name}-scroll-${tab}`).flex_1().min_h(0).pt(G.lg).overflow_y_scrollbar()
      .child(div().flex_none().w_full().child(page)));
}
