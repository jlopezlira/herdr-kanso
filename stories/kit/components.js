// The kit as pure functions: each component returns its markup and composes the ones below it.

export const escape = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

// Atoms

export const kinds = { solid: 'kanso-button--solid', tonal: 'kanso-button--tonal', quiet: 'kanso-button--quiet kanso-text--fg', icon: 'kanso-button--icon' };
export const button = ({ label, kind = 'solid', size = 'md', icon = 'none', disabled = false, verb = '', armed = false, active = false, spin = false }) => {
  const classes = ['kanso-button', kinds[kind], size === 'md' ? '' : `kanso-button--${size}`, disabled ? 'kanso-control--off' : '', armed ? 'kanso-action kanso-action--armed' : '', active ? 'kanso-button--active' : '', spin ? 'kanso-button--spinning' : ''].filter(Boolean).join(' ');
  const glyph = icon === 'none' ? (spin ? '<svg class="kanso-mark kanso-mark--working kanso-icon--inline"><use href="#e-work"/></svg>' : '') : `<svg class="kanso-icon"><use href="#${icon}"/></svg>`;
  const text = kind === 'icon' ? '' : escape(label);
  const inner = armed ? `<span>${text}</span><span>Press again to ${escape(verb || label.toLowerCase())}</span>` : `${glyph}${text}`;
  return `<span class="${classes}" tabindex="0" title="${escape(label)}"${disabled ? ' aria-disabled="true"' : ''}${spin ? ' aria-busy="true"' : ''}>${inner}</span>`;
};

export const windowControls = () => '<span class="kanso-window-controls"><i></i><i></i><i></i></span>';

export const dawn = ({ id = 'dawn' } = {}) => `<svg class="kanso-dawn kanso-dawn--rising" viewBox="0 0 256 56" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--dawn-top)"/><stop offset=".45" style="stop-color:var(--dawn-mid)"/><stop offset=".8" style="stop-color:var(--dawn-low)"/><stop offset="1" style="stop-color:var(--dawn-edge)"/></linearGradient><radialGradient id="${id}-glow" cx="124" cy="44" r="78" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 15.4) scale(1.65)"><stop offset="0" style="stop-color:var(--dawn-sun);stop-opacity:.85"/><stop offset=".35" style="stop-color:var(--dawn-edge);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--dawn-edge);stop-opacity:0"/></radialGradient><linearGradient id="${id}-fade" x1="0" y1="44" x2="0" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--dawn-edge);stop-opacity:.5"/><stop offset="1" style="stop-color:var(--chrome);stop-opacity:0"/></linearGradient><clipPath id="${id}-clip"><rect x="0" y="0" width="256" height="44"/></clipPath></defs><rect width="256" height="44" fill="url(#${id}-sky)"/><rect class="kanso-dawn__night" width="256" height="44" style="fill:var(--dawn-top)"/><g clip-path="url(#${id}-clip)"><rect class="kanso-dawn__glow" width="256" height="44" fill="url(#${id}-glow)"/><g class="kanso-dawn__stars" style="fill:var(--dawn-star)"><circle cx="14" cy="7" r=".7" opacity=".8"/><circle cx="44" cy="13" r=".5" opacity=".55"/><circle cx="212" cy="6" r=".6" opacity=".7"/><circle cx="240" cy="15" r=".5" opacity=".45"/><circle cx="84" cy="5" r=".45" opacity=".5"/></g><g class="kanso-dawn__clouds" style="stroke:var(--dawn-sun)" stroke-linecap="round" fill="none"><path d="M28 31h58" stroke-width="1.6" opacity=".55"/><path d="M52 36h30" stroke-width="1.2" opacity=".5"/><path d="M162 28h64" stroke-width="1.6" opacity=".5"/><path d="M176 34h30" stroke-width="1.2" opacity=".45"/><path d="M6 39h40" stroke-width="1" opacity=".4"/><path d="M214 40h36" stroke-width="1" opacity=".4"/></g><g class="kanso-dawn__sun"><circle cx="124" cy="44" r="10" style="fill:var(--dawn-sun)" opacity=".5"/><circle cx="124" cy="44" r="13" fill="none" style="stroke:var(--dawn-sun)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="70 12" transform="rotate(-150 124 44)" class="kanso-dawn__circle"/></g></g><rect y="44" width="256" height="12" fill="url(#${id}-fade)"/><path class="kanso-dawn__horizon" d="M0 44.5H256" style="stroke:var(--dawn-sun)" stroke-width="1" opacity=".55"/></svg>`;

