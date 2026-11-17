// The theme colour `input` draws edges only: fills, guide lines and text use their own tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsFiles } from "./helpers.mjs";

const ROOTS = ["kanso/mods", "markdown-panel/mods", "open-with/mods"];
const USE = /\b(?:t|c|theme)\.input\b/g;
const OPEN = { ")": "(", "]": "[", "}": "{" };
// Where `input` may sit: inside a border colour call, or named as an edge or border.
const EDGE_CALL = /\bborder_color\($/;
const EDGE_NAME = /^\s*(?:const\s+)?(?:edge\s*=|border\s*:|input\s*:)/;


// The innermost bracket still open before `at`, and where it is.
const enclosing = (text, at) => {
  const shut = [];
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch in OPEN) shut.push(ch);
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (!shut.length) return i;
      shut.pop();
    }
  }
  return -1;
};

// Lines where `input` is used as something other than an edge.
export function inputMisuses(text) {
  return [...text.matchAll(USE)].flatMap((m) => {
    const open = enclosing(text, m.index);
    if (open >= 0 && text[open] === "(" && EDGE_CALL.test(text.slice(0, open + 1))) return [];
    const clause = text.slice(open + 1, m.index).split(/[,;\n]/).at(-1);
    return EDGE_NAME.test(clause) ? [] : [text.slice(0, m.index).split("\n").length];
  });
}

test("an edge in the input colour passes, a fill, a guide line or a text colour is found", () => {
  assert.deepEqual(inputMisuses("div().border_1().border_color(t.input)"), []);
  assert.deepEqual(inputMisuses("x.border_color(this.focused ? t.accent : t.input).bg(t.background)"), []);
  assert.deepEqual(inputMisuses("const edge = disabled ? c.border : checked ? c.primary : c.input;"), []);
  assert.deepEqual(inputMisuses("return {\n  border: t.border ?? t.input, input: t.input ?? t.border,\n};"), []);
  assert.deepEqual(inputMisuses("el.hover((s) => s.bg(t.input).text_color(t.foreground))"), [1]);
  assert.deepEqual(inputMisuses("a\ndiv().w(1).h(4).bg(t.input)"), [2]);
  assert.deepEqual(inputMisuses("const tone = on ? t.foreground : t.input;"), [1]);
  assert.deepEqual(inputMisuses("div().text_color(c.input)"), [1]);
});

test("no mod uses the input colour as a fill, a guide line or a text colour", async () => {
  const files = (await Promise.all(ROOTS.map(jsFiles))).flat();
  const found = (await Promise.all(files.map(async (f) => inputMisuses(await readFile(f, "utf8")).map((line) => `${f}:${line}`)))).flat();
  assert.deepEqual(found, []);
});
