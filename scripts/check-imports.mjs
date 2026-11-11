#!/usr/bin/env node
// Checks that every mod's import graph is one Herdr can load.
//
//   node scripts/check-imports.mjs
//
// Walks main.js for each mod under kanso/mods, markdown-panel/mods and
// open-with/mods. A name imported from a module Herdr provides must be in
// tests/herdr-api.json. A relative import must resolve to a file that exports it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { skipString } from "./herdr-api.mjs";
import { exportedNames } from "./mod-source.mjs";

export const MOD_ROOTS = ["kanso/mods", "markdown-panel/mods", "open-with/mods"];
const MULTI = [">>>=", ">>=", "<<=", ">>>", "===", "!==", "...", "?.", "=>", "&&", "||", "??", "==", "!=", "<=", ">=", "++", "--", "<<", ">>", "**", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
const REGEX_AFTER = new Set(["return", "case", "throw", "else", "typeof", "void", "delete", "do", "in", "of", "instanceof", "new", "yield", "await", "debugger"]);

const regexOk = (prev) => {
  if (!prev) return true;
  if (prev.type === "ident") return REGEX_AFTER.has(prev.value);
  return prev.type === "punct" && !["}", ")", "]"].includes(prev.value);
};

function skipRegex(text, i) {
  i++;
  while (i < text.length && text[i] !== "\n") {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === "[") {
      i++;
      while (i < text.length && text[i] !== "]" && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
      if (text[i] === "]") i++;
      continue;
    }
    if (text[i] === "/") {
      i++;
      while (/[a-z]/i.test(text[i] ?? "")) i++;
      return i;
    }
    i++;
  }
  return i;
}

// Tokens of one mod file: comments dropped, template text dropped, ${ } kept.
export function lex(text) {
  const tokens = [];
  let i = 0, line = 1, brace = 0;
  const modes = ["code"], stops = [];
  const push = (type, value, at, atLine) => tokens.push({ type, value, index: at, line: atLine });
  const bump = (from, to) => { for (let k = from; k < to; k++) if (text[k] === "\n") line++; };
  while (i < text.length) {
    const ch = text[i];
    if (modes.at(-1) === "template") {
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { modes.pop(); i++; continue; }
      if (ch === "$" && text[i + 1] === "{") { stops.push(brace); modes.push("code"); i += 2; continue; }
      if (ch === "\n") line++;
      i++;
      continue;
    }
    if (ch === "\n") { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "/" && text[i + 1] === "/") { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      bump(i, stop); i = stop; continue;
    }
    if (ch === "'" || ch === '"') {
      const start = i, at = line;
      i = skipString(text, i);
      bump(start, i);
      push("string", text.slice(start + 1, i - 1), start, at);
      continue;
    }
    if (ch === "`") { modes.push("template"); i++; continue; }
    if (ch === "{") { brace++; push("punct", ch, i, line); i++; continue; }
    if (ch === "}") {
      if (stops.length && brace === stops.at(-1)) { stops.pop(); modes.pop(); i++; continue; }
      brace--;
      push("punct", ch, i, line); i++; continue;
    }
    if (ch === "/" && regexOk(tokens.at(-1))) { const start = i; i = skipRegex(text, i); push("regex", text.slice(start, i), start, line); continue; }
    const multi = MULTI.find((op) => text.startsWith(op, i));
    if (multi) { push("punct", multi, i, line); i += multi.length; continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (/[\w$]/.test(text[i] ?? "")) i++;
      push("ident", text.slice(start, i), start, line);
      continue;
    }
    if (/\d/.test(ch)) {
      const start = i;
      if (ch === "0" && /[xob]/i.test(text[i + 1] ?? "")) i += 2;
      while (/[\d._a-f]/i.test(text[i] ?? "")) i++;
      if (text[i] === "n") i++;
      push("number", text.slice(start, i), start, line);
      continue;
    }
    push("punct", ch, i, line);
    i++;
  }
  return tokens;
}

const isBoundary = (tokens, i) => {
  const prev = tokens[i - 1];
  return !prev || (prev.type === "punct" && [";", "{", "}"].includes(prev.value));
};

function statementEnd(tokens, i) {
  let depth = 0;
  for (let j = i + 1; j < tokens.length; j++) {
    const value = tokens[j].value;
    if (value === "{") depth++;
    else if (value === "}") depth--;
    else if (value === ";" && depth <= 0) return j;
  }
  return tokens.length - 1;
}

function specsOf(head) {
  const specs = [];
  let i = 0;
  if (head[0]?.type === "ident" && head[0].value === "type") return specs;
  if (head[i]?.type === "ident") {
    specs.push({ imported: "default", line: head[i].line });
    i++;
    if (head[i]?.value === ",") i++;
  }
  if (head[i]?.value === "*") return specs;
  if (head[i]?.value === "{") {
    i++;
    while (i < head.length && head[i].value !== "}") {
      if (head[i].type === "ident" && head[i].value !== "as") {
        const name = head[i];
        specs.push({ imported: name.value, line: name.line });
        if (head[i + 1]?.value === "as") i += 2;
      }
      i++;
    }
  }
  return specs;
}

export function importsOf(source) {
  const tokens = lex(source);
  const imports = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value !== "import" || token.type !== "ident" || !isBoundary(tokens, i)) continue;
    if (tokens[i + 1]?.value === ":") continue;
    const end = statementEnd(tokens, i);
    const stmt = tokens.slice(i + 1, end);
    const bare = stmt.length === 1 && stmt[0].type === "string";
    const fromAt = bare ? 0 : stmt.findIndex((part, index) => part.value === "from" && stmt[index + 1]?.type === "string");
    if (fromAt < 0) continue;
    const from = stmt[fromAt + (bare ? 0 : 1)].value;
    const head = bare ? [] : stmt.slice(0, fromAt);
    imports.push({ from, line: token.line, relative: from.startsWith("."), specs: head[0]?.value === "type" ? [] : specsOf(head) });
    i = end;
  }
  return imports;
}