export const avatarSizes = { sm: ' kanso-avatar--sm', md: '', lg: ' kanso-avatar--lg' };
export const avatar = ({ initial, image, size, tone }) => {
  const picture = image ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="kanso-avatar kanso-avatar--round${avatarSizes[size] ?? ""}${tone ? ` kanso-text--host-${escape(tone)}` : ""}">${picture}${escape(initial.slice(0, 1))}</span>`;
};

export const card = ({ author, image, age, body, loading }) => `<div class="kanso-card${loading ? ' kanso-skeleton--shape' : ''}"><div class="kanso-card__header">${avatar({ initial: author, image, size: 'md' })}<b>${escape(author)}</b><span class="kanso-layout__grow"></span><span class="kanso-text--dim">${escape(age)}</span></div><div class="kanso-prose">${escape(body)}</div></div>`;

const syntax = /("[^"\n]*"|'[^'\n]*'|`[^`]*`)|\b(\d+)\b|\b(import|from|export|default|function|const|let|var|return|if|else|for|while|async|await|new|class)\b/g;
const highlight = (line) => {
  let html = '', at = 0;
  for (const match of line.matchAll(syntax)) {
    const tone = match[1] ? 'string' : match[2] ? 'number' : 'keyword';
    html += `${escape(line.slice(at, match.index))}<span class="kanso-code__token--${tone}">${escape(match[0])}</span>`;
    at = match.index + match[0].length;
  }
  return html + escape(line.slice(at));
};
const signs = { '+': 'added', '-': 'deleted', '@': 'hunk' };
const failure = /\b(fail(ed|ure)?|error|exception)\b|^\s*>/i;
export const code = ({ text, kind, first, line }) => {
  const rows = text.split('\n').map((source, index) => {
    const sign = kind === 'diff' ? signs[source[0]] : undefined;
    const classes = ['kanso-code__line', sign ? `kanso-code__line--${sign}` : '', first + index === line ? 'kanso-control--on' : ''].filter(Boolean).join(' ');
    if (sign === 'hunk') return `<div class="${classes}">${escape(source)}</div>`;
    if (kind === 'log') return `<div class="${classes}"><span class="kanso-code__number"></span><span class="kanso-code__sign"> </span>${failure.test(source) ? `<span class="kanso-text--blocked">${escape(source)}</span>` : escape(source)}</div>`;
    const body = sign || (kind === 'diff' && source[0] === ' ') ? source.slice(1) : source;
    return `<div class="${classes}"><span class="kanso-code__number">${first + index}</span><span class="kanso-code__sign">${sign === 'added' ? '+' : sign === 'deleted' ? '-' : ' '}</span>${kind === 'source' ? highlight(body) : escape(body)}</div>`;
  }).join('');
  return `<div class="kanso-code">${rows}</div>`;
};

const shape = (markup) => markup.replace(' kanso-text--fg', '').replace(/class="([^"]*)"/, 'class="$1 kanso-skeleton--shape"');
const words = (text, skeleton) => skeleton ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(text)}</span>` : escape(text);
export const dialog = ({ title, scope, value, placeholder, loading, note, tone, primary, state, secondary }) => {
  const action = (label, kind, look) => (loading ? shape : String)(button({ label, kind, ...(loading ? {} : { disabled: look === 'disabled', spin: look === 'loading', armed: look === 'armed' }) }));
  const field = value ? `${escape(value)}<span class="kanso-caret"></span>` : `<span class="kanso-caret"></span><span class="kanso-dialog__placeholder">${escape(placeholder)}</span>`;
  return `<div class="kanso-dialog kanso-popover"><div class="kanso-dialog__header"><span class="kanso-dialog__title">${words(title, loading)}</span></div>`
    + (scope ? `<div class="kanso-dialog__scope">${words(scope, loading)}</div>` : '')
    + `<div class="kanso-field${loading ? ' kanso-skeleton--shape' : ' kanso-control--focus'} kanso-dialog__section" tabindex="0">${field}</div>`
    + (note ? `<div class="kanso-dialog__note${tone === 'dim' ? '' : ` kanso-dialog__note--${tone}`}">${words(note, loading)}</div>` : '')
    + `<div class="kanso-dialog__footer">${secondary ? action(secondary, 'quiet', 'default') : ''}${action(primary, 'solid', state)}</div></div>`;
};

export const input = ({ text: value, label: placeholder, icon, error, disabled, multiline, inline: rename, selected, loading, limit }) => {
  const editable = !disabled && !loading;
  const enter = multiline ? '' : ` onkeydown="if (event.key === 'Enter') event.preventDefault()"`;
  const cap = ` onbeforeinput="if (event.inputType.startsWith('insert') && this.innerText.length >= ${limit}) event.preventDefault()"`;
  const text = `<div class="kanso-field__editor" role="textbox" aria-label="${escape(placeholder)}" aria-multiline="${multiline}" contenteditable="${editable}"${editable ? ' tabindex="0"' : ''}${enter}${cap}>${selected ? `<span class="kanso-field__selection">${escape(value.slice(0, limit))}</span>` : escape(value.slice(0, limit))}</div>`;
  const action = icon === 'none' || rename ? '' : `<span class="kanso-button kanso-button--icon" tabindex="0"><svg class="kanso-icon kanso-icon--row"><use href="#${icon}"/></svg></span>`;
  const classes = `kanso-field${multiline ? ' kanso-field--multiline' : ''}${rename ? ' kanso-field--inline' : ''}${loading ? ' kanso-skeleton--shape' : `${error ? ' kanso-field--invalid' : ''}${disabled ? ' kanso-control--off' : ''}`}`;
  return `<div class="${classes}"${disabled ? ' aria-disabled="true"' : ''}>${text}${action}</div>`;
};

const inline = (text) => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const cells = (row, tag) => `<tr>${row.split('|').slice(1, -1).map((cell) => `<${tag}>${inline(cell.trim())}</${tag}>`).join('')}</tr>`;
const blocksOf = (source) => source.trim().split(/\n\s*\n/).map((block) => {
  const lines = block.split('\n');
  if (block.startsWith('## ')) return `<div class="kanso-markdown__subheading">${inline(block.slice(3))}</div>`;
  if (block.startsWith('# ')) return `<div class="kanso-markdown__heading">${inline(block.slice(2))}</div>`;
  if (lines.every((line) => line.trim().startsWith('|'))) return `<table class="kanso-markdown__table">${lines.filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line)).map((line, index) => cells(line.trim(), index ? 'td' : 'th')).join('')}</table>`;
  if (lines.every((line) => line.startsWith('- '))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
  return `<p>${lines.map(inline).join(' ')}</p>`;
});
export const markdown = ({ source, block, state }) => `<div class="kanso-markdown">${blocksOf(source).map((html, index) => {
  const on = index + 1 === block ? { hover: ' kanso-row--hover', editing: ' kanso-editor--editing kanso-control--focus' }[state] ?? '' : '';
  return `<div class="kanso-markdown__block${on}"${on.includes('editing') ? ' contenteditable="true"' : ''}>${html}</div>`;
}).join('')}</div>`;

export const menu = ({ title, items }) => {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    if (item.separator) return '<div class="kanso-menu__separator"></div>';
    const glyph = item.icon ? `<svg class="kanso-icon kanso-icon--row"><use href="#${escape(item.icon)}"/></svg>` : '<span class="kanso-menu__spacer"></span>';
    const classes = `kanso-menu__item${item.armed ? ' kanso-action--armed' : item.selected ? ' kanso-control--selected' : ''}`;
    const label = item.armed ? `Press again to ${escape(item.verb || String(item.label ?? '').toLowerCase())}` : escape(item.label ?? '');
    return `<div class="${classes}" role="menuitem" tabindex="0">${glyph}<span class="kanso-layout__grow">${label}</span>`
      + (item.badge ? `<span class="kanso-menu__badge">${escape(item.badge)}</span>` : '')
      + (item.hint ? `<span class="kanso-menu__hint">${escape(item.hint)}</span>` : '') + '</div>';
  }).join('');
  return `<div class="kanso-menu kanso-popover" role="menu">${title ? `<div class="kanso-menu__heading">${escape(title)}</div>` : ''}${rows}</div>`;
};

export const metric = ({ value, unit, facts, loading }) => {
  const piece = (text, element) => `<span class="${element}${loading ? ' kanso-skeleton--shape kanso-skeleton--text' : ''}">${escape(text)}</span>`;
  const list = facts.split('|').map((fact) => fact.trim()).filter(Boolean);
  return `<div class="kanso-panel"><div class="kanso-metric">${piece(value, 'kanso-metric__value')}${unit ? piece(unit, 'kanso-metric__unit') : ''}</div>`
    + (list.length ? `<div class="kanso-panel__facts">${list.map((fact) => loading ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(fact)}</span>` : `<span>${escape(fact)}</span>`).join('')}</div>` : '')
    + '</div>';
};

