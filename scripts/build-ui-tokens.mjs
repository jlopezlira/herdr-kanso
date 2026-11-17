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
  ICON_EMPTY: "k-ic-empty",
  CHROME_SQUARE: "k-h-pane",
  DRAG_START: "k-drag-start",
  GLINT: { run: "k-glint-run", wide: "k-glint-w1", mid: "k-glint-w2", narrow: "k-glint-w3" },
  SWITCH: { w: "k-sw-w", h: "k-sw-h", knob: "k-sw-knob" },
  PAGE: { w: "k-w-page", toolbar: "k-h-file-toolbar", toolbarX: "k-file-toolbar-x", note: "k-note-text", markdown: "k-markdown-text", unitGap: "k-metric-unit-gap", unitY: "k-metric-unit-y", findList: "k-h-find-list" },
  SIDEBAR: { w: "k-w-sidebar", narrow: "k-w-sidebar-narrow", min: "k-w-sidebar-min", railRow: "k-rail-row", tile: "k-rail-tile", guideX: "k-guide-x", agentX: "k-sidebar-agent-x", elbowGap: "k-sidebar-elbow-gap", gap: "k-sidebar-row-gap" },
  PANE: { edge: "k-edge-w", gap: "k-pane-gap", minW: "k-pane-min-w", minH: "k-pane-min-h", pills: "k-w-pills" },
  KEY: { x: "k-keycap-x", text: "k-keycap-text", unit: "k-help-key", gap: "k-help-key-gap" },
  DIALOG: { prompt: "k-dialog-prompt", pad: "k-dialog-paged-pad", settingsW: "k-settings-w", settingsH: "k-settings-tall" },
  PR: { title: "k-pr-title", titleMax: "k-pr-title-max", fold: "k-pr-body-fold" },
  SKELETON: { text: "k-skeleton-text", meta: "k-skeleton-meta" },
  HEATMAP_GAP: "k-heatmap-gap",
  DOJO_CELL: "k-dojo-cell",
  CODE: { line: "k-lh-line", gutter: "k-h-pane" },
};
// Line heights, as a share of the font size.
const LEADINGS = { LH: { body: "k-lh-body" } };
// Durations in milliseconds.
const TIMING = { SPIN: "k-spin-ms", GLINT_MS: "k-glint-ms", GLINT_STAGGER: "k-glint-stagger", DOTS_MS: "k-dots-ms" };
// Transitions: a duration and an easing.
const MOTION = { EASE: { duration: "k-fade-ms", easing: "k-glide-ease" }, GLIDE: { duration: "k-glide-ms", easing: "k-glide-ease" } };
const EASINGS = { GLINT_EASE: "k-ease-out" };
// Beats: an opacity that falls to `from` and back to full every `period`.
const BEATS = { working: { from: "k-op-beat-working", period: "k-beat-working-ms" }, blocked: { from: "k-op-beat-blocked", period: "k-beat-blocked-ms" } };
// Shares of full strength, from 0 to 1.
const SHARES = {
  OPACITY: {
    away: "k-op-away", held: "k-op-held", hover: "k-op-hover", quiet: "k-op-quiet", idle: "k-op-idle", thumb: "k-op-thumb", trace: "k-op-trace",
    pending: "k-op-pending", part: "k-op-part", pet: "k-op-pet", blockedWash: "k-wash-blocked", blockedRow: "k-wash-blocked-row", glintFaint: "k-op-glint-faint", glintMid: "k-op-glint-mid",
  },
  TINT: Object.fromEntries(["board", "chip", "cell", "hover", "row", "card", "tab", "pill", "diff", "faint", "key", "control", "goal", "bound", "soft", "strong", "frame", "boundLine", "ring", "line"]
    .map((key) => [key, `k-tint-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`])),
};
// Colours that are the same in every theme: marks and fallbacks.
const INK = { faint: "faint", fallback: "fallback", dojoFur: "dojo-fur", dojoCream: "dojo-cream", dojoInk: "dojo-ink" };

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

