import { div, svg } from "gpui-kit";
import { Button } from "gpui-base";
import { alpha, glyphOf } from "./ui.js";
import { viewOf, stylesFor, hovering, changed } from "./ui-match.js";

const ink = (c, value) => {
  if (!value || typeof value !== "object" || !("colour" in value)) return value;
  if (value.colour === null) return "#00000000";
  return value.share === undefined ? c[value.colour] : alpha(c[value.colour], value.share);
};

// The one bare element the drawings start from.
const plain = () => div();

export const lastOp = (ops, name) => {
  const found = ops.filter(([op]) => op === name);
  return found.length ? found[found.length - 1] : null;
};
const radiusOf = (ops) => lastOp(ops, "rounded")?.[1] ?? 0;
const ringOf = (ops, c) => {
  const ring = lastOp(ops, "ring");
  return ring ? plain().absolute().inset_0().border(ring[1]).border_color(ink(c, ring[2])).rounded(radiusOf(ops)) : null;
};

// `hoverClass` is the Storybook's static hover mark. It is not on the element at rest.
// `live` is false for a node that is not a control: a hover callback would paint .kanso-control--hover onto it.
// A node's look: its own ops and, for a live one, what its hover changes. A piece drawn often keeps the look and paints it with `painted`.
export const lookOf = (node, rules, hoverClass = null, live = true) => {
  const own = stylesFor(node, rules);
  if (!live) return { own, extra: [] };
  const marked = hoverClass ? { ...node, classes: [...node.classes, hoverClass] } : node;
  return { own, extra: changed(own, stylesFor(marked, rules, hovering(node))) };
};
export const painted = (el, { own, extra }, c) => {
  const drawn = apply(el, own, c);
  return extra.length ? drawn.hover((style) => apply(style, extra, c)) : drawn;
};
export const paint = (el, node, c, rules, hoverClass = null, live = true) => painted(el, lookOf(node, rules, hoverClass, live), c);
// A node drawn as the element its look makes, flex or not as its CSS says, with `id` when it has handlers; `live` takes its hover.
export const box = (node, c, rules, id = null, live = false) => {
  const el = plain();
  return painted(id ? el.id(id) : el, lookOf(node, rules, null, live), c);
};

const apply = (el, ops, c) => ops.reduce((acc, [op, ...args]) => {
  if (op === "ring") return acc.relative();
  if (typeof acc[op] !== "function") throw new Error(`kit: gpui has no ${op}`);
  return acc[op](...args.map((arg) => ink(c, arg)));
}, el);

const iconName = (node) => (node.children.find((child) => child.tag === "use")?.attrs.href ?? "").replace(/^#(lu-)?/, "");

export const draw = (tree, c, { id, rules, presses = {} }) => {
  const make = (node, path) => {
    if (node.tag === "#text") return node.text;
    const own = stylesFor(node, rules);
    if (node.tag === "svg") return apply(svg(glyphOf(iconName(node))), own, c);
    const key = `${id}-${path}`;
    const press = presses[node.attrs.title];
    const hovered = stylesFor(node, rules, hovering(node)).slice(own.length);
    const base = apply(press ? Button.new(key).on_click(press) : plain().id(key), own, c);
    const withHover = hovered.length ? base.hover((style) => apply(style, hovered, c)) : base;
    const el = node.attrs.title ? withHover.tooltip(node.attrs.title) : withHover;
    return el.children([...node.children.map((child, i) => make(child, `${path}-${i}`)), ringOf(own, c)].filter(Boolean));
  };
  return viewOf(tree).map((node, i) => make(node, String(i)));
};
