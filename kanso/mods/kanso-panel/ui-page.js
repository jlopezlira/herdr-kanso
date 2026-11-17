// Kanso's panel kit: a panel page's frame, size, skeleton and metrics. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-page.js.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, breathe } from "./ui.js";
import { ghost } from "./ui-skeleton.js";

export const pageFrame = (c, background = c.canvas) => v_flex().size_full().min_h(0).bg(background).text_color(c.text);
const pagePadding = (narrow) => h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28);
const pageContent = (narrow, gap = narrow ? 32 : 44) => v_flex().w_full().max_w(1080).gap(gap);
export const skeletonStack = (narrow, gap = narrow ? 36 : 48) => breathe(v_flex().id("kanso-skeleton").w_full().gap(gap));
export const heroStack = (heading) => v_flex().w_full().gap(G.xl).child(heading);
export const heroHeading = () => v_flex().gap(G.xs);
export const metricValue = () => h_flex().flex_wrap().items_end().gap_x(G.md);

export function pageSize({ always = false } = {}) {
  return (size, cx) => {
    const changed = Math.abs((this.width || 0) - size.width) >= 1;
    if (always || changed) this.width = size.width;
    if (changed) cx.notify();
  };
}

export function pageBones(c, narrow, { title, body, extra = [], background = c.canvas, gap } = {}) {
  const { header } = ghost(c);
  return pageFrame(c, background).child(pagePadding(narrow)
    .child(pageContent(narrow, gap).child(header(narrow ? title.narrow : title.wide, narrow ? 17 : 20)).children(extra).child(body)));
}

export const skeletonMetrics = (block, narrow, widths = [30, 46, 40, 30]) => h_flex().gap(narrow ? G.xl : 48).pt(G.md)
  .children(widths.map((width) => block(width, narrow ? 18 : 22, 4)));
export const skeletonBars = (block, heights) => heights.map((height) => v_flex().flex_1().min_w(0).items_center().justify_end().child(block(2, height, 1)));
export const metricStats = (stats, c, narrow) => h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
  .children(stats.map((stat) => h_flex().items_end().gap(6).when(Boolean(stat.tip), (el) => el.tooltip(stat.tip))
    .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(c.text).child(stat.value))
    .child(div().pb(3).text_size(12).text_color(c.dim).child(stat.unit))));

export const pageBody = (narrow, draw) => pagePadding(narrow).child(draw(pageContent(narrow)));
export const toolbar = (c) => h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border);
const fileToolbar = (c) => h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(c.border);
export const detailColumn = () => v_flex().flex_1().min_w(0).gap(2);
export const detailRow = (column) => h_flex().w_full().items_end().gap(G.md).child(column);

export const documentBones = (c, width, body) => pageFrame(c).child(fileToolbar(c).child(ghost(c).header(width, 13))).child(body);
export const scopedColumn = (scope) => v_flex().w_full().gap(G.lg).when(Boolean(scope), (el) => el.child(scope));

export function sizedPage(root, narrow, draw) {
  return root.on_size_change(pageSize.call(this)).child(pageBody(narrow, draw));
}
