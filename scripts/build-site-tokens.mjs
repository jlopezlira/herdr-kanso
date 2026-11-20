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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeChanged(OUT, render(loadTokens()));
}
