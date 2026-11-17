// Kanso's panel kit: the silhouette a view draws while it loads. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-skeleton.js.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { G, H, R, W, breathe } from "./ui.js";

const SK_W = [120, 96, 140, 84, 110, 72];
// A height is a fixed row with its icon; without one, the py(9) list row the panels already use.
export function skeleton(c) {
  const block = (w, h, radius = 3) => div().w(w).h(h).flex_none().rounded(radius).bg(c.border);
  const line = (w, h = 9) => block(w, h, 3);
  const row = (i, h) => {
    const name = line(SK_W[(i ?? 0) % SK_W.length], 9);
    const base = h_flex().w_full().items_center().gap(G.md);
    return h
      ? base.h(h).flex_none().px(8).child(block(14, 14, 4)).child(name).child(div().flex_1())
      : base.py(9).child(name).child(div().flex_1()).child(block(40, 11));
  };
  const header = (titleW = 88, titleH = 14) => h_flex().w_full().items_center().justify_between().gap(G.md)
    .child(line(titleW, titleH)).child(block(26, 26, 6));
  return { line, block, row, header };
}
export const ghost = skeleton;

/** One breathing tab while a tab bar waits for its computer: the first long, every later one short. */
export const tabSkeleton = (id, c, index) => breathe(div().id(id).w(index ? W.tabSkeletonShort : W.tabSkeleton).h(H.icon).flex_none().rounded(R.control).bg(c.border));
