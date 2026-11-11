#!/usr/bin/env node
// Rewrites tests/herdr-api.json from this machine's Herdr declarations.
//
//   node scripts/herdr-api.mjs           write the fixture
//   node scripts/herdr-api.mjs --check   fail when the fixture is behind
//
// CI has no Herdr. The fixture is the list the import check uses there.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = join(homedir(), ".config", "herdr-app");
const FIXTURE = fileURLToPath(new URL("../tests/herdr-api.json", import.meta.url));

// Host globals the declarations do not give a mod.
export const ABSENT_GLOBALS = ["Buffer", "TextDecoder", "URL", "atob", "crypto", "setTimeout", "structuredClone"];

// Own names of a fresh vm context besides console: the language, which a mod may use.
const LANGUAGE = new Set([
  "AggregateError", "Array", "ArrayBuffer", "AsyncDisposableStack", "Atomics", "BigInt", "BigInt64Array", "BigUint64Array",
  "Boolean", "DataView", "Date", "DisposableStack", "Error", "EvalError", "FinalizationRegistry", "Float16Array",
  "Float32Array", "Float64Array", "Function", "Infinity", "Int16Array", "Int32Array", "Int8Array", "Intl", "Iterator",
  "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect",
  "RegExp", "Set", "SharedArrayBuffer", "String", "SuppressedError", "Symbol", "SyntaxError", "Temporal", "TypeError",
  "URIError", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet",
  "WebAssembly", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "eval", "globalThis",
  "isFinite", "isNaN", "parseFloat", "parseInt", "undefined", "unescape",
]);

export function bannedGlobals(present, declared) {
  const keep = new Set(declared);
  const extra = present.filter((name) => !LANGUAGE.has(name) && !keep.has(name));
  return [...new Set([...ABSENT_GLOBALS, ...extra])].sort();
}

const keyword = (text, i, word) => text.startsWith(word, i) && !/[\w$]/.test(text[i + word.length] ?? "");
const readIdent = (text, i) => /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0] ?? "";

export function skipString(text, i) {
  const quote = text[i++];
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipTemplate(text, i) {
  i++;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === "`") return i + 1;
    i++;
  }
  return i;
}

function skipGap(text, i) {
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith("//", i)) { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end; continue; }
    if (text.startsWith("/*", i)) { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; continue; }
    break;
  }
  return i;
}

function skipLiteral(text, i) {
  const ch = text[i];
  if (ch === "'" || ch === '"') return skipString(text, i);
  if (ch === "`") return skipTemplate(text, i);
  return i;
}

function matchBrace(text, open) {
  let depth = 0, i = open;
  while (i < text.length) {
    i = skipGap(text, i);
    if (i >= text.length) break;
    const skipped = skipLiteral(text, i);
    if (skipped !== i) { i = skipped; continue; }
    if (text[i] === "{") { depth++; i++; continue; }
    if (text[i] === "}") { depth--; if (depth === 0) return i; i++; continue; }
    i++;
  }
  return text.length;
}

function readStar(text, i) {
  const matched = /^[\s\S]*?\bfrom\s+["']([^"']+)["']/.exec(text.slice(i));
  return matched ? { from: matched[1], next: i + matched.index + matched[0].length } : null;
}

function readExport(text, i) {
  let j = skipGap(text, i + "export".length);
  if (text[j] === "*") {
    const star = readStar(text, j);
    return star ? { star: star.from, next: star.next } : { next: j + 1 };
  }
  if (text[j] === "{") return { next: j };
  if (keyword(text, j, "type") || keyword(text, j, "interface") || keyword(text, j, "namespace")) return { next: j };
  if (keyword(text, j, "default")) return { name: "default", next: j + "default".length };
  if (keyword(text, j, "abstract")) j = skipGap(text, j + "abstract".length);
  if (keyword(text, j, "async")) j = skipGap(text, j + "async".length);
  if (keyword(text, j, "declare")) j = skipGap(text, j + "declare".length);
  for (const kind of ["function", "class", "const", "let", "var", "enum"]) {
    if (!keyword(text, j, kind)) continue;
    j = skipGap(text, j + kind.length);
    const name = readIdent(text, j);
    return name ? { name, next: j + name.length } : { next: j };
  }
  return { next: j + 1 };
}

