// Kanso's panel kit: the toast, a notice on the popover ground with its lead, one sentence and at most one fix. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-toast.js.
import { div, image, svg } from "gpui-kit";
import { h_flex, Button } from "gpui-base";
import { G, T, ICON_ROW, CLEAR, glyphOf, toneColor } from "./ui.js";
import { mark as drawMark } from "./ui-mark.js";
import { dot } from "./ui-dot.js";
import { button, withLook } from "./ui-button.js";

export const LEVELS = Object.freeze({ error: "blocked", warning: "working", success: "done", info: "accent" });
// A name in kanso-chrome's icons; anything else, a path on any system, is Herdr's own picture.
const KIT_NAME = /^[a-z0-9-]+$/;

const glyph = (c, icon, tone) => (KIT_NAME.test(icon) ? svg(glyphOf(icon)).text_color(toneColor(c, tone)) : image(icon)).size(ICON_ROW).flex_none();
const centered = (el) => h_flex().size(ICON_ROW).flex_none().items_center().justify_center().child(el);

const leadOf = (c, level) => {
  if (level === "error") return drawMark(c, { status: LEVELS.error });
  if (level === "success") return glyph(c, "check", LEVELS.success);
  return centered(dot(c, LEVELS[level] ?? LEVELS.info));
};
const headOf = (c, { level, icon, status, tone }) => {
  if (status) return drawMark(c, { status });
  return icon ? glyph(c, icon, tone ?? LEVELS[level] ?? LEVELS.info) : leadOf(c, level);
};

/** `level`: error, warning, success or info, the lead without an icon; `icon`: a kit name or Herdr's picture, in `tone` or the level's;
 * `mark`: a state's mark instead; `action`: the fix word; `detail`: the tooltip. `onClick`: a press on the toast or its fix. */
export function toast(id, c, { level = "info", icon = null, title = "", action = null, mark = null, tone = null, detail = null, onClick = null } = {}) {
  const fix = (cx) => { cx.stop_propagation(); onClick?.(cx); };
  const root = Button.new(id).flex().size_full().pl(G.md).pr(G.sm).gap(G.sm).items_center()
    .border_2().border_color(CLEAR).focus((s) => s.border_color(c.accent));
  return withLook(root, { fill: c.popover, hover: c.subtle, press: c.selected })
    .when(Boolean(detail), (el) => el.tooltip(detail))
    .when(Boolean(onClick), (el) => el.on_click((_e, cx) => onClick(cx)))
    .child(headOf(c, { level, icon, status: mark, tone }))
    .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(c.text).child(title))
    .when(Boolean(action), (el) => el.child(button(`${id}-fix`, action, fix, c, { kind: "tonal", small: true })));
}
