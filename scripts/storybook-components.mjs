import { actionElements, elements, escapeMarkup, markupElements, explainActions, frame, sampleText, textOf, withoutRepeats } from './storybook-markup.mjs';

export function explainButton(target = 'checkout', { modifiers = [], disabled = false, role } = {}) {
  const classes = [role === 'menuitem' ? 'kanso-menu-item' : 'kanso-button--tonal', 'kanso-explain', ...modifiers];
  return `<button type="button" class="${classes.join(' ')}"${disabled ? ' disabled aria-disabled="true"' : ''}${role ? ` role="${role}"` : ''}><svg class="kanso-icon kanso-icon--row" aria-hidden="true"><use href="#lu-bot"/></svg>Explain to ${escapeMarkup(target)}</button>`;
}

const inMenu = (node) => { for (let p = node.parent; p; p = p.parent) if (p.classes.includes('kanso-menu')) return true; return false; };

export function normalizeExplain(html) {
  for (const node of explainActions(html).reverse()) {
    const label = textOf(html.slice(node.open, node.close)) || node.attrs['aria-label'] || node.attrs.title || '';
    const target = /^Explain to\s+(.+)$/i.exec(label)?.[1] ?? 'checkout';
    const replacement = explainButton(target, {
      modifiers: node.classes.filter((name) => /^kanso-control--/.test(name)),
      disabled: Object.hasOwn(node.attrs, 'disabled') || node.attrs['aria-disabled'] === 'true',
      role: node.attrs.role === 'menuitem' || inMenu(node) ? 'menuitem' : undefined,
    });
    html = html.slice(0, node.start) + replacement + html.slice(node.end);
  }
  return html;
}

