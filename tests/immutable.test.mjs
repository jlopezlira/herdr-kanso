// Every mod's code is written without reassignment or in-place change: no
// let or var, no ++ or --, no array changed in place (push, splice, sort...:
// toSorted, toSpliced, spread and the rest make a new one instead), and no
// object, Map or Set changed but a view's own state (this.*).
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["kanso/mods", "markdown-panel/mods", "open-with/mods"];
async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}
// The code alone: comments and the insides of strings, regexes and
// templates blanked (a word in prose is not a declaration), with the code
// inside a template's ${...} kept, nested to any depth. Newlines stay, so
// line numbers are the file's.
function code(text) {
  let out = "", i = 0;
  const n = text.length;
  const keepNewlines = (from, to) => { out += text.slice(from, to).replace(/[^\n]/g, " "); };
  // From i, code until an unmatched "}" (inside a template's ${...}) or the end.
  const scan = (inTemplate) => {
    let depth = 0;
    while (i < n) {
      const c = text[i], d = text[i + 1];
      if (c === "/" && d === "/") { const s = i; while (i < n && text[i] !== "\n") i++; keepNewlines(s, i); continue; }
      if (c === "/" && d === "*") { const s = i; i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; keepNewlines(s, i); continue; }
      if (c === "/" && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase)\s*$/.test(out.slice(-12))) {
        const s = i; i++;
        let cls = false;
        while (i < n && text[i] !== "\n" && (cls || text[i] !== "/")) { if (text[i] === "\\") i++; else if (text[i] === "[") cls = true; else if (text[i] === "]") cls = false; i++; }
        i++; out += "/"; keepNewlines(s + 1, i - 1); out += "/"; continue;
      }
      if (c === '"' || c === "'") {
        const s = i; i++;
        while (i < n && text[i] !== c && text[i] !== "\n") { if (text[i] === "\\") i++; i++; }
        i++; out += c; keepNewlines(s + 1, i - 1); out += c; continue;
      }
      if (c === "`") {
        out += "`"; i++;
        while (i < n && text[i] !== "`") {
          if (text[i] === "\\") { keepNewlines(i, i + 2); i += 2; continue; }
          if (text[i] === "$" && text[i + 1] === "{") { out += "${"; i += 2; scan(true); out += "}"; i++; continue; }
          keepNewlines(i, i + 1); i++;
        }
        out += "`"; i++; continue;
      }
      if (inTemplate && c === "{") depth++;
      if (inTemplate && c === "}") { if (depth === 0) return; depth--; }
      out += c; i++;
    }
  };
  scan(false);
  return out;
}
const RULES = [
  [/(^|[^\w$.])(let|var)\s+[\w$[{]/, "let/var"],
  [/\+\+|--(?!>)/, "++/--"],
  [/\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\(/, "array changed in place"],
  // Nothing but a view's own state (this.*) is changed: no property set on
  // another object, none deleted, no Map or Set changed, nothing assigned
  // onto an existing object.
  [/(^|[^\w$.])(?!this\b)[A-Za-z_$][\w$]*((\.[\w$]+)|(\[[^\]]*\]))+\s*(=|\+=|-=|\*=|\/=|%=|\*\*=|\?\?=|\|\|=|&&=|<<=|>>=|\|=|&=|\^=)(?!=)/, "property set outside this"],
  [/(^|[^\w$])delete\s+(?!this\b)/, "delete outside this"],
  [/(^|[^\w$.])(?!this\b)[A-Za-z_$][\w$]*(\.[\w$]+)*\.(set|add|delete|clear)\(/, "Map/Set changed outside this"],
  [/Object\.(assign|defineProperty|defineProperties|setPrototypeOf)\((?!\s*\{)/, "an existing object changed"],
];

test("mods never reassign or change arrays in place", async () => {
  const found = [];
  for (const root of ROOTS) for (const f of await files(root)) {
    code(await readFile(f, "utf8")).split("\n").forEach((line, i) => {
      for (const [re, what] of RULES) if (re.test(line)) found.push(`${f}:${i + 1} ${what}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(found, [], `${found.length} left:\n${found.join("\n")}`);
});
