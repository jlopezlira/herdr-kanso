import { elements, escapeMarkup, explainActions, frame, textOf, withoutRepeats } from './storybook-markup.mjs';

export function explainButton(target = 'checkout', { modifiers = [], disabled = false, role } = {}) {
  const classes = ['kanso-button--tonal', 'kanso-explain', ...modifiers];
  return `<button type="button" class="${classes.join(' ')}"${disabled ? ' disabled aria-disabled="true"' : ''}${role ? ` role="${role}"` : ''}><svg class="kanso-icon kanso-icon--row" aria-hidden="true"><use href="#lu-bot"/></svg>Explain to ${escapeMarkup(target)}</button>`;
}

export function normalizeExplain(html) {
  for (const node of explainActions(html).reverse()) {
    const label = textOf(html.slice(node.open, node.close)) || node.attrs['aria-label'] || node.attrs.title || '';
    const target = /^Explain to\s+(.+)$/i.exec(label)?.[1] ?? 'checkout';
    const replacement = explainButton(target, {
      modifiers: node.classes.filter((name) => /^kanso-control--/.test(name)),
      disabled: Object.hasOwn(node.attrs, 'disabled') || node.attrs['aria-disabled'] === 'true',
      role: node.attrs.role === 'menuitem' ? 'menuitem' : undefined,
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
    return node.tag === 'button' && node.attrs.type === 'button' && node.classes.includes('kanso-explain') && node.classes.includes('kanso-button--tonal') && bot && /^Explain to\s+\S/.test(label) && !node.classes.includes('kanso-button--quiet') ? [] : [`Explain action must be tonal with the bot icon and a named target: ${label}`];
  });
}

export function worktreeRowOpen({ name, size, summary, age, reason, path, target = 'checkout' }) {
  return frame(`<div class="kanso-worktree kanso-worktree--open"><div class="kanso-worktree__heading"><span class="kanso-worktree__name">${escapeMarkup(name)}</span><span class="kanso-worktree__size">${escapeMarkup(size)}</span></div><div class="kanso-worktree__body"><div class="kanso-worktree__summary"><span class="kanso-text--blocked">${escapeMarkup(summary)}</span><span class="kanso-worktree__meta"> · ${escapeMarkup(age)}</span></div><div class="kanso-worktree__reason kanso-text--blocked">${escapeMarkup(reason)}</div><div class="kanso-worktree__path">${escapeMarkup(path)}</div></div><div class="kanso-actions kanso-worktree__actions"><button type="button" class="kanso-button--quiet">Open in a new tab</button>${explainButton(target)}<button type="button" class="kanso-button--quiet kanso-action kanso-action--armed"><span>Remove</span><span>Press again to remove</span></button></div></div>`);
}

export function normalizeComponent(record) {
  let html = record.source === 'panels' ? withoutRepeats(record.html) : record.html;
  if (record.id.includes('/components-worktree-row-open/') && !html.includes('kanso-worktree--open')) {
    const value = (name) => textOf(elements(html, name)[0] ?? '');
    const primary = elements(html, 'kanso-content__primary')[0];
    const name = textOf(/<span[^>]*>(.*?)<\/span>/s.exec(primary)?.[1] ?? '');
    const [summary, age] = value('kanso-content__secondary').split('·').map((text) => text.trim());
    const action = explainActions(html)[0];
    const target = action && /^Explain to\s+(.+)$/i.exec(textOf(html.slice(action.open, action.close)))?.[1];
    html = worktreeRowOpen({ name, size: value('kanso-row__value'), summary, age, reason: value('kanso-worktree__reason'), path: value('kanso-worktree__path'), target });
  }
  return { ...record, html: normalizeExplain(html), ...(record.notes ? { notes: record.notes.map((note) => note.replace('Explain is beside it, quiet.', 'Explain is beside it, tonal with the Lucide bot icon.')) } : {}) };
}

export const COMPONENT_CSS = `
:is(.kanso-explain,.kanso-worktree__actions>button){border:0;font-family:inherit}
.kanso-actions>.kanso-action.kanso-button--quiet{display:inline-grid}
.kanso-worktree--open{padding:var(--k-sp-3);background:var(--selected);border-radius:var(--k-r-control);max-width:72ch;box-sizing:border-box}
.kanso-worktree__heading{display:flex;align-items:baseline;gap:var(--k-sp-2)}
.kanso-worktree--open .kanso-worktree__name{font-size:var(--k-fs-name);font-weight:var(--k-fw-medium)}
.kanso-worktree__size{margin-left:auto}
.kanso-worktree__body{display:flex;flex-direction:column;gap:var(--k-sp-1);margin-top:var(--k-sp-1);font-size:var(--k-fs-body);line-height:var(--k-lh-body)}
.kanso-worktree--open :is(.kanso-worktree__meta,.kanso-worktree__size,.kanso-worktree__path){font-size:var(--k-fs-meta);color:var(--dim)}
.kanso-worktree--open .kanso-worktree__path{font-family:var(--mono)}
.kanso-worktree__actions>.kanso-button--quiet{background:transparent}
`;
