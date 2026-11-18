// Children point at this view, so the list is read after the view exists.
const elementView = (node, parent, siblingsOf) => {
  const view = {
    tag: node.tag,
    attrs: node.attrs,
    classes: (node.attrs.class ?? "").split(/\s+/).filter(Boolean),
    parent,
    get siblings() { return parent ? undefined : siblingsOf(); },
    get children() { return kids; },
  };
  const kids = viewOf(node.children, view);
  return view;
};

const textView = (node, parent, siblingsOf) => ({
  tag: "#text", text: node.text, parent, get siblings() { return parent ? undefined : siblingsOf(); },
});

export const viewOf = (nodes, parent = null) => {
  const views = nodes.filter((node) => node.tag !== "#text" || node.text.trim())
    .map((node) => (node.tag === "#text" ? textView(node, parent, () => views) : elementView(node, parent, () => views)));
  return views;
};

const matchCompound = (node, step, state) => {
  if (!node || node.tag === "#text") return false;
  if (step.tag && step.tag !== node.tag) return false;
  if (!step.classes.every((name) => node.classes.includes(name))) return false;
  if (!(step.attrs ?? []).every(([name, value]) => (value === null ? name in node.attrs : node.attrs[name] === value))) return false;
  if (!step.states.every((name) => state(node, name))) return false;
  if (step.not.some((inner) => matches(node, inner, state))) return false;
  return step.any.every((list) => list.some((inner) => matches(node, inner, state)));
};

const siblingsBefore = (el) => {
  const list = (el.parent?.children ?? el.siblings ?? []).filter((n) => n.tag !== "#text");
  return list.slice(0, list.indexOf(el));
};

export const matches = (node, steps, state) => {
  const walk = (el, i) => {
    if (!matchCompound(el, steps[i], state)) return false;
    if (i === 0) return true;
    if (steps[i].relation === "child") return walk(el.parent, i - 1);
    const before = siblingsBefore(el);
    if (steps[i].relation === "next") return walk(before[before.length - 1], i - 1);
    if (steps[i].relation === "after") return before.some((sib) => walk(sib, i - 1));
    const ancestor = (up) => Boolean(up) && (walk(up, i - 1) || ancestor(up.parent));
    return ancestor(el.parent);
  };
  return walk(node, steps.length - 1);
};

const STATE_CLASS = { hover: "kanso-control--hover", focus: "kanso-control--focus", active: "kanso-control--active" };
export const atRest = (node, name) => node.classes.includes(STATE_CLASS[name]);
// The answer for each key asked, made once.
export class Answers {
  constructor() { this.known = new Map(); }

  of(key, make) {
    if (!this.known.has(key)) this.known.set(key, make());
    return this.known.get(key);
  }
}

// What a render already asked: the node each hover state is for, and the answers of each rule set.
class Asked {
  constructor() { this.targets = new WeakMap(); this.answers = new WeakMap(); }

  hover(target) {
    const state = (node, name) => atRest(node, name) || (name === "hover" && node === target);
    this.targets.set(state, target);
    return state;
  }

  targetOf(state) { return this.targets.get(state); }

  answer(rules, key, make) {
    if (!this.answers.has(rules)) this.answers.set(rules, new Answers());
    return this.answers.get(rules).of(key, make);
  }
}
const asked = new Asked();
export const hovering = (target) => asked.hover(target);

const candidates = (node, rules) => (Array.isArray(rules) ? rules : [...new Set([...rules["*"], ...node.classes.flatMap((name) => rules[name] ?? [])])]);

const match = (node, rules, state) => candidates(node, rules)
  .filter((rule) => matches(node, rule.steps, state))
  .toSorted((a, b) => a.weight - b.weight || a.order - b.order)
  .flatMap((rule) => rule.ops);

// What a node is to a selector: its tag, classes and attributes, the ones before it and the same of each ancestor.
const own = (node) => `${node.tag}.${(node.classes ?? []).join(".")}${JSON.stringify(node.attrs ?? {})}`;
const shapeOf = (node) => (node ? `${shapeOf(node.parent)}>${siblingsBefore(node).map(own).join("+")}~${own(node)}` : "");
const above = (node, target) => Boolean(node) && (node === target || above(node.parent, target));
const kindOf = (node, state) => {
  if (state === atRest) return "rest";
  const target = asked.targetOf(state);
  if (!target || above(node.parent, target)) return null;
  return target === node ? "hovered" : "beside";
};
// A render asks the same nodes again and again: the answer for a shape is kept.
export const stylesFor = (node, rules, state = atRest) => {
  const kind = kindOf(node, state);
  return kind ? asked.answer(rules, `${kind}${shapeOf(node)}`, () => match(node, rules, state)) : match(node, rules, state);
};

const winning = (ops) => ops.reduce((acc, op) => ({ ...acc, [op[0]]: op }), {});
// Ops whose winning call differs. The hover style sets those, and leaves a colour an !important rule kept.
export const changed = (rest, hover) => {
  const before = winning(rest);
  const after = winning(hover);
  const order = hover.reduce((acc, op) => (acc.includes(op[0]) ? acc : [...acc, op[0]]), []);
  return order.filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])).map((name) => after[name]);
};

export const unsupportedFor = (node, skipped) => skipped.filter((miss) => (miss.steps
  ? matches(node, miss.steps, atRest) || matches(node, miss.steps, hovering(node))
  : miss.subject.length && miss.subject.every((name) => node.classes.includes(name))));
