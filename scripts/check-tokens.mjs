#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTokens, read, writeChanged } from "./tokens.mjs";
import { SHARED } from "./sync-share.mjs";

export const MODS = "kanso/mods";
export const BASELINE = "kanso/tokens-baseline.json";

// Linted calls, by the token groups their number literal must come from; 0 always passes.
export const CALLS = {
  type: ["text_size"],
  space: ["gap", "gap_x", "gap_y", "p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr"],
  radius: ["rounded", "rounded_t", "rounded_b", "rounded_l", "rounded_r"],
  height: ["h", "w", "size", "min_h", "min_w", "max_h", "max_w"],
};

const pxValues = (list) => list.filter((t) => /^-?[\d.]+px$/.test(t.value)).map((t) => Number.parseFloat(t.value));

export function allowed(tokens) {
  return {
    type: new Set(pxValues(tokens.type.filter((t) => t.name.startsWith("k-fs-")))),
    space: new Set(pxValues(tokens.space)),
    radius: new Set(pxValues(tokens.radius)),
    height: new Set(pxValues([...tokens.height, ...tokens.icon, ...tokens.switch])),
  };
}

const groupOf = new Map(Object.entries(CALLS).flatMap(([group, names]) => names.map((name) => [name, group])));
const CALL = new RegExp(`\\.(${[...groupOf.keys()].join("|")})\\(\\s*(-?\\d*\\.?\\d+)\\s*\\)`, "g");

const lines = (files, find) => files.flatMap(({ file, text }) => text.split(/\r?\n/).flatMap((line, i) =>
  find(line).map((v) => ({ file, number: i + 1, line: line.trim(), ...v }))));

export function violations(files, tokens) {
  const ok = allowed(tokens);
  return lines(files, (line) => [...line.matchAll(CALL)]
    .map((m) => ({ call: m[1], value: Number(m[2]) }))
    .filter(({ call, value }) => value !== 0 && !ok[groupOf.get(call)].has(value))
    .map(({ call, value }) => ({ value, message: `${call}(${value}) is not a token value in kanso/tokens.json` })));
}

// Washes, opacity and motion have names in ui.js, the one file that may write them as numbers.
const first = (m) => [m[1]];
// Every number in the call but full (1) and none (0).
const shares = (m) => (m[1].match(/(?<![\w.])\d*\.?\d+(?![\w.])/g) ?? []).filter((n) => Number(n) !== 0 && Number(n) !== 1);
export const LOOKS = [
  { pattern: /\+\s*("[0-9a-f]{2}")/gi, values: first, what: "hex-alpha wash", use: "c.w4, c.w7, c.w12, c.w14, CLEAR or alpha() with TINT" },
  { pattern: /\.opacity\s*\(((?:[^()]|\([^()]*\))*)\)/g, values: shares, what: "opacity", use: "OPACITY, BEAT, BREATH or PULSE" },
  { pattern: /\bduration\s*:\s*(\d+)/g, values: first, what: "duration", use: "EASE or GLIDE" },
];

// Whole files, so a call or a key split over lines is still seen; it is reported on the line it starts.
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
export const looks = (files) => files.filter(({ file }) => !file.endsWith("/ui.js")).flatMap(({ file, text }) => {
  const rows = text.split(/\r?\n/);
  return LOOKS.flatMap(({ pattern, values, what, use }) => [...text.matchAll(pattern)].flatMap((m) => values(m).map((value) => ({ m, value, what, use }))))
    .sort((a, b) => a.m.index - b.m.index)
    .map(({ m, value, what, use }) => {
      const number = lineAt(text, m.index);
      return { file, number, line: rows[number - 1].trim(), value, message: `${value} is a literal ${what}: use ${use} from ui.js` };
    });
});

const key = (v) => JSON.stringify([v.file, v.line, v.value]);

export function compare(found, baseline) {
  const left = new Map();
  for (const b of baseline) left.set(key(b), (left.get(key(b)) ?? 0) + 1);
  const errors = [];
  for (const v of found) {
    const n = left.get(key(v)) ?? 0;
    if (n) left.set(key(v), n - 1);
    else errors.push(`${v.file}:${v.number}: ${v.message}`);
  }
  for (const b of baseline) {
    if (!left.get(key(b))) continue;
    left.set(key(b), left.get(key(b)) - 1);
    errors.push(`${BASELINE} lists ${b.file}: ${b.value} in "${b.line}", which is gone: run npm run check:tokens -- --write`);
  }
  return errors;
}

// A synced copy is its source byte for byte (sync:share --check), so only the source is linted.
const COPIES = new Set(SHARED.flatMap(({ copies }) => copies));

export function modFiles() {
  return readdirSync(new URL(`../${MODS}/`, import.meta.url), { recursive: true })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".js") && !COPIES.has(`${MODS}/${p}`))
    .sort()
    .map((p) => ({ file: `${MODS}/${p}`, text: read(`${MODS}/${p}`) }));
}

export const render = (found) => `[\n${found.map(({ file, line, value }) => `  ${JSON.stringify({ file, line, value })}`).join(",\n")}\n]\n`;

const found = (files = modFiles()) => [...violations(files, loadTokens()), ...looks(files)];

export function check() {
  return compare(found(), JSON.parse(read(BASELINE)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) writeChanged(BASELINE, render(found()));
  else {
    const errors = check();
    for (const e of errors) console.error(e);
    process.exit(errors.length ? 1 : 0);
  }
}