const glyph = (icon) => `<svg class="${icon.startsWith('p-') ? 'kanso-icon--program' : 'kanso-icon kanso-icon--row'}"><use href="#${escape(icon)}"/></svg>`;
const flip = "if (this.getAttribute('aria-disabled')) return; this.setAttribute('aria-checked', this.classList.toggle('kanso-control--on'))";
export const toggle = ({ checked, label, disabled }) => `<span class="kanso-switch${checked ? ' kanso-control--on' : ''}${disabled ? ' kanso-control--off' : ''}" role="switch" aria-checked="${checked}" aria-label="${escape(label)}" tabindex="0"${disabled ? ' aria-disabled="true"' : ''} onclick="${flip}" onkeydown="if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.click(); }"><i></i></span>`;
export const marks = { working: 'e-work', blocked: 'e-blk', done: 'e-done', idle: 'e-idle', asleep: 'lu-moon' };
export const markSizes = { sm: ' kanso-icon--inline', md: '', lg: ' kanso-icon--control' };
export const mark = ({ status, size = 'md' }) => `<svg class="kanso-mark kanso-mark--${status}${markSizes[size]}"><use href="#${marks[status]}"/></svg>`;

export const chip = ({ label, quiet = false, tone = '' }) => `<span class="kanso-badge${quiet ? ' kanso-badge--quiet' : ''}${tone ? ` kanso-text--${escape(tone)}` : ''}">${escape(String(label))}</span>`;
const fact = (part) => typeof part === 'string' ? `<span>${escape(part)}</span>` : `${part.icon ? `<svg class="kanso-icon kanso-icon--inline"><use href="#${escape(part.icon)}"/></svg>` : ''}<span>${escape(part.text)}</span>`;
const rowTool = (action) => button({ kind: 'icon', size: 'sm', ...action });
export const rowDepths = [0, 1, 2];
// `actions` show on hover or focus and take the meta's place; `action` is always shown.
export const row = ({ icon = 'none', name, detail, meta, chip: count, flag, mark: status = 'none', second, heading, depth = 0, glint, selected, current, dimmed, pending, hover, focus, actions = [], action }) => {
  const lead = icon === 'none' ? '' : glyph(icon);
  const label = `<span class="kanso-row__name${glint ? ' kanso-text--glint' : ''}">${escape(name)}</span>`;
  const facts = [].concat(detail ?? []).filter(Boolean);
  const tail = `${facts.length ? `<span class="kanso-row__detail">${facts.map(fact).join('')}</span>` : ''}<span class="kanso-layout__grow"></span>`
    + `${meta ? `<span class="kanso-row__meta">${escape(meta)}</span>` : ''}${flag ? `<span class="kanso-row__flag">${glyph(flag)}</span>` : ''}`
    + `${actions.length ? `<span class="kanso-row__actions">${actions.map(rowTool).join('')}</span>` : ''}${count ? chip({ label: count }) : ''}${action ? button({ size: 'sm', ...action }) : ''}`
    + `${pending ? '<span class="kanso-state-line__pending-dot"></span>' : ''}${!status || status === 'none' ? '' : mark({ status })}`;
  const states = [second && 'kanso-row--two-lines', heading && 'kanso-row--heading', depth && `kanso-row--depth-${depth}`, selected && 'kanso-control--selected', current && 'kanso-row--selected',
    dimmed && 'kanso-control--dim', pending && 'kanso-state-line--pending', hover && 'kanso-control--hover', focus && 'kanso-control--focus'].filter(Boolean).map((name) => ` ${name}`).join('');
  return second
    ? `<div class="kanso-row${states}" tabindex="0"><div class="kanso-content__primary">${lead}${label}${tail}</div><div class="kanso-content__secondary">${escape(second)}</div></div>`
    : `<div class="kanso-row${states}" tabindex="0">${lead}${label}${tail}</div>`;
};

