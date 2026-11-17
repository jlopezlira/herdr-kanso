// Kanso's panel kit, the base every piece uses: sizes, colours and timing, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui.js. Each piece is its own ui-<piece>.js.
import { shared } from "herdr";

// Sizes generated from kanso/tokens.json by npm run build:ui-tokens.
export const G = { hair: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const H = { control: 30, compact: 24, icon: 26, row: 40, line: 32, two: 50, badge: 20 };
export const R = { sm: 4, control: 6, card: 8 };
export const W = { paneName: 256, paneSegment: 224, menu: 252, question: 260, tabLabel: 170, tabSkeleton: 92, tabSkeletonShort: 64 };
export const T = { display: 48, page: 20, title: 15, card: 13.5, value: 12.5, body: 11.5, mono: 11.5 };
export const ICON = 15;
export const ICON_ROW = 14;
export const ICON_INLINE = 12;
export const ICON_CHROME = 17;
export const CHROME_SQUARE = 34;
export const DRAG_START = 4;
export const GLINT = { run: 240, wide: 44, mid: 26, narrow: 12 };
export const SWITCH = { w: 28, h: 16, knob: 12 };
export const PAGE = { w: 1080, toolbar: 42, toolbarX: 14, note: 12, markdown: 13, unitGap: 6, unitY: 3, skeletonY: 9, findList: 300 };
export const SIDEBAR = { w: 256, narrow: 240, min: 120, railRow: 46, guideX: 13, agentX: 34, gap: 1 };
export const PANE = { edge: 28, gap: 6, minW: 140, minH: 90, pills: 110 };
export const KEY = { x: 5, text: 10.5, unit: 40, gap: 5 };
export const DIALOG = { prompt: 420, pad: 20, settingsW: 860, settingsH: 680 };
export const PR = { title: 17, titleMax: 44, dot: 8, fold: 150 };
export const HEATMAP_GAP = 3;
export const DOJO_CELL = 30;
export const SPIN = 900;
export const GLINT_MS = 2200;
export const GLINT_STAGGER = 160;
export const DOTS_MS = 380;
export const OPACITY = { away: 0.55, held: 0.4, blockedWash: 0.4, blockedRow: 0.08, glintFaint: 0.35, glintMid: 0.6 };
export const WASHES = { dark: { w4: 0.04, w7: 0.07, w12: 0.12, w14: 0.14 }, light: { w4: 0.05, w7: 0.095, w12: 0.18, w14: 0.21 } };
// End of the generated sizes.
export const EASE = { duration: 180, easing: "ease-out" };
/** A second press within this long confirms what cannot be undone. */
export const ARM_MS = 4000;
export const BREATH = { from: 0.35, to: 0.8, period: 1800 };
export const PULSE = { from: 0.35, to: 1, period: 2400 };
// A native loop: it keeps going behind other windows, where a still mark reads as a stalled agent.
export const breathe = (el, policy = BREATH) => el.loop("opacity", policy);
// A native loop redraws the whole window about 30 times a second, so on battery motion steps instead of gliding.
export const onBattery = () => shared("kanso.battery") === true;
export const ICONS = "mods/kanso-chrome/icons/";
/** A name in kanso-chrome's icons, or a path. */
export const glyphOf = (icon) => (icon.includes("/") ? icon : `${ICONS}${icon}.svg`);

export function tokens(t = {}) {
  const canvas = t.canvas ?? t.background, selected = t.selected ?? t.hover ?? t.raised, subtle = t.hover ?? t.raised;
  const blue = t.blue ?? t.ansi4, done = t.done ?? t.ansi2;
  return {
    canvas, text: t.foreground, muted: t.muted ?? t.dim, dim: t.dim,
    border: t.border ?? t.input, input: t.input ?? t.border, subtle, raised: t.raised ?? canvas,
    selected, popover: t.popover ?? t.surface ?? canvas,
    primary: t.solid ?? t.foreground, primaryText: t.solid_foreground ?? t.background,
    accent: t.accent ?? t.foreground, accentText: t.accent_foreground ?? t.background,
    background: t.background ?? canvas,
    blocked: t.blocked ?? t.ansi1, working: t.working ?? t.ansi3, done, idle: t.idle ?? t.dim, chrome: t.chrome,
    highlight: t.selection ?? t.selected ?? t.hover,
    red: t.ansi1, green: t.ansi2, yellow: t.ansi3, violet: t.ansi5, blue,
    // A host's teal: blue and done, half each.
    teal: mix(blue, done, 0.5),
    ...(washes(t) ?? { w4: subtle, w7: subtle, w12: selected, w14: selected }),
  };
}

const TONE = {
  red: "blocked", blocked: "blocked",
  yellow: "working", working: "working",
  green: "done", done: "done",
  violet: "violet", dim: "dim", muted: "muted", fg: "text",
  blue: "blue", teal: "teal",
};
export const toneColor = (c, tone) => c[TONE[tone] ?? "dim"];

const RGB = /^#[0-9a-f]{6}/i;
// The kit's color-mix: `a` over an opaque `b`, `share` of the way.
export function mix(a, b, share) {
  if (!RGB.test(a ?? "") || !RGB.test(b ?? "")) return a;
  const at = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(at(a, i) * share + at(b, i) * (1 - share)).toString(16).padStart(2, "0")).join("")}`;
}

const HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
// `hex` at `share` opacity: it lets the ground below show through.
export const alpha = (hex, share) => `${hex.slice(0, 7)}${Math.round(share * 255).toString(16).padStart(2, "0")}`;
const lightness = (hex) => [0, 1, 2].reduce((sum, i) => sum + parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16), 0);
/** The foreground washes w4, w7, w12, w14 at the light or the dark theme's shares; null without a #rrggbb foreground, so a caller keeps its opaque token. */
export function washes(t = {}) {
  const fg = t.foreground, bg = t.background ?? t.canvas;
  if (!HEX.test(fg ?? "")) return null;
  const day = HEX.test(bg ?? "") && lightness(bg) > lightness(fg);
  return Object.fromEntries(Object.entries(day ? WASHES.light : WASHES.dark).map(([name, share]) => [name, alpha(fg, share)]));
}

export const WASH = { off: 0.04, hover: 0.88, press: 0.76 };
// A focus ring is a border kept this colour at rest.
export const CLEAR = "#00000000";
// The 4% wash: a disabled control's ground.
export const well = (c) => mix(c.text, c.background, WASH.off);