export function explainErrors(html) {
  return explainActions(html).flatMap((node) => {
    const markup = html.slice(node.start, node.end);
    const label = textOf(html.slice(node.open, node.close));
    const bot = elements(markup, 'kanso-icon').some((icon) => /<(?:use)\b[^>]*(?:href|xlink:href)=["']#lu-bot["']/.test(icon));
    return node.tag === 'button' && node.attrs.type === 'button' && node.classes.includes('kanso-explain') && (node.classes.includes('kanso-button--tonal') || (node.attrs.role === 'menuitem' && node.classes.includes('kanso-menu-item'))) && bot && /^Explain to\s+\S/.test(label) && !node.classes.includes('kanso-button--quiet') ? [] : [`Explain action must be tonal with the bot icon and a named target: ${label}`];
  });
}

export function normalizeFailureActions(html) {
  const actions = actionElements(html);
  for (const group of markupElements(html).filter((node) => node.classes.includes('kanso-state-block__actions')).reverse()) {
    let block = group.parent;
    while (block && !block.classes.includes('kanso-state-block')) block = block.parent;
    if (!block || !html.slice(block.open, block.close).includes('kanso-mark--blocked')) continue;
    const first = actions.find((node) => node.start >= group.open && node.end <= group.close);
    if (!first || first.classes.includes('kanso-explain')) continue;
    const classes = [...new Set(['kanso-button', ...first.classes.filter((name) => !/^kanso-button(?:--(?:quiet|tonal))?$/.test(name))])];
    const open = html.slice(first.start, first.open).replace(/class=("[^"]*"|'[^']*')/, `class="${classes.join(' ')}"`);
    html = html.slice(0, first.start) + open + html.slice(first.open);
  }
  return html;
}

export function normalizeFactHomes(html) {
  const nodes = markupElements(html);
  const inside = (node, predicate) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (predicate(parent)) return true;
    return false;
  };
  const header = (node) => node.classes.some((name) => /^kanso-header(?:--rest)?$/.test(name));
  const drops = nodes.filter((node) => {
    if (node.classes.includes('kanso-header__branch') && inside(node, header)) return true;
    if (node.classes.includes('kanso-mark') && inside(node, header) && !inside(node, (parent) => parent.classes.includes('kanso-header__segment'))) return true;
    if (node.classes.includes('kanso-status-bar__item') && /^(?:\d+ of \d+ working|[⌘⌥⇧⌃]+[A-Z↵]+)$/.test(textOf(html.slice(node.open, node.close)))) return true;
    if (node.classes.includes('kanso-status-bar__item') && /href=["']#lu-(?:git-branch|monitor)["']/.test(html.slice(node.open, node.close))) return true;
    return node.classes.includes('kanso-row__directory') && /^(?:Off|Unreachable)$/.test(textOf(html.slice(node.open, node.close))) && inside(node, (parent) => parent.classes.includes('kanso-row--machine'));
  });
  for (const node of drops.filter((node) => !drops.some((other) => other.start < node.start && other.end >= node.end)).reverse()) html = html.slice(0, node.start) + html.slice(node.end);
  for (const node of markupElements(html).filter(header).reverse()) {
    const classes = node.classes.filter((name) => !["kanso-row--blocked", "kanso-contrast--blocked"].includes(name));
    const open = html.slice(node.start, node.open).replace(/class="[^"]*"/, `class="${classes.join(" ")}"`);
    html = html.slice(0, node.start) + open + html.slice(node.open);
  }
  return html;
}

export function worktreeRowOpen({ name, size, summary, age, reason, path, target = 'checkout' }) {
  return frame(`<div class="kanso-worktree kanso-worktree--open"><div class="kanso-worktree__heading"><span class="kanso-worktree__name">${escapeMarkup(name)}</span><span class="kanso-worktree__size">${escapeMarkup(size)}</span></div><div class="kanso-worktree__body"><div class="kanso-worktree__summary"><span class="kanso-text--blocked">${escapeMarkup(summary)}</span><span class="kanso-worktree__meta"> · ${escapeMarkup(age)}</span></div><div class="kanso-worktree__reason kanso-text--blocked">${escapeMarkup(reason)}</div><div class="kanso-worktree__path">${escapeMarkup(path)}</div></div><div class="kanso-actions kanso-worktree__actions"><button type="button" class="kanso-button--quiet">Open in a new tab</button>${explainButton(target)}<button type="button" class="kanso-button--quiet kanso-action kanso-action--armed"><span>Remove</span><span>Press again to remove</span></button></div></div>`);
}

const FIT_PAGES = ['Panels/Files', 'Panels/Preview', 'Panels/PR', 'Panels/Shipped', 'Panels/Worktrees'];

export function realSize(html) {
  const scaled = markupElements(html).find((node) => /^transform:scale\(/.test(node.attrs.style ?? '') && /overflow:hidden/.test(node.parent?.attrs.style ?? ''));
  if (!scaled) return html;
  const wrapper = scaled.parent;
  return realSize(html.slice(0, wrapper.start) + html.slice(scaled.open, scaled.close) + html.slice(wrapper.end));
}

export function normalizeComponent(record) {
  let html = sampleText(record.source === 'panels' ? withoutRepeats(record.html) : record.html).replaceAll('var(--k-fs-heading)', 'var(--k-fs-section)');
  if (record.id.includes('/components-worktree-row-open/') && !html.includes('kanso-worktree--open')) {
    const value = (name) => textOf(elements(html, name)[0] ?? '');
    const primary = elements(html, 'kanso-content__primary')[0];
    const name = textOf(/<span[^>]*>(.*?)<\/span>/s.exec(primary)?.[1] ?? '');
    const [summary, age] = value('kanso-content__secondary').split('·').map((text) => text.trim());
    const action = explainActions(html)[0];
    const target = action && /^Explain to\s+(.+)$/i.exec(textOf(html.slice(action.open, action.close)))?.[1];
    html = worktreeRowOpen({ name, size: value('kanso-row__value'), summary, age, reason: value('kanso-worktree__reason'), path: value('kanso-worktree__path'), target });
  }
  html = html.replace(/class="([^"]*\bkanso-(?:agent|sidebar__row)\b[^"]*)"/g, (_, classes) => `class="${classes.replace(/\bkanso-control--focus\b/, 'kanso-row--current')}"`);
  html = html.replace(/<span class="kanso-tab--rest kanso-action--armed">([^<]+)((?:<svg\b[^]*?<\/svg>)?)<\/span>/g, (_, name, close) => `<span class="kanso-tab--rest kanso-action--armed kanso-story__bars-anchor">${name}${close}<span class="kanso-tooltip__anchor kanso-tab__tip"><span class="kanso-tooltip">Press again to close ${name} <span>4 s</span></span></span></span>`);
  const typeRoles = { "48": "display", "20": "title", "15": "section", "13.5": "name", "12.5": "body", "11.5": "meta" };
  html = html.replace(/font-size:(48|20|15|13\.5|12\.5|11\.5)px/g, (_, size) => `font-size:var(--k-fs-${typeRoles[size]})`);
  html = realSize(html).replace(/(class="kanso-skeleton[^"]*" style="[^"]*?);?height:var\(--k-sp-2\)/g, '$1')
    .replace(/font-size:var\(--k-fs-heading\)/g, 'font-size:var(--k-fs-section)').replace(/(class="kanso-button" style="[^"]*?);?height:26px/g, '$1').replace(/ style=""/g, '')
    .replace(/(kanso-header__segment[^>]*>)<i class="kanso-dot kanso-dot--(done|working|blocked)"><\/i>/g, (_, open, state) => `${open}<svg class="kanso-mark kanso-mark--${state} kanso-mark--small"><use href="#e-${({ done: 'done', working: 'work', blocked: 'blk' })[state]}"/></svg>`)
    .replace(/kanso-review__line kanso-review__line--checked/g, 'kanso-review__line')
    .replace(/(<div class="kanso-review__line"><span class=")kanso-story__theme"/g, '$1kanso-review__key"')
    .replace(/(<div class="kanso-diff__line[^"]*"><span class="kanso-row__name">[^<]*<\/span><span class="kanso-row__detail">[^<]*<\/span>)(?!<span class="kanso-diff__code">)((?:(?!<\/div>).)*<span class="kanso-code__token(?:(?!<\/div>).)*)<\/div>/g, '$1<span class="kanso-diff__code">$2</span></div>');
  if (record.source === 'panels' && FIT_PAGES.includes(record.page)) html = html.replace('kanso-story__frame kanso-panel"', 'kanso-story__frame kanso-panel kanso-panel--fit"');
  return { ...record, html: normalizeFactHomes(normalizeFailureActions(normalizeExplain(html))), ...(record.notes ? { notes: record.notes.map((note) => note.replace('Explain is beside it, quiet.', 'Explain is beside it, tonal with the Lucide bot icon.')) } : {}) };
}

export const COMPONENT_CSS = `
:is(.kanso-explain,.kanso-worktree__actions>button){border:0;font-family:inherit}
.kanso-tab__tip{left:0;top:calc(100% + var(--k-sp-1))}
.kanso-story__bar:has(.kanso-tab__tip){padding-bottom:var(--k-sp-8)}
.kanso-menu-item.kanso-explain{width:100%;background:transparent;color:inherit;font-size:inherit;text-align:left}
.kanso-actions>.kanso-action.kanso-button--quiet{display:inline-grid}
.kanso-worktree--open{padding:var(--k-sp-3);background:var(--selected);border-radius:var(--k-r-control);max-width:72ch;box-sizing:border-box}
.kanso-worktree__heading{display:flex;align-items:baseline;gap:var(--k-sp-2)}
.kanso-worktree--open .kanso-worktree__name{font-size:var(--k-fs-name);font-weight:var(--k-fw-medium)}
.kanso-worktree__size{margin-left:auto}
.kanso-worktree__body{display:flex;flex-direction:column;gap:var(--k-sp-1);margin-top:var(--k-sp-1);font-size:var(--k-fs-body);line-height:var(--k-lh-body)}
.kanso-worktree--open :is(.kanso-worktree__meta,.kanso-worktree__size,.kanso-worktree__path){font-size:var(--k-fs-meta);color:var(--dim)}
.kanso-worktree__summary{font-size:var(--k-fs-meta)}
.kanso-worktree--open .kanso-worktree__path{font-family:var(--mono)}
.kanso-worktree__actions>.kanso-button--quiet{background:transparent}
:where(span.kanso-skeleton){height:9px}
:where(.kanso-content__primary>span.kanso-skeleton){height:11px}
:where(.kanso-button--quiet){font-weight:var(--k-fw-regular)}
:where(.kanso-section .kanso-button--quiet){font-weight:var(--k-fw-medium)}
.kanso-story__frame:not(.kanso-panel){padding:0;background:none;box-shadow:none}
.kanso-panel--fit .kanso-panel{overflow:hidden;height:auto!important}
.kanso-panel--fit .kanso-panel>*{flex-shrink:0}
.kanso-review__line+.kanso-review__line{margin-top:var(--k-sp-1)}
.kanso-review__line .kanso-review__key{color:var(--dim);flex:none;min-width:0}
.kanso-review__snippet+.kanso-prose{margin-top:var(--k-sp-3)}
.kanso-row>:is(.kanso-panel__row-value,.kanso-button--quiet)~.kanso-button--quiet{margin-left:0}
.kanso-row>.kanso-panel__row-value+.kanso-button--quiet{margin-left:var(--k-sp-1)}
.kanso-chart--spend{height:calc(var(--k-sp-4) * 6);margin-top:var(--k-sp-6)}
.kanso-chart--spend i{position:relative;font-style:normal;background:var(--muted)}
.kanso-chart--spend i.kanso-chart__bar--peak{background:var(--fg)}
.kanso-chart--spend i.kanso-chart__bar--empty{background:var(--border)}
.kanso-chart__value{position:absolute;bottom:calc(100% + var(--k-sp-1));left:50%;transform:translateX(-50%);font-size:var(--k-fs-meta);color:var(--fg);white-space:nowrap}
`;
