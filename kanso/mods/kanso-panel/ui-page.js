// Kanso's panel kit: a panel page's frame, size and skeleton. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-page.js.
import { h_flex, v_flex } from "gpui-base";
import { G, PAGE } from "./ui.js";
import { skeletonOf } from "./ui-skeleton.js";

export const pageFrame = (c, background = c.canvas) => v_flex().size_full().min_h(0).bg(background).text_color(c.text);
const pagePadding = (narrow) => h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28);
const pageContent = (narrow, gap = narrow ? 32 : 44) => v_flex().w_full().max_w(PAGE.w).gap(gap);
export const heroStack = (heading) => v_flex().w_full().gap(G.xl).child(heading);
export const heroHeading = () => v_flex().gap(G.xs);

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
