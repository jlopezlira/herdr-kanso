// Every press target is a kit button or row: outside the kit, an `on_click` on a bare `div`, `h_flex` or `v_flex` with no focus handle
// is one Tab cannot reach and Enter and Space cannot press. The ones left belong to compositions not yet shared; the baseline only shrinks.
import test from "node:test";
import assert from "node:assert/strict";
import { repoText, load, nodes, texts, themed, KIT_NIGHT, drawingHost } from "./helpers.mjs";
import { loadTokens } from "./mod-fixtures.mjs";
import { outsideKit } from "./mod-sources.mjs";

const BASELINE = "tests/press-targets-baseline.json";
const sources = () => outsideKit().sort();

// The source with every comment, string and template blanked to spaces, so brackets and words are code only; lines keep their numbers.
export function codeOnly(text) {
  const out = [...text];
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  let last = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === "/" && next === "/") { const end = text.indexOf("\n", i); const to = end < 0 ? text.length : end; blank(i, to); i = to - 1; continue; }
    if (ch === "/" && next === "*") { const to = text.indexOf("*/", i + 2) + 2; blank(i, to); i = to - 1; continue; }
    if (ch === "/" && /[(,=:[!&|?{};]|^$/.test(last)) {
      let k = i + 1, inClass = false;
      for (; k < text.length && text[k] !== "\n"; k++) {
        if (text[k] === "\\") { k++; continue; }
        if (text[k] === "[") inClass = true;
        else if (text[k] === "]") inClass = false;
        else if (text[k] === "/" && !inClass) break;
      }
      blank(i + 1, k); i = k; last = "/"; continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      let k = i + 1;
      for (; k < text.length && text[k] !== ch; k++) if (text[k] === "\\") k++;
      blank(i + 1, k); i = k; last = ch; continue;
    }
    if (!/\s/.test(ch)) last = ch;
  }
  return out.join("");
}

const OPEN = "([{", CLOSE = ")]}";
// Where the expression holding `at` starts: back to the nearest `,` `;` `=>` `?` `:` `=` `&&` `||` or `return` at its depth, or its open bracket.
// Returns that start, and the index of the enclosing open bracket (-1 at the top).
function expressionStart(code, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = code[i];
    if (CLOSE.includes(ch)) depth++;
    else if (OPEN.includes(ch)) { if (depth === 0) return { start: i + 1, open: i }; depth--; }
    else if (depth === 0) {
      if (ch === ">" && code[i - 1] === "=") return { start: i + 1, open: enclosing(code, i) };
      if (",;?:".includes(ch)) return { start: i + 1, open: enclosing(code, i) };
      if (ch === "=" && !"=!<>".includes(code[i - 1]) && code[i + 1] !== "=" && code[i + 1] !== ">") return { start: i + 1, open: enclosing(code, i) };
      if ((ch === "&" && code[i - 1] === "&") || (ch === "|" && code[i - 1] === "|")) return { start: i + 1, open: enclosing(code, i) };
      if (/\breturn$/.test(code.slice(Math.max(0, i - 6), i + 1)) && !/\w/.test(code[i - 6] ?? "")) return { start: i + 1, open: enclosing(code, i) };
    }
  }
  return { start: 0, open: -1 };
}

function enclosing(code, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (CLOSE.includes(code[i])) depth++;
    else if (OPEN.includes(code[i])) { if (depth === 0) return i; depth--; }
  }
  return -1;
}

// The chain an `.on_click(` at `at` is called on: its root call, and every link up to it, through `.when(cond, (el) => el…)`.
export function chainOf(code, at) {
  const links = [];
  let end = at;
  for (;;) {
    const { start, open } = expressionStart(code, end);
    const text = code.slice(start, end).trim();
    links.unshift(text);
    const param = text.match(/^(\w+)\b/)?.[1];
    // `(el) => el.on_click(…)` inside `.when(`: the chain goes on before that `.when`.
    if (param && open >= 0 && code[open] === "(" && /\.when\s*$/.test(code.slice(0, open)) && new RegExp(`\\(?\\s*${param}\\s*\\)?\\s*=>\\s*$`).test(code.slice(0, start))) {
      end = code.slice(0, open).search(/\.when\s*$/);
      continue;
    }
    return { root: links[0], links };
  }
}

// What a chain is called on: its text before the first `.call(` outside brackets, such as `div()`, `flush(h_flex()…, 8)` or `(open ? h_flex() : …)`.
const headOf = (root) => {
  let depth = 0;
  for (let i = 0; i < root.length; i++) {
    if (OPEN.includes(root[i])) depth++;
    else if (CLOSE.includes(root[i])) depth--;
    else if (depth === 0 && root[i] === "." && i > 0 && /[)\w]\s*$/.test(root.slice(0, i)) && !/^\.new\b/.test(root.slice(i)) && /^\.\w+\s*\(/.test(root.slice(i)) && root.slice(0, i).includes("(")) return root.slice(0, i);
  }
  return root;
};

