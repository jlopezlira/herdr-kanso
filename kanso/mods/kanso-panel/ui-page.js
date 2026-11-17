// Kanso's panel kit: a panel page's frame, size, skeleton and metrics. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-page.js.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, PAGE } from "./ui.js";
import { skeletonOf } from "./ui-skeleton.js";

export const pageFrame = (c, background = c.canvas) => v_flex().size_full().min_h(0).bg(background).text_color(c.text);
const pagePadding = (narrow) => h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28);
const pageContent = (narrow, gap = narrow ? 32 : 44) => v_flex().w_full().max_w(PAGE.w).gap(gap);
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

const headerBones = (c) => skeletonOf("kanso-skeleton-header", c, { shape: "header" });
export const pageBones = (c, narrow, { body, background = c.canvas, gap } = {}) => pageFrame(c, background)
  .child(pagePadding(narrow).child(pageContent(narrow, gap).child(headerBones(c)).child(body)));
// A list's first read: three two-line rows.
export const listBones = (c) => skeletonOf("kanso-skeleton", c, { shape: "two lines", count: 3 });

export const metricStats = (stats, c, narrow) => h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
  .children(stats.map((stat) => h_flex().items_end().gap(PAGE.unitGap).when(Boolean(stat.tip), (el) => el.tooltip(stat.tip))
    .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(c.text).child(stat.value))
    .child(div().pb(PAGE.unitY).text_size(PAGE.note).text_color(c.dim).child(stat.unit))));

export const pageBody = (narrow, draw) => pagePadding(narrow).child(draw(pageContent(narrow)));
export const toolbar = (c) => h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border);
const fileToolbar = (c) => h_flex().h(PAGE.toolbar).flex_none().px(PAGE.toolbarX).gap(8).items_center().border_b(1).border_color(c.border);
export const detailColumn = () => v_flex().flex_1().min_w(0).gap(2);
export const detailRow = (column) => h_flex().w_full().items_end().gap(G.md).child(column);

export const documentBones = (c, body) => pageFrame(c).child(fileToolbar(c).child(headerBones(c))).child(body);
export const scopedColumn = (scope) => v_flex().w_full().gap(G.lg).when(Boolean(scope), (el) => el.child(scope));

export function sizedPage(root, narrow, draw) {
  return root.on_size_change(pageSize.call(this)).child(pageBody(narrow, draw));
}
