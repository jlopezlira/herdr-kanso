// Kanso's panel kit: the row, one named item in a list with its facts, its mark and its tools. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-row.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { G, H, R, T, ICON_ROW, ICON_INLINE, CLEAR, glyphOf, toneColor } from "./ui.js";
import { button } from "./ui-button.js";
import { chip } from "./ui-chip.js";
import { dot } from "./ui-dot.js";
import { keyHint } from "./ui-key-hint.js";
import { mark } from "./ui-mark.js";
import { PENDING, pendingDot } from "./ui-state.js";

// Each step in is the lead icon and its gap; the guide of a deeper row runs under its parent's icon.
const indent = (depth) => G.sm * (depth + 1) + ICON_ROW * depth;
const GUIDE = indent(1) + ICON_ROW / 2;

const glyph = (icon, side, ink) => svg(glyphOf(icon)).size(side).flex_none().text_color(ink);
// A tool's press stays on the tool: the row under it does not run its own click.
const alone = (onClick) => onClick && ((cx) => { cx.stop_propagation(); onClick(cx); });

// A fact is a string or `{ icon, text, tone, tip }`; in the detail a tone leads with its dot.
const factOf = (part) => (typeof part === "object" ? part : { text: part });
const tipped = (el, id, tip) => (tip ? el.id(id).tooltip(tip) : el);
const textOf = (c, id, { text, tone, tip }) => tipped(div().min_w(0).truncate().when(Boolean(tone), (el) => el.text_color(toneColor(c, tone))).child(String(text)), id, tip);
const fact = (c, id) => (part, i) => (typeof part === "string" ? div().flex_none().child(part)
  : h_flex().flex_none().items_center().gap(G.xs)
    .when(Boolean(part.icon), (el) => el.child(glyph(part.icon, ICON_INLINE, c.dim)))
    .when(Boolean(part.tone), (el) => el.child(dot(c, part.tone)))
    .child(textOf(c, `${id}-${i}`, part)));

const detailOf = (c, id, detail) => {
  const facts = [detail ?? []].flat().filter(Boolean);
  return facts.length ? h_flex().min_w(0).overflow_hidden().items_center().gap(G.sm).whitespace_nowrap().text_color(c.dim).children(facts.map(fact(c, `${id}-detail`))) : null;
};

// The second line: a string, or facts in a row where the first one gives way.
const secondOf = (c, id, second) => {
  const line = div().w_full().min_w(0).text_size(T.body).text_color(c.dim);
  if (typeof second === "string") return line.truncate().child(second);
  return h_flex().w_full().min_w(0).items_center().gap(G.sm).whitespace_nowrap().text_size(T.body).text_color(c.dim)
    .children(second.filter(Boolean).map((part, i) => textOf(c, `${id}-second-${i}`, factOf(part)).when(i > 0, (el) => el.flex_none())));
};

// A file's git `letter` takes the icon's slot; modified keeps the slot empty so names align.
const LETTER_TONES = { A: "dim", D: "dim", U: "blocked" };
const letterOf = (c, letter) => div().w(ICON_ROW).flex_none().text_center().text_size(T.body)
  .when(Object.hasOwn(LETTER_TONES, letter), (el) => el.text_color(toneColor(c, LETTER_TONES[letter])))
  .child(letter === "M" ? "" : letter);
// A tree row leads with its fold: a folder's chevron, `open` or not, or an empty slot for a file.
const foldOf = (c, open) => div().w(ICON_INLINE).flex_none().flex().items_center().justify_center()
  .when(open !== null, (el) => el.child(glyph(open ? "chevron-down" : "chevron-right", ICON_INLINE, c.dim)));
const slotOf = (c, { letter, icon, tone, ink }) => {
  if (letter) return letterOf(c, letter);
  return icon ? glyph(icon, ICON_ROW, tone ? toneColor(c, tone) : ink) : null;
};

const tool = (id, c) => ({ label, onClick, ...rest }, i) => button(`${id}-tool-${i}`, label, alone(onClick), c, { kind: "icon", size: "sm", ...rest });
const actionOf = (id, c, { label, onClick, ...rest }) => button(`${id}-action`, label, alone(onClick), c, { size: "sm", ...rest });
const verb = (id, c) => ({ label, onClick, ...rest }, i) => button(`${id}-verb-${i}`, label, alone(onClick), c, { kind: "quiet", size: "sm", ...rest });
const verbsOf = (id, c, verbs) => (verbs.length ? h_flex().w_full().flex_wrap().items_center().gap(G.sm).children(verbs.map(verb(id, c))) : null);

const groundOf = (c, { current, hover, title }) => {
  if (current) return c.selected;
  return hover && !title ? c.subtle : null;
};

const nameOf = ({ name, heading, title, ink }) => div().min_w(0).truncate().text_color(ink)
  .when(heading || title, (el) => el.font_semibold())
  .when(title, (el) => el.text_size(T.page))
  .child(name);

