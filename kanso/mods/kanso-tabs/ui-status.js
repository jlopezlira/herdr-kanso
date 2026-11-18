// Kanso's panel kit: a status bar item, its mark or icon with its words, the item of an agent waiting for you, and panes per view. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-status.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, R, W, LINE, FOCUS, PANE, CLEAR, ICON_ROW, ICON_INLINE, glyphOf, toneColor } from "./ui.js";
import { mark } from "./ui-mark.js";
import { button } from "./ui-button.js";
import { tipText } from "./ui-tooltip.js";
import { PENDING, pendingDot } from "./ui-state.js";

const leadOf = (c, status, icon) => {
  if (status) return mark(c, { status, size: "sm" });
  return icon ? svg(glyphOf(icon)).size(ICON_INLINE).flex_none() : null;
};

// The ground a wash sits on: inset, so the words stay where they were.
const washable = (el) => el.rounded(R.sm).mx(-G.xs).px(G.xs);

// A click goes where the item's fact lives. Under the pointer the wash; an item in a state keeps its colour.
const pressable = (el, c, { tip, onClick, tone }) => washable(el.cursor_pointer())
  .hover((s) => (tone ? s.bg(c.w7) : s.bg(c.w7).text_color(c.text)))
  .on_click((_e, cx) => onClick(cx))
  .when(Boolean(tip), (item) => item.tooltip(tip));

const frame = (id, c, { tip, onClick, tone = null }) => {
  const el = h_flex().id(id).flex_initial().min_w(0).items_center().gap(G.sm).when(Boolean(tone), (item) => item.text_color(toneColor(c, tone)));
  return onClick ? pressable(el, c, { tip, onClick, tone }) : el.when(Boolean(tip), (item) => item.tooltip(tip));
};

/** `mark`: an agent state drawn as its mark, else `icon`, a name in kanso-chrome's icons; `tone`: a tone name for an item in that state;
 * `pending`: drawn at once at the pending opacity with a breathing dot; `open`: its menu is open; `onClick` and `tip`: where it goes and what it says. */
export const statusItem = (id, c, { icon = null, mark: status = null, text = null, tone = null, pending = false, open = false, tip = null, onClick = null } = {}) => {
  const lead = leadOf(c, status, icon);
  return frame(id, c, { tip, onClick, tone })
    .when(open, (el) => washable(el).bg(c.w12))
    .when(pending, (el) => el.opacity(PENDING))
    .when(Boolean(lead), (el) => el.child(lead))
    .when(text != null && text !== "", (el) => el.child(div().min_w(0).truncate().child(String(text))))
    .when(pending, (el) => el.child(pendingDot(`${id}-pending`, c)));
};

/** Who waits: the blocked mark, the name, the question trimmed to its width, and +`more` for the others; neither the name nor +N folds.
 * The question has no colour of its own: muted with the bar, foreground with the item under the pointer. */
export const needsItem = (id, c, { name, question = null, more = 0, tip = null, onClick = null } = {}) => frame(id, c, { tip, onClick })
  .child(mark(c, { status: "blocked", size: "sm" }))
  .child(div().flex_none().font_medium().text_color(c.text).child(name))
  .when(Boolean(question), (el) => el.child(div().max_w(W.question).min_w(0).truncate().child(question)))
  .when(more > 0, (el) => el.child(div().flex_none().text_color(c.dim).child(`+${more}`)));

// The minimap's room: each column's Button keeps its ring clear around a hairline of side room, a hair from the next.
export const COLUMN = Object.freeze({ side: LINE + FOCUS, gap: G.hair });
// A pane's line: the one in front in the foreground, one in view or pinned muted, the rest dim.
const PANE_INK = { current: "text", seen: "muted" };
const focused = (el, handle) => (handle ? el.track_focus(handle) : el);
const columnButton = (id, c, { width, panes }, i, onChange) => button(`${id}-column-${i}`, `Column ${i + 1}`, onChange && ((cx) => onChange(i, cx)), c, {
  kind: "quiet",
  content: [v_flex().h(ICON_ROW).px(LINE).gap(LINE).justify_center()
    .children(panes.map((tone) => div().w(width).h(panes.length > 1 ? G.hair : G.xs).rounded_full().bg(c[PANE_INK[tone] ?? "dim"])))],
});

/** Panes per view: the number, which evens out on a press, between − and +. Their glyphs are clear unless `hover` (the pointer or the keyboard
 * is on it) or `open`, so nothing moves. `chords`: the key table's chords for fewer, more and fit. Proposed: `columns`, the minimap before it,
 * a Button per column, each `{ width, panes }` with a tone per pane. `on`: the presses `minus`, `plus`, `value` and `column(i, cx)`,
 * `hover(over, cx)`, and `focuses`, the handles of minus, plus and value. */
export const stepper = (id, c, { value = 2, open = false, hover = false, columns = [], chords = {} }, on = {}) => {
  const { minus = null, plus = null, value: even = null, column = null, hover: onHover = null, focuses = {} } = on;
  const shown = hover || open;
  const tool = (icon, label, chord, onClick) => focused(button(`${id}-${icon}`, label, onClick, c,
    { kind: "icon", icon, size: "sm", tip: tipText({ label, chord }), color: shown ? null : CLEAR }), focuses[icon]);
  const number = button(`${id}-value`, String(value), even, c, { kind: "quiet", content: [div().text_color(c.text).child(String(value))],
    tip: tipText({ label: `${value} per view`, chord: chords.fit, detail: "scroll to change, click to even out" }) });
  return h_flex().id(id).flex_none().items_center().gap(G.hair)
    .when(open, (el) => washable(el).bg(c.w12))
    .when(Boolean(onHover), (el) => el.on_hover((over, cx) => onHover(over, cx)))
    .when(columns.length > 0, (el) => el.child(h_flex().id(`${id}-columns`).min_w(0).max_w(PANE.pills).overflow_hidden().items_center().gap(COLUMN.gap).mr(G.sm)
      .children(columns.map((col, i) => columnButton(id, c, col, i, column)))))
    .child(tool("minus", "Fewer panes per view", chords.fewer, minus))
    .child(focused(number, focuses.value))
    .child(tool("plus", "More panes per view", chords.more, plus));
};