const bar = (shape) => `<span class="kanso-skeleton kanso-skeleton--${shape}"></span>`;
export const skeletonShapes = {
  row: () => `<div class="kanso-row">${bar('icon')}${bar('line')}<span class="kanso-layout__grow"></span></div>`,
  'list row': () => `<div class="kanso-row">${bar('line')}<span class="kanso-layout__grow"></span>${bar('meta')}</div>`,
  header: () => `<div class="kanso-panel__header">${bar('title')}<span class="kanso-layout__grow"></span>${bar('control')}</div>`,
  line: () => `<div class="kanso-row">${bar('line')}</div>`,
};
export const skeletonOf = ({ shape, count }) => `<div class="kanso-skeleton__list kanso-skeleton--breathing" role="status" aria-label="Loading">${Array.from({ length: shape === 'header' ? 1 : count }, (_, i) => skeletonShapes[shape](i)).join('')}</div>`;

const choose = "if (this.closest('.kanso-control--off')) return; for (const tab of this.parentNode.children) { tab.classList.toggle('kanso-tabs__tab--on', tab === this); tab.setAttribute('aria-selected', tab === this); }";
export const tabs = ({ items, value, size, track, disabled, icon, label: named }) => `<div class="kanso-tabs kanso-tabs--${size}${track ? ' kanso-tabs--track' : ''}${disabled ? ' kanso-control--off' : ''}" role="tablist"${disabled ? ' aria-disabled="true"' : ''}>${(Array.isArray(items) ? items : []).map((item) => {
  const on = item.key === value;
  const label = escape(item.label ?? '');
  const square = icon && !named;
  return `<span class="kanso-tabs__tab${on ? ' kanso-tabs__tab--on' : ''}${square ? ' kanso-tabs__tab--icon' : ''}${item.armed ? ' kanso-action--armed' : ''}" role="tab" aria-selected="${on}" aria-label="${label}" tabindex="0" title="${square ? label : escape(item.tip ?? '')}" onclick="${choose}">`
    + `${icon && item.icon ? glyph(item.icon) : ''}${named || !item.icon ? label : ''}${item.mark && !square ? mark({ status: item.mark, size: 13 }) : ''}`
    + `${(item.dot || (square && item.mark === 'blocked')) && !on ? '<i class="kanso-tabs__dot"></i>' : ''}${on && item.closable && !square ? '<svg class="kanso-icon kanso-tabs__close"><use href="#lu-x"/></svg>' : ''}</span>`;
}).join('')}</div>`;

