#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { TOKENS, loadTokens, writeChanged } from "./tokens.mjs";

export const OUT = "site/tokens.css";

const vars = (list, indent) => list.map((t) => `${indent}--${t.name}: ${t.value};`).join("\n");
const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
// One value per token: where the themes differ, light-dark() on each colour that differs.
const pair = (dark, light) => dark === light ? dark : `light-dark(${light}, ${dark})`;
const themed = (dark, light) => {
  const [darkColours, lightColours] = [dark, light].map((value) => value.match(COLOUR) ?? []);
  if (dark.replace(COLOUR, "") !== light.replace(COLOUR, "") || !darkColours.length) return pair(dark, light);
  return dark.split(COLOUR).map((part, at) => at < darkColours.length ? part + pair(darkColours[at], lightColours[at]) : part).join("");
};

// Every token that is not a colour.
export const sizeTokens = (tokens) => Object.entries(tokens).filter(([group]) => group !== "colour").flatMap(([, list]) => list);

export function render(tokens) {
  const sizes = sizeTokens(tokens);
  const light = new Map(tokens.colour.light.map((t) => [t.name, t.value]));
  const colours = tokens.colour.dark.map((t) => ({ name: t.name, value: themed(t.value, light.get(t.name)) }));
  return `/* Generated from ${TOKENS} by npm run build:site-tokens. */
:root {
  color-scheme: dark light;
${vars(sizes, "  ")}
${vars(colours, "  ")}
}

${["dark", "light"].map((theme) => `:root[data-theme="${theme}"] { color-scheme: ${theme}; }`).join("\n")}
`;
}

export const UTILITIES = "stories/utilities.css";

const SIZES = {
  "k-fs-": (n) => [`kanso-type--${n}`, `font-size:var(--k-fs-${n})${n === "mono" ? ";font-family:var(--mono)" : ""}`],
  "k-lh-": (n) => [`kanso-leading--${n}`, `line-height:var(--k-lh-${n})`],
  "k-fw-": (n) => [`kanso-weight--${n}`, `font-weight:var(--k-fw-${n})`],
  "k-ls-": (n) => [`kanso-tracking--${n}`, `letter-spacing:var(--k-ls-${n})`],
  "k-sp-": (n) => [`kanso-gap--${n}`, `gap:var(--k-sp-${n})`],
  "k-r-": (n) => [`kanso-radius--${n}`, `border-radius:var(--k-r-${n})`],
  "k-h-": (n) => [`kanso-height--${n}`, `block-size:var(--k-h-${n})`],
  "k-ic-": (n) => [`kanso-icon--${n}`, `inline-size:var(--k-ic-${n});block-size:var(--k-ic-${n})`],
};

export function renderUtilities(tokens) {
  const rule = ([name, body]) => `.${name}{${body}}`;
  const colours = tokens.colour.dark.map((t) => t.name).filter((n) => n !== "shadow");
  const sizes = sizeTokens(tokens)
    .flatMap((t) => Object.entries(SIZES).filter(([prefix]) => t.name.startsWith(prefix)).map(([prefix, make]) => make(t.name.slice(prefix.length))));
  return `/* Generated from ${TOKENS} by npm run build:site-tokens: one class per token. */
${colours.flatMap((n) => [[`kanso-text--${n}`, `color:var(--${n})!important`], [`kanso-fill--${n}`, `background:var(--${n})`], [`kanso-ring--${n}`, `box-shadow:inset 0 0 0 1px var(--${n})`]]).map(rule).join("\n")}
.kanso-shadow{box-shadow:var(--shadow)}
${sizes.map(rule).join("\n")}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeChanged(OUT, render(loadTokens()));
  writeChanged(UTILITIES, renderUtilities(loadTokens()));
}
