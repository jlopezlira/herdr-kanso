import { div, svg } from "gpui-kit";
import { Button } from "gpui-base";
import { alpha, glyphOf } from "./ui.js";
import { viewOf, stylesFor, hovering } from "./ui-match.js";

const ink = (c, value) => {
  if (!value || typeof value !== "object" || !("colour" in value)) return value;
  if (value.colour === null) return "#00000000";
  return value.share === undefined ? c[value.colour] : alpha(c[value.colour], value.share);
};

const radiusOf = (ops) => ops.filter(([op]) => op === "rounded").pop()?.[1] ?? 0;
const ringOf = (ops, c) => {
  const ring = ops.filter(([op]) => op === "ring").pop();
  return ring ? div().absolute().inset_0().border(ring[1]).border_color(ink(c, ring[2])).rounded(radiusOf(ops)) : null;
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
    let el = apply(press ? Button.new(key).on_click(press) : div().id(key), own, c);
    if (hovered.length) el = el.hover((style) => apply(style, hovered, c));
    if (node.attrs.title) el = el.tooltip(node.attrs.title);
    return el.children([...node.children.map((child, i) => make(child, `${path}-${i}`)), ringOf(own, c)].filter(Boolean));
  };
  return viewOf(tree).map((node, i) => make(node, String(i)));
};
