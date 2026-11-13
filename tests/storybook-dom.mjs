import { markupElements, textOf } from '../scripts/storybook-markup.mjs';
import { matches } from './storybook-selectors.mjs';

class Element {
  constructor(tag, doc, attrs = {}) {
    Object.assign(this, { tag, ownerDocument: doc, attrs, children: [], parent: null, text: '', nodeType: 1, listeners: new Map(), dataset: {}, style: {} });
  }
  get parentElement() { return this.parent; }
  get childNodes() { return this.children; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1]; }
  get previousElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) - 1]; }
  get lastElementChild() { return this.children.at(-1); }
  get isConnected() { return this.tag === '#document' || !!this.parent?.isConnected; }
  get className() { return this.attrs.class ?? ''; }
  set className(value) { this.attrs.class = value; }
  get classList() {
    const node = this;
    return {
      contains(name) { return node.className.split(/\s+/).includes(name); },
      toggle(name, force) {
        const on = force ?? !this.contains(name);
        node.className = [...new Set([...node.className.split(/\s+/).filter((item) => item && item !== name), ...(on ? [name] : [])])].join(' ');
        return on;
      },
      add(...names) { names.forEach((name) => this.toggle(name, true)); },
      remove(...names) { names.forEach((name) => this.toggle(name, false)); },
    };
  }
  get title() { return this.attrs.title ?? ''; }
  get tabIndex() { return Number(this.attrs.tabindex ?? -1); }
  set tabIndex(value) { this.attrs.tabindex = String(value); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  get innerHTML() { return this.text + this.children.map((child) => `<${child.tag} ${Object.entries(child.attrs).map(([key, value]) => `${key}="${value}"`).join(' ')}>${child.innerHTML}</${child.tag}>`).join(''); }
  set innerHTML(html) {
    this.replaceChildren();
    const nodes = markupElements(html), built = new Map();
    if (!nodes.length) this.text = textOf(html);
    for (const node of nodes) {
      const element = new Element(node.tag, this.ownerDocument, { ...node.attrs });
      let inner = html.slice(node.open, node.close ?? node.open);
      for (const child of nodes.filter((entry) => entry.parent === node)) inner = inner.replace(html.slice(child.start, child.end), '');
      element.text = textOf(inner);
      (built.get(node.parent) ?? this).append(element);
      built.set(node, element);
    }
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  matches(selector) { return matches(this, `:is(${selector})`); }
  closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node) { for (; node; node = node.parent) if (node === this) return true; return false; }
  append(...nodes) { for (const node of nodes) if (typeof node === 'string') this.text += node; else { node.remove(); node.parent = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parent = this; this.children.unshift(node); }
  before(node) { const index = this.parent.children.indexOf(this); node.remove(); node.parent = this.parent; this.parent.children.splice(index, 0, node); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...nodes); }
  focus() {
    const previous = this.ownerDocument.activeElement;
    if (previous === this) return;
    this.ownerDocument.activeElement = this;
    previous?.emit('focusout', { relatedTarget: this });
    this.emit('focusin', { relatedTarget: previous });
  }
  blur() { this.ownerDocument.activeElement = null; this.emit('focusout'); }
  addEventListener(type, fn, { signal } = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    signal?.addEventListener('abort', () => this.listeners.get(type).delete(fn), { once: true });
  }
  dispatchEvent(event) { this.emit(event.type, event); }
  emit(type, options = {}) {
    const event = { target: this, type, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
    for (let node = this; node && !event.stopped; node = node.parent) for (const fn of node.listeners.get(type) ?? []) fn(event);
    return event;
  }
}

export function dom(html) {
  const doc = new Element('#document');
  doc.ownerDocument = doc;
  doc.createElement = (tag) => new Element(tag, doc);
  doc.defaultView = { navigator: {}, MouseEvent: class { constructor(type, options) { Object.assign(this, options, { type }); } } };
  const root = doc.createElement('div');
  root.className = 'kanso-story__viewport';
  doc.append(root);
  root.innerHTML = html;
  return { doc, root, get: (selector) => root.querySelector(selector) };
}
