import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TOKENS = "kanso/tokens.json";
export const THEMES = ["dark", "light"];

export const read = (path) => readFileSync(ROOT + path, "utf8");
export const loadTokens = () => JSON.parse(read(TOKENS));

export function writeChanged(path, text) {
  let old = null;
  try { old = read(path); } catch {}
  if (old === text) return;
  writeFileSync(ROOT + path, text);
  console.log(`wrote ${path}`);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function colour(tokens, theme, name) {
  const t = tokens.colour[theme].find((x) => x.name === name);
  if (!t) throw new Error(`no colour ${name} in ${theme}`);
  const mix = /^color-mix\(in srgb, var\(--([a-z]+)\) ([\d.]+)%, var\(--([a-z]+)\)\)$/.exec(t.value);
  if (!mix) return t.value;
  const a = rgb(colour(tokens, theme, mix[1])), b = rgb(colour(tokens, theme, mix[3])), p = Number(mix[2]) / 100;
  return toHex(a.map((v, i) => v * p + b[i] * (1 - p)));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
