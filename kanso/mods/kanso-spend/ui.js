// Kanso's panel kit, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui.js.
import { div, svg } from "gpui-kit";
import { h_flex, Button, Toggle } from "gpui-base";

// Sizes generated from kanso/tokens.json by npm run build:ui-tokens.
export const G = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const H = { control: 30, compact: 24, row: 40 };
export const R = { control: 6, card: 8 };
export const T = { display: 48, page: 20, title: 15, card: 13.5, value: 12.5, body: 11.5, mono: 11.5 };
export const ICON = 15;
export const SWITCH = { w: 28, h: 16, knob: 12 };
// End of the generated sizes.
export const SEG = { two: 188, three: 280 };
export const EASE = { duration: 180, easing: "ease-out" };
/** A second press within this long confirms a removal. */
export const ARM_MS = 4000;
export const BREATH = { from: 0.35, to: 0.8, period: 1800 };
export const PULSE = { from: 0.35, to: 1, period: 2400 };
// A native loop: it keeps going behind other windows, where a still mark reads as a stalled agent.
export const breathe = (el, policy = BREATH) => el.loop("opacity", policy);
const ICONS = "mods/kanso-chrome/icons/";

export function tokens(t = {}) {
  const canvas = t.canvas ?? t.background;
  return {
    canvas, text: t.foreground, muted: t.muted ?? t.dim, dim: t.dim,
    border: t.border ?? t.input, input: t.input ?? t.border, subtle: t.hover ?? t.raised, raised: t.raised ?? canvas,
    selected: t.selected ?? t.hover ?? t.raised, popover: t.popover ?? t.surface ?? canvas,
    primary: t.solid ?? t.foreground, primaryText: t.solid_foreground ?? t.background,
    accent: t.accent ?? t.foreground, accentText: t.accent_foreground ?? t.background,
    background: t.background ?? canvas,
    blocked: t.blocked ?? t.ansi1, working: t.working ?? t.ansi3, done: t.done ?? t.ansi2,
    highlight: t.selection ?? t.selected ?? t.hover,
    red: t.ansi1, green: t.ansi2, yellow: t.ansi3, violet: t.ansi5,
  };
}

const TONE = {
  red: "blocked", blocked: "blocked",
  yellow: "working", working: "working",
  green: "done", done: "done",
  violet: "violet", dim: "dim", muted: "muted",
};
export const toneColor = (c, tone) => c[TONE[tone] ?? "dim"];

/** A text-only action, so a choice never competes with the numbers. */
export function quietLink(id, label, onClick, c, { disabled = false, size = 12, color = c.muted, label: spoken = label } = {}) {
  return Button.new(id).h(H.compact).items_center().cursor_pointer()
    .disabled(disabled)
    .accessibility_label(spoken)
    .when(!disabled, (el) => el.hover((s) => s.opacity(0.7)).focus((s) => s.opacity(0.7)))
    .on_click((_e, cx) => { if (!disabled) onClick(cx); })
    .child(div().text_size(size).text_color(disabled ? c.border : color).child(label));
}

export function quietTabs(id, items, value, onChange, c) {
  return h_flex().id(id).flex_wrap().gap(G.lg).items_center()
    .children(items.map((item, index) => {
      const on = value === item.key;
      return Button.new(`${id}-${item.key}`).h(H.compact).items_center().cursor_pointer()
        .selected(on)
        .set_position(index + 1, items.length)
        .accessibility_label(item.label)
        .when(!on, (el) => el.hover((s) => s.opacity(0.7)))
        .focus((s) => s.opacity(0.7))
        .on_click((_e, cx) => { if (!on) onChange(item.key, cx); })
        .child(div().text_size(13).text_color(on ? c.text : c.dim).when(on, (el) => el.font_medium()).child(item.label));
    }));
}

/** `icon`: a name in kanso-chrome's icons, or a path. */
export function iconButton(id, icon, tip, onClick, c, { spin = false, disabled = false, active = false, color = null } = {}) {
  const path = icon.includes("/") ? icon : `${ICONS}${icon}.svg`;
  const glyph = svg(path).size(ICON).text_color(color ?? (spin || active ? c.text : disabled ? c.border : c.muted));
  return Button.new(id).size(26).flex_none().items_center().justify_center().rounded(R.control)
    .accessibility_label(tip).tooltip(tip)
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(c.subtle)).focus((s) => s.bg(c.subtle)).on_click((_e, cx) => onClick(cx)))
    .child(spin ? glyph.spin(900) : glyph);
}

