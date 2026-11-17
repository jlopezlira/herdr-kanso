// Kanso's panel kit: a section's title with its note on the right. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-section.js.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { G, T, PAGE } from "./ui.js";

export function section(c, title, note) {
  return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.sm)
    .child(div().flex_none().text_size(T.title).text_color(c.text).child(title))
    .child(div().min_w(0).truncate().text_size(PAGE.note).text_color(c.dim).child(note ?? ""));
}
