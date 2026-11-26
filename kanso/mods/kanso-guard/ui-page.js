// Kanso's panel kit: a panel page's frame, size and skeleton. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-page.js.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, T, PAGE } from "./ui.js";
import { iconButton, quietLink } from "./ui-button.js";
import { skeletonOf } from "./ui-skeleton.js";
import { tipText } from "./ui-tooltip.js";

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


export const pageBody = (narrow, draw, gap) => pagePadding(narrow).child(draw(pageContent(narrow, gap)));
export const toolbar = (c) => h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border);
const fileToolbar = (c) => h_flex().h(PAGE.toolbar).flex_none().px(PAGE.toolbarX).gap(8).items_center().border_b(1).border_color(c.border);
export const detailColumn = () => v_flex().flex_1().min_w(0).gap(2);
export const detailRow = (column) => h_flex().w_full().items_end().gap(G.md).child(column);

export const documentBones = (c, body) => pageFrame(c).child(fileToolbar(c).child(headerBones(c))).child(body);
export const scopedColumn = (scope) => v_flex().w_full().gap(G.lg).when(Boolean(scope), (el) => el.child(scope));

export function sizedPage(root, narrow, draw, sizing) {
  return root.on_size_change(pageSize.call(this, sizing)).child(pageBody(narrow, draw));
}

export function scrollPage(id, c, narrow, draw, sizing) {
  return sizedPage.call(this, pageFrame(c).id(id).overflow_y_scrollbar(), narrow, draw, sizing);
}

export const pageHeader = (title, tools) => h_flex().w_full().items_center().justify_between().gap(G.md).child(title)
  .child(h_flex().gap(G.xs).items_center().flex_none().children(tools.filter(Boolean)));
export const backRow = (id, c, words, onBack) => h_flex().w_full().gap(G.sm).items_center()
  .child(iconButton(id, "chevron-left", "Back", onBack, c))
  .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(words));
export const pageSections = (narrow) => v_flex().w_full().gap(narrow ? 36 : 48);

const REFRESH = "Refresh";
export const refreshTip = ({ busy = false, working = "", stamp = "" }) => (busy ? working : [REFRESH, stamp].filter(Boolean).join(" · "));
export const refreshTool = (id, c, { busy = false, enabled = true, working = "", stamp = "" }, onClick) => iconButton(id, "refresh-cw", refreshTip({ busy, working, stamp }), onClick, c, { spin: busy, disabled: busy || !enabled });

export const moreLink = (id, c, { open, hidden, ruled = false }, onClick) => h_flex().pt(ruled ? G.md : G.sm)
  .when(ruled, (el) => el.border_t(1).border_color(c.border))
  .child(quietLink(id, open ? "Show fewer" : `Show ${hidden} more`, onClick, c));

export const chartRoom = (height) => height + 18;
export const chartColumn = (c, { tip, marked = false, value = "" }, room) => v_flex().flex_1().min_w(0).h(room).items_center().justify_end().gap(G.xs).tooltip(tipText({ label: tip }))
  .when(marked, (el) => el.child(div().text_size(T.micro).text_color(c.text).whitespace_nowrap().child(value)));
export const barChart = (c, { head = null, columns, room = 0, axis }) => v_flex().w_full().gap(G.sm)
  .when(Boolean(head), (el) => el.child(head))
  .child(h_flex().w_full().when(room > 0, (el) => el.h(room)).items_end().children(columns))
  .child(h_flex().w_full().justify_between().children(axis.map((label) => div().text_size(T.micro).text_color(c.dim).child(label))));