const easing = (tokens) => (name) => {
  const t = tokens.motion.find((x) => x.name === name);
  if (!t || /^-?[\d.]+\w*$/.test(t.value)) throw new Error(`no easing ${name} in ${TOKENS}`);
  return JSON.stringify(t.value);
};
const ink = (tokens) => (name) => {
  const values = new Set(Object.values(tokens.colour).map((list) => list.find((x) => x.name === name)?.value));
  const [value] = values;
  if (values.size !== 1 || !/^#[0-9a-f]{6}$/i.test(value ?? "")) throw new Error(`${name} is not one #rrggbb in every theme in ${TOKENS}`);
  return JSON.stringify(value);
};

const constant = (name, pick, read) => (typeof pick === "string"
  ? `export const ${name} = ${read(pick)};`
  : `export const ${name} = { ${Object.entries(pick).map(([key, token]) => `${key}: ${read(token)}`).join(", ")} };`);
const constants = (picks, read) => Object.entries(picks).map(([name, pick]) => constant(name, pick, read));

export function block(tokens) {
  const duration = ms(tokens);
  const ease = easing(tokens);
  const of = share(tokens);
  const motion = Object.entries(MOTION).map(([name, pick]) => `export const ${name} = { duration: ${duration(pick.duration)}, easing: ${ease(pick.easing)} };`);
  const beats = `export const BEAT = { ${Object.entries(BEATS).map(([key, pick]) => `${key}: { from: ${of(pick.from)}, to: 1, period: ${duration(pick.period)} }`).join(", ")} };`;
  return [START, ...constants(PICK, px(tokens)), ...constants(LEADINGS, reader("")(tokens)), ...constants(TIMING, duration), ...motion, ...constants(EASINGS, ease), beats, ...constants(SHARES, of),
    washes(tokens), constant("INK", INK, ink(tokens)), END].join("\n");
}

export function withTokens(text, tokens) {
  const from = text.indexOf(START), to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`${UI} has no generated sizes block`);
  return text.slice(0, from) + block(tokens) + text.slice(to + END.length);
}

export const LAYOUT = "kanso/layouts/kanso.json";
// The layout file's sizes, by node id and the path to the number inside it; `root` is the tree's own. Weights and zeros are not sizes.
export const LAYOUT_SIZES = {
  root: { "terminal_padding.0": "k-terminal-x", "terminal_padding.1": "k-terminal-y", "traffic_lights.0": "k-traffic-x", "traffic_lights.1": "k-traffic-y" },
  sidebar: { "size.px": "k-w-sidebar", min: "k-w-sidebar-layout-min", max: "k-w-sidebar-max" },
  brand: { "size.px": "k-h-tab-bar" },
  spaces: { min: "k-h-spaces-min" },
  "sidebar-footer": { "size.px": "k-h-sidebar-footer" },
  work: { padding: "k-pane-gap", gap: "k-sp-1" },
  tabs: { "size.px": "k-h-tab-bar" },
  "work-body": { gap: "k-pane-gap" },
  main: { "content.pane.header.height": "k-h-pane", "content.pane.radius": "k-r-card", "content.pane.gap": "k-pane-gap" },
  "panel-body": { "size.px": "k-w-panel-inline", min: "k-w-panel-min", max: "k-w-panel-max", radius: "k-r-card" },
  "status-row": { "size.px": "k-h-bar" },
  "strip-map": { "size.px": "k-status-slot" },
};

/** Every node of the layout tree, the root first. */
export const nodesOf = (node) => [node, ...(node.children ?? []).flatMap(nodesOf)];
const setAt = (node, path, value) => {
  const keys = path.split("."), last = keys.pop();
  const parent = keys.reduce((at, key) => at?.[key], node);
  if (parent?.[last] === undefined) throw new Error(`${LAYOUT} has no ${path} on ${node.id}`);
  parent[last] = value;
};

/** Each size in LAYOUT_SIZES on its node of the layout tree, with its token and the number that token gives. */
export function layoutSizes(tree, tokens) {
  const size = px(tokens), byId = new Map(nodesOf(tree).map((node) => [node.id, node]));
  return Object.entries(LAYOUT_SIZES).flatMap(([id, sizes]) => {
    const node = byId.get(id);
    if (!node) throw new Error(`${LAYOUT} has no node ${id}`);
    return Object.entries(sizes).map(([path, token]) => ({ node, path, token, value: size(token) }));
  });
}

/** The layout file with every size in LAYOUT_SIZES written from its token. */
export function layoutWithTokens(text, tokens) {
  const tree = JSON.parse(text);
  for (const { node, path, value } of layoutSizes(tree, tokens)) setAt(node, path, value);
  return `${JSON.stringify(tree, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = loadTokens();
  writeChanged(UI, withTokens(read(UI), tokens));
  writeChanged(LAYOUT, layoutWithTokens(read(LAYOUT), tokens));
}
