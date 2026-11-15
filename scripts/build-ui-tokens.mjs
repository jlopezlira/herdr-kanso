#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { TOKENS, loadTokens, read, writeChanged } from "./tokens.mjs";

export const UI = "kanso/mods/kanso-panel/ui.js";
export const START = `// Sizes generated from ${TOKENS} by npm run build:ui-tokens.`;
export const END = "// End of the generated sizes.";

const PICK = {
  G: { hair: "k-sp-hair", xs: "k-sp-1", sm: "k-sp-2", md: "k-sp-3", lg: "k-sp-4", xl: "k-sp-6" },
  H: { control: "k-h-control", compact: "k-h-compact", icon: "k-h-icon", row: "k-h-header" },
  R: { control: "k-r-control", card: "k-r-card" },
  T: { display: "k-fs-display", page: "k-fs-title", title: "k-fs-section", card: "k-fs-name", value: "k-fs-body", body: "k-fs-meta", mono: "k-fs-mono" },
  ICON: "k-ic-control",
  ICON_ROW: "k-ic-row",
  SWITCH: { w: "k-sw-w", h: "k-sw-h", knob: "k-sw-knob" },
};

export function px(tokens) {
  const all = Object.entries(tokens).filter(([group]) => group !== "colour").flatMap(([, list]) => list);
  return (name) => {
    const t = all.find((x) => x.name === name);
    if (!t || !/^-?[\d.]+px$/.test(t.value)) throw new Error(`no px token ${name} in ${TOKENS}`);
    return Number.parseFloat(t.value);
  };
}

const WASH = /^color-mix\(in srgb, var\(--fg\) ([\d.]+)%, transparent\)$/;

// The foreground washes' shares per theme: w4, w7, w12, w14.
export function washes(tokens) {
  const share = (theme, name) => {
    const t = tokens.colour[theme].find((x) => x.name === name), m = WASH.exec(t?.value ?? "");
    if (!m) throw new Error(`no wash ${name} in ${theme} in ${TOKENS}`);
    return Number(m[1]) / 100;
  };
  const one = (theme) => `{ ${["w4", "w7", "w12", "w14"].map((name) => `${name}: ${share(theme, name)}`).join(", ")} }`;
  return `export const WASHES = { dark: ${one("dark")}, light: ${one("light")} };`;
}

export function block(tokens) {
  const value = px(tokens);
  const lines = Object.entries(PICK).map(([name, pick]) => typeof pick === "string"
    ? `export const ${name} = ${value(pick)};`
    : `export const ${name} = { ${Object.entries(pick).map(([key, token]) => `${key}: ${value(token)}`).join(", ")} };`);
  return [START, ...lines, washes(tokens), END].join("\n");
}

export function withTokens(text, tokens) {
  const from = text.indexOf(START), to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`${UI} has no generated sizes block`);
  return text.slice(0, from) + block(tokens) + text.slice(to + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeChanged(UI, withTokens(read(UI), loadTokens()));
