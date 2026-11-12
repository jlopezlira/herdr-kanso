#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { TOKENS, loadTokens, writeChanged } from "./tokens.mjs";

export const OUT = "site/tokens.css";

const vars = (list, indent) => list.map((t) => `${indent}--${t.name}: ${t.value};`).join("\n");

export function render(tokens) {
  const sizes = Object.entries(tokens).filter(([group]) => group !== "colour").flatMap(([, list]) => list);
  return `/* Generated from ${TOKENS} by npm run build:site-tokens. */
:root {
${vars(sizes, "  ")}
${vars(tokens.colour.dark, "  ")}
}

@media (prefers-color-scheme: light) {
  :root {
${vars(tokens.colour.light, "    ")}
  }
}
:root[data-theme="dark"] {
${vars(tokens.colour.dark, "  ")}
}

:root[data-theme="light"] {
${vars(tokens.colour.light, "  ")}
}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeChanged(OUT, render(loadTokens()));
