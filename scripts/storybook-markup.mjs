const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
export function closeOf(html, start) {
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(html)); ) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  throw new Error(`Unbalanced div at ${start}`);
}

export function withoutRepeats(html) {
  const open = /^<div\b[^>]*>/.exec(html);
  if (!open) return html;
  const end = html.lastIndexOf('</div>');
  const seen = new Set();
  let kept = '';
  for (let i = open[0].length; i < end;) {
    const match = /<div\b[^>]*>/.exec(html.slice(i));
    if (!match || html.slice(i, i + match.index).trim()) return html;
    const from = i + match.index, to = closeOf(html, from);
    const child = html.slice(from, to);
    if (!seen.has(child)) { seen.add(child); kept += child; }
    i = to;
  }
  return open[0] + kept + '</div>';
}
const SAMPLE_NAMES = { 'kylo-ren': 'Atlas', bix: 'Juno', wren: 'Iris', groot: 'Orion', fury: 'Nova', rey: 'Vega' };
export const sampleText = (s) => s.replace(/\bReviewing board (\d+)/g, 'Reviewing step $1').replace(/\b(kylo-ren|bix|wren|groot|fury|rey)\b/gi, (name) => name[0] === name[0].toLowerCase() ? SAMPLE_NAMES[name.toLowerCase()].toLowerCase() : SAMPLE_NAMES[name.toLowerCase()]);
export const escapeMarkup = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const textOf = (html) => html.replace(/<svg\b[^]*?<\/svg>/gi, '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (s) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[s] ?? String.fromCodePoint(s.startsWith('&#x') ? parseInt(s.slice(3), 16) : Number(s.slice(2, -1)))).trim();
export const frame = (html) => `<div class="kanso-story"><div class="kanso-story__theme kanso-story__frame kanso-story--free">${html}</div></div>`;

export function markupElements(html) {
  const stack = [], nodes = [];
  for (const match of html.matchAll(/<\/?([\w:-]+)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      const index = stack.findLastIndex((entry) => entry.tag === tag);
      if (index < 0) continue;
      const entry = stack[index];
      entry.end = match.index + match[0].length;
      entry.close = match.index;
      stack.length = index;
    } else {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(([, name, double, single, bare]) => [name, double ?? single ?? bare ?? '']));
      const node = { tag, attrs, classes: (attrs.class ?? '').split(/\s+/), start: match.index, open: match.index + match[0].length, end: match.index + match[0].length, parent: stack.at(-1) };
      nodes.push(node);
      if (!VOID.test(tag) && !match[0].endsWith('/>')) stack.push(node);
    }
  }
  return nodes;
}

export const elements = (html, className) => markupElements(html).filter((node) => node.classes.includes(className)).map((node) => html.slice(node.start, node.end));
export const actionElements = (html) => markupElements(html).filter((node) => ['button', 'a'].includes(node.tag) || ['button', 'menuitem'].includes(node.attrs.role) || node.classes.some((name) => /^kanso-(?:button|menu-item|action)(?:--|$)/.test(name)));
export const explainActions = (html) => actionElements(html).filter((node) => /\bExplain\b/i.test([textOf(html.slice(node.open, node.close)), node.attrs['aria-label'], node.attrs.title].join(' ')));
