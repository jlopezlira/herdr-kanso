// Kanso's panel kit, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What the side panels draw alike (Files, Changes, PR, Shipped, Worktrees
// and Ports in kanso-panel; Spend in kanso-spend; Memory in kanso-guard):
// one centered column, no cards, hierarchy from type size and tone,
// hairlines between rows, quiet text actions, a breathing silhouette while
// loading, and a second press to confirm anything that removes. Every color
// comes from Herdr's theme.
//
// Herdr loads a mod's files from its own folder only, so this file is kept
// byte for byte in kanso-panel/ (the one you edit), kanso-spend/,
// kanso-settings/ and kanso-guard/: `npm run sync:share` copies it and a
// test fails when a copy differs.
import { div, svg } from "gpui-kit";
import { h_flex, Button, Toggle } from "gpui-base";

/** The spacing rhythm: 4 / 8 / 12 / 16 / 24. */
export const G = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
/** Control heights keep toolbars, inputs and buttons on one line. */
export const H = { control: 30, compact: 24 };
/** Radii: controls stay tighter than cards. */
export const R = { control: 6, card: 8 };
/** Type steps: page, card, metric, body, small and labels. */
export const T = { page: 20, card: 13.5, metric: 22, value: 12.5, body: 11.5, small: 10.5, label: 9.5 };
/** A second press within this long confirms a removal. */
export const ARM_MS = 4000;
/** The loading silhouette breathes: one native loop on the whole shape. */
export const BREATH = { from: 0.35, to: 0.8, period: 1800 };
/** A dot that pulses to say "in use now". */
export const PULSE = { from: 0.35, to: 1, period: 2400 };
/**
 * Breathes or pulses `el` natively. It keeps going behind other windows: a
 * still mark there reads as a stalled agent, not a resting window.
 */
export const breathe = (el, policy = BREATH) => el.loop("opacity", policy);
const ICONS = "mods/kanso-chrome/icons/";

/** The panels' colors, one name each, from Herdr's theme. */
export function tokens(t = {}) {
  const canvas = t.canvas ?? t.background;
  return {
    canvas, text: t.foreground, muted: t.muted ?? t.dim, dim: t.dim,
    border: t.border ?? t.input, input: t.input ?? t.border, subtle: t.hover ?? t.raised, raised: t.raised ?? canvas,
    selected: t.selected ?? t.hover ?? t.raised, popover: t.popover ?? t.surface ?? canvas,
    primary: t.solid ?? t.foreground, primaryText: t.solid_foreground ?? t.background,
    accent: t.accent ?? t.foreground, red: t.ansi1, green: t.ansi2, yellow: t.ansi3, violet: t.ansi5,
  };
}

/** A text-only action, so a choice never competes with the numbers. */
export function quietLink(id, label, onClick, c, { disabled = false, size = 12, color = c.muted, label: spoken = label } = {}) {
  return Button.new(id).h(H.compact).items_center().cursor_pointer()
    .disabled(disabled)
    .accessibility_label(spoken)
    .when(!disabled, (el) => el.hover((s) => s.opacity(0.7)).focus((s) => s.opacity(0.7)))
    .on_click((_e, cx) => { if (!disabled) onClick(cx); })
    .child(div().text_size(size).text_color(disabled ? c.border : color).child(label));
}

/** Text tabs: the chosen one in full tone, the rest recede. */
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

/**
 * A 26px icon button. `icon`: a name in kanso-chrome's icons, or a path.
 * `spin` turns it while something runs; `active` draws it in full ink.
 */
export function iconButton(id, icon, tip, onClick, c, { spin = false, disabled = false, active = false } = {}) {
  const path = icon.includes("/") ? icon : `${ICONS}${icon}.svg`;
  const glyph = svg(path).size(15).text_color(spin || active ? c.text : disabled ? c.border : c.muted);
  return Button.new(id).size(26).flex_none().items_center().justify_center().rounded(R.control)
    .accessibility_label(tip).tooltip(tip)
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(c.subtle)).focus((s) => s.bg(c.subtle)).on_click((_e, cx) => onClick(cx)))
    .child(spin ? glyph.spin(900) : glyph);
}

/** A section's head: its name, and a note at the right. */
export function section(c, title, note) {
  return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.sm)
    .child(div().flex_none().text_size(15).text_color(c.text).child(title))
    .child(div().min_w(0).truncate().text_size(12).text_color(c.dim).child(note ?? ""));
}

/**
 * The loading silhouette's pieces, in the faintest tone: a block, and a row
 * (a name, space, a number). Each panel composes its own shape with them,
 * under one `.loop("opacity", BREATH)`.
 */
export function ghost(c) {
  const block = (w, h, radius = 3) => div().w(w).h(h).flex_none().rounded(radius).bg(c.border);
  const row = (i) => h_flex().w_full().items_center().gap(G.md).py(9)
    .child(block([120, 96, 140, 84, 110, 72][i % 6], 9)).child(div().flex_1()).child(block(40, 11));
  return { block, row };
}

/** A second press within ARM_MS confirms; the first only arms. */
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

/** A controlled native toggle, in the same neutral language as the rest. */
export function toggleSwitch(id, checked, onChange, c, { label = "Toggle" } = {}) {
  return Toggle.new(id).w(36).h(20).p(2).items_center().rounded_full()
    .bg(checked ? c.primary : c.raised).border_1().border_color(checked ? c.primary : c.input)
    .cursor_pointer().pressed(checked)
    .accessibility_label(label)
    .on_change((next, cx) => { onChange(next, cx); cx.notify(); })
    .hover((s) => s.border_color(checked ? c.primary : c.input))
    .focus((s) => s.border_color(c.accent))
    .child(div().size(14).flex_none().rounded_full()
      .bg(checked ? c.primaryText : c.muted)
      .when(checked, (el) => el.ml(16)));
}

/** A text input drawn as a control. */
export function controlInput(el, c) {
  return el.h(H.control).px(8).rounded(R.control).border_1().border_color(c.input).bg(c.canvas)
    .text_size(T.body).text_color(c.text).focus((s) => s.border_color(c.accent));
}
