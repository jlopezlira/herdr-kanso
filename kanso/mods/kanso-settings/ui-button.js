// Kanso's panel kit: the button, its quiet link and icon forms, and the press that asks twice. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-button.js.
import { div, svg } from "gpui-kit";
import { v_flex, Button } from "gpui-base";
import { G, H, R, T, ICON, ICON_ROW, ARM_MS, WASH, CLEAR, glyphOf, mix, well } from "./ui.js";

const filled = (fill, ink, c) => ({ fill, ink, hover: mix(fill, c.background, WASH.hover), press: mix(fill, c.background, WASH.press) });
/** The armed look: the accent fill, its hover and press washes, the accent foreground. */
export const armedLook = (c) => filled(c.accent, c.accentText, c);
const LOOKS = {
  solid: (c) => filled(c.primary, c.primaryText, c),
  tonal: (c) => ({ fill: c.subtle, ink: c.text, hover: c.selected, press: c.selected }),
  quiet: (c) => ({ fill: null, ink: c.muted, hover: c.subtle, press: c.selected }),
  icon: (c) => ({ fill: null, ink: c.muted, hover: c.subtle, press: c.selected }),
};

export const pressAgain = (verb) => `Press again to ${verb}`;

/** Both labels in one cell, the hidden one at no height: the box is the wider of the two at rest, so arming moves nothing. */
export function armedLabel(label, verb, on, text, { start = false } = {}) {
  const hidden = (el, hide) => (hide ? el.h(0).overflow_hidden() : el);
  return v_flex().when(start, (el) => el.items_start()).when(!start, (el) => el.items_center())
    .child(hidden(text(label).whitespace_nowrap(), on)).child(hidden(text(pressAgain(verb)).whitespace_nowrap(), !on));
}

/** solid: the one primary action; tonal: a wash, no edge; quiet: text only; icon: `label` is its tip. `icon`: a name in kanso-chrome's icons, or a path.
 * `verb`: the action asks twice; `armed` fills it with the accent and reads "Press again to <verb>". */
export function button(id, label, onClick, c, { kind = "solid", icon = null, small = false, disabled = false, spoken = label, verb = null, armed = false, active = false, spin = false, color = null } = {}) {
  const square = kind === "icon", on = armed && !disabled;
  const look = disabled ? { fill: kind === "quiet" ? null : well(c), ink: c.dim }
    : on ? armedLook(c)
      : active ? { ...LOOKS[kind](c), fill: c.selected, ink: c.text, hover: c.selected }
        : LOOKS[kind](c);
  const ink = disabled || on ? look.ink : color ?? (spin ? c.text : look.ink);
  const side = small ? H.compact : square ? H.icon : H.control;
  const text = (words) => div().text_size(small ? T.body : T.value).font_medium().text_color(ink).child(words);
  const glyph = icon ? svg(glyphOf(icon)).size(square ? ICON : ICON_ROW).flex_none().text_color(ink) : null;
  // The ring is a border kept clear at rest, so focusing never resizes the box.
  return Button.new(id).h(side).flex_none().items_center().justify_center().gap(G.sm).rounded(R.control)
    .border_2().border_color(CLEAR).focus((s) => s.border_color(c.accent))
    .disabled(disabled)
    .accessibility_label(on && verb ? pressAgain(verb) : spoken)
    .when(square, (el) => el.w(side).tooltip(spoken))
    .when(!square, (el) => el.px((small ? G.sm : G.md) - G.hair))
    .when(Boolean(look.fill), (el) => el.bg(look.fill))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(look.hover)).active((s) => s.bg(look.press)))
    .when(!disabled && Boolean(onClick), (el) => el.on_click((_e, cx) => onClick(cx)))
    .when(Boolean(glyph), (el) => el.child(spin ? glyph.spin(900) : glyph))
    .when(!square, (el) => el.child(verb ? armedLabel(label, verb, on, text, { start: kind === "quiet" }) : text(label)));
}

/** A quiet action on a line. */
export const quietLink = (id, label, onClick, c, { label: spoken = label, ...o } = {}) => button(id, label, onClick, c, { color: c.muted, ...o, spoken, kind: "quiet", small: true });

export const iconButton = (id, icon, tip, onClick, c, o = {}) => button(id, tip, onClick, c, { ...o, kind: "icon", icon });

/** What a view has armed: one `key` at a time, for ARM_MS. */
export class Armed {
  constructor() { this.key = null; this.at = 0; }

  is(key) { return this.key === key && Date.now() - this.at <= ARM_MS; }

  clear() { this.key = null; }

  press(key, cx, act) {
    if (this.is(key)) { this.key = null; act(cx); return; }
    this.key = key; this.at = Date.now(); cx.notify();
    cx.timer?.after(ARM_MS + 50, (cx) => { if (this.key === key && !this.is(key)) { this.key = null; cx.notify(); } });
  }

  /** A button that asks twice: the first press arms `key`, the second runs `act`. */
  button(id, label, verb, key, act, c, o = {}) { return button(id, label, (cx) => this.press(key, cx, act), c, { ...o, verb, armed: this.is(key) }); }

  link(id, label, verb, key, act, c, o = {}) { return quietLink(id, label, (cx) => this.press(key, cx, act), c, { ...o, verb, armed: this.is(key) }); }
}