// Every bare press target in one file's text: its line, as `file:line`.
export function barePresses(file, text) {
  const code = codeOnly(text);
  return [...code.matchAll(/\.on_click\s*\(/g)].flatMap((m) => {
    const { root, links } = chainOf(code, m.index);
    const head = headOf(root);
    const bare = /\b(?:div|h_flex|v_flex)\s*\(\s*\)/.test(head) && !/\bButton\.new\b/.test(head) && !links.some((link) => /\.track_focus\s*\(/.test(link));
    return bare ? [`${file}:${code.slice(0, m.index).split("\n").length}`] : [];
  });
}

const found = () => sources().flatMap((file) => barePresses(file, repoText(file)));
const counted = (list) => list.reduce((all, at) => { const file = at.replace(/:\d+$/, ""); all[file] = (all[file] ?? 0) + 1; return all; }, {});

test("No mod source outside the kit presses a bare div, h_flex or v_flex beyond the baseline, which only shrinks", () => {
  const baseline = JSON.parse(repoText(BASELINE));
  const presses = found(), now = counted(presses);
  const grew = Object.entries(now).filter(([file, n]) => n > (baseline[file] ?? 0))
    .flatMap(([file]) => presses.filter((at) => at.startsWith(`${file}:`)));
  assert.deepEqual(grew, [], "a press target here is not a kit button or row (Tab cannot reach it): draw it with the kit's button or row");
  const stale = Object.entries(baseline).filter(([file, n]) => (now[file] ?? 0) < n).map(([file, n]) => `${file}: ${n} listed, ${now[file] ?? 0} found`);
  assert.deepEqual(stale, [], `the baseline lists more than there are: lower ${BASELINE}`);
});

test("The scan finds a bare press with its file and line, through .when, and passes a kit's Button or a focus handle", () => {
  const text = [
    "const a = div().id(\"a\").on_click(() => go());",
    "const b = h_flex().id(\"b\").when(Boolean(go), (el) => el.cursor_pointer().on_click(() => go()));",
    "const c = v_flex().id(\"c\").track_focus(this.focus).on_click(() => go());",
    "const d = Button.new(\"d\").on_click(() => go());",
    "const e = list.map((x) => div().child(\"(\").on_click(() => go(x)));",
    "const f = row(\"f\", c, { onClick: go }).child(div().on_click(() => go()));",
    "// div().on_click(() => go())",
    "const g = flush(h_flex().id(\"g\"), 8, 8).hover(look).on_click(() => go());",
    "const h = (open ? h_flex().rounded(4) : flush(h_flex(), 8, 8)).id(\"h\").on_click(() => go());",
    "const i = fadedButton(Button.new(\"i\").w_full()).on_click(() => go());",
  ].join("\n");
  assert.deepEqual(barePresses("x.js", text), ["x.js:1", "x.js:2", "x.js:5", "x.js:6", "x.js:8", "x.js:9"]);
});

test("The press targets this baseline started from are drawn by the kit now", () => {
  const baseline = JSON.parse(repoText(BASELINE));
  for (const file of ["kanso/mods/kanso-chrome/main.js", "kanso/mods/kanso-spaces/sidebar-footer.js", "kanso/mods/kanso-dojo/main.js", "kanso/mods/kanso-dojo/pets.js", "kanso/mods/kanso-help/main.js", "kanso/mods/kanso-panel/doc.js",
    "kanso/mods/kanso-settings/main.js", "kanso/mods/kanso-sim/main.js", "kanso/mods/kanso-spaces/main.js"]) {
    assert.equal(baseline[file], undefined, `${file} is listed`);
  }
});

// The pieces the replaced targets are drawn with, as the app's kit draws them.
const kit = async () => themed({ ...await loadTokens(drawingHost()), ...await load("kanso-panel/kit.js", ["button", "row", "explainButton"], drawingHost()) }, KIT_NIGHT);
const calls = (el, name) => el.calls.filter((call) => call[0] === name);
// Button.new(id) is drawn under its id: Tab reaches it and Enter and Space press it. The ring is its focus style.
const pressable = (el, id) => {
  assert.equal(el.tag, id, `${id} is a Button`);
  assert.equal(calls(el, "focus").length, 1, `${id} shows the focus ring`);
  calls(el, "on_click").forEach(([, fn]) => fn({}, { stop_propagation() {}, notify() {} }));
};

test("A button with a drawn face is the kit's Button: the face inside, the ring on focus, a press runs its handler, and nothing but handlers is taken", async () => {
  const { button, c } = await kit();
  const face = drawingHost().v_flex();
  let pressed = 0;
  const el = button({ label: "Shiba", kind: "quiet", active: true, content: [face] })("pet-shiba", c, { onClick: () => { pressed += 1; } });
  pressable(el, "pet-shiba");
  assert.equal(pressed, 1);
  assert.deepEqual(el.kids, [face], "the face is its one child, no label drawn beside it");
  assert.equal(calls(el, "accessibility_label")[0][1], "Shiba", "a screen reader reads its label");
  assert.equal(calls(el, "h").length, 0, "it takes its face's height");
  assert.throws(() => button({ label: "Shiba", content: [face] })("p", c, { tip: "x" }), /only handlers, not tip/);
});

test("An icon button with a drawn face keeps its square: Look's picture dots", async () => {
  const { button, c } = await kit();
  const el = button({ label: "after.png", kind: "icon", size: "compact", content: [drawingHost().div()] })("look-dot-a", c, { onClick: () => {} });
  pressable(el, "look-dot-a");
  assert.equal(calls(el, "w")[0][1], calls(el, "h")[0][1]);
  assert.equal(calls(el, "tooltip")[0][1], "after.png");
});

test("Explain to <agent> is a tonal button with the bot icon and the agent named, pressable from the keyboard", async () => {
  const { explainButton, c } = await kit();
  let pressed = 0;
  const el = explainButton({ agent: "Claude Code", size: "sm" })("wt-explain", c, { onClick: () => { pressed += 1; } });
  pressable(el, "wt-explain");
  assert.equal(pressed, 1);
  assert.deepEqual(texts(el), ["Explain to Claude Code"]);
  assert.ok(nodes(el).some((n) => calls(n, "svg").some(([, path]) => path.endsWith("bot.svg"))), "the bot icon");
  assert.throws(() => explainButton({ agent: "Codex" })("e", c, { label: "x" }), /only handlers/);
});

test("A row that acts is the kit's Button with the ring: the dōjō's levels, Simulator's devices, the PR's checks, threads and files, Spend's lists", async () => {
  const { row, c } = await kit();
  let pressed = 0;
  const el = row({ letter: "3", name: "Words", meta: "12", selected: true, current: true })("level-3", c, { onClick: () => { pressed += 1; } });
  pressable(el, "level-3");
  assert.equal(pressed, 1);
  assert.deepEqual(texts(el), ["3", "Words", "12"]);
});

// Each target the issue named, and the kit call that draws it now; the hand helpers they had are gone.
const DRAWN = {
  "kanso/mods/kanso-spaces/sidebar-footer.js": ['button({ label, kind: "icon", size: "lg", icon: name, spin: busy, disabled: busy })', 'row({ icon: "lu-settings", name: "Settings", names: true, nameInk: "muted" })'],
  "kanso/mods/kanso-dojo/main.js": ['button({ label: "Choose your pet", kind: "quiet"', 'row({ letter: String(L.n), name: L.name'],
  "kanso/mods/kanso-dojo/pets.js": ['button({ label: p.name, kind: "quiet", active: on, content: [face] })(`pet-${p.id}`'],
  "kanso/mods/kanso-panel/doc.js": ['kitButton({ label: tip, kind: "icon", size: "sm"'],
  "kanso/mods/kanso-panel/look.js": ['thumbnail({ image: shown?.image ?? "", label: item.name, selected: on, loading: Boolean(shown?.busy), color: item.color ?? "" })('],
  "kanso/mods/kanso-panel/pr-view.js": ['kitRow({ icon: on ? "chevron-down" : "chevron-right", name: label'],
  "kanso/mods/kanso-panel/pr.js": ["(`pr-check-${i}`, c, {", "kitRow({ name: body, second, wrap: true })(`pr-thread-${i}`, c, {", "(`pr-file-${i}`, c, {"],
  "kanso/mods/kanso-panel/worktrees.js": ['explainButton({ agent: this.explainer?.name ?? "an agent", size: "sm" })(`wt-explain-'],
  "kanso/mods/kanso-settings/main.js": ['kitButton({ label, kind: "quiet", active: this.capture?.row === row, content: ['],
  "kanso/mods/kanso-sim/main.js": ["})(`sim-device-${item.id}`, c, { onClick: (next) => this.pick(item, next) })"],
  "kanso/mods/kanso-spend/main.js": ['kitButton({ label: shown, kind: "quiet", small: true, icon: "lu-chevron-down", truncate: true,', "row({ name: item.name, detail: item.tokensText", "return row({ name: task.title"],
};
const GONE = {
  "kanso/mods/kanso-panel/pr.js": ["listButton", "Button.new(`pr-"],
  "kanso/mods/kanso-panel/pr-view.js": ['Button.new("pr-details")'],
  "kanso/mods/kanso-panel/look.js": ["Button.new(`look-dot", "look-dot"],
  "kanso/mods/kanso-spend/main.js": ["fadedButton", "Button.new("],
  "kanso/mods/kanso-panel/worktrees.js": ['"Explain it"'],
};

test("Every press target the issue names is drawn by a kit button, row or Explain button, and the hand helpers are gone", () => {
  for (const [file, calls] of Object.entries(DRAWN)) for (const call of calls) assert.ok(repoText(file).includes(call), `${file} draws ${call}`);
  for (const [file, words] of Object.entries(GONE)) for (const word of words) assert.equal(repoText(file).includes(word), false, `${file} still has ${word}`);
});