// Meta and flag give way to the tools while they show.
const asideOf = (c, { meta, flag, dimmed }) => {
  const { text, tone } = meta ? factOf(meta) : {};
  const ink = tone ? toneColor(c, tone) : dimmed ? c.muted : c.dim;
  return [
    meta ? div().flex_none().whitespace_nowrap().text_size(T.body).text_color(ink).child(String(text)) : null,
    flag ? glyph(flag, ICON_ROW, c.dim) : null,
  ];
};

const controlsOf = (id, c, { actions, count, action, tools, keys }) => [
  actions.length ? h_flex().flex_none().items_center().gap(G.hair).my(-G.xs).children(actions.map(tool(id, c))) : null,
  count ? chip(c, { label: count }) : null,
  action ? actionOf(id, c, action) : null,
  ...tools,
  ...keys.map((key) => keyHint(c, key)),
];

const ringOf = (c, { selected, focus }) => (selected || focus ? c.accent : CLEAR);
const heightOf = ({ title, under }) => {
  if (under) return null;
  return title ? H.row : H.line;
};

const guideOf = (c, depth) => (depth > 1 ? div().absolute().top_0().bottom_0().left(GUIDE).border_l_1().border_color(c.w12) : null);
// A tree row steps in by `level`; any other by its `depth`.
const leftOf = (level, depth) => (level === null ? indent(depth) : G.sm + G.lg * level);

// A row that acts is a Button: Tab reaches it, Enter and Space press it, a screen reader calls it a button. One a handle already drives stays plain.
const rootOf = (id, { onClick, focusHandle }) => (onClick && !focusHandle ? Button.new(id).flex() : h_flex().id(id));

const wire = (el, c, { onClick, onHover, onKey, focusHandle }) => el
  .when(Boolean(onClick), (e) => e.cursor_pointer().on_click((_e, cx) => onClick(cx)))
  .when(Boolean(onHover), (e) => e.on_hover(onHover))
  .when(Boolean(onKey), (e) => e.on_key_down(onKey))
  .when(Boolean(focusHandle), (e) => e.track_focus(focusHandle))
  .when(Boolean(onClick || focusHandle), (e) => e.focus((s) => s.border_color(c.accent)));

// `start`, `tools`: drawn elements before the icon and always at the end; `actions`: tools shown with `hover` or `focus`; `keys`: key hint props.
// `level` makes it a tree row, `open` its folder's fold; `verbs`: quiet word actions on a line under it.
export function row(id, c, {
  icon = null, tone = null, letter = null, level = null, open = null, name, detail = null, meta = null, chip: count = null, flag = null, mark: status = "none", second = null, heading = false, title = false,
  depth = 0, selected = false, current = false, dimmed = false, pending = false, hover = false, focus = false, actions = [], action = null, verbs = [], start = [], tools = [], keys = [],
  onClick = null, onHover = null, onKey = null, focusHandle = null,
} = {}) {
  const ink = dimmed ? c.muted : c.text;
  const shown = hover || focus;
  const under = Boolean(second) || verbs.length > 0;
  const ground = groundOf(c, { current, hover, title });
  const height = heightOf({ title, under });
  const line = h_flex().w_full().min_w(0).items_center().gap(G.sm).when(Boolean(second && title), (el) => el.h(H.row)).children([
    ...start,
    level === null ? null : foldOf(c, open),
    slotOf(c, { letter, icon, tone, ink }),
    nameOf({ name, heading, title, ink }),
    detailOf(c, id, detail),
    div().flex_1(),
    ...(shown && actions.length ? [] : asideOf(c, { meta, flag, dimmed })),
    ...controlsOf(id, c, { actions: shown ? actions : [], count, action, tools, keys }),
    pending ? pendingDot(`${id}-pending`, c) : null,
    mark(c, { status }),
  ].filter(Boolean));
  // The ring is a border kept clear at rest, so a focus or a pick never moves the content.
  return wire(rootOf(id, { onClick, focusHandle }).relative().min_w(0).mx(-G.sm).items_center().rounded(R.control)
    .border_2().border_color(ringOf(c, { selected, focus }))
    .pl(leftOf(level, depth) - G.hair).pr(G.sm - G.hair).text_size(T.value).text_color(ink)
    .when(under && !title, (el) => el.py(G.sm - G.hair))
    .when(Boolean(height), (el) => el.h(height))
    .when(Boolean(ground), (el) => el.bg(ground))
    .when(!title, (el) => el.hover((s) => s.bg(current ? c.selected : c.subtle)).active((s) => s.bg(c.selected)))
    .when(pending, (el) => el.opacity(PENDING))
    .children([guideOf(c, depth)].filter(Boolean))
    .child(under ? v_flex().w_full().min_w(0).gap(G.sm).child(line)
      .children([second ? secondOf(c, id, second) : null, verbsOf(id, c, verbs)].filter(Boolean)) : line), c, { onClick, onHover, onKey, focusHandle });
}