export function jsExports(text) {
  const names = new Set(exportedNames(text));
  const tokens = lex(text);
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i].value === "export" && tokens[i + 1].value === "default") names.add("default");
  return names;
}

export function resolveSpec(fromFile, spec) {
  const parts = fromFile.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const missing = (file, line, imported, from) => `${file}:${line}: no export '${imported}' in '${from}'`;

export function issuesIn(file, text, read, api, modDir) {
  const issues = [];
  for (const item of importsOf(text)) {
    if (item.relative) {
      const target = resolveSpec(file, item.from);
      let body = null;
      if (target.startsWith(`${modDir}/`)) { try { body = read(target); } catch { body = null; } }
      if (body == null) { issues.push(`${file}:${item.line}: '${item.from}' does not resolve`); continue; }
      const have = jsExports(body);
      for (const spec of item.specs) if (!have.has(spec.imported)) issues.push(missing(file, spec.line, spec.imported, item.from));
      continue;
    }
    const declared = api.modules[item.from];
    if (!declared) {
      if (!item.specs.length) issues.push(`${file}:${item.line}: '${item.from}' is not a module Herdr provides`);
      else for (const spec of item.specs) issues.push(missing(file, spec.line, spec.imported, item.from));
      continue;
    }
    const have = new Set(declared);
    for (const spec of item.specs) if (!have.has(spec.imported)) issues.push(missing(file, spec.line, spec.imported, item.from));
  }
  return issues;
}

const property = (prev) => prev?.type === "punct" && (prev.value === "." || prev.value === "?.");

function bindingName(tokens, index) {
  const prev = tokens[index - 1];
  if (prev?.type === "ident" && ["function", "class"].includes(prev.value)) return true;
  if (prev?.value === "(" && tokens[index - 2]?.value === "catch") return true;
  let depth = 0;
  for (let j = index - 1; j >= 0; j--) {
    const token = tokens[j];
    if (token.type === "punct" && ")]}".includes(token.value)) depth++;
    else if (token.type === "punct" && "([{".includes(token.value)) { if (depth === 0) continue; depth--; }
    else if (depth === 0 && token.type === "punct" && (token.value === ";" || token.value === "=")) return false;
    else if (depth === 0 && token.type === "ident" && ["const", "let", "var"].includes(token.value)) return true;
  }
  return false;
}

export function globalUses(file, source, names) {
  const banned = new Set(names);
  const tokens = lex(source);
  const uses = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value === "import" && token.type === "ident" && isBoundary(tokens, i) && tokens[i + 1]?.value !== ":") {
      i = statementEnd(tokens, i);
      continue;
    }
    if (token.type !== "ident" || !banned.has(token.value) || property(tokens[i - 1]) || tokens[i + 1]?.value === ":" || bindingName(tokens, i)) continue;
    uses.push({ file, line: token.line, name: token.value });
  }
  return uses;
}

export function modGraph(read, modDir) {
  const files = [], seen = new Set(), pending = [`${modDir}/main.js`];
  while (pending.length) {
    const file = pending.pop();
    if (!file?.startsWith(`${modDir}/`) || seen.has(file)) continue;
    seen.add(file);
    let text;
    try { text = read(file); } catch { continue; }
    files.push({ file, text });
    for (const item of importsOf(text)) if (item.relative) pending.push(resolveSpec(file, item.from));
  }
  return files;
}

export function auditMod(read, modDir, api, names) {
  const graph = modGraph(read, modDir);
  const issues = [], uses = [], files = [];
  if (!graph.length) issues.push(`${modDir}/main.js:1: 'main.js' does not resolve`);
  for (const { file, text } of graph) {
    files.push(file);
    issues.push(...issuesIn(file, text, read, api, modDir));
    uses.push(...globalUses(file, text, names));
  }
  return { issues, uses, files };
}

export function modDirs(root) {
  const dirs = [];
  for (const base of MOD_ROOTS) {
    let names = [];
    try { names = readdirSync(join(root, base)); } catch { continue; }
    for (const name of names) {
      const dir = `${base}/${name}`;
      if (existsSync(join(root, dir, "main.js"))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

export function readRepo(root) {
  return (file) => readFileSync(join(root, ...file.split("/")), "utf8");
}

export function repositoryAudit(root, api, names = []) {
  const read = readRepo(root);
  const issues = [], uses = [], files = [];
  for (const dir of modDirs(root)) {
    const audited = auditMod(read, dir, api, names);
    issues.push(...audited.issues);
    uses.push(...audited.uses);
    files.push(...audited.files);
  }
  return { issues, uses, files };
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const api = JSON.parse(readFileSync(new URL("../tests/herdr-api.json", import.meta.url), "utf8"));
  const { issues } = repositoryAudit(root, api);
  if (!issues.length) return;
  for (const line of issues) console.error(line);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