function walk(text, atTop) {
  let i = 0, depth = 0;
  while (i < text.length) {
    i = skipGap(text, i);
    if (i >= text.length) break;
    const skipped = skipLiteral(text, i);
    if (skipped !== i) { i = skipped; continue; }
    if (text[i] === "{") { depth++; i++; continue; }
    if (text[i] === "}") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0) {
      const next = atTop(i);
      if (next > i) { i = next; continue; }
    }
    i += /[A-Za-z_$]/.test(text[i]) ? (readIdent(text, i).length || 1) : 1;
  }
}

function scanExports(text) {
  const names = new Set(), stars = [];
  walk(text, (i) => {
    if (!keyword(text, i, "export")) return i;
    const read = readExport(text, i);
    if (read.name) names.add(read.name);
    if (read.star) stars.push(read.star);
    return read.next > i ? read.next : i + 1;
  });
  return { names, stars };
}

function readModule(text, i) {
  let j = skipGap(text, i + "declare".length);
  if (!keyword(text, j, "module")) return null;
  j = skipGap(text, j + "module".length);
  if (text[j] !== '"' && text[j] !== "'") return null;
  const end = text.indexOf(text[j], j + 1);
  const name = text.slice(j + 1, end);
  j = skipGap(text, end + 1);
  if (text[j] !== "{") return null;
  const close = matchBrace(text, j);
  return { name, body: scanExports(text.slice(j + 1, close)), next: close + 1 };
}

function readGlobal(text, i) {
  let j = skipGap(text, i + "declare".length);
  if (keyword(text, j, "module") || keyword(text, j, "global") || keyword(text, j, "namespace") || keyword(text, j, "type") || keyword(text, j, "interface")) return null;
  for (const kind of ["function", "const", "var", "class", "let"]) {
    if (!keyword(text, j, kind)) continue;
    j = skipGap(text, j + kind.length);
    const name = readIdent(text, j);
    return name ? { name, next: j + name.length } : null;
  }
  return null;
}

function scanFile(text) {
  const modules = {}, globals = new Set();
  walk(text, (i) => {
    if (!keyword(text, i, "declare")) return i;
    const mod = readModule(text, i);
    if (mod) { modules[mod.name] = mod.body; return mod.next; }
    const global = readGlobal(text, i);
    if (global) { globals.add(global.name); return global.next; }
    return i;
  });
  return { modules, globals };
}

function resolveStars(modules) {
  const out = {};
  const resolving = new Set();
  const namesOf = (mod) => {
    if (out[mod]) return out[mod];
    const info = modules[mod];
    if (!info) return [];
    if (resolving.has(mod)) return [...info.names];
    resolving.add(mod);
    const names = new Set(info.names);
    for (const other of info.stars) for (const name of namesOf(other)) if (name !== "default") names.add(name);
    resolving.delete(mod);
    out[mod] = [...names].sort();
    return out[mod];
  };
  for (const mod of Object.keys(modules)) namesOf(mod);
  return out;
}

export function parseDeclarations(gpuiText, herdrText) {
  const { modules, globals } = scanFile(gpuiText);
  modules.herdr = scanExports(herdrText);
  const resolved = resolveStars(modules);
  return {
    globals: [...globals].sort(),
    modules: Object.fromEntries(Object.keys(resolved).sort().map((name) => [name, resolved[name]])),
  };
}

export function loadDeclarations(dir = HOME) {
  const gpui = join(dir, "gpui-kit.d.ts"), herdr = join(dir, "herdr.d.ts");
  if (!existsSync(gpui) || !existsSync(herdr)) return null;
  return parseDeclarations(readFileSync(gpui, "utf8"), readFileSync(herdr, "utf8"));
}

export function fixtureDrift(live, vendored) {
  if (live == null) return null;
  return JSON.stringify(live) === JSON.stringify(vendored) ? null : "tests/herdr-api.json is behind the Herdr declarations; run node scripts/herdr-api.mjs";
}

function main() {
  const live = loadDeclarations();
  if (!live) { console.error("error: ~/.config/herdr-app declarations were not found"); process.exit(1); }
  if (process.argv.includes("--check")) {
    const drift = fixtureDrift(live, JSON.parse(readFileSync(FIXTURE, "utf8")));
    if (drift) { console.error(`error: ${drift}`); process.exit(1); }
    return;
  }
  writeFileSync(FIXTURE, `${JSON.stringify(live, null, 2)}\n`);
  console.log("Wrote tests/herdr-api.json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
