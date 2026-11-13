import { COMPONENT_CSS } from './storybook-components.mjs';

export function cssBlocks(css) {
  const blocks = [];
  let start = 0, depth = 0, quote = "", comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i], next = css[i + 1];
    if (comment) { if (c === "*" && next === "/") { comment = false; i++; if (!depth) start = i + 1; } continue; }
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "/" && next === "*") { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ";" && depth === 0) { start = i + 1; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) { blocks.push(css.slice(start, i + 1).trim()); start = i + 1; }
  }
  if (depth || quote || comment) throw new Error("Unbalanced CSS");
  return blocks;
}

export const CSS_MARK = '/* Additional panel drawing rules. Written by scripts/import-panels.mjs. */';

export function normalizeCss(css, { kit = false } = {}) {
  if (kit) {
    const [base, extra] = css.split(CSS_MARK);
    css = base + COMPONENT_CSS + (extra === undefined ? '' : CSS_MARK + extra);
  }
  css = css.replaceAll('.kanso-button--tonal:first-of-type', '.kanso-button--tonal:not(.kanso-explain):first-of-type');
  css = css.replace(/^:is\(\.kanso-state-block__actions,\.kanso-state-empty\)>\.kanso-button--tonal[^\n{]*\{[^}]*\}\n?/gm, '');
  css = css.replaceAll('.kanso-state-block>.kanso-state-block__actions>.kanso-button--tonal{', '.kanso-state-block>.kanso-state-block__actions>:is(.kanso-button,.kanso-button--tonal){');
  css = css.replace('.kanso-button.kanso-control--off{background:var(--w4);color:var(--dim);cursor:not-allowed}', '.kanso-control--off{background:var(--w4);color:var(--dim);cursor:not-allowed;pointer-events:none}');
  const seen = new Set();
  const render = (text, context = '') => cssBlocks(text).map((rule) => {
    const brace = rule.indexOf('{');
    if (brace < 0) return rule;
    let selector = rule.slice(0, brace).trim();
    const body = rule.slice(brace + 1, -1).trim();
    if (/^@(media|supports|layer)\b/.test(selector)) return `${selector}{${render(body, `${context}|${selector}`)}}`;
    selector = selector.replace(/:hover(?!,\.kanso-control--hover)\b/g, ':is(:hover,.kanso-control--hover)').replace(/:active(?!,\.kanso-control--active)\b/g, ':is(:active,.kanso-control--active)').replace(/:focus-visible(?!,\.kanso-control--focus)\b/g, ':is(:focus-visible,.kanso-control--focus)');
    return { selector, body, key: `${context}|${selector}|${body.replace(/\s+/g, '')}` };
  }).reverse().filter((rule) => {
    if (typeof rule === 'string') return true;
    if (seen.has(rule.key)) return false;
    seen.add(rule.key);
    return true;
  }).reverse().map((rule) => typeof rule === 'string' ? rule : `${rule.selector}{${rule.body}}`).join('\n');
  const [base, extra] = css.replace(/\/\*(?! Additional panel drawing rules\.)[\s\S]*?\*\//g, '').replace(/[ \t]+$/gm, '').split(CSS_MARK);
  const additions = extra === undefined ? '' : render(extra);
  const output = render(base);
  return `${output}\n${extra === undefined ? '' : `\n${CSS_MARK}\n${additions}\n`}`;
}
