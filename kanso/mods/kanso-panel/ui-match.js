export const viewOf = (nodes, parent = null) => nodes.filter((node) => node.tag !== "#text" || node.text.trim()).map((node) => {
  if (node.tag === "#text") return { tag: "#text", text: node.text, parent };
  const view = { tag: node.tag, attrs: node.attrs, classes: (node.attrs.class ?? "").split(/\s+/).filter(Boolean), parent };
  view.children = viewOf(node.children, view);
  return view;
}).map((view, _, all) => (view.parent ? view : Object.assign(view, { siblings: all })));

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
    for (let up = el.parent; up; up = up.parent) if (walk(up, i - 1)) return true;
    return false;
  };
  return walk(node, steps.length - 1);
};

const STATE_CLASS = { hover: "kanso-control--hover", focus: "kanso-control--focus", active: "kanso-control--active" };
export const atRest = (node, name) => node.classes.includes(STATE_CLASS[name]);
export const hovering = (target) => (node, name) => atRest(node, name) || (name === "hover" && node === target);

const candidates = (node, rules) => (Array.isArray(rules) ? rules : [...new Set([...rules["*"], ...node.classes.flatMap((name) => rules[name] ?? [])])]);

export const stylesFor = (node, rules, state = atRest) => candidates(node, rules)
  .filter((rule) => matches(node, rule.steps, state))
  .sort((a, b) => a.weight - b.weight || a.order - b.order)
  .flatMap((rule) => rule.ops);

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
