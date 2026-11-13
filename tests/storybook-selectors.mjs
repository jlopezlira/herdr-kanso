import { cssSelectors } from "../scripts/import-proto.mjs";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "use"]);
const DYNAMIC = new Set(["hover", "active", "focus", "focus-visible", "focus-within", "visited"]);

export function storyTree(html, theme = "dark") {
  const root = { tag: "html", attrs: { "data-theme": theme }, children: [] };
  const stack = [root];
  const frame = '<body><div class="kanso-story__viewport kanso-story--canvas">';
  for (const match of `${frame}${html}</div></body>`.matchAll(/<!--[^]*?-->|<\/?([\w:-]+)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attrs = {};
    for (const [, name, double, single, bare] of match[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[name] = double ?? single ?? bare ?? "";
    const node = { tag, attrs, children: [], parent: stack.at(-1) };
    node.parent.children.push(node);
    if (!VOID.has(tag) && !match[0].endsWith("/>")) stack.push(node);
  }
  return root;
}

const splits = new Map();

function split(selector, separators) {
  const key = `${separators}:${selector}`;
  if (splits.has(key)) return splits.get(key);
  const parts = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) { if (c === quote && selector[i - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (!depth && separators.includes(c)) {
      if (selector.slice(start, i).trim()) parts.push(selector.slice(start, i).trim());
      if (c !== ",") {
        if (c === " " && /[>+~]/.test(selector[i + 1] ?? "")) { start = i + 1; continue; }
        if (c === " " && [" ", ">", "+", "~"].includes(parts.at(-1))) { start = i + 1; continue; }
        parts.push(c);
      }
      start = i + 1;
    }
  }
  if (selector.slice(start).trim()) parts.push(selector.slice(start).trim());
  splits.set(key, parts);
  return parts;
}

const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
const siblings = (node) => node.parent?.children ?? [node];
const previous = (node) => siblings(node).slice(0, siblings(node).indexOf(node));
const nth = (expression, index) => {
  const value = expression.replace(/\s/g, "");
  if (value === "odd") return index % 2 === 1;
  if (value === "even") return index % 2 === 0;
  if (/^\d+$/.test(value)) return index === Number(value);
  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(value);
  if (!match) throw new Error(`unsupported nth expression: ${expression}`);
  const a = match[1] === "-" ? -1 : Number(match[1] || 1), b = Number(match[2] || 0);
  return a === 0 ? index === b : (index - b) / a >= 0 && Number.isInteger((index - b) / a);
};

function compound(node, selector, scope) {
  const tag = /^[\w*-]+/.exec(selector)?.[0];
  if (tag && tag !== "*" && node.tag !== tag.toLowerCase()) return false;
  let i = tag?.length ?? 0;
  while (i < selector.length) {
    const kind = selector[i++];
    if (kind === "." || kind === "#") {
      const name = /^[\w-]+/.exec(selector.slice(i))?.[0];
      if (!name) throw new Error(`invalid selector: ${selector}`);
      if (kind === "." ? !(node.attrs.class ?? "").split(/\s+/).includes(name) : node.attrs.id !== name) return false;
      i += name.length;
    } else if (kind === "[") {
      const end = selector.indexOf("]", i), attribute = selector.slice(i, end);
      const [, name, operator, value] = /^([\w-]+)(?:\s*([*^$~|]?=)\s*["']?(.*?)["']?)?$/.exec(attribute) ?? [];
      if (!name) throw new Error(`unsupported attribute: ${attribute}`);
      const actual = node.attrs[name];
      if (actual === undefined) return false;
      if (operator && !({ "=": () => actual === value, "^=": () => actual.startsWith(value), "$=": () => actual.endsWith(value), "*=": () => actual.includes(value), "~=": () => actual.split(/\s+/).includes(value), "|=": () => actual === value || actual.startsWith(`${value}-`) }[operator]())) return false;
      i = end + 1;
    } else if (kind === ":") {
      const element = selector[i] === ":";
      if (element) i++;
      const name = /^[\w-]+/.exec(selector.slice(i))?.[0];
      if (!name) throw new Error(`invalid pseudo: ${selector}`);
      i += name.length;
      let argument;
      if (selector[i] === "(") {
        const start = ++i;
        let depth = 1;
        while (depth && i < selector.length) { if (selector[i] === "(") depth++; if (selector[i] === ")") depth--; i++; }
        argument = selector.slice(start, i - 1);
      }
      if (element || DYNAMIC.has(name)) continue;
      const family = siblings(node), typed = family.filter((s) => s.tag === node.tag);
      const index = family.indexOf(node) + 1, typeIndex = typed.indexOf(node) + 1;
      let result;
      if (name === "is" || name === "where" || name === "not") {
        result = split(argument, ",").some((s) => matches(node, s, scope));
        if (name === "not") result = !result;
      } else if (name === "has") {
        let root = node; while (root.parent) root = root.parent;
        result = split(argument, ",").some((s) => descendants(root).some((candidate) => matches(candidate, `:scope ${s}`, node)));
      } else {
        const checks = {
          root: () => !node.parent, scope: () => node === scope,
          "first-child": () => index === 1, "last-child": () => index === family.length,
          "only-child": () => family.length === 1,
          "first-of-type": () => typeIndex === 1, "last-of-type": () => typeIndex === typed.length,
          "nth-child": () => nth(argument, index), "nth-of-type": () => nth(argument, typeIndex),
          "nth-last-child": () => nth(argument, family.length - index + 1),
          empty: () => node.children.length === 0,
        };
        if (!checks[name]) throw new Error(`unsupported pseudo: ${name}`);
        result = checks[name]();
      }
      if (!result) return false;
    } else throw new Error(`unsupported selector token ${kind}: ${selector}`);
  }
  return true;
}

export function matches(node, selector, scope) {
  const parts = split(selector.trim(), " >+~");
  const match = (candidate, index) => {
    if (!candidate || !compound(candidate, parts[index], scope)) return false;
    if (index === 0) return true;
    const combinator = parts[index - 1];
    if (combinator === ">") return match(candidate.parent, index - 2);
    if (combinator === "+") return match(previous(candidate).at(-1), index - 2);
    if (combinator === "~") return previous(candidate).some((s) => match(s, index - 2));
    if (combinator !== " ") throw new Error(`unsupported combinator: ${selector}`);
    for (let parent = candidate.parent; parent; parent = parent.parent) if (match(parent, index - 2)) return true;
    return false;
  };
  return match(node, parts.length - 1);
}

export function selectorCoverage(css, stories) {
  const rules = cssSelectors(css).map((selector) => split(selector, ","));
  const selectors = [...new Set(rules.flat())];
  const counts = {}, used = new Set();
  for (const [id, html] of Object.entries(stories)) {
    const roots = [storyTree(html, "dark"), storyTree(html, "light")];
    const nodes = roots.flatMap((root) => [root, ...descendants(root)]);
    const matched = selectors.filter((selector) => nodes.some((node) => matches(node, selector)));
    matched.forEach((selector) => used.add(selector));
    const matching = new Set(matched);
    counts[id] = rules.filter((rule) => rule.some((selector) => matching.has(selector))).length;
  }
  return { counts, unused: selectors.filter((selector) => !used.has(selector)), selectors: selectors.length };
}