export function section(c, title, note) {
  return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.sm)
    .child(div().flex_none().text_size(T.title).text_color(c.text).child(title))
    .child(div().min_w(0).truncate().text_size(12).text_color(c.dim).child(note ?? ""));
}

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

export class Armed {
  constructor() { this.key = null; this.at = 0; }

  is(key) { return this.key === key && Date.now() - this.at <= ARM_MS; }

  clear() { this.key = null; }

  press(key, cx, act) {
    if (this.is(key)) { this.key = null; act(cx); return; }
    this.key = key; this.at = Date.now(); cx.notify();
    cx.timer?.after(ARM_MS + 50, (cx) => { if (this.key === key && !this.is(key)) { this.key = null; cx.notify(); } });
  }
}

export function toggleSwitch(id, checked, onChange, c, { label = "Toggle" } = {}) {
  // The 1px border sits inside the pill, so the knob meets its edge.
  const pad = (SWITCH.h - SWITCH.knob - 2) / 2;
  const pill = h_flex().w(SWITCH.w).h(SWITCH.h).p(pad).items_center()
    .justify_start().when(checked, (el) => el.justify_end())
    .rounded_full().bg(checked ? c.primary : c.raised).border_1().border_color(checked ? c.primary : c.input)
    .child(div().size(SWITCH.knob).flex_none().rounded_full().bg(checked ? c.primaryText : c.muted));
  // Focus recolours this border; it stays clear until then.
  return Toggle.new(id).h(H.compact).px(G.xs).items_center().cursor_pointer()
    .rounded(R.control).border_1().border_color("#00000000")
    .pressed(checked)
    .accessibility_label(label)
    .on_change((next, cx) => { onChange(next, cx); cx.notify(); })
    .focus((s) => s.border_color(c.accent))
    .child(pill);
}

export function controlInput(el, c) {
  return el.h(H.control).px(8).rounded(R.control).border_1().border_color(c.input).bg(c.canvas)
    .text_size(T.body).text_color(c.text).focus((s) => s.border_color(c.accent));
}

export function segmentAt(width, i, n, pad = 3, gap = 2) {
  const w = (width - 2 * pad - gap * (n - 1)) / n;
  return { left: pad + i * (w + gap), width: w };
}

export function segmented(id, items, value, onChange, c, { width = null, dot = null, sized = null } = {}) {
  const ink = c.foreground ?? c.text;
  const wash = c.raised ?? c.selected;
  const at = width ? segmentAt(width, Math.max(0, items.findIndex((item) => item.key === value)), items.length) : null;
  const thumb = at ? div().id(`${id}-thumb`).absolute().top(3).left(at.left).w(at.width).h(28).rounded(7)
    .bg(wash).border_1().border_color(c.border)
    .transition("left", { duration: 200, easing: "ease-out" }) : null;
  const seg = (item) => {
    const on = value === item.key;
    return h_flex().id(`${id}-${item.key}`).flex_1().h(28).gap(6).items_center().justify_center().rounded(7).cursor_pointer()
      .text_size(T.value).font_medium().text_color(on ? ink : c.muted)
      .when(on && !at, (el) => el.bg(wash).border_1().border_color(c.border))
      .when(!on, (el) => el.hover((s) => s.text_color(ink)))
      .on_click((_e, cx) => { if (value !== item.key) onChange(item.key, cx); })
      .child(div().child(item.label))
      .when(dot === item.key && !on, (el) => el.child(div().size(6).rounded_full().bg(c.blocked ?? c.red)));
  };
  return h_flex().id(id).relative().p(3).gap(2).flex_none().rounded(10).bg(ink + "0a")
    .when(Boolean(sized), (el) => el.on_size_change((s, cx) => sized(s.width, cx)))
    .when(Boolean(thumb), (el) => el.child(thumb))
    .children(items.map(seg));
}
