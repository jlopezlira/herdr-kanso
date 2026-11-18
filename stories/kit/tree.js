const VOID = new Set(["use", "img", "br", "input", "path", "circle", "rect", "line", "stop"]);
const HOLE = "\u0000";

const parseTemplate = (strings) => {
  const source = strings.join(HOLE);
  const root = { tag: "#root", attrs: [], children: [] };
  const stack = [root];
  const token = /<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi;
  let hole = 0;
  for (const m of source.matchAll(token)) {
    const at = stack[stack.length - 1];
    if (m[1]) {
      if (at.tag !== m[1].toLowerCase()) throw new Error(`tree: </${m[1]}> closes <${at.tag}>`);
      stack.pop();
    } else if (m[2]) {
      const attrs = [...m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)].map(([, name, value = ""]) => {
        const parts = value.split(HOLE);
        const holes = parts.slice(1).map(() => hole++);
        return { name, parts, holes };
      });
      const node = { tag: m[2].toLowerCase(), attrs, children: [] };
      at.children.push(node);
      if (!m[4] && !VOID.has(node.tag)) stack.push(node);
    } else {
      const parts = m[5].split(HOLE);
      parts.forEach((text, i) => {
        if (text) at.children.push({ text });
        if (i < parts.length - 1) at.children.push({ hole: hole++ });
      });
    }
  }
  if (stack.length !== 1) throw new Error(`tree: <${stack[stack.length - 1].tag}> is never closed`);
  return root.children;
};

const cache = new WeakMap();
const isNode = (value) => value && typeof value === "object" && "tag" in value;
const flat = (value) => [value].flat(Infinity).filter((v) => v !== null && v !== undefined && v !== false && v !== "");

const fill = (template, values) => template.map((node) => {
  if ("hole" in node) return flat(values[node.hole]).map((v) => (isNode(v) ? v : { tag: "#text", text: String(v) }));
  if ("text" in node) return { tag: "#text", text: node.text };
  const attrs = {};
  for (const { name, parts, holes } of node.attrs) {
    attrs[name] = parts.map((part, i) => part + (i < holes.length ? flat(values[holes[i]]).join("") : "")).join("");
  }
  return { tag: node.tag, attrs, children: fill(node.children, values).flat() };
}).flat();

export const html = (strings, ...values) => {
  if (!cache.has(strings)) cache.set(strings, parseTemplate(strings));
  return fill(cache.get(strings), values);
};

const escape = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
export const toHtml = (value) => flat(value).map((node) => {
  if (!isNode(node)) return escape(node);
  if (node.tag === "#text") return escape(node.text);
  const attrs = Object.entries(node.attrs).map(([name, v]) => (v === "" && name !== "class" && name !== "title" && name !== "alt" ? ` ${name}` : ` ${name}="${escape(v)}"`)).join("");
  return VOID.has(node.tag) ? `<${node.tag}${attrs}/>` : `<${node.tag}${attrs}>${toHtml(node.children)}</${node.tag}>`;
}).join("");

export const classesOf = (node) => (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