export const thumbnail = ({ image, label, selected, loading }) => `<span class="kanso-thumbnail${selected ? ' kanso-control--selected' : ''}${loading ? ' kanso-skeleton--shape' : ''}" role="button" aria-pressed="${selected}" aria-label="${escape(label)}" title="${escape(label)}" tabindex="0">${image && !loading ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;

export const levels = { error: 'blocked', warning: 'working', success: 'done', info: 'accent' };
const lead = (level) => level === 'error' ? '<svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg>'
  : level === 'success' ? '<svg class="kanso-icon kanso-icon--row kanso-text--done" aria-hidden="true"><use href="#lu-check"/></svg>'
  : `<i class="kanso-toast__dot kanso-fill--${levels[level]}"></i>`;
export const toast = ({ level, icon, title, body, action, explain }) => {
  const fix = action ? button({ label: action, kind: 'tonal', size: 'sm' }) : '';
  const ask = explain ? `<span class="kanso-button kanso-button--tonal kanso-button--sm" tabindex="0"><svg class="kanso-icon kanso-icon--row" aria-hidden="true"><use href="#lu-bot"/></svg>Explain to ${escape(explain)}</span>` : '';
  const text = body ? `<span class="kanso-toast__text"><span>${escape(title)}</span><span class="kanso-toast__body">${escape(body)}</span></span>` : `<span class="kanso-content__text">${escape(title)}</span>`;
  return `<div class="kanso-toast kanso-popover${body ? ' kanso-toast--two-lines' : ''}" role="status">${icon === 'none' ? lead(level) : glyph(icon).replace('class="', `class="kanso-text--${levels[level]} `)}${text}${fix}${ask}</div>`;
};

export const sides = ['auto', 'top', 'bottom', 'left', 'right'];
// Auto takes the side with the most room around the control, measured when it opens.
const place = "const tip = this.nextElementSibling, box = this.getBoundingClientRect(), room = { top: box.top, bottom: innerHeight - box.bottom, left: box.left, right: innerWidth - box.right }; const side = Object.keys(room).reduce((a, b) => room[b] > room[a] ? b : a); tip.className = tip.className.replace(/kanso-tooltip--(top|bottom|left|right)/, 'kanso-tooltip--' + side)";
export const tooltip = ({ text, detail, key, icon, open, side }) => `<span class="kanso-tooltip__trigger"><span class="kanso-button kanso-button--icon" tabindex="0" aria-label="${escape(text)}"${side === 'auto' ? ` onmouseenter="${place}" onfocus="${place}"` : ''}><svg class="kanso-icon"><use href="#${icon}"/></svg></span>`
  + `<span class="kanso-tooltip kanso-popover kanso-tooltip--${side === 'auto' ? 'bottom' : side}${open ? ' kanso-tooltip--open' : ''}" role="tooltip">${escape(text)}${key ? ` <span>${escape(key)}</span>` : ''}${detail ? ` <span>· ${escape(detail)}</span>` : ''}</span></span>`;

// Molecules

const tool = (icon, label) => button({ label, kind: 'icon', size: 'lg', icon });
const more = (open) => `<div class="kanso-toolbar__group${open ? ' kanso-toolbar__group--open' : ''}">${tool(open ? 'lu-chevron-up' : 'lu-chevron-down', open ? 'Fewer tools' : 'More tools')}${open ? tool('lu-arrow-up-down', 'Sort') + tool('lu-search', 'Search') : ''}</div>`;
export const toolbar = ({ column = false, open = false } = {}) => column
  ? `<div class="kanso-toolbar kanso-toolbar--column">${tool('lu-panel-left', 'Show sidebar')}${tool('lu-plus', 'New')}${more(open)}</div>`
  : `<div class="kanso-toolbar">${tool('lu-plus', 'New')}<span class="kanso-layout__grow"></span>${tool('lu-arrow-up-down', 'Sort')}${tool('lu-search', 'Search')}${tool('lu-panel-left', 'Hide sidebar')}</div>`;

// Sidebar compositions: each one is the Row, Tab, Menu, Avatar, Mark, Chip or Button in its own configuration.
const icon = (name, label) => ({ icon: name, label });

export const sessionRow = ({ program = 'p-claude', name, activity = '', time = '', place = '', status = 'working', depth = 1, current = false, pinned = false, commands = 0, hover = false, focus = false, dimmed = false }) => row({
  icon: program, name, second: activity, detail: place, meta: time, mark: status, depth, current, dimmed, hover, focus,
  glint: status === 'working', flag: pinned ? 'lu-pin' : '', chip: commands, actions: [icon('lu-pin', 'Pin to the top'), icon('lu-ellipsis', 'More')],
});

export const projectRow = ({ name, folder = '', branch = '', sync = '', open = false, status = 'blocked', count = 0, hover = false, focus = false }) => row({
  name, heading: true, current: open, hover, focus, detail: [folder, branch && { icon: 'lu-git-branch', text: branch }, sync],
  mark: count ? status : 'none', meta: count ? String(count) : '', actions: [icon('lu-plus', `New agent in ${name}`), icon('lu-ellipsis', 'More')],
});

export const computerStates = ['on', 'off', 'unreachable'];
export const computerRow = ({ name, remote = true, state = 'on', status = 'blocked', count = 0, hover = false, focus = false }) => row({
  icon: remote ? 'lu-server' : 'lu-monitor', name, heading: true, hover, focus,
  mark: count ? status : 'none', meta: count ? String(count) : '',
  action: state === 'off' ? { kind: 'icon', ...icon('lu-power', `Turn ${name} on`) } : state === 'unreachable' ? { kind: 'icon', ...icon('lu-refresh-cw', 'Refresh') } : null,
  actions: state === 'on' && remote ? [icon('lu-power', 'Turn off'), icon('lu-plus', `New project on ${name}`), icon('lu-arrow-right-left', 'Sync')] : [],
});

export const section = ({ title, status = 'none', count = 0 }) => row({ name: title, heading: true, mark: status, meta: count ? String(count) : '' });

export const asleep = ({ names = [], open = false } = {}) => row({ name: 'Asleep', heading: true, mark: 'asleep', meta: open ? '' : String(names.length) })
  + (open ? names.map((name) => row({ name, depth: 1, dimmed: true, action: { label: 'Wake', kind: 'quiet' } })).join('') : '');

export const views = [
  { key: 'spaces', label: 'Projects', icon: 'lu-folder' },
  { key: 'agents', label: 'Status', icon: 'lu-activity' },
  { key: 'threads', label: 'Threads', icon: 'lu-message-square' },
];
// Collapsed, one button for the current view opens the menu of all three.
export const viewSwitch = ({ view = 'spaces', column = false, open = false } = {}) => {
  if (!column) return `<div class="kanso-sidebar__view-switch">${tabs({ items: views, value: view, size: 'sm', track: true, label: true })}</div>`;
  const current = views.find((item) => item.key === view) ?? views[0];
  const list = open ? `<div class="kanso-sidebar__view-menu">${menu({ items: views.map((item) => ({ ...item, selected: item.key === current.key })) })}</div>` : '';
  return `<div class="kanso-sidebar__view-switch">${button({ label: current.label, kind: 'icon', size: 'lg', icon: current.icon, active: open })}${list}</div>`;
};

export const sidebarFooter = ({ update = '' } = {}) => `<div class="kanso-sidebar__footer">${update ? row({ icon: 'lu-refresh-cw', name: update }) : ''}${row({ icon: 'lu-settings', name: 'Settings' })}${row({ icon: 'lu-server', name: 'Add computer' })}</div>`;

export const tile = ({ initial = '', tone = 'teal', status = 'none', count = 0, open = false }) => `<div class="kanso-rail__tile${open ? ' kanso-control--on' : ''}" tabindex="0">`
  + `${initial ? avatar({ initial, tone, size: 'md' }) : mark({ status, size: 'lg' })}${count ? chip({ label: count, quiet: true, tone: status === 'blocked' ? 'blocked' : '' }) : ''}</div>`;


// Cells

export const header = ({ collapsed = false, dawn: early = false, open = false } = {}) => `<div class="kanso-header${collapsed ? ' kanso-header--collapsed' : ''}">${early ? dawn() : ''}`
  + `<div class="kanso-header__title">${windowControls()}</div>${toolbar({ column: collapsed, open })}</div>`;

const group = (...rows) => `<div class="kanso-sidebar__row-group">${rows.join('')}</div>`;
const lists = {
  spaces: () => group(computerRow({ name: 'light', remote: false }))
    + group(projectRow({ name: 'prjct' }), sessionRow({ program: 'lu-terminal', name: 'Orion', status: 'idle' }))
    + group(projectRow({ name: 'amtelser' }), sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', status: 'blocked' }))
    + group(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', open: true }), sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m' }),
      sessionRow({ name: 'Juno', status: 'idle', depth: 2, current: true }), sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', depth: 2 }))
    + group(projectRow({ name: 'agile' })) + group(asleep({ names: ['site', 'dojo'] })) + group(computerRow({ name: 'dark', state: 'off' })),
  agents: () => section({ title: 'Needs you', status: 'blocked' }) + sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', place: 'amtelser', status: 'blocked', depth: 0 })
    + section({ title: 'Working' }) + sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m', place: 'kansō', depth: 0 })
    + section({ title: 'Done' }) + sessionRow({ program: 'p-codex', name: 'Iris', place: 'kansō', status: 'done', depth: 0 })
    + section({ title: 'Idle', count: 2 }) + section({ title: 'Terminals', count: 1 }),
  threads: () => section({ title: 'Pinned' }) + sessionRow({ name: 'Review boards 01 to 04', activity: 'Reviewing step 01', time: '3m', current: true, depth: 0 })
    + section({ title: 'kansō' }) + sessionRow({ name: 'Audit the app errors', activity: 'Allow network access?', time: '1m', status: 'blocked', depth: 0 }) + sessionRow({ name: 'Sleep lost call', status: 'done', depth: 0 })
    + section({ title: 'Snoozed', count: 1 }) + section({ title: 'Settled', count: 4 }),
};
const tiles = {
  spaces: () => tile({ initial: 'A', tone: 'teal', status: 'blocked', count: 4, open: true }) + tile({ initial: 'D', tone: 'yellow', status: 'working', count: 1 }) + tile({ initial: 'B', tone: '', count: 1 }),
  agents: () => tile({ status: 'blocked', count: 1 }) + tile({ status: 'working', count: 3 }) + tile({ status: 'done', count: 2 }) + tile({ status: 'idle', count: 3 }),
  threads: () => tile({ status: 'blocked', count: 1 }) + tile({ status: 'working', count: 1 }) + tile({ status: 'done', count: 1 }),
};
export const sidebar = ({ collapsed = false, dawn: early = false, view = 'spaces', switcher = true, menu: open = false } = {}) => collapsed
  ? `<aside class="kanso-rail">${header({ collapsed, dawn: early })}${switcher ? viewSwitch({ view, column: true, open }) : ''}<div class="kanso-rail__list">${tiles[view]()}</div><div class="kanso-rail__footer">${tool('lu-settings', 'Settings')}</div></aside>`
  : `<aside class="kanso-sidebar">${header({ dawn: early })}${switcher ? viewSwitch({ view }) : ''}<div class="kanso-sidebar__rows">${lists[view]()}</div>${sidebarFooter()}</aside>`;
