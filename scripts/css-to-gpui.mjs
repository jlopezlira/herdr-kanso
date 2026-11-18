#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";
import { isMain } from "./cli.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const SIZES = Object.fromEntries([...read("site/tokens.css").matchAll(/--(k-[a-z0-9-]+):\s*(-?[\d.]+)px;/g)].map(([, name, value]) => [name, Number(value)]));
const NUMBERS = Object.fromEntries([...read("site/tokens.css").matchAll(/--(k-[a-z0-9-]+):\s*(-?[\d.]+);/g)].map(([, name, value]) => [name, Number(value)]));

const COLOURS = {
  fg: "text", muted: "muted", dim: "dim", accent: "accent", "on-accent": "accentText", focus: "accent",
  working: "working", blocked: "blocked", done: "done", idle: "idle", violet: "violet", blue: "blue",
  border: "border", "surface-0": "chrome", "surface-1": "canvas", "surface-2": "background", "surface-3": "popover", "surface-4": "raised",
  "wash-4": "w4", "wash-7": "w7", "wash-12": "w12", "wash-14": "w14", hover: "subtle", selected: "selected",
};

const STATES = { hover: "hover", "focus-visible": "focus", "focus-within": "focus", focus: "focus", active: "active" };
const STATE_CLASSES = { "kanso-control--hover": "hover", "kanso-control--focus": "focus", "kanso-control--active": "active" };

const splitTop = (text, sep) => {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(start, i));
      start = i + sep.length;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

const rules = (css) => {
  const found = [];
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type === "atrule") {
      found.push({ selectors: rule.selectors, declarations: rule.nodes.filter((node) => node.type === "decl").map((decl) => [decl.prop, decl.value]), atRule: `@${rule.parent.name} ${rule.parent.params}` });
      return;
    }
    found.push({ selectors: rule.selectors, declarations: rule.nodes.filter((node) => node.type === "decl").map((decl) => [decl.prop, decl.value]) });
  });
  return found;
};

export const SHEETS = ["stories/proto.css", "stories/primitives.css", "stories/compositions.css", "stories/frame.css", "stories/utilities.css"];

class Unsupported extends Error {}

