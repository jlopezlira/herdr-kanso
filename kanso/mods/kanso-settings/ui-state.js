// Kanso's panel kit: empty, failure, pending and undo, each drawn one way everywhere. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-state.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, R, T, ICON_ROW, breathe, glyphOf } from "./ui.js";
import { button } from "./ui-button.js";

/** A reversible action, done: what happened, and Undo at the end of its line. */
export const undoLine = (id, text, onUndo, c) => h_flex().id(id).min_w(0).items_center().gap(G.md)
  .child(div().min_w(0).truncate().text_size(T.body).font_medium().text_color(c.text).child(text))
  .child(button(`${id}-undo`, "Undo", onUndo, c, { kind: "tonal", small: true }));

/** Empty: the view's icon, one sentence and at most one tonal action, centred where the list would be. `action`: { label, onClick }. */
export const stateEmpty = (id, icon, words, c, action = null) => v_flex().id(id).w_full().items_center().gap(G.sm).px(G.lg).py(G.xl)
  .child(svg(glyphOf(icon)).size(20).flex_none().text_color(c.dim))
  .child(div().w_full().text_center().text_size(T.value).text_color(c.muted).child(words))
  .when(Boolean(action), (el) => el.child(button(`${id}-action`, action?.label, action?.onClick, c, { kind: "tonal" })));

/** Failure, block: a blocked edge; the mark and our words, the source's words at most two lines, then the fixes: first solid, the rest tonal.
 * `fixes`: [{ label, onClick }]; `font`: the evidence's mono family. */
export function stateBlock(id, { mark, what, why = null, fixes = [], font = null }, c) {
  const evidence = div().w_full().max_h(T.mono * 3).overflow_hidden().text_size(T.mono).line_height(1.5).text_color(c.muted).tooltip(why ?? "").child(why ?? "");
  return v_flex().id(id).w_full().p(G.md).gap(G.xs).rounded(R.card).border_1().border_color(c.blocked)
    .child(h_flex().w_full().min_w(0).items_center().gap(G.sm).child(mark)
      .child(div().flex_1().min_w(0).text_size(T.card).font_medium().text_color(c.text).child(what)))
    .when(Boolean(why), (el) => el.child(h_flex().w_full().pl(ICON_ROW + G.sm).child(font ? evidence.font_family(font) : evidence)))
    .when(fixes.length > 0, (el) => el.child(h_flex().w_full().pl(ICON_ROW + G.sm).pt(G.xs).gap(G.sm)
      .children(fixes.map((f, i) => button(`${id}-fix-${i}`, f.label, f.onClick, c, { kind: i ? "tonal" : "solid" }).flex_1()))));
}

/** Failure on a line (status bar, pane header, toast): the mark, our words, and the one fix as a small tonal button. `fix`: { label, onClick }. */
export const stateLine = (id, mark, what, c, fix = null) => h_flex().id(id).min_w(0).items_center().gap(G.sm)
  .child(mark)
  .child(div().min_w(0).truncate().text_size(T.value).font_medium().text_color(c.text).child(what))
  .when(Boolean(fix), (el) => el.child(button(`${id}-fix`, fix?.label, fix?.onClick, c, { kind: "tonal", small: true })));

/** Pending: the new state drawn at once at this opacity, with `pendingDot` breathing beside it until the write is confirmed. */
export const PENDING = 0.8;
export const pendingDot = (id, c) => breathe(div().id(id).size(G.xs).flex_none().rounded_full().bg(c.muted));
