#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { TOKENS, loadTokens, read, writeChanged } from "./tokens.mjs";

export const UI = "kanso/mods/kanso-panel/ui.js";
export const START = `// Sizes generated from ${TOKENS} by npm run build:ui-tokens.`;
export const END = "// End of the generated sizes.";

const PICK = {
  G: { hair: "k-sp-hair", xs: "k-sp-1", sm: "k-sp-2", md: "k-sp-3", lg: "k-sp-4", xl: "k-sp-6" },
  H: { control: "k-h-control", compact: "k-h-compact", icon: "k-h-icon", row: "k-h-header", line: "k-h-row", two: "k-h-row2", badge: "k-h-badge" },
  R: { sm: "k-r-sm", control: "k-r-control", card: "k-r-card" },
  W: { paneName: "k-w-pane-name", paneSegment: "k-w-pane-segment", menu: "k-w-menu", question: "k-w-question", tabLabel: "k-w-tab-label", tabSkeleton: "k-w-tab-skeleton", tabSkeletonShort: "k-w-tab-skeleton-short" },
  T: { display: "k-fs-display", page: "k-fs-title", title: "k-fs-section", card: "k-fs-name", value: "k-fs-body", body: "k-fs-meta", mono: "k-fs-mono" },
  ICON: "k-ic-control",
  ICON_ROW: "k-ic-row",
  ICON_INLINE: "k-ic-inline",
  ICON_CHROME: "k-ic-chrome",
  CHROME_SQUARE: "k-h-pane",
  DRAG_START: "k-drag-start",
  GLINT: { run: "k-glint-run", wide: "k-glint-w1", mid: "k-glint-w2", narrow: "k-glint-w3" },
  SWITCH: { w: "k-sw-w", h: "k-sw-h", knob: "k-sw-knob" },
  PAGE: { w: "k-w-page", toolbar: "k-h-file-toolbar", toolbarX: "k-file-toolbar-x", note: "k-note-text", markdown: "k-markdown-text", unitGap: "k-metric-unit-gap", unitY: "k-metric-unit-y", skeletonY: "k-skeleton-row-y", findList: "k-h-find-list" },
  SIDEBAR: { w: "k-w-sidebar", narrow: "k-w-sidebar-narrow", min: "k-w-sidebar-min", railRow: "k-rail-row", guideX: "k-guide-x", agentX: "k-sidebar-agent-x", gap: "k-sidebar-row-gap" },
  PANE: { edge: "k-edge-w", gap: "k-pane-gap", minW: "k-pane-min-w", minH: "k-pane-min-h", pills: "k-w-pills" },
  KEY: { x: "k-keycap-x", text: "k-keycap-text", unit: "k-help-key", gap: "k-help-key-gap" },
  DIALOG: { prompt: "k-dialog-prompt", pad: "k-dialog-paged-pad", settingsW: "k-settings-w", settingsH: "k-settings-tall" },
  PR: { title: "k-pr-title", titleMax: "k-pr-title-max", dot: "k-pr-dot", fold: "k-pr-body-fold" },
  HEATMAP_GAP: "k-heatmap-gap",
  DOJO_CELL: "k-dojo-cell",
};
// Durations in milliseconds.
const TIMING = { SPIN: "k-spin-ms", GLINT_MS: "k-glint-ms", GLINT_STAGGER: "k-glint-stagger", DOTS_MS: "k-dots-ms" };
// Shares of full strength, from 0 to 1.
const SHARES = { away: "k-op-away", held: "k-op-held", blockedWash: "k-wash-blocked", blockedRow: "k-wash-blocked-row", glintFaint: "k-op-glint-faint", glintMid: "k-op-glint-mid" };

const reader = (unit) => (tokens) => {
  const all = Object.entries(tokens).filter(([group]) => group !== "colour").flatMap(([, list]) => list);
  const shape = new RegExp(`^-?[\\d.]+${unit}$`);
  return (name) => {
    const t = all.find((x) => x.name === name);
    if (!t || !shape.test(t.value)) throw new Error(`no ${unit} token ${name} in ${TOKENS}`);
    return Number.parseFloat(t.value);
  };
};
export const px = reader("px");
const ms = reader("ms");
// A share is written as .55 or as 40%.
const share = (tokens) => {
  const plain = reader("")(tokens), percent = reader("%")(tokens);
  return (name) => (tokens.opacity.find((t) => t.name === name)?.value.endsWith("%") ? percent(name) / 100 : plain(name));
};

const WASH = /^color-mix\(in srgb, var\(--fg\) ([\d.]+)%, transparent\)$/;

// The foreground washes' shares per theme, keyed by the kit's names and read from their tokens.
export const WASH_TOKENS = { w4: "wash-4", w7: "wash-7", w12: "wash-12", w14: "wash-14" };
export function washes(tokens) {
  const share = (theme, name) => {
    const t = tokens.colour[theme].find((x) => x.name === name), m = WASH.exec(t?.value ?? "");
    if (!m) throw new Error(`no wash ${name} in ${theme} in ${TOKENS}`);
    return Number(m[1]) / 100;
  };
  const one = (theme) => `{ ${Object.entries(WASH_TOKENS).map(([name, token]) => `${name}: ${share(theme, token)}`).join(", ")} }`;
  return `export const WASHES = { dark: ${one("dark")}, light: ${one("light")} };`;
}

export function block(tokens) {
  const value = px(tokens);
  const lines = Object.entries(PICK).map(([name, pick]) => typeof pick === "string"
    ? `export const ${name} = ${value(pick)};`
    : `export const ${name} = { ${Object.entries(pick).map(([key, token]) => `${key}: ${value(token)}`).join(", ")} };`);
  const duration = ms(tokens);
  const timings = Object.entries(TIMING).map(([name, token]) => `export const ${name} = ${duration(token)};`);
  const of = share(tokens);
  const shares = `export const OPACITY = { ${Object.entries(SHARES).map(([key, token]) => `${key}: ${of(token)}`).join(", ")} };`;
  return [START, ...lines, ...timings, shares, washes(tokens), END].join("\n");
}

export function withTokens(text, tokens) {
  const from = text.indexOf(START), to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`${UI} has no generated sizes block`);
  return text.slice(0, from) + block(tokens) + text.slice(to + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeChanged(UI, withTokens(read(UI), loadTokens()));