const compound = (text) => {
  const node = { tag: null, classes: [], states: [], not: [], any: [], attrs: [] };
  const tag = text.match(/^[a-z][a-z0-9]*/i);
  if (tag) node.tag = tag[0].toLowerCase();
  const token = /\.([a-z0-9_-]+)|:(is|where|not)\(|:([a-z-]+)|(\*)|\[([a-z-]+)(?:="([^"]*)")?\]/gi;
  let at = node.tag ? node.tag.length : 0;
  while (at < text.length) {
    token.lastIndex = at;
    const m = token.exec(text);
    if (!m || m.index !== at) throw new Unsupported(`selector part ${text.slice(at)}`);
    at = token.lastIndex;
    if (m[1]) {
      if (STATE_CLASSES[m[1]]) node.states.push(STATE_CLASSES[m[1]]);
      else node.classes.push(m[1]);
    } else if (m[2]) {
      let depth = 1, end = at;
      while (end < text.length && depth) {
        if (text[end] === "(") depth += 1;
        else if (text[end] === ")") depth -= 1;
        end += 1;
      }
      const list = splitTop(text.slice(at, end - 1), ",").map(parseSelector);
      if (m[2] === "not") node.not.push(...list);
      else node.any.push(list);
      at = end;
    } else if (m[5]) {
      node.attrs.push([m[5], m[6] ?? null]);
    } else if (m[3]) {
      if (!STATES[m[3]]) throw new Unsupported(`:${m[3]}`);
      node.states.push(STATES[m[3]]);
    }
  }
  return node;
};

export const parseSelector = (text) => {
  if (/::|:has\(/.test(text)) throw new Unsupported(text);
  const steps = [];
  let relation = null;
  for (const part of splitTop(text.replace(/\s*([>~+])\s*/g, " $1 "), " ")) {
    if (part === ">") relation = "child";
    else if (part === "+") relation = "next";
    else if (part === "~") relation = "after";
    else {
      steps.push({ relation: steps.length ? relation ?? "descendant" : null, ...compound(part) });
      relation = null;
    }
  }
  return steps;
};

const evaluate = (expr) => {
  const resolved = expr
    .replace(/var\(--(k-[a-z0-9-]+)\)/g, (_, name) => {
      if (name in SIZES) return String(SIZES[name]);
      if (name in NUMBERS) return String(NUMBERS[name]);
      throw new Unsupported(`token ${name}`);
    })
    .replace(/(-?[\d.]+)px/g, "$1");
  const maths = resolved.replace(/^calc\((.*)\)$/, "$1");
  if (!/^[\d.\s+\-*/()]+$/.test(maths) || /\d\s+[\d(]/.test(maths)) throw new Unsupported(`value ${expr}`);
  return Function(`return (${maths})`)();
};

const colour = (value) => {
  const plain = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (plain && COLOURS[plain[1]]) return { colour: COLOURS[plain[1]] };
  const mixed = value.match(/^color-mix\(in srgb,\s*var\(--([a-z0-9-]+)\)\s+(?:var\(--(k-[a-z0-9-]+)\)|([\d.]+)%),\s*transparent\)$/);
  if (mixed && COLOURS[mixed[1]]) {
    const share = mixed[2] ? NUMBERS[mixed[2]] ?? SIZES[mixed[2]] : Number(mixed[3]) / 100;
    return { colour: COLOURS[mixed[1]], share: share > 1 ? share / 100 : share };
  }
  if (value === "none" || value === "transparent") return { colour: null };
  throw new Unsupported(`colour ${value}`);
};

const sides = (value) => {
  const parts = splitTop(value, " ").map(evaluate);
  const [top, right = top, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
};

const boxOps = (prefix, value) => {
  const { top, right, bottom, left } = sides(value);
  if (top === bottom && left === right) return [[`${prefix}y`, top], [`${prefix}x`, left]];
  return [[`${prefix}t`, top], [`${prefix}r`, right], [`${prefix}b`, bottom], [`${prefix}l`, left]];
};

const DECLARATIONS = {
  display: (v) => ({ flex: [["flex"]], "inline-flex": [["flex"]], grid: [["grid"]], block: [["block"]], "inline-block": [["block"]], inline: [], none: [["hidden"]] })[v] ?? (() => { throw new Unsupported(`display ${v}`); })(),
  "flex-direction": (v) => [[v === "column" ? "flex_col" : "flex_row"]],
  "align-items": (v) => [[{ center: "items_center", "flex-start": "items_start", "flex-end": "items_end", baseline: "items_baseline", stretch: "items_stretch" }[v]]],
  "align-self": (v) => [[{ center: "self_center", "flex-start": "self_start", "flex-end": "self_end" }[v]]],
  "justify-content": (v) => [[{ center: "justify_center", "space-between": "justify_between", "flex-start": "justify_start", "flex-end": "justify_end" }[v]]],
  gap: (v) => [["gap", evaluate(v)]],
  padding: (v) => boxOps("p", v),
  "padding-block": (v) => { const [a, b = a] = splitTop(v, " ").map(evaluate); return [["pt", a], ["pb", b]]; },
  "padding-left": (v) => [["pl", evaluate(v)]],
  "padding-right": (v) => [["pr", evaluate(v)]],
  "padding-top": (v) => [["pt", evaluate(v)]],
  "padding-bottom": (v) => [["pb", evaluate(v)]],
  margin: (v) => boxOps("m", v),
  "margin-top": (v) => [["mt", evaluate(v)]],
  "margin-left": (v) => (v === "auto" ? [["ml_auto"]] : [["ml", evaluate(v)]]),
  "margin-right": (v) => [["mr", evaluate(v)]],
  "margin-block": (v) => { const [a, b = a] = splitTop(v, " ").map(evaluate); return [["mt", a], ["mb", b]]; },
  height: (v) => (v === "auto" ? [] : [["h", evaluate(v)]]),
  width: (v) => [["w", evaluate(v)]],
  "inline-size": (v) => [["w", evaluate(v)]],
  "block-size": (v) => [["h", evaluate(v)]],
  "min-width": (v) => [["min_w", evaluate(v)]],
  "border-radius": (v) => [["rounded", evaluate(v)]],
  background: (v) => [["bg", colour(v)]],
  "background-color": (v) => [["bg", colour(v)]],
  color: (v) => [["text_color", colour(v)]],
  "font-size": (v) => [["text_size", evaluate(v)]],
  "font-weight": (v) => [["font_weight", evaluate(v)]],
  "line-height": (v) => [["line_height", evaluate(v)]],
  "white-space": (v) => [[v === "nowrap" ? "whitespace_nowrap" : "whitespace_normal"]],
  overflow: (v) => [[v === "hidden" ? "overflow_hidden" : "overflow_visible"]],
  "text-overflow": (v) => (v === "ellipsis" ? [["text_ellipsis"]] : []),
  flex: (v) => [[{ none: "flex_none", 1: "flex_1", "1 1 100%": "flex_1" }[v] ?? (() => { throw new Unsupported(`flex ${v}`); })()]],
  opacity: (v) => [["opacity", evaluate(v)]],
  outline: (v) => {
    const m = v.match(/^(\S+) solid (var\(--[a-z-]+\))$/);
    if (!m) throw new Unsupported(`outline ${v}`);
    return [["ring", evaluate(m[1]), colour(m[2])]];
  },
  "outline-offset": () => [],
  "overflow-wrap": () => [],
  transition: () => [],
  cursor: () => [],
  "user-select": () => [],
  "pointer-events": () => [],
  "box-sizing": () => [],
  "font-variant-numeric": () => [],
  "max-width": (v) => (/%$/.test(v) ? [["max_w", v]] : [["max_w", evaluate(v)]]),
  "min-height": (v) => [["min_h", evaluate(v)]],
  "max-height": (v) => [["max_h", evaluate(v)]],
  visibility: (v) => [[v === "hidden" ? "invisible" : "visible"]],
  "flex-shrink": (v) => [[Number(v) === 0 ? "flex_shrink_0" : "flex_shrink"]],
  "flex-wrap": (v) => [[v === "wrap" ? "flex_wrap" : "flex_nowrap"]],
  "transition-duration": () => [],
  "place-items": (v) => (v === "center" ? [["items_center"], ["justify_center"]] : (() => { throw new Unsupported(`place-items ${v}`); })()),
  fill: (v) => (v === "none" || v === "currentColor" ? [] : (() => { throw new Unsupported(`fill ${v}`); })()),
  stroke: (v) => (v === "currentColor" ? [] : (() => { throw new Unsupported(`stroke ${v}`); })()),
  "stroke-width": () => [],
  "stroke-linecap": () => [],
  "stroke-linejoin": () => [],
  "transition-timing-function": () => [],
  "margin-inline": (v) => { const [a, b = a] = splitTop(v, " ").map(evaluate); return [["ml", a], ["mr", b]]; },
  position: (v) => [[v === "absolute" ? "absolute" : "relative"]],
  left: (v) => [["left", evaluate(v)]],
  right: (v) => [["right", evaluate(v)]],
  top: (v) => (/%$/.test(v) ? [["top", v]] : [["top", evaluate(v)]]),
  bottom: (v) => (/%$/.test(v) ? [["bottom", v]] : v === "auto" ? [] : [["bottom", evaluate(v)]]),
  "inset-block": (v) => [["top", evaluate(v)], ["bottom", evaluate(v)]],
  "box-shadow": (v) => {
    const line = v.match(/^inset 0 (calc\(-1 \* var\(--k-[a-z0-9-]+\)\)|var\(--k-[a-z0-9-]+\)) 0 (var\(--[a-z-]+\))$/);
    if (!line) throw new Unsupported(`box-shadow ${v}`);
    const width = evaluate(line[1]);
    return [[width < 0 ? "border_b" : "border_t", Math.abs(width)], ["border_color", colour(line[2])]];
  },
};
const FLEX = { none: "flex_none", 1: "flex_1", "1 1 100%": "flex_1", "0 1 auto": "flex_initial", auto: "flex_auto" };
DECLARATIONS.flex = (v) => [[FLEX[v] ?? (() => { throw new Unsupported(`flex ${v}`); })()]];

const specificity = (steps) => steps.reduce((sum, step) => sum
  + (step.tag ? 1 : 0) + 100 * (step.classes.length + step.states.length)
  + step.any.reduce((most, list) => most + Math.max(...list.map(specificity)), 0)
  + step.not.reduce((most, inner) => most + specificity(inner), 0), 0);

const MOTION = new Set(["transition", "transition-duration", "transition-timing-function", "transition-delay", "animation", "animation-duration", "animation-delay", "animation-name", "opacity", "translate", "transform"]);

const subject = (selector) => {
  const last = splitTop(selector.replace(/\s*[>~+]\s*/g, " "), " ").pop() ?? "";
  return [...last.replace(/:[a-z-]+\([^)]*\)/g, "").matchAll(/\.([a-z0-9_-]+)/gi)].map((m) => m[1]).filter((name) => !STATE_CLASSES[name]);
};

export const compile = (css) => {
  const out = [], skipped = [];
  const miss = (selector, reason, steps = null) => skipped.push({ selector, reason, steps, subject: subject(selector) });
  for (const { selectors, declarations, atRule } of rules(css)) {
    for (const one of selectors) {
      if (atRule) {
        const still = declarations.filter(([name]) => !MOTION.has(name));
        if (still.length) miss(one, `${atRule}: ${still.map(([name]) => name).join(", ")}`);
        continue;
      }
      let steps;
      try {
        steps = parseSelector(one);
      } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        miss(one, error.message);
        continue;
      }
      const ops = [];
      for (const [name, value] of declarations) {
        try {
          const make = DECLARATIONS[name];
          if (!make) throw new Unsupported(`property ${name}`);
          ops.push(...make(value));
        } catch (error) {
          if (!(error instanceof Unsupported)) throw error;
          miss(one, error.message, steps);
        }
      }
      out.push({ selector: one, steps, ops, weight: specificity(steps), order: out.length });
    }
  }
  return { rules: out, skipped };
};


const keyOf = (step) => {
  if (step.classes.length) return step.classes[0];
  const inner = step.any.flat().map((steps) => keyOf(steps[steps.length - 1]));
  return inner.length && inner.every((k) => k !== "*") ? inner : "*";
};

export const PIECES = ["stories/kit/row-tree.js"];
const reachableSteps = (steps, known) => steps.every((step) => step.classes.every((name) => STATE_CLASSES[name] || known(name))
  && step.any.every((list) => list.some((inner) => reachableSteps(inner, known))));
export const reachable = (list, pieces = PIECES) => {
  const universe = new Set(pieces.flatMap((file) => [...read(file).matchAll(/kanso-[a-z0-9_-]+/g)].map((m) => m[0])));
  const known = (name) => universe.has(name) || [...universe].some((u) => u.endsWith("-") && name.startsWith(u));
  return list.filter((rule) => reachableSteps(rule.steps, known));
};

export const indexed = (list) => {
  const index = { "*": [] };
  for (const rule of list) {
    for (const key of [keyOf(rule.steps[rule.steps.length - 1])].flat()) (index[key] ??= []).push(rule);
  }
  return index;
};

if (isMain(import.meta.url)) {
  const only = process.argv[2];
  const { rules: compiled, skipped } = compile(SHEETS.map(read).join("\n"));
  const picked = only ? compiled.filter((rule) => rule.selector.includes(only)) : compiled;
  const missed = only ? skipped.filter((rule) => rule.selector.includes(only)) : skipped;
  writeFileSync(new URL("kanso/mods/kanso-panel/ui-css.js", root), `export const RULES = ${JSON.stringify(indexed(reachable(picked)))};\n`);
  console.log(`${picked.length} rules compiled, ${missed.length} not yet`);
  for (const rule of missed) console.log(`  not yet: ${rule.selector}  (${rule.reason})`);
}
