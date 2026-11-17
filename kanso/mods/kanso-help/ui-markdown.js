// Kanso's panel kit: markdown, prose in blocks with headings, lists, tables and code; Herdr's TextView draws each block's words. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-markdown.js.
import { v_flex, TextView } from "gpui-base";
import { G, R, T, LH } from "./ui.js";
import { markdownBlocks } from "./pure.js";

// A block's ground: none at rest, the pointer's wash, or the raised field with the accent ring while it is edited.
const GROUNDS = {
  rest: (el) => el.py(G.hair),
  hover: (el, c) => el.py(G.hair).bg(c.subtle),
  editing: (el, c) => el.py(G.xs).bg(c.raised).border_2().border_color(c.accent),
};

const wordsOf = (id, source, onLink) => {
  const words = TextView.markdown(`${id}-words`, source);
  return onLink ? words.on_link_click(onLink) : words;
};

/** One block: `state` rest, hover or editing; `content`, drawn elements in place of its formatted `source` (the editor's field, a picture), a string among them drawn as markdown words.
 * `onPress` (a press on the block, as `on_mouse_down`) gives it the pointer's wash; its words stay selectable. `onLink` takes a link's press. */
export const markdownBlock = (id, c, { source = "", state = "rest", content = [] }, handlers = {}) => {
  const { onLink = null, onPress = null } = handlers, ground = GROUNDS[state] ?? GROUNDS.rest;
  return ground(v_flex().id(id).w_full().gap(G.sm).px(G.sm).rounded(R.control).text_size(T.card).line_height(LH.body).text_color(c.text), c)
    .when(Boolean(onPress) && state === "rest", (el) => el.hover((s) => s.bg(c.subtle)).on_mouse_down("left", onPress))
    .children(content.length ? content.map((part, k) => (typeof part === "string" ? wordsOf(`${id}-${k}`, part, onLink) : part)) : [wordsOf(id, source, onLink)]);
};

/** A document: `source` in its blocks, split as the Storybook splits them; the `block`th (from 1) is drawn in `state`. */
export const markdown = (id, c, { source, block = 0, state = "rest" }, handlers = {}) => v_flex().id(id).w_full().gap(G.xs)
  .children(markdownBlocks(source).map((one, i) => markdownBlock(`${id}-${i}`, c, { source: one, state: i + 1 === block ? state : "rest" }, handlers)));
